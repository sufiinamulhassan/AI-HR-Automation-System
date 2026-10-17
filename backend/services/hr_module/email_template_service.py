import logging
import re
from datetime import datetime, timezone

from config.database import get_db
from services.hr_module.email_template_samples import PREVIEW_VALUES, SAMPLES

logger = logging.getLogger(__name__)

TEMPLATE_KEYS: dict[str, dict] = {
    "send_invite_email": {
        "label": "Interview Invitation",
        "description": (
            "Sent to a shortlisted candidate with their unique interview link. "
            "Link and instructions only."
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
            "Confirms receipt only. No scores, recommendation or report content."
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
            "only: NO evaluation content, NO scores."
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
    "send_external_interview_email": {
        "label": "Interview on Another Platform",
        "description": (
            "Sent when an interview is set up, or changed, on Zoom, Google Meet, "
            "Microsoft Teams or another platform. Meeting details only: the platform, "
            "the time, the join link and the recruiter's note. NO scores, NO review "
            "content. {{lead}} is the opening sentence (it changes when the details "
            "are updated) and {{when}} is the time in UTC, plus the recruiter's "
            "timezone when one was set. {{notes}} is empty when there is no note."
        ),
        "candidate_facing": True,
        "placeholders": [
            "candidate_name", "job_title", "company_name", "platform", "when",
            "duration_minutes", "join_url", "notes", "lead", "email_from_name",
        ],
    },
}


TEMPLATE_KEYS["send_physical_interview_email"] = {
    "label": "Physical Interview Call",
    "description": (
        "Sent when an interview is set up, or changed, to be held in person. The time, how long it "
        "takes and the place, with a link that opens the place in a map and the recruiter's note. "
        "NO scores, NO review content. {{lead}} is the opening sentence (it changes when the details "
        "are updated) and {{when}} is the time in UTC, plus the recruiter's timezone when one was set. "
        "{{notes}} is empty when there is no note."
    ),
    "candidate_facing": True,
    "placeholders": [
        "candidate_name", "job_title", "company_name", "when", "duration_minutes", "location",
        "map_url", "notes", "lead", "email_from_name",
    ],
}

BRAND_PLACEHOLDERS = ("brand_color", "brand_on_color", "brand_logo_html")
for _meta in TEMPLATE_KEYS.values():
    _meta["placeholders"] = [*_meta["placeholders"], *BRAND_PLACEHOLDERS]


def render(template_string: str | None, context: dict) -> str:
    if not template_string:
        return template_string or ""
    result = str(template_string)
    for key, value in (context or {}).items():
        pattern = re.compile(r"\{\{\s*" + re.escape(str(key)) + r"\s*\}\}")
        replacement = "" if value is None else str(value)
        result = pattern.sub(lambda _m, _r=replacement: _r, result)
    return result


async def get_template_override(key: str) -> dict | None:
    try:
        db = get_db()
        if db is None:
            return None
        return await db.email_templates.find_one({"key": key}, {"_id": 0})
    except Exception as exc:
        logger.warning("get_template_override failed (key=%s), falling back to default: %s", key, exc)
        return None


async def list_templates() -> list[dict]:
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
        "sample_subject_template": SAMPLES[key]["subject"],
        "sample_html_body_template": SAMPLES[key]["html"],
        "sample_text_body_template": SAMPLES[key]["text"],
        "preview_values": {p: PREVIEW_VALUES[p] for p in meta["placeholders"] if p in PREVIEW_VALUES},
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
    if key not in TEMPLATE_KEYS:
        raise KeyError(f"Unknown email template key: {key}")
    db = get_db()
    if db is None:
        return False
    result = await db.email_templates.delete_one({"key": key})
    return result.deleted_count > 0
