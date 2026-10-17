import hashlib
import logging
import re
from datetime import datetime, timezone
from email import encoders
from email.mime.application import MIMEApplication
from email.mime.base import MIMEBase
from email.mime.image import MIMEImage
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr
from html import escape as _escape_html
from urllib.parse import quote, urlsplit

from config.database import get_db
from config.settings import settings
from config.tenancy import NO_MATCH, current_company_id
from services.hr_module import email_layout, mail_brand, mail_settings_service
from services.hr_module.email_template_service import get_template_override, render
from shared.links import base_url
from shared.utils import strip_em_dashes

logger = logging.getLogger(__name__)

_ERROR_TEXT_MAX = 300

_MAILBOX = re.compile(
    r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@"
    r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$"
)
_MAILBOX_MAX = 254


def valid_email_address(value) -> str | None:
    text = str(value or "").replace("\r", "").replace("\n", "").strip()
    if not text or len(text) > _MAILBOX_MAX or not _MAILBOX.match(text):
        return None
    return text


def safe_url(value) -> str:
    text = str(value or "").strip()
    if not text or any(ord(ch) < 32 for ch in text):
        return ""
    try:
        parts = urlsplit(text)
    except ValueError:
        return ""
    return text if parts.scheme.lower() in ("http", "https") and parts.netloc else ""


def _h(value) -> str:
    return _escape_html("" if value is None else str(value), quote=True)


def _href(value) -> str:
    return _escape_html(safe_url(value), quote=True)


def _html_context(context: dict, url_keys: tuple[str, ...] = ()) -> dict:
    return {k: (_href(v) if k in url_keys else _h(v)) for k, v in context.items()}


def _one_line(value) -> str:
    return str(value or "").replace("\r", " ").replace("\n", " ")


def sender_name() -> str:
    brand = mail_brand.current()
    if brand is not None:
        return brand.name or settings.EMAIL_FROM_NAME
    return mail_brand.workspace_signing_name()


def scrub_error_text(text: str | None) -> str | None:
    if not text:
        return None
    text = str(text)
    if settings.EMAIL_PASSWORD:
        text = text.replace(settings.EMAIL_PASSWORD, "***")
    return text[:_ERROR_TEXT_MAX]


async def _log_email(
    *,
    db,
    to: str,
    subject: str,
    template: str | None,
    candidate_id: str | None,
    job_id: str | None,
    delivered: bool,
    status: str | None = None,
    error: Exception | None = None,
) -> None:
    if db is None:
        return
    try:
        row = {
            "to": to,
            "subject": subject,
            "template": template,
            "candidate_id": candidate_id,
            "job_id": job_id,
            "status": status or ("sent" if delivered else "failed"),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        if error is not None:
            row["error"] = scrub_error_text(f"{type(error).__name__}: {error}")
        await db.email_log.insert_one(row)
    except Exception as exc:
        logger.warning("Email log write failed | to=%s error=%s", to, exc)


DEFAULT_ATTACHMENT_TYPE = "application/pdf"


def _attachment_part(data: bytes, content_type: str) -> MIMEBase:
    base, *raw_params = [piece.strip() for piece in (content_type or DEFAULT_ATTACHMENT_TYPE).split(";")]
    maintype, _, subtype = base.partition("/")
    params = {
        key.strip().lower(): value.strip().strip('"')
        for key, _, value in (piece.partition("=") for piece in raw_params) if key.strip() and value.strip()
    }
    if maintype.lower() == "application" and subtype:
        return MIMEApplication(data, _subtype=subtype, **params)
    part = MIMEBase(maintype or "application", subtype or "octet-stream", **params)
    part.set_payload(data)
    encoders.encode_base64(part)
    return part


def _build_mime(
    *, to: str, subject: str, html_body: str, text_body: str,
    attachment_bytes: bytes | None = None, attachment_filename: str | None = None,
    attachment_content_type: str = DEFAULT_ATTACHMENT_TYPE,
    reply_to: str | None = None,
    from_name: str | None = None,
    from_address: str | None = None,
    inline_images: list[tuple[str, bytes, str]] | None = None,
) -> MIMEMultipart:
    alt = MIMEMultipart("alternative")
    alt.attach(MIMEText(text_body, "plain", "utf-8"))
    html_part = MIMEText(html_body, "html", "utf-8")
    if inline_images:
        related = MIMEMultipart("related")
        related.attach(html_part)
        for cid, data, content_type in inline_images:
            subtype = content_type.split("/", 1)[1]
            image = MIMEImage(data, _subtype=subtype)
            image.add_header("Content-ID", f"<{cid}>")
            image.add_header("Content-Disposition", "inline", filename=f"{cid}.{'jpg' if subtype == 'jpeg' else subtype}")
            related.attach(image)
        alt.attach(related)
    else:
        alt.attach(html_part)

    if attachment_bytes:
        msg = MIMEMultipart("mixed")
        msg.attach(alt)
        part = _attachment_part(attachment_bytes, attachment_content_type)
        part.add_header(
            "Content-Disposition", "attachment",
            filename=attachment_filename or (
                "attachment.pdf" if attachment_content_type == DEFAULT_ATTACHMENT_TYPE else "attachment"
            ),
        )
        msg.attach(part)
    else:
        msg = alt

    msg["Subject"] = _one_line(subject)
    msg["From"] = formataddr((
        _one_line(from_name) or sender_name(),
        valid_email_address(from_address) or settings.EMAIL_FROM,
    ))
    msg["To"] = _one_line(to)
    reply = valid_email_address(reply_to)
    if reply:
        msg["Reply-To"] = reply
    return msg


async def _company_row() -> dict | None:
    try:
        company_id = current_company_id()
        if not company_id or company_id == NO_MATCH:
            return None
        db = get_db()
        if db is None:
            return None
        from services.hr_module.company_settings_service import SINGLETON_ID

        return await db.company_settings.find_one({"_id": SINGLETON_ID}, {"primary_contact_email": 1, "mail": 1})
    except Exception as exc:
        logger.info("Company mail lookup skipped: %s", type(exc).__name__)
        return None


async def _reply_to_address() -> str | None:
    row = await _company_row()
    return valid_email_address((row or {}).get("primary_contact_email"))


async def _send_via_ses(msg: MIMEMultipart, to: str) -> None:
    import asyncio

    import boto3

    def _send() -> None:
        client = boto3.client("ses", region_name=settings.AWS_SES_REGION or None)
        client.send_raw_email(
            Source=settings.EMAIL_FROM,
            Destinations=[to],
            RawMessage={"Data": msg.as_string()},
        )

    await asyncio.get_running_loop().run_in_executor(None, _send)


class CompanyMailError(Exception):
    pass


async def _send_via_company_smtp(msg: MIMEMultipart, smtp: dict) -> None:
    import aiosmtplib

    sock = await mail_settings_service.connect_pinned(smtp["host"], smtp["port"])
    try:
        await aiosmtplib.send(msg, sock=sock, **mail_settings_service.client_options(smtp))
    except BaseException:
        close = getattr(sock, "close", None)
        if close is not None:
            close()
        raise


async def send_email(
    *,
    to: str,
    subject: str,
    html_body: str,
    text_body: str,
    db=None,
    template: str | None = None,
    candidate_id: str | None = None,
    job_id: str | None = None,
    attachment_bytes: bytes | None = None,
    attachment_filename: str | None = None,
    attachment_content_type: str = DEFAULT_ATTACHMENT_TYPE,
) -> bool:
    subject, html_body, text_body = (strip_em_dashes(v) for v in (subject, html_body, text_body))
    await mail_brand.load()
    inline = mail_brand.inline_images(html_body)
    subject, to = _one_line(subject), _one_line(to)
    company = await _company_row()

    try:
        smtp = mail_settings_service.smtp_settings((company or {}).get("mail"))
    except mail_settings_service.MailConfigUnusable as exc:
        logger.error("Company mail settings unusable | to=%s reason=%s", to, exc)
        await _log_email(
            db=db, to=to, subject=subject, template=template,
            candidate_id=candidate_id, job_id=job_id, delivered=False, error=CompanyMailError(str(exc)),
        )
        return False
    if smtp is not None:
        company_reply = (
            valid_email_address(smtp["reply_to"]) or valid_email_address((company or {}).get("primary_contact_email"))
        )
        try:
            msg = _build_mime(
                to=to, subject=subject, html_body=html_body, text_body=text_body,
                attachment_bytes=attachment_bytes, attachment_filename=attachment_filename,
                attachment_content_type=attachment_content_type, inline_images=inline, reply_to=company_reply,
                from_name=smtp["from_name"] or sender_name(), from_address=smtp["from_address"],
            )
            await _send_via_company_smtp(msg, smtp)
            logger.info("Email sent via the company's mail server | to=%s subject=%s", to, subject)
            await _log_email(
                db=db, to=to, subject=subject, template=template,
                candidate_id=candidate_id, job_id=job_id, delivered=True,
            )
            return True
        except Exception as exc:
            reason = mail_settings_service.describe_failure(exc)
            logger.error("Company mail failed | to=%s reason=%s", to, reason)
            await _log_email(
                db=db, to=to, subject=subject, template=template,
                candidate_id=candidate_id, job_id=job_id, delivered=False, error=CompanyMailError(reason),
            )
            return False

    reply_to = (
        valid_email_address((company or {}).get("primary_contact_email"))
        if (settings.AWS_SES_ENABLED or settings.EMAIL_HOST) else None
    )

    if settings.AWS_SES_ENABLED:
        try:
            msg = _build_mime(
                to=to, subject=subject, html_body=html_body, text_body=text_body,
                attachment_bytes=attachment_bytes, attachment_filename=attachment_filename,
                attachment_content_type=attachment_content_type, inline_images=inline, reply_to=reply_to,
            )
            await _send_via_ses(msg, to)
            logger.info("Email sent via SES | to=%s subject=%s", to, subject)
            await _log_email(
                db=db, to=to, subject=subject, template=template,
                candidate_id=candidate_id, job_id=job_id, delivered=True,
            )
            return True
        except Exception as exc:
            logger.error("SES send failed | to=%s error=%s", to, exc)
            await _log_email(
                db=db, to=to, subject=subject, template=template,
                candidate_id=candidate_id, job_id=job_id, delivered=False, error=exc,
            )
            return False

    if not settings.EMAIL_HOST:
        logger.warning(
            "[EMAIL-DEV] EMAIL_HOST is not configured: email NOT delivered. "
            "To=%s | Subject=%s%s\n%s", to, subject,
            f" (with {attachment_filename} attached)" if attachment_bytes else "",
            text_body if settings.DEBUG else "(body not logged outside debug mode)",
        )
        await _log_email(
            db=db, to=to, subject=subject, template=template,
            candidate_id=candidate_id, job_id=job_id,
            delivered=False, status="not_sent",
        )
        return bool(settings.DEBUG)
    try:
        import aiosmtplib

        msg = _build_mime(
            to=to, subject=subject, html_body=html_body, text_body=text_body,
            attachment_bytes=attachment_bytes, attachment_filename=attachment_filename,
            attachment_content_type=attachment_content_type, inline_images=inline, reply_to=reply_to,
        )

        await aiosmtplib.send(
            msg,
            hostname=settings.EMAIL_HOST,
            port=settings.EMAIL_PORT,
            username=settings.EMAIL_USERNAME or None,
            password=settings.EMAIL_PASSWORD or None,
            use_tls=settings.EMAIL_USE_TLS,
        )
        logger.info("Email sent | to=%s subject=%s", to, subject)
        await _log_email(db=db, to=to, subject=subject, template=template, candidate_id=candidate_id, job_id=job_id, delivered=True)
        return True
    except Exception as exc:
        logger.error("Email failed | to=%s error=%s", to, exc)
        await _log_email(db=db, to=to, subject=subject, template=template, candidate_id=candidate_id, job_id=job_id, delivered=False, error=exc)
        return False


def _brand() -> mail_brand.MailBrand:
    return mail_brand.current() or mail_brand.platform_default()


def _override_html_context(context: dict, url_keys: tuple[str, ...] = ()) -> dict:
    return {**_html_context(context, url_keys), **mail_brand.html_tokens()}


def _wrap_html(*, heading: str, body_html: str, footer: str = email_layout.DEFAULT_FOOTER) -> str:
    brand = _brand()
    return email_layout.shell(
        _h(heading), body_html, color=brand.color, on_color=brand.on_color, logo=mail_brand.logo_html(brand),
        footer_name=_h(brand.name or sender_name()), footer=_h(footer),
    )


def _cta(url: str, label: str) -> str:
    href = _href(url)
    if not href:
        return ""
    brand = _brand()
    return email_layout.button(href, f"{_h(label)} &rarr;", color=brand.color, on_color=brand.on_color)


def _details(rows: list[tuple[str, str]]) -> str:
    return email_layout.details(rows, color=_brand().color)


async def send_invite_email(
    *,
    to_email: str,
    candidate_name: str,
    job_title: str,
    company_name: str | None,
    secure_token: str,
    db=None,
    candidate_id: str | None = None,
    job_id: str | None = None,
) -> bool:
    await mail_brand.load()
    interview_url = f"{base_url()}/interview/{secure_token}"
    company_text = f"Company:  {company_name}\n" if company_name else ""

    subject = f"Interview Invitation: {job_title}"

    text_body = f"""Dear {candidate_name},

We reviewed your profile and are pleased to inform you that you have been shortlisted for:

  Position: {job_title}
{company_text}
Your personalised interview is ready. Please click the link below to begin when you are ready.
The session will take approximately {settings.INTERVIEW_DURATION_MINUTES} minutes.

  Interview Link: {interview_url}

Important:
  - This link is unique to you: do not share it
  - The interview is timed once you start
  - Ensure you are in a quiet environment with a stable internet connection
  - This link expires in {settings.INVITE_LINK_EXPIRY_DAYS} days

Best regards,
{sender_name()}"""

    rows = [("Position", _h(job_title))]
    if company_name:
        rows.append(("Company", _h(company_name)))
    body_html = (
        email_layout.greeting(_h(candidate_name))
        + email_layout.paragraph("We reviewed your profile and are pleased to inform you that you have been shortlisted for:")
        + _details(rows)
        + email_layout.paragraph(
            "Your personalised interview is ready. Please click the button below when you are ready to begin. "
            f"The session will take approximately <strong>{settings.INTERVIEW_DURATION_MINUTES} minutes</strong>."
        )
        + _cta(interview_url, "Begin Your Interview")
        + email_layout.tips("Important", [
            "This link is unique to you: do not share it",
            "The interview is timed once you start",
            "Ensure you are in a quiet environment with a stable connection",
            f"This link expires in {settings.INVITE_LINK_EXPIRY_DAYS} days",
        ])
        + email_layout.signoff(_h(sender_name()))
    )
    html_body = _wrap_html(heading="Interview Invitation", body_html=body_html)

    try:
        override = await get_template_override("send_invite_email")
        if override:
            _ctx = {
                "candidate_name": candidate_name,
                "job_title": job_title,
                "company_name": company_name or "",
                "interview_url": interview_url,
                "interview_duration_minutes": settings.INTERVIEW_DURATION_MINUTES,
                "invite_expiry_days": settings.INVITE_LINK_EXPIRY_DAYS,
                "email_from_name": sender_name(),
            }
            if override.get("subject_template"):
                subject = render(override["subject_template"], _ctx)
            if override.get("html_body_template"):
                html_body = render(override["html_body_template"], _override_html_context(_ctx, ("interview_url",)))
            if override.get("text_body_template"):
                text_body = render(override["text_body_template"], _ctx)
    except Exception as exc:
        logger.warning("Email template override failed for send_invite_email (using default): %s", exc)

    return await send_email(
        to=to_email, subject=subject, html_body=html_body, text_body=text_body,
        db=db, template="interview_invitation", candidate_id=candidate_id, job_id=job_id,
    )


async def send_interview_status_email(
    *,
    to_email: str,
    candidate_name: str,
    job_title: str,
    db=None,
    candidate_id: str | None = None,
    job_id: str | None = None,
) -> bool:
    await mail_brand.load()
    subject = f"Interview Update: {job_title}"

    text_body = f"""Dear {candidate_name},

Thank you for completing your interview for the {job_title} position.

Your responses have been recorded and are currently under review by our hiring team.
We will be in touch regarding next steps within the coming business days.

Best regards,
{sender_name()}"""

    body_html = (
        email_layout.greeting(_h(candidate_name))
        + email_layout.paragraph(f"Thank you for completing your interview for the <strong>{_h(job_title)}</strong> position.")
        + email_layout.success("Your responses have been recorded successfully.")
        + email_layout.paragraph(
            "Your application is currently under review by our hiring team. "
            "We will be in touch regarding the next steps within the coming business days."
        )
        + email_layout.signoff(_h(sender_name()))
    )
    html_body = _wrap_html(
        heading="Interview Completed", body_html=body_html,
        footer="This is an automated message. Please do not reply to this email.",
    )

    try:
        override = await get_template_override("send_interview_status_email")
        if override:
            _ctx = {
                "candidate_name": candidate_name,
                "job_title": job_title,
                "email_from_name": sender_name(),
            }
            if override.get("subject_template"):
                subject = render(override["subject_template"], _ctx)
            if override.get("html_body_template"):
                html_body = render(override["html_body_template"], _override_html_context(_ctx))
            if override.get("text_body_template"):
                text_body = render(override["text_body_template"], _ctx)
    except Exception as exc:
        logger.warning("Email template override failed for send_interview_status_email (using default): %s", exc)

    return await send_email(
        to=to_email, subject=subject, html_body=html_body, text_body=text_body,
        db=db, template="interview_status", candidate_id=candidate_id, job_id=job_id,
    )


async def send_otp_email(*, to_email: str, otp_code: str) -> bool:
    await mail_brand.load()
    name = sender_name()
    subject = f"{name}: Your login verification code"
    text_body = (
        f"Your one-time verification code for {name} is: {otp_code}\n\n"
        f"This code expires in {settings.OTP_EXPIRE_MINUTES} minutes. "
        "If you didn't request this, you can safely ignore this email."
    )
    body_html = (
        email_layout.paragraph(f"Your one-time verification code for <strong>{_h(name)}</strong> is:")
        + email_layout.code_box(_h(otp_code))
        + email_layout.small(
            f"This code expires in {settings.OTP_EXPIRE_MINUTES} minutes. "
            "If you didn't request this, you can safely ignore this email."
        )
    )
    html_body = _wrap_html(heading="Verification Code", body_html=body_html)
    return await send_email(to=to_email, subject=subject, html_body=html_body, text_body=text_body, template="otp")


async def send_password_reset_email(
    *,
    to_email: str,
    name: str | None,
    reset_url: str,
    expires_in: str = "1 hour",
    db=None,
) -> bool:
    await mail_brand.load()
    company = sender_name()
    hello = f"Hello {name}," if name else "Hello,"
    subject = f"{company}: Reset your password"
    text_body = f"""{hello}

We received a request to reset the password for your {company} account. Use the link below to choose a new password.

  Reset link: {reset_url}

The link can be used once and expires in {expires_in}. If you did not ask for this, ignore this email: your password stays the same.

Best regards,
{company}"""
    body_html = (
        email_layout.salutation(_h(hello))
        + email_layout.paragraph(
            f"We received a request to reset the password for your <strong>{_h(company)}</strong> account. "
            "Use the button below to choose a new password."
        )
        + _cta(reset_url, "Choose a new password")
        + email_layout.small(
            f"The link can be used once and expires in {_h(expires_in)}. If you did not ask for this, ignore this email: "
            "your password stays the same."
        )
        + email_layout.signoff(_h(company))
    )
    html_body = _wrap_html(heading="Reset your password", body_html=body_html)
    return await send_email(
        to=to_email, subject=subject, html_body=html_body, text_body=text_body, db=db, template="password_reset",
    )


async def send_invitation_email(
    *,
    to_email: str,
    name: str | None,
    invite_url: str,
    expires_in: str = "7 days",
    db=None,
) -> bool:
    await mail_brand.load()
    company = sender_name()
    hello = f"Hello {name}," if name else "Hello,"
    subject = f"You have been invited to {company}"
    text_body = f"""{hello}

You have been invited to join {company}. Use the link below to choose your password and sign in.

  Set your password: {invite_url}

The link can be used once and expires in {expires_in}. If it has expired, ask your administrator to send a new invitation.

Best regards,
{company}"""
    body_html = (
        email_layout.salutation(_h(hello))
        + email_layout.paragraph(
            f"You have been invited to join <strong>{_h(company)}</strong>. "
            "Use the button below to choose your password and sign in."
        )
        + _cta(invite_url, "Set your password")
        + email_layout.small(
            f"The link can be used once and expires in {_h(expires_in)}. If it has expired, ask your administrator "
            "to send a new invitation."
        )
        + email_layout.signoff(_h(company))
    )
    html_body = _wrap_html(heading="You have been invited", body_html=body_html)
    return await send_email(
        to=to_email, subject=subject, html_body=html_body, text_body=text_body, db=db, template="account_invitation",
    )


async def send_assessment_invitation_email(
    *,
    to_email: str,
    candidate_name: str,
    job_title: str,
    secure_token: str,
    db=None,
    candidate_id: str | None = None,
    job_id: str | None = None,
) -> bool:
    await mail_brand.load()
    assessment_url = f"{base_url()}/interview/{secure_token}"
    subject = f"Assessment Invitation: {job_title}"
    text_body = f"""Dear {candidate_name},

As the next step for the {job_title} position, please complete your assessment using the link below.

  Assessment Link: {assessment_url}

This link is unique to you and expires in {settings.INVITE_LINK_EXPIRY_DAYS} days.

Best regards,
{sender_name()}"""
    body_html = (
        email_layout.greeting(_h(candidate_name))
        + email_layout.paragraph(
            f"As the next step for the <strong>{_h(job_title)}</strong> position, please complete your assessment using the link below."
        )
        + _cta(assessment_url, "Start Assessment")
        + email_layout.small(f"This link is unique to you and expires in {settings.INVITE_LINK_EXPIRY_DAYS} days.")
        + email_layout.signoff(_h(sender_name()))
    )
    html_body = _wrap_html(heading="Assessment Invitation", body_html=body_html)

    try:
        override = await get_template_override("send_assessment_invitation_email")
        if override:
            _ctx = {
                "candidate_name": candidate_name,
                "job_title": job_title,
                "assessment_url": assessment_url,
                "invite_expiry_days": settings.INVITE_LINK_EXPIRY_DAYS,
                "email_from_name": sender_name(),
            }
            if override.get("subject_template"):
                subject = render(override["subject_template"], _ctx)
            if override.get("html_body_template"):
                html_body = render(override["html_body_template"], _override_html_context(_ctx, ("assessment_url",)))
            if override.get("text_body_template"):
                text_body = render(override["text_body_template"], _ctx)
    except Exception as exc:
        logger.warning("Email template override failed for send_assessment_invitation_email (using default): %s", exc)

    return await send_email(
        to=to_email, subject=subject, html_body=html_body, text_body=text_body,
        db=db, template="assessment_invitation", candidate_id=candidate_id, job_id=job_id,
    )


async def send_offer_letter_email(
    *,
    to_email: str,
    candidate_name: str,
    job_title: str,
    company_name: str | None,
    salary: str | None = None,
    joining_date: str | None = None,
    benefits: str | None = None,
    accept_url: str | None = None,
    db=None,
    candidate_id: str | None = None,
    job_id: str | None = None,
    pdf_bytes: bytes | None = None,
    pdf_filename: str | None = None,
) -> bool:
    await mail_brand.load()
    accept_url = safe_url(accept_url) or None
    subject = f"Offer of Employment: {job_title}"
    company_line = f" at {company_name}" if company_name else ""
    company_line_html = f" at {_h(company_name)}" if company_name else ""
    terms = [
        (label, value) for label, value in (
            ("Compensation", salary), ("Joining date", joining_date), ("Benefits", benefits),
        ) if value
    ]
    details_text = "\n".join(f"  {label}: {value}" for label, value in terms)
    accept_line = f"\n\nReview and respond to this offer:\n  {accept_url}\n" if accept_url else ""
    text_body = f"""Dear {candidate_name},

We are delighted to offer you the position of {job_title}{company_line}.

{details_text}
{accept_line}
Please reach out to your recruiter with any questions or to confirm acceptance.

Best regards,
{sender_name()}"""
    terms_html = (
        _details([(_h(label), _h(value)) for label, value in terms])
        if terms else email_layout.paragraph("Details to follow from your recruiter.")
    )
    body_html = (
        email_layout.greeting(_h(candidate_name))
        + email_layout.paragraph(f"We are delighted to offer you the position of <strong>{_h(job_title)}</strong>{company_line_html}.")
        + terms_html
        + _cta(accept_url, "Review and Respond to Offer")
        + email_layout.paragraph("Please reach out to your recruiter with any questions or to confirm your acceptance.")
        + email_layout.signoff(_h(sender_name()))
    )
    html_body = _wrap_html(heading="Offer of Employment", body_html=body_html)

    try:
        override = await get_template_override("send_offer_letter_email")
        if override:
            _ctx = {
                "candidate_name": candidate_name,
                "job_title": job_title,
                "company_name": company_name or "",
                "salary": salary or "",
                "joining_date": joining_date or "",
                "benefits": benefits or "",
                "accept_url": accept_url or "",
                "email_from_name": sender_name(),
            }
            if override.get("subject_template"):
                subject = render(override["subject_template"], _ctx)
            if override.get("html_body_template"):
                html_body = render(override["html_body_template"], _override_html_context(_ctx, ("accept_url",)))
            if override.get("text_body_template"):
                text_body = render(override["text_body_template"], _ctx)
    except Exception as exc:
        logger.warning("Email template override failed for send_offer_letter_email (using default): %s", exc)

    return await send_email(
        to=to_email, subject=subject, html_body=html_body, text_body=text_body,
        db=db, template="offer_letter", candidate_id=candidate_id, job_id=job_id,
        attachment_bytes=pdf_bytes, attachment_filename=pdf_filename,
    )


async def send_rejection_email(
    *,
    to_email: str,
    candidate_name: str,
    job_title: str,
    db=None,
    candidate_id: str | None = None,
    job_id: str | None = None,
) -> bool:
    await mail_brand.load()
    subject = f"Update on your application: {job_title}"
    text_body = f"""Dear {candidate_name},

Thank you for your interest in the {job_title} position and for the time you invested in our process.

After careful consideration, we have decided to move forward with other candidates at this time.
We appreciate your interest in joining us and encourage you to apply for future openings that match your experience.

Best regards,
{sender_name()}"""
    body_html = (
        email_layout.greeting(_h(candidate_name))
        + email_layout.paragraph(
            f"Thank you for your interest in the <strong>{_h(job_title)}</strong> position and for the time you invested in our process."
        )
        + email_layout.paragraph(
            "After careful consideration, we have decided to move forward with other candidates at this time. "
            "We appreciate your interest in joining us and encourage you to apply for future openings that match your experience."
        )
        + email_layout.signoff(_h(sender_name()))
    )
    html_body = _wrap_html(heading="Application Update", body_html=body_html)

    try:
        override = await get_template_override("send_rejection_email")
        if override:
            _ctx = {
                "candidate_name": candidate_name,
                "job_title": job_title,
                "email_from_name": sender_name(),
            }
            if override.get("subject_template"):
                subject = render(override["subject_template"], _ctx)
            if override.get("html_body_template"):
                html_body = render(override["html_body_template"], _override_html_context(_ctx))
            if override.get("text_body_template"):
                text_body = render(override["text_body_template"], _ctx)
    except Exception as exc:
        logger.warning("Email template override failed for send_rejection_email (using default): %s", exc)

    return await send_email(
        to=to_email, subject=subject, html_body=html_body, text_body=text_body,
        db=db, template="rejection", candidate_id=candidate_id, job_id=job_id,
    )


async def send_reminder_email(
    *,
    to_email: str,
    candidate_name: str,
    job_title: str,
    secure_token: str | None = None,
    kind: str = "reminder",
    db=None,
    candidate_id: str | None = None,
    job_id: str | None = None,
) -> bool:
    await mail_brand.load()
    is_followup = kind == "follow_up"
    subject = f"{'Following up' if is_followup else 'Reminder'}: {job_title}"
    reminder_url = f"{base_url()}/interview/{secure_token}" if secure_token else ""
    link_line = f"\n  Interview Link: {reminder_url}\n" if secure_token else ""
    message = (
        "We wanted to follow up regarding your application and let you know we're still reviewing candidates."
        if is_followup
        else "This is a friendly reminder that your interview link is still open and awaiting completion."
    )
    text_body = f"""Dear {candidate_name},

Regarding the {job_title} position: {message}
{link_line}
Best regards,
{sender_name()}"""
    body_html = (
        email_layout.greeting(_h(candidate_name))
        + email_layout.paragraph(f"Regarding the <strong>{_h(job_title)}</strong> position: {_h(message)}")
        + _cta(reminder_url, "Continue")
        + email_layout.signoff(_h(sender_name()))
    )
    html_body = _wrap_html(heading="Following Up" if is_followup else "Reminder", body_html=body_html)

    try:
        override = await get_template_override("send_reminder_email")
        if override:
            _ctx = {
                "candidate_name": candidate_name,
                "job_title": job_title,
                "interview_url": reminder_url,
                "kind": kind,
                "email_from_name": sender_name(),
            }
            if override.get("subject_template"):
                subject = render(override["subject_template"], _ctx)
            if override.get("html_body_template"):
                html_body = render(override["html_body_template"], _override_html_context(_ctx, ("interview_url",)))
            if override.get("text_body_template"):
                text_body = render(override["text_body_template"], _ctx)
    except Exception as exc:
        logger.warning("Email template override failed for send_reminder_email (using default): %s", exc)

    return await send_email(
        to=to_email, subject=subject, html_body=html_body, text_body=text_body,
        db=db, template=kind, candidate_id=candidate_id, job_id=job_id,
    )


def _format_meeting_time(start_iso: str, tz_name: str | None) -> str:
    try:
        start = datetime.fromisoformat(str(start_iso).replace("Z", "+00:00"))
    except ValueError:
        return str(start_iso)
    start = start.replace(tzinfo=timezone.utc) if start.tzinfo is None else start.astimezone(timezone.utc)
    text = f"{start:%A}, {start.day} {start:%B %Y}, {start:%H:%M} UTC"
    if tz_name:
        try:
            from zoneinfo import ZoneInfo
            local = start.astimezone(ZoneInfo(tz_name))
            text += f" ({local:%H:%M} {tz_name})"
        except Exception:
            pass
    return text


EXTERNAL_INTERVIEW_ICS_FILENAME = "interview.ics"
EXTERNAL_INTERVIEW_ICS_TYPE = "text/calendar; method=REQUEST; charset=UTF-8"

PHYSICAL_PLATFORM_LABEL = "In person"

_SAFE_MAILBOX = re.compile(r"^[^\s;:,\"<>\\]+@[^\s;:,\"<>\\]+$")


def external_interview_ics_uid(candidate_id: str | None, to_email: str) -> str:
    key = candidate_id or hashlib.sha256((to_email or "").strip().lower().encode("utf-8")).hexdigest()[:24]
    return f"external-interview-{key}@hrbot"


def map_url(location: str) -> str:
    return "https://www.google.com/maps/search/?api=1&query=" + quote(location, safe="")


def build_external_interview_ics(
    *,
    candidate_id: str | None,
    to_email: str,
    job_title: str,
    platform_label: str,
    join_url: str | None,
    scheduled_start_at: str,
    duration_minutes: int,
    sequence: int = 0,
    method: str = "REQUEST",
    with_attendee: bool = True,
    location: str | None = None,
) -> str | None:
    from services.hr_module.calendar_ics import build_ics_event

    description = (
        f"In-person interview\nLocation: {location}" if location else f"Platform: {platform_label}\nJoin: {join_url}"
    )
    try:
        return build_ics_event(
            uid=external_interview_ics_uid(candidate_id, to_email),
            summary=strip_em_dashes(f"Interview for {job_title}"),
            description=strip_em_dashes(description),
            start_iso=str(scheduled_start_at),
            duration_minutes=int(duration_minutes),
            organizer_email=settings.EMAIL_FROM or "noreply@localhost",
            method=method,
            sequence=sequence,
            attendee_email=to_email if with_attendee and _SAFE_MAILBOX.match(to_email or "") else None,
            location=strip_em_dashes(location) if location else None,
        )
    except (TypeError, ValueError) as exc:
        logger.warning("Calendar invitation skipped | candidate_id=%s error=%s", candidate_id, exc)
        return None


def _interview_note(notes_text: str) -> str:
    return email_layout.note("A note from the recruiter", _h(notes_text)) if notes_text else ""


async def send_external_interview_email(
    *,
    to_email: str,
    candidate_name: str,
    job_title: str,
    company_name: str | None,
    platform_label: str,
    join_url: str,
    scheduled_start_at: str,
    duration_minutes: int,
    notes: str | None = None,
    display_timezone: str | None = None,
    updated: bool = False,
    db=None,
    candidate_id: str | None = None,
    job_id: str | None = None,
    calendar_sequence: int = 0,
) -> bool:
    await mail_brand.load()
    when = _format_meeting_time(scheduled_start_at, display_timezone)
    company_text = f" at {company_name}" if company_name else ""
    lead = (
        "The details of your interview have changed. Please use the new details below."
        if updated
        else "We would like to invite you to an interview."
    )
    subject = (
        f"Updated interview details for {job_title}"
        if updated
        else f"Your interview for {job_title}"
    )

    notes_text = (notes or "").strip()
    text_body = f"""Dear {candidate_name},

{lead}

  Position: {job_title}{company_text}
  Platform: {platform_label}
  When:     {when}
  Duration: about {duration_minutes} minutes
  Join:     {join_url}
"""
    if notes_text:
        text_body += f"\nA note from the recruiter:\n{notes_text}\n"
    text_body += f"""
Please join a few minutes early so we can start on time. If this time does not
work for you, reply to this email and we will find another.

Best regards,
{sender_name()}"""

    company_h = f" at {_h(company_name)}" if company_name else ""
    body_html = (
        email_layout.greeting(_h(candidate_name))
        + email_layout.paragraph(_h(lead))
        + _details([
            ("Position", f"{_h(job_title)}{company_h}"),
            ("Platform", _h(platform_label)),
            ("When", _h(when)),
            ("Duration", f"about {int(duration_minutes)} minutes"),
        ])
        + _cta(join_url, "Join the interview")
        + _interview_note(notes_text)
        + email_layout.paragraph(
            "Please join a few minutes early so we can start on time. If this time does not work for you, "
            "reply to this email and we will find another."
        )
        + email_layout.signoff(_h(sender_name()))
    )
    html_body = _wrap_html(
        heading="Interview details updated" if updated else "Interview details", body_html=body_html,
    )

    try:
        override = await get_template_override("send_external_interview_email")
        if override:
            _ctx = {
                "candidate_name": candidate_name,
                "job_title": job_title,
                "company_name": company_name or "",
                "platform": platform_label,
                "when": when,
                "duration_minutes": duration_minutes,
                "join_url": join_url,
                "notes": notes_text,
                "lead": lead,
                "email_from_name": sender_name(),
            }
            _html_ctx = _override_html_context(_ctx, ("join_url",))
            if override.get("subject_template"):
                subject = " ".join(render(override["subject_template"], _ctx).split())
            if override.get("html_body_template"):
                html_body = render(override["html_body_template"], _html_ctx)
            if override.get("text_body_template"):
                text_body = render(override["text_body_template"], _ctx)
    except Exception as exc:
        logger.warning("Email template override failed for send_external_interview_email (using default): %s", exc)

    invite_kwargs: dict = {}
    ics_text = build_external_interview_ics(
        candidate_id=candidate_id, to_email=to_email, job_title=job_title,
        platform_label=platform_label, join_url=join_url, scheduled_start_at=scheduled_start_at,
        duration_minutes=duration_minutes, sequence=calendar_sequence,
    )
    if ics_text:
        invite_kwargs = {
            "attachment_bytes": ics_text.encode("utf-8"),
            "attachment_filename": EXTERNAL_INTERVIEW_ICS_FILENAME,
            "attachment_content_type": EXTERNAL_INTERVIEW_ICS_TYPE,
        }

    return await send_email(
        to=to_email, subject=subject, html_body=html_body, text_body=text_body,
        db=db, template="external_interview", candidate_id=candidate_id, job_id=job_id,
        **invite_kwargs,
    )


async def send_physical_interview_email(
    *,
    to_email: str,
    candidate_name: str,
    job_title: str,
    company_name: str | None,
    location: str,
    scheduled_start_at: str,
    duration_minutes: int,
    notes: str | None = None,
    display_timezone: str | None = None,
    updated: bool = False,
    db=None,
    candidate_id: str | None = None,
    job_id: str | None = None,
    calendar_sequence: int = 0,
) -> bool:
    await mail_brand.load()
    when = _format_meeting_time(scheduled_start_at, display_timezone)
    company_text = f" at {company_name}" if company_name else ""
    lead = (
        "The details of your interview have changed. Please use the new details below."
        if updated
        else "We would like to invite you to an interview in person."
    )
    subject = f"Updated interview details for {job_title}" if updated else f"Your in-person interview for {job_title}"
    directions = map_url(location)
    notes_text = (notes or "").strip()

    text_body = f"""Dear {candidate_name},

{lead}

  Position: {job_title}{company_text}
  Type:     In-person interview
  When:     {when}
  Duration: about {duration_minutes} minutes
  Location: {location}
  Map:      {directions}
"""
    if notes_text:
        text_body += f"\nA note from the recruiter:\n{notes_text}\n"
    text_body += f"""
Please arrive a few minutes early so we can start on time. If this time does not
work for you, reply to this email and we will find another.

Best regards,
{sender_name()}"""

    company_h = f" at {_h(company_name)}" if company_name else ""
    body_html = (
        email_layout.greeting(_h(candidate_name))
        + email_layout.paragraph(_h(lead))
        + _details([
            ("Position", f"{_h(job_title)}{company_h}"),
            ("Type", "In-person interview"),
            ("When", _h(when)),
            ("Duration", f"about {int(duration_minutes)} minutes"),
            ("Location", _h(location)),
        ])
        + _cta(directions, "Get directions")
        + _interview_note(notes_text)
        + email_layout.paragraph(
            "Please arrive a few minutes early so we can start on time. If this time does not work for you, "
            "reply to this email and we will find another."
        )
        + email_layout.signoff(_h(sender_name()))
    )
    html_body = _wrap_html(
        heading="Interview details updated" if updated else "In-person interview", body_html=body_html,
    )

    try:
        override = await get_template_override("send_physical_interview_email")
        if override:
            _ctx = {
                "candidate_name": candidate_name,
                "job_title": job_title,
                "company_name": company_name or "",
                "when": when,
                "duration_minutes": duration_minutes,
                "location": location,
                "map_url": directions,
                "notes": notes_text,
                "lead": lead,
                "email_from_name": sender_name(),
            }
            if override.get("subject_template"):
                subject = " ".join(render(override["subject_template"], _ctx).split())
            if override.get("html_body_template"):
                html_body = render(override["html_body_template"], _override_html_context(_ctx, ("map_url",)))
            if override.get("text_body_template"):
                text_body = render(override["text_body_template"], _ctx)
    except Exception as exc:
        logger.warning("Email template override failed for send_physical_interview_email (using default): %s", exc)

    invite_kwargs: dict = {}
    ics_text = build_external_interview_ics(
        candidate_id=candidate_id, to_email=to_email, job_title=job_title,
        platform_label=PHYSICAL_PLATFORM_LABEL, join_url=None, scheduled_start_at=scheduled_start_at,
        duration_minutes=duration_minutes, sequence=calendar_sequence, location=location,
    )
    if ics_text:
        invite_kwargs = {
            "attachment_bytes": ics_text.encode("utf-8"),
            "attachment_filename": EXTERNAL_INTERVIEW_ICS_FILENAME,
            "attachment_content_type": EXTERNAL_INTERVIEW_ICS_TYPE,
        }

    return await send_email(
        to=to_email, subject=subject, html_body=html_body, text_body=text_body,
        db=db, template="physical_interview_call", candidate_id=candidate_id, job_id=job_id,
        **invite_kwargs,
    )


async def send_external_interview_reminder_email(
    *,
    to_email: str,
    candidate_name: str,
    job_title: str,
    company_name: str | None,
    platform_label: str,
    join_url: str | None,
    scheduled_start_at: str,
    duration_minutes: int,
    notes: str | None = None,
    display_timezone: str | None = None,
    location: str | None = None,
    db=None,
    candidate_id: str | None = None,
    job_id: str | None = None,
) -> bool:
    await mail_brand.load()
    when = _format_meeting_time(scheduled_start_at, display_timezone)
    company_text = f" at {company_name}" if company_name else ""
    subject = f"Reminder: your interview for {job_title}"
    notes_text = (notes or "").strip()
    in_person = bool(location)

    where_text = f"  Location: {location}\n  Map:      {map_url(location)}\n" if in_person else (
        f"  Platform: {platform_label}\n"
    )
    join_text = "" if in_person else f"  Join:     {join_url}\n"
    text_body = f"""Dear {candidate_name},

This is a reminder that your interview is coming up soon.

  Position: {job_title}{company_text}
{where_text}  When:     {when}
  Duration: about {duration_minutes} minutes
{join_text}"""
    if notes_text:
        text_body += f"\nA note from the recruiter:\n{notes_text}\n"
    text_body += f"""
Please {'arrive' if in_person else 'join'} a few minutes early. If you can no longer make this time, reply to
this email and we will find another.

Best regards,
{sender_name()}"""

    company_h = f" at {_h(company_name)}" if company_name else ""
    rows = [("Position", f"{_h(job_title)}{company_h}")]
    if in_person:
        rows += [("Type", "In-person interview"), ("Location", _h(location))]
    else:
        rows.append(("Platform", _h(platform_label)))
    rows += [("When", _h(when)), ("Duration", f"about {int(duration_minutes)} minutes")]
    action = _cta(map_url(location), "Get directions") if in_person else _cta(join_url or "", "Join the interview")
    body_html = (
        email_layout.greeting(_h(candidate_name))
        + email_layout.paragraph("This is a reminder that your interview is coming up soon.")
        + _details(rows)
        + action
        + _interview_note(notes_text)
        + email_layout.paragraph(
            f"Please {'arrive' if in_person else 'join'} a few minutes early. If you can no longer make this time, "
            "reply to this email and we will find another."
        )
        + email_layout.signoff(_h(sender_name()))
    )
    html_body = _wrap_html(heading="Interview reminder", body_html=body_html)

    return await send_email(
        to=to_email, subject=subject, html_body=html_body, text_body=text_body,
        db=db, template="external_interview_reminder", candidate_id=candidate_id, job_id=job_id,
    )


wrap_html = _wrap_html
cta = _cta
