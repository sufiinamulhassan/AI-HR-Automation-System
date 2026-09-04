"""
Interview route — hr_module HTTP session API, admin report, admin PDF.

Serverless hosts are HTTP-only here — WebSockets are not supported.
The interview is driven client-side; the backend validates, serves questions,
and accepts the final transcript in a single submit call.

Access rules:
  GET  /session/{token}             → candidate-only (token is auth)
  POST /session/{token}/submit      → candidate-only
  POST /session/{token}/flag        → candidate-only
  POST /session/{token}/followup    → candidate-only
  POST /session/{token}/reasoning-probe → candidate-only
  POST /session/{token}/speak       → candidate-only (question text → MP3 audio)
  POST /session/{token}/transcribe  → candidate-only (recorded answer → text)
  PATCH /interview/{candidate_id}/schedule     → admin-only (internal scheduling slot)
  GET  /interview/{candidate_id}/schedule.ics  → admin-only (calendar invite download)
  GET  /report/{token}              → admin-only (full evaluation, scores, recommendation)
  GET  /report/{token}/pdf          → admin-only (PDF export)

Candidate receives ONLY a status email after interview — NOT the report.
"""
import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from shared.auth import require_admin
from shared.utils import is_invite_expired
from config.database import get_db
from config.settings import settings
from services.hr_module.audit_service import log_audit_event

router = APIRouter()
logger = logging.getLogger(__name__)


def _require_db():
    db = get_db()
    if db is None:
        raise HTTPException(503, "Service unavailable")
    return db


async def _load_active_candidate(db, secure_token: str) -> dict:
    """Resolve a candidate by interview token, rejecting spent or expired links.

    The token is the only credential these candidate-facing endpoints have, so
    every one of them applies this identical guard.
    """
    cand = await db.candidates.find_one({"secure_token": secure_token})
    if not cand:
        raise HTTPException(404, "Invalid interview link")
    if cand.get("token_status") == "consumed":
        raise HTTPException(410, "This interview session has already been completed")
    if is_invite_expired(cand, days=settings.INVITE_LINK_EXPIRY_DAYS):
        raise HTTPException(410, "This interview link has expired — please request a new invite")
    return cand

@router.get("/session/{secure_token}")
async def start_session(secure_token: str):
    """
    Validate the interview token and return all questions.
    The client drives the question-by-question flow and enforces the timer.
    """
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


@router.post("/session/{secure_token}/submit")
async def submit_session(secure_token: str, payload: SubmitPayload):
    """Accept the completed transcript and trigger background evaluation."""
    db = _require_db()
    await _load_active_candidate(db, secure_token)

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

    if payload.transcript:
        asyncio.create_task(_evaluate(secure_token))

    return {"status": "submitted"}


class FlagPayload(BaseModel):
    event: str


@router.post("/session/{secure_token}/flag")
async def record_flag(secure_token: str, payload: FlagPayload):
    """Record an integrity alert (tab-switch, copy-paste, etc.) during the interview.

    Routes through the same `_load_active_candidate` guard as every other
    candidate-facing endpoint. Without it this was the one hole where an
    already-consumed or expired token could still append to a candidate's
    integrity history — i.e. pollute a completed report after the fact.
    The client treats a rejection as a no-op (`sendFlag` swallows errors, and
    `/submit` carries the termination flag in its own payload as a fallback),
    so tightening this changes nothing for a legitimate live session.
    """
    db = _require_db()
    await _load_active_candidate(db, secure_token)

    flag = f"{payload.event}@{datetime.now(timezone.utc).isoformat()}"
    await db.candidates.update_one(
        {"secure_token": secure_token},
        {"$push": {"integrity_flags": flag}},
    )
    return {"recorded": True}


class FollowupPayload(BaseModel):
    question: str
    answer: str


@router.post("/session/{secure_token}/followup")
async def get_followup(secure_token: str, payload: FollowupPayload):
    """
    Multi-turn LLM-driven follow-up (MVP2 §2.8) — additive to the upfront
    question batch. The client submits the Q&A pair it just captured and may
    receive a probing follow-up question if the answer looked thin.
    """
    db = _require_db()
    cand = await _load_active_candidate(db, secure_token)

    job = await db.jobs.find_one({"job_id": cand.get("job_id")}) or {}

    from services.hr_module.interview_engine import generate_followup
    followup = await generate_followup(payload.question, payload.answer, job)

    return {"followup": followup}


class ReasoningProbePayload(BaseModel):
    question: str
    answer: str
    prior_answer: str | None = None


@router.post("/session/{secure_token}/reasoning-probe")
async def get_reasoning_probe(secure_token: str, payload: ReasoningProbePayload):
    """
    AI-assistance mitigation (why-this-approach / changed-condition / edge-case
    probe), additive and sibling to `/followup` above — that endpoint catches
    thin answers, this one checks genuine understanding regardless of how
    polished the answer sounded. Stateless: the client decides when to call
    this (e.g. every Nth question) rather than the backend tracking a cadence.
    """
    db = _require_db()
    cand = await _load_active_candidate(db, secure_token)

    job = await db.jobs.find_one({"job_id": cand.get("job_id")}) or {}

    from services.hr_module.interview_engine import generate_reasoning_probe
    probe = await generate_reasoning_probe(
        payload.question, payload.answer, job, prior_answer=payload.prior_answer,
    )

    return {"probe": probe}


class SpeakPayload(BaseModel):
    text: str


@router.post("/session/{secure_token}/speak")
async def speak_question(secure_token: str, payload: SpeakPayload):
    """Synthesise a question to MP3 so the AI can read it aloud to the candidate.

    Returned as raw audio rather than a URL: the audio is ephemeral, per-session
    and candidate-specific, so there is nothing worth storing or caching.
    """
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


@router.post("/session/{secure_token}/transcribe")
async def transcribe_answer_audio(secure_token: str, file: UploadFile = File(...)):
    """Transcribe a recorded spoken answer to text.

    The client uploads the recording it just captured and gets the text back to
    display for confirmation; only after the candidate confirms does the text
    reach the transcript via POST /session/{token}/submit.
    """
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
):
    """
    Internal calendar-based scheduling slot (MVP2 §2.8). Sets the earliest
    moment a candidate may start their interview session.

    With `create_meeting=true` a Zoom or Microsoft Teams meeting is also created
    for the slot (MVP2 §2.19) and its join URL stored on the candidate. Meeting
    creation is BEST-EFFORT: if no provider is configured, or the provider call
    fails, the schedule is still saved and the failure is reported in
    `meeting_error` rather than 5xx-ing the whole request. The .ics download
    remains available either way.

    Pass scheduled_start_at=null to clear the schedule.
    """
    db = get_db()
    if db is None:
        raise HTTPException(503, "Service unavailable")

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
                topic=f"Interview: {cand.get('name') or 'Candidate'} — {job.get('title') or 'Role'}",
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
                "has been detached. It still exists at the old time on your provider — "
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
async def schedule_ics(candidate_id: str, _: dict = Depends(require_admin)):
    """
    Download a calendar invite (.ics) for the candidate's scheduled interview
    slot (MVP2 §2.19 — Calendar half of Integrations). Zero-OAuth, universal
    RFC 5545 file: importable into Google Calendar, Outlook, and Apple
    Calendar with no auth flow. Requires `scheduled_start_at` to already be
    set via `PATCH /{candidate_id}/schedule` — 404 if none is set yet.
    """
    db = get_db()
    if db is None:
        raise HTTPException(503, "Service unavailable")

    cand = await db.candidates.find_one({"candidate_id": candidate_id})
    if not cand:
        raise HTTPException(404, "Candidate not found")

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
            summary=f"Interview: {candidate_name} — {job_title}",
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
    """Run eval_graph in background after session ends. Sends status email to candidate."""
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
async def get_report(secure_token: str, _: dict = Depends(require_admin)):
    """Full evaluation report — admin only. Never sent to the candidate."""
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    cand = await db.candidates.find_one({"secure_token": secure_token}, {"_id": 0})
    if not cand:
        raise HTTPException(404, "Session not found")
    return {
        "candidate_id": cand.get("candidate_id"),
        "name": cand.get("name"),
        "email": cand.get("email"),
        "job_id": cand.get("job_id"),
        "eval_score": cand.get("eval_score"),
        "report": cand.get("report"),
        "status": cand.get("status"),
        "transcript": cand.get("transcript", []),
        "integrity_flags": cand.get("integrity_flags", []),
        "invite_type": cand.get("invite_type"),
        "match_score": cand.get("match_score"),
    }


@router.get("/report/{secure_token}/pdf")
async def report_pdf(secure_token: str, _: dict = Depends(require_admin)):
    """Generate and return PDF interview report — admin only."""
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    cand = await db.candidates.find_one({"secure_token": secure_token})
    if not cand or not cand.get("report"):
        raise HTTPException(404, "Report not ready yet")

    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.pagesizes import letter
    from reportlab.lib import colors
    import io

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, topMargin=40, bottomMargin=40)
    styles = getSampleStyleSheet()
    report = cand["report"]

    score_data = [
        ["Dimension", "Score"],
        ["Overall", f"{report.get('overall_score', 'N/A')}/100"],
        ["Technical", f"{report.get('technical_score', 'N/A')}/100"],
        ["Communication", f"{report.get('communication_score', 'N/A')}/100"],
        ["Problem Solving", f"{report.get('problem_solving_score', 'N/A')}/100"],
        ["Cultural Fit", f"{report.get('cultural_fit_score', 'N/A')}/100"],
        ["Confidence", f"{report.get('confidence_score', 'N/A')}/100"],
        ["Integrity", f"{report.get('integrity_score', 'N/A')}/100"],
    ]
    if report.get("coding_score") is not None:
        score_data.append(["Coding (tests passed)", f"{report['coding_score']}/100"])
    if report.get("coding_quality_score") is not None:
        score_data.append(["Coding (AI quality)", f"{report['coding_quality_score']}/100"])
    for dim, val in (report.get("scenario_scores") or {}).items():
        score_data.append([dim.replace("_", " ").title(), f"{val}/100"])

    story = [
        Paragraph(f"Interview Report — {cand.get('name', '')}", styles["Title"]),
        Spacer(1, 8),
        Paragraph(f"Recommendation: {str(report.get('recommendation', 'N/A')).upper()}", styles["Heading2"]),
        Spacer(1, 12),
        Paragraph("Scores", styles["Heading3"]),
        Spacer(1, 4),
        Table(
            score_data,
            style=TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1a56db")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f9fafb")]),
            ]),
        ),
        Spacer(1, 12),
        Paragraph("Summary", styles["Heading3"]),
        Paragraph(report.get("summary", ""), styles["Normal"]),
        Spacer(1, 8),
        Paragraph("Integrity Assessment", styles["Heading3"]),
        Paragraph(report.get("integrity_assessment", "None"), styles["Normal"]),
    ]

    for key, label in [("strengths", "Strengths"), ("areas_for_improvement", "Areas for Improvement")]:
        items = report.get(key, [])
        if items:
            story += [Spacer(1, 8), Paragraph(label, styles["Heading3"])]
            story += [Paragraph(f"• {i}", styles["Normal"]) for i in items]

    doc.build(story)
    return Response(
        content=buf.getvalue(),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=report_{secure_token[:8]}.pdf"},
    )
