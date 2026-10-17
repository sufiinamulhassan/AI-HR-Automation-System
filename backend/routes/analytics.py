import logging
import statistics
from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from shared.auth import get_current_user
from config.database import get_db
from config.settings import settings
from services.hr_module.candidate_scope import ResumeScope
from services.hr_module.permissions import resolve_permissions

router = APIRouter()
logger = logging.getLogger(__name__)


def _parse_iso(value: str | None):
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


async def _source_wise_applications(db, scope: ResumeScope | None = None) -> dict:
    scope = scope or await ResumeScope.load(db)
    stages: list[dict] = []
    visible = scope.candidates()
    if visible:
        stages.append({"$match": visible})
    stages.append({"$group": {"_id": {"$ifNull": ["$application_source", "unspecified"]}, "count": {"$sum": 1}}})
    agg = await db.candidates.aggregate(stages).to_list(length=None)
    return {r["_id"]: r["count"] for r in agg}


def _avg_time_to_hire(pairs: list[tuple[datetime, datetime]]) -> float | None:
    if not pairs:
        return None
    deltas = [(decided - invited).total_seconds() / 86400.0 for invited, decided in pairs]
    return round(sum(deltas) / len(deltas), 2)


async def _recruiter_performance(db, scope: ResumeScope | None = None) -> list:
    scope = scope or await ResumeScope.load(db)
    candidates = await db.candidates.find(
        scope.candidates({"doc_type": "candidate"}),
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


async def _time_to_hire(db, scope: ResumeScope | None = None) -> dict:
    scope = scope or await ResumeScope.load(db)
    hired = await db.candidates.find(
        scope.candidates({"doc_type": "candidate", "decision": "hire"}),
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


async def _offer_acceptance_rate(db, scope: ResumeScope | None = None) -> dict:
    scope = scope or await ResumeScope.load(db)
    stages: list[dict] = []
    visible = scope.by_candidate_id()
    if visible:
        stages.append({"$match": visible})
    stages.append({"$group": {"_id": "$status", "count": {"$sum": 1}}})
    agg = await db.offers.aggregate(stages).to_list(length=None)
    counts = {r["_id"]: r["count"] for r in agg}
    accepted = counts.get("accepted", 0)
    declined = counts.get("declined", 0)
    sent = accepted + declined + counts.get("sent", 0)
    denom = accepted + declined
    rate_pct = round(100 * accepted / denom, 1) if denom > 0 else None
    return {"sent": sent, "accepted": accepted, "declined": declined, "rate_pct": rate_pct}


async def _candidate_drop_off(db, scope: ResumeScope | None = None) -> list:
    scope = scope or await ResumeScope.load(db)
    stages = ["invited", "interviewing", "completed", "hired"]
    result = []
    prev_count = None
    for stage in stages:
        count = await db.candidates.count_documents(scope.candidates({"status": stage}))
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


_CODING_SCORE_BUCKETS = ("0-20", "20-40", "40-60", "60-80", "80-100")


def _coding_score_bucket(score: float) -> str:
    clamped = max(0.0, min(100.0, float(score)))
    idx = min(int(clamped // 20), len(_CODING_SCORE_BUCKETS) - 1)
    return _CODING_SCORE_BUCKETS[idx]


async def _coding_assessment_summary(db, scope: ResumeScope | None = None) -> dict:
    scope = scope or await ResumeScope.load(db)
    assigned = await db.candidates.count_documents(scope.candidates({
        "doc_type": "candidate",
        "coding_question_id": {"$exists": True, "$ne": None},
    }))

    finished_ids = await db.coding_submissions.distinct("candidate_id", scope.by_candidate_id())
    finished = len(finished_ids)
    completion_rate_pct = round(100 * finished / assigned, 1) if assigned > 0 else None

    total_submissions = await db.coding_submissions.count_documents(scope.by_candidate_id())

    graded_docs = await db.coding_submissions.find(
        scope.by_candidate_id({"score": {"$ne": None}}), {"_id": 0, "score": 1},
    ).to_list(length=None)

    distribution = {label: 0 for label in _CODING_SCORE_BUCKETS}
    total_score = 0.0
    graded_count = 0
    for doc in graded_docs:
        score = doc.get("score")
        if not isinstance(score, (int, float)):
            continue
        distribution[_coding_score_bucket(score)] += 1
        total_score += score
        graded_count += 1

    avg_score = round(total_score / graded_count, 2) if graded_count > 0 else None

    return {
        "candidates_assigned": assigned,
        "candidates_completed": finished,
        "completion_rate_pct": completion_rate_pct,
        "total_submissions": total_submissions,
        "graded_submissions": graded_count,
        "avg_score": avg_score,
        "score_distribution": distribution,
    }


def _empty_coding_assessment_summary() -> dict:
    return {
        "candidates_assigned": 0,
        "candidates_completed": 0,
        "completion_rate_pct": None,
        "total_submissions": 0,
        "graded_submissions": 0,
        "avg_score": None,
        "score_distribution": {label: 0 for label in _CODING_SCORE_BUCKETS},
    }


def _empty_diversity_metrics() -> dict:
    return {
        "status": "insufficient_data",
        "note": (
            "No self-reported demographic data is collected today. This requires "
            "adding opt-in demographic fields to the candidate/application flow "
            "before it can be populated: do not infer demographics from name, "
            "photo, or any other proxy signal."
        ),
        "breakdown": None,
    }


async def _diversity_metrics(db, scope: ResumeScope | None = None) -> dict:
    from services.hr_module.demographics_service import compute_diversity_breakdown

    result = await compute_diversity_breakdown(db, scope or await ResumeScope.load(db))
    if result.get("status") != "ready":
        return _empty_diversity_metrics()
    return result


COST_CATEGORIES: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("resume_parsing", "Résumé parsing", ("resume_bulk", "resume_classification")),
    ("interviews", "Interviews", (
        "interview_question_gen", "interview_followup_probe", "interview_guide", "interview_summary_draft",
    )),
    ("reports", "Report generation", ("interview_evaluation",)),
    ("job_descriptions", "Job descriptions", ("jd_parse",)),
    ("coding", "Coding assessments", (
        "coding_question_generation", "coding_quality_review", "coding_correctness_review",
    )),
    ("offers", "Offers", ("offer_letter_drafting",)),
    ("matching", "Matching", ("match_second_opinion", "embedding_reindex", "rematch_all", "resume_semantic_search")),
)


def _cost_categories(
    by_source: dict[str, dict], *, email_cost: float, email_count: int, voice_cost: float, voice_calls: int,
) -> list[dict]:
    def money(value) -> float:
        return round(float(value or 0.0), 6)

    claimed: set[str] = set()
    rows: dict[str, dict] = {}
    for key, label, sources in COST_CATEGORIES:
        claimed.update(sources)
        picked = [by_source[s] for s in sources if s in by_source]
        row = {
            "key": key, "label": label,
            "cost_usd": money(sum(r.get("cost_usd", 0.0) or 0.0 for r in picked)),
            "calls": int(sum(r.get("calls", 0) or 0 for r in picked)),
        }
        if key == "resume_parsing":
            batch = by_source.get("resume_bulk", {})
            single = by_source.get("resume_classification", {})
            items = int((batch.get("items", 0) or 0) + (single.get("entries", 0) or 0))
            row["items"] = items
            row["avg_item_usd"] = money(row["cost_usd"] / items) if items else 0.0
        if key == "reports":
            items = int(by_source.get("interview_evaluation", {}).get("entries", 0) or 0)
            row["items"] = items
            row["avg_item_usd"] = money(row["cost_usd"] / items) if items else 0.0
        rows[key] = row

    rest = [r for source, r in by_source.items() if source not in claimed]
    rows["other"] = {
        "key": "other", "label": "Other",
        "cost_usd": money(sum(r.get("cost_usd", 0.0) or 0.0 for r in rest)),
        "calls": int(sum(r.get("calls", 0) or 0 for r in rest)),
    }
    rows["voice"] = {"key": "voice", "label": "Interview voice", "cost_usd": money(voice_cost), "calls": int(voice_calls)}
    rows["email"] = {"key": "email", "label": "Email", "cost_usd": money(email_cost), "calls": int(email_count)}

    order = ["resume_parsing", "interviews", "reports", "voice", "job_descriptions", "coding", "offers", "matching", "email", "other"]
    return [rows[key] for key in order]


def _empty_cost_summary() -> dict:
    return {
        "status": "insufficient_data",
        "note": (
            "No AI usage has been cost-tracked yet, or you do not have the "
            "`cost:read` permission required to view this section."
        ),
        "total_cost_usd": 0.0,
        "categories": _cost_categories({}, email_cost=0.0, email_count=0, voice_cost=0.0, voice_calls=0),
        "llm": {
            "total_cost_usd": 0.0, "total_calls": 0, "chat_calls": 0, "embedding_calls": 0,
            "prompt_tokens": 0, "completion_tokens": 0, "embedding_tokens": 0,
            "by_feature": {},
        },
        "email": {
            "estimated_cost_usd": 0.0, "sent_count": 0,
            "cost_per_email_usd": settings.EMAIL_ESTIMATED_COST_PER_EMAIL,
            "note": (
                "Estimated from a configurable per-email cost "
                "(EMAIL_ESTIMATED_COST_PER_EMAIL): neither SMTP nor the AWS SES "
                "API exposes a real per-send billing figure to this backend."
            ),
        },
        "voice": {
            "estimated_cost_usd": 0.0,
            "tts": {"cost_usd": 0.0, "calls": 0, "characters": 0},
            "stt": {"cost_usd": 0.0, "calls": 0, "duration_minutes": 0.0, "estimated_calls": 0},
            "note": (
                "TTS cost is computed from the real input-text character count at "
                "an OpenAI per-character list rate (gpt-4o-mini-tts, this "
                "platform's default TTS model, is actually billed per "
                "output-audio token by OpenAI rather than per character, so its "
                "figure is approximated using tts-1's confirmed rate: see "
                "config/llm.py's _TTS_PRICING_PER_1K_CHARS). STT cost uses the "
                "transcription API's real audio duration when the response "
                "provides one, otherwise estimates it from the uploaded audio "
                "file's byte size, since OpenAI's default Whisper response does "
                "not include a duration."
            ),
        },
        "code_execution": {
            "trackable": False,
            "note": (
                "Judge0/Piston code-execution usage has no metered cost signal "
                "exposed to this backend today: not currently trackable."
            ),
        },
    }


async def _cost_summary(db) -> dict:
    agg = await db.cost_ledger.aggregate([
        {"$match": {"cost_type": {"$nin": ["tts", "stt"]}}},
        {"$group": {
            "_id": None,
            "total_cost_usd": {"$sum": "$cost_usd"},
            "prompt_tokens": {"$sum": "$prompt_tokens"},
            "completion_tokens": {"$sum": "$completion_tokens"},
            "embedding_tokens": {"$sum": "$embedding_tokens"},
            "llm_calls": {"$sum": {"$ifNull": ["$llm_calls", 0]}},
            "embedding_calls": {"$sum": {"$ifNull": ["$embedding_calls", 0]}},
        }},
    ]).to_list(1)
    totals = agg[0] if agg else {}

    by_source_agg = await db.cost_ledger.aggregate([
        {"$match": {"cost_type": {"$nin": ["tts", "stt"]}}},
        {"$group": {
            "_id": "$source",
            "cost_usd": {"$sum": "$cost_usd"},
            "calls": {"$sum": {"$add": [{"$ifNull": ["$llm_calls", 0]}, {"$ifNull": ["$embedding_calls", 0]}]}},
            "items": {"$sum": "$items"},
            "entries": {"$sum": 1},
        }},
    ]).to_list(200)
    by_source = {r["_id"]: r for r in by_source_agg if r.get("_id")}
    by_feature = {source: round(r["cost_usd"], 6) for source, r in by_source.items()}

    llm_cost = round(totals.get("total_cost_usd", 0.0) or 0.0, 6)

    sent_count = await db.email_log.count_documents({"status": "sent"})
    email_cost = round(sent_count * settings.EMAIL_ESTIMATED_COST_PER_EMAIL, 6)

    tts_agg = await db.cost_ledger.aggregate([
        {"$match": {"cost_type": "tts"}},
        {"$group": {
            "_id": None,
            "cost_usd": {"$sum": "$cost_usd"},
            "characters": {"$sum": "$characters"},
            "calls": {"$sum": 1},
        }},
    ]).to_list(1)
    tts = tts_agg[0] if tts_agg else {}

    stt_agg = await db.cost_ledger.aggregate([
        {"$match": {"cost_type": "stt"}},
        {"$group": {
            "_id": None,
            "cost_usd": {"$sum": "$cost_usd"},
            "duration_seconds": {"$sum": "$duration_seconds"},
            "calls": {"$sum": 1},
        }},
    ]).to_list(1)
    stt = stt_agg[0] if stt_agg else {}
    stt_calls = int(stt.get("calls", 0) or 0)
    stt_estimated_calls = await db.cost_ledger.count_documents(
        {"cost_type": "stt", "duration_source": "estimated_from_file_size"}
    )

    tts_cost = round(tts.get("cost_usd", 0.0) or 0.0, 6)
    stt_cost = round(stt.get("cost_usd", 0.0) or 0.0, 6)
    voice_cost = round(tts_cost + stt_cost, 6)

    return {
        "status": "ready",
        "total_cost_usd": round(llm_cost + email_cost + voice_cost, 6),
        "categories": _cost_categories(
            by_source, email_cost=email_cost, email_count=sent_count,
            voice_cost=voice_cost, voice_calls=int(tts.get("calls", 0) or 0) + stt_calls,
        ),
        "llm": {
            "total_cost_usd": llm_cost,
            "total_calls": int(totals.get("llm_calls", 0) or 0) + int(totals.get("embedding_calls", 0) or 0),
            "chat_calls": int(totals.get("llm_calls", 0) or 0),
            "embedding_calls": int(totals.get("embedding_calls", 0) or 0),
            "prompt_tokens": int(totals.get("prompt_tokens", 0) or 0),
            "completion_tokens": int(totals.get("completion_tokens", 0) or 0),
            "embedding_tokens": int(totals.get("embedding_tokens", 0) or 0),
            "by_feature": by_feature,
        },
        "email": {
            "estimated_cost_usd": email_cost,
            "sent_count": sent_count,
            "cost_per_email_usd": settings.EMAIL_ESTIMATED_COST_PER_EMAIL,
            "note": (
                "Estimated from a configurable per-email cost "
                "(EMAIL_ESTIMATED_COST_PER_EMAIL): neither SMTP nor the AWS SES "
                "API exposes a real per-send billing figure to this backend."
            ),
        },
        "voice": {
            "estimated_cost_usd": voice_cost,
            "tts": {
                "cost_usd": tts_cost,
                "calls": int(tts.get("calls", 0) or 0),
                "characters": int(tts.get("characters", 0) or 0),
            },
            "stt": {
                "cost_usd": stt_cost,
                "calls": stt_calls,
                "duration_minutes": round((stt.get("duration_seconds", 0.0) or 0.0) / 60.0, 4),
                "estimated_calls": stt_estimated_calls,
            },
            "note": (
                "TTS cost is computed from the real input-text character count at "
                "an OpenAI per-character list rate (gpt-4o-mini-tts, this "
                "platform's default TTS model, is actually billed per "
                "output-audio token by OpenAI rather than per character, so its "
                "figure is approximated using tts-1's confirmed rate: see "
                "config/llm.py's _TTS_PRICING_PER_1K_CHARS). STT cost uses the "
                "transcription API's real audio duration when the response "
                f"provides one; {stt_estimated_calls} of {stt_calls} STT call(s) "
                "had none and were estimated from the uploaded audio file's byte "
                "size instead, since OpenAI's default Whisper response does not "
                "include a duration."
            ),
        },
        "code_execution": {
            "trackable": False,
            "note": (
                "Judge0/Piston code-execution usage has no metered cost signal "
                "exposed to this backend today: not currently trackable."
            ),
        },
    }


@router.get("/dashboard")
async def analytics_dashboard(user: dict = Depends(get_current_user)):
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
            "coding_assessment": _empty_coding_assessment_summary(),
            "diversity_metrics": _empty_diversity_metrics(),
            "cost_summary": _empty_cost_summary(),
        }

    result: dict = {}

    try:
        scope = await ResumeScope.load(db)
    except Exception as exc:
        logger.error("analytics: resume scope failed, counting every candidate: %s", exc)
        scope = ResumeScope()

    try:
        result["jobs_active_vs_total"] = await _jobs_active_vs_total(db)
    except Exception as exc:
        logger.error("analytics: jobs_active_vs_total failed: %s", exc)
        result["jobs_active_vs_total"] = {"active": 0, "total": 0}

    try:
        result["source_wise_applications"] = await _source_wise_applications(db, scope)
    except Exception as exc:
        logger.error("analytics: source_wise_applications failed: %s", exc)
        result["source_wise_applications"] = {}

    try:
        result["recruiter_performance"] = await _recruiter_performance(db, scope)
    except Exception as exc:
        logger.error("analytics: recruiter_performance failed: %s", exc)
        result["recruiter_performance"] = []

    try:
        result["time_to_hire"] = await _time_to_hire(db, scope)
    except Exception as exc:
        logger.error("analytics: time_to_hire failed: %s", exc)
        result["time_to_hire"] = {"avg_days": None, "median_days": None, "sample_size": 0}

    try:
        result["offer_acceptance_rate"] = await _offer_acceptance_rate(db, scope)
    except Exception as exc:
        logger.error("analytics: offer_acceptance_rate failed: %s", exc)
        result["offer_acceptance_rate"] = {"sent": 0, "accepted": 0, "declined": 0, "rate_pct": None}

    try:
        result["candidate_drop_off"] = await _candidate_drop_off(db, scope)
    except Exception as exc:
        logger.error("analytics: candidate_drop_off failed: %s", exc)
        result["candidate_drop_off"] = []

    try:
        result["ai_recommendations"] = await _ai_recommendations(db)
    except Exception as exc:
        logger.error("analytics: ai_recommendations failed: %s", exc)
        result["ai_recommendations"] = []

    try:
        result["coding_assessment"] = await _coding_assessment_summary(db, scope)
    except Exception as exc:
        logger.error("analytics: coding_assessment failed: %s", exc)
        result["coding_assessment"] = _empty_coding_assessment_summary()

    try:
        permissions = await resolve_permissions(user.get("role"))
        if "demographics:read" in permissions:
            result["diversity_metrics"] = await _diversity_metrics(db, scope)
        else:
            result["diversity_metrics"] = _empty_diversity_metrics()
    except Exception as exc:
        logger.error("analytics: diversity_metrics failed: %s", exc)
        result["diversity_metrics"] = _empty_diversity_metrics()

    try:
        permissions = await resolve_permissions(user.get("role"))
        if "cost:read" in permissions:
            result["cost_summary"] = await _cost_summary(db)
        else:
            result["cost_summary"] = _empty_cost_summary()
    except Exception as exc:
        logger.error("analytics: cost_summary failed: %s", exc)
        result["cost_summary"] = _empty_cost_summary()

    return result
