from __future__ import annotations

import os
import re
import uuid
from datetime import datetime, timezone

from fastapi import BackgroundTasks, HTTPException
from pydantic import EmailStr, TypeAdapter, ValidationError

from config.database import get_db
from config.settings import settings
from config.tenancy import current_company, current_company_id
from services.hr_module import careers_service, plan_service
from services.hr_module.audit_service import log_audit_event
from services.hr_module.company_settings_service import display_name
from services.hr_module.resume_intake_service import attach_to_pipeline, run_resume_agent
from shared.quotas import check_ai_action

ALLOWED_EXTENSIONS = ("pdf", "docx", "doc", "txt")
MAX_NAME_CHARS = 120
MAX_PHONE_CHARS = 30
MAX_NOTE_CHARS = 2000
MIN_READABLE_CHARS = 40
CLOSED_MESSAGE = "This company is not accepting applications right now. Please try again later."

_EMAIL = TypeAdapter(EmailStr)
_PHONE = re.compile(r"^[0-9+()\-. ]{5,30}$")
_MAGIC = {
    "pdf": (b"%PDF",),
    "docx": (b"PK\x03\x04",),
    "doc": (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",),
}


def normalise_email(value: str | None) -> str:
    return str(value or "").strip().lower()


def clean_filename(name: str | None) -> str:
    base = os.path.basename(str(name or "").replace("\\", "/")).strip()
    base = re.sub(r"[^\w.\- ]", "_", base)
    return (base or "resume")[:120]


def max_resume_bytes() -> int:
    return max(1, int(settings.CAREERS_MAX_RESUME_MB)) * 1024 * 1024


def validate_form(*, name: str, email: str, phone: str, cover_note: str, consent: bool) -> dict:
    clean_name = " ".join(str(name or "").split())
    if len(clean_name) < 2:
        raise HTTPException(400, "Enter your full name.")
    if len(clean_name) > MAX_NAME_CHARS:
        raise HTTPException(400, f"Your name must be at most {MAX_NAME_CHARS} characters.")
    try:
        clean_email = normalise_email(str(_EMAIL.validate_python(str(email or "").strip())))
    except ValidationError:
        raise HTTPException(400, "Enter a valid email address.")
    clean_phone = " ".join(str(phone or "").split())
    if clean_phone and not _PHONE.match(clean_phone):
        raise HTTPException(400, "Enter a valid phone number, or leave it empty.")
    note = str(cover_note or "").strip()
    if len(note) > MAX_NOTE_CHARS:
        raise HTTPException(400, f"Your note must be at most {MAX_NOTE_CHARS} characters.")
    if not consent:
        raise HTTPException(400, "Please agree to the processing of your application to continue.")
    return {"name": clean_name, "email": clean_email, "phone": clean_phone, "cover_note": note}


def validate_file(filename: str | None, raw: bytes) -> str:
    if not raw:
        raise HTTPException(400, "Attach your résumé as a file.")
    if len(raw) > max_resume_bytes():
        raise HTTPException(413, f"The file is too large. The limit is {int(settings.CAREERS_MAX_RESUME_MB)} MB.")
    name = clean_filename(filename)
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(415, "Upload a PDF, Word (.doc or .docx) or plain text (.txt) file.")
    magic = _MAGIC.get(ext)
    if magic and not raw.startswith(magic):
        raise HTTPException(415, "That file does not look like a valid " + ext.upper() + " document.")
    if ext == "txt" and b"\x00" in raw[:4096]:
        raise HTTPException(415, "That file does not look like a plain text document.")
    return name


async def ensure_readable(filename: str, raw: bytes) -> None:
    from services.hr_module.resume_intel import extract_text

    try:
        text = await extract_text(raw, filename)
    except ValueError as exc:
        if "password protected" in str(exc):
            raise HTTPException(422, "This file is password protected. Remove the password and upload it again.")
        text = ""
    except Exception:
        text = ""
    if len(" ".join(str(text or "").split())) < MIN_READABLE_CHARS:
        raise HTTPException(
            422,
            "We could not read any text in this file. Upload a PDF made from text, not a scan, or a Word or text file.",
        )


async def _check_company_capacity(size: int) -> None:
    try:
        await check_ai_action("careers_apply", per_hour=int(settings.CAREERS_APPLICATIONS_PER_HOUR))
        await plan_service.ensure_storage_available(size)
    except HTTPException as exc:
        if exc.status_code in (402, 413):
            raise HTTPException(503, CLOSED_MESSAGE)
        raise


async def submit_application(
    job_id: str,
    *,
    form: dict,
    filename: str,
    raw: bytes,
    bg: BackgroundTasks,
) -> dict:
    db = get_db()
    if db is None:
        raise HTTPException(503, "The service is unavailable right now. Please try again shortly.")
    if (current_company() or {}).get("kind") == "platform":
        raise HTTPException(404, "This job is no longer open.")
    now = datetime.now(timezone.utc).isoformat()
    job = await db.jobs.find_one(
        {"$and": [{"job_id": job_id}, *careers_service.visibility_clauses(now)]},
        {"_id": 0, "job_id": 1, "title": 1, "company_name": 1},
    )
    if not job:
        raise HTTPException(404, "This job is no longer open.")

    if await db.applications.find_one({"job_id": job_id, "email_normalized": form["email"]}, {"_id": 1}):
        raise HTTPException(409, "You have already applied to this job with this email address.")

    await _check_company_capacity(len(raw))

    application_id = str(uuid.uuid4())
    extra = {"source": "career_page", "application_id": application_id}
    from services.hr_module.resume_intel import _file_hash, check_duplicate

    existing = await check_duplicate(raw)
    if existing:
        resume_id = existing
        await attach_to_pipeline(db, job_id, resume_id, None, extra, rescore=True)
    else:
        resume_id = str(uuid.uuid4())
        await db.resumes.insert_one({
            "resume_id": resume_id,
            "filename": filename,
            "file_hash": _file_hash(raw),
            "processing_status": "pending",
            "created_at": now,
            "source": "career_page",
            "applied_job_id": job_id,
            "applicant": {"name": form["name"], "email": form["email"], "phone": form["phone"]},
        })
        bg.add_task(
            run_resume_agent,
            resume_id, filename, raw, job_id, None,
            pipeline_extra=extra, applicant={"name": form["name"], "email": form["email"]},
        )

    await db.applications.insert_one({
        "application_id": application_id,
        "job_id": job_id,
        "job_title": job.get("title"),
        "resume_id": resume_id,
        "name": form["name"],
        "email": form["email"],
        "email_normalized": form["email"],
        "phone": form["phone"],
        "cover_note": form["cover_note"],
        "source": "career_page",
        "status": "received",
        "consent_at": now,
        "created_at": now,
    })

    await log_audit_event(
        db, actor_email=form["email"], actor_role="candidate",
        action="application_received", resource_type="application", resource_id=application_id,
        details={"job_id": job_id, "title": job.get("title"), "resume_id": resume_id},
    )
    from services.hr_module.webhook_service import emit_event
    await emit_event("application.received", {"application_id": application_id, "job_id": job_id, "title": job.get("title")})

    return {
        "status": "received",
        "application_id": application_id,
        "reference": application_id.split("-")[0].upper(),
        "job_title": job.get("title"),
        "company_name": await careers_service.public_company_name(current_company_id(), job) or await display_name(),
    }
