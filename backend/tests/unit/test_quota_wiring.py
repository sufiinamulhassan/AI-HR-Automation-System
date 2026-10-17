from unittest.mock import AsyncMock

import pytest
from fastapi.routing import APIRoute

from config.tenancy import company_context
from main import app
from shared import quotas

pytestmark = pytest.mark.anyio

GUARDED = {
    ("POST", "/api/v1/resumes/upload"): "resumes",
    ("POST", "/api/v1/intel/resumes/upload-bulk"): "resumes",
    ("POST", "/api/v1/jobs"): "jobs",
    ("POST", "/api/v1/jobs/rematch-all"): "jobs",
    ("POST", "/api/v1/jobs/import"): "jobs",
    ("POST", "/api/v1/jobs/scheduled-sync"): "jobs",
    ("POST", "/api/v1/candidates/{candidate_id}/interview-guide"): "guide",
    ("POST", "/api/v1/offers/{offer_id}/draft-letter"): "offer_draft",
    ("POST", "/api/v1/coding/questions/generate"): "coding_generate",
    ("POST", "/api/v1/jobs/{job_id}/pipeline/{resume_id}/fit/ai-opinion"): "fit_opinion",
    ("POST", "/api/v1/candidates/{candidate_id}/external-review/draft-summary"): "review_summary",
    ("POST", "/api/v1/model-tasks/embedding/reindex"): "embedding_reindex",
    ("GET", "/api/v1/resumes/search/semantic"): "resume_semantic_search",
}

OPEN_TO_EVERY_USER = {("GET", "/api/v1/resumes/search/semantic")}


def _routes():
    for route in app.routes:
        if isinstance(route, APIRoute):
            yield route.path, route
        elif hasattr(route, "original_router"):
            prefix = route.include_context.prefix
            for inner in route.original_router.routes:
                if isinstance(inner, APIRoute):
                    yield prefix + inner.path, inner


def _dependency_calls(dependant):
    for sub in dependant.dependencies:
        yield sub.call
        yield from _dependency_calls(sub)


def _guarded_routes() -> dict:
    found = {}
    for path, route in _routes():
        scopes = {getattr(c, "quota_scope", None) for c in _dependency_calls(route.dependant)} - {None}
        for method in route.methods - {"HEAD", "OPTIONS"}:
            if scopes:
                found[(method, path)] = scopes
    return found


def test_every_admin_started_ai_action_carries_the_guard_with_its_scope():
    found = _guarded_routes()
    for key, scope in GUARDED.items():
        assert found.get(key) == {scope}, f"{key} should carry ai_action({scope!r}): {found.get(key)}"


def test_no_other_route_carries_the_guard():
    stray = sorted(set(_guarded_routes()) - set(GUARDED))
    assert not stray, (
        "These routes carry ai_action but are not in GUARDED. If one really is an admin-started AI "
        f"action, list it here with its scope; otherwise take the guard off: {stray}"
    )


def test_a_route_reached_through_a_public_link_never_carries_the_guard():
    offenders = []
    for path, route in _routes():
        calls = list(_dependency_calls(route.dependant))
        public = any(getattr(c, "tenant_kind", None) for c in calls)
        guarded = any(getattr(c, "quota_scope", None) for c in calls)
        if public and guarded:
            offenders.append(path)
    assert not offenders, offenders


def test_the_candidate_interview_flow_is_never_guarded():
    flow = [path for path, _ in _routes() if path.startswith("/api/v1/interview")]
    assert flow, "the interview routes should exist"
    assert not [key for key in _guarded_routes() if key[1].startswith("/api/v1/interview")]


def test_the_role_and_permission_checks_run_before_the_guard():
    checks = {"require_admin", "require_superadmin", "_check_permission"}
    for (method, path), scope in GUARDED.items():
        route = next(r for p, r in _routes() if p == path and method in r.methods)
        calls = [sub.call for sub in route.dependant.dependencies]
        position = next(i for i, c in enumerate(calls) if getattr(c, "quota_scope", None) == scope)
        before = {getattr(c, "__name__", "") for c in calls[:position]}
        if (method, path) not in OPEN_TO_EVERY_USER:
            assert before & checks, f"{method} {path}: a role check must come before the guard"
        assert position == len(calls) - 1, f"{method} {path}: the guard should be the last dependency"


def test_each_scope_has_a_positive_hourly_limit_and_the_same_scope_the_same_limit():
    limits: dict[str, set] = {}
    for path, route in _routes():
        for call in _dependency_calls(route.dependant):
            scope = getattr(call, "quota_scope", None)
            if scope:
                per_hour = call.quota_per_hour
                assert isinstance(per_hour, int) and per_hour > 0, (path, per_hour)
                limits.setdefault(scope, set()).add(per_hour)
    assert limits and all(len(values) == 1 for values in limits.values()), limits


async def test_the_guard_counts_the_action_for_this_company_then_checks_the_budget(monkeypatch):
    order = []
    limiter = AsyncMock(side_effect=lambda *a, **k: order.append(("limit", k)))
    budget = AsyncMock(side_effect=lambda: order.append(("budget", None)))
    monkeypatch.setattr(quotas, "enforce_rate_limit", limiter)
    monkeypatch.setattr(quotas.plan_service, "ensure_ai_budget", budget)
    monkeypatch.setattr(quotas, "get_db", lambda: "db")
    with company_context("cmp_quota_a"):
        await quotas.check_ai_action("jobs", per_hour=300)
    assert [name for name, _ in order] == ["limit", "budget"]
    kwargs = order[0][1]
    assert kwargs["key"] == "co:cmp_quota_a:jobs" and kwargs["limit"] == 300 and kwargs["window_seconds"] == 3600
    limiter.assert_awaited_once()
    assert limiter.await_args.args == ("db",)


async def test_two_companies_never_share_a_counter(monkeypatch):
    keys = []
    monkeypatch.setattr(quotas, "enforce_rate_limit", AsyncMock(side_effect=lambda *a, **k: keys.append(k["key"])))
    monkeypatch.setattr(quotas.plan_service, "ensure_ai_budget", AsyncMock())
    monkeypatch.setattr(quotas, "get_db", lambda: "db")
    for company in ("cmp_quota_a", "cmp_quota_b"):
        with company_context(company):
            await quotas.check_ai_action("guide", per_hour=300)
    assert keys == ["co:cmp_quota_a:guide", "co:cmp_quota_b:guide"]


async def test_a_company_over_its_hourly_allowance_is_refused_before_the_budget_is_read(monkeypatch):
    from fastapi import HTTPException

    async def too_many(*args, **kwargs):
        raise HTTPException(429, "Too many attempts: please try again later")

    budget = AsyncMock()
    monkeypatch.setattr(quotas, "enforce_rate_limit", too_many)
    monkeypatch.setattr(quotas.plan_service, "ensure_ai_budget", budget)
    monkeypatch.setattr(quotas, "get_db", lambda: "db")
    with company_context("cmp_quota_a"):
        with pytest.raises(HTTPException) as refused:
            await quotas.check_ai_action("jobs", per_hour=1)
    assert refused.value.status_code == 429
    budget.assert_not_awaited()
