"""Resumes route — hr_module single upload, list, retrieve, delete."""
import asyncio
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from shared.auth import get_current_user, require_admin
from config.database import get_db
from services.hr_module.audit_service import log_audit_event

router = APIRouter()


class SalaryExpectationUpdate(BaseModel):
    salary_expectation: int

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
    from agents.resume_agent import build_resume_agent
    agent = build_resume_agent()
    result = await agent.ainvoke({
        "resume_id": resume_id,
        "filename": filename,
        "raw_bytes": raw,
        "model_override": model,
    })
    db = get_db()
    if result.get("duplicate") and db is not None:
        await db.resumes.delete_one({"resume_id": resume_id})
        return

    if result.get("error") and db is not None:
        await db.resumes.update_one(
            {"resume_id": resume_id},
            {"$set": {"processing_status": "failed", "error": result["error"]}},
        )
        return

    if job_id and db is not None:
        matched = {
            m.get("job_id"): m.get("score")
            for m in (result.get("matched_jds") or [])
            if isinstance(m, dict)
        }
        score = matched.get(job_id)
        await db.jobs.update_one(
            {"job_id": job_id, "candidate_pipeline.resume_id": {"$ne": resume_id}},
            {"$push": {"candidate_pipeline": {
                "resume_id": resume_id,
                "similarity_score": float(score) if score is not None else 0.0,
                "targeted_upload": score is None,
                "pipeline_stage": "matched",
                "added_at": datetime.now(timezone.utc).isoformat(),
            }}},
        )


@router.post("/upload")
async def upload_resume(
    bg: BackgroundTasks,
    file: UploadFile = File(...),
    job_id: str | None = Form(default=None),
    model_override: str | None = Form(default=None),
    user: dict = Depends(require_admin),
):
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


@router.get("")
async def list_resumes(
    page: int = 1,
    limit: int = 20,
    search: str | None = None,
    domain: str | None = None,
    seniority: str | None = None,
    location: str | None = None,
    skill: str | None = None,
    education_level: str | None = None,
    certification: str | None = None,
    notice_period: str | None = None,
    experience_min: int | None = None,
    experience_max: int | None = None,
    min_match_score: float | None = None,
    job_id: str | None = None,
    industry: str | None = None,
    salary_expectation_min: int | None = None,
    salary_expectation_max: int | None = None,
    worked_at_company: str | None = None,
    _: dict = Depends(get_current_user),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    query: dict = {}
    if search:
        query["$or"] = [
            {"candidate_name": {"$regex": search, "$options": "i"}},
            {"filename": {"$regex": search, "$options": "i"}},
        ]
    if domain:
        query["classification.job_domain"] = domain
    if seniority:
        query["classification.seniority_level"] = seniority
    if location:
        query["location"] = {"$regex": location, "$options": "i"}
    if skill:
        query["classification.skills"] = {"$elemMatch": {"$regex": skill, "$options": "i"}}
    if education_level:
        query["classification.education_level"] = education_level
    if certification:
        query["certifications"] = {"$elemMatch": {"$regex": certification, "$options": "i"}}
    if notice_period:
        query["notice_period"] = {"$regex": notice_period, "$options": "i"}
    if experience_min is not None or experience_max is not None:
        rng: dict = {}
        if experience_min is not None:
            rng["$gte"] = experience_min
        if experience_max is not None:
            rng["$lte"] = experience_max
        query["classification.years_experience"] = rng
    if min_match_score is not None:
        match_clause: dict = {"score": {"$gte": min_match_score}}
        if job_id:
            match_clause["job_id"] = job_id
        query["matched_jds"] = {"$elemMatch": match_clause}
    if industry:
        query["classification.industry"] = industry
    if salary_expectation_min is not None or salary_expectation_max is not None:
        salary_rng: dict = {}
        if salary_expectation_min is not None:
            salary_rng["$gte"] = salary_expectation_min
        if salary_expectation_max is not None:
            salary_rng["$lte"] = salary_expectation_max
        query["salary_expectation"] = salary_rng
    if worked_at_company:
        query["experience"] = {"$elemMatch": {"company": {"$regex": worked_at_company, "$options": "i"}}}
    total = await db.resumes.count_documents(query)
    cursor = (
        db.resumes.find(query, {"_id": 0, "embedding": 0, "text": 0})
        .sort("created_at", -1)
        .skip((page - 1) * limit)
        .limit(limit)
    )
    return {"resumes": await cursor.to_list(length=limit), "total": total, "page": page, "limit": limit}


@router.get("/{resume_id}")
async def get_resume(resume_id: str, include_text: bool = False, _: dict = Depends(get_current_user)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    proj: dict = {"_id": 0, "embedding": 0}
    if not include_text:
        proj["text"] = 0
    doc = await db.resumes.find_one({"resume_id": resume_id}, proj)
    if not doc:
        raise HTTPException(404, "Resume not found")
    return doc


_VERSION_CHAIN_PROJECTION = {
    "_id": 0, "resume_id": 1, "version": 1, "filename": 1,
    "created_at": 1, "processing_status": 1,
    "previous_resume_id": 1, "superseded_by": 1,
}
_MAX_CHAIN_WALK = 200


@router.get("/{resume_id}/versions")
async def get_resume_versions(resume_id: str, _: dict = Depends(get_current_user)):
    """Full resume version chain (MVP2 §2.5 — resume version history).

    Walks backward via previous_resume_id to find the oldest ancestor, then
    forward via superseded_by collecting every descendant — this reaches
    every version regardless of which one in the chain resume_id points at.
    Returns a lightweight, oldest-to-newest list (no extracted text/embedding).
    A resume that was never linked to another (version=1, previous_resume_id
    and superseded_by both None/absent) simply returns a single-entry chain.
    """
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
    """Serve the original resume file bytes for inline preview / download."""
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
    """Admin-only: manually record a candidate's expected salary on the resume
    record. Not LLM-extracted (see SalaryExpectationUpdate)."""
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
async def delete_resume(resume_id: str, user: dict = Depends(require_admin)):
    db = get_db()
    if db is not None:
        await db.resumes.delete_one({"resume_id": resume_id})
        await db.resume_files.delete_one({"resume_id": resume_id})
    from config.database import get_pinecone
    pc = get_pinecone()
    if pc is not None:
        try:
            pc.delete(ids=[resume_id])
        except Exception:
            pass

    asyncio.create_task(log_audit_event(
        db, actor_email=user.get("email"), actor_role=user.get("role"),
        action="resume_delete", resource_type="resume", resource_id=resume_id,
        details={},
    ))
    return {"message": "Resume deleted"}
