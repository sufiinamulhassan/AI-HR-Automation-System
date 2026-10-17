from __future__ import annotations

from fastapi import Depends

from config.database import get_db
from config.tenancy import current_company_id
from services.hr_module import plan_service
from shared.auth import get_current_user
from shared.rate_limit import enforce_rate_limit

WINDOW_SECONDS = 3600


async def check_ai_action(scope: str, *, per_hour: int = 120) -> None:
    await enforce_rate_limit(
        get_db(), key=f"co:{current_company_id()}:{scope}", limit=per_hour, window_seconds=WINDOW_SECONDS,
    )
    await plan_service.ensure_ai_budget()


def ai_action(scope: str, *, per_hour: int = 120):
    async def _guard(_user: dict = Depends(get_current_user)) -> None:
        await check_ai_action(scope, per_hour=per_hour)

    _guard.quota_scope = scope
    _guard.quota_per_hour = per_hour
    return _guard
