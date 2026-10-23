import logging
from datetime import datetime, timezone
from typing import Any

from config.database import get_db, get_pinecone
from config.settings import settings
from services.hr_module import job_capacity
from services.hr_module.vector_scope import query_filter

logger = logging.getLogger(__name__)

_SENIORITY_FLEX: dict[str, list[str]] = {
    "intern":    ["intern", "junior"],
    "junior":    ["intern", "junior", "mid"],
    "mid":       ["junior", "mid", "senior"],
    "senior":    ["mid", "senior", "lead"],
    "lead":      ["senior", "lead", "manager"],
    "manager":   ["lead", "manager", "director"],
    "director":  ["manager", "director", "executive"],
    "executive": ["director", "executive"],
}


def _job_is_open(job: dict) -> bool:
    deadline = (job or {}).get("deadline_at")
    if not deadline:
        return True
    try:
        return datetime.fromisoformat(deadline) >= datetime.now(timezone.utc)
    except Exception:
        return True


def _skills_jaccard(skills_a: list[str], skills_b: list[str]) -> float:
    if not skills_a or not skills_b:
        return 0.0
    set_a = {s.lower().strip() for s in skills_a if s}
    set_b = {s.lower().strip() for s in skills_b if s}
    if not set_a or not set_b:
        return 0.0
    intersection = len(set_a & set_b)
    union = len(set_a | set_b)
    return intersection / union if union else 0.0


def _composite_score(vector_score: float, resume_skills: list[str], jd_skills: list[str]) -> float:
    if not resume_skills or not jd_skills:
        return vector_score
    jaccard = _skills_jaccard(resume_skills, jd_skills)
    return min(1.0, vector_score + settings.SKILLS_WEIGHT * jaccard)


def _seniority_ok(candidate_seniority: str | None, required_seniority: list[str]) -> bool:
    if not candidate_seniority or not required_seniority:
        return True
    return candidate_seniority in required_seniority


def _passes_relevance(score: float, domain_a: str | None, domain_b: str | None) -> bool:
    if domain_a and domain_b and domain_a == domain_b:
        return score >= settings.RESUME_SIMILARITY_THRESHOLD
    return score >= settings.CROSS_DOMAIN_SIMILARITY_THRESHOLD


async def match_resume_to_jds(
    resume_id: str,
    embedding: list,
    classification: dict,
) -> list[dict]:
    pinecone = get_pinecone()
    db = get_db()
    if pinecone is None or db is None:
        return []

    resume_domain = classification.get("job_domain")
    resume_seniority = classification.get("seniority_level")
    resume_skills: list[str] = classification.get("skills") or []

    results = pinecone.query(
        vector=embedding,
        top_k=settings.RESUME_TOP_N_MATCHES_PER_JD,
        namespace="jobs",
        filter=query_filter("job"),
        include_metadata=True,
    )

    candidates = []
    for m in _parse_matches(results):
        if not m["id"]:
            continue
        meta = m.get("metadata") or {}
        jd_domain = meta.get("job_domain")
        jd_skills: list[str] = meta.get("skills") or []
        jd_experience_level: str | None = meta.get("experience_level")

        score = _composite_score(m["score"], resume_skills, jd_skills)
        if not _passes_relevance(score, jd_domain, resume_domain):
            continue

        jd_seniority_window = (
            _SENIORITY_FLEX.get(jd_experience_level, [jd_experience_level])
            if jd_experience_level else []
        )
        if not _seniority_ok(resume_seniority, jd_seniority_window):
            continue

        candidates.append({"job_id": m["id"], "score": round(score, 4)})

    if not candidates:
        return []

    docs = await db.jobs.find(
        {"job_id": {"$in": [c["job_id"] for c in candidates]}},
        {
            "_id": 0, "job_id": 1, "deadline_at": 1, "max_resumes": 1, "min_match_score": 1,
            "candidate_pipeline": 1, "removed_candidates": 1,
        },
    ).to_list(length=len(candidates))
    open_jobs = {d["job_id"]: d for d in docs if _job_is_open(d)}

    matches: list[dict] = []
    for c in candidates:
        job = open_jobs.get(c["job_id"])
        if job is None or resume_id in job_capacity.removed_ids(job):
            continue
        if job_capacity.below_minimum(job, c["score"]):
            continue
        already = any(p.get("resume_id") == resume_id for p in job.get("candidate_pipeline") or [])
        if not already and job_capacity.is_full(job):
            continue
        await db.jobs.update_one(
            job_capacity.push_filter(c["job_id"], resume_id),
            {"$push": {"candidate_pipeline": {
                "resume_id": resume_id,
                "similarity_score": c["score"],
                "pipeline_stage": "matched",
                "added_at": datetime.now(timezone.utc).isoformat(),
            }}},
        )
        matches.append(c)

    matches.sort(key=lambda x: x["score"], reverse=True)
    return matches


async def match_jd_to_resume_pool(
    job_id: str,
    targeting: dict,
    jd_embedding: list,
) -> list[dict]:
    pinecone = get_pinecone()
    db = get_db()
    if pinecone is None or db is None:
        return []

    job_doc = await db.jobs.find_one(
        {"job_id": job_id},
        {
            "_id": 0, "deadline_at": 1, "max_resumes": 1, "min_match_score": 1,
            "candidate_pipeline": 1, "removed_candidates": 1,
        },
    )
    if job_doc is None:
        return []
    if not _job_is_open(job_doc):
        return []

    jd_domain = targeting.get("required_domain")
    required_seniority: list[str] = targeting.get("required_seniority") or []
    jd_skills: list[str] = targeting.get("required_skills") or []

    results = pinecone.query(
        vector=jd_embedding,
        top_k=settings.RESUME_TOP_N_MATCHES_PER_JD,
        namespace="",
        filter=query_filter("resume"),
        include_metadata=True,
    )

    scored: list[tuple[str, float]] = []
    for match in _parse_matches(results):
        if not match["id"]:
            continue
        meta = match.get("metadata") or {}
        resume_domain = meta.get("job_domain")
        resume_skills: list[str] = meta.get("skills") or []
        resume_seniority: str | None = meta.get("seniority_level")

        score = _composite_score(match["score"], resume_skills, jd_skills)
        if not _passes_relevance(score, jd_domain, resume_domain):
            continue
        if not _seniority_ok(resume_seniority, required_seniority):
            continue
        scored.append((match["id"], round(score, 4)))

    if not scored:
        return []

    wanted = [resume_id for resume_id, _ in scored]
    present = {
        d["resume_id"]
        for d in await db.resumes.find(
            {"resume_id": {"$in": wanted}}, {"_id": 0, "resume_id": 1},
        ).to_list(length=len(wanted))
    }

    removed = job_capacity.removed_ids(job_doc)
    in_pipeline = {p.get("resume_id") for p in job_doc.get("candidate_pipeline") or []}
    slots = job_capacity.remaining_slots(job_doc)
    scored.sort(key=lambda item: item[1], reverse=True)

    matches: list[dict] = []
    for resume_id, score in scored:
        if resume_id not in present:
            logger.info("Matcher skipped a vector with no resume in this company | resume_id=%s", resume_id)
            continue
        if resume_id in removed or job_capacity.below_minimum(job_doc, score):
            continue
        if resume_id not in in_pipeline:
            if slots is not None and slots <= 0:
                continue
            if slots is not None:
                slots -= 1

        await db.jobs.update_one(
            job_capacity.push_filter(job_id, resume_id),
            {"$push": {"candidate_pipeline": {
                "resume_id": resume_id,
                "similarity_score": score,
                "pipeline_stage": "matched",
                "added_at": datetime.now(timezone.utc).isoformat(),
            }}},
        )
        matches.append({"resume_id": resume_id, "score": score})

    matches.sort(key=lambda x: x["score"], reverse=True)
    return matches


def _parse_matches(result: Any) -> list[dict]:
    raw = getattr(result, "matches", None)
    if raw is None and isinstance(result, dict):
        raw = result.get("matches", [])
    out = []
    for m in raw or []:
        if isinstance(m, dict):
            out.append({
                "id": m.get("id"),
                "score": float(m.get("score") or 0.0),
                "metadata": m.get("metadata") or {},
            })
        else:
            out.append({
                "id": getattr(m, "id", None),
                "score": float(getattr(m, "score", 0.0) or 0.0),
                "metadata": getattr(m, "metadata", {}) or {},
            })
    return out
