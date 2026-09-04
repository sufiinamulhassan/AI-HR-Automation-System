"""Bidirectional JD ↔ Resume matching via Pinecone + metadata filtering — hr_module.

match_resume_to_jds   → called when a new resume is processed
match_jd_to_resume_pool → called when a new JD is created
Both return scored match dicts so callers can apply invite thresholds.

Scoring: composite = vector_similarity + SKILLS_WEIGHT × skills_jaccard (skills boost only, never penalise).
Gates:   domain alignment (same vs cross-domain threshold), seniority flex window, deadline.
"""
import logging
from datetime import datetime, timezone
from typing import Any

from config.database import get_db, get_pinecone
from config.settings import settings

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
    """A JD accepts new candidates unless its application deadline has passed."""
    deadline = (job or {}).get("deadline_at")
    if not deadline:
        return True
    try:
        return datetime.fromisoformat(deadline) >= datetime.now(timezone.utc)
    except Exception:
        return True


def _skills_jaccard(skills_a: list[str], skills_b: list[str]) -> float:
    """Jaccard similarity between two skill lists (case-insensitive)."""
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
    """Vector score boosted by skill overlap — skills can only help, never hurt.

    Zero skill overlap (or missing skills) leaves the vector score unchanged.
    Strong overlap adds up to SKILLS_WEIGHT on top, pushing borderline matches
    over the auto-invite threshold.
    """
    if not resume_skills or not jd_skills:
        return vector_score
    jaccard = _skills_jaccard(resume_skills, jd_skills)
    return min(1.0, vector_score + settings.SKILLS_WEIGHT * jaccard)


def _seniority_ok(candidate_seniority: str | None, required_seniority: list[str]) -> bool:
    """True if the candidate's seniority is within the JD's flex window.

    Permissive when data is missing on either side to avoid silently dropping
    resumes that were processed before seniority classification was added.
    """
    if not candidate_seniority or not required_seniority:
        return True
    return candidate_seniority in required_seniority


def _passes_relevance(score: float, domain_a: str | None, domain_b: str | None) -> bool:
    """Relevance gate: same-domain uses the standard threshold, cross-domain uses a higher bar."""
    if domain_a and domain_b and domain_a == domain_b:
        return score >= settings.RESUME_SIMILARITY_THRESHOLD
    return score >= settings.CROSS_DOMAIN_SIMILARITY_THRESHOLD


async def match_resume_to_jds(
    resume_id: str,
    embedding: list,
    classification: dict,
) -> list[dict]:
    """Find JDs that match a newly processed resume.

    Returns [{job_id, score}] sorted desc by composite score.
    Gate: composite score >= domain-aware threshold AND seniority within JD's flex window.
    """
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
        filter={"doc_type": "job"},
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
        {"_id": 0, "job_id": 1, "deadline_at": 1},
    ).to_list(length=len(candidates))
    open_ids = {d["job_id"] for d in docs if _job_is_open(d)}

    matches: list[dict] = []
    for c in candidates:
        if c["job_id"] not in open_ids:
            continue
        await db.jobs.update_one(
            {"job_id": c["job_id"], "candidate_pipeline.resume_id": {"$ne": resume_id}},
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
    """Find resumes that match a newly created JD.

    Returns [{resume_id, score}] sorted desc by composite score.
    Gate: composite score >= domain-aware threshold AND seniority within required_seniority window.
    """
    pinecone = get_pinecone()
    db = get_db()
    if pinecone is None or db is None:
        return []

    job_doc = await db.jobs.find_one({"job_id": job_id}, {"_id": 0, "deadline_at": 1})
    if job_doc is not None and not _job_is_open(job_doc):
        return []

    jd_domain = targeting.get("required_domain")
    required_seniority: list[str] = targeting.get("required_seniority") or []
    jd_skills: list[str] = targeting.get("required_skills") or []

    results = pinecone.query(
        vector=jd_embedding,
        top_k=settings.RESUME_TOP_N_MATCHES_PER_JD,
        namespace="",
        filter={"doc_type": "resume"},
        include_metadata=True,
    )

    matches: list[dict] = []
    for match in _parse_matches(results):
        meta = match.get("metadata") or {}
        resume_domain = meta.get("job_domain")
        resume_skills: list[str] = meta.get("skills") or []
        resume_seniority: str | None = meta.get("seniority_level")

        score = _composite_score(match["score"], resume_skills, jd_skills)
        if not _passes_relevance(score, jd_domain, resume_domain):
            continue
        if not _seniority_ok(resume_seniority, required_seniority):
            continue

        resume_id = match["id"]
        score = round(score, 4)

        await db.jobs.update_one(
            {"job_id": job_id, "candidate_pipeline.resume_id": {"$ne": resume_id}},
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
