"""Email Template Configuration service — hr_module Admin Configuration (MVP2 §2.20 slice).

Lets an admin override the subject/HTML/plain-text body of the 6 existing
candidate-facing send functions in `services/hr_module/email_service.py`
(send_invite_email, send_interview_status_email,
send_assessment_invitation_email, send_offer_letter_email,
send_rejection_email, send_reminder_email) without a code deploy.

Storage: a single `email_templates` collection, one document per known
template `key`, holding only the override. **Absence of a document is the
normal, expected state** — every one of the 6 owning send functions in
email_service.py calls `get_template_override(key)` first and falls back to
its own hardcoded subject/html_body/text_body construction completely
unchanged whenever this returns `None` (no DB, no override document, or a
lookup error), so this module can never make any existing email send behave
worse than before it existed — same fallback contract as
`services/hr_module/prompt_config_service.py`.

Unlike the prompt-config module, there is no single static "default template
string" to expose per key here — each send function builds its default
subject/HTML/text procedurally (optional blocks like a company line, an
accept-offer button, etc.), not from one `.format()`-able constant. So
`list_templates()`/`get_template_detail()` report only whether a key is
currently customized (an override document exists) plus its metadata; the
admin editor starts blank (falls through to the built-in default) until the
admin explicitly writes an override.

CRITICAL: candidate-facing
emails must never contain scores, recommendations, or interview report
content — full stop. This module has no way to enforce that against
arbitrary admin-authored text at runtime (a content filter would be trivially
bypassable and unreliable). The enforcement mechanism is a prominent warning
shown directly above the editor for every candidate-facing template key in
the admin UI (src/pages/admin/platform/EmailTemplatesPanel.tsx — the Email
Templates tab of Platform Settings), not a backend check.
"""
import logging
import re
from datetime import datetime, timezone

from config.database import get_db

logger = logging.getLogger(__name__)

TEMPLATE_KEYS: dict[str, dict] = {
    "send_invite_email": {
        "label": "Interview Invitation",
        "description": (
            "Sent to a shortlisted candidate with their unique interview link. "
            "Link + instructions only — used by services/hr_module/email_service.py."
        ),
        "candidate_facing": True,
        "placeholders": [
            "candidate_name", "job_title", "company_name", "interview_url",
            "interview_duration_minutes", "invite_expiry_days", "email_from_name",
        ],
    },
    "send_interview_status_email": {
        "label": "Post-Interview Status",
        "description": (
            "Sent automatically after a candidate completes their interview. "
            "Confirms receipt only — NO scores, NO recommendation, NO report content."
        ),
        "candidate_facing": True,
        "placeholders": ["candidate_name", "job_title", "email_from_name"],
    },
    "send_assessment_invitation_email": {
        "label": "Assessment Invitation",
        "description": (
            "Invites a candidate to a pre-interview assessment step. "
            "Link + instructions only."
        ),
        "candidate_facing": True,
        "placeholders": [
            "candidate_name", "job_title", "assessment_url", "invite_expiry_days", "email_from_name",
        ],
    },
    "send_offer_letter_email": {
        "label": "Offer Letter",
        "description": (
            "Sent when an offer is extended to a candidate. May include salary/benefits/"
            "joining date and an acceptance link."
        ),
        "candidate_facing": True,
        "placeholders": [
            "candidate_name", "job_title", "company_name", "salary", "joining_date",
            "benefits", "accept_url", "email_from_name",
        ],
    },
    "send_rejection_email": {
        "label": "Rejection Notice",
        "description": (
            "Sent when a candidate is not moving forward. A respectful close-out "
            "only — NO evaluation content, NO scores."
        ),
        "candidate_facing": True,
        "placeholders": ["candidate_name", "job_title", "email_from_name"],
    },
    "send_reminder_email": {
        "label": "Reminder / Follow-up",
        "description": (
            "Sent to nudge a candidate whose interview link is still open (reminder), "
            "or as a general check-in (follow-up, kind='follow_up')."
        ),
        "candidate_facing": True,
        "placeholders": [
            "candidate_name", "job_title", "interview_url", "kind", "email_from_name",
        ],
    },
}


def render(template_string: str | None, context: dict) -> str:
    """Plain, non-dynamic ``{{placeholder}}`` substitution.

    Deliberately NOT a templating engine — no eval(), no exec(), no Jinja2,
    no arbitrary expression evaluation of any kind. This is a plain
    string-replace loop over the caller-supplied `context` dict's known
    keys: each ``{{key}}`` (tolerant of surrounding whitespace, e.g. both
    ``{{name}}`` and ``{{ name }}``) is replaced with ``str(value)``; a
    value of ``None`` renders as an empty string. A placeholder that appears
    in the template but has no matching context key is left untouched
    (visible literal text) rather than raising, so a typo in an
    admin-authored template degrades visibly instead of crashing a send.
    """
    if not template_string:
        return template_string or ""
    result = str(template_string)
    for key, value in (context or {}).items():
        pattern = re.compile(r"\{\{\s*" + re.escape(str(key)) + r"\s*\}\}")
        replacement = "" if value is None else str(value)
        result = pattern.sub(lambda _m, _r=replacement: _r, result)
    return result


async def get_template_override(key: str) -> dict | None:
    """Return the override document for `key`, or None if no override exists
    (no DB, no document, or a transient lookup error) — the universal signal
    for "caller should use its own hardcoded default instead." Never raises.
    """
    try:
        db = get_db()
        if db is None:
            return None
        return await db.email_templates.find_one({"key": key}, {"_id": 0})
    except Exception as exc:
        logger.warning("get_template_override failed (key=%s), falling back to default: %s", key, exc)
        return None


async def list_templates() -> list[dict]:
    """Every known template key with its metadata plus enough state for an
    admin UI to show what's customized vs. default. Never raises — a DB
    read failure degrades to reporting every key as non-customized."""
    db = get_db()
    overrides: dict[str, dict] = {}
    if db is not None:
        try:
            cursor = db.email_templates.find({}, {"_id": 0})
            async for doc in cursor:
                overrides[doc["key"]] = doc
        except Exception as exc:
            logger.warning("list_templates DB read failed (non-fatal): %s", exc)

    results = []
    for key, meta in TEMPLATE_KEYS.items():
        override = overrides.get(key)
        results.append(_shape_template(key, meta, override))
    return results


async def get_template_detail(key: str) -> dict | None:
    if key not in TEMPLATE_KEYS:
        return None
    override = await get_template_override(key)
    return _shape_template(key, TEMPLATE_KEYS[key], override)


def _shape_template(key: str, meta: dict, override: dict | None) -> dict:
    override = override or {}
    return {
        "key": key,
        "label": meta["label"],
        "description": override.get("description") or meta["description"],
        "candidate_facing": meta["candidate_facing"],
        "placeholders": meta["placeholders"],
        "is_customized": bool(override),
        "subject_template": override.get("subject_template"),
        "html_body_template": override.get("html_body_template"),
        "text_body_template": override.get("text_body_template"),
        "updated_by": override.get("updated_by"),
        "updated_at": override.get("updated_at"),
    }


async def upsert_template(
    key: str,
    *,
    subject_template: str | None,
    html_body_template: str | None,
    text_body_template: str | None,
    description: str | None,
    updated_by: str,
) -> dict:
    if key not in TEMPLATE_KEYS:
        raise KeyError(f"Unknown email template key: {key}")
    db = get_db()
    if db is None:
        raise RuntimeError("Database unavailable")

    now = datetime.now(timezone.utc).isoformat()
    fields = {
        "key": key,
        "subject_template": subject_template or None,
        "html_body_template": html_body_template or None,
        "text_body_template": text_body_template or None,
        "description": description or None,
        "placeholder_docs": TEMPLATE_KEYS[key]["placeholders"],
        "updated_by": updated_by,
        "updated_at": now,
    }
    await db.email_templates.update_one(
        {"key": key},
        {"$set": fields, "$setOnInsert": {"created_at": now}},
        upsert=True,
    )
    return await get_template_detail(key)


async def reset_template(key: str) -> bool:
    """Delete the override document so the hardcoded default takes over
    again. Returns True if a document was actually removed."""
    if key not in TEMPLATE_KEYS:
        raise KeyError(f"Unknown email template key: {key}")
    db = get_db()
    if db is None:
        return False
    result = await db.email_templates.delete_one({"key": key})
    return result.deleted_count > 0
