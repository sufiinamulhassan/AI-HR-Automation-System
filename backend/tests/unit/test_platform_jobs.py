import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest

from services.hr_module import alerts_service, platform_jobs as jobs, platform_service, plan_service, workspace_service

pytestmark = pytest.mark.anyio

NOW = datetime(2026, 10, 12, 9, 0, tzinfo=timezone.utc)
MB = 1024 * 1024


def test_the_reconcile_asks_each_file_collection_for_one_grouped_bson_size_sum():
    pipelines = jobs.storage_pipelines()
    assert set(pipelines) == {"resume_files", "branding_settings", "users"}
    for name in ("resume_files", "branding_settings"):
        assert pipelines[name] == [{"$group": {"_id": "$company_id", "bytes": {"$sum": {"$bsonSize": "$$ROOT"}}}}]
    users = pipelines["users"]
    assert users[0] == {"$match": {"avatar_base64": {"$type": "string"}}} and users[1]["$group"]["_id"] == "$company_id"


def test_the_rows_of_the_three_aggregates_are_added_per_company():
    totals = jobs.fold_storage(
        [{"_id": "cmp_a", "bytes": 1000}, {"_id": "cmp_b", "bytes": 5}],
        [{"_id": "cmp_a", "bytes": 24}],
        [{"_id": None, "bytes": 99}, {"_id": "cmp_c", "bytes": None}],
    )
    assert totals == {"cmp_a": 1024, "cmp_b": 5, "cmp_c": 0}


class Cursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, length=None):
        return self.rows


class Aggregating:
    def __init__(self, rows):
        self.rows = rows
        self.pipelines = []

    def aggregate(self, pipeline):
        self.pipelines.append(pipeline)
        return Cursor(self.rows)


class Companies:
    def __init__(self, docs):
        self.docs = docs
        self.batches = []

    def find(self, flt, projection=None):
        return Cursor([dict(d) for d in self.docs])

    async def bulk_write(self, operations, ordered=True):
        self.batches.append(operations)
        for op in operations:
            target = next(d for d in self.docs if d["company_id"] == op._filter["company_id"])
            for path, value in op._doc["$set"].items():
                parent, _, leaf = path.partition(".")
                target.setdefault(parent, {})[leaf] = value


class Settings:
    def __init__(self):
        self.deleted = []

    async def delete_many(self, flt):
        self.deleted.append(flt)

        class R:
            deleted_count = 2

        return R()


class Raw:
    def __init__(self, companies, files=(), avatars=(), branding=(), clients=(), ledger=()):
        self.companies = Companies(companies)
        self.resume_files = Aggregating(list(files))
        self.users = Aggregating(list(avatars))
        self.branding_settings = Aggregating(list(branding))
        self.cost_ledger = Aggregating(list(ledger))
        self.settings = Settings()

        class Clients:
            def find(_, flt, projection=None):
                return Cursor([dict(c) for c in clients])

        self.clients = Clients()

    def __getitem__(self, name):
        return getattr(self, name)


def company(cid, client="cli_a", used=0, when=None, **extra):
    usage = {"storage_bytes": used, **({"storage_reconciled_at": when} if when else {})}
    return {"company_id": cid, "client_id": client, "name": f"Co {cid}", "status": "active", "usage": usage, **extra}


def a_client(client_id="cli_a", **plan):
    return {"client_id": client_id, "name": "Acme Group", "status": "active", "plan": plan, "subscription": {}}


async def context(raw, seconds=30.0, now=NOW):
    ctx = jobs._Context(raw, now, jobs._Clock(seconds))
    await ctx.load()
    return ctx


async def test_the_counter_is_set_to_what_is_really_stored_and_drift_is_counted():
    raw = Raw(
        [company("cmp_a", used=999 * MB), company("cmp_b", used=0), company("cmp_c", used=0)],
        files=[{"_id": "cmp_a", "bytes": 2 * MB}, {"_id": "cmp_b", "bytes": 100}],
        avatars=[{"_id": "cmp_a", "bytes": 512}],
        branding=[{"_id": "cmp_b", "bytes": 28}],
        clients=[a_client()],
    )
    out = await jobs.reconcile_storage(await context(raw))
    assert out == {"companies": 3, "reconciled": 3, "drifted": 2, "complete": True}
    by_id = {c["company_id"]: c["usage"] for c in raw.companies.docs}
    assert by_id["cmp_a"]["storage_bytes"] == 2 * MB + 512
    assert by_id["cmp_b"]["storage_bytes"] == 128 and by_id["cmp_c"]["storage_bytes"] == 0
    assert all(u["storage_reconciled_at"] == NOW.isoformat() for u in by_id.values())
    for source in (raw.resume_files, raw.users, raw.branding_settings):
        assert len(source.pipelines) == 1


async def test_it_is_idempotent_running_it_again_changes_nothing_further():
    raw = Raw([company("cmp_a", used=5)], files=[{"_id": "cmp_a", "bytes": 700}], clients=[a_client()])
    first = await jobs.reconcile_storage(await context(raw))
    second = await jobs.reconcile_storage(await context(raw))
    assert first["drifted"] == 1 and second["drifted"] == 0
    assert raw.companies.docs[0]["usage"]["storage_bytes"] == 700


async def test_the_company_reconciled_longest_ago_goes_first_and_a_spent_budget_stops_between_batches(monkeypatch):
    monkeypatch.setattr(jobs, "RECONCILE_BATCH", 2)
    docs = [
        company("cmp_new", when="2026-10-11T00:00:00+00:00"), company("cmp_never"),
        company("cmp_old", when="2026-09-01T00:00:00+00:00"), company("cmp_mid", when="2026-10-01T00:00:00+00:00"),
    ]
    raw = Raw(docs, clients=[a_client()])
    ctx = await context(raw)
    real = raw.companies.bulk_write

    async def spend_the_budget_after_one_batch(operations, ordered=True):
        await real(operations, ordered)
        ctx.clock.deadline = 0

    raw.companies.bulk_write = spend_the_budget_after_one_batch
    out = await jobs.reconcile_storage(ctx)
    assert out["reconciled"] == 2 and out["complete"] is False
    first_batch = [op._filter["company_id"] for op in raw.companies.batches[0]]
    assert first_batch == ["cmp_never", "cmp_old"]
    raw.companies.bulk_write = real
    again = await jobs.reconcile_storage(await context(raw))
    assert again["complete"] is True
    assert [op._filter["company_id"] for op in raw.companies.batches[1]][:2] == ["cmp_mid", "cmp_new"]


async def test_a_reconcile_that_found_drift_makes_the_console_cache_stale(monkeypatch):
    bump = AsyncMock()
    monkeypatch.setattr(platform_service, "invalidate_console_cache", bump)
    await jobs.reconcile_storage(await context(Raw([company("cmp_a", used=1)], clients=[a_client()])))
    bump.assert_awaited_once()
    bump.reset_mock()
    await jobs.reconcile_storage(await context(Raw([company("cmp_a", used=0)], clients=[a_client()])))
    bump.assert_not_awaited()


def test_ninety_percent_of_the_cap_is_where_the_storage_alert_starts():
    client = a_client(max_storage_mb=100)
    assert jobs.storage_notice(company("cmp_a", used=89 * MB), client) is None
    notice = jobs.storage_notice(company("cmp_a", used=90 * MB), client)
    assert notice["key"] == "storage_90:cmp_a" and "90%" in notice["subject"] and "100 MB" in notice["body"]
    assert notice["cooldown_hours"] == 24 * 7
    assert jobs.storage_notice(company("cmp_a", used=500 * MB), client)["subject"].startswith("Co cmp_a is at 500%")
    assert jobs.storage_notice(company("cmp_a", used=999 * MB), a_client()) is None
    assert jobs.storage_notice(company("cmp_a", used=999 * MB), None) is None


async def test_the_storage_step_alerts_the_owners_for_each_company_over_the_line(monkeypatch):
    alert = AsyncMock(return_value=True)
    monkeypatch.setattr(alerts_service, "alert_owners", alert)
    raw = Raw(
        [company("cmp_a", used=95 * MB), company("cmp_b", used=10 * MB), company("cmp_c", "cli_b", used=999 * MB)],
        clients=[a_client(max_storage_mb=100), a_client("cli_b")],
    )
    out = await jobs.storage_alerts(await context(raw))
    assert out == {"over_90_percent": 1, "alerts_sent": 1}
    assert alert.await_args.args[0] == "storage_90:cmp_a" and alert.await_args.kwargs["company_id"] == "cmp_a"


def trial_client(ends, status="trialing", **extra):
    return {"client_id": "cli_t", "name": "Trial Co", "plan": {"trial_ends_at": ends.isoformat() if ends else None},
            "subscription": {"status": status}, **extra}


def test_a_trial_ending_within_three_days_is_noticed_once_with_the_days_left():
    notice = jobs.trial_notice(trial_client(NOW + timedelta(days=2, hours=3)), NOW)
    assert notice["key"] == f"trial_ending:cli_t:{(NOW + timedelta(days=2, hours=3)).date().isoformat()}"
    assert "3 days left" in notice["body"] and "Trial Co" in notice["subject"]
    assert "1 day left" in jobs.trial_notice(trial_client(NOW + timedelta(hours=5)), NOW)["body"]
    assert jobs.trial_notice(trial_client(NOW + timedelta(days=3)), NOW) is not None
    assert jobs.trial_notice(trial_client(NOW + timedelta(days=3, minutes=1)), NOW) is None


def test_a_trial_that_ended_in_the_last_week_is_noticed_and_an_old_one_is_not():
    notice = jobs.trial_notice(trial_client(NOW - timedelta(days=2)), NOW)
    assert notice["key"].startswith("trial_ended:cli_t:") and "has ended" in notice["subject"]
    assert jobs.trial_notice(trial_client(NOW - timedelta(days=7)), NOW) is not None
    assert jobs.trial_notice(trial_client(NOW - timedelta(days=8)), NOW) is None


def test_a_client_that_subscribed_was_canceled_or_never_had_a_trial_is_not_noticed():
    soon = NOW + timedelta(days=1)
    assert jobs.trial_notice(trial_client(soon, "active"), NOW) is None
    assert jobs.trial_notice(trial_client(soon, "canceled"), NOW) is None
    assert jobs.trial_notice(trial_client(None), NOW) is None
    assert jobs.trial_notice(trial_client(soon, "past_due"), NOW) is not None
    assert jobs.trial_notice(trial_client(NOW + timedelta(days=30)), NOW) is None


async def test_the_trial_step_alerts_without_a_company_and_never_more_than_the_cap(monkeypatch):
    alert = AsyncMock(return_value=True)
    monkeypatch.setattr(alerts_service, "alert_owners", alert)
    monkeypatch.setattr(jobs, "MAX_ALERTS_PER_STEP", 2)
    clients = [{**trial_client(NOW + timedelta(days=1)), "client_id": f"cli_{i}"} for i in range(5)]
    out = await jobs.trial_notices(await context(Raw([], clients=clients)))
    assert out == {"clients_noticed": 5, "alerts_sent": 2}
    assert "company_id" not in alert.await_args.kwargs


def test_mail_failures_above_the_threshold_make_one_alert_listing_the_companies():
    rows = [
        {"company_id": "cmp_a", "company_name": "Acme", "client_name": "G", "failed": 40},
        {"company_id": "cmp_b", "company_name": "", "client_name": "G", "failed": 10},
        {"company_id": "cmp_c", "company_name": "Quiet", "client_name": "G", "failed": 9},
    ]
    notice = jobs.email_failure_notice(rows)
    assert notice["key"] == "email_failures" and "2 companies" in notice["subject"]
    assert "Acme: 40 failed" in notice["body"] and "cmp_b: 10 failed" in notice["body"] and "Quiet" not in notice["body"]
    assert jobs.email_failure_notice(rows[2:]) is None and jobs.email_failure_notice([]) is None
    assert "1 company" in jobs.email_failure_notice(rows[:1])["subject"]
    assert jobs.email_failure_notice(rows[2:], threshold=5) is not None


async def test_the_mail_step_reads_the_last_days_failures_and_alerts_once(monkeypatch):
    rows = [{"company_id": "cmp_a", "company_name": "Acme", "client_name": "G", "failed": 25}]
    monkeypatch.setattr(platform_service, "failed_emails_last_day", AsyncMock(return_value=rows))
    alert = AsyncMock(return_value=True)
    monkeypatch.setattr(alerts_service, "alert_owners", alert)
    out = await jobs.email_failures(await context(Raw([], clients=[])))
    assert out == {"companies_over_threshold": 1, "alert_sent": True}
    alert.assert_awaited_once()
    monkeypatch.setattr(platform_service, "failed_emails_last_day", AsyncMock(return_value=[]))
    assert await jobs.email_failures(await context(Raw([], clients=[]))) == {"companies_over_threshold": 0, "alert_sent": False}


def test_a_company_past_eighty_percent_that_has_not_been_told_is_a_crossing():
    clients = {"cli_a": a_client(monthly_ai_budget_usd=10), "cli_n": a_client("cli_n")}
    companies = [
        company("cmp_low"), company("cmp_80"), company("cmp_100"),
        company("cmp_told", usage_extra=None), company("cmp_none", "cli_n"),
    ]
    companies[3]["usage"]["ai_alert"] = {"month": "2026-10", "band": 80}
    spend = {"cmp_low": 1.0, "cmp_80": 8.2, "cmp_100": 10.0, "cmp_told": 8.9, "cmp_none": 500.0}
    crossings = jobs.budget_crossings(spend, companies, clients, "2026-10")
    assert {(c["company_id"], c["band"]) for c in crossings} == {("cmp_80", 80), ("cmp_100", 100)}
    spend["cmp_told"] = 10.5
    assert ("cmp_told", 100) in {(c["company_id"], c["band"]) for c in jobs.budget_crossings(spend, companies, clients, "2026-10")}
    assert ("cmp_told", 80) in {(c["company_id"], c["band"]) for c in jobs.budget_crossings({"cmp_told": 8.9}, companies, clients, "2026-11")}


async def test_the_sweep_is_one_grouped_aggregate_of_this_months_ledger_and_reports_each_crossing(monkeypatch):
    told = AsyncMock()
    monkeypatch.setattr(alerts_service, "budget_threshold", told)
    raw = Raw(
        [company("cmp_a"), company("cmp_b")],
        clients=[a_client(monthly_ai_budget_usd=10)],
        ledger=[{"_id": "cmp_a", "cost": 9.0}, {"_id": "cmp_b", "cost": 1.0}, {"_id": None, "cost": 50}],
    )
    out = await jobs.budget_sweep(await context(raw))
    assert out == {"crossed": 1, "reported": 1}
    told.assert_awaited_once_with("cmp_a", 80, 9.0, 10.0, "2026-10")
    (pipeline,) = raw.cost_ledger.pipelines
    assert pipeline[0] == {"$match": {"created_at": {"$gte": "2026-10-01T00:00:00+00:00"}}}
    assert pipeline[1]["$group"]["_id"] == "$company_id"


async def test_old_cache_entries_event_ids_and_throttles_are_dropped_by_their_age():
    raw = Raw([], clients=[])
    out = await jobs.housekeeping(await context(raw))
    assert out == {"cache_entries": 2, "stripe_events": 2, "alert_throttles": 2}
    cache, events, throttles = raw.settings.deleted
    assert cache["_id"] == {"$regex": "^usage_cache:"} and cache["created_at"] == {"$lt": NOW - timedelta(days=1)}
    assert events["_id"] == {"$regex": "^stripe_event:"} and events["created_at"] == {"$lt": NOW - timedelta(days=35)}
    assert throttles["_id"] == {"$regex": "^alert:"} and throttles["last_sent_at"] == {"$lt": NOW - timedelta(days=120)}


@pytest.fixture
def run(monkeypatch):
    raw = Raw([company("cmp_a")], clients=[a_client()])
    recorded = AsyncMock()
    monkeypatch.setattr(jobs, "get_platform_db", lambda: raw)
    monkeypatch.setattr(workspace_service, "record_platform_cron_run", recorded)
    steps = []

    def make(name, *, pause=0.0, fail=False):
        async def step(ctx):
            steps.append(name)
            if pause:
                await asyncio.sleep(pause)
            if fail:
                raise RuntimeError("step failed")
            return {"ran": name}

        return name, step

    def install(*specs):
        monkeypatch.setattr(jobs, "STEPS", tuple(make(*s[:1], **s[1]) for s in specs))
        return steps

    return install, raw, recorded


async def test_the_run_goes_through_every_step_and_leaves_a_line_for_the_health_page(run):
    install, raw, recorded = run
    steps = install(("one", {}), ("two", {}), ("three", {}))
    out = await jobs.run_platform_checks(30)
    assert steps == ["one", "two", "three"]
    assert out["ok"] is True and out["complete"] is True and out["skipped"] == []
    assert out["steps"] == {"one": {"ran": "one"}, "two": {"ran": "two"}, "three": {"ran": "three"}}
    assert isinstance(out["elapsed_seconds"], float)
    recorded.assert_awaited_once()
    key, row = recorded.await_args.args
    assert key == "platform_checks" and row["status"] == "ok" and row["companies_total"] == 1 and "3 of 3" in row["detail"]


async def test_no_budget_means_no_work_and_no_run_record(run):
    install, raw, recorded = run
    steps = install(("one", {}), ("two", {}))
    out = await jobs.run_platform_checks(0)
    assert steps == [] and out["skipped"] == ["one", "two"] and out["complete"] is False and out["steps"] == {}
    recorded.assert_not_awaited()


async def test_a_step_is_not_started_once_the_budget_is_spent_and_the_rest_are_reported_as_skipped(run):
    install, raw, recorded = run
    steps = install(("slow", {"pause": 0.08}), ("late", {}), ("later", {}))
    out = await jobs.run_platform_checks(0.03)
    assert steps == ["slow"] and out["skipped"] == ["late", "later"]
    assert out["complete"] is False and out["ok"] is True
    assert recorded.await_args.args[1]["status"] == "partial" and "not reached: late, later" in recorded.await_args.args[1]["detail"]


async def test_a_step_that_fails_is_reported_and_does_not_stop_the_others(run):
    install, raw, recorded = run
    steps = install(("one", {}), ("broken", {"fail": True}), ("three", {}))
    out = await jobs.run_platform_checks(30)
    assert steps == ["one", "broken", "three"]
    assert out["ok"] is False and out["steps"]["broken"] == {"error": "RuntimeError"} and out["steps"]["three"] == {"ran": "three"}
    assert recorded.await_args.args[1]["status"] == "failed"


async def test_running_it_twice_is_the_same_as_running_it_once(monkeypatch):
    alert = AsyncMock(return_value=False)
    monkeypatch.setattr(alerts_service, "alert_owners", alert)
    monkeypatch.setattr(alerts_service, "budget_threshold", AsyncMock())
    monkeypatch.setattr(platform_service, "failed_emails_last_day", AsyncMock(return_value=[]))
    monkeypatch.setattr(platform_service, "invalidate_console_cache", AsyncMock())
    monkeypatch.setattr(workspace_service, "record_platform_cron_run", AsyncMock())
    raw = Raw(
        [company("cmp_a", used=3), company("cmp_b")], files=[{"_id": "cmp_a", "bytes": 4096}],
        clients=[a_client(max_storage_mb=1, monthly_ai_budget_usd=10)], ledger=[{"_id": "cmp_b", "cost": 8.5}],
    )
    monkeypatch.setattr(jobs, "get_platform_db", lambda: raw)
    first = await jobs.run_platform_checks(30)
    after_first = [dict(c["usage"]) for c in raw.companies.docs]
    second = await jobs.run_platform_checks(30)
    assert first["ok"] and second["ok"] and first["complete"] and second["complete"]
    assert [c["usage"]["storage_bytes"] for c in raw.companies.docs] == [4096, 0]
    assert [u["storage_bytes"] for u in after_first] == [4096, 0]
    assert second["steps"]["storage_reconcile"]["drifted"] == 0


async def test_without_a_database_the_run_says_so_instead_of_raising(monkeypatch):
    monkeypatch.setattr(jobs, "get_platform_db", lambda: None)
    out = await jobs.run_platform_checks(30)
    assert out["ok"] is False and out["complete"] is False and out["error"] == "database unavailable"
    assert out["skipped"] == [name for name, _ in jobs.STEPS]


async def test_a_directory_that_cannot_be_read_fails_the_run_quietly(monkeypatch):
    class Broken(Raw):
        def __init__(self):
            super().__init__([], clients=[])

            class Boom:
                def find(_, *a, **k):
                    raise RuntimeError("down")

            self.companies = Boom()

    monkeypatch.setattr(jobs, "get_platform_db", lambda: Broken())
    out = await jobs.run_platform_checks(30)
    assert out["ok"] is False and out["error"] == "RuntimeError" and out["steps"] == {}
