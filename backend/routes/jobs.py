"""Jobs route — hr_module CRUD for Job Descriptions with async AI parsing and auto-invite."""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel

from shared.auth import get_current_user, require_admin, require_superadmin
from shared.schemas import HRJobCreate, HRJobUpdate
from config.database import get_db
from config.settings import settings
from services.hr_module.audit_service import log_audit_event
from services.hr_module.permissions import get_department_scope

router = APIRouter()


class HRJobCreateWithDepartment(HRJobCreate):
    """Local extension of the shared HRJobCreate schema — adds an optional
    department_id for department/branch scoping (MVP2 §2.1). Kept local per
    project convention (see HRCandidateCreateWithPhone in routes/candidates.py);
    shared/schemas.py stays untouched this round. A job with no department_id
    (the default) remains visible to every user, matching pre-existing
    behaviour — see services/hr_module/permissions.get_department_scope."""
    department_id: str | None = None


class HRJobUpdateWithDepartment(HRJobUpdate):
    """Local extension of HRJobUpdate — see HRJobCreateWithDepartment above."""
    department_id: str | None = None


def _expired_jobs_query() -> dict:
    """JDs with a real deadline that has passed ($type string excludes no-deadline)."""
    now = datetime.now(timezone.utc).isoformat()
    return {"doc_type": "job", "deadline_at": {"$type": "string", "$lt": now}}


async def _jd_config(db) -> dict:
    doc = await db.system_config.find_one({"key": "jd"}) or {}
    return {"auto_delete_expired": bool(doc.get("auto_delete_expired", False))}


def _deadline_at(created_iso: str, days: int | None) -> str | None:
    """Absolute deadline = created_at + days. None when days is falsy (no deadline)."""
    if not days or days <= 0:
        return None
    try:
        base = datetime.fromisoformat(created_iso)
    except Exception:
        base = datetime.now(timezone.utc)
    return (base + timedelta(days=int(days))).isoformat()


async def _parse_and_match(job_id: str, title: str, description: str, model: str | None):
    """Background: parse JD, embed, match existing resumes, auto-invite qualifying candidates."""
    import logging
    logger = logging.getLogger(__name__)
    try:
        from services.hr_module.jd_intel import parse_jd
        from services.hr_module.matcher import match_jd_to_resume_pool
        from services.hr_module.invite_service import auto_invite_from_jd_match
        from config.llm import start_usage_tracking, record_cost

        start_usage_tracking()
        result = await parse_jd(job_id, title, description, model)
        matched_resumes = await match_jd_to_resume_pool(job_id, result["targeting"], result["embedding"])
        invited = await auto_invite_from_jd_match(job_id=job_id, matched_resumes=matched_resumes)
        await record_cost("jd_parse", job_id)
        logger.info("JD parsed | job_id=%s matched=%d auto_invited=%d", job_id, len(matched_resumes), len(invited))
    except Exception as exc:
        logging.getLogger(__name__).error("JD parse failed | job_id=%s error=%s", job_id, exc)


@router.post("")
async def create_job(body: HRJobCreateWithDepartment, bg: BackgroundTasks, user: dict = Depends(require_admin)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    job_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "doc_type": "job",
        "job_id": job_id,
        "title": body.title,
        "description": body.description,
        "difficulty": body.difficulty,
        "employment_type": body.employment_type,
        "location": body.location,
        "salary_min": body.salary_min,
        "salary_max": body.salary_max,
        "is_remote": body.is_remote,
        "company_name": body.company_name,
        "source": "manual",
        "source_url": None,
        "deadline_days": body.deadline_days,
        "deadline_at": _deadline_at(now, body.deadline_days),
        "parsed_criteria": {},
        "targeting": {},
        "embedding": [],
        "candidate_pipeline": [],
        "department_id": body.department_id,
        "created_by": user["email"],
        "created_at": now,
        "updated_at": now,
    }
    await db.jobs.insert_one(doc)
    bg.add_task(_parse_and_match, job_id, body.title, body.description, body.model_override)
    doc.pop("_id", None)
    doc.pop("embedding", None)

    asyncio.create_task(log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="job_create", resource_type="job", resource_id=job_id,
        details={"title": body.title, "department_id": body.department_id},
    ))
    return doc


@router.post("/rematch-all")
async def rematch_all_jobs(invite: bool = False, _: dict = Depends(require_admin)):
    """Admin backfill: re-run JD ↔ resume matching for every existing JD against the
    current resume pool. Populates candidate_pipeline for resumes that were uploaded
    before the JD existed (or before a matching fix). Idempotent — the pipeline push
    skips resumes already present.

    By default this only fills pipelines. Pass ?invite=true to also fire auto-invite
    emails for resumes scoring >= AUTO_INVITE_THRESHOLD (off by default so a one-time
    backfill doesn't send a burst of emails)."""
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    from config.database import get_pinecone
    from config.settings import settings
    from config.llm import start_usage_tracking, record_cost
    from services.hr_module.matcher import match_jd_to_resume_pool, _parse_matches
    from services.hr_module.invite_service import auto_invite_from_jd_match

    start_usage_tracking()
    pc = get_pinecone()
    jobs = await db.jobs.find({"doc_type": "job"}).to_list(500)
    total_matched = 0
    total_invited = 0
    details = []
    for job in jobs:
        job_id = job["job_id"]
        targeting = job.get("targeting") or {}
        embedding = job.get("embedding") or []
        if not embedding or not targeting:
            details.append({"job_id": job_id, "title": job.get("title"), "skipped": "missing_embedding_or_targeting"})
            continue

        probe: object = None
        if pc is not None and embedding:
            try:
                raw = pc.query(vector=embedding, top_k=5, namespace="",
                               filter={"doc_type": "resume"}, include_metadata=True)
                probe = [
                    {"resume_id": m["id"], "score": round(m["score"], 4),
                     "job_domain": m["metadata"].get("job_domain")}
                    for m in _parse_matches(raw)
                ]
            except Exception as exc:
                probe = f"probe_error: {exc}"

        await db.jobs.update_one(
            {"job_id": job_id},
            {"$pull": {"candidate_pipeline": {"pipeline_stage": "matched"}}},
        )
        matched = await match_jd_to_resume_pool(job_id, targeting, embedding)
        total_matched += len(matched)
        if invite:
            invited = await auto_invite_from_jd_match(job_id=job_id, matched_resumes=matched)
            total_invited += len(invited)

        details.append({
            "job_id": job_id,
            "title": job.get("title"),
            "required_domain": targeting.get("required_domain"),
            "embedding_present": bool(embedding),
            "matched": len(matched),
            "raw_top5": probe,
        })

    await record_cost("rematch_all")
    return {
        "pinecone_connected": pc is not None,
        "threshold": settings.RESUME_SIMILARITY_THRESHOLD,
        "jobs": len(jobs),
        "matched": total_matched,
        "auto_invited": total_invited,
        "details": details,
    }


@router.get("")
async def list_jobs(
    page: int = 1,
    limit: int = 20,
    search: str | None = None,
    industry: str | None = None,
    experience_level: str | None = None,
    salary_min: int | None = None,
    salary_max: int | None = None,
    user: dict = Depends(get_current_user),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    query: dict = {"doc_type": "job"}
    department_id = await get_department_scope(user)
    if department_id is not None:
        query["department_id"] = {"$in": [department_id, None]}
    if search:
        query["$or"] = [
            {"title": {"$regex": search, "$options": "i"}},
            {"company_name": {"$regex": search, "$options": "i"}},
        ]
    if industry:
        query["parsed_criteria.industry"] = industry
    if experience_level:
        query["parsed_criteria.experience_level"] = experience_level
    if salary_min is not None:
        query["salary_max"] = {"$gte": salary_min}
    if salary_max is not None:
        query["salary_min"] = {"$lte": salary_max}
    total = await db.jobs.count_documents(query)
    cursor = (
        db.jobs.find(query, {"_id": 0, "embedding": 0})
        .sort("created_at", -1)
        .skip((page - 1) * limit)
        .limit(limit)
    )
    return {"jobs": await cursor.to_list(length=limit), "total": total, "page": page, "limit": limit}


class ImportJDRequest(BaseModel):
    source: str
    query: str | None = None
    location: str | None = None
    limit: int = 10
    date_posted: str | None = None
    job_type: str | None = None
    remote_only: bool = False
    deadline_days: int | None = None


@router.get("/sources")
async def job_import_sources(_: dict = Depends(get_current_user)):
    """List external JD sources and whether each is usable (key-configured)."""
    from services.hr_module.job_sources import list_sources
    return {"sources": list_sources()}


@router.get("/stats")
async def job_stats(_: dict = Depends(get_current_user)):
    """JD totals + distribution by source (manual / linkedin / naukri / …)."""
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    total = await db.jobs.count_documents({"doc_type": "job"})
    agg = await db.jobs.aggregate([
        {"$match": {"doc_type": "job"}},
        {"$group": {"_id": {"$ifNull": ["$source", "manual"]}, "count": {"$sum": 1}}},
    ]).to_list(50)
    return {"total": total, "by_source": {r["_id"]: r["count"] for r in agg if r["_id"]}}


@router.post("/import")
async def import_jobs(body: ImportJDRequest, bg: BackgroundTasks, user: dict = Depends(require_admin)):
    """Fetch JDs from an external source, store them (tagged with the source),
    and parse + match each in the background — same pipeline as a manual JD."""
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    want = max(1, min(body.limit or 10, 50))
    buffer = max(want * 5, 25)

    from services.hr_module.job_sources import fetch_jobs, extract_salary_range, JobSourceNotConfigured, JobSourceError
    try:
        fetched = await fetch_jobs(
            body.source, body.query, body.location, buffer,
            date_posted=body.date_posted, job_type=body.job_type, remote_only=body.remote_only,
        )
    except JobSourceNotConfigured as exc:
        raise HTTPException(400, str(exc))
    except JobSourceError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(502, f"Failed to fetch from {body.source}: {exc}")

    imported = 0
    skipped = 0
    now = datetime.now(timezone.utc).isoformat()
    open_days = body.deadline_days if body.deadline_days is not None else settings.DEFAULT_JD_OPEN_DAYS
    deadline_at = _deadline_at(now, open_days)
    for jd in fetched:
        if imported >= want:
            break
        dup_query = (
            {"source_url": jd["source_url"]} if jd.get("source_url")
            else {"title": jd["title"], "company_name": jd.get("company_name"), "source": body.source}
        )
        if await db.jobs.find_one(dup_query, {"_id": 1}):
            skipped += 1
            continue

        job_id = str(uuid.uuid4())
        salary_min, salary_max = extract_salary_range(jd["description"])
        await db.jobs.insert_one({
            "doc_type": "job",
            "job_id": job_id,
            "title": jd["title"],
            "description": jd["description"],
            "difficulty": "medium",
            "employment_type": jd.get("employment_type") or "full-time",
            "location": jd.get("location"),
            "salary_min": salary_min,
            "salary_max": salary_max,
            "is_remote": bool(jd.get("is_remote")),
            "company_name": jd.get("company_name"),
            "source": body.source,
            "source_url": jd.get("source_url"),
            "deadline_days": open_days,
            "deadline_at": deadline_at,
            "parsed_criteria": {},
            "targeting": {},
            "embedding": [],
            "candidate_pipeline": [],
            "department_id": None,
            "created_by": user["email"],
            "created_at": now,
            "updated_at": now,
        })
        bg.add_task(_parse_and_match, job_id, jd["title"], jd["description"], None)
        imported += 1

    return {"source": body.source, "fetched": len(fetched), "imported": imported, "skipped": skipped}


@router.post("/scheduled-sync")
async def scheduled_sync(_: dict = Depends(require_admin)):
    """Admin: run the recurring 'sync every configured job source' pass synchronously
    and return a summary, one entry per source (fetched/imported/skipped/error).

    This performs the exact same logic as the in-process APScheduler job in
    services/hr_module/scheduler.py (services.hr_module.scheduler.sync_all_sources).
    That in-process scheduler only runs on a normal long-lived server process — it
    is skipped on a serverless host, whose process does not persist between
    invocations, so an in-process interval timer would never fire there. This
    endpoint is the substitute: point any external scheduler at
    'POST /api/v1/jobs/scheduled-sync' on a cadence matching
    settings.JOB_IMPORT_SYNC_INTERVAL_HOURS to get the same recurring behaviour.

    Note it is POST and require_admin, so the caller must send an admin bearer
    token. Vercel Cron issues an unauthenticated GET and therefore cannot drive
    this on its own — use an external scheduler that can set a header.

    No infrastructure is provisioned by this code — only this HTTP surface for
    an externally-configured scheduled rule to call.
    """
    from services.hr_module.scheduler import sync_all_sources
    return await sync_all_sources()


class JDSettings(BaseModel):
    auto_delete_expired: bool


@router.get("/expired")
async def expired_jobs(_: dict = Depends(get_current_user)):
    """List JDs past their application deadline. If auto-delete is enabled, expired
    JDs are purged on access and the list comes back empty."""
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    cfg = await _jd_config(db)
    if cfg["auto_delete_expired"]:
        res = await db.jobs.delete_many(_expired_jobs_query())
        return {"expired": [], "auto_deleted": res.deleted_count, "auto_delete_expired": True}
    jobs = await (
        db.jobs.find(_expired_jobs_query(), {"_id": 0, "embedding": 0})
        .sort("deadline_at", -1).limit(500).to_list(500)
    )
    return {"expired": jobs, "auto_deleted": 0, "auto_delete_expired": False}


@router.post("/purge-expired")
async def purge_expired_jobs(_: dict = Depends(require_superadmin)):
    """Super-admin: delete every expired JD in one shot."""
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    res = await db.jobs.delete_many(_expired_jobs_query())
    return {"deleted": res.deleted_count}


@router.get("/jd-settings")
async def get_jd_settings(_: dict = Depends(get_current_user)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    return await _jd_config(db)


@router.patch("/jd-settings")
async def set_jd_settings(body: JDSettings, _: dict = Depends(require_superadmin)):
    """Super-admin only: toggle automatic deletion of expired JDs."""
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    await db.system_config.update_one(
        {"key": "jd"},
        {"$set": {"key": "jd", "auto_delete_expired": bool(body.auto_delete_expired)}},
        upsert=True,
    )
    return await _jd_config(db)


@router.get("/{job_id}")
async def get_job(job_id: str, _: dict = Depends(get_current_user)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    job = await db.jobs.find_one({"job_id": job_id}, {"_id": 0, "embedding": 0})
    if not job:
        raise HTTPException(404, "Job not found")
    return job


@router.patch("/{job_id}")
async def update_job(job_id: str, body: HRJobUpdateWithDepartment, bg: BackgroundTasks, user: dict = Depends(require_admin)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    update = {k: v for k, v in body.model_dump().items() if v is not None}
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    if "deadline_days" in update:
        existing = await db.jobs.find_one({"job_id": job_id}, {"created_at": 1})
        created = (existing or {}).get("created_at") or update["updated_at"]
        update["deadline_at"] = _deadline_at(created, update["deadline_days"])
    await db.jobs.update_one({"job_id": job_id}, {"$set": update})
    updated = await db.jobs.find_one({"job_id": job_id}, {"_id": 0, "embedding": 0})
    if not updated:
        raise HTTPException(404, "Job not found")
    if "description" in update:
        bg.add_task(_parse_and_match, job_id, updated["title"], updated["description"], None)

    asyncio.create_task(log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="job_update", resource_type="job", resource_id=job_id,
        details=update,
    ))
    return updated


@router.delete("/{job_id}")
async def delete_job(job_id: str, user: dict = Depends(require_admin)):
    db = get_db()
    if db is not None:
        await db.jobs.delete_one({"job_id": job_id})
        asyncio.create_task(log_audit_event(
            db, actor_email=user["email"], actor_role=user.get("role"),
            action="job_delete", resource_type="job", resource_id=job_id,
            details={},
        ))
    return {"message": "Job deleted"}


@router.get("/{job_id}/pipeline")
async def get_pipeline(job_id: str, _: dict = Depends(get_current_user)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    job = await db.jobs.find_one({"job_id": job_id})
    if not job:
        raise HTTPException(404, "Job not found")
    pipeline = sorted(
        job.get("candidate_pipeline", []),
        key=lambda p: p.get("similarity_score") or 0,
        reverse=True,
    )
    ids = [p["resume_id"] for p in pipeline]
    resumes = await db.resumes.find(
        {"resume_id": {"$in": ids}}, {"_id": 0, "embedding": 0, "text": 0}
    ).to_list(500)
    rmap = {r["resume_id"]: r for r in resumes}

    candidates = await db.candidates.find(
        {"job_id": job_id, "resume_id": {"$in": ids}},
        {"_id": 0, "candidate_id": 1, "resume_id": 1, "secure_token": 1},
    ).to_list(500)
    cmap = {c["resume_id"]: c for c in candidates if c.get("resume_id")}

    def _hydrate(p: dict) -> dict:
        cand = cmap.get(p["resume_id"])
        return {
            **p,
            "resume": rmap.get(p["resume_id"]),
            "candidate_id": p.get("candidate_id") or (cand or {}).get("candidate_id"),
            "secure_token": p.get("secure_token") or (cand or {}).get("secure_token"),
        }

    return {
        "job_id": job_id,
        "title": job.get("title"),
        "required_skills": (job.get("targeting") or {}).get("required_skills") or (job.get("parsed_criteria") or {}).get("skills") or [],
        "pipeline": [_hydrate(p) for p in pipeline],
        "total": len(pipeline),
    }


@router.patch("/{job_id}/pipeline/{resume_id}")
async def update_pipeline_stage(
    job_id: str,
    resume_id: str,
    stage: str,
    user: dict = Depends(require_admin),
):
    valid = {"matched", "shortlisted", "invited", "interviewing", "completed", "hired", "rejected"}
    if stage not in valid:
        raise HTTPException(400, f"Valid stages: {sorted(valid)}")
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    res = await db.jobs.update_one(
        {"job_id": job_id, "candidate_pipeline.resume_id": resume_id},
        {"$set": {
            "candidate_pipeline.$.pipeline_stage": stage,
            "candidate_pipeline.$.updated_by": user["email"],
            "candidate_pipeline.$.updated_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Candidate not found in pipeline")
    if stage in ("hired", "rejected"):
        job = await db.jobs.find_one({"job_id": job_id})
        from services.hr_module.resume_intel import apply_resume_outcome
        await apply_resume_outcome(
            resume_id,
            is_hired=stage == "hired",
            company=(job or {}).get("company_name"),
            job_title=(job or {}).get("title"),
        )
    return {"message": f"Stage updated to {stage}"}
