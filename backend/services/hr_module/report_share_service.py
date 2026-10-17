import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from config.settings import settings
from shared.links import base_url
from shared.utils import sha256_hex

logger = logging.getLogger(__name__)

COLLECTION = "report_shares"

_SCORE_LABELS = {
    "technical": "Technical",
    "communication": "Communication",
    "problem_solving": "Problem solving",
    "cultural_fit": "Cultural fit",
    "confidence": "Confidence",
}


class ShareNotFound(LookupError):
    pass


class ShareExpired(LookupError):
    pass


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_dt(value) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _is_expired(doc: dict) -> bool:
    expires_at = _parse_dt(doc.get("expires_at"))
    return bool(expires_at) and datetime.now(timezone.utc) > expires_at


def share_url(token: str) -> str:
    return f"{base_url().rstrip('/')}/report/shared/{token}"


def public_share_row(doc: dict) -> dict:
    return {
        "share_id": doc.get("share_id"),
        "candidate_id": doc.get("candidate_id"),
        "job_id": doc.get("job_id"),
        "created_by": doc.get("created_by"),
        "created_at": doc.get("created_at"),
        "expires_at": doc.get("expires_at"),
        "revoked": bool(doc.get("revoked")),
        "revoked_at": doc.get("revoked_at"),
        "revoked_by": doc.get("revoked_by"),
        "expired": _is_expired(doc),
        "active": not doc.get("revoked") and not _is_expired(doc),
        "view_count": int(doc.get("view_count") or 0),
        "last_viewed_at": doc.get("last_viewed_at"),
        "feedback": doc.get("feedback") or [],
    }


async def create_share(
    db,
    *,
    candidate_id: str,
    job_id: str | None,
    created_by: str | None,
    expires_in_days: int | None = None,
) -> tuple[str, dict]:
    days = int(expires_in_days) if expires_in_days else settings.REPORT_SHARE_EXPIRY_DAYS
    days = max(settings.REPORT_SHARE_MIN_EXPIRY_DAYS, min(settings.REPORT_SHARE_MAX_EXPIRY_DAYS, days))
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    doc = {
        "share_id": uuid.uuid4().hex,
        "token_hash": sha256_hex(token.encode("utf-8")),
        "candidate_id": candidate_id,
        "job_id": job_id,
        "created_by": created_by,
        "created_at": now.isoformat(),
        "expires_at": (now + timedelta(days=days)).isoformat(),
        "revoked": False,
        "revoked_at": None,
        "revoked_by": None,
        "view_count": 0,
        "last_viewed_at": None,
        "feedback": [],
    }
    await db[COLLECTION].insert_one(dict(doc))
    doc.pop("_id", None)
    return token, doc


async def list_shares_for_candidate(db, candidate_id: str) -> list[dict]:
    cursor = db[COLLECTION].find({"candidate_id": candidate_id}, {"_id": 0}).sort("created_at", -1)
    return [public_share_row(doc) async for doc in cursor]


async def get_share(db, share_id: str) -> dict | None:
    return await db[COLLECTION].find_one({"share_id": share_id}, {"_id": 0})


async def revoke_share(db, *, share_id: str, actor_email: str | None) -> dict | None:
    doc = await get_share(db, share_id)
    if not doc:
        return None
    if not doc.get("revoked"):
        now = _now_iso()
        await db[COLLECTION].update_one(
            {"share_id": share_id},
            {"$set": {"revoked": True, "revoked_at": now, "revoked_by": actor_email}},
        )
        doc.update({"revoked": True, "revoked_at": now, "revoked_by": actor_email})
    return public_share_row(doc)


async def resolve_active_share(db, token: str, *, count_view: bool = True) -> dict:
    if not token or len(token) > 300:
        raise ShareNotFound()
    doc = await db[COLLECTION].find_one({"token_hash": sha256_hex(token.encode("utf-8"))}, {"_id": 0})
    if not doc or doc.get("revoked"):
        raise ShareNotFound()
    if _is_expired(doc):
        raise ShareExpired()

    if count_view:
        now = _now_iso()
        await db[COLLECTION].update_one(
            {"share_id": doc["share_id"]},
            {"$inc": {"view_count": 1}, "$set": {"last_viewed_at": now}},
        )
        doc["view_count"] = int(doc.get("view_count") or 0) + 1
        doc["last_viewed_at"] = now
    return doc


async def add_feedback(
    db,
    *,
    share_id: str,
    reviewer_name: str | None,
    rating: int | None,
    comment: str,
) -> dict:
    entry = {
        "feedback_id": uuid.uuid4().hex,
        "reviewer_name": (reviewer_name or "").strip() or None,
        "rating": rating,
        "comment": comment.strip(),
        "created_at": _now_iso(),
    }
    await db[COLLECTION].update_one({"share_id": share_id}, {"$push": {"feedback": entry}})
    return entry


def _integrity_event_counts(flags: list[str]) -> list[dict]:
    counts: dict[str, int] = {}
    for flag in flags or []:
        event = str(flag).split("@", 1)[0]
        counts[event] = counts.get(event, 0) + 1
    return [{"event": event, "count": n} for event, n in sorted(counts.items())]


async def build_shared_report_view(db, candidate: dict) -> dict:
    report = candidate.get("report") or {}
    job = await db.jobs.find_one({"job_id": candidate.get("job_id")}, {"_id": 0, "title": 1}) or {}

    breakdown = report.get("score_breakdown") or {}
    has_integrity = report.get("source") != "interviewer_scorecard"
    dimensions = [
        {
            "key": dim.get("name"),
            "label": _SCORE_LABELS.get(
                dim.get("name"), str(dim.get("name") or "").replace("_", " ").capitalize(),
            ),
            "score": dim.get("score"),
            "weight": dim.get("weight"),
            "rationale": dim.get("rationale") or "",
        }
        for dim in breakdown.get("dimensions") or []
    ]

    scenario_scores = [
        {"key": f"scenario:{dim}", "label": str(dim).replace("_", " ").capitalize(), "value": val}
        for dim, val in (report.get("scenario_scores") or {}).items()
    ]

    return {
        "candidate_name": candidate.get("name") or "Candidate",
        "job_title": job.get("title") or "",
        "interview_date": candidate.get("interview_ended_at") or candidate.get("interview_started_at"),
        "evaluation_status": report.get("evaluation_status"),
        "overall_score": report.get("overall_score"),
        "final_score": report.get("final_score"),
        "recommendation": report.get("recommendation"),
        "summary": report.get("summary") or "",
        "strengths": list(report.get("strengths") or []),
        "areas_for_improvement": list(report.get("areas_for_improvement") or []),
        "dimensions": dimensions,
        "scenario_scores": scenario_scores,
        "coding_score": report.get("coding_score"),
        "coding_quality_score": report.get("coding_quality_score"),
        "integrity": {
            "score": report.get("integrity_score"),
            "assessment": (report.get("integrity_assessment") or "") if has_integrity else "",
            "multiplier": breakdown.get("integrity_multiplier") if has_integrity else None,
            "events": _integrity_event_counts(candidate.get("integrity_flags") or []),
        },
    }


__all__ = [
    "ShareNotFound",
    "ShareExpired",
    "share_url",
    "public_share_row",
    "create_share",
    "list_shares_for_candidate",
    "get_share",
    "revoke_share",
    "resolve_active_share",
    "add_feedback",
    "build_shared_report_view",
]
