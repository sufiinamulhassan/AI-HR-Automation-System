import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from config.database import get_db
from config.tenancy import NO_MATCH, company_context
from services.hr_module import interviewer_link_service as links
from services.hr_module import scorecard_service
from services.hr_module.audit_service import log_audit_event
from services.hr_module.external_interview_service import ExternalInterviewError
from shared.rate_limit import enforce_rate_limit
from shared.tenant_deps import bind_company_for_token

logger = logging.getLogger(__name__)
router = APIRouter()

RATE_WINDOW_SECONDS = 60
IP_LIMIT = 120
TOKEN_LIMIT = 40

INVALID_LINK = "This scorecard link is not valid."
INACTIVE_LINK = "This scorecard link is no longer active."

_CANDIDATE_FIELDS = {
    "_id": 0, "candidate_id": 1, "name": 1, "job_id": 1, "resume_id": 1,
    "interview_mode": 1, "pipeline_stage": 1, "external_interview": 1,
    "interview_guide": 1, "interview_scorecards": 1,
}


class QuestionMarkIn(BaseModel):
    question_id: str = Field(max_length=64)
    rating: Any = None
    notes: str | None = Field(default=None, max_length=20000)


class ScorecardIn(BaseModel):
    interviewer_name: str | None = Field(default=None, max_length=1000)
    interviewer_role: str | None = Field(default=None, max_length=40)
    questions: list[QuestionMarkIn] | None = Field(default=None, max_length=200)
    ratings: dict[str, Any] | None = None
    recommendation: str | None = None
    summary: str | None = Field(default=None, max_length=40000)
    strengths: str | None = Field(default=None, max_length=40000)
    concerns: str | None = Field(default=None, max_length=40000)


def _require_db():
    db = get_db()
    if db is None:
        raise HTTPException(503, "Service unavailable")
    return db


def _client_ip(request: Request) -> str:
    from shared.rate_limit import client_ip

    return client_ip(request)


async def _throttle(db, request: Request, token: str) -> None:
    await enforce_rate_limit(
        db, key=f"interviewer:ip:{_client_ip(request)}", limit=IP_LIMIT, window_seconds=RATE_WINDOW_SECONDS,
    )
    await enforce_rate_limit(
        db, key=f"interviewer:token:{links.hash_token(token)[:24]}",
        limit=TOKEN_LIMIT, window_seconds=RATE_WINDOW_SECONDS,
    )


async def _guard_link(request: Request, token: str) -> None:
    with company_context(NO_MATCH):
        db = get_db()
    await _throttle(db, request, token)
    await bind_company_for_token("interviewer", token)


_guard_link.tenant_kind = "interviewer"


async def _resolve(db, token: str) -> dict:
    try:
        return await links.resolve_link(db, token)
    except links.LinkNotFound:
        raise HTTPException(404, INVALID_LINK)


async def _load_candidate(db, link: dict) -> dict:
    cand = await db.candidates.find_one({"candidate_id": link["candidate_id"]}, _CANDIDATE_FIELDS)
    if not cand:
        raise HTTPException(404, INVALID_LINK)
    return cand


def _own_scorecard(cand: dict, link: dict) -> dict | None:
    scorecard_id = link.get("scorecard_id")
    if not scorecard_id:
        return None
    return next((c for c in cand.get("interview_scorecards") or [] if c.get("scorecard_id") == scorecard_id), None)


@router.get("/{token}", dependencies=[Depends(_guard_link)])
async def get_scorecard_page(token: str):
    db = _require_db()

    link = await _resolve(db, token)
    if links.inactive_reason(link):
        raise HTTPException(404, INVALID_LINK)
    cand = await _load_candidate(db, link)

    job = await db.jobs.find_one({"job_id": cand.get("job_id")}, {"_id": 0, "title": 1}) or {}
    interview = cand.get("external_interview") or {}
    scorecard = _own_scorecard(cand, link)
    reason = scorecard_service.lock_reason(cand)
    guide = cand.get("interview_guide") or {}
    return {
        "candidate_name": cand.get("name"),
        "job_title": job.get("title"),
        "platform_label": interview.get("platform_label"),
        "scheduled_start_at": interview.get("scheduled_start_at"),
        "interviewer_name": (scorecard or {}).get("interviewer_name") or link.get("interviewer_name"),
        "interviewer_role": (scorecard or {}).get("interviewer_role") or link.get("interviewer_role"),
        "guide": {
            "questions": [
                {
                    "id": q.get("id"), "text": q.get("text"),
                    "dimension": q.get("dimension"), "listen_for": q.get("listen_for"),
                    "source": q.get("source") or "ai",
                }
                for q in guide.get("questions") or []
            ],
            "fallback": bool(guide.get("fallback")),
        },
        "candidate_highlights": await links.candidate_highlights(db, cand),
        "scorecard": scorecard,
        "locked": reason is not None,
        "locked_reason": reason,
        "expires_at": link.get("expires_at"),
    }


@router.put("/{token}", dependencies=[Depends(_guard_link)])
async def save_scorecard(token: str, body: ScorecardIn):
    db = _require_db()

    link = await _resolve(db, token)
    if links.inactive_reason(link):
        raise HTTPException(423, INACTIVE_LINK)
    cand = await _load_candidate(db, link)
    reason = scorecard_service.lock_reason(cand)
    if reason:
        raise HTTPException(423, reason)

    try:
        result = await links.file_link_scorecard(db, cand, link, fields=body.model_dump())
    except ExternalInterviewError as exc:
        raise HTTPException(422, str(exc))

    scorecard = result["scorecard"]
    await log_audit_event(
        db, actor_email=None, actor_role="interviewer_link",
        action="interviewer_scorecard_submitted", resource_type="candidate",
        resource_id=cand["candidate_id"],
        details={
            "link_id": link["link_id"], "scorecard_id": scorecard["scorecard_id"],
            "interviewer_name": scorecard["interviewer_name"], "report_rebuilt": result["rebuilt"],
        },
    )
    from services.hr_module.lifecycle_events import announce_scorecard_submitted
    await announce_scorecard_submitted(
        candidate_id=cand["candidate_id"], name=cand.get("name"), job_id=cand.get("job_id"),
        scorecard_id=scorecard["scorecard_id"],
    )
    return {"scorecard": scorecard, "saved": True}
