import asyncio
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel

from shared.auth import get_current_user, require_admin, require_permission, require_superadmin
from shared.quotas import ai_action, check_ai_action
from shared.schemas import HRJobCreate, HRJobUpdate
from config.database import get_db
from config.settings import settings
from shared.utils import require_selectable_model
from services.hr_module import department_access
from services.hr_module.audit_service import log_audit_event
from services.hr_module.candidate_redaction import scrub_admin_only
from services.hr_module.external_interview_service import (
    REVIEW_REQUIRED_MESSAGE,
    blocked_by_missing_review,
    pipeline_fields as external_pipeline_fields,
)
from services.hr_module.permissions import get_department_scope
from services.hr_module.pipeline_stage_service import (
    MAX_BULK_STAGE_IDS,
    VALID_PIPELINE_STAGES,
    set_pipeline_stage,
)

router = APIRouter(dependencies=[Depends(department_access.enforce_job_path_scope)])


class HRJobCreateWithDepartment(HRJobCreate):
    department_id: str | None = None


class HRJobUpdateWithDepartment(HRJobUpdate):
    department_id: str | None = None


def _expired_jobs_query() -> dict:
    now = datetime.now(timezone.utc).isoformat()
    return {"doc_type": "job", "deadline_at": {"$type": "string", "$lt": now}}


_JOB_STATUS_FILTERS = ("open", "closed", "all")


async def _jd_config(db) -> dict:
    doc = await db.system_config.find_one({"key": "jd"}) or {}
    return {"auto_delete_expired": bool(doc.get("auto_delete_expired", False))}


def _deadline_at(created_iso: str, days: int | None) -> str | None:
    if not days or days <= 0:
        return None
    try:
        base = datetime.fromisoformat(created_iso)
    except Exception:
        base = datetime.now(timezone.utc)
    return (base + timedelta(days=int(days))).isoformat()


async def _parse_and_match(job_id: str, title: str, description: str, model: str | None):
    import logging
    logger = logging.getLogger(__name__)
    try:
        from services.hr_module.jd_intel import parse_jd
        from services.hr_module.matcher import match_jd_to_resume_pool
        from services.hr_module.invite_service import auto_invite_from_jd_match
        from config.llm import start_usage_tracking, record_cost

        start_usage_tracking()
        try:
            result = await parse_jd(job_id, title, description, model)
            matched_resumes = await match_jd_to_resume_pool(job_id, result["targeting"], result["embedding"])
            invited = await auto_invite_from_jd_match(job_id=job_id, matched_resumes=matched_resumes)
            logger.info("JD parsed | job_id=%s matched=%d auto_invited=%d", job_id, len(matched_resumes), len(invited))
        finally:
            await record_cost("jd_parse", job_id)
    except Exception as exc:
        logging.getLogger(__name__).error("JD parse failed | job_id=%s error=%s", job_id, exc)


async def _require_own_department(user: dict, department_id: str | None) -> None:
    scope = await get_department_scope(user)
    if scope is not None and department_id not in (None, "", scope):
        raise HTTPException(403, "You can only manage jobs in your own department.")


@router.post("")
async def create_job(
    body: HRJobCreateWithDepartment,
    bg: BackgroundTasks,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("jobs:create")),
    _quota: None = Depends(ai_action("jobs", per_hour=300)),
):
    model_override = require_selectable_model(body.model_override)
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    await _require_own_department(user, body.department_id)

    from services.hr_module.job_grade_service import validate_job_grade
    try:
        await validate_job_grade(db, body.job_grade)
    except ValueError as exc:
        raise HTTPException(400, str(exc))

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
        "job_grade": body.job_grade,
        "salary_min": body.salary_min,
        "salary_max": body.salary_max,
        "is_remote": body.is_remote,
        "company_name": body.company_name,
        "source": "manual",
        "source_url": None,
        "is_public": body.is_public,
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
    bg.add_task(_parse_and_match, job_id, body.title, body.description, model_override)
    doc.pop("_id", None)
    doc.pop("embedding", None)

    asyncio.create_task(log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="job_create", resource_type="job", resource_id=job_id,
        details={"title": body.title, "department_id": body.department_id},
    ))
    from services.hr_module.webhook_service import emit_event
    await emit_event("job.created", {"job_id": job_id, "title": body.title})
    return doc


@router.post("/rematch-all")
async def rematch_all_jobs(
    invite: bool = False,
    _: dict = Depends(require_admin),
    __: dict = Depends(require_permission("jobs:update")),
    _quota: None = Depends(ai_action("jobs", per_hour=300)),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    from config.database import get_pinecone
    from config.settings import settings
    from config.llm import embedding_is_current, start_usage_tracking, record_cost
    from services.hr_module.matcher import match_jd_to_resume_pool, _parse_matches
    from services.hr_module.invite_service import auto_invite_from_jd_match
    from services.hr_module.vector_scope import query_filter

    start_usage_tracking()
    pc = get_pinecone()
    jobs = await db.jobs.find({"doc_type": "job"}).to_list(500)
    total_matched = 0
    total_invited = 0
    details = []
    try:
        for job in jobs:
            job_id = job["job_id"]
            targeting = job.get("targeting") or {}
            embedding = job.get("embedding") or []
            if not embedding or not targeting:
                details.append({"job_id": job_id, "title": job.get("title"), "skipped": "missing_embedding_or_targeting"})
                continue
            if not embedding_is_current(job.get("embedding_model")):
                details.append({"job_id": job_id, "title": job.get("title"), "skipped": "embedding_from_another_model"})
                continue

            probe: object = None
            if pc is not None and embedding:
                try:
                    raw = pc.query(vector=embedding, top_k=5, namespace="",
                                   filter=query_filter("resume"), include_metadata=True)
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
                invited = await auto_invite_from_jd_match(job_id=job_id, matched_resumes=matched, force=True)
                total_invited += len(invited)

            details.append({
                "job_id": job_id,
                "title": job.get("title"),
                "required_domain": targeting.get("required_domain"),
                "embedding_present": bool(embedding),
                "matched": len(matched),
                "raw_top5": probe,
            })
    finally:
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
    status: str | None = None,
    user: dict = Depends(get_current_user),
):
    status_filter = (status or "all").strip().lower() or "all"
    if status_filter not in _JOB_STATUS_FILTERS:
        raise HTTPException(400, "status must be one of: open, closed, all")
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    query: dict = {"doc_type": "job"}
    department_id = await get_department_scope(user)
    if department_id is not None:
        query["department_id"] = {"$in": [department_id, None]}
    if search:
        pattern = re.escape(search)
        query["$or"] = [
            {"title": {"$regex": pattern, "$options": "i"}},
            {"company_name": {"$regex": pattern, "$options": "i"}},
        ]
    if industry:
        query["parsed_criteria.industry"] = industry
    if experience_level:
        query["parsed_criteria.experience_level"] = experience_level
    if salary_min is not None:
        query["salary_max"] = {"$gte": salary_min}
    if salary_max is not None:
        query["salary_min"] = {"$lte": salary_max}

    closed_deadline = _expired_jobs_query()["deadline_at"]
    count_all = await db.jobs.count_documents(query)
    count_closed = await db.jobs.count_documents({**query, "deadline_at": closed_deadline})
    counts = {"open": count_all - count_closed, "closed": count_closed, "all": count_all}
    if status_filter == "closed":
        query["deadline_at"] = closed_deadline
    elif status_filter == "open":
        query["$nor"] = [{"deadline_at": closed_deadline}]
    total = counts[status_filter]
    cursor = (
        db.jobs.find(query, {"_id": 0, "embedding": 0})
        .sort("created_at", -1)
        .skip((page - 1) * limit)
        .limit(limit)
    )
    return {
        "jobs": await cursor.to_list(length=limit),
        "total": total,
        "page": page,
        "limit": limit,
        "counts": counts,
    }


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
    from services.hr_module.job_sources import list_sources
    return {"sources": list_sources()}


@router.get("/stats")
async def job_stats(_: dict = Depends(get_current_user)):
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
async def import_jobs(
    body: ImportJDRequest,
    bg: BackgroundTasks,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("jobs:import")),
    _quota: None = Depends(ai_action("jobs", per_hour=300)),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    want = max(1, min(body.limit or 10, 50))
    buffer = max(want * 5, 25)

    from services.hr_module.job_sources import (
        fetch_jobs, extract_salary_range, list_sources, JobSourceNotConfigured, JobSourceError,
    )
    from services.hr_module.notification_settings_service import notify

    async def _alert(detail: str) -> None:
        if body.source in {s["id"] for s in list_sources()}:
            await notify("job_import_failed", {"source": body.source, "detail": detail})

    try:
        fetched = await fetch_jobs(
            body.source, body.query, body.location, buffer,
            date_posted=body.date_posted, job_type=body.job_type, remote_only=body.remote_only,
        )
    except JobSourceNotConfigured as exc:
        raise HTTPException(400, str(exc))
    except JobSourceError as exc:
        await _alert(str(exc))
        raise HTTPException(400, str(exc))
    except Exception as exc:
        await _alert(str(exc))
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
            "is_public": False,
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
async def scheduled_sync(
    _: dict = Depends(require_admin),
    __: dict = Depends(require_permission("jobs:import")),
    _quota: None = Depends(ai_action("jobs", per_hour=300)),
):
    from services.hr_module.scheduler import sync_all_sources
    return await sync_all_sources()


class JDSettings(BaseModel):
    auto_delete_expired: bool


@router.get("/expired")
async def expired_jobs(user: dict = Depends(get_current_user)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    query = _expired_jobs_query()
    scope = await get_department_scope(user)
    if scope is not None:
        query["department_id"] = {"$in": [scope, None]}
    cfg = await _jd_config(db)
    if cfg["auto_delete_expired"]:
        res = await db.jobs.delete_many(query)
        return {"expired": [], "auto_deleted": res.deleted_count, "auto_delete_expired": True}
    jobs = await (
        db.jobs.find(query, {"_id": 0, "embedding": 0})
        .sort("deadline_at", -1).limit(500).to_list(500)
    )
    return {"expired": jobs, "auto_deleted": 0, "auto_delete_expired": False}


@router.post("/purge-expired")
async def purge_expired_jobs(
    _: dict = Depends(require_superadmin),
    __: dict = Depends(require_permission("jobs:delete")),
):
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
async def set_jd_settings(
    body: JDSettings,
    _: dict = Depends(require_superadmin),
    __: dict = Depends(require_permission("jobs:manage_settings")),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    await db.system_config.update_one(
        {"key": "jd"},
        {"$set": {"key": "jd", "auto_delete_expired": bool(body.auto_delete_expired)}},
        upsert=True,
    )
    return await _jd_config(db)


@router.get("/{job_id}/comparison")
async def get_job_comparison(
    job_id: str,
    stage: str | None = None,
    include_rejected: bool = False,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("interview:read_report")),
):
    from services.hr_module.department_access import job_in_scope
    from services.hr_module.job_comparison_service import build_comparison

    if stage is not None and stage not in VALID_PIPELINE_STAGES:
        raise HTTPException(422, "stage must be one of: " + ", ".join(sorted(VALID_PIPELINE_STAGES)))
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    job = await db.jobs.find_one({"job_id": job_id}, {"_id": 0, "embedding": 0})
    if not job or not job_in_scope(job, await get_department_scope(user)):
        raise HTTPException(404, "Job not found")
    return await build_comparison(db, job, stage=stage, include_rejected=include_rejected)


@router.get("/{job_id}")
async def get_job(job_id: str, _: dict = Depends(get_current_user)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    job = await db.jobs.find_one({"job_id": job_id}, {"_id": 0, "embedding": 0})
    if not job:
        raise HTTPException(404, "Job not found")
    return job


@router.get("/{job_id}/sourcing")
async def get_job_sourcing(job_id: str, _: dict = Depends(get_current_user)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    job = await db.jobs.find_one({"job_id": job_id}, {"_id": 0, "embedding": 0})
    if not job:
        raise HTTPException(404, "Job not found")

    from services.hr_module.sourcing_service import build_sourcing_plan
    plan = build_sourcing_plan(job)
    return {"job_id": job_id, **plan}


@router.patch("/{job_id}")
async def update_job(
    job_id: str,
    body: HRJobUpdateWithDepartment,
    bg: BackgroundTasks,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("jobs:update")),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    update = {k: v for k, v in body.model_dump().items() if v is not None}
    await _require_own_department(user, update.get("department_id"))
    if "description" in update:
        await check_ai_action("jobs", per_hour=300)

    if "job_grade" in update:
        from services.hr_module.job_grade_service import validate_job_grade
        try:
            await validate_job_grade(db, update["job_grade"])
        except ValueError as exc:
            raise HTTPException(400, str(exc))

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


async def _delete_job_vector(job_id: str) -> None:
    from config.database import get_pinecone

    pc = get_pinecone()
    if pc is None:
        return
    try:
        await asyncio.to_thread(pc.delete, ids=[job_id], namespace="jobs")
    except Exception as exc:
        logging.getLogger(__name__).warning("Pinecone delete failed for job %s: %s", job_id, exc)


@router.delete("/{job_id}")
async def delete_job(
    job_id: str,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("jobs:delete")),
):
    db = get_db()
    if db is not None:
        result = await db.jobs.delete_one({"job_id": job_id})
        if result.deleted_count:
            await _delete_job_vector(job_id)
        asyncio.create_task(log_audit_event(
            db, actor_email=user["email"], actor_role=user.get("role"),
            action="job_delete", resource_type="job", resource_id=job_id,
            details={},
        ))
    return {"message": "Job deleted"}


@router.get("/{job_id}/pipeline")
async def get_pipeline(job_id: str, user: dict = Depends(get_current_user)):
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
        {
            "_id": 0, "candidate_id": 1, "resume_id": 1, "secure_token": 1, "final_score": 1,
            "interview_mode": 1, "external_interview": 1, "external_review.reviewed_at": 1,
        },
    ).to_list(500)
    cmap = {c["resume_id"]: c for c in candidates if c.get("resume_id")}

    def _hydrate(p: dict) -> dict:
        cand = cmap.get(p["resume_id"])
        ai_score = (cand or {}).get("final_score") if (cand or {}).get("interview_mode") != "external" else None
        return {
            **p,
            **({"final_score": ai_score} if isinstance(ai_score, (int, float)) and not isinstance(ai_score, bool) else {}),
            "resume": rmap.get(p["resume_id"]),
            "candidate_id": p.get("candidate_id") or (cand or {}).get("candidate_id"),
            "secure_token": p.get("secure_token") or (cand or {}).get("secure_token"),
            **external_pipeline_fields(cand),
        }

    return scrub_admin_only(user, {
        "job_id": job_id,
        "title": job.get("title"),
        "required_skills": (job.get("targeting") or {}).get("required_skills") or (job.get("parsed_criteria") or {}).get("skills") or [],
        "pipeline": [_hydrate(p) for p in pipeline],
        "total": len(pipeline),
    })


@router.get("/{job_id}/pipeline/{resume_id}/fit")
async def get_pipeline_fit(job_id: str, resume_id: str, _: dict = Depends(get_current_user)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    from services.hr_module.pipeline_fit_service import build_fit_breakdown, load_fit_context
    try:
        job, entry, resume = await load_fit_context(db, job_id, resume_id)
    except LookupError as exc:
        raise HTTPException(404, str(exc))
    return build_fit_breakdown(job, entry, resume)


@router.post("/{job_id}/pipeline/{resume_id}/fit/ai-opinion")
async def get_pipeline_fit_ai_opinion(
    job_id: str,
    resume_id: str,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("jobs:ai_fit_opinion")),
    _quota: None = Depends(ai_action("fit_opinion", per_hour=300)),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    from services.hr_module.pipeline_fit_service import (
        SecondOpinionError,
        build_fit_breakdown,
        generate_second_opinion,
        load_fit_context,
    )
    try:
        job, entry, resume = await load_fit_context(db, job_id, resume_id, include_text=True)
    except LookupError as exc:
        raise HTTPException(404, str(exc))

    fit = build_fit_breakdown(job, entry, resume)
    try:
        return await generate_second_opinion(job, resume, fit, resume_id)
    except SecondOpinionError as exc:
        raise HTTPException(502, f"AI second opinion unavailable: {exc}. Please try again shortly.")


class BulkStageRequest(BaseModel):
    resume_ids: list[str]
    stage: str


@router.post("/{job_id}/pipeline/bulk-stage")
async def bulk_update_pipeline_stage(
    job_id: str,
    body: BulkStageRequest,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("jobs:bulk_stage")),
):
    if body.stage not in VALID_PIPELINE_STAGES:
        raise HTTPException(400, f"Valid stages: {sorted(VALID_PIPELINE_STAGES)}")
    if not body.resume_ids:
        raise HTTPException(400, "resume_ids must contain at least one id")
    if len(body.resume_ids) > MAX_BULK_STAGE_IDS:
        raise HTTPException(400, f"At most {MAX_BULK_STAGE_IDS} candidates can be updated per request")

    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    job = await db.jobs.find_one({"job_id": job_id}, {"_id": 0, "company_name": 1, "title": 1})
    if not job:
        raise HTTPException(404, "Job not found")

    updated_ids: list[str] = []
    skipped: list[str] = []
    blocked: list[str] = []
    for resume_id in dict.fromkeys(body.resume_ids):
        if await blocked_by_missing_review(db, job_id, resume_id, body.stage):
            blocked.append(resume_id)
        elif await set_pipeline_stage(db, job_id, resume_id, body.stage, user["email"], job=job):
            updated_ids.append(resume_id)
        else:
            skipped.append(resume_id)

    asyncio.create_task(log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="pipeline_bulk_stage", resource_type="job", resource_id=job_id,
        details={
            "stage": body.stage,
            "requested": len(body.resume_ids),
            "updated": len(updated_ids),
            "resume_ids": updated_ids,
            "skipped": skipped,
            "blocked_awaiting_review": blocked,
        },
    ))
    return {"updated": len(updated_ids), "skipped": skipped, "blocked": blocked}


@router.patch("/{job_id}/pipeline/{resume_id}")
async def update_pipeline_stage(
    job_id: str,
    resume_id: str,
    stage: str,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("jobs:update")),
):
    if stage not in VALID_PIPELINE_STAGES:
        raise HTTPException(400, f"Valid stages: {sorted(VALID_PIPELINE_STAGES)}")
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    if await blocked_by_missing_review(db, job_id, resume_id, stage):
        raise HTTPException(409, REVIEW_REQUIRED_MESSAGE)
    if not await set_pipeline_stage(db, job_id, resume_id, stage, user["email"]):
        raise HTTPException(404, "Candidate not found in pipeline")
    return {"message": f"Stage updated to {stage}"}
