import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from shared.auth import require_admin, require_permission
from shared.rate_limit import public_token_throttle
from shared.utils import is_invite_expired
from config.database import get_db
from config.settings import settings
from services.hr_module import department_access
from services.hr_module.audit_service import log_audit_event
from services.hr_module.erasure_service import ensure_not_erased
from services.hr_module.lifecycle_events import announce_interview_completed, announce_stage_change
from services.hr_module.notification_settings_service import integrity_alert_reasons, notify
from services.hr_module.permissions import get_department_scope

router = APIRouter()
logger = logging.getLogger(__name__)

_session_throttle = public_token_throttle("interview", ip_limit=600, token_limit=90, tenant="candidate")
_ai_throttle = public_token_throttle("interview-ai", ip_limit=600, token_limit=30, tenant="candidate")
_shared_report_throttle = public_token_throttle("shared-report", param="token", ip_limit=120, token_limit=30, tenant="share")


def _require_db():
    db = get_db()
    if db is None:
        raise HTTPException(503, "Service unavailable")
    return db


async def _load_active_candidate(db, secure_token: str) -> dict:
    cand = await db.candidates.find_one({"secure_token": secure_token})
    if not cand:
        raise HTTPException(404, "Invalid interview link")
    if cand.get("interview_mode") == "external":
        raise HTTPException(403, "This interview is held on another platform. Please use the meeting link from your email.")
    if cand.get("token_status") == "consumed":
        raise HTTPException(410, "This interview session has already been completed")
    if is_invite_expired(cand, days=settings.INVITE_LINK_EXPIRY_DAYS):
        raise HTTPException(410, "This interview link has expired: please request a new invite")
    return cand


async def _load_candidate_by_token(db, secure_token: str) -> dict:
    cand = await db.candidates.find_one({"secure_token": secure_token})
    if not cand:
        raise HTTPException(404, "Invalid interview link")
    if is_invite_expired(cand, days=settings.INVITE_LINK_EXPIRY_DAYS):
        raise HTTPException(410, "This interview link has expired: please request a new invite")
    return cand

@router.get("/session/{secure_token}", dependencies=[Depends(_session_throttle)])
async def start_session(secure_token: str):
    db = _require_db()
    cand = await _load_active_candidate(db, secure_token)

    scheduled_start_at = cand.get("scheduled_start_at")
    if scheduled_start_at:
        try:
            scheduled_dt = datetime.fromisoformat(scheduled_start_at)
            if scheduled_dt.tzinfo is None:
                scheduled_dt = scheduled_dt.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) < scheduled_dt:
                raise HTTPException(403, f"This interview is scheduled to begin at {scheduled_start_at}")
        except (TypeError, ValueError):
            pass

    questions: list = cand.get("_questions", [])
    if not questions:
        from agents.interview_agent import build_interview_agent
        prepare, _ = build_interview_agent()
        state = await prepare.ainvoke({"secure_token": secure_token})
        questions = state.get("questions", [])
        await db.candidates.update_one(
            {"secure_token": secure_token},
            {"$set": {
                "_questions": questions,
                "status": "interviewing",
                "interview_started_at": datetime.now(timezone.utc).isoformat(),
            }},
        )

    return {
        "candidate_name": cand.get("name", "Candidate"),
        "duration_minutes": settings.INTERVIEW_DURATION_MINUTES,
        "questions": questions,
        "coding_assigned": bool(cand.get("coding_question_id")),
    }


class SubmitPayload(BaseModel):
    transcript: list[dict[str, Any]]
    flags: list[str] = []
    termination_reason: str | None = None


@router.post("/session/{secure_token}/submit", dependencies=[Depends(_session_throttle)])
async def submit_session(secure_token: str, payload: SubmitPayload):
    db = _require_db()
    cand = await _load_active_candidate(db, secure_token)

    update: dict[str, Any] = {
        "$set": {
            "transcript": payload.transcript,
            "token_status": "consumed",
            "status": "completed",
            "interview_ended_at": datetime.now(timezone.utc).isoformat(),
        }
    }
    if payload.termination_reason:
        update["$set"]["termination_reason"] = payload.termination_reason
    if payload.flags:
        update["$push"] = {"integrity_flags": {"$each": payload.flags}}

    await db.candidates.update_one({"secure_token": secure_token}, update)

    side_effects = [
        asyncio.ensure_future(announce_interview_completed(
            candidate_id=cand.get("candidate_id"), name=cand.get("name"), job_id=cand.get("job_id"),
        )),
        asyncio.ensure_future(announce_stage_change(
            candidate_id=cand.get("candidate_id"), name=cand.get("name"), job_id=cand.get("job_id"),
            stage="completed",
        )),
    ]
    reasons = integrity_alert_reasons([*(cand.get("integrity_flags") or []), *payload.flags])
    if reasons:
        side_effects.append(asyncio.ensure_future(notify("candidate_flagged_for_integrity", {
            "candidate_id": cand.get("candidate_id"), "candidate_name": cand.get("name"),
            "job_id": cand.get("job_id"), "reasons": reasons,
        })))

    if payload.transcript:
        try:
            await _evaluate(secure_token)
        except Exception as exc:
            logger.error("Interview evaluation failed for token=%s...: %s", secure_token[:8], exc)

    await asyncio.gather(*side_effects, return_exceptions=True)
    return {"status": "submitted"}


class FlagPayload(BaseModel):
    event: str


@router.post("/session/{secure_token}/flag", dependencies=[Depends(_session_throttle)])
async def record_flag(secure_token: str, payload: FlagPayload):
    db = _require_db()
    await _load_active_candidate(db, secure_token)

    flag = f"{payload.event}@{datetime.now(timezone.utc).isoformat()}"
    await db.candidates.update_one(
        {"secure_token": secure_token},
        {"$push": {"integrity_flags": flag}},
    )
    return {"recorded": True}


class DemographicsPayload(BaseModel):
    gender: str | None = None
    location: str | None = None


@router.post("/{secure_token}/demographics", dependencies=[Depends(_session_throttle)])
async def submit_demographics_route(secure_token: str, payload: DemographicsPayload):
    db = _require_db()
    cand = await _load_candidate_by_token(db, secure_token)

    from services.hr_module.demographics_service import submit_demographics
    await submit_demographics(
        db,
        candidate_id=cand.get("candidate_id"),
        gender=payload.gender,
        location=payload.location,
    )
    return {"recorded": True}


class FollowupPayload(BaseModel):
    question: str
    answer: str


@router.post("/session/{secure_token}/followup", dependencies=[Depends(_ai_throttle)])
async def get_followup(secure_token: str, payload: FollowupPayload):
    db = _require_db()
    cand = await _load_active_candidate(db, secure_token)

    job = await db.jobs.find_one({"job_id": cand.get("job_id")}) or {}

    from config.llm import track_llm_cost
    from services.hr_module.interview_engine import generate_followup
    async with track_llm_cost("interview_followup_probe"):
        followup = await generate_followup(payload.question, payload.answer, job)

    return {"followup": followup}


class ReasoningProbePayload(BaseModel):
    question: str
    answer: str
    prior_answer: str | None = None


@router.post("/session/{secure_token}/reasoning-probe", dependencies=[Depends(_ai_throttle)])
async def get_reasoning_probe(secure_token: str, payload: ReasoningProbePayload):
    db = _require_db()
    cand = await _load_active_candidate(db, secure_token)

    job = await db.jobs.find_one({"job_id": cand.get("job_id")}) or {}

    from config.llm import track_llm_cost
    from services.hr_module.interview_engine import generate_reasoning_probe
    async with track_llm_cost("interview_followup_probe"):
        probe = await generate_reasoning_probe(
            payload.question, payload.answer, job, prior_answer=payload.prior_answer,
        )

    return {"probe": probe}


class SpeakPayload(BaseModel):
    text: str


@router.post("/session/{secure_token}/speak", dependencies=[Depends(_ai_throttle)])
async def speak_question(secure_token: str, payload: SpeakPayload):
    db = _require_db()
    await _load_active_candidate(db, secure_token)

    text = (payload.text or "").strip()
    if not text:
        raise HTTPException(400, "No text to speak")
    if len(text) > settings.MAX_TTS_INPUT_CHARS:
        raise HTTPException(413, f"Question exceeds {settings.MAX_TTS_INPUT_CHARS} characters")

    from services.hr_module.voice_service import VoiceServiceError, synthesize_question

    try:
        audio = await synthesize_question(text)
    except VoiceServiceError as exc:
        raise HTTPException(502, f"Speech synthesis unavailable: {exc}")

    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-store"},
    )


@router.post("/session/{secure_token}/transcribe", dependencies=[Depends(_ai_throttle)])
async def transcribe_answer_audio(secure_token: str, file: UploadFile = File(...)):
    db = _require_db()
    await _load_active_candidate(db, secure_token)

    audio = await file.read()
    max_bytes = settings.MAX_ANSWER_AUDIO_MB * 1024 * 1024
    if len(audio) > max_bytes:
        raise HTTPException(413, f"Answer recording exceeds {settings.MAX_ANSWER_AUDIO_MB} MB")
    if not audio:
        raise HTTPException(400, "Empty audio upload")

    from services.hr_module.voice_service import VoiceServiceError, transcribe_answer

    try:
        text = await transcribe_answer(audio, file.filename)
    except VoiceServiceError as exc:
        raise HTTPException(502, f"Transcription unavailable: {exc}")

    return {"text": text}


class SchedulePayload(BaseModel):
    scheduled_start_at: str | None = None
    create_meeting: bool = False
    meeting_provider: str | None = None


@router.patch("/{candidate_id}/schedule")
async def schedule_interview(
    candidate_id: str,
    payload: SchedulePayload,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("interview:schedule")),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Service unavailable")
    await department_access.ensure_candidate_in_scope(db, user, candidate_id)
    await ensure_not_erased(db, candidate_id)

    mode_doc = await db.candidates.find_one({"candidate_id": candidate_id}, {"_id": 0, "interview_mode": 1})
    if mode_doc and mode_doc.get("interview_mode") == "external":
        raise HTTPException(409, "This interview is held on another platform. Change its time or link from the candidate's row.")

    updates: dict[str, Any] = {
        "scheduled_start_at": payload.scheduled_start_at,
        "scheduled_by": user.get("email"),
    }

    meeting: dict | None = None
    meeting_error: str | None = None
    if payload.create_meeting and payload.scheduled_start_at:
        cand = await db.candidates.find_one({"candidate_id": candidate_id}) or {}
        job = await db.jobs.find_one({"job_id": cand.get("job_id")}) or {}
        from services.hr_module.meeting_service import MeetingServiceError, create_meeting

        try:
            meeting = await create_meeting(
                topic=f"Interview: {cand.get('name') or 'Candidate'} for {job.get('title') or 'Role'}",
                start_iso=payload.scheduled_start_at,
                duration_minutes=settings.INTERVIEW_DURATION_MINUTES,
                agenda=f"Interview for the {job.get('title') or ''} position.",
                provider=payload.meeting_provider,
            )
            updates["meeting"] = {
                k: v for k, v in meeting.items() if k != "host_url"
            }
            updates["meeting_join_url"] = meeting.get("join_url")
        except MeetingServiceError as exc:
            meeting_error = str(exc)
            logger.warning("Meeting creation failed for candidate=%s: %s", candidate_id, exc)

    if payload.scheduled_start_at is None:
        updates["meeting"] = None
        updates["meeting_join_url"] = None
    elif meeting is None:
        existing = await db.candidates.find_one(
            {"candidate_id": candidate_id}, {"_id": 0, "meeting": 1, "scheduled_start_at": 1},
        ) or {}
        if existing.get("meeting") and existing.get("scheduled_start_at") != payload.scheduled_start_at:
            updates["meeting"] = None
            updates["meeting_join_url"] = None
            meeting_error = (
                "The schedule moved, so the previous video meeting no longer matches it and "
                "has been detached. It still exists at the old time on your provider: "
                "cancel it there, and tick 'Create a video meeting' to book the new slot."
            )

    result = await db.candidates.update_one({"candidate_id": candidate_id}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(404, "Candidate not found")

    asyncio.create_task(log_audit_event(
        db, actor_email=user.get("email"), actor_role=user.get("role"),
        action="interview_schedule", resource_type="candidate", resource_id=candidate_id,
        details={
            "scheduled_start_at": payload.scheduled_start_at,
            "meeting_provider": (meeting or {}).get("provider"),
        },
    ))
    return {
        "candidate_id": candidate_id,
        "scheduled_start_at": payload.scheduled_start_at,
        "meeting": meeting,
        "meeting_error": meeting_error,
    }


@router.get("/{candidate_id}/schedule.ics")
async def schedule_ics(
    candidate_id: str,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("interview:schedule")),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Service unavailable")

    cand = await department_access.require_candidate(db, user, candidate_id)

    from services.hr_module.external_interview_service import is_external

    if is_external(cand):
        details = cand.get("external_interview") or {}
        start = details.get("scheduled_start_at") or cand.get("scheduled_start_at")
        if not start:
            raise HTTPException(404, "No interview schedule set for this candidate yet")
        job = await db.jobs.find_one({"job_id": cand.get("job_id")}, {"_id": 0, "title": 1}) or {}

        from services.hr_module.email_service import build_external_interview_ics

        external_ics = build_external_interview_ics(
            candidate_id=candidate_id,
            to_email=cand.get("email") or "",
            job_title=job.get("title") or "the role",
            platform_label=details.get("platform_label") or "Other platform",
            join_url=details.get("join_url") or cand.get("meeting_join_url") or "",
            scheduled_start_at=start,
            duration_minutes=details.get("duration_minutes") or settings.INTERVIEW_DURATION_MINUTES,
            sequence=int(details.get("calendar_sequence") or 0),
            method="PUBLISH",
            with_attendee=False,
            location=details.get("location"),
        )
        if external_ics is None:
            raise HTTPException(400, "Cannot generate calendar invite: the interview time is not readable")
        return Response(
            content=external_ics,
            media_type="text/calendar",
            headers={"Content-Disposition": f'attachment; filename="interview_{candidate_id[:8]}.ics"'},
        )

    scheduled_start_at = cand.get("scheduled_start_at")
    if not scheduled_start_at:
        raise HTTPException(404, "No interview schedule set for this candidate yet")

    job = await db.jobs.find_one({"job_id": cand.get("job_id")}) or {}
    job_title = job.get("title") or "Interview"
    candidate_name = cand.get("name") or "Candidate"

    from services.hr_module.calendar_ics import build_ics_event

    try:
        ics_text = build_ics_event(
            uid=f"interview-{candidate_id}@hrbot",
            summary=f"Interview: {candidate_name} for {job_title}",
            description=(
                f"Interview session for {candidate_name} regarding the {job_title} position.\n"
                f"Candidate: {candidate_name}\nJob: {job_title}"
            ),
            start_iso=scheduled_start_at,
            duration_minutes=settings.INTERVIEW_DURATION_MINUTES,
            organizer_email=settings.EMAIL_FROM,
        )
    except ValueError as exc:
        raise HTTPException(400, f"Cannot generate calendar invite: {exc}")

    return Response(
        content=ics_text,
        media_type="text/calendar",
        headers={"Content-Disposition": f'attachment; filename="interview_{candidate_id[:8]}.ics"'},
    )


async def _evaluate(secure_token: str):
    from agents.interview_agent import build_interview_agent
    db = get_db()
    if db is None:
        return
    cand = await db.candidates.find_one({"secure_token": secure_token})
    if not cand:
        return
    job = await db.jobs.find_one({"job_id": cand.get("job_id")}) or {}
    _, eval_graph = build_interview_agent()
    await eval_graph.ainvoke({
        "secure_token": secure_token,
        "candidate": cand,
        "job": job,
        "transcript": cand.get("transcript", []),
        "integrity_flags": cand.get("integrity_flags", []),
    })


@router.get("/report/{secure_token}")
async def get_report(
    secure_token: str,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("interview:read_report")),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    cand = await department_access.require_candidate_by_token(db, user, secure_token, projection={"_id": 0})

    from services.hr_module.interview_engine import resolve_report_status

    return {
        "candidate_id": cand.get("candidate_id"),
        "name": cand.get("name"),
        "email": cand.get("email"),
        "job_id": cand.get("job_id"),
        "eval_score": cand.get("eval_score"),
        "report": cand.get("report"),
        "status": cand.get("status"),
        "report_status": resolve_report_status(cand),
        "report_error": cand.get("report_error"),
        "final_score": cand.get("final_score"),
        "transcript": cand.get("transcript", []),
        "integrity_flags": cand.get("integrity_flags", []),
        "invite_type": cand.get("invite_type"),
        "match_score": cand.get("match_score"),
    }


@router.get("/report/{secure_token}/pdf")
async def report_pdf(
    secure_token: str,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("interview:read_report")),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    cand = await db.candidates.find_one({"secure_token": secure_token})
    if cand and not await department_access.candidate_visible(db, await get_department_scope(user), cand):
        cand = None
    if not cand or not cand.get("report"):
        raise HTTPException(404, "Report not ready yet")

    from services.hr_module import branding_service, company_settings_service
    from services.hr_module.report_pdf_service import build_report_pdf, letterhead_from_branding

    branding = await branding_service.get_branding_settings()
    letterhead = letterhead_from_branding(
        branding, company_name=await company_settings_service.display_name(),
        logo=await branding_service.resolve_logo_bytes(branding),
    )
    job = await db.jobs.find_one({"job_id": cand.get("job_id")}, {"_id": 0, "title": 1, "company_name": 1}) or {}
    pdf = await asyncio.to_thread(build_report_pdf, cand, job=job, letterhead=letterhead)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=report_{secure_token[:8]}.pdf"},
    )


class ShareCreateRequest(BaseModel):
    expires_in_days: int | None = None


class ShareFeedbackRequest(BaseModel):
    reviewer_name: str | None = None
    rating: int | None = Field(default=None, ge=1, le=5)
    comment: str


@router.post("/report/{secure_token}/share")
async def create_report_share(
    secure_token: str,
    payload: ShareCreateRequest,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("interview:share_report")),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    cand = await department_access.require_candidate_by_token(db, user, secure_token, projection={"_id": 0})

    from services.hr_module.interview_engine import resolve_report_status
    if resolve_report_status(cand) != "ready":
        raise HTTPException(400, "This candidate's report is not ready to share yet")

    from services.hr_module.report_share_service import create_share, share_url
    token, doc = await create_share(
        db,
        candidate_id=cand.get("candidate_id"),
        job_id=cand.get("job_id"),
        created_by=user.get("email"),
        expires_in_days=payload.expires_in_days,
    )

    asyncio.create_task(log_audit_event(
        db, actor_email=user.get("email"), actor_role=user.get("role"),
        action="report_share_create", resource_type="candidate", resource_id=cand.get("candidate_id"),
        details={"share_id": doc["share_id"], "expires_at": doc["expires_at"]},
    ))

    return {
        "share_id": doc["share_id"],
        "token": token,
        "share_url": share_url(token),
        "candidate_id": doc["candidate_id"],
        "job_id": doc["job_id"],
        "created_at": doc["created_at"],
        "expires_at": doc["expires_at"],
        "view_count": 0,
    }


@router.get("/report/{secure_token}/shares")
async def list_report_shares(
    secure_token: str,
    user: dict = Depends(require_admin),
    __: dict = Depends(require_permission("interview:share_report")),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    cand = await department_access.require_candidate_by_token(db, user, secure_token, projection={"_id": 0})

    from services.hr_module.report_share_service import list_shares_for_candidate
    return {"shares": await list_shares_for_candidate(db, cand.get("candidate_id"))}


@router.post("/report/shares/{share_id}/revoke")
async def revoke_report_share(
    share_id: str,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("interview:share_report")),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    from services.hr_module.report_share_service import revoke_share
    if await get_department_scope(user) is not None:
        share = await db.report_shares.find_one({"share_id": share_id}, {"_id": 0, "candidate_id": 1})
        if share:
            await department_access.ensure_candidate_in_scope(
                db, user, share.get("candidate_id"), not_found="Share link not found",
            )
    row = await revoke_share(db, share_id=share_id, actor_email=user.get("email"))
    if row is None:
        raise HTTPException(404, "Share link not found")

    asyncio.create_task(log_audit_event(
        db, actor_email=user.get("email"), actor_role=user.get("role"),
        action="report_share_revoke", resource_type="candidate", resource_id=row.get("candidate_id"),
        details={"share_id": share_id},
    ))
    return row


@router.get("/shared-report/{token}", dependencies=[Depends(_shared_report_throttle)])
async def get_shared_report(token: str):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    from services.hr_module.report_share_service import (
        ShareExpired, ShareNotFound, build_shared_report_view, resolve_active_share,
    )
    try:
        share = await resolve_active_share(db, token)
    except ShareNotFound:
        raise HTTPException(404, "Invalid or revoked share link")
    except ShareExpired:
        raise HTTPException(410, "This share link has expired")

    cand = await db.candidates.find_one({"candidate_id": share["candidate_id"]}, {"_id": 0})
    if not cand:
        raise HTTPException(404, "Invalid or revoked share link")

    view = await build_shared_report_view(db, cand)
    view["view_count"] = share["view_count"]
    view["feedback"] = [
        {
            "reviewer_name": f.get("reviewer_name"),
            "rating": f.get("rating"),
            "comment": f.get("comment"),
            "created_at": f.get("created_at"),
        }
        for f in share.get("feedback") or []
    ]
    return view


@router.post("/shared-report/{token}/feedback", dependencies=[Depends(_shared_report_throttle)])
async def submit_shared_report_feedback(token: str, payload: ShareFeedbackRequest):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    comment = (payload.comment or "").strip()
    if not comment:
        raise HTTPException(400, "Feedback comment cannot be empty")

    from services.hr_module.report_share_service import (
        ShareExpired, ShareNotFound, add_feedback, resolve_active_share,
    )
    try:
        share = await resolve_active_share(db, token, count_view=False)
    except ShareNotFound:
        raise HTTPException(404, "Invalid or revoked share link")
    except ShareExpired:
        raise HTTPException(410, "This share link has expired")

    entry = await add_feedback(
        db, share_id=share["share_id"], reviewer_name=payload.reviewer_name,
        rating=payload.rating, comment=comment,
    )
    return {"recorded": True, "feedback_id": entry["feedback_id"]}
