"""Candidates route — hr_module interview invite management.

Invite types:
  auto   → created by ResumeAgent when match score >= AUTO_INVITE_THRESHOLD
  manual → created by admin via POST /candidates/

Admin actions:
  POST  /{id}/resend-invite      → resend existing invite email (same token)
  POST  /{id}/regenerate-token   → generate new token + optional resend
  POST  /{id}/decision           → hire / reject / hold
  PATCH /{id}/notes              → freely-editable recruiter notes (MVP2 §2.5)

Any authenticated user:
  GET   /{id}/timeline           → cross-job candidate history (MVP2 §2.5)

Candidate master profile (MVP2 §2.5 — see services/hr_module/
candidate_profile_service.py):
  GET   /profile/{profile_id}          → hydrated master profile
  GET   /profile/by-email/{email}      → same, looked up by email
  PATCH /profile/{profile_id}/notes    → person-level cross-job notes (admin)
These three routes are declared BEFORE the "/{candidate_id}" catch-all
routes below so "profile" is never captured as a candidate_id path
parameter. FastAPI matches routes in declaration order, so a literal
segment must always be declared above the catch-all that would swallow it.
"""
import asyncio
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr

from shared.auth import get_current_user, require_admin
from shared.schemas import HRCandidateCreate, HRCandidateDecision
from shared.utils import compute_invite_expiry
from config.database import get_db
from config.settings import settings
from services.hr_module.audit_service import log_audit_event
from services.hr_module.permissions import get_department_scope

logger = logging.getLogger(__name__)
router = APIRouter()


class RegenerateTokenRequest(BaseModel):
    resend: bool = True


class SendCommunicationRequest(BaseModel):
    template: str
    salary: str | None = None
    joining_date: str | None = None
    benefits: str | None = None


class HRCandidateCreateWithPhone(HRCandidateCreate):
    """Local extension of the shared HRCandidateCreate schema — adds an
    optional phone number used only for soft cross-job duplicate-identity
    matching (MVP2 §2.5). Kept local per project convention; shared/schemas.py
    stays untouched this round."""
    phone: str | None = None


class UpdateNotesRequest(BaseModel):
    notes: str


class UpdateProfileNotesRequest(BaseModel):
    """Person-level cross-job notes on a candidate_profiles document —
    deliberately a separate model/field from UpdateNotesRequest above, which
    updates the existing per-job `candidates.recruiter_notes`."""
    notes: str


@router.post("")
async def create_candidate(body: HRCandidateCreateWithPhone, user: dict = Depends(require_admin)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    if not await db.jobs.find_one({"job_id": body.job_id}):
        raise HTTPException(404, "Job not found")
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
    token = f"tok_{uuid.uuid4().hex[:12]}"
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
    await send_manual_invite(candidate=doc, admin_email=user["email"])

    from services.hr_module.workflow_engine import evaluate_and_apply_rules
    asyncio.create_task(evaluate_and_apply_rules(
        trigger_type="candidate_invited",
        context={
            "candidate_id": cid, "job_id": body.job_id, "email": body.email,
            "candidate_name": body.name, "invite_type": "manual",
            "secure_token": token,
        },
    ))

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
        "interview_url": f"{settings.FRONTEND_URL}/interview/{token}",
        "invite_type": "manual",
        "possible_duplicates": possible_duplicates,
    }


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
        scoped_job_ids = [
            j["job_id"] async for j in db.jobs.find({"department_id": department_id}, {"_id": 0, "job_id": 1})
        ]
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
    return {"candidates": await cursor.to_list(length=limit), "total": total}


@router.get("/profile/{profile_id}")
async def get_profile(profile_id: str, _: dict = Depends(get_current_user)):
    """Full candidate master profile — one resolved identity, every linked
    per-job candidate summary, and the cross-job `profile_notes` field."""
    from services.hr_module.candidate_profile_service import get_candidate_profile

    profile = await get_candidate_profile(profile_id)
    if not profile:
        raise HTTPException(404, "Candidate profile not found")
    return profile


@router.get("/profile/by-email/{email}")
async def get_profile_by_email(email: str, _: dict = Depends(get_current_user)):
    """Same as GET /profile/{profile_id}, looked up by (normalized) email."""
    from services.hr_module.candidate_profile_service import get_candidate_profile_by_email

    profile = await get_candidate_profile_by_email(email)
    if not profile:
        raise HTTPException(404, "Candidate profile not found")
    return profile


@router.patch("/profile/{profile_id}/notes")
async def update_profile_notes_route(
    profile_id: str,
    body: UpdateProfileNotesRequest,
    user: dict = Depends(require_admin),
):
    """Person-level, cross-job notes (MVP2 §2.5) — distinct from the
    per-job `PATCH /{candidate_id}/notes` above. Admin-only, mirroring that
    endpoint's access gate."""
    from services.hr_module.candidate_profile_service import update_profile_notes

    result = await update_profile_notes(profile_id, body.notes)
    if not result:
        raise HTTPException(404, "Candidate profile not found")
    return result


@router.get("/{candidate_id}")
async def get_candidate(candidate_id: str, _: dict = Depends(get_current_user)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    doc = await db.candidates.find_one({"candidate_id": candidate_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Candidate not found")
    return doc


@router.patch("/{candidate_id}/notes")
async def update_recruiter_notes(
    candidate_id: str,
    body: UpdateNotesRequest,
    user: dict = Depends(require_admin),
):
    """Persistent, freely-editable recruiter notes (MVP2 §2.5).

    Deliberately distinct from `decision_notes` (set once, only at
    hire/reject/hold time via POST /decision) — `recruiter_notes` can be
    read and rewritten any number of times, at any pipeline stage."""
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
async def get_candidate_timeline(candidate_id: str, _: dict = Depends(get_current_user)):
    """Cross-job candidate history (MVP2 §2.5).

    Every OTHER candidate/invite record — across every job — that shares
    this person's email, normalized phone, or normalized LinkedIn URL.
    Read-only aggregation; does not write or infer any new identity data."""
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
    others = await cursor.to_list(length=None)

    job_ids = list({c["job_id"] for c in others if c.get("job_id")})
    jobs_by_id = await hydrate_job_titles(db, job_ids)

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
        }
        for c in others
    ]
    return {"timeline": timeline}


@router.post("/{candidate_id}/resend-invite")
async def resend_invite(candidate_id: str, user: dict = Depends(require_admin)):
    """Admin resends the invite email using the candidate's current secure token."""
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    cand = await db.candidates.find_one({"candidate_id": candidate_id})
    if not cand:
        raise HTTPException(404, "Candidate not found")
    if not cand.get("email"):
        raise HTTPException(400, "No email on file for this candidate")

    from services.hr_module.invite_service import send_manual_invite
    await send_manual_invite(candidate=cand, admin_email=user["email"])

    await db.candidates.update_one(
        {"candidate_id": candidate_id},
        {
            "$set": {
                "last_resent_at": datetime.now(timezone.utc).isoformat(),
                "last_resent_by": user["email"],
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
):
    """Generate a new secure token (invalidates old). Optionally resend invite email."""
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    cand = await db.candidates.find_one({"candidate_id": candidate_id})
    if not cand:
        raise HTTPException(404, "Candidate not found")

    token = f"tok_{uuid.uuid4().hex[:12]}"
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
        }},
    )

    if body.resend and cand.get("email"):
        updated_cand = {**cand, "secure_token": token}
        from services.hr_module.invite_service import send_manual_invite
        await send_manual_invite(candidate=updated_cand, admin_email=user["email"])

    return {
        "secure_token": token,
        "interview_url": f"{settings.FRONTEND_URL}/interview/{token}",
        "email_resent": body.resend and bool(cand.get("email")),
    }


@router.post("/{candidate_id}/decision")
async def record_decision(
    candidate_id: str,
    body: HRCandidateDecision,
    user: dict = Depends(require_admin),
):
    if body.decision not in {"hire", "reject", "hold"}:
        raise HTTPException(400, "Decision must be hire / reject / hold")
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    cand = await db.candidates.find_one({"candidate_id": candidate_id})
    if not cand:
        raise HTTPException(404, "Candidate not found")

    stage = {"hire": "hired", "reject": "rejected", "hold": "completed"}[body.decision]
    await db.candidates.update_one(
        {"candidate_id": candidate_id},
        {"$set": {
            "pipeline_stage": stage,
            "status": stage,
            "decision": body.decision,
            "decision_notes": body.notes,
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

    from services.hr_module.workflow_engine import evaluate_and_apply_rules
    asyncio.create_task(evaluate_and_apply_rules(
        trigger_type="candidate_status_changed",
        context={
            "candidate_id": candidate_id, "job_id": cand.get("job_id"),
            "email": cand.get("email"), "candidate_name": cand.get("name"),
            "status": stage, "pipeline_stage": stage, "decision": body.decision,
            "score": cand.get("match_score"),
        },
    ))

    if body.decision == "hire" and settings.HRMS_AUTO_PUSH_ON_HIRE:
        from services.hr_module.hrms_service import push_to_hrms
        asyncio.create_task(push_to_hrms(candidate_id))

    asyncio.create_task(log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="candidate_decision", resource_type="candidate", resource_id=candidate_id,
        details={"decision": body.decision, "notes": body.notes, "stage": stage},
    ))

    return {"message": f"Decision recorded: {body.decision}", "stage": stage}


@router.post("/{candidate_id}/send-email")
async def send_communication(
    candidate_id: str,
    body: SendCommunicationRequest,
    user: dict = Depends(require_admin),
):
    """Communication Center — send an ad hoc templated email to a candidate
    (assessment invite, offer letter, reminder, or follow-up). Every send is
    recorded in `email_log` regardless of outcome."""
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    cand = await db.candidates.find_one({"candidate_id": candidate_id})
    if not cand:
        raise HTTPException(404, "Candidate not found")
    if not cand.get("email"):
        raise HTTPException(400, "No email on file for this candidate")

    job = await db.jobs.find_one({"job_id": cand.get("job_id")}) or {}
    job_title = job.get("title", "")
    common = dict(
        to_email=cand["email"], candidate_name=cand.get("name", "Candidate"), job_title=job_title,
        db=db, candidate_id=candidate_id, job_id=cand.get("job_id"),
    )

    if body.template == "assessment_invitation":
        from services.hr_module.email_service import send_assessment_invitation_email
        sent = await send_assessment_invitation_email(secure_token=cand.get("secure_token", ""), **common)
    elif body.template == "offer_letter":
        from services.hr_module.email_service import send_offer_letter_email
        sent = await send_offer_letter_email(
            company_name=job.get("company_name"), salary=body.salary,
            joining_date=body.joining_date, benefits=body.benefits, **common,
        )
    elif body.template in ("reminder", "follow_up"):
        from services.hr_module.email_service import send_reminder_email
        sent = await send_reminder_email(secure_token=cand.get("secure_token"), kind=body.template, **common)
    else:
        raise HTTPException(400, "Unknown template. Valid: assessment_invitation, offer_letter, reminder, follow_up")

    return {"sent": sent, "template": body.template, "sent_to": cand["email"]}


@router.get("/{candidate_id}/emails")
async def list_candidate_emails(candidate_id: str, _: dict = Depends(get_current_user)):
    """Communication Center log — every email sent to this candidate."""
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    cursor = db.email_log.find({"candidate_id": candidate_id}, {"_id": 0}).sort("created_at", -1)
    return {"emails": await cursor.to_list(length=200)}
