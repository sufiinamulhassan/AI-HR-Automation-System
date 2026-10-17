from datetime import datetime, timezone
from html import escape

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from config.database import get_db
from config.tenancy import current_company_id
from services.hr_module import email_service, mail_settings_service
from services.hr_module.audit_service import log_audit_event
from services.hr_module.mail_settings_service import MailConfigUnusable, MailSettingsError
from services.hr_module.plan_service import require_feature
from shared.auth import require_superadmin
from shared.rate_limit import enforce_rate_limit

router = APIRouter()

TEST_TEMPLATE = "company_mail_test"

_USER_LIMIT = 5
_USER_WINDOW_SECONDS = 600
_COMPANY_TEST_LIMIT = 20
_COMPANY_WINDOW_SECONDS = 3600


class MailUpdate(BaseModel):
    mode: str | None = None
    from_name: str | None = None
    from_address: str | None = None
    reply_to: str | None = None
    host: str | None = None
    port: int | None = None
    username: str | None = None
    password: str | None = None
    clear_password: bool | None = None
    use_tls: bool | None = None


class TestSend(BaseModel):
    to: str


def _require_db():
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    return db


@router.get("")
async def get_mail_settings(
    _user: dict = Depends(require_superadmin),
    _plan: None = Depends(require_feature("custom_smtp")),
):
    _require_db()
    return await mail_settings_service.get_view()


@router.put("")
async def put_mail_settings(
    body: MailUpdate,
    user: dict = Depends(require_superadmin),
    _plan: None = Depends(require_feature("custom_smtp")),
):
    db = _require_db()
    try:
        saved, summary = await mail_settings_service.save_mail(
            body.model_dump(exclude_unset=True), updated_by=user.get("email"),
        )
    except MailSettingsError as exc:
        raise HTTPException(400, str(exc))
    await log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="company_mail_update", resource_type="company_settings", resource_id="mail", details=summary,
    )
    return saved


@router.post("/verify")
async def verify_mail_settings(
    user: dict = Depends(require_superadmin),
    _plan: None = Depends(require_feature("custom_smtp")),
):
    db = _require_db()
    await enforce_rate_limit(
        db, key=f"company_mail_verify:{user['email']}", limit=_USER_LIMIT, window_seconds=_USER_WINDOW_SECONDS,
    )
    stored = await mail_settings_service.load_mail()
    if not stored:
        result = {"ok": False, "detail": "Save the mail server settings first."}
    else:
        try:
            smtp = mail_settings_service.smtp_settings({**stored, "mode": "smtp"})
        except MailConfigUnusable as exc:
            result = {"ok": False, "detail": str(exc)}
        else:
            result = await mail_settings_service.verify_connection(smtp)
    await log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="company_mail_verify", resource_type="company_settings", resource_id="mail",
        details={"ok": result["ok"]},
    )
    return result


@router.post("/test-send")
async def test_send_mail(
    body: TestSend,
    user: dict = Depends(require_superadmin),
    _plan: None = Depends(require_feature("custom_smtp")),
):
    db = _require_db()
    to = email_service.valid_email_address(body.to)
    if to is None:
        raise HTTPException(400, "Enter a valid email address.")
    await enforce_rate_limit(
        db, key=f"company_mail_test:{user['email']}", limit=_USER_LIMIT, window_seconds=_USER_WINDOW_SECONDS,
    )
    await enforce_rate_limit(
        db, key=f"co:{current_company_id()}:mail_test", limit=_COMPANY_TEST_LIMIT,
        window_seconds=_COMPANY_WINDOW_SECONDS,
    )

    stored = await mail_settings_service.load_mail()
    own_server = bool(stored) and stored.get("mode") == "smtp"
    name = email_service.sender_name()
    started = datetime.now(timezone.utc).isoformat()
    text_body = (
        f"This is a test message from {name}.\n\n"
        f"Sent at: {started}\n\n"
        "If you received it, outgoing mail is working. No action is needed."
    )
    html_body = (
        f"<p>This is a test message from {escape(name)}.</p>"
        f"<p>Sent at: {escape(started)}</p>"
        "<p>If you received it, outgoing mail is working. No action is needed.</p>"
    )
    delivered = bool(await email_service.send_email(
        to=to, subject=f"{name}: mail test", html_body=html_body, text_body=text_body,
        db=db, template=TEST_TEMPLATE,
    ))
    via = "company" if own_server else "platform"
    if delivered:
        detail = (
            "The mail server accepted the message." if own_server
            else "The platform's mail service accepted the message."
        )
    else:
        reason = None
        row = await db.email_log.find_one(
            {"to": to, "template": TEST_TEMPLATE, "status": {"$in": ["failed", "not_sent"]}, "created_at": {"$gte": started}},
            sort=[("created_at", -1)],
        )
        if own_server and row and row.get("error"):
            reason = str(row["error"]).partition(": ")[2] or None
        detail = reason or "The message could not be sent. Check the mail settings."
    await log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="company_mail_test_send", resource_type="company_settings", resource_id="mail",
        details={"to": to, "delivered": delivered, "via": via},
    )
    return {"delivered": delivered, "via": via, "detail": detail}
