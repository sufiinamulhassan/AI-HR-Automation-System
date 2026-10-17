import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from shared.auth import get_current_user, require_admin, require_permission
from shared.quotas import ai_action
from config import llm as llm_config
from config.database import get_db, get_pinecone
from services.hr_module import department_access, plan_service, resume_search, vector_scope
from services.hr_module.audit_service import log_audit_event
from services.hr_module.candidate_redaction import scrub_admin_only
from shared.utils import require_selectable_model

logger = logging.getLogger(__name__)

router = APIRouter()

_IN_FLIGHT_WINDOW = timedelta(minutes=5)

_BULK_DELETE_MAX = 200


class SalaryExpectationUpdate(BaseModel):
    salary_expectation: int


class BulkDeleteRequest(BaseModel):
    resume_ids: list[str]

_MEDIA_TYPES = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "doc": "application/msword",
    "txt": "text/plain",
}


async def _run_agent(
    resume_id: str,
    filename: str,
    raw: bytes,
    job_id: str | None,
    model: str | None,
):
    from services.hr_module.resume_intake_service import run_resume_agent
    await run_resume_agent(resume_id, filename, raw, job_id, model)


@router.post("/upload")
async def upload_resume(
    bg: BackgroundTasks,
    file: UploadFile = File(...),
    job_id: str | None = Form(default=None),
    model_override: str | None = Form(default=None),
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("resumes:upload")),
    _quota: None = Depends(ai_action("resumes", per_hour=600)),
):
    model_override = require_selectable_model(model_override)
    raw = await file.read()
    db = get_db()

    if db is not None:
        from services.hr_module.resume_intel import check_duplicate
        existing = await check_duplicate(raw)
        if existing:
            return {
                "status": "duplicate",
                "resume_id": existing,
                "message": "This resume has already been uploaded.",
            }

    await plan_service.ensure_storage_available(len(raw))

    resume_id = str(uuid.uuid4())
    if db is not None:
        from services.hr_module.resume_intel import _file_hash
        await db.resumes.insert_one({
            "resume_id": resume_id,
            "filename": file.filename,
            "file_hash": _file_hash(raw),
            "processing_status": "pending",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    bg.add_task(_run_agent, resume_id, file.filename or "unknown", raw, job_id, model_override)

    asyncio.create_task(log_audit_event(
        db, actor_email=user.get("email"), actor_role=user.get("role"),
        action="resume_upload", resource_type="resume", resource_id=resume_id,
        details={"filename": file.filename, "job_id": job_id},
    ))
    return {"resume_id": resume_id, "status": "processing"}


SEMANTIC_UNAVAILABLE = "Semantic search is not available right now"


def resume_filters(
    search: str | None = None,
    skill: str | None = Query(None, description="One skill or several, comma separated; every one must match"),
    business_domain: str | None = Query(None, description="Business domain slug; other means no listed domain"),
    domain: str | None = Query(None, description="Job family"),
    seniority: str | None = None,
    status: str | None = None,
    experience_min: int | None = None,
    experience_max: int | None = None,
    department: str | None = Query(None, description="Role label"),
    education_level: str | None = None,
    certification: str | None = None,
    industry: str | None = None,
    salary_expectation_min: int | None = None,
    salary_expectation_max: int | None = None,
    worked_at_company: str | None = None,
    location: str | None = None,
    notice_period: str | None = None,
    min_match_score: float | None = None,
    job_id: str | None = None,
) -> dict:
    return dict(locals())


async def _filter_query(db, user: dict, filters: dict, ignore=frozenset()):
    job_id = (filters.get("job_id") or "").strip()
    if job_id:
        await department_access.require_job_access(db, user, job_id)
    active = {key: value for key, value in filters.items() if key not in ignore}
    has_search = bool((active.get("search") or "").strip())
    pool = await resume_search.known_skill_pool(db) if has_search else frozenset()
    parsed = resume_search.parse_filters(active, pool)
    return resume_search.build_resume_query(active, pool, parsed), parsed


@router.get("")
async def list_resumes(
    page: int = 1,
    limit: int = 20,
    filters: dict = Depends(resume_filters),
    user: dict = Depends(get_current_user),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    page, limit = resume_search.page_bounds(page, limit)
    query, parsed = await _filter_query(db, user, filters)
    total = await db.resumes.count_documents(query)
    skip = (page - 1) * limit
    if parsed.is_empty():
        cursor = (
            db.resumes.find(query, resume_search.LIST_PROJECTION)
            .sort(list(resume_search.NEWEST_FIRST))
            .skip(skip)
            .limit(limit)
        )
        resumes = await cursor.to_list(length=limit)
    else:
        pipeline = resume_search.ranked_pipeline(query, parsed, skip, limit)
        resumes = await db.resumes.aggregate(pipeline, allowDiskUse=True).to_list(length=limit)
    await department_access.limit_matched_jds(db, user, resumes)
    return scrub_admin_only(user, {"resumes": resumes, "total": total, "page": page, "limit": limit})


@router.get("/domains")
async def resume_domains(
    filters: dict = Depends(resume_filters),
    user: dict = Depends(get_current_user),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    query, _parsed = await _filter_query(db, user, filters, ignore=resume_search.FOLDER_IGNORED_FILTERS)
    rows = await db.resumes.aggregate(resume_search.folder_pipeline(query)).to_list(length=None)
    folders = resume_search.build_folders(rows)
    return {"folders": folders, "total": sum(folder["count"] for folder in folders)}


@router.get("/filters/options")
async def resume_filter_options(_: dict = Depends(get_current_user)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    pipelines = resume_search.option_pipelines()
    total, *grouped = await asyncio.gather(
        db.resumes.count_documents({}),
        *(db.resumes.aggregate(pipeline).to_list(length=None) for pipeline in pipelines.values()),
    )
    return resume_search.build_options(dict(zip(pipelines, grouped)), total)


@router.get("/search/semantic")
async def semantic_search_resumes(
    q: str = Query(..., min_length=2, max_length=300),
    limit: int = Query(20, ge=1, le=50),
    filters: dict = Depends(resume_filters),
    user: dict = Depends(get_current_user),
    _quota: None = Depends(ai_action("resume_semantic_search", per_hour=300)),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    text = q.strip()
    if len(text) < 2:
        raise HTTPException(422, "q must have at least 2 characters")
    query, _parsed = await _filter_query(db, user, filters)
    pc = get_pinecone()
    if pc is None:
        raise HTTPException(503, SEMANTIC_UNAVAILABLE)

    llm_config.start_usage_tracking()
    try:
        vector = llm_config.require_vector(await llm_config.get_embedding(text))
        result = await asyncio.to_thread(
            pc.query,
            vector=vector,
            top_k=resume_search.semantic_top_k(limit),
            namespace="",
            filter=vector_scope.query_filter("resume"),
            include_metadata=False,
        )
    except Exception as exc:
        logger.warning("Resume semantic search failed: %s", exc)
        raise HTTPException(503, SEMANTIC_UNAVAILABLE) from exc
    finally:
        await llm_config.record_cost("resume_semantic_search")

    hits = resume_search.pinecone_hits(result)
    resumes: list[dict] = []
    if hits:
        ids = [resume_id for resume_id, _score in hits]
        scoped = {"resume_id": {"$in": ids}}
        docs = await db.resumes.find(
            {"$and": [query, scoped]} if query else scoped, resume_search.LIST_PROJECTION,
        ).to_list(length=len(ids))
        resumes = resume_search.rank_documents(hits, docs, limit)
    await department_access.limit_matched_jds(db, user, resumes)
    return scrub_admin_only(user, {"resumes": resumes, "total": len(resumes), "query": text})


async def _delete_resumes(db, ids: list[str]) -> dict[str, list[str]]:
    cutoff = (datetime.now(timezone.utc) - _IN_FLIGHT_WINDOW).isoformat()
    busy_docs = await db.resumes.find(
        {"resume_id": {"$in": ids}, "processing_status": "pending", "created_at": {"$gt": cutoff}},
        {"_id": 0, "resume_id": 1},
    ).to_list(length=len(ids))
    in_progress = {d["resume_id"] for d in busy_docs}
    targets = [i for i in ids if i not in in_progress]

    present: set[str] = set()
    if targets:
        present_docs = await db.resumes.find(
            {"resume_id": {"$in": targets}}, {"_id": 0, "resume_id": 1}
        ).to_list(length=len(targets))
        present = {d["resume_id"] for d in present_docs}

        freed = await plan_service.stored_bytes(db.resume_files, {"resume_id": {"$in": targets}})
        await db.resumes.delete_many({"resume_id": {"$in": targets}})
        await db.applications.delete_many({"resume_id": {"$in": targets}})
        await db.resume_files.delete_many({"resume_id": {"$in": targets}})
        await plan_service.record_stored_bytes(-freed)
        await db.jobs.update_many(
            {"candidate_pipeline.resume_id": {"$in": targets}},
            {"$pull": {"candidate_pipeline": {"resume_id": {"$in": targets}}}},
        )
        await db.resumes.update_many(
            {"superseded_by": {"$in": targets}}, {"$set": {"superseded_by": None}}
        )
        await db.resumes.update_many(
            {"previous_resume_id": {"$in": targets}}, {"$set": {"previous_resume_id": None}}
        )

        pc = get_pinecone()
        if pc is not None:
            try:
                stale = [i for i in targets if i not in present]
                owned = [i for i in targets if i in present] + await asyncio.to_thread(
                    vector_scope.owned_ids, pc, stale,
                )
                if owned:
                    await asyncio.to_thread(pc.delete, ids=owned)
            except Exception as exc:
                logger.warning("Pinecone delete failed for %d resume(s): %s", len(targets), exc)

    return {
        "deleted": [i for i in targets if i in present],
        "in_progress": [i for i in ids if i in in_progress],
        "not_found": [i for i in targets if i not in present],
    }


async def _audit_resume_deletes(db, user: dict, ids: list[str]) -> None:
    for resume_id in ids:
        await log_audit_event(
            db, actor_email=user.get("email"), actor_role=user.get("role"),
            action="resume_delete", resource_type="resume", resource_id=resume_id,
            details={},
        )


@router.post("/bulk-delete")
async def bulk_delete_resumes(
    body: BulkDeleteRequest,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("resumes:delete")),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    ids = list(dict.fromkeys(i for i in body.resume_ids if i))
    if not ids:
        raise HTTPException(400, "No resume ids supplied")
    if len(ids) > _BULK_DELETE_MAX:
        raise HTTPException(400, f"Delete at most {_BULK_DELETE_MAX} resumes at a time")

    result = await _delete_resumes(db, ids)
    if result["deleted"]:
        asyncio.create_task(_audit_resume_deletes(db, user, result["deleted"]))
    return result


@router.get("/{resume_id}")
async def get_resume(resume_id: str, include_text: bool = False, user: dict = Depends(get_current_user)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    proj: dict = {"_id": 0, "embedding": 0}
    if not include_text:
        proj["text"] = 0
    doc = await db.resumes.find_one({"resume_id": resume_id}, proj)
    if not doc:
        raise HTTPException(404, "Resume not found")
    await department_access.limit_matched_jds(db, user, [doc])
    return scrub_admin_only(user, doc)


_VERSION_CHAIN_PROJECTION = {
    "_id": 0, "resume_id": 1, "version": 1, "filename": 1,
    "created_at": 1, "processing_status": 1,
    "previous_resume_id": 1, "superseded_by": 1,
}
_MAX_CHAIN_WALK = 200


@router.get("/{resume_id}/versions")
async def get_resume_versions(resume_id: str, _: dict = Depends(get_current_user)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    current = await db.resumes.find_one({"resume_id": resume_id}, _VERSION_CHAIN_PROJECTION)
    if not current:
        raise HTTPException(404, "Resume not found")

    oldest = current
    visited = {current["resume_id"]}
    steps = 0
    while oldest.get("previous_resume_id") and steps < _MAX_CHAIN_WALK:
        prev_id = oldest["previous_resume_id"]
        if prev_id in visited:
            break
        prev_doc = await db.resumes.find_one({"resume_id": prev_id}, _VERSION_CHAIN_PROJECTION)
        if not prev_doc:
            break
        visited.add(prev_id)
        oldest = prev_doc
        steps += 1

    chain = [oldest]
    visited = {oldest["resume_id"]}
    node = oldest
    steps = 0
    while node.get("superseded_by") and steps < _MAX_CHAIN_WALK:
        next_id = node["superseded_by"]
        if next_id in visited:
            break
        next_doc = await db.resumes.find_one({"resume_id": next_id}, _VERSION_CHAIN_PROJECTION)
        if not next_doc:
            break
        visited.add(next_id)
        chain.append(next_doc)
        node = next_doc
        steps += 1

    return {
        "resume_id": resume_id,
        "versions": [
            {
                "resume_id": d["resume_id"],
                "version": d.get("version") or 1,
                "filename": d.get("filename"),
                "created_at": d.get("created_at"),
                "processing_status": d.get("processing_status"),
            }
            for d in chain
        ],
    }


@router.get("/{resume_id}/download")
async def download_resume(resume_id: str, _: dict = Depends(get_current_user)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    f = await db.resume_files.find_one({"resume_id": resume_id})
    if not f or not f.get("data"):
        raise HTTPException(404, "Resume file not available")

    filename = f.get("filename") or "resume"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    media_type = _MEDIA_TYPES.get(ext, "application/octet-stream")
    return Response(
        content=bytes(f["data"]),
        media_type=media_type,
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.patch("/{resume_id}/salary-expectation")
async def set_resume_salary_expectation(
    resume_id: str, body: SalaryExpectationUpdate, _: dict = Depends(require_admin)
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    result = await db.resumes.update_one(
        {"resume_id": resume_id},
        {"$set": {"salary_expectation": body.salary_expectation}},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Resume not found")
    return {"resume_id": resume_id, "salary_expectation": body.salary_expectation}


@router.delete("/{resume_id}")
async def delete_resume(
    resume_id: str,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("resumes:delete")),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    result = await _delete_resumes(db, [resume_id])
    if result["in_progress"]:
        raise HTTPException(409, "This resume is still being processed. Try again in a few minutes.")
    if result["not_found"]:
        raise HTTPException(404, "Resume not found")

    asyncio.create_task(_audit_resume_deletes(db, user, [resume_id]))
    return {"message": "Resume deleted"}
