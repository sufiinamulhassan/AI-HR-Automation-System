from datetime import datetime, timezone
from html import escape

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from config.database import get_platform_db
from config.tenancy import PLATFORM_COMPANY_ID, company_context, db_for_company
from services.hr_module import email_service, mail_settings_service
from services.hr_module.mail_settings_service import MailConfigUnusable, MailSettingsError
from services.hr_module.workspace_service import platform_audit
from shared.auth import require_platform_admin
from shared.rate_limit import enforce_rate_limit

router = APIRouter()

TEST_TEMPLATE = "platform_mail_test"

_USER_LIMIT = 5
_USER_WINDOW_SECONDS = 600

_PLATFORM_COMPANY = {"company_id": PLATFORM_COMPANY_ID, "name": "Platform Operations", "kind": "platform", "settings": {}}


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


def _require_raw():
    raw = get_platform_db()
    if raw is None:
        raise HTTPException(503, "Database unavailable")
    return raw


@router.get("/mail")
async def get_platform_mail(_owner: dict = Depends(require_platform_admin)):
    _require_raw()
    return await mail_settings_service.get_platform_view()


@router.put("/mail")
async def put_platform_mail(body: MailUpdate, owner: dict = Depends(require_platform_admin)):
    _require_raw()
    try:
        saved, summary = await mail_settings_service.save_platform_mail(
            body.model_dump(exclude_unset=True), updated_by=owner.get("email"),
        )
    except MailSettingsError as exc:
        raise HTTPException(400, str(exc))
    await platform_audit(owner, "platform_mail_update", "platform_settings", "mail", summary)
    return saved


@router.post("/mail/verify")
async def verify_platform_mail(owner: dict = Depends(require_platform_admin)):
    raw = _require_raw()
    await enforce_rate_limit(
        raw, key=f"platform_mail_verify:{owner['email']}", limit=_USER_LIMIT, window_seconds=_USER_WINDOW_SECONDS,
    )
    stored = await mail_settings_service.load_platform_mail()
    if not stored:
        result = {"ok": False, "detail": "Save the mail server settings first."}
    else:
        try:
            smtp = mail_settings_service.smtp_settings({**stored, "mode": "smtp"}, owner="platform")
        except MailConfigUnusable as exc:
            result = {"ok": False, "detail": str(exc)}
        else:
            result = await mail_settings_service.verify_connection(smtp)
    await platform_audit(owner, "platform_mail_verify", "platform_settings", "mail", {"ok": result["ok"]})
    return result


@router.post("/mail/test-send")
async def test_send_platform_mail(body: TestSend, owner: dict = Depends(require_platform_admin)):
    raw = _require_raw()
    to = email_service.valid_email_address(body.to)
    if to is None:
        raise HTTPException(400, "Enter a valid email address.")
    await enforce_rate_limit(
        raw, key=f"platform_mail_test:{owner['email']}", limit=_USER_LIMIT, window_seconds=_USER_WINDOW_SECONDS,
    )

    stored = await mail_settings_service.load_platform_mail()
    own_server = bool(stored) and stored.get("mode") == "smtp"
    db = db_for_company(raw, PLATFORM_COMPANY_ID)
    started = datetime.now(timezone.utc).isoformat()
    with company_context(PLATFORM_COMPANY_ID, dict(_PLATFORM_COMPANY)):
        name = email_service.sender_name()
        text_body = (
            f"This is a test message from {name}.\n\n"
            f"Sent at: {started}\n\n"
            "If you received it, the platform's outgoing mail is working. No action is needed."
        )
        html_body = (
            f"<p>This is a test message from {escape(name)}.</p>"
            f"<p>Sent at: {escape(started)}</p>"
            "<p>If you received it, the platform's outgoing mail is working. No action is needed.</p>"
        )
        delivered = bool(await email_service.send_email(
            to=to, subject=f"{name}: mail test", html_body=html_body, text_body=text_body,
            db=db, template=TEST_TEMPLATE,
        ))
    via = "platform" if own_server else "default"
    if delivered:
        detail = (
            "The mail server accepted the message." if own_server
            else "The default mail service accepted the message."
        )
    else:
        row = await db.email_log.find_one(
            {"to": to, "template": TEST_TEMPLATE, "status": {"$in": ["failed", "not_sent"]}, "created_at": {"$gte": started}},
            sort=[("created_at", -1)],
        )
        reason = None
        if row and row.get("status") == "not_sent":
            reason = "No default mail service is configured. Connect a mail server to send email."
        elif own_server and row and row.get("error"):
            reason = str(row["error"]).partition(": ")[2] or None
        detail = reason or "The message could not be sent. Check the mail settings."
    await platform_audit(
        owner, "platform_mail_test_send", "platform_settings", "mail",
        {"to": to, "delivered": delivered, "via": via},
    )
    return {"delivered": delivered, "via": via, "detail": detail}
