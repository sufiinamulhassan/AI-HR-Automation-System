import asyncio
import json
import sys
import types
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from fastapi.routing import APIRoute

from services.hr_module import cron_service, retention_service, workspace_service

pytestmark = pytest.mark.anyio

REPO = Path(__file__).resolve().parents[3]
SECRET_IN_ERROR = "hunter2-smtp-password"


@pytest.fixture
def two_companies(monkeypatch):
    companies = [
        {"company_id": "cmp_a", "name": "Alpha Ltd", "settings": {}},
        {"company_id": "cmp_b", "name": "Bravo Ltd", "settings": {}},
    ]

    async def listing():
        return [dict(c) for c in companies]

    monkeypatch.setattr(workspace_service, "list_active_companies", listing)
    monkeypatch.setattr(workspace_service, "mark_company_served", AsyncMock())
    monkeypatch.setattr(workspace_service, "record_platform_cron_run", AsyncMock())
    monkeypatch.setattr(cron_service, "get_db", lambda: None)
    return companies


def scripted(monkeypatch, events, *, fail=None, keys=None):
    from config.tenancy import current_company_id

    fail = fail or {}

    def make(key):
        async def runner():
            company = current_company_id()
            events.append((key, company))
            outcome = fail.get((key, company))
            if isinstance(outcome, Exception):
                raise outcome
            return outcome or ("ok", f"{key} done")
        return runner

    monkeypatch.setattr(cron_service, "_RUNNERS", {key: make(key) for key in (keys or cron_service.JOB_KEYS)})


def fake_module(monkeypatch, name, **attrs):
    module = types.ModuleType(name)
    for key, value in attrs.items():
        setattr(module, key, value)
    package, _, short = name.rpartition(".")
    monkeypatch.setitem(sys.modules, name, module)
    monkeypatch.setattr(sys.modules[package], short, module, raising=False)
    return module


def gone_module(monkeypatch, name):
    package, _, short = name.rpartition(".")
    monkeypatch.setitem(sys.modules, name, None)
    monkeypatch.delattr(sys.modules[package], short, raising=False)


def test_retention_is_a_job_with_a_runner_a_label_and_a_daily_share():
    assert [j["key"] for j in cron_service.JOBS] == ["reminders", "external_reminders", "job_sync", "retention"]
    assert cron_service.JOBS[-1]["label"] == "Data retention"
    assert set(cron_service._RUNNERS) == set(cron_service.JOB_KEYS)
    assert set(cron_service.DAILY_BUDGET_SECONDS) == set(cron_service.JOB_KEYS)
    for label in (j["label"] for j in cron_service.JOBS):
        assert "-" not in label


def test_the_daily_shares_and_the_platform_checks_fit_inside_the_function_limit():
    limit = json.loads((REPO / "vercel.json").read_text(encoding="utf-8"))["functions"]["api/index.py"]["maxDuration"]
    jobs = sum(cron_service.DAILY_BUDGET_SECONDS.values())
    assert jobs < 60 and jobs <= limit
    assert cron_service.DAILY_TOTAL_SECONDS < 60 and cron_service.DAILY_TOTAL_SECONDS <= limit
    assert jobs + cron_service.MIN_PLATFORM_CHECK_SECONDS <= cron_service.DAILY_TOTAL_SECONDS
    worst = jobs + min(cron_service.DAILY_TOTAL_SECONDS - jobs, cron_service.PLATFORM_CHECKS_BUDGET_SECONDS)
    assert worst <= cron_service.DAILY_TOTAL_SECONDS < 60


def test_retention_has_its_own_secret_gated_endpoint_like_the_other_jobs():
    from routes import cron

    routes = {r.path: r for r in cron.router.routes if isinstance(r, APIRoute)}
    assert {"/daily", "/reminders", "/external-reminders", "/job-sync", "/retention", "/status"} <= set(routes)
    assert routes["/retention"].methods == {"GET"}
    guards = [getattr(d.call, "__name__", "") for d in routes["/retention"].dependant.dependencies]
    assert "require_cron_secret" in guards
    assert routes["/retention"].endpoint.__name__ == "run_retention"


async def test_the_retention_endpoint_runs_the_retention_job_only(monkeypatch):
    from routes import cron

    seen = []

    async def fake_run_job(key, **kw):
        seen.append(key)
        return {"key": key}

    monkeypatch.setattr(cron_service, "run_job", fake_run_job)
    assert await cron.run_retention() == {"results": [{"key": "retention"}]} and seen == ["retention"]


def test_only_a_job_that_asks_for_a_budget_is_given_one():
    async def plain():
        return "ok", "x"

    async def asks(budget_seconds: float = 8.0):
        return "ok", "x"

    assert cron_service._accepts_budget(plain) is False and cron_service._accepts_budget(asks) is True
    assert cron_service._accepts_budget(cron_service._RUNNERS["retention"]) is True
    for key in ("reminders", "external_reminders", "job_sync"):
        assert cron_service._accepts_budget(cron_service._RUNNERS[key]) is False


async def test_the_retention_job_gets_its_companys_time_less_a_margin_and_reports_its_summary(two_companies, monkeypatch):
    budgets = []

    async def purge(budget_seconds):
        budgets.append(budget_seconds)
        return {"enabled": True, "complete": True, "candidates_erased": 2, "resumes_erased": 1, "vectors_failed": 0}

    monkeypatch.setattr(retention_service, "purge_company", purge)
    result = await cron_service.run_job("retention", budget_seconds=20)

    assert result["status"] == "ok" and result["companies"] == {"total": 2, "served": 2, "failed": 0}
    assert len(budgets) == 2 and all(15 < b < 20 for b in budgets)
    assert budgets[1] <= budgets[0]
    assert cron_service.RUNNER_MARGIN_SECONDS > 0


async def test_a_single_company_reads_exactly_as_its_own_result(two_companies, monkeypatch):
    two_companies.pop()

    async def purge(budget_seconds):
        return {"enabled": True, "complete": False, "candidates_erased": 4, "resumes_erased": 0, "vectors_failed": 0}

    monkeypatch.setattr(retention_service, "purge_company", purge)
    result = await cron_service.run_job("retention")
    assert result["detail"] == "Erased 4 candidate(s) and 0 resume(s). More are due; the next run continues."


async def test_a_retention_run_that_cannot_delete_vectors_is_an_error_for_that_company(two_companies, monkeypatch):
    two_companies.pop()

    async def purge(budget_seconds):
        return {"enabled": True, "complete": True, "candidates_erased": 1, "resumes_erased": 0, "vectors_failed": 3}

    alerts = []
    fake_module(monkeypatch, "services.hr_module.alerts_service", alert_owners=AsyncMock(side_effect=lambda *a, **k: alerts.append(a) or True))
    monkeypatch.setattr(retention_service, "purge_company", purge)
    result = await cron_service.run_job("retention")
    assert result["status"] == "error" and "3 search index record(s)" in result["detail"]
    assert alerts and alerts[0][0] == "cron-failed:retention:cmp_a"


async def test_the_daily_run_calls_the_platform_checks_once_after_every_job_with_the_time_left(two_companies, monkeypatch):
    events = []
    scripted(monkeypatch, events)

    async def run_platform_checks(budget_seconds):
        events.append(("platform", budget_seconds))
        return {"ok": True}

    fake_module(monkeypatch, "services.hr_module.platform_jobs", run_platform_checks=run_platform_checks)
    results = await cron_service.run_daily()

    assert [r["key"] for r in results] == ["reminders", "external_reminders", "job_sync", "retention"]
    platform = [e for e in events if e[0] == "platform"]
    assert len(platform) == 1 and events[-1] == platform[0]
    assert cron_service.MIN_PLATFORM_CHECK_SECONDS <= platform[0][1] <= cron_service.PLATFORM_CHECKS_BUDGET_SECONDS
    assert [e[0] for e in events[:-1]] == ["reminders"] * 2 + ["external_reminders"] * 2 + ["job_sync"] * 2 + ["retention"] * 2


async def test_a_single_job_run_does_not_run_the_platform_checks(two_companies, monkeypatch):
    events = []
    scripted(monkeypatch, events)
    fake_module(monkeypatch, "services.hr_module.platform_jobs", run_platform_checks=AsyncMock(side_effect=AssertionError("not here")))
    await cron_service.run_job("reminders")
    assert {e[0] for e in events} == {"reminders"}


async def test_a_missing_platform_jobs_module_changes_nothing(two_companies, monkeypatch):
    events = []
    scripted(monkeypatch, events)
    gone_module(monkeypatch, "services.hr_module.platform_jobs")
    results = await cron_service.run_daily()
    assert [r["status"] for r in results] == ["ok"] * 4


async def test_a_module_without_the_function_changes_nothing(two_companies, monkeypatch):
    scripted(monkeypatch, [])
    fake_module(monkeypatch, "services.hr_module.platform_jobs")
    assert [r["status"] for r in await cron_service.run_daily()] == ["ok"] * 4


async def test_platform_checks_that_raise_or_hang_never_change_the_jobs_results(two_companies, monkeypatch):
    scripted(monkeypatch, [])

    async def boom(budget_seconds):
        raise RuntimeError(SECRET_IN_ERROR)

    fake_module(monkeypatch, "services.hr_module.platform_jobs", run_platform_checks=boom)
    assert [r["status"] for r in await cron_service.run_daily()] == ["ok"] * 4

    async def hang(budget_seconds):
        await asyncio.sleep(30)

    fake_module(monkeypatch, "services.hr_module.platform_jobs", run_platform_checks=hang)
    monkeypatch.setattr(cron_service, "DAILY_TOTAL_SECONDS", 2.5)
    monkeypatch.setattr(cron_service, "MIN_PLATFORM_CHECK_SECONDS", 0.2)
    started = asyncio.get_event_loop().time()
    results = await cron_service.run_daily()
    assert [r["status"] for r in results] == ["ok"] * 4
    assert asyncio.get_event_loop().time() - started < 4


async def test_with_no_time_left_the_platform_checks_are_skipped(two_companies, monkeypatch):
    scripted(monkeypatch, [])
    called = AsyncMock()
    fake_module(monkeypatch, "services.hr_module.platform_jobs", run_platform_checks=called)
    monkeypatch.setattr(cron_service, "DAILY_TOTAL_SECONDS", 0.0)
    await cron_service.run_daily()
    called.assert_not_called()


def alert_recorder(monkeypatch, *, result=True, error=None, delay=0.0):
    calls = []

    async def alert_owners(key, subject, body, *, company_id=None, cooldown_hours=24):
        calls.append({"key": key, "subject": subject, "body": body, "company_id": company_id, "cooldown_hours": cooldown_hours})
        if delay:
            await asyncio.sleep(delay)
        if error:
            raise error
        return result

    fake_module(monkeypatch, "services.hr_module.alerts_service", alert_owners=alert_owners)
    return calls


async def test_a_job_that_fails_for_a_company_alerts_the_owners_once_for_that_company(two_companies, monkeypatch):
    scripted(monkeypatch, [], fail={("job_sync", "cmp_b"): RuntimeError(f"smtp login rejected: {SECRET_IN_ERROR} for jane@example.com")})
    calls = alert_recorder(monkeypatch)

    result = await cron_service.run_job("job_sync")

    assert result["status"] == "error" and result["companies"]["failed"] == 1
    assert len(calls) == 1
    call = calls[0]
    assert call["key"] == "cron-failed:job_sync:cmp_b" and call["company_id"] == "cmp_b"
    assert "Job source sync" in call["subject"] and call["cooldown_hours"] == 24
    text = call["subject"] + call["body"]
    assert "cmp_b" in text and "RuntimeError" in text
    for forbidden in (SECRET_IN_ERROR, "jane@example.com", "smtp login", "-"):
        assert forbidden not in text


async def test_a_job_that_ran_out_of_time_alerts_too(two_companies, monkeypatch):
    two_companies.pop()

    async def slow():
        await asyncio.sleep(5)
        return "ok", "never"

    monkeypatch.setattr(cron_service, "_RUNNERS", {**cron_service._RUNNERS, "reminders": slow})
    calls = alert_recorder(monkeypatch)
    result = await cron_service.run_job("reminders", budget_seconds=0.1)
    assert result["status"] == "error" and "Stopped after" in result["detail"]
    assert [c["key"] for c in calls] == ["cron-failed:reminders:cmp_a"] and "TimeoutError" in calls[0]["body"]


async def test_a_job_that_succeeds_alerts_nobody(two_companies, monkeypatch):
    scripted(monkeypatch, [])
    calls = alert_recorder(monkeypatch)
    await cron_service.run_job("reminders")
    assert calls == []


async def test_a_job_that_reports_an_error_status_alerts_without_an_exception_class(two_companies, monkeypatch):
    two_companies.pop()
    scripted(monkeypatch, [], fail={("reminders", "cmp_a"): ("error", "Sent 0 reminder(s), 2 could not be sent.")})
    calls = alert_recorder(monkeypatch)
    await cron_service.run_job("reminders")
    assert len(calls) == 1 and "It reported an error." in calls[0]["body"] and "could not be sent" not in calls[0]["body"]


@pytest.mark.parametrize("break_it", ["raises", "hangs", "missing", "no_function"])
async def test_a_broken_alert_never_changes_the_result_of_the_run(two_companies, monkeypatch, break_it):
    scripted(monkeypatch, [], fail={("job_sync", "cmp_a"): RuntimeError("down")})
    monkeypatch.setattr(cron_service, "ALERT_TIMEOUT_SECONDS", 0.05)
    if break_it == "raises":
        alert_recorder(monkeypatch, error=RuntimeError("mail is down"))
    elif break_it == "hangs":
        alert_recorder(monkeypatch, delay=10)
    elif break_it == "missing":
        gone_module(monkeypatch, "services.hr_module.alerts_service")
    else:
        fake_module(monkeypatch, "services.hr_module.alerts_service")

    started = asyncio.get_event_loop().time()
    result = await cron_service.run_job("job_sync")

    assert result["status"] == "error" and result["companies"] == {"total": 2, "served": 2, "failed": 1}
    assert result["detail"] == "Ran for 2 of 2 companies, 1 with an error."
    assert asyncio.get_event_loop().time() - started < 3
    assert workspace_service.mark_company_served.await_count == 2


async def test_the_alert_names_no_detail_of_the_failure(two_companies, monkeypatch):
    two_companies.pop()
    scripted(monkeypatch, [], fail={("reminders", "cmp_a"): ValueError("candidate Jane Doe <jane@example.com> has no token")})
    calls = alert_recorder(monkeypatch)
    result = await cron_service.run_job("reminders")
    assert "Jane" in result["detail"] or "ValueError" in result["detail"]
    assert "Jane" not in calls[0]["body"] and "jane@example.com" not in calls[0]["body"] and "ValueError" in calls[0]["body"]
