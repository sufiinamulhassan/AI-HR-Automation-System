"""
Workflow automation engine — hr_module Workflow Automation (MVP2 §2.18).

Two building blocks:
  - evaluate_conditions(): pure, synchronous, no I/O. Evaluates a list of
    admin-authored {field, operator, value} conditions against a runtime
    context dict. ONLY a closed set of 5 comparison operators is supported
    (eq/neq/gte/lte/contains) — there is deliberately NO eval()/exec()/pickle
    or any other dynamic-code-execution path here, even though rule authors
    are admin-only. This is a hard security requirement, not a style choice.
  - evaluate_and_apply_rules(): async, fetches active `workflow_rules` docs
    for a trigger_type, evaluates each rule's conditions via
    evaluate_conditions(), and applies the configured action for every rule
    that matches.

Call-site contract for evaluate_and_apply_rules()
--------------------------------------------------
Wired in via fire-and-forget asyncio.create_task() at every real trigger
point: routes/candidates.py (create_candidate -> candidate_invited,
record_decision -> candidate_status_changed), services/hr_module/
invite_service.py (_create_and_invite, the auto-invite path -> also
candidate_invited), agents/interview_agent.py (persist_report_node ->
interview_completed), and services/hr_module/offer_service.py
(_fire_offer_status_changed, called from approve/send/withdraw/
respond_to_offer -> offer_status_changed). resume_processed is defined as a
recognised trigger_type but has no live call site yet — add one in
agents/resume_agent.py's storage node if a resume-level rule is ever needed.

    import asyncio
    from services.hr_module.workflow_engine import evaluate_and_apply_rules

    asyncio.create_task(evaluate_and_apply_rules(
        trigger_type="candidate_status_changed",   # one of the 5 trigger types below
        context={                                   # flat dict, whatever fields the
            "candidate_id": candidate_id,            # rules for that trigger might
            "job_id": job_id,                        # want to compare against —
            "status": new_status,                    # candidate_id is read by the
            "pipeline_stage": new_status,             # change_pipeline_stage action
            "score": overall_score,                   # if candidate_id isn't in
            ...                                        # action_params directly.
        },
    ))

Recognised trigger_type values: resume_processed | candidate_invited |
candidate_status_changed | interview_completed | offer_status_changed.
Fire-and-forget (asyncio.create_task) is intentional — rule evaluation must
never block or fail the request that triggered it.
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from config.database import get_db
from config.settings import settings
from services.hr_module.email_service import send_reminder_email, send_offer_letter_email
from services.hr_module.webhook_service import fire_webhook_event

logger = logging.getLogger(__name__)

_OPERATORS = {"eq", "neq", "gte", "lte", "contains"}
_TRIGGER_TYPES = {
    "resume_processed",
    "candidate_invited",
    "candidate_status_changed",
    "interview_completed",
    "offer_created",
    "offer_status_changed",
}
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
    """Flat lookup is the minimum bar; dot-path is a nice-to-have — support both.

    "a.b.c" walks nested dicts; a plain "a" falls back to a flat context.get.
    Missing keys at any point in the path resolve to None (a non-match for
    eq/neq unless the rule's value is itself None, and a non-match for
    gte/lte/contains since those coercions will fail cleanly).
    """
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
    """Pure function, no I/O, no eval/exec. ALL conditions must pass (AND).

    An empty conditions list matches unconditionally (a rule with no
    conditions is meant to fire on every occurrence of its trigger_type).
    """
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


async def _apply_send_email(action_params: dict, context: dict) -> None:
    """Dispatches to one of the two existing candidate-facing email helpers.

    Choice of template: `action_params['email_kind']` picks explicitly
    ('offer' -> send_offer_letter_email, anything else / omitted ->
    send_reminder_email since that's the general-purpose "nudge the
    candidate" template already covering reminder/follow_up copy via its
    own `kind` param). This keeps the rules engine from needing a new email
    template of its own — it just orchestrates the existing ones.
    """
    to_email = action_params.get("to_email") or context.get("email") or context.get("candidate_email")
    candidate_name = action_params.get("candidate_name") or context.get("candidate_name", "Candidate")
    job_title = action_params.get("job_title") or context.get("job_title", "")
    if not to_email:
        logger.warning("send_email action skipped — no recipient email in action_params/context")
        return

    if action_params.get("email_kind") == "offer":
        await send_offer_letter_email(
            to_email=to_email,
            candidate_name=candidate_name,
            job_title=job_title,
            company_name=action_params.get("company_name") or context.get("company_name"),
            salary=action_params.get("salary"),
            joining_date=action_params.get("joining_date"),
            benefits=action_params.get("benefits"),
            accept_url=action_params.get("accept_url"),
            candidate_id=action_params.get("candidate_id") or context.get("candidate_id"),
            job_id=action_params.get("job_id") or context.get("job_id"),
        )
    else:
        await send_reminder_email(
            to_email=to_email,
            candidate_name=candidate_name,
            job_title=job_title,
            secure_token=action_params.get("secure_token") or context.get("secure_token"),
            kind=action_params.get("kind", "reminder"),
            candidate_id=action_params.get("candidate_id") or context.get("candidate_id"),
            job_id=action_params.get("job_id") or context.get("job_id"),
        )


async def _apply_change_pipeline_stage(db, action_params: dict, context: dict) -> None:
    candidate_id = action_params.get("candidate_id") or context.get("candidate_id")
    stage = action_params.get("stage")
    if not candidate_id or not stage:
        logger.warning("change_pipeline_stage action skipped — missing candidate_id/stage")
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
    """Advance an offer through its lifecycle from a workflow rule (MVP2 §2.18).

    Imported inside the function because offer_service imports this module to
    fire its own triggers — a module-level import would be circular.

    `workflow_depth` is threaded into offer_service so the offer_status_changed
    event this action causes remembers how deep the chain already is. Without
    it, "on offer_status_changed → approve_offer" would recurse forever.

    ValueError from offer_service means an illegal transition (e.g. approving an
    already-sent offer). That is a rule authored against the wrong state, not a
    system fault, so it is logged and swallowed like any other rule failure.
    """
    from services.hr_module import offer_service

    offer_id = action_params.get("offer_id") or context.get("offer_id")
    if not offer_id:
        raise ValueError(
            f"{action_type} needs an offer_id — the '{action_type}' action only works on the "
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
    """Fetches active workflow_rules for trigger_type, applies matching ones.

    Returns the list of rule_ids that matched AND were applied. Each rule's
    action runs in its own try/except so one failing rule never stops the
    others from being evaluated/applied.
    """
    db = get_db()
    if db is None:
        logger.warning("evaluate_and_apply_rules skipped — database unavailable")
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
                "Workflow rule %s (%s) skipped — offer action chain reached depth %d "
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
    """Scans invited candidates whose invite is stale and nudges them.

    A candidate is "stale" when pipeline_stage == 'invited' and
    invite_sent_at is older than reminder_after_hours, AND either
    last_reminder_sent_at has never been set or is itself older than
    reminder_after_hours (so reminders repeat at the same cadence rather
    than firing once and never again).

    Not wired into any scheduler here — see manifest.other_edits for the
    future periodic-job registration this is meant to plug into.
    """
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
