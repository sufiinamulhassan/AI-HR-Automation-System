from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from fastapi.routing import APIRoute

from config.tenancy import company_context
from main import app
from services.hr_module import plan_service, workspace_service

pytestmark = pytest.mark.anyio

NOW = datetime(2026, 10, 12, 9, 0, tzinfo=timezone.utc)
ALL_ON = {flag: True for flag in plan_service.FEATURES}


def test_standard_is_the_default_everything_on_with_no_limits_and_no_price():
    standard = plan_service.tier_plan("standard")
    assert standard == {
        "name": "standard", "max_companies": None, "max_users_per_company": None,
        "monthly_ai_budget_usd": None, "max_storage_mb": None, "features": ALL_ON,
        "price_monthly_usd": None, "trial_ends_at": None,
    }
    assert plan_service.DEFAULT_TIER == "standard"
    assert plan_service.resolve_plan(None) == standard
    assert list(plan_service.TIERS) == ["standard", "starter", "growth", "max", "enterprise"]


def test_every_tier_is_a_complete_plan_with_every_flag():
    for name in plan_service.TIERS:
        plan = plan_service.tier_plan(name)
        assert set(plan) == set(plan_service.PLAN_KEYS), name
        assert set(plan["features"]) == set(plan_service.FEATURES), name
        assert all(isinstance(on, bool) for on in plan["features"].values())
        assert plan["name"] == name and plan["trial_ends_at"] is None


def test_the_paid_tiers_grow_in_limits_features_and_price():
    starter, growth, top, enterprise = (plan_service.tier_plan(n) for n in ("starter", "growth", "max", "enterprise"))
    for key in ("max_users_per_company", "monthly_ai_budget_usd", "max_storage_mb", "price_monthly_usd"):
        assert 0 < starter[key] < growth[key] < top[key], key
    assert starter["max_companies"] < growth["max_companies"] < top["max_companies"] < enterprise["max_companies"]
    assert enterprise["price_monthly_usd"] is None and enterprise["monthly_ai_budget_usd"] is None
    on = lambda plan: {f for f, v in plan["features"].items() if v}
    assert on(starter) < on(growth) < on(top) < on(enterprise)
    assert on(enterprise) == set(plan_service.FEATURES)
    assert all(plan["features"]["coding"] for plan in (starter, growth, top, enterprise))


def test_a_tier_is_a_copy_so_editing_it_never_changes_the_catalog():
    plan = plan_service.tier_plan("growth")
    plan["features"]["coding"] = False
    plan["max_users_per_company"] = 1
    assert plan_service.tier_plan("growth")["features"]["coding"] is True
    assert plan_service.tier_plan("growth")["max_users_per_company"] == 25


def test_the_catalog_lists_every_tier_and_every_switch_with_a_label():
    catalog = plan_service.tier_catalog()
    assert [t["tier"] for t in catalog] == list(plan_service.TIERS)
    assert all(set(t) == {"tier", "label", "plan"} and t["label"] for t in catalog)
    features = plan_service.feature_catalog()
    assert [f["key"] for f in features] == list(plan_service.FEATURES)
    assert all(f["label"] and "." not in f["label"] for f in features)


def test_an_unknown_tier_is_refused():
    with pytest.raises(plan_service.PlanError) as bad:
        plan_service.tier_plan("platinum")
    assert "platinum" in str(bad.value)


def test_a_tier_replaces_the_plan_and_the_fields_sent_with_it_override_the_preset():
    plan = plan_service.merge_plan(None, {"tier": "growth"})
    assert plan == plan_service.tier_plan("growth")
    tuned = plan_service.merge_plan(None, {"tier": "growth", "max_users_per_company": 12, "name": "Growth plus", "features": {"webhooks": False}})
    assert tuned["max_users_per_company"] == 12 and tuned["name"] == "Growth plus"
    assert tuned["features"]["webhooks"] is False and tuned["features"]["coding"] is True
    assert tuned["monthly_ai_budget_usd"] == 70.0


def test_applying_a_tier_keeps_the_trial_the_client_already_has():
    current = plan_service.merge_plan(None, {"trial_ends_at": "2026-11-30"})
    after = plan_service.merge_plan(current, {"tier": "starter"})
    assert after["name"] == "starter" and after["trial_ends_at"] == current["trial_ends_at"] != None


def test_a_plain_patch_changes_only_what_it_sends():
    base = plan_service.merge_plan(None, {"tier": "growth"})
    patched = plan_service.merge_plan(base, {"max_companies": 7})
    assert patched["max_companies"] == 7
    assert {k: v for k, v in patched.items() if k != "max_companies"} == {k: v for k, v in base.items() if k != "max_companies"}
    renamed = plan_service.merge_plan(base, {"name": "enterprise"})
    assert renamed["name"] == "enterprise" and renamed["max_users_per_company"] == base["max_users_per_company"]


def test_null_clears_a_limit_a_blank_name_is_ignored_and_unknown_keys_are_dropped():
    base = plan_service.merge_plan(None, {"tier": "starter"})
    cleared = plan_service.merge_plan(base, {"max_storage_mb": None, "price_monthly_usd": None, "name": "   ", "bogus": 1})
    assert cleared["max_storage_mb"] is None and cleared["price_monthly_usd"] is None
    assert cleared["name"] == "starter" and "bogus" not in cleared


def test_features_merge_flag_by_flag():
    plan = plan_service.merge_plan(None, {"features": {"coding": False}})
    assert plan["features"] == {**ALL_ON, "coding": False}
    again = plan_service.merge_plan(plan, {"features": {"workflows": False, "coding": True}})
    assert again["features"] == {**ALL_ON, "workflows": False}
    assert plan_service.merge_plan(again, {"features": None})["features"] == again["features"]


@pytest.mark.parametrize("patch", [
    {"tier": "platinum"},
    {"features": {"teleport": False}},
    {"features": {"coding": "yes"}},
    {"features": ["coding"]},
    {"max_users_per_company": -1},
    {"monthly_ai_budget_usd": True},
    {"max_storage_mb": "lots"},
    {"price_monthly_usd": -5},
    {"trial_ends_at": "next tuesday"},
])
def test_a_plan_that_cannot_be_kept_is_refused_with_a_sentence(patch):
    with pytest.raises(plan_service.PlanError) as bad:
        plan_service.merge_plan(None, patch)
    assert str(bad.value).endswith(".") and chr(0x2014) not in str(bad.value)


def test_a_plan_saved_before_the_new_fields_existed_is_filled_in():
    old = {"name": "pro", "max_companies": 3, "max_users_per_company": None, "monthly_ai_budget_usd": 50}
    full = plan_service.resolve_plan(old)
    assert full["name"] == "pro" and full["max_companies"] == 3 and full["monthly_ai_budget_usd"] == 50
    assert full["max_storage_mb"] is None and full["price_monthly_usd"] is None and full["trial_ends_at"] is None
    assert full["features"] == ALL_ON
    assert set(full) == set(plan_service.PLAN_KEYS)


def test_dates_are_read_as_utc_and_a_bare_date_ends_at_the_end_of_that_day():
    assert plan_service.parse_instant("2026-11-30") == datetime(2026, 11, 30, 23, 59, 59, tzinfo=timezone.utc)
    assert plan_service.parse_instant("2026-11-30T08:00:00Z") == datetime(2026, 11, 30, 8, tzinfo=timezone.utc)
    assert plan_service.parse_instant("2026-11-30T08:00:00+02:00") == datetime(2026, 11, 30, 6, tzinfo=timezone.utc)
    assert plan_service.parse_instant(datetime(2026, 1, 2, 3)) == datetime(2026, 1, 2, 3, tzinfo=timezone.utc)
    for blank in (None, "", "   ", "soon", "2026-13-40"):
        assert plan_service.parse_instant(blank) is None
    assert plan_service.normalize_instant(None) is None and plan_service.normalize_instant("  ") is None
    assert plan_service.normalize_instant("2026-11-30") == "2026-11-30T23:59:59+00:00"


def _company(features=None, **plan):
    return {"company_id": "cmp_x", "client_plan": {**plan, **({"features": features} if features is not None else {})}}


def test_a_missing_flag_is_on_and_only_false_turns_a_feature_off():
    with company_context("cmp_x", _company()):
        assert plan_service.feature_enabled("webhooks") is True
    with company_context("cmp_x", {"company_id": "cmp_x"}):
        assert plan_service.feature_enabled("webhooks") is True
    with company_context("cmp_x", _company({"webhooks": False, "coding": True})):
        assert plan_service.feature_enabled("webhooks") is False
        assert plan_service.feature_enabled("coding") is True
        assert plan_service.feature_enabled("workflows") is True
        assert plan_service.feature_flags() == {**ALL_ON, "webhooks": False}
    assert plan_service.feature_enabled("webhooks", _company({"webhooks": False})) is False


async def test_the_gate_answers_402_in_a_plain_sentence_for_a_feature_the_plan_lacks():
    gate = plan_service.require_feature("performance")
    assert gate.plan_feature == "performance"
    with company_context("cmp_x", _company({"performance": False})):
        with pytest.raises(HTTPException) as refused:
            await gate({"email": "a@b.test"})
    assert refused.value.status_code == 402
    assert refused.value.detail == "Your plan does not include performance reviews."
    with company_context("cmp_x", _company()):
        assert await gate({"email": "a@b.test"}) is None


def _routes():
    for route in app.routes:
        if isinstance(route, APIRoute):
            yield route.path, route
        elif hasattr(route, "original_router"):
            prefix = route.include_context.prefix
            for inner in route.original_router.routes:
                if isinstance(inner, APIRoute):
                    yield prefix + inner.path, inner


def _gates(route):
    return {getattr(sub.call, "plan_feature", None) for sub in route.dependant.dependencies} - {None}


PUBLIC_PERFORMANCE = {
    "/api/v1/performance/rating-config",
    "/api/v1/performance/public/{secure_token}",
    "/api/v1/performance/public/{secure_token}/submit",
    "/api/v1/performance/public/{secure_token}/goals/{goal_id}",
}


def test_every_admin_route_of_a_gated_feature_carries_its_gate_and_no_public_link_does():
    seen = {"performance": 0, "webhooks": 0, "workflows": 0}
    for path, route in _routes():
        for prefix, flag in (("/api/v1/performance", "performance"), ("/api/v1/webhooks", "webhooks"), ("/api/v1/workflows", "workflows")):
            if not path.startswith(prefix):
                continue
            if path in PUBLIC_PERFORMANCE:
                assert not _gates(route), f"{path} is a public link and must never be gated by the plan"
            else:
                assert _gates(route) == {flag}, f"{sorted(route.methods)} {path} should carry require_feature({flag!r})"
                seen[flag] += 1
    assert seen["performance"] >= 20 and seen["webhooks"] >= 8 and seen["workflows"] >= 6, seen


def test_the_gate_runs_after_the_role_and_permission_checks():
    checks = {"require_admin", "require_superadmin", "_check_permission", "_check_any_permission", "get_current_user"}
    for path, route in _routes():
        if not _gates(route) or not path.startswith(("/api/v1/performance", "/api/v1/webhooks", "/api/v1/workflows")):
            continue
        calls = [sub.call for sub in route.dependant.dependencies]
        gate_at = next(i for i, c in enumerate(calls) if getattr(c, "plan_feature", None))
        before = {getattr(c, "__name__", "") for c in calls[:gate_at]}
        assert before & checks or path.startswith("/api/v1/webhooks"), f"{path}: a role check must come first"
        assert gate_at == len(calls) - 1 or path.startswith("/api/v1/webhooks"), path


def _blocked(*, plan=None, subscription=None, **company):
    return workspace_service.blocked_reason(
        {"status": "active", "client_status": "active", "client_plan": plan or {}, "client_subscription": subscription or {}, **company},
        now=NOW,
    )


def test_a_client_with_no_trial_and_no_subscription_is_never_blocked():
    assert _blocked() is None
    assert _blocked(subscription={"status": "none"}) is None
    assert _blocked(plan={"trial_ends_at": None}, subscription={"status": "none"}) is None


def test_a_trial_that_has_ended_blocks_unless_the_client_subscribed():
    past = (NOW - timedelta(seconds=1)).isoformat()
    future = (NOW + timedelta(days=2)).isoformat()
    ended = "This workspace's trial has ended. Ask your administrator to subscribe."
    assert _blocked(plan={"trial_ends_at": past}) == ended
    assert _blocked(plan={"trial_ends_at": past}, subscription={"status": "trialing"}) == ended
    assert _blocked(plan={"trial_ends_at": past}, subscription={"status": "past_due"}) == ended
    assert _blocked(plan={"trial_ends_at": past}, subscription={"status": "active"}) is None
    assert _blocked(plan={"trial_ends_at": future}, subscription={"status": "trialing"}) is None
    assert _blocked(plan={"trial_ends_at": NOW.isoformat()}) == ended


def test_a_canceled_subscription_blocks_with_its_own_message():
    ended = "This workspace's subscription has ended. Ask your administrator to renew."
    assert _blocked(subscription={"status": "canceled"}) == ended
    assert _blocked(plan={"trial_ends_at": (NOW + timedelta(days=9)).isoformat()}, subscription={"status": "canceled"}) == ended
    assert _blocked(subscription={"status": "past_due"}) is None


def test_a_billing_block_is_not_a_suspension_and_a_suspension_comes_first():
    trial = _blocked(plan={"trial_ends_at": "2020-01-01T00:00:00+00:00"})
    suspended = _blocked(status="suspended", plan={"trial_ends_at": "2020-01-01T00:00:00+00:00"})
    assert suspended == workspace_service.SUSPENDED_MESSAGE
    assert trial != suspended and "suspended" not in trial.lower()
    assert trial.startswith("This workspace's trial") and chr(0x2014) not in trial
    assert _blocked(client_status="suspended", subscription={"status": "canceled"}) == workspace_service.SUSPENDED_MESSAGE


def test_the_internal_platform_workspace_is_never_blocked_for_billing_and_no_workspace_is_still_refused():
    assert _blocked(kind="platform", subscription={"status": "canceled"}) is None
    assert "not attached" in workspace_service.blocked_reason(None)


def test_the_block_reads_the_clock_at_call_time_by_default():
    long_ago = {"client_plan": {"trial_ends_at": "2020-01-01T00:00:00+00:00"}, "client_subscription": {}}
    assert workspace_service.blocked_reason(long_ago) == plan_service.TRIAL_ENDED_MESSAGE
    assert plan_service.subscription_block_reason({"trial_ends_at": "2999-01-01T00:00:00+00:00"}, {}) is None


def test_a_subscription_is_filled_in_with_defaults_and_cleaned():
    assert plan_service.resolve_subscription(None) == {
        "status": "none", "provider": "manual", "customer_id": None, "subscription_id": None,
        "current_period_end": None, "cancel_at_period_end": False,
    }
    stored = {"status": "active", "provider": "stripe", "customer_id": "cus_1", "subscription_id": "sub_1",
              "current_period_end": "2026-11-12T00:00:00+00:00", "cancel_at_period_end": True, "secret": "x"}
    assert plan_service.resolve_subscription(stored)["customer_id"] == "cus_1"
    assert "secret" not in plan_service.resolve_subscription(stored)
    assert plan_service.resolve_subscription({"status": "weird"})["status"] == "none"


def test_a_company_is_told_its_billing_state_and_not_the_providers_ids():
    company = {"client_plan": {"trial_ends_at": "2026-10-20T00:00:00+00:00"},
               "client_subscription": {"status": "trialing", "customer_id": "cus_1", "subscription_id": "sub_1"}}
    summary = plan_service.subscription_summary(company)
    assert summary == {"status": "trialing", "trial_ends_at": "2026-10-20T00:00:00+00:00",
                       "current_period_end": None, "cancel_at_period_end": False}


MB = 1024 * 1024


def _stored(bytes_, limit):
    return {"company_id": "cmp_x", "client_plan": {"max_storage_mb": limit} if limit is not None else {}, "usage": {"storage_bytes": bytes_}}


def test_storage_is_the_counter_on_the_company_against_the_plans_cap():
    company = _stored(MB // 2, 4)
    assert plan_service.storage_summary(company) == {"used_mb": 0.5, "limit_mb": 4}
    assert plan_service.storage_used_bytes({"company_id": "cmp_x"}) == 0
    assert plan_service.storage_summary({"company_id": "cmp_x"}) == {"used_mb": 0.0, "limit_mb": None}
    assert plan_service.storage_used_bytes(_stored(-5, 1)) == 0


def test_a_file_that_would_pass_the_cap_is_refused_and_one_that_fits_exactly_is_not():
    company = _stored(3 * MB, 4)
    assert plan_service.storage_would_overflow(MB, company) is False
    assert plan_service.storage_would_overflow(MB + 1, company) is True
    assert plan_service.storage_would_overflow(0, company) is False
    assert plan_service.storage_would_overflow(10 * MB, _stored(10 * MB, None)) is False
    assert plan_service.storage_would_overflow(1, _stored(0, 0)) is False


async def test_the_upload_check_answers_413_in_a_sentence_before_anything_is_stored():
    with company_context("cmp_x", _stored(MB - 10, 1)):
        await plan_service.ensure_storage_available(10)
        with pytest.raises(HTTPException) as full:
            await plan_service.ensure_storage_available(11)
    assert full.value.status_code == 413
    assert full.value.detail.startswith("Your plan's storage is full")
    assert "1 MB" in full.value.detail and chr(0x2014) not in full.value.detail
    with company_context("cmp_x", _stored(50 * MB, None)):
        await plan_service.ensure_storage_available(10 * MB)


async def test_a_counter_update_goes_to_the_bound_company_and_never_fails_the_caller(monkeypatch):
    adjust = AsyncMock()
    monkeypatch.setattr(workspace_service, "adjust_storage_bytes", adjust)
    with company_context("cmp_x", {"company_id": "cmp_x"}):
        await plan_service.record_stored_bytes(1234)
        await plan_service.record_stored_bytes(-99)
        await plan_service.record_stored_bytes(0)
    assert [c.args for c in adjust.await_args_list] == [("cmp_x", 1234), ("cmp_x", -99)]
    adjust.side_effect = RuntimeError("database gone")
    with company_context("cmp_x", {"company_id": "cmp_x"}):
        await plan_service.record_stored_bytes(5)


async def test_what_a_delete_frees_is_measured_with_one_aggregate_and_a_failure_counts_as_zero():
    collection = MagicMock()
    collection.aggregate.return_value.to_list = AsyncMock(return_value=[{"_id": None, "bytes": 4096}])
    assert await plan_service.stored_bytes(collection, {"resume_id": {"$in": ["a", "b"]}}) == 4096
    stages = collection.aggregate.call_args.args[0]
    assert stages[0] == {"$match": {"resume_id": {"$in": ["a", "b"]}}}
    assert stages[1]["$group"]["bytes"] == {"$sum": {"$bsonSize": "$$ROOT"}}
    collection.aggregate.return_value.to_list = AsyncMock(return_value=[])
    assert await plan_service.stored_bytes(collection, {}) == 0
    collection.aggregate.side_effect = RuntimeError("no $bsonSize here")
    assert await plan_service.stored_bytes(collection, {}) == 0


async def test_the_counter_is_moved_with_an_update_pipeline_that_cannot_go_below_zero(monkeypatch):
    calls = []

    class Companies:
        async def update_one(self, flt, update):
            calls.append((flt, update))

    class Raw:
        companies = Companies()

    monkeypatch.setattr(workspace_service, "get_platform_db", lambda: Raw())
    await workspace_service.adjust_storage_bytes("cmp_x", -500)
    await workspace_service.adjust_storage_bytes("cmp_x", 0)
    assert len(calls) == 1
    flt, update = calls[0]
    assert flt == {"company_id": "cmp_x"}
    stage = update[0]["$set"]["usage.storage_bytes"]
    assert stage == {"$max": [0, {"$add": [{"$ifNull": ["$usage.storage_bytes", 0]}, -500]}]}


def test_the_budget_has_two_lines_eighty_percent_and_all_of_it():
    assert plan_service.budget_band(7.99, 10) == 0
    assert plan_service.budget_band(8.0, 10) == 80
    assert plan_service.budget_band(9.99, 10) == 80
    assert plan_service.budget_band(10.0, 10) == 100
    assert plan_service.budget_band(50, 10) == 100
    assert plan_service.budget_band(5, 0) == 0 and plan_service.budget_band(5, None) == 0


@pytest.fixture
def told(monkeypatch):
    from services.hr_module import alerts_service

    calls = AsyncMock()
    monkeypatch.setattr(alerts_service, "budget_threshold", calls)
    return calls


async def test_crossing_eighty_percent_tells_once_and_lets_the_action_through(monkeypatch, told):
    monkeypatch.setattr(plan_service, "month_ai_spend", AsyncMock(return_value=8.5))
    with company_context("cmp_x", _company(monthly_ai_budget_usd=10)):
        await plan_service.ensure_ai_budget()
    told.assert_awaited_once()
    args = told.await_args.args
    assert args[0] == "cmp_x" and args[1] == 80 and args[2] == 8.5 and args[3] == 10.0 and len(args[4]) == 7


async def test_reaching_the_budget_tells_and_then_refuses(monkeypatch, told):
    monkeypatch.setattr(plan_service, "month_ai_spend", AsyncMock(return_value=10.0))
    with company_context("cmp_x", _company(monthly_ai_budget_usd=10)):
        with pytest.raises(HTTPException) as over:
            await plan_service.ensure_ai_budget()
    assert over.value.status_code == 402
    assert told.await_args.args[1] == 100


async def test_a_company_already_told_about_a_band_this_month_costs_no_extra_work(monkeypatch, told):
    monkeypatch.setattr(plan_service, "month_ai_spend", AsyncMock(return_value=8.5))
    month = plan_service.month_label()
    told_80 = {**_company(monthly_ai_budget_usd=10), "usage": {"ai_alert": {"month": month, "band": 80}}}
    with company_context("cmp_x", told_80):
        await plan_service.ensure_ai_budget()
    told.assert_not_awaited()
    monkeypatch.setattr(plan_service, "month_ai_spend", AsyncMock(return_value=10.5))
    with company_context("cmp_x", told_80), pytest.raises(HTTPException):
        await plan_service.ensure_ai_budget()
    assert told.await_args.args[1] == 100
    told.reset_mock()
    monkeypatch.setattr(plan_service, "month_ai_spend", AsyncMock(return_value=8.5))
    last_month = {**_company(monthly_ai_budget_usd=10), "usage": {"ai_alert": {"month": "2020-01", "band": 100}}}
    with company_context("cmp_x", last_month):
        await plan_service.ensure_ai_budget()
    told.assert_awaited_once()


async def test_below_the_line_and_without_a_budget_nobody_is_told_and_nothing_is_queried(monkeypatch, told):
    spend = AsyncMock(return_value=2.0)
    monkeypatch.setattr(plan_service, "month_ai_spend", spend)
    with company_context("cmp_x", _company(monthly_ai_budget_usd=10)):
        await plan_service.ensure_ai_budget()
    told.assert_not_awaited()
    spend.reset_mock()
    with company_context("cmp_x", _company()):
        await plan_service.ensure_ai_budget()
    spend.assert_not_awaited()
    told.assert_not_awaited()


async def test_a_notice_that_fails_never_blocks_or_breaks_the_action(monkeypatch, told):
    told.side_effect = RuntimeError("mail host down")
    monkeypatch.setattr(plan_service, "month_ai_spend", AsyncMock(return_value=9.0))
    with company_context("cmp_x", _company(monthly_ai_budget_usd=10)):
        await plan_service.ensure_ai_budget()


async def test_the_company_view_carries_storage_features_and_billing_state(monkeypatch):
    monkeypatch.setattr(plan_service, "month_ai_spend", AsyncMock(return_value=1.0))
    monkeypatch.setattr(plan_service, "active_users", AsyncMock(return_value=3))
    monkeypatch.setattr(plan_service, "emails_sent_recently", AsyncMock(return_value=7))
    company = {
        "company_id": "cmp_x", "usage": {"storage_bytes": 3 * MB},
        "client_plan": {"name": "growth", "max_users_per_company": 25, "monthly_ai_budget_usd": 150, "max_storage_mb": 10,
                        "features": {"webhooks": False}},
        "client_subscription": {"status": "active", "customer_id": "cus_1"},
    }
    with company_context("cmp_x", company):
        body = await plan_service.company_usage(NOW)
    assert set(body) == {"plan", "users", "ai", "emails_30d", "storage", "features", "subscription"}
    assert body["plan"] == {"name": "growth", "max_users_per_company": 25, "monthly_ai_budget_usd": 150}
    assert body["storage"] == {"used_mb": 3.0, "limit_mb": 10}
    assert body["features"] == {**ALL_ON, "webhooks": False}
    assert body["subscription"]["status"] == "active" and "customer_id" not in body["subscription"]
    assert body["emails_30d"] == 7 and body["ai"]["percent"] == pytest.approx(0.7)


class _Rows:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, *args, **kwargs):
        return self

    def __aiter__(self):
        async def walk():
            for row in self.rows:
                yield dict(row)

        return walk()


async def test_scheduled_work_runs_for_active_clients_and_skips_suspended_or_billing_blocked_ones(monkeypatch):
    past, future = "2020-01-01T00:00:00+00:00", "2999-01-01T00:00:00+00:00"
    clients = [
        {"client_id": "cli_ok", "status": "active"},
        {"client_id": "cli_suspended", "status": "suspended"},
        {"client_id": "cli_trial_over", "status": "active", "plan": {"trial_ends_at": past}, "subscription": {"status": "trialing"}},
        {"client_id": "cli_trial_on", "status": "active", "plan": {"trial_ends_at": future}, "subscription": {"status": "trialing"}},
        {"client_id": "cli_subscribed", "status": "active", "plan": {"trial_ends_at": past}, "subscription": {"status": "active"}},
        {"client_id": "cli_canceled", "status": "active", "subscription": {"status": "canceled"}},
        {"client_id": "cli_past_due", "status": "active", "subscription": {"status": "past_due"}},
    ]
    companies = [{"company_id": f"cmp_{c['client_id'][4:]}", "client_id": c["client_id"], "status": "active"} for c in clients]

    class Clients:
        def find(self, flt, projection=None):
            return _Rows(clients)

    class Companies:
        def find(self, flt):
            banned = set(flt["client_id"]["$nin"])
            return _Rows([c for c in companies if c["client_id"] not in banned])

    class Raw:
        pass

    raw = Raw()
    raw.clients, raw.companies = Clients(), Companies()
    monkeypatch.setattr(workspace_service, "get_platform_db", lambda: raw)
    served = [c["company_id"] for c in await workspace_service.list_active_companies()]
    assert sorted(served) == ["cmp_ok", "cmp_past_due", "cmp_subscribed", "cmp_trial_on"]
