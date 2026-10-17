from datetime import datetime, timezone

VALID_PIPELINE_STAGES = frozenset({
    "matched", "shortlisted", "invited", "interviewing", "completed", "hired", "rejected",
})

MAX_BULK_STAGE_IDS = 100


async def set_pipeline_stage(
    db,
    job_id: str,
    resume_id: str,
    stage: str,
    actor_email: str,
    job: dict | None = None,
) -> bool:
    res = await db.jobs.update_one(
        {"job_id": job_id, "candidate_pipeline.resume_id": resume_id},
        {"$set": {
            "candidate_pipeline.$.pipeline_stage": stage,
            "candidate_pipeline.$.updated_by": actor_email,
            "candidate_pipeline.$.updated_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    if res.matched_count == 0:
        return False

    if stage in ("hired", "rejected"):
        if job is None:
            job = await db.jobs.find_one(
                {"job_id": job_id}, {"_id": 0, "company_name": 1, "title": 1}
            )
        from services.hr_module.resume_intel import apply_resume_outcome
        await apply_resume_outcome(
            resume_id,
            is_hired=stage == "hired",
            company=(job or {}).get("company_name"),
            job_title=(job or {}).get("title"),
        )
    return True
