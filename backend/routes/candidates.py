import asyncio
import logging
import uuid
from datetime import datetime, timezone

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field

from shared.auth import get_current_user, require_admin, require_permission
from shared.quotas import ai_action
from shared.schemas import HRCandidateCreate, HRCandidateDecision
from shared.links import base_url
from shared.utils import compute_invite_expiry, new_secure_token
from config.database import get_db
from config.settings import settings
from services.hr_module import department_access
from services.hr_module.audit_service import log_audit_event
from services.hr_module.candidate_redaction import redact_candidate, redact_candidates, scrub_admin_only
from services.hr_module.coding_link_service import coding_expiry_stamp
from services.hr_module.erasure_service import block_erased_candidate
from services.hr_module.permissions import get_department_scope

logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[
    Depends(department_access.enforce_candidate_path_scope),
    Depends(block_erased_candidate),
])


class RegenerateTokenRequest(BaseModel):
    resend: bool = True


class SendCommunicationRequest(BaseModel):
    template: str
    salary: str | None = None
    joining_date: str | None = None
    benefits: str | None = None
    scheduled_start_at: str | None = None
    duration_minutes: int | None = Field(default=None, ge=5, le=480)
    location: str | None = Field(default=None, max_length=300)
    notes: str | None = Field(default=None, max_length=1000)
    display_timezone: str | None = Field(default=None, max_length=64)


class HRCandidateCreateWithPhone(HRCandidateCreate):
    phone: str | None = None


class UpdateNotesRequest(BaseModel):
    notes: str


class UpdateProfileNotesRequest(BaseModel):
    notes: str


class ExternalInterviewRequest(BaseModel):
    candidate_id: str | None = None
    job_id: str | None = None
    resume_id: str | None = None
    name: str | None = Field(default=None, max_length=200)
    email: EmailStr | None = None
    platform: Literal["zoom", "meet", "teams", "other", "physical"]
    platform_label: str | None = Field(default=None, max_length=40)
    join_url: str | None = Field(default=None, max_length=2048)
    location: str | None = Field(default=None, max_length=300)
    create_meeting: bool = False
    scheduled_start_at: str
    duration_minutes: int | None = Field(default=None, ge=5, le=480)
    notes: str | None = Field(default=None, max_length=1000)
    display_timezone: str | None = Field(default=None, max_length=64)
    send_email: bool = True


class ExternalInterviewUpdate(BaseModel):
    platform: Literal["zoom", "meet", "teams", "other", "physical"] | None = None
    platform_label: str | None = Field(default=None, max_length=40)
    join_url: str | None = Field(default=None, max_length=2048)
    location: str | None = Field(default=None, max_length=300)
    create_meeting: bool = False
    scheduled_start_at: str | None = None
    duration_minutes: int | None = Field(default=None, ge=5, le=480)
    notes: str | None = Field(default=None, max_length=1000)
    display_timezone: str | None = Field(default=None, max_length=64)
    send_email: bool = True


class QuestionMark(BaseModel):
    question_id: str = Field(max_length=64)
    rating: Any = None
    notes: str | None = Field(default=None, max_length=20000)


class ExternalReviewRequest(BaseModel):
    attended: bool = True
    interviewer_name: str | None = Field(default=None, max_length=1000)
    interviewer_role: str | None = Field(default=None, max_length=40)
    questions: list[QuestionMark] | None = Field(default=None, max_length=200)
    ratings: dict[str, Any] | None = None
    recommendation: str | None = None
    summary: str | None = Field(default=None, max_length=40000)
    strengths: str | None = Field(default=None, max_length=40000)
    concerns: str | None = Field(default=None, max_length=40000)
    interviewed_at: str | None = None
    note: str | None = Field(default=None, max_length=500)


class InterviewGuideRequest(BaseModel):
    regenerate: bool = False


class GuideQuestionRequest(BaseModel):
    text: str = Field(max_length=4000)
    dimension: str = Field(max_length=40)
    listen_for: str | None = Field(default=None, max_length=4000)


class GuideOrderRequest(BaseModel):
    ids: list[str] = Field(max_length=100)


class DraftSummaryRequest(BaseModel):
    questions: list[QuestionMark] | None = Field(default=None, max_length=200)
    ratings: dict[str, Any] | None = None
    strengths: str | None = Field(default=None, max_length=40000)
    concerns: str | None = Field(default=None, max_length=40000)
    recommendation: str | None = None


class InterviewerLinkRequest(BaseModel):
    interviewer_name: str | None = Field(default=None, max_length=1000)
    interviewer_role: str | None = Field(default=None, max_length=40)
    expires_in_days: int = Field(default=7, ge=1, le=30)


@router.post("")
async def create_candidate(
    body: HRCandidateCreateWithPhone,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("candidates:invite")),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    if not await db.jobs.find_one({"job_id": body.job_id}):
        raise HTTPException(404, "Job not found")
    await department_access.require_job_access(db, user, body.job_id)
    if await db.candidates.find_one({"job_id": body.job_id, "email": body.email}):
        raise HTTPException(409, "This candidate has already been invited to this job")

    from services.hr_module.candidate_identity import (
        find_possible_duplicates,
        normalize_linkedin,
        normalize_phone,
    )

    linkedin_url = None
    phone = body.phone
    if body.resume_id:
        resume_doc = await db.resumes.find_one(
            {"resume_id": body.resume_id}, {"_id": 0, "linkedin_url": 1, "phone": 1}
        )
        if resume_doc:
            linkedin_url = resume_doc.get("linkedin_url")
            phone = phone or resume_doc.get("phone")

    possible_duplicates = await find_possible_duplicates(
        db, email=body.email, phone=phone, linkedin_url=linkedin_url,
        exclude_job_id=body.job_id,
    )

    cid = str(uuid.uuid4())
    token = new_secure_token()
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "doc_type": "candidate",
        "candidate_id": cid,
        "job_id": body.job_id,
        "name": body.name,
        "email": body.email,
        "resume_id": body.resume_id,
        "scenario_id": body.scenario_id,
        "application_source": body.application_source or "career_site",
        "secure_token": token,
        "token_status": "active",
        "status": "invited",
        "pipeline_stage": "invited",
        "invite_type": "manual",
        "session_active": False,
        "invited_by": user["email"],
        "invited_by_role": user["role"],
        "transcript": [],
        "integrity_flags": [],
        "report": None,
        "eval_score": None,
        "phone": phone,
        "phone_normalized": normalize_phone(phone),
        "linkedin_url": linkedin_url,
        "linkedin_normalized": normalize_linkedin(linkedin_url),
        "recruiter_notes": None,
        "invite_sent_at": now,
        "invite_expires_at": compute_invite_expiry(sent_at=now, regenerated_at=None, days=settings.INVITE_LINK_EXPIRY_DAYS),
        "invite_resent_count": 0,
        "created_at": now,
    }
    await db.candidates.insert_one(doc)
    doc.pop("_id", None)

    if body.resume_id:
        await db.jobs.update_one(
            {"job_id": body.job_id, "candidate_pipeline.resume_id": body.resume_id},
            {"$set": {"candidate_pipeline.$.pipeline_stage": "invited"}},
        )

    from services.hr_module.invite_service import send_manual_invite
    delivered = await send_manual_invite(candidate=doc, admin_email=user["email"])
    await db.candidates.update_one(
        {"candidate_id": cid}, {"$set": {"invite_email_delivered": bool(delivered)}},
    )

    from services.hr_module.workflow_engine import TRIGGER_CANDIDATE_INVITED, evaluate_and_apply_rules
    asyncio.create_task(evaluate_and_apply_rules(
        trigger_type=TRIGGER_CANDIDATE_INVITED,
        context={
            "candidate_id": cid, "job_id": body.job_id, "email": body.email,
            "candidate_name": body.name, "invite_type": "manual",
            "secure_token": token,
        },
    ))
    from services.hr_module.lifecycle_events import announce_candidate_invited
    await announce_candidate_invited(
        candidate_id=cid, name=body.name, job_id=body.job_id, invite_type="manual",
    )

    asyncio.create_task(log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="candidate_invited", resource_type="candidate", resource_id=cid,
        details={"job_id": body.job_id, "email": body.email, "invite_type": "manual"},
    ))

    try:
        from services.hr_module.candidate_profile_service import upsert_candidate_profile
        await upsert_candidate_profile(doc)
    except Exception as exc:
        logger.warning("upsert_candidate_profile failed for candidate_id=%s: %s", cid, exc)

    return {
        "candidate_id": cid,
        "secure_token": token,
        "interview_url": f"{base_url()}/interview/{token}",
        "invite_type": "manual",
        "email_sent": bool(delivered),
        "possible_duplicates": possible_duplicates,
    }


async def _external_details(
    *,
    platform: str,
    label: str | None,
    join_url: str | None,
    location: str | None = None,
    create_meeting: bool,
    start_iso: str,
    duration: int,
    notes: str | None,
    tz: str | None,
    candidate_name: str,
    job: dict,
) -> dict:
    from services.hr_module import external_interview_service as ext
    from services.hr_module.meeting_service import (
        PROVIDERS, MeetingServiceError, create_meeting as create_provider_meeting,
    )

    resolved_label = ext.platform_label(platform, label)
    meeting: dict | None = None
    url = join_url
    place: str | None = None
    if platform == ext.PHYSICAL:
        if create_meeting:
            raise ext.ExternalInterviewError("An interview in person has no meeting to create.")
        place = ext.validate_location(location)
        url = None
    elif create_meeting:
        if platform not in PROVIDERS:
            raise ext.ExternalInterviewError(
                "Only Zoom and Microsoft Teams meetings can be created for you. Paste the link instead."
            )
        try:
            meeting = await create_provider_meeting(
                topic=f"Interview: {candidate_name} for {job.get('title') or 'the role'}",
                start_iso=start_iso,
                duration_minutes=duration,
                agenda=f"Interview for the {job.get('title') or ''} position.",
                provider=platform,
            )
        except MeetingServiceError as exc:
            raise HTTPException(502, f"Could not create the meeting: {exc}")
        url = meeting.get("join_url")
    if platform != ext.PHYSICAL:
        url = ext.validate_join_url(platform, url)

    return {
        "platform": platform,
        "platform_label": resolved_label,
        "join_url": url,
        "location": place,
        "scheduled_start_at": start_iso,
        "duration_minutes": duration,
        "notes": (notes or "").strip() or None,
        "display_timezone": ext.validate_timezone(tz),
        "meeting_created": meeting is not None,
        "meeting": {k: v for k, v in meeting.items() if k not in ("host_url", "password")} if meeting else None,
    }


async def _send_external_email(db, cand: dict, job: dict, details: dict, *, updated: bool) -> bool:
    from services.hr_module.email_service import send_external_interview_email, send_physical_interview_email

    if details.get("platform") == "physical":
        return await send_physical_interview_email(
            to_email=cand["email"],
            candidate_name=cand.get("name") or "Candidate",
            job_title=job.get("title") or "the role",
            company_name=job.get("company_name"),
            location=details["location"],
            scheduled_start_at=details["scheduled_start_at"],
            duration_minutes=details["duration_minutes"],
            notes=details.get("notes"),
            display_timezone=details.get("display_timezone"),
            updated=updated,
            db=db, candidate_id=cand.get("candidate_id"), job_id=cand.get("job_id"),
            calendar_sequence=int(details.get("calendar_sequence") or 0),
        )
    return await send_external_interview_email(
        to_email=cand["email"],
        candidate_name=cand.get("name") or "Candidate",
        job_title=job.get("title") or "the role",
        company_name=job.get("company_name"),
        platform_label=details["platform_label"],
        join_url=details["join_url"],
        scheduled_start_at=details["scheduled_start_at"],
        duration_minutes=details["duration_minutes"],
        notes=details.get("notes"),
        display_timezone=details.get("display_timezone"),
        updated=updated,
        db=db, candidate_id=cand.get("candidate_id"), job_id=cand.get("job_id"),
        calendar_sequence=int(details.get("calendar_sequence") or 0),
    )


@router.post("/external-interview")
async def create_external_interview(
    body: ExternalInterviewRequest,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("interview:external_schedule")),
):
    from services.hr_module import external_interview_service as ext
    from services.hr_module.pipeline_stage_service import set_pipeline_stage

    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    cand: dict | None = None
    if body.candidate_id:
        cand = await db.candidates.find_one({"candidate_id": body.candidate_id})
        if not cand:
            raise HTTPException(404, "Candidate not found")
        if cand.get("pipeline_stage") in ("hired", "rejected"):
            raise HTTPException(409, f"This candidate is already {cand['pipeline_stage']}.")
        if ext.is_external(cand):
            raise HTTPException(409, "An interview on another platform is already set up. Change its time or link instead.")
        if cand.get("transcript") or cand.get("session_active") or cand.get("token_status") == "consumed":
            raise HTTPException(409, "This candidate has already started the AI interview on this platform.")
        job_id = cand.get("job_id")
        name, email = cand.get("name"), cand.get("email")
    else:
        if not (body.job_id and body.name and body.email):
            raise HTTPException(422, "Choose a candidate, or give a job, a name and an email.")
        job_id, name, email = body.job_id, body.name, str(body.email)
        if await db.candidates.find_one({"job_id": job_id, "email": email}):
            raise HTTPException(409, "This candidate has already been invited to this job")

    job = await db.jobs.find_one({"job_id": job_id}) if job_id else None
    if not job:
        raise HTTPException(404, "Job not found")
    if not department_access.job_in_scope(job, await get_department_scope(user)):
        raise HTTPException(404, "Candidate not found" if body.candidate_id else "Job not found")
    if not email:
        raise HTTPException(422, "This candidate has no email on file.")

    duration = body.duration_minutes or settings.INTERVIEW_DURATION_MINUTES
    try:
        start_iso = ext.validate_start(body.scheduled_start_at)
        details = await _external_details(
            platform=body.platform, label=body.platform_label, join_url=body.join_url,
            location=body.location, create_meeting=body.create_meeting, start_iso=start_iso, duration=duration,
            notes=body.notes, tz=body.display_timezone, candidate_name=name or "Candidate", job=job,
        )
    except ext.ExternalInterviewError as exc:
        raise HTTPException(422, str(exc))

    now = datetime.now(timezone.utc).isoformat()
    details.update({
        "status": "scheduled",
        "scheduled_by": user["email"],
        "scheduled_at": now,
        "email_delivered": None,
        "resent_count": 0,
        "history": [],
        "calendar_sequence": 0,
    })
    shared_updates = {
        "interview_mode": "external",
        "external_interview": details,
        "pipeline_stage": "interviewing",
        "status": "interviewing",
        "scheduled_start_at": details["scheduled_start_at"],
        "meeting_join_url": details["join_url"],
    }

    if cand is None:
        cid = str(uuid.uuid4())
        cand = {
            "doc_type": "candidate",
            "candidate_id": cid,
            "job_id": job_id,
            "name": name,
            "email": email,
            "resume_id": body.resume_id,
            "scenario_id": None,
            "application_source": "auto_match" if body.resume_id else "manual",
            "secure_token": new_secure_token(),
            "token_status": "unused",
            "invite_type": "manual",
            "session_active": False,
            "invited_by": user["email"],
            "invited_by_role": user["role"],
            "transcript": [],
            "integrity_flags": [],
            "report": None,
            "eval_score": None,
            "recruiter_notes": None,
            "invite_sent_at": now,
            "invite_resent_count": 0,
            "created_at": now,
            **shared_updates,
        }
        await db.candidates.insert_one(cand)
        cand.pop("_id", None)
        try:
            from services.hr_module.candidate_profile_service import upsert_candidate_profile
            await upsert_candidate_profile(cand)
        except Exception as exc:
            logger.warning("upsert_candidate_profile failed for candidate_id=%s: %s", cid, exc)
    else:
        await db.candidates.update_one({"candidate_id": cand["candidate_id"]}, {"$set": shared_updates})
        cand = {**cand, **shared_updates}

    if cand.get("resume_id"):
        await set_pipeline_stage(db, job_id, cand["resume_id"], "interviewing", user["email"], job=job)

    email_sent = False
    if body.send_email:
        email_sent = await _send_external_email(db, cand, job, details, updated=False)
        await db.candidates.update_one(
            {"candidate_id": cand["candidate_id"]},
            {"$set": {"external_interview.email_delivered": bool(email_sent)}},
        )
        details["email_delivered"] = bool(email_sent)

    asyncio.create_task(log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="external_interview_scheduled", resource_type="candidate", resource_id=cand["candidate_id"],
        details={
            "job_id": job_id, "platform": details["platform"],
            "scheduled_start_at": details["scheduled_start_at"], "email_sent": bool(email_sent),
        },
    ))
    from services.hr_module.lifecycle_events import announce_external_scheduled, announce_stage_change
    await announce_external_scheduled(
        candidate_id=cand["candidate_id"], name=cand.get("name"), job_id=job_id,
        platform_label=details.get("platform_label"), scheduled_start_at=details.get("scheduled_start_at"),
    )
    await announce_stage_change(
        candidate_id=cand["candidate_id"], name=cand.get("name"), job_id=job_id, stage="interviewing",
    )
    return {
        "candidate_id": cand["candidate_id"],
        "interview_mode": "external",
        "external_interview": details,
        "email_sent": bool(email_sent),
    }


@router.patch("/{candidate_id}/external-interview")
async def update_external_interview(
    candidate_id: str,
    body: ExternalInterviewUpdate,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("interview:external_schedule")),
):
    from services.hr_module import external_interview_service as ext

    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    cand = await db.candidates.find_one({"candidate_id": candidate_id})
    if not cand:
        raise HTTPException(404, "Candidate not found")
    if not ext.is_external(cand):
        raise HTTPException(409, "This candidate is not set up for an interview on another platform.")
    if ext.has_review(cand) or cand.get("pipeline_stage") in ("hired", "rejected"):
        raise HTTPException(409, "This interview is already reviewed or closed, so it can no longer change.")

    current = cand.get("external_interview") or {}
    job = await db.jobs.find_one({"job_id": cand.get("job_id")}) or {}

    platform = body.platform or current.get("platform") or "other"
    switching = platform != current.get("platform")
    label = body.platform_label if body.platform_label is not None else current.get("platform_label")
    duration = body.duration_minutes or current.get("duration_minutes") or settings.INTERVIEW_DURATION_MINUTES
    notes = body.notes if body.notes is not None else current.get("notes")
    tz = body.display_timezone or current.get("display_timezone")
    join_url = body.join_url if body.join_url is not None else (None if switching else current.get("join_url"))
    location = body.location if body.location is not None else (None if switching else current.get("location"))

    try:
        if body.scheduled_start_at is not None:
            start_iso = ext.validate_start(body.scheduled_start_at)
        elif current.get("status") == "no_show":
            raise ext.ExternalInterviewError("Pick a new time for the rescheduled interview.")
        else:
            start_iso = current.get("scheduled_start_at")
        details = await _external_details(
            platform=platform, label=label, join_url=join_url, location=location, create_meeting=body.create_meeting,
            start_iso=start_iso, duration=duration, notes=notes, tz=tz,
            candidate_name=cand.get("name") or "Candidate", job=job,
        )
    except ext.ExternalInterviewError as exc:
        raise HTTPException(422, str(exc))

    now = datetime.now(timezone.utc).isoformat()
    changes = ext.reschedule_changes(current, details)
    details.update({
        "status": "scheduled",
        "scheduled_by": current.get("scheduled_by"),
        "scheduled_at": current.get("scheduled_at"),
        "updated_by": user["email"],
        "updated_at": now,
        "email_delivered": current.get("email_delivered"),
        "resent_count": current.get("resent_count", 0),
        "history": ext.history_with(current.get("history"), at=now, by=user["email"], changes=changes),
        "calendar_sequence": int(current.get("calendar_sequence") or 0) + 1,
    })
    await db.candidates.update_one(
        {"candidate_id": candidate_id},
        {"$set": {
            "external_interview": details,
            "scheduled_start_at": details["scheduled_start_at"],
            "meeting_join_url": details["join_url"],
        }},
    )

    email_sent = False
    if body.send_email:
        email_sent = await _send_external_email(db, cand, job, details, updated=True)
        await db.candidates.update_one(
            {"candidate_id": candidate_id},
            {"$set": {"external_interview.email_delivered": bool(email_sent)}},
        )
        details["email_delivered"] = bool(email_sent)

    asyncio.create_task(log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="external_interview_updated", resource_type="candidate", resource_id=candidate_id,
        details={
            "platform": details["platform"],
            "scheduled_start_at": details["scheduled_start_at"], "email_sent": bool(email_sent),
            "changed": sorted(changes),
        },
    ))
    return {"external_interview": details, "email_sent": bool(email_sent)}


@router.post("/{candidate_id}/external-interview/resend")
async def resend_external_interview(
    candidate_id: str,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("interview:external_schedule")),
):
    from services.hr_module import external_interview_service as ext

    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    cand = await db.candidates.find_one({"candidate_id": candidate_id})
    if not cand:
        raise HTTPException(404, "Candidate not found")
    if not ext.is_external(cand):
        raise HTTPException(409, "This candidate is not set up for an interview on another platform.")
    if ext.has_review(cand):
        raise HTTPException(409, "This interview is already reviewed.")
    if not cand.get("email"):
        raise HTTPException(400, "No email on file for this candidate")

    details = cand.get("external_interview") or {}
    job = await db.jobs.find_one({"job_id": cand.get("job_id")}) or {}
    email_sent = await _send_external_email(db, cand, job, details, updated=False)
    await db.candidates.update_one(
        {"candidate_id": candidate_id},
        {"$set": {"external_interview.email_delivered": bool(email_sent)},
         "$inc": {"external_interview.resent_count": 1}},
    )
    return {"email_sent": bool(email_sent), "sent_to": cand["email"]}


@router.post("/{candidate_id}/external-review")
async def submit_external_review(
    candidate_id: str,
    body: ExternalReviewRequest,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("interview:external_review")),
):
    from services.hr_module import external_interview_service as ext
    from services.hr_module import scorecard_service
    from services.hr_module.pipeline_stage_service import set_pipeline_stage

    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    cand = await db.candidates.find_one({"candidate_id": candidate_id})
    if not cand:
        raise HTTPException(404, "Candidate not found")
    if not ext.is_external(cand):
        raise HTTPException(409, "Only interviews held on another platform are reviewed here.")
    if cand.get("pipeline_stage") in ("hired", "rejected"):
        raise HTTPException(409, f"This candidate is already {cand['pipeline_stage']}, so the review is closed.")

    now = datetime.now(timezone.utc).isoformat()
    existing = cand.get("external_review")

    if not body.attended:
        if existing:
            raise HTTPException(409, "A review is already filed, so this cannot be marked as a no-show.")
        await db.candidates.update_one(
            {"candidate_id": candidate_id},
            {"$set": {
                "external_interview.status": "no_show",
                "external_interview.no_show": {
                    "at": now, "by": user["email"],
                    "note": (body.note or body.summary or "").strip() or None,
                },
            }},
        )
        asyncio.create_task(log_audit_event(
            db, actor_email=user["email"], actor_role=user.get("role"),
            action="external_interview_no_show", resource_type="candidate", resource_id=candidate_id,
            details={"job_id": cand.get("job_id")},
        ))
        return {"stage": cand.get("pipeline_stage"), "external_status": "no_show"}

    fields = body.model_dump(exclude={"attended", "note"})
    fields["interviewer_name"] = (fields.get("interviewer_name") or "").strip() or _signed_in_name(user)
    fields["interviewer_role"] = fields.get("interviewer_role") or "hr"
    try:
        result = await scorecard_service.file_hr_scorecard(
            db, cand, author_email=user["email"], fields=fields,
            extra_set={"pipeline_stage": "completed", "status": "completed"},
        )
    except ext.ExternalInterviewError as exc:
        raise HTTPException(422, str(exc))
    review, report = result.get("review"), result.get("report")
    if not review or not report:
        raise HTTPException(500, "The scorecard could not be saved. Please try again.")

    if cand.get("resume_id"):
        await set_pipeline_stage(db, cand["job_id"], cand["resume_id"], "completed", user["email"])

    from services.hr_module.workflow_engine import TRIGGER_CANDIDATE_STATUS_CHANGED, evaluate_and_apply_rules
    asyncio.create_task(evaluate_and_apply_rules(
        trigger_type=TRIGGER_CANDIDATE_STATUS_CHANGED,
        context={
            "candidate_id": candidate_id, "job_id": cand.get("job_id"),
            "email": cand.get("email"), "candidate_name": cand.get("name"),
            "status": "completed", "pipeline_stage": "completed",
            "score": report["final_score"],
        },
    ))
    asyncio.create_task(log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="external_review_submitted", resource_type="candidate", resource_id=candidate_id,
        details={
            "recommendation": review["recommendation"], "overall": review["overall"],
            "edited": bool(existing) or review["edited"],
            "scorecard_id": result["scorecard"]["scorecard_id"], "panel_size": review["panel_size"],
        },
    ))
    from services.hr_module.lifecycle_events import announce_scorecard_submitted, announce_stage_change
    await announce_scorecard_submitted(
        candidate_id=candidate_id, name=cand.get("name"), job_id=cand.get("job_id"),
        scorecard_id=result["scorecard"]["scorecard_id"], stage="completed",
    )
    await announce_stage_change(
        candidate_id=candidate_id, name=cand.get("name"), job_id=cand.get("job_id"), stage="completed",
    )
    return {
        "stage": "completed",
        "external_status": "reviewed",
        "overall": review["overall"],
        "final_score": report["final_score"],
        "report_ready": True,
    }


def _signed_in_name(user: dict) -> str:
    return (user.get("name") or "").strip() or user.get("email") or "HR"


@router.get("/{candidate_id}/external-review")
async def get_external_review(
    candidate_id: str,
    _: dict = Depends(require_admin),
    __: dict = Depends(require_permission("interview:external_review")),
):
    from services.hr_module import interview_guide_service as guides
    from services.hr_module.scorecard_service import ordered_scorecards

    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    cand = await db.candidates.find_one(
        {"candidate_id": candidate_id},
        {
            "_id": 0, "interview_mode": 1, "external_interview": 1, "external_review": 1,
            "interview_guide": 1, "interview_scorecards": 1,
        },
    )
    if not cand:
        raise HTTPException(404, "Candidate not found")
    interview = cand.get("external_interview")
    if interview is not None:
        interview = {**interview, "history": interview.get("history") or []}
    return {
        "external_interview": interview,
        "external_review": cand.get("external_review"),
        "interview_guide": guides.with_sources(cand.get("interview_guide")),
        "scorecards": ordered_scorecards(cand.get("interview_scorecards")),
    }


_GUIDE_JOB_FIELDS = {"_id": 0, "title": 1, "description": 1, "parsed_criteria": 1, "targeting": 1}


@router.post("/{candidate_id}/interview-guide")
async def generate_interview_guide(
    candidate_id: str,
    body: InterviewGuideRequest = InterviewGuideRequest(),
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("interview:external_review")),
    _quota: None = Depends(ai_action("guide", per_hour=300)),
):
    from services.hr_module import external_interview_service as ext
    from services.hr_module import interview_guide_service as guides

    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    cand = await db.candidates.find_one({"candidate_id": candidate_id})
    if not cand:
        raise HTTPException(404, "Candidate not found")
    if not ext.is_external(cand):
        raise HTTPException(409, "Only interviews held on another platform have an interview guide.")

    existing = cand.get("interview_guide")
    has_guide = bool(existing and existing.get("questions"))
    if has_guide and not body.regenerate:
        return guides.with_sources(existing)
    regenerating = has_guide
    if regenerating and cand.get("interview_scorecards"):
        raise HTTPException(409, "Scorecards already use this guide, so it cannot be regenerated.")

    job = await db.jobs.find_one({"job_id": cand.get("job_id")}, _GUIDE_JOB_FIELDS) or {}
    guide = await guides.generate_guide(db, cand, job, generated_by=user["email"])
    if regenerating:
        guide = guides.keep_custom_questions(guide, existing)
    if not await guides.store_guide(db, candidate_id, guide, replace=regenerating):
        if regenerating:
            raise HTTPException(409, "Scorecards already use this guide, so it cannot be regenerated.")
        fresh = await db.candidates.find_one({"candidate_id": candidate_id}, {"_id": 0, "interview_guide": 1})
        return guides.with_sources((fresh or {}).get("interview_guide") or guide)

    await log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="interview_guide_generated", resource_type="candidate", resource_id=candidate_id,
        details={"regenerate": regenerating, "fallback": guide["fallback"], "questions": len(guide["questions"])},
    )
    return guides.with_sources(guide)


@router.get("/{candidate_id}/interview-guide")
async def get_interview_guide(
    candidate_id: str,
    _: dict = Depends(require_admin),
    __: dict = Depends(require_permission("interview:external_review")),
):
    from services.hr_module import interview_guide_service as guides

    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    cand = await db.candidates.find_one({"candidate_id": candidate_id}, {"_id": 0, "candidate_id": 1, "interview_guide": 1})
    if not cand:
        raise HTTPException(404, "Candidate not found")
    return guides.with_sources(cand.get("interview_guide"))


async def _external_candidate_for_guide(db, candidate_id: str) -> dict:
    from services.hr_module import external_interview_service as ext

    cand = await db.candidates.find_one({"candidate_id": candidate_id})
    if not cand:
        raise HTTPException(404, "Candidate not found")
    if not ext.is_external(cand):
        raise HTTPException(409, "Only interviews held on another platform have an interview guide.")
    return cand


async def _refresh_report_after_guide_edit(db, candidate_id: str) -> None:
    from services.hr_module.scorecard_service import rebuild_review_and_report

    try:
        await rebuild_review_and_report(db, candidate_id)
    except Exception as exc:
        logger.warning("report rebuild after a guide edit failed | candidate=%s error=%s", candidate_id, exc)


@router.post("/{candidate_id}/interview-guide/questions")
async def add_interview_guide_question(
    candidate_id: str,
    body: GuideQuestionRequest,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("interview:external_review")),
):
    from services.hr_module import interview_guide_service as guides

    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    await _external_candidate_for_guide(db, candidate_id)
    try:
        guide = await guides.add_custom_question(
            db, candidate_id, text=body.text, dimension=body.dimension,
            listen_for=body.listen_for, actor=user["email"],
        )
    except guides.GuideEditError as exc:
        raise HTTPException(exc.status_code, str(exc))
    added = guide["questions"][-1]
    await log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="interview_guide_question_added", resource_type="candidate", resource_id=candidate_id,
        details={"question_id": added.get("id"), "dimension": body.dimension, "questions": len(guide["questions"])},
    )
    return guide


@router.delete("/{candidate_id}/interview-guide/questions/{question_id}")
async def delete_interview_guide_question(
    candidate_id: str,
    question_id: str,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("interview:external_review")),
):
    from services.hr_module import interview_guide_service as guides

    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    cand = await _external_candidate_for_guide(db, candidate_id)
    try:
        guide = await guides.delete_question(db, cand, question_id)
    except guides.GuideEditError as exc:
        raise HTTPException(exc.status_code, str(exc))
    await _refresh_report_after_guide_edit(db, candidate_id)
    await log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="interview_guide_question_deleted", resource_type="candidate", resource_id=candidate_id,
        details={"question_id": question_id, "questions": len(guide["questions"])},
    )
    return guide


@router.put("/{candidate_id}/interview-guide/order")
async def reorder_interview_guide(
    candidate_id: str,
    body: GuideOrderRequest,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("interview:external_review")),
):
    from services.hr_module import interview_guide_service as guides

    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    cand = await _external_candidate_for_guide(db, candidate_id)
    try:
        guide = await guides.reorder_questions(db, cand, body.ids)
    except guides.GuideEditError as exc:
        raise HTTPException(exc.status_code, str(exc))
    await _refresh_report_after_guide_edit(db, candidate_id)
    await log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="interview_guide_reordered", resource_type="candidate", resource_id=candidate_id,
        details={"questions": len(guide["questions"])},
    )
    return guide


@router.post("/{candidate_id}/external-review/draft-summary")
async def draft_external_review_summary(
    candidate_id: str,
    body: DraftSummaryRequest,
    _: dict = Depends(require_admin),
    __: dict = Depends(require_permission("interview:external_review")),
    _quota: None = Depends(ai_action("review_summary", per_hour=300)),
):
    from services.hr_module import external_interview_service as ext
    from services.hr_module import interview_guide_service as guides
    from services.hr_module import scorecard_service as cards

    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    cand = await db.candidates.find_one({"candidate_id": candidate_id}, {"_id": 0})
    if not cand:
        raise HTTPException(404, "Candidate not found")
    if not ext.is_external(cand):
        raise HTTPException(409, "Only interviews held on another platform are reviewed here.")

    try:
        ratings = cards.normalise_ratings(body.ratings, partial=True)
        marks = cards.resolve_question_marks(
            [q.model_dump() for q in body.questions] if body.questions else [], cand.get("interview_guide"),
        )
        strengths = cards.clean_text(body.strengths, limit=cards.MAX_FREE_TEXT_CHARS, label="Strengths")
        concerns = cards.clean_text(body.concerns, limit=cards.MAX_FREE_TEXT_CHARS, label="Concerns")
        if body.recommendation is not None and body.recommendation not in ext.RECOMMENDATIONS:
            raise ext.ExternalInterviewError("Choose a valid recommendation.")
    except ext.ExternalInterviewError as exc:
        raise HTTPException(422, str(exc))
    if not (ratings or strengths or concerns or any(m["rating"] is not None or m["notes"] for m in marks)):
        raise HTTPException(422, "Add some ratings or notes first.")

    try:
        summary = await guides.draft_summary(
            candidate_id=candidate_id, ratings=ratings, questions=marks,
            strengths=strengths, concerns=concerns, recommendation=body.recommendation,
        )
    except guides.DraftSummaryUnavailable as exc:
        raise HTTPException(502, str(exc))
    return {"summary": summary}


@router.post("/{candidate_id}/interviewer-links")
async def create_interviewer_link(
    candidate_id: str,
    body: InterviewerLinkRequest = InterviewerLinkRequest(),
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("interview:external_review")),
):
    from services.hr_module import external_interview_service as ext
    from services.hr_module import interview_guide_service as guides
    from services.hr_module import interviewer_link_service as links
    from services.hr_module.scorecard_service import lock_reason

    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    cand = await db.candidates.find_one({"candidate_id": candidate_id})
    if not cand:
        raise HTTPException(404, "Candidate not found")
    reason = lock_reason(cand)
    if reason:
        raise HTTPException(409, reason)

    try:
        links.clean_inputs(body.interviewer_name, body.interviewer_role, body.expires_in_days)
        await links.ensure_capacity(db, candidate_id)
        job = await db.jobs.find_one({"job_id": cand.get("job_id")}, _GUIDE_JOB_FIELDS) or {}
        await guides.ensure_guide(db, cand, job, generated_by=user["email"])
        token, doc = await links.create_link(
            db, candidate=cand, created_by=user["email"],
            interviewer_name=body.interviewer_name, interviewer_role=body.interviewer_role,
            expires_in_days=body.expires_in_days,
        )
    except ext.ExternalInterviewError as exc:
        raise HTTPException(422, str(exc))
    except links.TooManyLinks:
        raise HTTPException(
            409, f"This candidate already has {links.MAX_ACTIVE_LINKS} interviewer links. Revoke one first.",
        )

    await log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="interviewer_link_created", resource_type="candidate", resource_id=candidate_id,
        details={
            "link_id": doc["link_id"], "interviewer_role": doc["interviewer_role"],
            "expires_at": doc["expires_at"],
        },
    )
    return {
        "link_id": doc["link_id"],
        "token": token,
        "url": links.link_url(token),
        "expires_at": doc["expires_at"],
    }


@router.get("/{candidate_id}/interviewer-links")
async def list_interviewer_links(
    candidate_id: str,
    _: dict = Depends(require_admin),
    __: dict = Depends(require_permission("interview:external_review")),
):
    from services.hr_module.interviewer_link_service import list_links

    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    if not await db.candidates.find_one({"candidate_id": candidate_id}, {"_id": 1}):
        raise HTTPException(404, "Candidate not found")
    return await list_links(db, candidate_id)


@router.post("/{candidate_id}/interviewer-links/{link_id}/revoke")
async def revoke_interviewer_link(
    candidate_id: str,
    link_id: str,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("interview:external_review")),
):
    from services.hr_module.interviewer_link_service import revoke_link

    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    row = await revoke_link(db, candidate_id=candidate_id, link_id=link_id, actor_email=user["email"])
    if row is None:
        raise HTTPException(404, "Interviewer link not found")
    await log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="interviewer_link_revoked", resource_type="candidate", resource_id=candidate_id,
        details={"link_id": link_id},
    )
    return row


@router.get("")
async def list_candidates(
    job_id: str | None = None,
    status: str | None = None,
    invite_type: str | None = None,
    min_match_score: float | None = None,
    page: int = 1,
    limit: int = 20,
    user: dict = Depends(get_current_user),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    query: dict = {"doc_type": "candidate"}
    if status:
        query["status"] = status
    if invite_type:
        query["invite_type"] = invite_type
    if min_match_score is not None:
        query["match_score"] = {"$gte": min_match_score}

    department_id = await get_department_scope(user)
    if department_id is not None:
        scoped_job_ids = await department_access.scoped_job_ids(db, department_id)
        if job_id:
            if job_id not in scoped_job_ids:
                return {"candidates": [], "total": 0}
            query["job_id"] = job_id
        else:
            query["job_id"] = {"$in": scoped_job_ids}
    elif job_id:
        query["job_id"] = job_id

    total = await db.candidates.count_documents(query)
    cursor = (
        db.candidates.find(query, {"_id": 0})
        .sort("created_at", -1)
        .skip((page - 1) * limit)
        .limit(limit)
    )
    return {
        "candidates": redact_candidates(user, await cursor.to_list(length=limit)),
        "total": total,
    }


@router.get("/profile/{profile_id}")
async def get_profile(profile_id: str, user: dict = Depends(get_current_user)):
    from services.hr_module.candidate_profile_service import get_candidate_profile

    profile = await get_candidate_profile(profile_id)
    profile = await department_access.scope_profile(get_db(), user, profile)
    if not profile:
        raise HTTPException(404, "Candidate profile not found")
    return scrub_admin_only(user, profile)


@router.get("/profile/by-email/{email}")
async def get_profile_by_email(email: str, user: dict = Depends(get_current_user)):
    from services.hr_module.candidate_profile_service import get_candidate_profile_by_email

    profile = await get_candidate_profile_by_email(email)
    profile = await department_access.scope_profile(get_db(), user, profile)
    if not profile:
        raise HTTPException(404, "Candidate profile not found")
    return scrub_admin_only(user, profile)


@router.patch("/profile/{profile_id}/notes")
async def update_profile_notes_route(
    profile_id: str,
    body: UpdateProfileNotesRequest,
    user: dict = Depends(require_admin),
):
    from services.hr_module.candidate_profile_service import get_candidate_profile, update_profile_notes

    if await get_department_scope(user) is not None:
        visible = await department_access.scope_profile(get_db(), user, await get_candidate_profile(profile_id))
        if visible is None:
            raise HTTPException(404, "Candidate profile not found")
    result = await update_profile_notes(profile_id, body.notes)
    if not result:
        raise HTTPException(404, "Candidate profile not found")
    return result


@router.get("/{candidate_id}")
async def get_candidate(candidate_id: str, user: dict = Depends(get_current_user)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    doc = await db.candidates.find_one({"candidate_id": candidate_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Candidate not found")
    return redact_candidate(user, doc)


@router.patch("/{candidate_id}/notes")
async def update_recruiter_notes(
    candidate_id: str,
    body: UpdateNotesRequest,
    user: dict = Depends(require_admin),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    cand = await db.candidates.find_one({"candidate_id": candidate_id})
    if not cand:
        raise HTTPException(404, "Candidate not found")

    now = datetime.now(timezone.utc).isoformat()
    await db.candidates.update_one(
        {"candidate_id": candidate_id},
        {"$set": {
            "recruiter_notes": body.notes,
            "recruiter_notes_updated_by": user["email"],
            "recruiter_notes_updated_at": now,
        }},
    )

    asyncio.create_task(log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="candidate_notes_updated", resource_type="candidate", resource_id=candidate_id,
        details={"notes": body.notes},
    ))

    return {"candidate_id": candidate_id, "recruiter_notes": body.notes, "updated_at": now}


@router.get("/{candidate_id}/timeline")
async def get_candidate_timeline(candidate_id: str, user: dict = Depends(get_current_user)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    cand = await db.candidates.find_one({"candidate_id": candidate_id})
    if not cand:
        raise HTTPException(404, "Candidate not found")

    from services.hr_module.candidate_identity import hydrate_job_titles, normalize_linkedin, normalize_phone

    norm_phone = cand.get("phone_normalized") or normalize_phone(cand.get("phone"))
    norm_linkedin = cand.get("linkedin_normalized") or normalize_linkedin(cand.get("linkedin_url"))

    or_clauses: list[dict] = []
    if cand.get("email"):
        or_clauses.append({"email": cand["email"]})
    if norm_phone:
        or_clauses.append({"phone_normalized": norm_phone})
    if norm_linkedin:
        or_clauses.append({"linkedin_normalized": norm_linkedin})

    if not or_clauses:
        return {"timeline": []}

    query = {
        "doc_type": "candidate",
        "candidate_id": {"$ne": candidate_id},
        "$or": or_clauses,
    }
    cursor = db.candidates.find(query, {"_id": 0}).sort("created_at", 1)
    others = await department_access.filter_candidates(db, user, await cursor.to_list(length=None))

    job_ids = list({c["job_id"] for c in others if c.get("job_id")})
    jobs_by_id = await hydrate_job_titles(db, job_ids)

    from services.hr_module.candidate_redaction import is_admin_user
    show_reason = is_admin_user(user)

    timeline = [
        {
            "candidate_id": c.get("candidate_id"),
            "job_id": c.get("job_id"),
            "job_title": jobs_by_id.get(c.get("job_id")),
            "status": c.get("status"),
            "decision": c.get("decision"),
            "invite_type": c.get("invite_type"),
            "created_at": c.get("created_at"),
            "decided_at": c.get("decided_at"),
            **({"decision_reason": c.get("decision_reason")} if show_reason else {}),
        }
        for c in others
    ]
    return {"timeline": timeline}


@router.post("/{candidate_id}/resend-invite")
async def resend_invite(
    candidate_id: str,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("candidates:resend_invite")),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    cand = await db.candidates.find_one({"candidate_id": candidate_id})
    if not cand:
        raise HTTPException(404, "Candidate not found")
    if not cand.get("email"):
        raise HTTPException(400, "No email on file for this candidate")
    if cand.get("interview_mode") == "external":
        raise HTTPException(409, "This candidate is interviewed on another platform. Resend the meeting link instead.")

    from services.hr_module.invite_service import send_manual_invite
    sent = await send_manual_invite(candidate=cand, admin_email=user["email"])
    if not sent:
        raise HTTPException(502, "The invite email could not be sent. Check Email Delivery in Platform Settings.")

    await db.candidates.update_one(
        {"candidate_id": candidate_id},
        {
            "$set": {
                "last_resent_at": datetime.now(timezone.utc).isoformat(),
                "last_resent_by": user["email"],
                "invite_email_delivered": True,
            },
            "$inc": {"invite_resent_count": 1},
        },
    )
    updated = await db.candidates.find_one({"candidate_id": candidate_id}, {"invite_resent_count": 1})
    return {
        "message": "Invite resent successfully",
        "sent_to": cand["email"],
        "sent_by": user["email"],
        "resent_count": (updated or {}).get("invite_resent_count", 1),
    }


@router.post("/{candidate_id}/regenerate-token")
async def regenerate_token(
    candidate_id: str,
    body: RegenerateTokenRequest = RegenerateTokenRequest(),
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("candidates:resend_invite")),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    cand = await db.candidates.find_one({"candidate_id": candidate_id})
    if not cand:
        raise HTTPException(404, "Candidate not found")
    if cand.get("interview_mode") == "external":
        raise HTTPException(409, "This candidate is interviewed on another platform, so there is no AI interview link to regenerate.")

    token = new_secure_token()
    now = datetime.now(timezone.utc).isoformat()
    await db.candidates.update_one(
        {"candidate_id": candidate_id},
        {"$set": {
            "secure_token": token,
            "token_status": "active",
            "status": "invited",
            "token_regenerated_at": now,
            "token_regenerated_by": user["email"],
            "invite_expires_at": compute_invite_expiry(sent_at=cand.get("invite_sent_at"), regenerated_at=now, days=settings.INVITE_LINK_EXPIRY_DAYS),
            **(
                {"coding_invite_expires_at": coding_expiry_stamp()}
                if cand.get("coding_question_id") or cand.get("coding_invite_expires_at") else {}
            ),
        }},
    )

    email_resent = False
    if body.resend and cand.get("email"):
        updated_cand = {**cand, "secure_token": token}
        from services.hr_module.invite_service import send_manual_invite
        if await send_manual_invite(candidate=updated_cand, admin_email=user["email"]):
            await db.candidates.update_one(
                {"candidate_id": candidate_id}, {"$set": {"invite_email_delivered": True}},
            )
            email_resent = True

    return {
        "secure_token": token,
        "interview_url": f"{base_url()}/interview/{token}",
        "email_resent": email_resent,
    }


@router.post("/{candidate_id}/decision")
async def record_decision(
    candidate_id: str,
    body: HRCandidateDecision,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("candidates:decide")),
):
    if body.decision not in {"hire", "reject", "hold"}:
        raise HTTPException(400, "Decision must be hire / reject / hold")
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    cand = await db.candidates.find_one({"candidate_id": candidate_id})
    if not cand:
        raise HTTPException(404, "Candidate not found")

    if body.decision in ("hire", "hold"):
        from services.hr_module.external_interview_service import REVIEW_REQUIRED_MESSAGE, needs_review
        if needs_review(cand):
            raise HTTPException(409, REVIEW_REQUIRED_MESSAGE)

    stage = {"hire": "hired", "reject": "rejected", "hold": "completed"}[body.decision]
    decision_reason = body.reason if body.decision == "reject" else None
    await db.candidates.update_one(
        {"candidate_id": candidate_id},
        {"$set": {
            "pipeline_stage": stage,
            "status": stage,
            "decision": body.decision,
            "decision_notes": body.notes,
            "decision_reason": decision_reason,
            "decided_by": user["email"],
            "decided_at": datetime.now(timezone.utc).isoformat(),
        }},
    )

    job = await db.jobs.find_one({"job_id": cand.get("job_id")})

    if cand.get("resume_id"):
        await db.jobs.update_one(
            {"job_id": cand["job_id"], "candidate_pipeline.resume_id": cand["resume_id"]},
            {"$set": {"candidate_pipeline.$.pipeline_stage": stage}},
        )
        from services.hr_module.resume_intel import apply_resume_outcome
        await apply_resume_outcome(
            cand["resume_id"],
            is_hired=body.decision == "hire",
            company=(job or {}).get("company_name"),
            job_title=(job or {}).get("title"),
        )

    if body.decision == "reject" and cand.get("email"):
        from services.hr_module.email_service import send_rejection_email
        await send_rejection_email(
            to_email=cand["email"],
            candidate_name=cand.get("name", "Candidate"),
            job_title=(job or {}).get("title", ""),
            db=db, candidate_id=candidate_id, job_id=cand.get("job_id"),
        )

    from services.hr_module.workflow_engine import TRIGGER_CANDIDATE_STATUS_CHANGED, evaluate_and_apply_rules
    asyncio.create_task(evaluate_and_apply_rules(
        trigger_type=TRIGGER_CANDIDATE_STATUS_CHANGED,
        context={
            "candidate_id": candidate_id, "job_id": cand.get("job_id"),
            "email": cand.get("email"), "candidate_name": cand.get("name"),
            "status": stage, "pipeline_stage": stage, "decision": body.decision,
            "score": cand.get("match_score"),
        },
    ))

    if body.decision == "hire":
        from services.hr_module.hrms_service import auto_push_enabled, push_to_hrms
        if await auto_push_enabled():
            asyncio.create_task(push_to_hrms(candidate_id))

    asyncio.create_task(log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="candidate_decision", resource_type="candidate", resource_id=candidate_id,
        details={"decision": body.decision, "notes": body.notes, "stage": stage, "reason": decision_reason},
    ))

    from services.hr_module.lifecycle_events import announce_stage_change
    await announce_stage_change(
        candidate_id=candidate_id, name=cand.get("name"), job_id=cand.get("job_id"),
        stage=stage, decision=body.decision,
    )

    return {"message": f"Decision recorded: {body.decision}", "stage": stage}


@router.post("/{candidate_id}/send-email")
async def send_communication(
    candidate_id: str,
    body: SendCommunicationRequest,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("candidates:send_email")),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    cand = await db.candidates.find_one({"candidate_id": candidate_id})
    if not cand:
        raise HTTPException(404, "Candidate not found")
    if not cand.get("email"):
        raise HTTPException(400, "No email on file for this candidate")

    if body.template == "offer_letter":
        from services.hr_module.external_interview_service import REVIEW_REQUIRED_MESSAGE, needs_review
        if needs_review(cand):
            raise HTTPException(409, REVIEW_REQUIRED_MESSAGE)

    job = await db.jobs.find_one({"job_id": cand.get("job_id")}) or {}
    job_title = job.get("title", "")
    common = dict(
        to_email=cand["email"], candidate_name=cand.get("name", "Candidate"), job_title=job_title,
        db=db, candidate_id=candidate_id, job_id=cand.get("job_id"),
    )

    link_token = None if cand.get("interview_mode") == "external" else cand.get("secure_token")

    if body.template == "assessment_invitation":
        if link_token is None:
            raise HTTPException(409, "This candidate is interviewed on another platform, so there is no assessment link to send.")
        from services.hr_module.email_service import send_assessment_invitation_email
        sent = await send_assessment_invitation_email(secure_token=link_token, **common)
    elif body.template == "offer_letter":
        from services.hr_module.email_service import send_offer_letter_email
        sent = await send_offer_letter_email(
            company_name=job.get("company_name"), salary=body.salary,
            joining_date=body.joining_date, benefits=body.benefits, **common,
        )
    elif body.template in ("reminder", "follow_up"):
        from services.hr_module.email_service import send_reminder_email
        sent = await send_reminder_email(secure_token=link_token, kind=body.template, **common)
    elif body.template == "physical_interview_call":
        from services.hr_module import external_interview_service as ext
        from services.hr_module.email_service import send_physical_interview_email
        try:
            start_iso = ext.validate_start(body.scheduled_start_at)
            location = ext.validate_location(body.location)
        except ext.ExternalInterviewError as exc:
            raise HTTPException(422, str(exc))
        sent = await send_physical_interview_email(
            company_name=job.get("company_name"), location=location, scheduled_start_at=start_iso,
            duration_minutes=body.duration_minutes or settings.INTERVIEW_DURATION_MINUTES,
            notes=body.notes, display_timezone=ext.validate_timezone(body.display_timezone), **common,
        )
    else:
        raise HTTPException(
            400,
            "Unknown template. Valid: assessment_invitation, offer_letter, reminder, follow_up, physical_interview_call",
        )

    return {"sent": sent, "template": body.template, "sent_to": cand["email"]}


@router.get("/{candidate_id}/emails")
async def list_candidate_emails(candidate_id: str, _: dict = Depends(get_current_user)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    cursor = db.email_log.find({"candidate_id": candidate_id}, {"_id": 0}).sort("created_at", -1)
    return {"emails": await cursor.to_list(length=200)}
