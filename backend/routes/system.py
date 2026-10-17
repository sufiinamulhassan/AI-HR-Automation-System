from fastapi import APIRouter, Depends, HTTPException

from config.database import get_db
from services.hr_module.audit_service import log_audit_event
from services.hr_module.live_check_service import run_live_check
from shared.auth import require_admin
from shared.rate_limit import enforce_rate_limit

router = APIRouter()

_LIVE_CHECK_LIMIT = 6
_LIVE_CHECK_WINDOW_SECONDS = 600


@router.post("/live-check")
async def live_check(user: dict = Depends(require_admin)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    await enforce_rate_limit(
        db,
        key=f"live_check:{user['email']}",
        limit=_LIVE_CHECK_LIMIT,
        window_seconds=_LIVE_CHECK_WINDOW_SECONDS,
    )
    report = await run_live_check()
    await log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="live_check", resource_type="system", resource_id=None,
        details={"failed": [r["key"] for r in report["results"] if not r["ok"]]},
    )
    return report
