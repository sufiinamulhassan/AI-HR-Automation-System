from datetime import datetime, timezone

import pytest

from services.hr_module import platform_service as svc


class FakeCursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, length=None):
        return self.rows


class FakeCollection:
    def __init__(self, raw, name):
        self.raw = raw
        self.name = name

    def aggregate(self, pipeline, *args, **kwargs):
        self.raw.calls.append((self.name, pipeline))
        return FakeCursor(self.raw.answers.get(self.name, []))


class FakeRaw:
    def __init__(self, answers=None):
        self.calls = []
        self.answers = answers or {}

    def __getitem__(self, name):
        return FakeCollection(self, name)

    __getattr__ = __getitem__


def _ids(n):
    return [f"cmp_{i:04d}" for i in range(n)]


def test_the_features_match_the_documented_table():
    assert [(f.key, f.label) for f in svc.FEATURES] == [
        ("jobs", "Jobs"), ("resumes", "Resumes"), ("candidates", "Candidates"),
        ("interviews", "Interviews"), ("coding", "Coding assessments"), ("offers", "Offers"),
        ("performance", "Performance reviews"), ("emails", "Emails"), ("ai", "AI calls"),
    ]
    assert {f.key: f.collection for f in svc.FEATURES} == {
        "jobs": "jobs", "resumes": "resumes", "candidates": "candidates", "interviews": "candidates",
        "coding": "coding_submissions", "offers": "offers", "performance": "performance_reviews",
        "emails": "email_log", "ai": "cost_ledger",
    }


def test_each_feature_filter_is_the_documented_one():
    by_key = {f.key: f for f in svc.FEATURES}
    assert by_key["resumes"].filter == {"processing_status": "processed"}
    assert by_key["emails"].filter == {"status": "sent"}
    assert by_key["interviews"].filter["interview_mode"] == {"$ne": "external"}
    assert "status" not in by_key["interviews"].filter
    assert by_key["interviews"].date_field == "interview_ended_at"
    assert by_key["coding"].date_field == "submitted_at"
    assert (by_key["ai"].sum_field, by_key["ai"].cost_field) == ("llm_calls", "cost_usd")


def test_flat_key_renames_only_the_ai_feature():
    assert svc.flat_key("ai") == "ai_calls"
    assert svc.flat_key("jobs") == "jobs"


@pytest.mark.anyio
async def test_usage_is_one_aggregate_per_collection_however_many_companies():
    raw = FakeRaw()
    ids = _ids(250)
    await svc.collect_usage(raw, ids, 30)

    names = [name for name, _ in raw.calls]
    assert sorted(names) == sorted([
        "users", "jobs", "resumes", "candidates", "coding_submissions", "offers",
        "performance_reviews", "email_log", "cost_ledger",
    ])
    for _, pipeline in raw.calls:
        first = pipeline[0]["$match"]
        assert first["company_id"] == {"$in": ids}


@pytest.mark.anyio
async def test_nothing_is_queried_when_there_are_no_companies():
    raw = FakeRaw()
    assert await svc.collect_usage(raw, [], 30) == {}
    assert raw.calls == []


@pytest.mark.anyio
async def test_the_candidates_collection_serves_two_features_in_one_facet():
    raw = FakeRaw()
    await svc.collect_usage(raw, _ids(3), 30)
    pipeline = next(p for name, p in raw.calls if name == "candidates")
    assert "$facet" in pipeline[1]
    assert set(pipeline[1]["$facet"]) == {"candidates", "interviews"}


@pytest.mark.anyio
async def test_the_window_comparison_trusts_only_string_dates():
    raw = FakeRaw()
    await svc.collect_usage(raw, _ids(2), 30)
    pipeline = next(p for name, p in raw.calls if name == "jobs")
    group = pipeline[-1]["$group"]
    in_window = group["window"]["$sum"]["$cond"][0]
    assert {"$eq": [{"$type": "$created_at"}, "string"]} in in_window["$and"]
    assert group["_id"] == "$company_id"


@pytest.mark.anyio
async def test_rows_are_folded_into_each_company():
    ids = ["cmp_a", "cmp_b"]
    answers = {
        "users": [{"_id": "cmp_a", "users": 4, "active": 2, "last": datetime(2026, 10, 1, 8, 0)}],
        "jobs": [{"_id": "cmp_a", "total": 7, "window": 3, "last": "2026-10-02T09:00:00+00:00"},
                 {"_id": "cmp_b", "total": 1, "window": 0, "last": "2026-01-02T09:00:00+00:00"}],
        "cost_ledger": [{"_id": "cmp_a", "total": 12, "window": 5, "last": "2026-10-03T00:00:00+00:00",
                         "cost": 1.5, "cost_window": 0.5}],
        "candidates": [{"candidates": [{"_id": "cmp_b", "total": 2, "window": 2, "last": "2026-10-04T00:00:00+00:00"}],
                        "interviews": []}],
    }
    raw = FakeRaw(answers)
    usage = await svc.collect_usage(raw, ids, 30)
    a, b = usage["cmp_a"], usage["cmp_b"]
    assert (a.users, a.active_users) == (4, 2)
    assert (a.total["jobs"], a.window["jobs"]) == (7, 3)
    assert (a.total["ai"], a.window["ai"], a.cost, a.cost_window) == (12, 5, 1.5, 0.5)
    assert b.total["jobs"] == 1 and b.window["jobs"] == 0
    assert a.last_active == datetime(2026, 10, 3, 0, 0, tzinfo=timezone.utc)
    assert a.activity == 3 + 5


def test_the_window_starts_at_midnight_so_it_equals_the_daily_series():
    now = datetime(2026, 10, 9, 15, 30, tzinfo=timezone.utc)
    start = svc.window_start(30, now)
    assert start == datetime(2026, 9, 10, 0, 0, tzinfo=timezone.utc)
    assert svc.window_start(7, now) == datetime(2026, 10, 3, 0, 0, tzinfo=timezone.utc)
    assert svc.window_start(1, now) == datetime(2026, 10, 9, 0, 0, tzinfo=timezone.utc)


def test_parse_ts_accepts_strings_naive_datetimes_and_junk():
    assert svc.parse_ts("2026-10-09T12:00:00Z") == datetime(2026, 10, 9, 12, tzinfo=timezone.utc)
    assert svc.parse_ts(datetime(2026, 10, 9, 12)) == datetime(2026, 10, 9, 12, tzinfo=timezone.utc)
    assert svc.parse_ts("not a date") is None
    assert svc.parse_ts(None) is None and svc.parse_ts("") is None


def test_sso_domains_are_normalised_and_checked():
    assert svc.normalize_domains([" @Acme.COM ", "acme.com", "mail.acme.co.uk", ""]) == ["acme.com", "mail.acme.co.uk"]
    assert svc.normalize_domains(None) == []
    for bad in ("acme", "not a domain", "-x.com", "a..com", "http://acme.com"):
        with pytest.raises(svc.PlatformError) as exc:
            svc.normalize_domains([bad])
        assert exc.value.status == 422


def test_a_plan_patch_changes_only_what_it_sends():
    base = svc._merge_plan(None, None)
    assert set(base) == set(svc.PLAN_KEYS)
    plan = svc._merge_plan(base, {"max_companies": 3})
    assert plan["max_companies"] == 3 and plan["name"] == base["name"]
    cleared = svc._merge_plan(plan, {"max_companies": None, "name": "  ", "bogus": 1})
    assert cleared["max_companies"] is None and cleared["name"] == base["name"] and "bogus" not in cleared


def test_top_feature_ignores_the_by_products():
    usage = svc.Usage()
    usage.window.update({"ai": 900, "emails": 400, "jobs": 3, "resumes": 10})
    assert svc._top_feature(usage) == {"key": "resumes", "label": "Resumes", "count": 10}
    quiet = svc.Usage()
    quiet.window.update({"ai": 5, "emails": 5})
    assert svc._top_feature(quiet) is None


def test_growth_is_cumulative_over_twelve_months_across_a_year_end():
    now = datetime(2026, 2, 15, tzinfo=timezone.utc)
    months = svc._month_keys(now)
    assert months[0] == "2025-03" and months[-1] == "2026-02" and len(months) == 12
    clients = [{"created_at": "2024-01-01T00:00:00+00:00"}, {"created_at": "2025-12-05T00:00:00+00:00"}, {}]
    companies = [{"created_at": "2026-02-01T00:00:00+00:00"}]
    growth = svc._growth(clients, companies, now)
    assert growth[0] == {"month": "2025-03", "clients": 2, "companies": 0}
    assert growth[-1] == {"month": "2026-02", "clients": 3, "companies": 1}
    assert [g["clients"] for g in growth] == sorted(g["clients"] for g in growth)


def test_slugs_come_from_names_and_an_unusable_one_is_refused():
    assert svc._explicit_slug("  Acme Corp! ") == "acme-corp"
    assert svc._explicit_slug(None) is None and svc._explicit_slug("  ") is None
    with pytest.raises(svc.PlatformError) as exc:
        svc._explicit_slug("!!!")
    assert exc.value.status == 422
    assert svc._derived_slug("***", "client") == "client"
    assert svc._derived_slug("Acme Corp", "client") == "acme-corp"
    assert "platform" in svc.RESERVED_SLUGS and "default" in svc.RESERVED_SLUGS


def test_passwords_need_eight_characters_and_fit_bcrypt():
    svc._check_password("12345678")
    for bad in ("1234567", "", None, "x" * 73):
        with pytest.raises(svc.PlatformError) as exc:
            svc._check_password(bad)
        assert exc.value.status == 422
