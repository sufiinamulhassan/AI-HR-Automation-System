import asyncio
import logging
import re
from datetime import datetime, timedelta, timezone

from config.database import get_db
from shared.utils import mongo_doc

logger = logging.getLogger(__name__)

SINGLETON_ID = "singleton"

NOTIFICATION_EVENTS: list[dict] = [
    {
        "event": "offer_declined",
        "label": "Offer Declined",
        "description": "A candidate declines a sent offer letter.",
    },
    {
        "event": "candidate_flagged_for_integrity",
        "label": "Candidate Flagged for Integrity",
        "description": "An interview's integrity score falls low enough to warrant review.",
    },
    {
        "event": "job_import_failed",
        "label": "Job Import Failed",
        "description": "A multi-source job import (scheduled or manual) fails.",
    },
    {
        "event": "coding_submission_execution_failed",
        "label": "Coding Submission Execution Failed",
        "description": "Judge0 execution errors out for a candidate's code submission.",
    },
    {
        "event": "webhook_delivery_failed",
        "label": "Webhook Delivery Failed",
        "description": "An outbound webhook delivery fails.",
    },
]
_VALID_EVENTS = {e["event"] for e in NOTIFICATION_EVENTS}
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _default_doc() -> dict:
    now = datetime.now(timezone.utc).isoformat()
    return {
        "_id": SINGLETON_ID,
        "notify_email": "",
        "events": {event: False for event in _VALID_EVENTS},
        "created_at": now,
        "updated_at": now,
    }


def _with_catalog(doc: dict) -> dict:
    stored_events = doc.get("events") or {}
    events = [
        {**meta, "enabled": bool(stored_events.get(meta["event"], False))}
        for meta in NOTIFICATION_EVENTS
    ]
    return {
        "notify_email": doc.get("notify_email") or "",
        "events": events,
        "updated_at": doc.get("updated_at"),
    }


async def get_notification_settings() -> dict:
    db = get_db()
    if db is None:
        logger.warning("get_notification_settings: database unavailable, returning in-memory defaults")
        return _with_catalog(_default_doc())

    doc = await db.notification_settings.find_one({"_id": SINGLETON_ID})
    if doc is not None:
        return _with_catalog(mongo_doc(doc))

    fresh = _default_doc()
    try:
        await db.notification_settings.insert_one(dict(fresh))
    except Exception as exc:
        logger.info("notification_settings singleton insert race, re-reading: %s", exc)
        existing = await db.notification_settings.find_one({"_id": SINGLETON_ID})
        if existing is not None:
            return _with_catalog(mongo_doc(existing))
    return _with_catalog(fresh)


async def update_notification_settings(
    notify_email: str | None,
    events: dict[str, bool] | None,
    updated_by: str | None = None,
) -> dict:
    if notify_email is not None and notify_email != "" and not _EMAIL_RE.match(notify_email):
        raise ValueError("notify_email must be a valid email address")

    clean_events: dict[str, bool] = {}
    if events:
        clean_events = {k: bool(v) for k, v in events.items() if k in _VALID_EVENTS}

    db = get_db()
    if db is None:
        logger.warning("update_notification_settings: database unavailable, update not persisted")
        merged = _default_doc()
        if notify_email is not None:
            merged["notify_email"] = notify_email
        merged["events"].update(clean_events)
        return _with_catalog(merged)

    await get_notification_settings()
    current_doc = await db.notification_settings.find_one({"_id": SINGLETON_ID}) or _default_doc()
    current_events = dict(current_doc.get("events") or {})
    current_events.update(clean_events)

    update: dict = {"events": current_events, "updated_at": datetime.now(timezone.utc).isoformat()}
    if notify_email is not None:
        update["notify_email"] = notify_email
    if updated_by:
        update["updated_by"] = updated_by

    await db.notification_settings.update_one({"_id": SINGLETON_ID}, {"$set": update}, upsert=True)
    doc = await db.notification_settings.find_one({"_id": SINGLETON_ID})
    return _with_catalog(mongo_doc(doc)) if doc is not None else _with_catalog(_default_doc())


NOTIFY_TIMEOUT_SECONDS = 5.0
THROTTLE_SECONDS = 3600
NOTIFICATION_TEMPLATE = "admin_notification"

INTEGRITY_ALERT_BELOW = 70
_INTEGRITY_ALERT_FLAGS = ("identity_mismatch", "phone_detected")
_REASON_TEXT = {
    "low_integrity_score": "low integrity score",
    "identity_mismatch": "identity mismatch",
    "phone_detected": "phone detected",
}

_EVENT_COPY: dict[str, tuple[str, str, str]] = {
    "offer_declined": ("Offer declined", "A candidate declined an offer.", "offer_id"),
    "candidate_flagged_for_integrity": (
        "Interview flagged for integrity review",
        "A submitted interview was flagged for integrity review.",
        "candidate_id",
    ),
    "job_import_failed": ("Job import failed", "A job import failed.", "source"),
    "coding_submission_execution_failed": (
        "Coding submission could not be run",
        "A coding submission could not be executed in the code sandbox.",
        "candidate_id",
    ),
    "webhook_delivery_failed": ("Webhook delivery failed", "A webhook delivery failed.", "webhook_id"),
}

_DETAIL_MAX = 200


def integrity_alert_reasons(flags) -> list[str]:
    from services.hr_module.integrity import compute_integrity_score

    flag_list = [str(f) for f in (flags or [])]
    events = {f.split("@", 1)[0] for f in flag_list}
    reasons: list[str] = []
    if compute_integrity_score(flag_list) < INTEGRITY_ALERT_BELOW:
        reasons.append("low_integrity_score")
    reasons.extend(name for name in _INTEGRITY_ALERT_FLAGS if name in events)
    return reasons


MAX_RECIPIENTS = 10


def _recipients(notify_email: str | None) -> list[str]:
    parts = re.split(r"[,;\s]+", notify_email or "")
    return [p for p in parts if p and _EMAIL_RE.match(p)][:MAX_RECIPIENTS]


def _pair(name, ident) -> str | None:
    if name and ident:
        return f"{name} ({ident})"
    return str(name or ident) if (name or ident) else None


async def _enrich_context(db, context: dict) -> dict:
    ctx = dict(context)
    try:
        cand = None
        if ctx.get("candidate_id") and not (ctx.get("candidate_name") and ctx.get("job_id")):
            cand = await db.candidates.find_one(
                {"candidate_id": ctx["candidate_id"]}, {"_id": 0, "name": 1, "job_id": 1},
            )
            if cand:
                ctx.setdefault("candidate_name", cand.get("name"))
                ctx.setdefault("job_id", cand.get("job_id"))
        if ctx.get("job_id") and not ctx.get("job_title"):
            job = await db.jobs.find_one({"job_id": ctx["job_id"]}, {"_id": 0, "title": 1})
            if job:
                ctx["job_title"] = job.get("title")
        if ctx.get("question_id") and not ctx.get("question_title"):
            question = await db.coding_questions.find_one({"question_id": ctx["question_id"]}, {"_id": 0, "title": 1})
            if question:
                ctx["question_title"] = question.get("title")
    except Exception as exc:
        logger.info("notification context enrichment skipped: %s", type(exc).__name__)
    return ctx


def build_notification(event: str, context: dict) -> tuple[str, str, str]:
    from html import escape

    from config.settings import settings
    from shared.links import base_url
    from shared.scrub import scrub_secrets

    title, summary, _ = _EVENT_COPY[event]
    reasons = [_REASON_TEXT.get(r, str(r)) for r in (context.get("reasons") or [])]
    rows = [
        ("Event", event),
        ("Candidate", _pair(context.get("candidate_name"), context.get("candidate_id"))),
        ("Job", _pair(context.get("job_title"), context.get("job_id"))),
        ("Offer", context.get("offer_id")),
        ("Question", _pair(context.get("question_title"), context.get("question_id"))),
        ("Source", context.get("source")),
        ("Webhook", context.get("webhook_id")),
        ("Target host", context.get("webhook_host")),
        ("Webhook event", context.get("webhook_event")),
        ("Reason", ", ".join(reasons) if reasons else None),
        ("Detail", scrub_secrets(context.get("detail"), limit=_DETAIL_MAX)),
    ]
    rows = [(label, str(value)) for label, value in rows if value]

    subject = f"{settings.APP_NAME} alert: {title}"
    text_lines = [summary, ""] + [f"{label}: {value}" for label, value in rows]
    text_lines += ["", f"Sign in to review: {base_url()}", "", "This is an automated notification."]
    html_rows = "".join(
        f'<p style="margin:4px 0;color:#111827;"><strong>{escape(label)}:</strong> {escape(value)}</p>'
        for label, value in rows
    )
    html = (
        f'<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;">'
        f'<h2 style="margin:0 0 12px;color:#111827;">{escape(title)}</h2>'
        f'<p style="color:#374151;">{escape(summary)}</p>{html_rows}'
        f'<p style="color:#374151;margin-top:16px;">Sign in to review: {escape(base_url())}</p>'
        f'<p style="color:#9ca3af;font-size:12px;">This is an automated notification.</p></div>'
    )
    return subject, "\n".join(text_lines), html


async def _claim_throttle(db, event: str, reference: str) -> str | None:
    from pymongo.errors import DuplicateKeyError

    now = datetime.now(timezone.utc)
    key = f"{event}:{reference}"
    fresh = {"sent_at": now, "expires_at": now + timedelta(seconds=THROTTLE_SECONDS)}
    log = db.notification_log
    try:
        result = await log.update_one(
            {"_id": key, "sent_at": {"$lte": now - timedelta(seconds=THROTTLE_SECONDS)}},
            {"$set": fresh, "$inc": {"count": 1}},
        )
        if result.matched_count:
            return key
        await log.insert_one({"_id": key, "event": event, "reference": str(reference), "count": 1, **fresh})
        return key
    except DuplicateKeyError:
        return None
    except Exception as exc:
        logger.warning("notification throttle unavailable, sending anyway | event=%s error=%s", event, type(exc).__name__)
        return ""


async def _release_throttle(db, key: str) -> None:
    if not key:
        return
    try:
        await db.notification_log.delete_one({"_id": key})
    except Exception as exc:
        logger.info("notification throttle release skipped: %s", type(exc).__name__)


async def _dispatch(event: str, context: dict) -> bool:
    if event not in _EVENT_COPY:
        logger.warning("notify: unknown event %r ignored", event)
        return False
    db = get_db()
    if db is None:
        return False

    doc = await db.notification_settings.find_one({"_id": SINGLETON_ID})
    if not doc or not (doc.get("events") or {}).get(event):
        return False
    recipients = _recipients(doc.get("notify_email"))
    if not recipients:
        return False

    reference = context.get("reference") or context.get(_EVENT_COPY[event][2]) or "all"
    key = await _claim_throttle(db, event, str(reference))
    if key is None:
        return False

    from services.hr_module.email_service import send_email

    subject, text_body, html_body = build_notification(event, await _enrich_context(db, context))
    delivered = False
    try:
        for address in recipients:
            if await send_email(
                to=address, subject=subject, html_body=html_body, text_body=text_body,
                db=db, template=NOTIFICATION_TEMPLATE,
            ):
                delivered = True
    finally:
        if not delivered:
            await _release_throttle(db, key)
    return delivered


async def notify(event: str, context: dict | None = None) -> bool:
    try:
        return await asyncio.wait_for(_dispatch(event, dict(context or {})), timeout=NOTIFY_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        logger.warning("notify timed out | event=%s", event)
    except Exception as exc:
        logger.warning("notify failed | event=%s error=%s", event, type(exc).__name__)
    return False


async def send_test_notification(db) -> dict:
    from config.settings import settings
    from services.hr_module.email_delivery_service import active_provider
    from services.hr_module.email_service import scrub_error_text, send_email

    doc = await db.notification_settings.find_one({"_id": SINGLETON_ID}) or {}
    recipients = _recipients(doc.get("notify_email"))
    if not recipients:
        return {"sent": False, "to": None, "detail": "Set a notification email address first."}
    to = ", ".join(recipients)

    provider = await active_provider()
    if provider is None:
        return {
            "sent": False, "to": to,
            "detail": "No email provider is configured: set EMAIL_HOST for SMTP or enable AWS SES. Nothing was sent.",
        }

    subject = f"{settings.APP_NAME} notification test"
    text_body = (
        f"This is a test notification from {settings.APP_NAME}.\n\n"
        "If you received it, alerts for the events you switched on will reach this address."
    )
    html_body = (
        f"<p>This is a test notification from {settings.APP_NAME}.</p>"
        "<p>If you received it, alerts for the events you switched on will reach this address.</p>"
    )
    delivered = 0
    try:
        for address in recipients:
            if await send_email(
                to=address, subject=subject, html_body=html_body, text_body=text_body,
                db=db, template=NOTIFICATION_TEMPLATE,
            ):
                delivered += 1
    except Exception as exc:
        return {
            "sent": False, "to": to,
            "detail": f"Sending raised an error: {scrub_error_text(f'{type(exc).__name__}: {exc}')}",
        }
    if delivered == len(recipients):
        return {"sent": True, "to": to, "detail": f"The {provider.upper()} provider accepted the message for {to}."}
    return {
        "sent": False, "to": to,
        "detail": "The mail provider did not accept the message. Open Email Delivery to see why.",
    }
