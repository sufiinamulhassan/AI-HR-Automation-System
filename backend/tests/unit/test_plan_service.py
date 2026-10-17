from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from config.tenancy import company_context
from services.hr_module import plan_service

pytestmark = pytest.mark.anyio


@pytest.fixture(autouse=True)
def _no_budget_notices(monkeypatch):
    monkeypatch.setattr(plan_service, "_tell_about_budget", AsyncMock())


def _company(**plan):
    return {"company_id": "cmp_x", "client_plan": plan}


def test_limits_read_the_bound_companys_plan_and_treat_blank_as_unlimited():
    with company_context("cmp_x", _company(name="pro", max_users_per_company=5, monthly_ai_budget_usd=20.5)):
        assert plan_service.limits() == {"name": "pro", "max_users_per_company": 5, "monthly_ai_budget_usd": 20.5}
    for blank in (None, 0, -3, "ten", True):
        with company_context("cmp_x", _company(max_users_per_company=blank, monthly_ai_budget_usd=blank)):
            assert plan_service.limits()["max_users_per_company"] is None
            assert plan_service.limits()["monthly_ai_budget_usd"] is None
    with company_context("cmp_x", {"company_id": "cmp_x"}):
        assert plan_service.limits()["max_users_per_company"] is None


def test_the_month_starts_at_midnight_on_the_first_utc():
    assert plan_service.month_start(datetime(2026, 10, 17, 13, 45, tzinfo=timezone.utc)) == datetime(2026, 10, 1, tzinfo=timezone.utc)


async def test_a_seat_is_refused_only_over_the_limit(monkeypatch):
    monkeypatch.setattr(plan_service, "active_users", AsyncMock(return_value=4))
    with company_context("cmp_x", _company(max_users_per_company=5)):
        await plan_service.ensure_seat_available()
        with pytest.raises(HTTPException) as over:
            await plan_service.ensure_seat_available(2)
    assert over.value.status_code == 409 and "at most 5 users" in over.value.detail
    with company_context("cmp_x", _company()):
        await plan_service.ensure_seat_available(1000)


async def test_the_budget_stops_admin_actions_at_the_limit_and_not_before(monkeypatch):
    spend = AsyncMock(return_value=19.99)
    monkeypatch.setattr(plan_service, "month_ai_spend", spend)
    with company_context("cmp_x", _company(monthly_ai_budget_usd=20)):
        await plan_service.ensure_ai_budget()
        spend.return_value = 20.0
        with pytest.raises(HTTPException) as over:
            await plan_service.ensure_ai_budget()
    assert over.value.status_code == 402 and "$20.00 of $20.00" in over.value.detail
    spend.reset_mock()
    with company_context("cmp_x", _company()):
        await plan_service.ensure_ai_budget()
    spend.assert_not_called()


async def test_the_spend_is_one_grouped_query_for_this_month(monkeypatch):
    db = MagicMock()
    db.cost_ledger.aggregate.return_value.to_list = AsyncMock(return_value=[{"_id": None, "cost": 3.5}])
    monkeypatch.setattr(plan_service, "get_db", lambda: db)
    assert await plan_service.month_ai_spend(datetime(2026, 10, 17, tzinfo=timezone.utc)) == 3.5
    stages = db.cost_ledger.aggregate.call_args.args[0]
    assert stages[0] == {"$match": {"created_at": {"$gte": "2026-10-01T00:00:00+00:00"}}}
    db.cost_ledger.aggregate.return_value.to_list = AsyncMock(return_value=[])
    assert await plan_service.month_ai_spend() == 0.0
