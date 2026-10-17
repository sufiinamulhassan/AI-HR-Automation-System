import asyncio
import logging
import uuid
from datetime import datetime, timezone

from config.database import get_db
from config.settings import settings
from shared.utils import compute_invite_expiry, new_secure_token

logger = logging.getLogger(__name__)


async def auto_invite_if_qualified(
    *,
    resume_id: str,
    matched_jds: list[dict],
    candidate_email: str | None,
    candidate_name: str | None,
) -> list[str]:
    if not settings.AUTO_INVITE_ENABLED:
        return []
    if not candidate_email or not matched_jds:
        return []

    db = get_db()
    if db is None:
        return []

    qualified = [m for m in matched_jds if m.get("score", 0) >= settings.AUTO_INVITE_THRESHOLD]
    if not qualified:
        return []

    created: list[str] = []
    for match in qualified:
        job_id = match["job_id"]
        score = match["score"]
        candidate_id = await _create_and_invite(
            db=db,
            job_id=job_id,
            resume_id=resume_id,
            score=score,
            candidate_email=candidate_email,
            candidate_name=candidate_name or "Candidate",
            invite_type="auto",
        )
        if candidate_id:
            created.append(candidate_id)

    return created


async def auto_invite_from_jd_match(
    *,
    job_id: str,
    matched_resumes: list[dict],
    force: bool = False,
) -> list[str]:
    if not settings.AUTO_INVITE_ENABLED and not force:
        return []
    if not matched_resumes:
        return []

    db = get_db()
    if db is None:
        return []

    qualified = [m for m in matched_resumes if m.get("score", 0) >= settings.AUTO_INVITE_THRESHOLD]
    if not qualified:
        return []

    created: list[str] = []
    for match in qualified:
        resume_id = match["resume_id"]
        score = match["score"]

        resume = await db.resumes.find_one({"resume_id": resume_id}) or {}
        candidate_email = resume.get("candidate_email")
        candidate_name = resume.get("candidate_name", "Candidate")

        if not candidate_email:
            profile = await db[settings.MARKETPLACE_COLLECTION].find_one({"resume_id": resume_id}) or {}
            candidate_email = profile.get("email")
            candidate_name = profile.get("name") or candidate_name

        if not candidate_email:
            logger.info("No email for resume %s: skipping auto-invite", resume_id)
            continue

        candidate_id = await _create_and_invite(
            db=db,
            job_id=job_id,
            resume_id=resume_id,
            score=score,
            candidate_email=candidate_email,
            candidate_name=candidate_name,
            invite_type="auto",
        )
        if candidate_id:
            created.append(candidate_id)

    return created


async def send_manual_invite(*, candidate: dict, admin_email: str) -> bool:
    from services.hr_module.email_service import send_invite_email

    if candidate.get("interview_mode") == "external":
        logger.warning(
            "Not sending the AI interview link: candidate_id=%s is interviewed on another platform",
            candidate.get("candidate_id"),
        )
        return False

    db = get_db()
    job: dict = {}
    if db is not None:
        job = await db.jobs.find_one({"job_id": candidate.get("job_id")}) or {}

    ok = await send_invite_email(
        to_email=candidate["email"],
        candidate_name=candidate.get("name", "Candidate"),
        job_title=job.get("title", ""),
        company_name=job.get("company_name"),
        secure_token=candidate["secure_token"],
        db=db, candidate_id=candidate.get("candidate_id"), job_id=candidate.get("job_id"),
    )
    if ok:
        logger.info("Manual invite sent by %s to %s", admin_email, candidate["email"])
    return ok


async def _create_and_invite(
    *,
    db,
    job_id: str,
    resume_id: str,
    score: float,
    candidate_email: str,
    candidate_name: str,
    invite_type: str,
) -> str | None:
    existing = await db.candidates.find_one({"job_id": job_id, "email": candidate_email})
    if existing:
        logger.info("Skipping duplicate invite | email=%s job_id=%s", candidate_email, job_id)
        return None

    job = await db.jobs.find_one({"job_id": job_id}) or {}
    candidate_id = str(uuid.uuid4())
    token = new_secure_token()
    now = datetime.now(timezone.utc).isoformat()

    scenario_id = None
    try:
        from services.hr_module.scenario_service import pick_scenario_for_job
        scenario_id = await pick_scenario_for_job(job)
    except Exception as exc:
        logger.warning("Scenario selection failed for job_id=%s: %s", job_id, exc)

    doc = {
        "doc_type": "candidate",
        "candidate_id": candidate_id,
        "job_id": job_id,
        "name": candidate_name,
        "email": candidate_email,
        "resume_id": resume_id,
        "application_source": "auto_match",
        "secure_token": token,
        "token_status": "active",
        "status": "invited",
        "pipeline_stage": "invited",
        "invite_type": invite_type,
        "match_score": round(score, 4),
        "scenario_id": scenario_id,
        "session_active": False,
        "invited_by": "system",
        "invited_by_role": "system",
        "transcript": [],
        "integrity_flags": [],
        "report": None,
        "eval_score": None,
        "invite_sent_at": now,
        "invite_expires_at": compute_invite_expiry(sent_at=now, regenerated_at=None, days=settings.INVITE_LINK_EXPIRY_DAYS),
        "invite_resent_count": 0,
        "created_at": now,
    }
    await db.candidates.insert_one(doc)

    try:
        from services.hr_module.candidate_profile_service import upsert_candidate_profile
        await upsert_candidate_profile(doc)
    except Exception as exc:
        logger.warning("upsert_candidate_profile failed for candidate_id=%s: %s", candidate_id, exc)

    await db.jobs.update_one(
        {"job_id": job_id, "candidate_pipeline.resume_id": {"$ne": resume_id}},
        {"$push": {"candidate_pipeline": {
            "resume_id": resume_id,
            "similarity_score": round(score, 4),
            "pipeline_stage": "invited",
            "added_at": now,
        }}},
    )

    asyncio.create_task(_prepare_interview_questions(token))

    from services.hr_module.email_service import send_invite_email
    delivered = await send_invite_email(
        to_email=candidate_email,
        candidate_name=candidate_name,
        job_title=job.get("title", ""),
        company_name=job.get("company_name"),
        secure_token=token,
        db=db, candidate_id=candidate_id, job_id=job_id,
    )
    await db.candidates.update_one(
        {"candidate_id": candidate_id},
        {"$set": {"invite_email_delivered": bool(delivered)}},
    )
    if not delivered:
        logger.error(
            "Invite email FAILED to send: candidate created but not contacted | "
            "email=%s job_id=%s candidate_id=%s",
            candidate_email, job_id, candidate_id,
        )

    from services.hr_module.workflow_engine import TRIGGER_CANDIDATE_INVITED, evaluate_and_apply_rules
    asyncio.create_task(evaluate_and_apply_rules(
        trigger_type=TRIGGER_CANDIDATE_INVITED,
        context={
            "candidate_id": candidate_id, "job_id": job_id, "email": candidate_email,
            "candidate_name": candidate_name, "invite_type": invite_type,
            "secure_token": token, "score": score,
        },
    ))
    from services.hr_module.lifecycle_events import announce_candidate_invited
    await announce_candidate_invited(
        candidate_id=candidate_id, name=candidate_name, job_id=job_id, invite_type=invite_type,
    )

    logger.info(
        "Auto-invited | email=%s job_id=%s score=%.2f candidate_id=%s",
        candidate_email, job_id, score, candidate_id,
    )
    return candidate_id


async def _prepare_interview_questions(secure_token: str) -> None:
    try:
        from agents.interview_agent import build_interview_agent
        prepare, _ = build_interview_agent()
        state = await prepare.ainvoke({"secure_token": secure_token})
        questions = state.get("questions", [])
        if questions:
            from config.database import get_db as _get_db
            db = _get_db()
            if db is not None:
                await db.candidates.update_one(
                    {"secure_token": secure_token},
                    {"$set": {"_questions": questions}},
                )
    except Exception as exc:
        logger.warning("Pre-generate questions failed for token %s: %s", secure_token, exc)
