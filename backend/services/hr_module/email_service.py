"""
Async email service — hr_module.

Handles all outbound emails: interview invitations and post-interview status
notifications. Candidate-facing emails intentionally contain NO scores,
NO recommendations, and NO report content (those are admin-only/confidential).

Transport: aiosmtplib (async SMTP). Falls back to console log when EMAIL_HOST
is not configured (safe for local development).
"""
import logging
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from config.settings import settings
from services.hr_module.email_template_service import get_template_override, render

logger = logging.getLogger(__name__)


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
) -> None:
    """Write-through delivery record — the entire content of the "Communication
    Center" today is this log plus the templates below; there is no
    open/click tracking since plain SMTP doesn't support it (a provider
    webhook would be needed for that).

    `status` overrides the sent/failed derivation so the console-only dev path
    can record what actually happened rather than claiming delivery.
    """
    if db is None:
        return
    try:
        await db.email_log.insert_one({
            "to": to,
            "subject": subject,
            "template": template,
            "candidate_id": candidate_id,
            "job_id": job_id,
            "status": status or ("sent" if delivered else "failed"),
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception as exc:
        logger.warning("Email log write failed | to=%s error=%s", to, exc)


def _build_mime(*, to: str, subject: str, html_body: str, text_body: str) -> MIMEMultipart:
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{settings.EMAIL_FROM_NAME} <{settings.EMAIL_FROM}>"
    msg["To"] = to
    msg.attach(MIMEText(text_body, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))
    return msg


async def _send_via_ses(msg: MIMEMultipart, to: str) -> None:
    """Deliver one already-built MIME message through the AWS SES API.

    Chosen over SES's SMTP interface because it needs no SMTP credential pair —
    on Lambda the function's own IAM role is enough. boto3 is imported lazily
    and is NOT in requirements.txt on purpose: the Lambda runtime ships it, so
    vendoring it would only inflate the deployment package.

    Off Lambda — Vercel included — boto3 is NOT present. Setting
    AWS_SES_ENABLED=true there without adding `boto3` to requirements.txt makes
    this raise ImportError on the first send, which send_email() records as a
    `failed` email_log row. Use SMTP instead, or add the dependency deliberately.

    boto3 is synchronous, so the call is pushed to a worker thread — a blocking
    network call on the event loop would stall every other in-flight request.
    Raises on any failure; send_email() below turns that into a logged
    `failed` email_log row, exactly as an SMTP error would.
    """
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
) -> bool:
    """Low-level email send. Returns True on success.

    Transport precedence: AWS SES API when AWS_SES_ENABLED, else SMTP when
    EMAIL_HOST is set, else the console-only dev fallback below.

    `db`/`template`/`candidate_id`/`job_id` are optional — pass them to get a
    record written to `email_log` for the Communication Center; omitted at
    call sites that predate that feature, so existing behaviour is unchanged.
    """
    if settings.AWS_SES_ENABLED:
        try:
            msg = _build_mime(to=to, subject=subject, html_body=html_body, text_body=text_body)
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
                candidate_id=candidate_id, job_id=job_id, delivered=False,
            )
            return False

    if not settings.EMAIL_HOST:
        logger.warning(
            "[EMAIL-DEV] EMAIL_HOST is not configured — email NOT delivered. "
            "To=%s | Subject=%s\n%s", to, subject, text_body,
        )
        await _log_email(
            db=db, to=to, subject=subject, template=template,
            candidate_id=candidate_id, job_id=job_id,
            delivered=False, status="not_sent",
        )
        return True
    try:
        import aiosmtplib

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"{settings.EMAIL_FROM_NAME} <{settings.EMAIL_FROM}>"
        msg["To"] = to
        msg.attach(MIMEText(text_body, "plain", "utf-8"))
        msg.attach(MIMEText(html_body, "html", "utf-8"))

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
        await _log_email(db=db, to=to, subject=subject, template=template, candidate_id=candidate_id, job_id=job_id, delivered=False)
        return False


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
    """Send interview invitation to a shortlisted candidate."""
    interview_url = f"{settings.FRONTEND_URL}/interview/{secure_token}"
    company_line = f"<p><strong>Company:</strong> {company_name}</p>" if company_name else ""
    company_text = f"Company:  {company_name}\n" if company_name else ""

    subject = f"Interview Invitation — {job_title}"

    text_body = f"""Dear {candidate_name},

We reviewed your profile and are pleased to inform you that you have been shortlisted for:

  Position: {job_title}
{company_text}
Your personalised interview is ready. Please click the link below to begin when you are ready.
The session will take approximately {settings.INTERVIEW_DURATION_MINUTES} minutes.

  Interview Link: {interview_url}

Important:
  - This link is unique to you — do not share it
  - The interview is timed once you start
  - Ensure you are in a quiet environment with a stable internet connection
  - This link expires in {settings.INVITE_LINK_EXPIRY_DAYS} days

Best regards,
{settings.EMAIL_FROM_NAME}"""

    html_body = f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr><td style="background:#1a56db;padding:28px 40px;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:600;">Interview Invitation</h1>
        </td></tr>
        <tr><td style="padding:36px 40px;">
          <p style="color:#374151;font-size:16px;">Dear <strong>{candidate_name}</strong>,</p>
          <p style="color:#374151;font-size:15px;line-height:1.6;">
            We reviewed your profile and are pleased to inform you that you have been shortlisted for:
          </p>
          <table style="background:#f9fafb;border-radius:6px;padding:16px 20px;margin:16px 0;width:100%;box-sizing:border-box;">
            <tr><td><p style="margin:4px 0;color:#111827;"><strong>Position:</strong> {job_title}</p>
            {company_line}</td></tr>
          </table>
          <p style="color:#374151;font-size:15px;line-height:1.6;">
            Your personalised interview is ready. Please click the button below when you are ready to begin.
            The session will take approximately <strong>{settings.INTERVIEW_DURATION_MINUTES} minutes</strong>.
          </p>
          <div style="text-align:center;margin:32px 0;">
            <a href="{interview_url}"
               style="background:#1a56db;color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:6px;font-size:16px;font-weight:600;display:inline-block;">
              Begin Your Interview &rarr;
            </a>
          </div>
          <table style="background:#fffbeb;border:1px solid #fcd34d;border-radius:6px;padding:14px 18px;width:100%;box-sizing:border-box;">
            <tr><td>
              <p style="margin:0 0 6px;color:#92400e;font-weight:600;font-size:13px;">Important</p>
              <ul style="margin:0;padding-left:18px;color:#92400e;font-size:13px;line-height:1.8;">
                <li>This link is unique to you — do not share it</li>
                <li>The interview is timed once you start</li>
                <li>Ensure you are in a quiet environment with a stable connection</li>
                <li>This link expires in {settings.INVITE_LINK_EXPIRY_DAYS} days</li>
              </ul>
            </td></tr>
          </table>
          <p style="color:#6b7280;font-size:14px;margin-top:28px;">
            Best regards,<br><strong>{settings.EMAIL_FROM_NAME}</strong>
          </p>
        </td></tr>
        <tr><td style="background:#f9fafb;padding:16px 40px;border-top:1px solid #e5e7eb;">
          <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
            This is an automated message. If you have questions, please contact your recruiter directly.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""

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
                "email_from_name": settings.EMAIL_FROM_NAME,
            }
            if override.get("subject_template"):
                subject = render(override["subject_template"], _ctx)
            if override.get("html_body_template"):
                html_body = render(override["html_body_template"], _ctx)
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
    """
    Send interview completion status to candidate.
    IMPORTANT: Contains NO scores, NO recommendation, NO report details.
    Those are confidential and admin-only.
    """
    subject = f"Interview Update — {job_title}"

    text_body = f"""Dear {candidate_name},

Thank you for completing your interview for the {job_title} position.

Your responses have been recorded and are currently under review by our hiring team.
We will be in touch regarding next steps within the coming business days.

Best regards,
{settings.EMAIL_FROM_NAME}"""

    html_body = f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr><td style="background:#059669;padding:28px 40px;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:600;">Interview Completed</h1>
        </td></tr>
        <tr><td style="padding:36px 40px;">
          <p style="color:#374151;font-size:16px;">Dear <strong>{candidate_name}</strong>,</p>
          <p style="color:#374151;font-size:15px;line-height:1.6;">
            Thank you for completing your interview for the <strong>{job_title}</strong> position.
          </p>
          <table style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:16px 20px;margin:20px 0;width:100%;box-sizing:border-box;">
            <tr><td>
              <p style="margin:0;color:#166534;font-size:15px;">
                &#10003; &nbsp;Your responses have been recorded successfully.
              </p>
            </td></tr>
          </table>
          <p style="color:#374151;font-size:15px;line-height:1.6;">
            Your application is currently under review by our hiring team.
            We will be in touch regarding the next steps within the coming business days.
          </p>
          <p style="color:#6b7280;font-size:14px;margin-top:28px;">
            Best regards,<br><strong>{settings.EMAIL_FROM_NAME}</strong>
          </p>
        </td></tr>
        <tr><td style="background:#f9fafb;padding:16px 40px;border-top:1px solid #e5e7eb;">
          <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
            This is an automated message. Please do not reply to this email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""

    try:
        override = await get_template_override("send_interview_status_email")
        if override:
            _ctx = {
                "candidate_name": candidate_name,
                "job_title": job_title,
                "email_from_name": settings.EMAIL_FROM_NAME,
            }
            if override.get("subject_template"):
                subject = render(override["subject_template"], _ctx)
            if override.get("html_body_template"):
                html_body = render(override["html_body_template"], _ctx)
            if override.get("text_body_template"):
                text_body = render(override["text_body_template"], _ctx)
    except Exception as exc:
        logger.warning("Email template override failed for send_interview_status_email (using default): %s", exc)

    return await send_email(
        to=to_email, subject=subject, html_body=html_body, text_body=text_body,
        db=db, template="interview_status", candidate_id=candidate_id, job_id=job_id,
    )


def _wrap_html(*, accent: str, heading: str, body_html: str) -> str:
    """Shared HTML shell for the templates below — same visual system as the
    invite/status emails above, just parameterised on heading/accent color."""
    return f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr><td style="background:{accent};padding:28px 40px;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:600;">{heading}</h1>
        </td></tr>
        <tr><td style="padding:36px 40px;">
          {body_html}
        </td></tr>
        <tr><td style="background:#f9fafb;padding:16px 40px;border-top:1px solid #e5e7eb;">
          <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
            This is an automated message. If you have questions, please contact your recruiter directly.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""


async def send_otp_email(*, to_email: str, otp_code: str) -> bool:
    """Real OTP delivery — reuses the same send_email()/SMTP transport as
    invite/status emails instead of the previous print()-only stub."""
    subject = f"{settings.APP_NAME} — Your login verification code"
    text_body = (
        f"Your one-time verification code is: {otp_code}\n\n"
        f"This code expires in {settings.OTP_EXPIRE_MINUTES} minutes. "
        "If you didn't request this, you can safely ignore this email."
    )
    body_html = f"""
      <p style="color:#374151;font-size:15px;line-height:1.6;">Your one-time verification code is:</p>
      <div style="text-align:center;margin:28px 0;">
        <span style="display:inline-block;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;
                     padding:14px 28px;font-size:28px;letter-spacing:6px;font-weight:700;color:#111827;">{otp_code}</span>
      </div>
      <p style="color:#6b7280;font-size:14px;">This code expires in {settings.OTP_EXPIRE_MINUTES} minutes.
      If you didn't request this, you can safely ignore this email.</p>
    """
    html_body = _wrap_html(accent="#1a56db", heading="Verification Code", body_html=body_html)
    return await send_email(to=to_email, subject=subject, html_body=html_body, text_body=text_body, template="otp")


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
    """Invite a candidate to a pre-interview assessment step — link + instructions
    only, no scores (same rule as the interview invite)."""
    assessment_url = f"{settings.FRONTEND_URL}/interview/{secure_token}"
    subject = f"Assessment Invitation — {job_title}"
    text_body = f"""Dear {candidate_name},

As the next step for the {job_title} position, please complete your assessment using the link below.

  Assessment Link: {assessment_url}

This link is unique to you and expires in {settings.INVITE_LINK_EXPIRY_DAYS} days.

Best regards,
{settings.EMAIL_FROM_NAME}"""
    body_html = f"""
      <p style="color:#374151;font-size:16px;">Dear <strong>{candidate_name}</strong>,</p>
      <p style="color:#374151;font-size:15px;line-height:1.6;">
        As the next step for the <strong>{job_title}</strong> position, please complete your assessment using the link below.
      </p>
      <div style="text-align:center;margin:32px 0;">
        <a href="{assessment_url}" style="background:#7c3aed;color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:6px;font-size:16px;font-weight:600;display:inline-block;">
          Start Assessment &rarr;
        </a>
      </div>
      <p style="color:#6b7280;font-size:13px;">This link is unique to you and expires in {settings.INVITE_LINK_EXPIRY_DAYS} days.</p>
    """
    html_body = _wrap_html(accent="#7c3aed", heading="Assessment Invitation", body_html=body_html)

    try:
        override = await get_template_override("send_assessment_invitation_email")
        if override:
            _ctx = {
                "candidate_name": candidate_name,
                "job_title": job_title,
                "assessment_url": assessment_url,
                "invite_expiry_days": settings.INVITE_LINK_EXPIRY_DAYS,
                "email_from_name": settings.EMAIL_FROM_NAME,
            }
            if override.get("subject_template"):
                subject = render(override["subject_template"], _ctx)
            if override.get("html_body_template"):
                html_body = render(override["html_body_template"], _ctx)
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
) -> bool:
    """Offer letter template (salary/joining date/benefits as free text).

    `accept_url`, when provided, links to the candidate-facing accept/decline
    page (Offer Management, MVP2 §2.15) — rendered as a prominent button/link
    in both bodies, same visual pattern as send_assessment_invitation_email's
    button in this file. Omitted at call sites that predate that feature, so
    existing behaviour is unchanged."""
    subject = f"Offer of Employment — {job_title}"
    company_line = f" at {company_name}" if company_name else ""
    details = []
    if salary:
        details.append(f"Compensation: {salary}")
    if joining_date:
        details.append(f"Joining date: {joining_date}")
    if benefits:
        details.append(f"Benefits: {benefits}")
    details_text = "\n".join(f"  {d}" for d in details)
    details_html = "".join(
        f'<p style="margin:4px 0;color:#111827;">{d}</p>' for d in details
    )
    accept_line = f"\n\nReview and respond to this offer:\n  {accept_url}\n" if accept_url else ""
    accept_html = (
        f"""
      <div style="text-align:center;margin:32px 0;">
        <a href="{accept_url}"
           style="background:#059669;color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:6px;font-size:16px;font-weight:600;display:inline-block;">
          Review and Respond to Offer &rarr;
        </a>
      </div>
    """
        if accept_url else ""
    )
    text_body = f"""Dear {candidate_name},

We are delighted to offer you the position of {job_title}{company_line}.

{details_text}
{accept_line}
Please reach out to your recruiter with any questions or to confirm acceptance.

Best regards,
{settings.EMAIL_FROM_NAME}"""
    body_html = f"""
      <p style="color:#374151;font-size:16px;">Dear <strong>{candidate_name}</strong>,</p>
      <p style="color:#374151;font-size:15px;line-height:1.6;">
        We are delighted to offer you the position of <strong>{job_title}</strong>{company_line}.
      </p>
      <table style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:16px 20px;margin:16px 0;width:100%;box-sizing:border-box;">
        <tr><td>{details_html or '<p style="margin:0;color:#111827;">Details to follow from your recruiter.</p>'}</td></tr>
      </table>
      {accept_html}
      <p style="color:#374151;font-size:15px;line-height:1.6;">
        Please reach out to your recruiter with any questions or to confirm your acceptance.
      </p>
    """
    html_body = _wrap_html(accent="#059669", heading="Offer of Employment", body_html=body_html)

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
                "email_from_name": settings.EMAIL_FROM_NAME,
            }
            if override.get("subject_template"):
                subject = render(override["subject_template"], _ctx)
            if override.get("html_body_template"):
                html_body = render(override["html_body_template"], _ctx)
            if override.get("text_body_template"):
                text_body = render(override["text_body_template"], _ctx)
    except Exception as exc:
        logger.warning("Email template override failed for send_offer_letter_email (using default): %s", exc)

    return await send_email(
        to=to_email, subject=subject, html_body=html_body, text_body=text_body,
        db=db, template="offer_letter", candidate_id=candidate_id, job_id=job_id,
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
    """Rejection notice. Same confidentiality rule as the status email — no
    scores, no evaluation content, just a respectful close-out."""
    subject = f"Update on your application — {job_title}"
    text_body = f"""Dear {candidate_name},

Thank you for your interest in the {job_title} position and for the time you invested in our process.

After careful consideration, we have decided to move forward with other candidates at this time.
We appreciate your interest in joining us and encourage you to apply for future openings that match your experience.

Best regards,
{settings.EMAIL_FROM_NAME}"""
    body_html = f"""
      <p style="color:#374151;font-size:16px;">Dear <strong>{candidate_name}</strong>,</p>
      <p style="color:#374151;font-size:15px;line-height:1.6;">
        Thank you for your interest in the <strong>{job_title}</strong> position and for the time you invested in our process.
      </p>
      <p style="color:#374151;font-size:15px;line-height:1.6;">
        After careful consideration, we have decided to move forward with other candidates at this time.
        We appreciate your interest in joining us and encourage you to apply for future openings that match your experience.
      </p>
    """
    html_body = _wrap_html(accent="#6b7280", heading="Application Update", body_html=body_html)

    try:
        override = await get_template_override("send_rejection_email")
        if override:
            _ctx = {
                "candidate_name": candidate_name,
                "job_title": job_title,
                "email_from_name": settings.EMAIL_FROM_NAME,
            }
            if override.get("subject_template"):
                subject = render(override["subject_template"], _ctx)
            if override.get("html_body_template"):
                html_body = render(override["html_body_template"], _ctx)
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
    """Covers both Reminder ("your interview link is still open") and
    Follow-up ("just checking in") — the two templates only differ in copy,
    driven by `kind`."""
    is_followup = kind == "follow_up"
    subject = f"{'Following up' if is_followup else 'Reminder'} — {job_title}"
    link_line = f"\n  Interview Link: {settings.FRONTEND_URL}/interview/{secure_token}\n" if secure_token else ""
    link_html = (
        f'<div style="text-align:center;margin:28px 0;"><a href="{settings.FRONTEND_URL}/interview/{secure_token}" '
        'style="background:#1a56db;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-size:15px;font-weight:600;display:inline-block;">Continue &rarr;</a></div>'
        if secure_token else ""
    )
    message = (
        "We wanted to follow up regarding your application and let you know we're still reviewing candidates."
        if is_followup
        else "This is a friendly reminder that your interview link is still open and awaiting completion."
    )
    text_body = f"""Dear {candidate_name},

Regarding the {job_title} position: {message}
{link_line}
Best regards,
{settings.EMAIL_FROM_NAME}"""
    body_html = f"""
      <p style="color:#374151;font-size:16px;">Dear <strong>{candidate_name}</strong>,</p>
      <p style="color:#374151;font-size:15px;line-height:1.6;">
        Regarding the <strong>{job_title}</strong> position: {message}
      </p>
      {link_html}
    """
    html_body = _wrap_html(accent="#d97706", heading="Following Up" if is_followup else "Reminder", body_html=body_html)

    try:
        override = await get_template_override("send_reminder_email")
        if override:
            _ctx = {
                "candidate_name": candidate_name,
                "job_title": job_title,
                "interview_url": f"{settings.FRONTEND_URL}/interview/{secure_token}" if secure_token else "",
                "kind": kind,
                "email_from_name": settings.EMAIL_FROM_NAME,
            }
            if override.get("subject_template"):
                subject = render(override["subject_template"], _ctx)
            if override.get("html_body_template"):
                html_body = render(override["html_body_template"], _ctx)
            if override.get("text_body_template"):
                text_body = render(override["text_body_template"], _ctx)
    except Exception as exc:
        logger.warning("Email template override failed for send_reminder_email (using default): %s", exc)

    return await send_email(
        to=to_email, subject=subject, html_body=html_body, text_body=text_body,
        db=db, template=kind, candidate_id=candidate_id, job_id=job_id,
    )
