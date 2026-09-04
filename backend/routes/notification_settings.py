"""Notification settings route — hr_module Admin Configuration (MVP2 §2.20
slice: Notification Settings).

  GET   /   admin-only — current notify_email + every NOTIFICATION_EVENTS
             entry (label/description/enabled state).
  PATCH /   admin-only — partial update: notify_email and/or a subset of
             event booleans (unknown event keys are silently dropped).

Scope note: this only builds the settings CRUD. Nothing in the codebase
calls these settings yet to decide whether to actually send a notification
on offer_declined / candidate_flagged_for_integrity / job_import_failed /
etc. — see services/hr_module/notification_settings_service.py's module
docstring for the exact wiring contract a future pass would follow at each
event's real call site.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from shared.auth import require_admin
from services.hr_module.notification_settings_service import (
    get_notification_settings,
    update_notification_settings,
)

router = APIRouter()


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
        return await update_notification_settings(
            notify_email=body.notify_email,
            events=body.events,
            updated_by=user.get("email"),
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))
