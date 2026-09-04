"""
Analytics route — HR Analytics Dashboard (MVP2 §2.17, Phase 2B).

Single aggregate endpoint (GET /dashboard) that rolls up recruiter/pipeline
health metrics from across jobs, candidates and offers. Every sub-metric is
computed independently and wrapped in
its own try/except so a single failing aggregation degrades to a safe empty
shape instead of failing the whole dashboard.
"""
import logging
import statistics
from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from shared.auth import get_current_user
from config.database import get_db
from config.settings import settings

router = APIRouter()
logger = logging.getLogger(__name__)


def _parse_iso(value: str | None):
    """Best-effort ISO-8601 -> datetime, tolerant of a trailing 'Z'. None on failure."""
    if not value or not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return None


async def _jobs_active_vs_total(db) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    total = await db.jobs.count_documents({"doc_type": "job"})
    docs = await db.jobs.find({"doc_type": "job"}, {"_id": 0, "deadline_at": 1}).to_list(length=None)
    active = 0
    for d in docs:
        deadline_at = d.get("deadline_at")
        if not deadline_at or deadline_at > now:
            active += 1
    return {"active": active, "total": total}


async def _source_wise_applications(db) -> dict:
    agg = await db.candidates.aggregate([
        {"$group": {"_id": {"$ifNull": ["$application_source", "unspecified"]}, "count": {"$sum": 1}}},
    ]).to_list(length=None)
    return {r["_id"]: r["count"] for r in agg}


def _avg_time_to_hire(pairs: list[tuple[datetime, datetime]]) -> float | None:
    if not pairs:
        return None
    deltas = [(decided - invited).total_seconds() / 86400.0 for invited, decided in pairs]
    return round(sum(deltas) / len(deltas), 2)


async def _recruiter_performance(db) -> list:
    candidates = await db.candidates.find(
        {"doc_type": "candidate"},
        {"_id": 0, "invited_by": 1, "decision": 1, "invite_sent_at": 1, "decided_at": 1},
    ).to_list(length=None)

    groups: dict[str, list[dict]] = {}
    for c in candidates:
        recruiter = c.get("invited_by") or "system"
        groups.setdefault(recruiter, []).append(c)

    result = []
    for recruiter, docs in groups.items():
        invited = len(docs)
        hired_docs = [d for d in docs if d.get("decision") == "hire"]
        hired = len(hired_docs)
        pairs = []
        for d in hired_docs:
            inv = _parse_iso(d.get("invite_sent_at"))
            dec = _parse_iso(d.get("decided_at"))
            if inv and dec:
                pairs.append((inv, dec))
        result.append({
            "recruiter_email": recruiter,
            "invited": invited,
            "hired": hired,
            "avg_time_to_hire_days": _avg_time_to_hire(pairs),
        })
    result.sort(key=lambda r: r["invited"], reverse=True)
    return result


async def _time_to_hire(db) -> dict:
    hired = await db.candidates.find(
        {"doc_type": "candidate", "decision": "hire"},
        {"_id": 0, "invite_sent_at": 1, "decided_at": 1},
    ).to_list(length=None)

    deltas = []
    for d in hired:
        inv = _parse_iso(d.get("invite_sent_at"))
        dec = _parse_iso(d.get("decided_at"))
        if inv and dec:
            deltas.append((dec - inv).total_seconds() / 86400.0)

    if not deltas:
        return {"avg_days": None, "median_days": None, "sample_size": 0}
    return {
        "avg_days": round(sum(deltas) / len(deltas), 2),
        "median_days": round(statistics.median(deltas), 2),
        "sample_size": len(deltas),
    }


async def _offer_acceptance_rate(db) -> dict:
    agg = await db.offers.aggregate([
        {"$group": {"_id": "$status", "count": {"$sum": 1}}},
    ]).to_list(length=None)
    counts = {r["_id"]: r["count"] for r in agg}
    accepted = counts.get("accepted", 0)
    declined = counts.get("declined", 0)
    sent = accepted + declined + counts.get("sent", 0)
    denom = accepted + declined
    rate_pct = round(100 * accepted / denom, 1) if denom > 0 else None
    return {"sent": sent, "accepted": accepted, "declined": declined, "rate_pct": rate_pct}


async def _candidate_drop_off(db) -> list:
    stages = ["invited", "interviewing", "completed", "hired"]
    result = []
    prev_count = None
    for stage in stages:
        count = await db.candidates.count_documents({"status": stage})
        drop_pct = None
        if prev_count is not None:
            drop_pct = round(100 * (1 - count / prev_count), 1) if prev_count > 0 else None
        result.append({"stage": stage, "count": count, "drop_pct_from_prev": drop_pct})
        prev_count = count
    return result


async def _ai_recommendations(db) -> list:
    threshold = settings.AUTO_INVITE_THRESHOLD - 0.1
    jobs = await db.jobs.find(
        {"doc_type": "job"}, {"_id": 0, "candidate_pipeline": 1},
    ).to_list(length=None)
    count = 0
    for job in jobs:
        for entry in job.get("candidate_pipeline") or []:
            score = entry.get("similarity_score")
            if score is not None and score >= threshold and entry.get("pipeline_stage") == "matched":
                count += 1
    if count == 0:
        return []
    return [{
        "type": "uninvited_strong_matches",
        "message": f"{count} candidates score within 10% of the auto-invite threshold but haven't been invited yet",
        "count": count,
    }]


def _diversity_metrics() -> dict:
    return {
        "status": "insufficient_data",
        "note": (
            "No self-reported demographic data is collected today. This requires "
            "adding opt-in demographic fields to the candidate/application flow "
            "before it can be populated — do not infer demographics from name, "
            "photo, or any other proxy signal."
        ),
        "breakdown": None,
    }


@router.get("/dashboard")
async def analytics_dashboard(_: dict = Depends(get_current_user)):
    """HR Analytics Dashboard — one call, all metrics. Each sub-metric fails
    independently (safe empty/zero default) so a single bad aggregation never
    takes down the whole dashboard."""
    db = get_db()
    if db is None:
        return {
            "jobs_active_vs_total": {"active": 0, "total": 0},
            "source_wise_applications": {},
            "recruiter_performance": [],
            "time_to_hire": {"avg_days": None, "median_days": None, "sample_size": 0},
            "offer_acceptance_rate": {"sent": 0, "accepted": 0, "declined": 0, "rate_pct": None},
            "candidate_drop_off": [],
            "ai_recommendations": [],
            "diversity_metrics": _diversity_metrics(),
        }

    result: dict = {}

    try:
        result["jobs_active_vs_total"] = await _jobs_active_vs_total(db)
    except Exception as exc:
        logger.error("analytics: jobs_active_vs_total failed: %s", exc)
        result["jobs_active_vs_total"] = {"active": 0, "total": 0}

    try:
        result["source_wise_applications"] = await _source_wise_applications(db)
    except Exception as exc:
        logger.error("analytics: source_wise_applications failed: %s", exc)
        result["source_wise_applications"] = {}

    try:
        result["recruiter_performance"] = await _recruiter_performance(db)
    except Exception as exc:
        logger.error("analytics: recruiter_performance failed: %s", exc)
        result["recruiter_performance"] = []

    try:
        result["time_to_hire"] = await _time_to_hire(db)
    except Exception as exc:
        logger.error("analytics: time_to_hire failed: %s", exc)
        result["time_to_hire"] = {"avg_days": None, "median_days": None, "sample_size": 0}

    try:
        result["offer_acceptance_rate"] = await _offer_acceptance_rate(db)
    except Exception as exc:
        logger.error("analytics: offer_acceptance_rate failed: %s", exc)
        result["offer_acceptance_rate"] = {"sent": 0, "accepted": 0, "declined": 0, "rate_pct": None}

    try:
        result["candidate_drop_off"] = await _candidate_drop_off(db)
    except Exception as exc:
        logger.error("analytics: candidate_drop_off failed: %s", exc)
        result["candidate_drop_off"] = []

    try:
        result["ai_recommendations"] = await _ai_recommendations(db)
    except Exception as exc:
        logger.error("analytics: ai_recommendations failed: %s", exc)
        result["ai_recommendations"] = []

    result["diversity_metrics"] = _diversity_metrics()

    return result
