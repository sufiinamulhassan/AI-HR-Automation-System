import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlsplit

from fastapi import HTTPException

from config.database import get_db
from config.settings import settings
from config.tenancy import current_company_id
from services.hr_module.email_service import send_reminder_email, send_offer_letter_email, valid_email_address
from services.hr_module.webhook_service import fire_webhook_event
from shared.links import base_url
from shared.rate_limit import enforce_rate_limit

logger = logging.getLogger(__name__)

_OPERATORS = {"eq", "neq", "gte", "lte", "contains"}

WORKFLOW_EMAIL_PER_HOUR = 200
_WORKFLOW_EMAIL_WINDOW_SECONDS = 3600
_LINK_TOKEN = re.compile(r"^[A-Za-z0-9_-]{1,128}$")

TRIGGER_CANDIDATE_INVITED = "candidate_invited"
TRIGGER_CANDIDATE_STATUS_CHANGED = "candidate_status_changed"
TRIGGER_INTERVIEW_COMPLETED = "interview_completed"
TRIGGER_OFFER_CREATED = "offer_created"
TRIGGER_OFFER_STATUS_CHANGED = "offer_status_changed"

TRIGGERS: list[dict] = [
    {"key": TRIGGER_CANDIDATE_INVITED, "label": "Candidate invited"},
    {"key": TRIGGER_CANDIDATE_STATUS_CHANGED, "label": "Candidate status changed"},
    {"key": TRIGGER_INTERVIEW_COMPLETED, "label": "Interview completed"},
    {"key": TRIGGER_OFFER_CREATED, "label": "Offer created"},
    {"key": TRIGGER_OFFER_STATUS_CHANGED, "label": "Offer status changed"},
]
_TRIGGER_TYPES = {t["key"] for t in TRIGGERS}
_ACTION_TYPES = {
    "send_email",
    "change_pipeline_stage",
    "fire_webhook",
    "approve_offer",
    "send_offer",
    "withdraw_offer",
}
_OFFER_ACTION_TYPES = {"approve_offer", "send_offer", "withdraw_offer"}

MAX_WORKFLOW_CHAIN_DEPTH = 3
_DEPTH_KEY = "_workflow_depth"


def _lookup(context: dict, field: str) -> Any:
    if "." not in field:
        return context.get(field)
    node: Any = context
    for part in field.split("."):
        if isinstance(node, dict) and part in node:
            node = node[part]
        else:
            return None
    return node


def evaluate_conditions(conditions: list[dict], context: dict) -> bool:
    if not conditions:
        return True

    for condition in conditions:
        field = condition.get("field")
        operator = condition.get("operator")
        expected = condition.get("value")

        if operator not in _OPERATORS:
            logger.warning("Unknown workflow operator ignored (non-match): %s", operator)
            return False

        actual = _lookup(context, field) if field else None

        if operator == "eq":
            if actual != expected:
                return False
        elif operator == "neq":
            if actual == expected:
                return False
        elif operator == "gte":
            try:
                if not (float(actual) >= float(expected)):
                    return False
            except (TypeError, ValueError):
                return False
        elif operator == "lte":
            try:
                if not (float(actual) <= float(expected)):
                    return False
            except (TypeError, ValueError):
                return False
        elif operator == "contains":
            try:
                if expected not in actual:
                    return False
            except TypeError:
                return False

    return True


def trusted_link(url: Any) -> str | None:
    text = str(url or "").strip()
    if not text or any(ord(ch) < 32 for ch in text):
        return None
    try:
        parts = urlsplit(text)
        host = (parts.hostname or "").lower()
        own_hosts = {
            (urlsplit(settings.FRONTEND_URL).hostname or "").lower(),
            (urlsplit(base_url()).hostname or "").lower(),
        }
    except ValueError:
        return None
    if parts.scheme.lower() != "https" or not host or host not in own_hosts or parts.username or parts.password:
        return None
    return text


async def _offer_link(action_params: dict, context: dict) -> str | None:
    supplied = action_params.get("accept_url")
    if not supplied:
        return None
    link = trusted_link(supplied)
    if link:
        return link
    logger.warning("send_email action: accept_url ignored, it is not a https link on the app's own host")
    offer_id = action_params.get("offer_id") or context.get("offer_id")
    if not offer_id:
        return None
    try:
        row = await get_db().offers.find_one({"offer_id": offer_id}, {"_id": 0, "secure_token": 1})
    except Exception as exc:
        logger.warning("send_email action: could not look up the offer link | error=%s", type(exc).__name__)
        return None
    token = (row or {}).get("secure_token")
    return f"{base_url()}/offer/{token}" if token and _LINK_TOKEN.match(str(token)) else None


async def _within_email_budget() -> bool:
    try:
        await enforce_rate_limit(
            get_db(), key=f"co:{current_company_id()}:workflow_email",
            limit=WORKFLOW_EMAIL_PER_HOUR, window_seconds=_WORKFLOW_EMAIL_WINDOW_SECONDS,
        )
        return True
    except HTTPException:
        return False
    except Exception as exc:
        logger.warning("Workflow email limiter unavailable, sending anyway | error=%s", type(exc).__name__)
        return True


async def _apply_send_email(action_params: dict, context: dict) -> None:
    to_email = action_params.get("to_email") or context.get("email") or context.get("candidate_email")
    candidate_name = action_params.get("candidate_name") or context.get("candidate_name", "Candidate")
    job_title = action_params.get("job_title") or context.get("job_title", "")
    if not to_email:
        logger.warning("send_email action skipped: no recipient email in action_params/context")
        return
    recipient = valid_email_address(to_email)
    if recipient is None:
        logger.warning("send_email action skipped: the recipient is not a valid email address")
        return
    if not await _within_email_budget():
        logger.warning(
            "send_email action skipped: this company reached its limit of %d workflow emails an hour",
            WORKFLOW_EMAIL_PER_HOUR,
        )
        return

    if action_params.get("email_kind") == "offer":
        await send_offer_letter_email(
            to_email=recipient,
            candidate_name=candidate_name,
            job_title=job_title,
            company_name=action_params.get("company_name") or context.get("company_name"),
            salary=action_params.get("salary"),
            joining_date=action_params.get("joining_date"),
            benefits=action_params.get("benefits"),
            accept_url=await _offer_link(action_params, context),
            candidate_id=action_params.get("candidate_id") or context.get("candidate_id"),
            job_id=action_params.get("job_id") or context.get("job_id"),
        )
    else:
        secure_token = action_params.get("secure_token") or context.get("secure_token")
        if secure_token and not _LINK_TOKEN.match(str(secure_token)):
            logger.warning("send_email action: secure_token ignored, it is not a link token")
            secure_token = None
        await send_reminder_email(
            to_email=recipient,
            candidate_name=candidate_name,
            job_title=job_title,
            secure_token=secure_token,
            kind=action_params.get("kind", "reminder"),
            candidate_id=action_params.get("candidate_id") or context.get("candidate_id"),
            job_id=action_params.get("job_id") or context.get("job_id"),
        )


async def _apply_change_pipeline_stage(db, action_params: dict, context: dict) -> None:
    candidate_id = action_params.get("candidate_id") or context.get("candidate_id")
    stage = action_params.get("stage")
    if not candidate_id or not stage:
        logger.warning("change_pipeline_stage action skipped: missing candidate_id/stage")
        return
    await db.candidates.update_one(
        {"candidate_id": candidate_id},
        {"$set": {
            "pipeline_stage": stage,
            "status": stage,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
    )


async def _apply_fire_webhook(action_type_params: dict, trigger_type: str, context: dict) -> None:
    event_type = action_type_params.get("event_type") or trigger_type
    await fire_webhook_event(event_type, context)


async def _apply_offer_action(action_type: str, action_params: dict, context: dict) -> None:
    from services.hr_module import offer_service

    offer_id = action_params.get("offer_id") or context.get("offer_id")
    if not offer_id:
        raise ValueError(
            f"{action_type} needs an offer_id: the '{action_type}' action only works on the "
            "offer_created / offer_status_changed triggers, or with an explicit "
            "offer_id in action_params"
        )

    depth = int(context.get(_DEPTH_KEY, 0)) + 1
    if action_type == "approve_offer":
        await offer_service.approve_offer(
            offer_id,
            approved_by=action_params.get("approved_by") or "workflow-automation",
            workflow_depth=depth,
        )
    elif action_type == "send_offer":
        await offer_service.send_offer(offer_id, workflow_depth=depth)
    elif action_type == "withdraw_offer":
        await offer_service.withdraw_offer(offer_id, workflow_depth=depth)


async def evaluate_and_apply_rules(trigger_type: str, context: dict) -> list[str]:
    db = get_db()
    if db is None:
        logger.warning("evaluate_and_apply_rules skipped: database unavailable")
        return []

    depth = int(context.get(_DEPTH_KEY, 0))

    applied: list[str] = []
    try:
        cursor = db.workflow_rules.find({"trigger_type": trigger_type, "is_active": True})
        rules = await cursor.to_list(length=None)
    except Exception as exc:
        logger.warning("evaluate_and_apply_rules failed to fetch rules for trigger_type=%s: %s", trigger_type, exc)
        return []

    for rule in rules:
        rule_id = rule.get("rule_id")
        try:
            if not evaluate_conditions(rule.get("conditions") or [], context):
                continue
        except Exception as exc:
            logger.warning("Workflow rule %s condition evaluation failed: %s", rule_id, exc)
            continue

        action_type = rule.get("action_type")
        action_params = rule.get("action_params") or {}

        if action_type in _OFFER_ACTION_TYPES and depth >= MAX_WORKFLOW_CHAIN_DEPTH:
            logger.warning(
                "Workflow rule %s (%s) skipped: offer action chain reached depth %d "
                "(limit %d). Check for a rule cycle.",
                rule_id, action_type, depth, MAX_WORKFLOW_CHAIN_DEPTH,
            )
            continue

        try:
            if action_type == "send_email":
                await _apply_send_email(action_params, context)
            elif action_type == "change_pipeline_stage":
                await _apply_change_pipeline_stage(db, action_params, context)
            elif action_type == "fire_webhook":
                await _apply_fire_webhook(action_params, trigger_type, context)
            elif action_type in _OFFER_ACTION_TYPES:
                await _apply_offer_action(action_type, action_params, context)
            else:
                logger.warning("Workflow rule %s has unknown action_type=%s", rule_id, action_type)
                continue
            applied.append(rule_id)
        except Exception as exc:
            logger.warning("Workflow rule %s action failed (non-fatal): %s", rule_id, exc)
            continue

    return applied


async def send_pending_reminders(reminder_after_hours: int = 72) -> int:
    db = get_db()
    if db is None:
        return 0

    cutoff = (datetime.now(timezone.utc) - timedelta(hours=reminder_after_hours)).isoformat()

    query = {
        "pipeline_stage": "invited",
        "invite_sent_at": {"$lte": cutoff},
        "$or": [
            {"last_reminder_sent_at": {"$exists": False}},
            {"last_reminder_sent_at": None},
            {"last_reminder_sent_at": {"$lte": cutoff}},
        ],
    }

    sent_count = 0
    cursor = db.candidates.find(query)
    async for cand in cursor:
        candidate_id = cand.get("candidate_id")
        to_email = cand.get("email") or cand.get("candidate_email")
        if not to_email:
            continue
        try:
            job = await db.jobs.find_one({"job_id": cand.get("job_id")}) or {}
            ok = await send_reminder_email(
                to_email=to_email,
                candidate_name=cand.get("candidate_name") or cand.get("name") or "Candidate",
                job_title=job.get("title", ""),
                secure_token=cand.get("secure_token"),
                kind="reminder",
                candidate_id=candidate_id,
                job_id=cand.get("job_id"),
            )
            if ok:
                await db.candidates.update_one(
                    {"candidate_id": candidate_id},
                    {"$set": {"last_reminder_sent_at": datetime.now(timezone.utc).isoformat()}},
                )
                sent_count += 1
        except Exception as exc:
            logger.warning("Reminder send failed for candidate %s: %s", candidate_id, exc)
            continue

    return sent_count
