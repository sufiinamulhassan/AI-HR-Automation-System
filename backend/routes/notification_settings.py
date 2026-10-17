from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from config.database import get_db
from shared.auth import require_admin
from shared.rate_limit import enforce_rate_limit
from services.hr_module.audit_service import log_audit_event
from services.hr_module.notification_settings_service import (
    get_notification_settings,
    send_test_notification,
    update_notification_settings,
)

router = APIRouter()

_TEST_LIMIT = 5
_TEST_WINDOW_SECONDS = 600


class NotificationSettingsUpdate(BaseModel):
    notify_email: str | None = None
    events: dict[str, bool] | None = None


@router.get("")
async def get_notification_settings_route(_: dict = Depends(require_admin)):
    return await get_notification_settings()


@router.patch("")
async def update_notification_settings_route(
    body: NotificationSettingsUpdate,
    user: dict = Depends(require_admin),
):
    try:
        saved = await update_notification_settings(
            notify_email=body.notify_email,
            events=body.events,
            updated_by=user.get("email"),
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    await log_audit_event(
        get_db(), actor_email=user["email"], actor_role=user.get("role"),
        action="notification_settings_update", resource_type="notification_settings", resource_id="singleton",
        details={"notify_email": body.notify_email, "events": body.events},
    )
    return saved


@router.post("/test")
async def send_test_notification_route(user: dict = Depends(require_admin)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    await enforce_rate_limit(
        db,
        key=f"notification_test:{user['email']}",
        limit=_TEST_LIMIT,
        window_seconds=_TEST_WINDOW_SECONDS,
    )
    result = await send_test_notification(db)
    await log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="notification_test_send", resource_type="notification_settings", resource_id=None,
        details={"to": result["to"], "sent": result["sent"]},
    )
    return result
