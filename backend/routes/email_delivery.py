from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr

from config.database import get_db
from config.settings import settings
from services.hr_module.audit_service import log_audit_event
from services.hr_module.email_delivery_service import (
    MAX_RESEND_PER_CALL,
    get_delivery_health,
    hostname_only,
    resend_failed_invites,
    resend_waiting_invites,
    send_test_email,
    verify_email_transport,
)
from shared.auth import require_admin, require_permission
from shared.rate_limit import enforce_rate_limit

router = APIRouter()

_PERMISSION = "email:manage"

_TEST_SEND_LIMIT = 5
_TEST_SEND_WINDOW_SECONDS = 600

_VERIFY_LIMIT = 5
_VERIFY_WINDOW_SECONDS = 600


class SendTestRequest(BaseModel):
    to: EmailStr


class ResendFailedRequest(BaseModel):
    log_ids: list[str] | None = None
    limit: int = MAX_RESEND_PER_CALL


class ResendWaitingRequest(BaseModel):
    limit: int = MAX_RESEND_PER_CALL


def _hide_infrastructure(user: dict, payload: dict) -> dict:
    if user.get("is_platform_admin"):
        return payload
    host = hostname_only(settings.EMAIL_HOST)
    out = dict(payload)
    if "host" in out:
        out["host"] = None
    if host:
        for key, value in out.items():
            if isinstance(value, str):
                out[key] = value.replace(host, "the mail server")
    return out


def _require_db():
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    return db


@router.get("/health")
async def delivery_health(
    _admin: dict = Depends(require_admin),
    _permitted: dict = Depends(require_permission(_PERMISSION)),
):
    return _hide_infrastructure(_admin, await get_delivery_health(_require_db()))


@router.post("/verify")
async def verify(
    user: dict = Depends(require_admin),
    _permitted: dict = Depends(require_permission(_PERMISSION)),
):
    db = _require_db()
    await enforce_rate_limit(
        db,
        key=f"email_verify:{user['email']}",
        limit=_VERIFY_LIMIT,
        window_seconds=_VERIFY_WINDOW_SECONDS,
    )
    result = await verify_email_transport()
    await log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="email_verify", resource_type="email_delivery", resource_id=None,
        details={"ok": result["ok"], "provider": result["provider"]},
    )
    return _hide_infrastructure(user, result)


@router.post("/test-send")
async def test_send(
    body: SendTestRequest,
    user: dict = Depends(require_admin),
    _permitted: dict = Depends(require_permission(_PERMISSION)),
):
    db = _require_db()
    await enforce_rate_limit(
        db,
        key=f"email_test_send:{user['email']}",
        limit=_TEST_SEND_LIMIT,
        window_seconds=_TEST_SEND_WINDOW_SECONDS,
    )
    to = str(body.to)
    result = await send_test_email(db, to=to)
    await log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="email_test_send", resource_type="email_delivery", resource_id=None,
        details={"to": to, "delivered": result["delivered"], "status": result["status"]},
    )
    return _hide_infrastructure(user, result)


@router.post("/resend-failed")
async def resend_failed(
    body: ResendFailedRequest,
    user: dict = Depends(require_admin),
    _permitted: dict = Depends(require_permission(_PERMISSION)),
):
    if not 1 <= body.limit <= MAX_RESEND_PER_CALL:
        raise HTTPException(400, f"limit must be between 1 and {MAX_RESEND_PER_CALL}")
    if body.log_ids is not None and len(body.log_ids) > MAX_RESEND_PER_CALL:
        raise HTTPException(400, f"At most {MAX_RESEND_PER_CALL} log_ids per call")

    db = _require_db()
    result = await resend_failed_invites(
        db, admin_email=user["email"], log_ids=body.log_ids, limit=body.limit,
    )
    await log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="email_resend_failed", resource_type="email_delivery", resource_id=None,
        details={
            "mode": "auto" if body.log_ids is None else "log_ids",
            "attempted": result["attempted"],
            "delivered": result["delivered"],
            "failed": result["failed"],
            "skipped": result["skipped"],
        },
    )
    return result


@router.post("/resend-waiting")
async def resend_waiting(
    body: ResendWaitingRequest = ResendWaitingRequest(),
    user: dict = Depends(require_admin),
    _permitted: dict = Depends(require_permission(_PERMISSION)),
):
    if not 1 <= body.limit <= MAX_RESEND_PER_CALL:
        raise HTTPException(400, f"limit must be between 1 and {MAX_RESEND_PER_CALL}")

    db = _require_db()
    result = await resend_waiting_invites(db, admin_email=user["email"], limit=body.limit)
    await log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="email_resend_waiting", resource_type="email_delivery", resource_id=None,
        details={
            "attempted": result["attempted"],
            "sent": result["sent"],
            "failed": result["failed"],
            "skipped": result["skipped"],
            "remaining": result["remaining"],
        },
    )
    return result
