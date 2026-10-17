from __future__ import annotations

import asyncio
import logging

from fastapi import HTTPException

from config.database import get_pinecone
from config.llm import (
    TASKS, default_model, embedding_model, get_embedding, task_default, task_options, task_override,
    track_llm_cost,
)
from config.settings import settings
from config.tenancy import current_company, current_company_id
from services.hr_module import workspace_service
from services.hr_module.audit_service import log_audit_event
from services.hr_module.jd_intel import job_embedding_text, job_vector_metadata
from services.hr_module.resume_intel import resume_vector_metadata

logger = logging.getLogger(__name__)

PROVIDER_LABELS = {"openai": "OpenAI", "anthropic": "Anthropic"}
KINDS = ("chat", "embedding", "speech", "transcription")

REINDEX_MAX_BATCH = 30
REINDEX_DEFAULT_BATCH = 20
_REINDEX_PARALLEL = 5


def provider_ready(provider: str) -> bool:
    key = settings.ANTHROPIC_API_KEY if provider == "anthropic" else settings.OPENAI_API_KEY
    return bool(key)


def _options(kind: str) -> list[dict]:
    rows = task_options(kind)
    for row in rows:
        row["available"] = provider_ready(row["provider"])
    return rows


def _row(task: str, options_by_kind: dict[str, list[dict]]) -> dict:
    spec = TASKS[task]
    by_id = {o["id"]: o for o in options_by_kind[spec["kind"]]}
    fallback = task_default(task)
    override = task_override(task)
    chosen = override or fallback
    shown = by_id.get(chosen) or {}
    default_shown = by_id.get(fallback) or {}
    return {
        "key": task,
        "label": spec["label"],
        "group": spec["group"],
        "kind": spec["kind"],
        "model": chosen,
        "model_name": shown.get("name") or chosen,
        "price_label": shown.get("price_label"),
        "override": override,
        "default_model": fallback,
        "default_name": default_shown.get("name") or fallback,
    }


def list_tasks() -> dict:
    options = {kind: _options(kind) for kind in KINDS}
    return {
        "tasks": [_row(task, options) for task in TASKS],
        "options": options,
        "default_model": default_model(),
    }


def _validate_choice(task: str, model: str) -> dict:
    kind = TASKS[task]["kind"]
    by_id = {o["id"]: o for o in _options(kind)}
    option = by_id.get(model)
    if option is None:
        raise HTTPException(400, f"Unknown model for this job. Choose one of: {', '.join(by_id)}")
    if not option["available"]:
        raise HTTPException(
            400,
            f"{PROVIDER_LABELS.get(option['provider'], option['provider'])} is not set up on this platform, "
            f"so {option['name']} cannot be used yet",
        )
    return option


async def set_task_model(db, user: dict, task: str, model: str | None) -> dict:
    if task not in TASKS:
        raise HTTPException(404, "Unknown job")
    chosen = (model or "").strip() or None
    if chosen:
        _validate_choice(task, chosen)

    before = task_override(task) or task_default(task)
    company_id = current_company_id()
    await workspace_service.save_task_model(company_id, task, chosen)
    settings_doc = current_company().setdefault("settings", {})
    overrides = dict(settings_doc.get("task_models") or {})
    if chosen:
        overrides[task] = chosen
    else:
        overrides.pop(task, None)
    settings_doc["task_models"] = overrides

    after = task_override(task) or task_default(task)
    await log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="task_model_change", resource_type="setting", resource_id=task,
        details={"task": task, "from": before, "to": after, "cleared": chosen is None},
    )
    options = {kind: _options(kind) for kind in KINDS}
    return _row(task, options)


def _stale_clause(model: str) -> dict:
    if model == settings.RESUME_EMBEDDING_MODEL:
        return {"embedding_model": {"$exists": True, "$ne": model}}
    return {"embedding_model": {"$ne": model}}


def _needs_embedding(model: str) -> dict:
    return {"$or": [_stale_clause(model), {"embedding.0": {"$exists": False}}, {"embedding.0": 0}]}


def _resume_query(model: str) -> dict:
    return {
        "doc_type": "resume",
        "processing_status": "processed",
        "text": {"$exists": True, "$nin": [None, ""]},
        **_needs_embedding(model),
    }


def _job_query(model: str) -> dict:
    return {
        "doc_type": "job",
        "embedding.0": {"$exists": True},
        **_needs_embedding(model),
    }


async def embedding_status(db) -> dict:
    model = embedding_model()
    stale_jobs = await db.jobs.count_documents(_job_query(model))
    stale_resumes = await db.resumes.count_documents(_resume_query(model))
    return {
        "model": model,
        "platform_default": settings.RESUME_EMBEDDING_MODEL,
        "stale_jobs": stale_jobs,
        "stale_resumes": stale_resumes,
        "stale_total": stale_jobs + stale_resumes,
    }


def _is_blank(vector: list[float]) -> bool:
    return not vector or not any(vector)


async def _upsert(pinecone, vector_id: str, values: list[float], metadata: dict, namespace: str) -> None:
    if pinecone is None:
        return
    await asyncio.to_thread(
        pinecone.upsert,
        vectors=[{"id": vector_id, "values": values, "metadata": metadata}],
        namespace=namespace,
    )


async def _reembed_job(db, pinecone, job: dict, model: str) -> bool:
    vector = await get_embedding(job_embedding_text(job.get("title") or "", job.get("description") or ""))
    if _is_blank(vector):
        return False
    parsed = job.get("parsed_criteria") or {}
    await _upsert(
        pinecone, job["job_id"], vector,
        job_vector_metadata(parsed, parsed.get("experience_level")), namespace="jobs",
    )
    await db.jobs.update_one({"job_id": job["job_id"]}, {"$set": {"embedding": vector, "embedding_model": model}})
    return True


async def _reembed_resume(db, pinecone, resume: dict, model: str) -> bool:
    text = resume.get("text") or ""
    vector = await get_embedding(text)
    if _is_blank(vector):
        return False
    await _upsert(
        pinecone, resume["resume_id"], vector,
        resume_vector_metadata(resume.get("classification") or {}, text), namespace="",
    )
    await db.resumes.update_one({"resume_id": resume["resume_id"]}, {"$set": {"embedding": vector, "embedding_model": model}})
    return True


async def reindex_batch(db, cursor: str | None = None, limit: int = REINDEX_DEFAULT_BATCH) -> dict:
    limit = max(1, min(int(limit or REINDEX_DEFAULT_BATCH), REINDEX_MAX_BATCH))
    phase, _, after = (cursor or "jobs:").partition(":")
    if phase not in ("jobs", "resumes"):
        raise HTTPException(400, "Unknown cursor")

    model = embedding_model()
    pinecone = get_pinecone()
    if phase == "jobs":
        collection, id_field, query, work = db.jobs, "job_id", _job_query(model), _reembed_job
    else:
        collection, id_field, query, work = db.resumes, "resume_id", _resume_query(model), _reembed_resume
    if after:
        query = {**query, id_field: {"$gt": after}}

    docs = await collection.find(query, {"_id": 0}).sort(id_field, 1).limit(limit).to_list(limit)

    processed = failed = 0
    async with track_llm_cost("embedding_reindex", items=len(docs)):
        for start in range(0, len(docs), _REINDEX_PARALLEL):
            chunk = docs[start:start + _REINDEX_PARALLEL]
            results = await asyncio.gather(
                *(work(db, pinecone, doc, model) for doc in chunk), return_exceptions=True,
            )
            for doc, result in zip(chunk, results):
                if result is True:
                    processed += 1
                else:
                    failed += 1
                    if isinstance(result, Exception):
                        logger.warning("re-embed failed | %s=%s error=%s", id_field, doc.get(id_field), result)

    if len(docs) == limit:
        next_cursor: str | None = f"{phase}:{docs[-1][id_field]}"
    elif phase == "jobs":
        next_cursor = "resumes:"
    else:
        next_cursor = None

    status = await embedding_status(db)
    return {
        "model": model,
        "processed": processed,
        "failed": failed,
        "remaining": status["stale_total"],
        "next_cursor": next_cursor,
        "done": next_cursor is None,
    }
