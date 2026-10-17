from __future__ import annotations

import math
from datetime import datetime, timezone

from config.database import get_db


def _cosine(a, b) -> float | None:
    if not a or not b or len(a) != len(b):
        return None
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if not norm_a or not norm_b:
        return None
    return sum(x * y for x, y in zip(a, b)) / (norm_a * norm_b)


async def score_against_job(db, job_id: str, resume_id: str) -> float | None:
    from services.hr_module.matcher import _composite_score

    resume = await db.resumes.find_one({"resume_id": resume_id}, {"_id": 0, "embedding": 1, "classification": 1})
    job = await db.jobs.find_one({"job_id": job_id}, {"_id": 0, "embedding": 1, "targeting": 1, "parsed_criteria": 1})
    if not resume or not job:
        return None
    vector = _cosine(resume.get("embedding"), job.get("embedding"))
    if vector is None:
        return None
    job_skills = (job.get("targeting") or {}).get("required_skills") or (job.get("parsed_criteria") or {}).get("skills") or []
    resume_skills = (resume.get("classification") or {}).get("skills") or []
    return round(max(0.0, _composite_score(vector, resume_skills, job_skills)), 4)


async def attach_to_pipeline(
    db,
    job_id: str,
    resume_id: str,
    score: float | None,
    extra: dict | None = None,
    *,
    rescore: bool = False,
) -> None:
    if score is None and rescore:
        score = await score_against_job(db, job_id, resume_id)
    pushed = await db.jobs.update_one(
        {"job_id": job_id, "candidate_pipeline.resume_id": {"$ne": resume_id}},
        {"$push": {"candidate_pipeline": {
            "resume_id": resume_id,
            "similarity_score": float(score) if score is not None else 0.0,
            "targeted_upload": score is None,
            "pipeline_stage": "matched",
            "added_at": datetime.now(timezone.utc).isoformat(),
            **(extra or {}),
        }}},
    )
    if extra and not pushed.matched_count:
        await db.jobs.update_one(
            {"job_id": job_id, "candidate_pipeline.resume_id": resume_id},
            {"$set": {f"candidate_pipeline.$.{key}": value for key, value in extra.items()}},
        )


async def run_resume_agent(
    resume_id: str,
    filename: str,
    raw: bytes,
    job_id: str | None,
    model: str | None,
    *,
    pipeline_extra: dict | None = None,
    applicant: dict | None = None,
) -> None:
    from agents.resume_agent import build_resume_agent

    agent = build_resume_agent()
    result = await agent.ainvoke({
        "resume_id": resume_id,
        "filename": filename,
        "raw_bytes": raw,
        "model_override": model,
    })
    db = get_db()
    if db is None:
        return

    if result.get("duplicate"):
        await db.resumes.delete_one({"resume_id": resume_id})
        if job_id and pipeline_extra is not None:
            await attach_to_pipeline(db, job_id, str(result["duplicate"]), None, pipeline_extra, rescore=True)
        return

    if result.get("error"):
        await db.resumes.update_one(
            {"resume_id": resume_id},
            {"$set": {"processing_status": "failed", "error": result["error"]}},
        )
        return

    if applicant:
        await db.resumes.update_one(
            {"resume_id": resume_id},
            {"$set": {"candidate_name": applicant.get("name"), "candidate_email": applicant.get("email")}},
        )

    if job_id:
        matched = {
            m.get("job_id"): m.get("score")
            for m in (result.get("matched_jds") or [])
            if isinstance(m, dict)
        }
        await attach_to_pipeline(
            db, job_id, resume_id, matched.get(job_id), pipeline_extra, rescore=pipeline_extra is not None,
        )
