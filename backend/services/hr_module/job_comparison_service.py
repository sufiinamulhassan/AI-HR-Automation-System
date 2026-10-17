from __future__ import annotations

from services.hr_module.external_interview_service import RATING_KEYS, normalise_iso

SOURCE_AI = "ai"
SOURCE_SCORECARD = "interviewer_scorecard"
RECOMMENDATIONS = ("hire", "maybe", "reject")

STAGE_ORDER = ("matched", "shortlisted", "invited", "interviewing", "completed")

CANDIDATE_LIMIT = 2000

_PROJECTION = {
    "_id": 0, "candidate_id": 1, "resume_id": 1, "name": 1, "pipeline_stage": 1, "status": 1,
    "secure_token": 1, "final_score": 1, "match_score": 1,
    "interview_ended_at": 1, "interview_started_at": 1, "external_review.interviewed_at": 1,
    "report.source": 1, "report.recommendation": 1, "report.final_score": 1,
    **{f"report.{key}_score": 1 for key in RATING_KEYS},
}


def _number(value) -> int | float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value


def effective_stage(candidate: dict, entry: dict | None) -> str | None:
    stages = [(entry or {}).get("pipeline_stage"), candidate.get("pipeline_stage"), candidate.get("status")]
    for terminal in ("rejected", "hired"):
        if terminal in stages:
            return terminal
    known = [s for s in stages if s in STAGE_ORDER]
    return max(known, key=STAGE_ORDER.index) if known else None


def _final_score(candidate: dict) -> int | float | None:
    score = _number(candidate.get("final_score"))
    return score if score is not None else _number((candidate.get("report") or {}).get("final_score"))


def _interviewed_at(candidate: dict) -> str | None:
    for value in (
        candidate.get("interview_ended_at"),
        (candidate.get("external_review") or {}).get("interviewed_at"),
        candidate.get("interview_started_at"),
    ):
        normalised = normalise_iso(value)
        if normalised:
            return normalised
    return None


def build_row(candidate: dict, entry: dict | None, offer_status: str | None) -> dict | None:
    score = _final_score(candidate)
    report = candidate.get("report")
    if score is None or not isinstance(report, dict):
        return None
    recommendation = report.get("recommendation")
    match_score = _number(candidate.get("match_score"))
    return {
        "rank": 0,
        "candidate_id": candidate.get("candidate_id"),
        "resume_id": candidate.get("resume_id"),
        "name": candidate.get("name"),
        "stage": effective_stage(candidate, entry),
        "source": SOURCE_SCORECARD if report.get("source") == SOURCE_SCORECARD else SOURCE_AI,
        "final_score": score,
        "dimensions": {key: _number(report.get(f"{key}_score")) for key in RATING_KEYS},
        "recommendation": recommendation if recommendation in RECOMMENDATIONS else None,
        "interviewed_at": _interviewed_at(candidate),
        "match_score": match_score if match_score is not None else _number((entry or {}).get("similarity_score")),
        "offer_status": offer_status,
        "secure_token": candidate.get("secure_token"),
    }


async def _latest_offer_status(db, candidate_ids: list[str]) -> dict[str, str | None]:
    latest: dict[str, tuple[str, str | None]] = {}
    if not candidate_ids:
        return {}
    cursor = db.offers.find(
        {"candidate_id": {"$in": candidate_ids}},
        {"_id": 0, "candidate_id": 1, "status": 1, "created_at": 1},
    )
    async for offer in cursor:
        created = str(offer.get("created_at") or "")
        current = latest.get(offer.get("candidate_id"))
        if current is None or created >= current[0]:
            latest[offer["candidate_id"]] = (created, offer.get("status"))
    return {cid: status for cid, (_, status) in latest.items()}


async def build_comparison(db, job: dict, *, stage: str | None = None, include_rejected: bool = False) -> dict:
    entries = {e.get("resume_id"): e for e in job.get("candidate_pipeline") or [] if isinstance(e, dict)}
    candidates = await db.candidates.find(
        {"job_id": job["job_id"], "report": {"$type": "object"}}, _PROJECTION,
    ).to_list(length=CANDIDATE_LIMIT)
    offers = await _latest_offer_status(db, [c["candidate_id"] for c in candidates if c.get("candidate_id")])

    rows: list[dict] = []
    for candidate in candidates:
        row = build_row(candidate, entries.get(candidate.get("resume_id")), offers.get(candidate.get("candidate_id")))
        if row is None:
            continue
        if stage and row["stage"] != stage:
            continue
        if row["stage"] == "rejected" and not (include_rejected or stage == "rejected"):
            continue
        rows.append(row)

    rows.sort(key=lambda r: (-r["final_score"], r["interviewed_at"] is None, r["interviewed_at"] or ""))
    for position, row in enumerate(rows, start=1):
        row["rank"] = position

    scores = [r["final_score"] for r in rows]
    return {
        "job_id": job["job_id"],
        "title": job.get("title"),
        "rows": rows,
        "stats": {
            "count": len(rows),
            "average": round(sum(scores) / len(scores), 1) if scores else None,
            "highest": max(scores) if scores else None,
        },
    }
