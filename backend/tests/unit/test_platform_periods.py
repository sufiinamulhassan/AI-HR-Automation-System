from datetime import datetime, timezone

import pytest

from services.hr_module import platform_service as svc

pytestmark = pytest.mark.anyio

NOW = datetime(2026, 10, 12, 15, 30, tzinfo=timezone.utc)


class FakeCursor:
    def __init__(self, rows):
        self.rows = list(rows)
        self.sorted_by = None
        self.limited = None

    def sort(self, key, direction=1):
        self.sorted_by = (key, direction)
        return self

    def limit(self, n):
        self.limited = n
        return self

    async def to_list(self, length=None):
        return self.rows if self.limited is None else self.rows[: self.limited]

    def __aiter__(self):
        async def gen():
            for row in self.rows:
                yield row
        return gen()


class FakeCollection:
    def __init__(self, raw, name):
        self.raw = raw
        self.name = name

    def aggregate(self, pipeline, *args, **kwargs):
        self.raw.calls.append((self.name, "aggregate", pipeline))
        return FakeCursor(self.raw.answers.get(self.name, []))

    def find(self, query=None, projection=None, *args, **kwargs):
        self.raw.calls.append((self.name, "find", query))
        cursor = FakeCursor(self.raw.answers.get(self.name, []))
        self.raw.cursors.append(cursor)
        return cursor


class FakeRaw:
    def __init__(self, answers=None):
        self.calls = []
        self.cursors = []
        self.answers = answers or {}

    def __getitem__(self, name):
        return FakeCollection(self, name)

    __getattr__ = __getitem__


def test_a_month_runs_from_its_first_instant_to_the_first_instant_of_the_next():
    p = svc.month_period("2026-10", NOW)
    assert p.kind == "month" and p.days == 31
    assert p.start == datetime(2026, 10, 1, tzinfo=timezone.utc)
    assert p.end == datetime(2026, 11, 1, tzinfo=timezone.utc)
    assert p.payload() == {"kind": "month", "from": "2026-10-01T00:00:00+00:00", "to": "2026-11-01T00:00:00+00:00"}
    assert (p.since, p.until) == ("2026-10-01T00:00:00+00:00", "2026-11-01T00:00:00+00:00")


def test_december_rolls_into_the_next_year_and_february_knows_leap_years():
    assert svc.month_period("2026-12").end == datetime(2027, 1, 1, tzinfo=timezone.utc)
    assert svc.month_period("2028-02").days == 29 and svc.month_period("2027-02").days == 28
    assert svc.month_period("2028-02").end == datetime(2028, 3, 1, tzinfo=timezone.utc)


def test_the_daily_series_of_a_month_has_one_date_per_day_and_starts_on_the_first():
    p = svc.month_period("2026-10")
    dates = p.dates()
    assert len(dates) == 31 and dates[0] == "2026-10-01" and dates[-1] == "2026-10-31"
    assert svc.month_period("2028-02").dates()[-1] == "2028-02-29"


@pytest.mark.parametrize("bad", ["", "2026-13", "2026-00", "2026-1", "26-10", "october", "2026-10-01", "1999-12", "2101-01", " "])
def test_a_bad_month_is_a_422(bad):
    with pytest.raises(svc.PlatformError) as refused:
        svc.month_period(bad)
    assert refused.value.status == 422


def test_a_window_starts_at_utc_midnight_and_ends_now():
    p = svc.window_period(30, NOW)
    assert p.kind == "window" and p.end is None and p.until is None and p.days == 30
    assert p.start == datetime(2026, 9, 13, tzinfo=timezone.utc)
    assert p.payload() == {"kind": "window", "from": "2026-09-13T00:00:00+00:00", "to": NOW.isoformat()}
    dates = p.dates()
    assert len(dates) == 30 and dates[0] == "2026-09-13" and dates[-1] == "2026-10-12"


def test_a_window_or_a_month_but_never_both_and_the_default_is_thirty_days():
    assert svc.resolve_period(now=NOW).days == 30 and svc.resolve_period(now=NOW).kind == "window"
    assert svc.resolve_period(window=7, now=NOW).days == 7
    assert svc.resolve_period(month="2026-09").kind == "month"
    with pytest.raises(svc.PlatformError) as both:
        svc.resolve_period(window=7, month="2026-09")
    assert both.value.status == 422
    for days in (0, 14, 365, -7):
        with pytest.raises(svc.PlatformError) as refused:
            svc.resolve_period(window=days)
        assert refused.value.status == 422


def test_an_integer_still_means_a_window_of_that_many_days():
    assert svc.as_period(7).kind == "window" and svc.as_period(7).days == 7
    p = svc.month_period("2026-10")
    assert svc.as_period(p) is p


@pytest.mark.anyio
async def test_a_months_counts_are_bounded_on_both_sides_in_every_aggregate():
    raw = FakeRaw()
    await svc.collect_usage(raw, ["cmp_a", "cmp_b"], svc.month_period("2026-03"))
    assert len(raw.calls) == 9
    for name, _, pipeline in raw.calls:
        if name == "users":
            recent = pipeline[1]["$group"]["active"]["$sum"]["$cond"][0]
            assert {"$lt": ["$last_login_at", datetime(2026, 4, 1, tzinfo=timezone.utc)]} in recent["$and"]
            continue
        group = pipeline[-1]["$group"] if "$group" in pipeline[-1] else None
        if name == "candidates":
            facets = pipeline[1]["$facet"]
            groups = [stages[-1]["$group"] for stages in facets.values()]
        else:
            groups = [group]
        for g in groups:
            in_window = g["window"]["$sum"]["$cond"][0]["$and"]
            date_field = next(t["$eq"][0]["$type"] for t in in_window if "$eq" in t)
            assert {"$gte": [date_field, "2026-03-01T00:00:00+00:00"]} in in_window, name
            assert {"$lt": [date_field, "2026-04-01T00:00:00+00:00"]} in in_window, name


@pytest.mark.anyio
async def test_a_window_has_no_upper_bound():
    raw = FakeRaw()
    await svc.collect_usage(raw, ["cmp_a"], 30)
    jobs = next(p for name, _, p in raw.calls if name == "jobs")
    in_window = jobs[-1]["$group"]["window"]["$sum"]["$cond"][0]["$and"]
    assert not any("$lt" in t for t in in_window)


@pytest.mark.anyio
async def test_the_daily_series_asks_for_the_months_range_and_zero_fills_the_rest():
    answers = {
        "jobs": [{"_id": "2026-03-01", "n": 2}, {"_id": "2026-03-31", "n": 1}],
        "email_log": [{"_id": "2026-03-01", "n": 4}],
    }
    raw = FakeRaw(answers)
    series = await svc._activity(raw, ["cmp_a"], svc.month_period("2026-03"))
    assert len(series) == 31
    assert series[0] == {"date": "2026-03-01", "count": 6}
    assert series[-1] == {"date": "2026-03-31", "count": 1}
    assert sum(day["count"] for day in series) == 7
    jobs_match = next(p for name, _, p in raw.calls if name == "jobs")[1]["$match"]["$and"]
    assert {"created_at": {"$gte": "2026-03-01T00:00:00+00:00", "$lt": "2026-04-01T00:00:00+00:00"}} in jobs_match


@pytest.mark.anyio
async def test_spend_by_source_is_the_months_spend_for_a_month_and_all_time_for_a_window():
    raw = FakeRaw()
    await svc._cost_by_source(raw, ["cmp_a"], svc.month_period("2026-03"))
    month_match = raw.calls[0][2][0]["$match"]
    assert month_match["created_at"] == {"$gte": "2026-03-01T00:00:00+00:00", "$lt": "2026-04-01T00:00:00+00:00"}
    raw = FakeRaw()
    await svc._cost_by_source(raw, ["cmp_a"], svc.window_period(30))
    assert "created_at" not in raw.calls[0][2][0]["$match"]
    await svc._cost_by_source(raw, ["cmp_a"])
    assert "created_at" not in raw.calls[1][2][0]["$match"]


def test_the_audit_cursor_is_an_iso_timestamp_with_a_plus_put_back_when_the_query_string_ate_it():
    assert svc._audit_cursor(None) is None
    assert svc._audit_cursor("2026-10-12T10:00:00.123456+00:00") == "2026-10-12T10:00:00.123456+00:00"
    assert svc._audit_cursor("2026-10-12T10:00:00Z") == "2026-10-12T10:00:00+00:00"
    assert svc._audit_cursor("2026-10-12T10:00:00 00:00") == "2026-10-12T10:00:00+00:00"
    for bad in ("yesterday", "", "2026-13-40"):
        with pytest.raises(svc.PlatformError) as refused:
            svc._audit_cursor(bad)
        assert refused.value.status == 422


@pytest.mark.anyio
async def test_the_audit_page_reads_one_more_than_it_shows_and_names_the_next_cursor(monkeypatch):
    rows = [{"created_at": f"2026-10-12T10:00:0{i}+00:00", "action": f"a{i}", "actor_email": "o@x.com",
             "resource_type": "client", "resource_id": f"cli_{i}", "details": {}} for i in (5, 4, 3)]
    raw = FakeRaw({"audit_log": rows})
    monkeypatch.setattr(svc, "get_platform_db", lambda: raw)
    page = await svc.audit_page(2, None)
    assert [e["action"] for e in page["entries"]] == ["a5", "a4"]
    assert page["next_before"] == "2026-10-12T10:00:04+00:00"
    assert set(page["entries"][0]) == {"at", "action", "actor_email", "resource_type", "resource_id", "details"}
    assert raw.calls[0][2] == {"company_id": svc.PLATFORM_COMPANY_ID}

    last = await svc.audit_page(3, "2026-10-12T10:00:06+00:00")
    assert last["next_before"] is None and len(last["entries"]) == 3
    assert raw.calls[1][2]["created_at"] == {"$lt": "2026-10-12T10:00:06+00:00"}


@pytest.mark.anyio
async def test_the_audit_page_never_returns_more_than_the_maximum(monkeypatch):
    raw = FakeRaw({"audit_log": []})
    monkeypatch.setattr(svc, "get_platform_db", lambda: raw)
    await svc.audit_page(100000, None)
    await svc.audit_page(0, None)
    assert [c.limited for c in raw.cursors] == [svc.AUDIT_PAGE_MAX + 1, 2]


@pytest.mark.anyio
async def test_failed_mail_is_one_grouped_aggregate_and_two_name_lookups_however_many_companies(monkeypatch):
    groups = [{"_id": f"cmp_{i}", "failed": 10 - i} for i in range(8)]
    companies = [{"company_id": f"cmp_{i}", "name": f"Company {i}", "client_id": f"cli_{i % 2}"} for i in range(8)]
    clients = [{"client_id": "cli_0", "name": "Zero"}, {"client_id": "cli_1", "name": "One"}]
    raw = FakeRaw({"email_log": groups, "companies": companies, "clients": clients})
    rows = await svc._failed_emails(raw)

    kinds = [(name, kind) for name, kind, _ in raw.calls]
    assert kinds == [("email_log", "aggregate"), ("companies", "find"), ("clients", "find")]
    match = raw.calls[0][2][0]["$match"]
    assert match["status"] == "failed" and match["created_at"]["$gte"]
    assert any("$group" in stage for stage in raw.calls[0][2])
    assert rows[0] == {"company_id": "cmp_0", "company_name": "Company 0", "client_name": "Zero", "failed": 10}
    assert rows[1]["client_name"] == "One" and [r["failed"] for r in rows] == sorted((r["failed"] for r in rows), reverse=True)
    assert all(set(r) == {"company_id", "company_name", "client_name", "failed"} for r in rows)


@pytest.mark.anyio
async def test_no_failed_mail_means_no_lookups():
    raw = FakeRaw({"email_log": []})
    assert await svc._failed_emails(raw) == []
    assert [c[0] for c in raw.calls] == ["email_log"]


def test_a_cron_row_has_the_documented_fields_and_drops_the_storage_prefix():
    row = svc._cron_row({
        "key": "cron_reminders", "started_at": "x", "last_run_at": "2026-10-12T04:00:00+00:00", "status": "ok",
        "detail": "5 companies", "companies_total": 5, "companies_served": 5, "companies_failed": 0,
    })
    assert row == {
        "key": "reminders", "last_run_at": "2026-10-12T04:00:00+00:00", "status": "ok", "detail": "5 companies",
        "companies_total": 5, "companies_served": 5, "companies_failed": 0,
    }
    assert set(svc._cron_row({"key": "cron_x"})) == set(row)


@pytest.mark.anyio
async def test_health_has_the_documented_shape(monkeypatch):
    class Handle:
        async def command(self, name):
            assert name == "ping"
            return {"ok": 1}

    async def cron():
        return [{"key": "cron_daily", "last_run_at": "t", "status": "ok", "detail": "d",
                 "companies_total": 1, "companies_served": 1, "companies_failed": 0}]

    async def failed(raw):
        return [{"company_id": "cmp_x", "company_name": "X", "client_name": "Y", "failed": 3}]

    monkeypatch.setattr(svc, "get_platform_db", lambda: Handle())
    monkeypatch.setattr(svc.email_delivery_service, "current_provider", lambda: "smtp")
    monkeypatch.setattr(svc.workspace_service, "platform_cron_status", cron)
    monkeypatch.setattr(svc, "_failed_emails", failed)
    monkeypatch.setattr(svc.settings, "PINECONE_API_KEY", "key")
    body = await svc.health()
    assert set(body) == {"mongo", "email", "pinecone", "cron", "failed_emails_24h"}
    assert body["mongo"]["ok"] is True and isinstance(body["mongo"]["latency_ms"], (int, float))
    assert body["email"] == {"configured": True, "provider": "smtp"}
    assert body["pinecone"] == {"configured": True}
    assert body["cron"][0]["key"] == "daily"
    assert body["failed_emails_24h"] == [{"company_id": "cmp_x", "company_name": "X", "client_name": "Y", "failed": 3}]

    monkeypatch.setattr(svc.email_delivery_service, "current_provider", lambda: None)
    monkeypatch.setattr(svc.settings, "PINECONE_API_KEY", "")
    quiet = await svc.health()
    assert quiet["email"] == {"configured": False, "provider": None} and quiet["pinecone"] == {"configured": False}


@pytest.mark.anyio
async def test_health_still_answers_when_mongodb_does_not(monkeypatch):
    class Broken:
        async def command(self, name):
            raise RuntimeError("no route to host")

    monkeypatch.setattr(svc, "get_platform_db", lambda: Broken())
    body = await svc.health()
    assert body["mongo"] == {"ok": False, "latency_ms": None}
    assert body["cron"] == [] and body["failed_emails_24h"] == []

    monkeypatch.setattr(svc, "get_platform_db", lambda: None)
    assert (await svc.database_ping()) == {"ok": False, "latency_ms": None}
    assert (await svc.health())["mongo"]["ok"] is False


@pytest.mark.anyio
async def test_the_ping_times_out_instead_of_hanging(monkeypatch):
    import asyncio

    class Slow:
        async def command(self, name):
            await asyncio.sleep(5)

    monkeypatch.setattr(svc, "get_platform_db", lambda: Slow())
    monkeypatch.setattr(svc, "HEALTH_PING_SECONDS", 0.01)
    assert (await svc.database_ping())["ok"] is False
