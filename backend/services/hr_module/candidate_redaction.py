from __future__ import annotations

from typing import Any, Iterable

ADMIN_ROLES = frozenset({"admin", "superadmin"})


def is_admin_user(user: dict | None) -> bool:
    return (user or {}).get("role") in ADMIN_ROLES


ADMIN_ONLY_KEYS = frozenset({
    "report",
    "report_error",
    "score_breakdown",
    "eval_score",
    "final_score",
    "transcript",
    "integrity_flags",
    "coding_integrity_flags",
    "external_review",
    "interview_scorecards",
    "scorecards",
    "interview_guide",
    "decision_notes",
    "decision_reason",
    "recruiter_notes",
    "recruiter_notes_updated_by",
    "recruiter_notes_updated_at",
    "profile_notes",
    "secure_token",
    "_questions",
    "signature",
    "erasure",
})


CANDIDATE_FIELDS_FOR_NON_ADMIN = frozenset({
    "candidate_id", "doc_type", "job_id", "resume_id", "scenario_id",
    "name", "email", "phone", "linkedin_url", "application_source",
    "status", "pipeline_stage", "invite_type", "token_status", "session_active",
    "match_score",
    "invited_by", "invited_by_role",
    "created_at", "invite_sent_at", "invite_expires_at", "invite_resent_count",
    "invite_email_delivered", "last_resent_at", "token_regenerated_at",
    "interview_started_at", "interview_ended_at",
    "scheduled_start_at", "meeting_join_url",
    "interview_mode",
    "report_status",
    "decision", "decided_at",
    "coding_question_id",
    "erased", "erased_at",
})

EXTERNAL_INTERVIEW_FIELDS_FOR_NON_ADMIN = frozenset({
    "platform", "platform_label", "join_url", "location", "scheduled_start_at",
    "duration_minutes", "display_timezone", "status", "notes",
    "email_delivered", "resent_count", "meeting_created",
})

OFFER_FIELDS_FOR_NON_ADMIN = frozenset({
    "offer_id", "doc_type", "candidate_id", "job_id", "status",
    "salary", "benefits", "joining_date",
    "created_at", "updated_at", "sent_at", "responded_at",
})


def redact_candidate(user: dict | None, doc: dict | None) -> dict | None:
    if doc is None or is_admin_user(user):
        return doc
    out: dict[str, Any] = {k: v for k, v in doc.items() if k in CANDIDATE_FIELDS_FOR_NON_ADMIN}
    external = doc.get("external_interview")
    if isinstance(external, dict):
        out["external_interview"] = {
            k: v for k, v in external.items() if k in EXTERNAL_INTERVIEW_FIELDS_FOR_NON_ADMIN
        }
    if doc.get("interview_mode") == "external":
        out["review_submitted"] = bool(doc.get("external_review"))
    return out


def redact_candidates(user: dict | None, docs: Iterable[dict]) -> list[dict]:
    return [redact_candidate(user, d) for d in docs]


def redact_offer(user: dict | None, doc: dict | None) -> dict | None:
    if doc is None or is_admin_user(user):
        return doc
    return {k: v for k, v in doc.items() if k in OFFER_FIELDS_FOR_NON_ADMIN}


def redact_offers(user: dict | None, docs: Iterable[dict]) -> list[dict]:
    return [redact_offer(user, d) for d in docs]


def scrub_admin_only(user: dict | None, payload: Any) -> Any:
    if is_admin_user(user):
        return payload
    return _scrub(payload)


def _scrub(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _scrub(v) for k, v in value.items() if k not in ADMIN_ONLY_KEYS}
    if isinstance(value, list):
        return [_scrub(v) for v in value]
    return value
