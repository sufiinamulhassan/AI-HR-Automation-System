"""Intel route — hr_module async bulk resume upload with invite funnel tracking."""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from shared.auth import get_current_user, require_admin, require_superadmin
from config.database import get_db, get_pinecone
from config.settings import settings

router = APIRouter()


def _is_junk_file(filename: str | None) -> bool:
    """Office/OS temp & lock files that aren't real resumes (e.g. Word's
    '~$name.docx' owner-lock files, macOS '._' AppleDouble, hidden dotfiles)."""
    base = (filename or "").replace("\\", "/").rsplit("/", 1)[-1]
    return base.startswith("~$") or base.startswith("._") or base.startswith(".") or not base.strip()


@router.post("/resumes/upload-bulk")
async def bulk_upload(
    bg: BackgroundTasks,
    files: list[UploadFile] = File(...),
    model_override: str | None = Form(default=None),
    user: dict = Depends(require_admin),
):
    """
    Accept up to MAX_BULK_UPLOAD_FILES PDF/DOCX files.
    Returns batch_id immediately. Each file is processed via the ResumeAgent
    pipeline in a background task. Auto-invites fire for matches >= AUTO_INVITE_THRESHOLD.
    """
    if len(files) > settings.MAX_BULK_UPLOAD_FILES:
        raise HTTPException(400, f"Max {settings.MAX_BULK_UPLOAD_FILES} files per request")

    file_data: list[tuple[str, bytes]] = []
    ignored = 0
    for f in files:
        if _is_junk_file(f.filename):
            ignored += 1
            continue
        content = await f.read()
        if not content:
            ignored += 1
            continue
        file_data.append((f.filename or "unknown", content))

    if not file_data:
        raise HTTPException(400, "No valid resume files to process (only temp/empty files were received).")

    db = get_db()
    batch_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    if db is not None:
        await db.upload_batches.insert_one({
            "batch_id": batch_id,
            "total_files": len(file_data),
            "ignored_files": ignored,
            "processed": 0,
            "skipped_duplicates": 0,
            "failed": 0,
            "auto_invited": 0,
            "status": "processing",
            "uploaded_by": user["email"],
            "created_at": now,
            "updated_at": now,
        })

    bg.add_task(_run_batch, batch_id, file_data, model_override)
    return {
        "batch_id": batch_id,
        "total_files": len(file_data),
        "ignored_files": ignored,
        "status": "processing",
        "auto_invite_threshold": settings.AUTO_INVITE_THRESHOLD,
    }


async def _run_batch(batch_id: str, file_data: list[tuple[str, bytes]], model_override: str | None):
    from services.hr_module.resume_intel import process_bulk_batch
    db = get_db()
    try:
        await process_bulk_batch(file_data, batch_id, model_override)
        if db is not None:
            await db.upload_batches.update_one(
                {"batch_id": batch_id},
                {"$set": {"status": "completed", "updated_at": datetime.now(timezone.utc).isoformat()}},
            )
    except Exception as exc:
        if db is not None:
            await db.upload_batches.update_one(
                {"batch_id": batch_id},
                {"$set": {"status": "failed", "error": str(exc)}},
            )


@router.get("/resumes/batch/{batch_id}/status")
async def batch_status(batch_id: str, _: dict = Depends(get_current_user)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    batch = await db.upload_batches.find_one({"batch_id": batch_id}, {"_id": 0})
    if not batch:
        raise HTTPException(404, "Batch not found")
    batch.setdefault("auto_invited", 0)
    return batch


@router.get("/resumes/stats")
async def resume_stats(_: dict = Depends(get_current_user)):
    """Resume pool statistics including invite funnel breakdown."""
    db = get_db()
    if db is None:
        return {
            "total": 0,
            "by_domain": {},
            "by_seniority": {},
            "invite_funnel": {"auto_invited": 0, "manually_invited": 0, "interviewed": 0, "hired": 0},
        }

    total = await db.resumes.count_documents({"processing_status": "processed"})

    _PROCESSED = {"processing_status": "processed"}

    domain_agg = await db.resumes.aggregate([
        {"$match": _PROCESSED},
        {"$group": {"_id": "$classification.job_domain", "count": {"$sum": 1}}},
    ]).to_list(50)

    seniority_agg = await db.resumes.aggregate([
        {"$match": _PROCESSED},
        {"$group": {"_id": "$classification.seniority_level", "count": {"$sum": 1}}},
    ]).to_list(20)

    education_agg = await db.resumes.aggregate([
        {"$match": _PROCESSED},
        {"$group": {"_id": "$classification.education_level", "count": {"$sum": 1}}},
    ]).to_list(20)

    exp_agg = await db.resumes.aggregate([
        {"$match": _PROCESSED},
        {"$bucket": {
            "groupBy": {"$ifNull": ["$classification.years_experience", 0]},
            "boundaries": [0, 2, 4, 7, 11],
            "default": "11+",
            "output": {"count": {"$sum": 1}},
        }},
    ]).to_list(20)
    _EXP_LABELS = {0: "0-1 yrs", 2: "2-3 yrs", 4: "4-6 yrs", 7: "7-10 yrs"}
    by_experience: dict = {}
    for r in exp_agg:
        label = _EXP_LABELS.get(r["_id"], "11+ yrs") if isinstance(r["_id"], int) else "11+ yrs"
        by_experience[label] = by_experience.get(label, 0) + r["count"]

    skills_agg = await db.resumes.aggregate([
        {"$match": _PROCESSED},
        {"$unwind": "$classification.skills"},
        {"$group": {"_id": {"$toLower": "$classification.skills"}, "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 50},
    ]).to_list(50)

    total_skills = await db.resumes.aggregate([
        {"$match": _PROCESSED},
        {"$unwind": "$classification.skills"},
        {"$group": {"_id": {"$toLower": "$classification.skills"}}},
        {"$count": "n"},
    ]).to_list(1)

    auto_invited = await db.candidates.count_documents({"invite_type": "auto"})
    manually_invited = await db.candidates.count_documents({"invite_type": "manual"})
    interviewed = await db.candidates.count_documents({"status": "completed"})
    hired = await db.candidates.count_documents({"pipeline_stage": "hired"})

    by_domain = {r["_id"]: r["count"] for r in domain_agg if r["_id"]}

    return {
        "total": total,
        "total_domains": len(by_domain),
        "total_skills": (total_skills[0]["n"] if total_skills else 0),
        "by_domain": by_domain,
        "by_seniority": {r["_id"]: r["count"] for r in seniority_agg if r["_id"]},
        "by_education": {r["_id"]: r["count"] for r in education_agg if r["_id"]},
        "by_experience": by_experience,
        "top_skills": {r["_id"]: r["count"] for r in skills_agg if r["_id"]},
        "invite_funnel": {
            "auto_invited": auto_invited,
            "manually_invited": manually_invited,
            "interviewed": interviewed,
            "hired": hired,
        },
    }


@router.get("/resumes/batches")
async def list_batches(limit: int = 25, _: dict = Depends(get_current_user)):
    """Recent upload batches for the Activity page (newest first)."""
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    cursor = db.upload_batches.find({}, {"_id": 0}).sort("created_at", -1).limit(max(1, min(limit, 100)))
    return {"batches": await cursor.to_list(length=limit)}


@router.get("/resumes/batch/{batch_id}/detail")
async def batch_detail(batch_id: str, _: dict = Depends(get_current_user)):
    """Full breakdown of a processed batch: counts, per-JD distribution, and cost."""
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    batch = await db.upload_batches.find_one({"batch_id": batch_id}, {"_id": 0})
    if not batch:
        raise HTTPException(404, "Batch not found")

    resumes = await db.resumes.find(
        {"batch_id": batch_id, "processing_status": "processed"},
        {"_id": 0, "resume_id": 1, "candidate_name": 1, "matched_jds": 1},
    ).to_list(length=2000)

    matched = sum(1 for r in resumes if r.get("matched_jds"))
    per_job: dict = {}
    for r in resumes:
        seen = set()
        for m in (r.get("matched_jds") or []):
            jid = m.get("job_id")
            if jid and jid not in seen:
                seen.add(jid)
                per_job[jid] = per_job.get(jid, 0) + 1

    jobs = await db.jobs.find({"job_id": {"$in": list(per_job)}}, {"_id": 0, "job_id": 1, "title": 1}).to_list(length=len(per_job) or 1)
    titles = {j["job_id"]: j.get("title", "(untitled)") for j in jobs}
    by_jd = [
        {"job_id": jid, "title": titles.get(jid, "(deleted JD)"), "count": cnt}
        for jid, cnt in sorted(per_job.items(), key=lambda kv: kv[1], reverse=True)
    ]

    return {
        **batch,
        "stored": len(resumes),
        "matched": matched,
        "not_matched": len(resumes) - matched,
        "by_jd": by_jd,
    }


@router.delete("/resumes/batch/{batch_id}")
async def delete_batch(batch_id: str, _: dict = Depends(require_superadmin)):
    """Super-admin: dismiss a batch notification (removes the batch record only —
    processed resumes are untouched)."""
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    res = await db.upload_batches.delete_one({"batch_id": batch_id})
    return {"deleted": res.deleted_count}


@router.post("/resumes/batches/clear")
async def clear_batches(_: dict = Depends(require_superadmin)):
    """Super-admin: clear all batch notifications (resumes are untouched)."""
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    res = await db.upload_batches.delete_many({})
    return {"deleted": res.deleted_count}


@router.get("/cost/total")
async def cost_total(_: dict = Depends(get_current_user)):
    """Platform-wide lifetime AI spend (OpenAI LLM + embeddings) across every
    processing run — resume uploads, JD parsing, and re-matching.

    Backed by the append-only `cost_ledger`, which is intentionally NOT touched by
    batch delete/clear or resume purge. So this total covers everything from the
    first tracked run onward and keeps growing, even after Activity history is wiped.
    """
    db = get_db()
    zero = {
        "total_cost_usd": 0.0, "prompt_tokens": 0, "completion_tokens": 0,
        "embedding_tokens": 0, "operations": 0, "by_source": {},
        "resumes": 0, "avg_per_resume": 0.0, "since": None,
    }
    if db is None:
        return zero

    agg = await db.cost_ledger.aggregate([
        {"$group": {
            "_id": None,
            "total_cost_usd": {"$sum": "$cost_usd"},
            "prompt_tokens": {"$sum": "$prompt_tokens"},
            "completion_tokens": {"$sum": "$completion_tokens"},
            "embedding_tokens": {"$sum": "$embedding_tokens"},
            "operations": {"$sum": 1},
            "since": {"$min": "$created_at"},
        }},
    ]).to_list(1)
    if not agg:
        return zero

    src_agg = await db.cost_ledger.aggregate([
        {"$group": {"_id": "$source", "cost": {"$sum": "$cost_usd"}}},
    ]).to_list(20)

    resume_agg = await db.cost_ledger.aggregate([
        {"$match": {"source": "resume_bulk"}},
        {"$group": {"_id": None, "cost": {"$sum": "$cost_usd"}, "resumes": {"$sum": "$items"}}},
    ]).to_list(1)
    resume_cost = (resume_agg[0].get("cost", 0.0) if resume_agg else 0.0) or 0.0
    resumes = int((resume_agg[0].get("resumes", 0) if resume_agg else 0) or 0)
    avg_per_resume = round(resume_cost / resumes, 6) if resumes else 0.0

    r = agg[0]
    return {
        "total_cost_usd": round(r.get("total_cost_usd", 0.0) or 0.0, 6),
        "prompt_tokens": int(r.get("prompt_tokens", 0) or 0),
        "completion_tokens": int(r.get("completion_tokens", 0) or 0),
        "embedding_tokens": int(r.get("embedding_tokens", 0) or 0),
        "operations": int(r.get("operations", 0) or 0),
        "by_source": {s["_id"]: round(s["cost"], 6) for s in src_agg if s.get("_id")},
        "resumes": resumes,
        "avg_per_resume": avg_per_resume,
        "since": r.get("since"),
    }


class PurgeRequest(BaseModel):
    from_date: str | None = None
    to_date: str | None = None


@router.post("/resumes/purge")
async def purge_resumes(body: PurgeRequest, _: dict = Depends(require_superadmin)):
    """Super-admin: permanently delete resumes created within a date range from
    every store (Mongo, file blobs, marketplace, JD pipelines, Pinecone)."""
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    query: dict = {}
    if body.from_date or body.to_date:
        rng: dict = {}
        if body.from_date:
            rng["$gte"] = body.from_date
        if body.to_date:
            rng["$lte"] = f"{body.to_date}T23:59:59.999999+00:00"
        query["created_at"] = rng

    ids = [r["resume_id"] for r in await db.resumes.find(query, {"resume_id": 1}).to_list(length=100000)]
    if not ids:
        return {"deleted": 0}

    await db.resumes.delete_many({"resume_id": {"$in": ids}})
    await db.resume_files.delete_many({"resume_id": {"$in": ids}})
    await db[settings.MARKETPLACE_COLLECTION].delete_many({"resume_id": {"$in": ids}})
    await db.jobs.update_many({}, {"$pull": {"candidate_pipeline": {"resume_id": {"$in": ids}}}})

    pc = get_pinecone()
    if pc is not None:
        try:
            pc.delete(ids=ids)
        except Exception:
            pass

    return {"deleted": len(ids)}
