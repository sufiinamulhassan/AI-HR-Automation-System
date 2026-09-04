"""
Async resume ingestion pipeline — hr_module.

Responsibilities:
  - Text extraction from PDF / DOCX
  - Candidate email extraction (regex → fallback)
  - SHA-256 deduplication
  - MongoDB + Pinecone storage
  - Bulk batch orchestration
  - Post-hire outcome propagation (absorbed from pipeline.py)
"""
import asyncio
import hashlib
import io
import logging
import re
import uuid
from datetime import datetime, timezone

import pdfplumber
from docx import Document

from config.database import get_db, get_pinecone
from config.settings import settings

logger = logging.getLogger(__name__)

_EMAIL_RE = re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b')


async def extract_text(raw_bytes: bytes, filename: str) -> str:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _extract_sync, raw_bytes, filename)


def _extract_sync(raw_bytes: bytes, filename: str) -> str:
    name = filename.lower()
    if name.endswith(".pdf"):
        try:
            parts = []
            with pdfplumber.open(io.BytesIO(raw_bytes)) as pdf:
                for page in pdf.pages:
                    t = page.extract_text()
                    if t:
                        parts.append(t)
            return "\n".join(parts)
        except Exception as exc:
            raise ValueError(f"Could not read PDF (it may be encrypted, corrupted, or image-only): {exc}")
    if name.endswith(".docx"):
        try:
            doc = Document(io.BytesIO(raw_bytes))
            return "\n".join(p.text for p in doc.paragraphs if p.text.strip())
        except Exception as exc:
            raise ValueError(f"Could not read DOCX file: {exc}")
    if name.endswith(".doc"):
        raise ValueError("Legacy .doc format is not supported — please re-save as .docx or PDF.")
    return raw_bytes.decode("utf-8", errors="ignore")


def extract_email_from_text(text: str) -> str | None:
    """Extract the first plausible email address from resume text."""
    matches = _EMAIL_RE.findall(text[:5000])
    filtered = [
        e for e in matches
        if not any(e.lower().endswith(ext) for ext in (".png", ".jpg", ".pdf", ".doc", ".svg"))
    ]
    return filtered[0] if filtered else None


def infer_name(text: str, filename: str) -> str:
    first_line = text.strip().split("\n")[0].strip()
    if first_line and len(first_line.split()) <= 5 and len(first_line) < 60:
        return first_line
    return filename.rsplit(".", 1)[0].replace("_", " ").replace("-", " ").title()


def _file_hash(raw_bytes: bytes) -> str:
    return hashlib.sha256(raw_bytes).hexdigest()


def _text_hash(text: str) -> str:
    """Content fingerprint: normalize whitespace + case so the same resume
    re-exported to different bytes (different file_hash) is still caught."""
    normalized = re.sub(r"\s+", " ", text or "").strip().lower()
    if len(normalized) < 30:
        return ""
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


async def check_duplicate(
    raw_bytes: bytes,
    text: str | None = None,
    exclude_resume_id: str | None = None,
) -> str | None:
    """Return the resume_id of an existing non-failed duplicate, else None.

    Matches on exact file bytes (file_hash) and, when extracted text is provided,
    on a normalized content fingerprint (text_hash). Failed records are ignored so
    a previously-failed upload can be retried. exclude_resume_id skips the record
    being processed (its own pending stub).
    """
    db = get_db()
    if db is None:
        return None

    or_clauses: list[dict] = [{"file_hash": _file_hash(raw_bytes)}]
    if text:
        th = _text_hash(text)
        if th:
            or_clauses.append({"text_hash": th})

    query: dict = {"$or": or_clauses, "processing_status": {"$ne": "failed"}}
    if exclude_resume_id:
        query["resume_id"] = {"$ne": exclude_resume_id}

    doc = await db.resumes.find_one(query, {"resume_id": 1})
    return doc["resume_id"] if doc else None


async def store_resume(state: dict) -> dict:
    """
    Persist resume to MongoDB + Pinecone.
    Extracts candidate name and email; returns them so the agent can
    pass them downstream (e.g. to auto_invite_node).
    """
    db = get_db()
    pinecone = get_pinecone()

    resume_id = state["resume_id"]
    text = state.get("text", "")
    classification = state.get("classification", {})
    embedding = state.get("embedding", [])
    filename = state.get("filename", "unknown.pdf")
    raw_bytes = state.get("raw_bytes", b"")

    name = infer_name(text, filename)
    email = extract_email_from_text(text)
    file_hash = _file_hash(raw_bytes) if raw_bytes else ""
    text_hash = _text_hash(text)

    matched_jds = state.get("matched_jds", [])

    previous_resume_id: str | None = None
    version = 1
    prior_doc: dict | None = None
    if email and db is not None:
        try:
            prior_cursor = (
                db.resumes.find(
                    {"candidate_email": email, "resume_id": {"$ne": resume_id}},
                    {"resume_id": 1, "version": 1},
                )
                .sort("created_at", -1)
                .limit(1)
            )
            prior_docs = await prior_cursor.to_list(length=1)
            prior_doc = prior_docs[0] if prior_docs else None
        except Exception as exc:
            logger.warning("Resume version lookup failed for email=%s: %s", email, exc)
            prior_doc = None

        if prior_doc:
            previous_resume_id = prior_doc["resume_id"]
            version = int(prior_doc.get("version") or 1) + 1

    doc = {
        "doc_type": "resume",
        "resume_id": resume_id,
        "filename": filename,
        "candidate_name": name,
        "candidate_email": email,
        "text": text,
        "file_hash": file_hash,
        "text_hash": text_hash,
        "classification": classification,
        "embedding": embedding,
        "matched_jds": matched_jds,
        "batch_id": state.get("batch_id"),
        "processing_status": "processed",
        "processing_version": settings.RESUME_PROCESSING_VERSION,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "previous_resume_id": previous_resume_id,
        "version": version,
        "superseded_by": None,
    }

    if db is not None:
        await db.resumes.update_one(
            {"resume_id": resume_id},
            {"$set": doc},
            upsert=True,
        )
        if raw_bytes:
            await db.resume_files.update_one(
                {"resume_id": resume_id},
                {"$set": {"resume_id": resume_id, "filename": filename, "data": raw_bytes}},
                upsert=True,
            )

        if prior_doc:
            try:
                await db.resumes.update_one(
                    {"resume_id": prior_doc["resume_id"]},
                    {"$set": {"superseded_by": resume_id}},
                )
            except Exception as exc:
                logger.warning(
                    "Failed to set superseded_by=%s on prior resume=%s: %s",
                    resume_id, prior_doc["resume_id"], exc,
                )

    if pinecone is not None and embedding:
        pinecone.upsert(
            vectors=[{
                "id": resume_id,
                "values": embedding,
                "metadata": {
                    "doc_type": "resume",
                    "job_domain": classification.get("job_domain", ""),
                    "seniority_level": classification.get("seniority_level", ""),
                    "skills": classification.get("skills", [])[:20],
                    "confidence": float(classification.get("confidence", 0.5)),
                    "years_experience": int(classification.get("years_experience", 0)),
                    "education_level": classification.get("education_level", "other"),
                    "text_snippet": text[:500],
                },
            }]
        )

    return {"candidate_name": name, "candidate_email": email}


async def process_bulk_batch(
    files: list[tuple[str, bytes]],
    batch_id: str,
    model_override: str | None = None,
) -> None:
    """
    Process a list of (filename, bytes) pairs through the full ResumeAgent pipeline.
    Updates upload_batches collection with per-file progress including auto_invited count.
    """
    from agents.resume_agent import build_resume_agent
    from config.llm import start_usage_tracking, record_cost
    agent = build_resume_agent()
    db = get_db()
    usage = start_usage_tracking()
    processed = skipped = failed = auto_invited = 0
    errors: list[dict] = []
    logger.info("process_bulk_batch start | batch=%s files=%d db=%s", batch_id, len(files), db is not None)
    if not files:
        logger.warning("process_bulk_batch | batch=%s received an EMPTY file list", batch_id)

    for filename, raw_bytes in files:
        try:
            existing = await check_duplicate(raw_bytes)
            if existing:
                skipped += 1
                continue

            resume_id = str(uuid.uuid4())
            result = await agent.ainvoke({
                "resume_id": resume_id,
                "filename": filename,
                "raw_bytes": raw_bytes,
                "model_override": model_override,
                "batch_id": batch_id,
            })

            if result.get("duplicate"):
                skipped += 1
            elif result.get("error"):
                logger.warning("Resume error | file=%s error=%s", filename, result["error"])
                failed += 1
                errors.append({"filename": filename, "error": str(result["error"])[:300]})
            else:
                processed += 1
                auto_invited += len(result.get("invited_candidate_ids") or [])

        except Exception as exc:
            logger.error("Unexpected error | file=%s error=%s", filename, exc)
            failed += 1
            errors.append({"filename": filename, "error": str(exc)[:300]})

        if db is not None:
            await db.upload_batches.update_one(
                {"batch_id": batch_id},
                {"$set": {
                    "processed": processed,
                    "skipped_duplicates": skipped,
                    "failed": failed,
                    "auto_invited": auto_invited,
                    "errors": errors[:50],
                    "cost_usd": round(usage["cost_usd"], 4),
                    "tokens": {
                        "prompt": usage["prompt_tokens"],
                        "completion": usage["completion_tokens"],
                        "embedding": usage["embedding_tokens"],
                    },
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }},
                upsert=True,
            )

    logger.info(
        "Batch done | id=%s processed=%d skipped=%d failed=%d auto_invited=%d",
        batch_id, processed, skipped, failed, auto_invited,
    )

    await record_cost("resume_bulk", batch_id, items=processed)


async def apply_resume_outcome(
    resume_id: str,
    *,
    is_hired: bool,
    company: str | None = None,
    job_title: str | None = None,
) -> None:
    """
    Write an admin hire/reject decision back onto the resume document.

    Called from the hire/reject endpoints in routes/candidates.py and
    routes/jobs.py, neither of which guards the call — so this must not raise
    on a decision that was otherwise valid.

    The resume record is the whole propagation — there is no marketplace profile
    or alumni record to keep in step, both being out of scope.
    """
    db = get_db()
    now = datetime.now(timezone.utc).isoformat()

    if db is None:
        return

    await db.resumes.update_one(
        {"resume_id": resume_id},
        {"$set": {
            "is_hired": is_hired,
            "hired_company": company if is_hired else None,
            "hired_job_title": job_title if is_hired else None,
            "hire_updated_at": now,
        }},
    )
