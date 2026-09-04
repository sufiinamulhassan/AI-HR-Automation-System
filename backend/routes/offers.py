"""
Offers route — hr_module Offer Management (MVP2 §2.15).

Admin-facing:
  POST   /                       create offer (draft)
  GET    /                       list offers (candidate_id/job_id/status filters)
  GET    /{offer_id}             get a single offer
  POST   /{offer_id}/approve     draft|pending_approval -> approved
  POST   /{offer_id}/send        approved -> sent (emails the candidate)
  POST   /{offer_id}/withdraw    non-terminal -> withdrawn

Public (secure_token is the credential — no auth dependency, same pattern as
routes/interview.py's candidate-facing session endpoints):
  GET    /public/{secure_token}          offer summary for the candidate
  POST   /public/{secure_token}/accept   accept the offer
  POST   /public/{secure_token}/decline  decline the offer
"""
import asyncio

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from shared.auth import get_current_user, require_admin
from config.database import get_db
from config.settings import settings
from services.hr_module import offer_service
from services.hr_module.audit_service import log_audit_event

router = APIRouter()


class CreateOfferRequest(BaseModel):
    candidate_id: str
    salary: str
    benefits: str | None = None
    joining_date: str | None = None


class DeclineOfferRequest(BaseModel):
    reason: str | None = None


@router.post("")
async def create_offer(body: CreateOfferRequest, user: dict = Depends(require_admin)):
    try:
        offer = await offer_service.create_offer(
            candidate_id=body.candidate_id,
            salary=body.salary,
            benefits=body.benefits,
            joining_date=body.joining_date,
            created_by=user["email"],
        )
    except ValueError as exc:
        raise HTTPException(404, str(exc))

    asyncio.create_task(log_audit_event(
        get_db(), actor_email=user["email"], actor_role=user.get("role"),
        action="offer_create", resource_type="offer", resource_id=offer["offer_id"],
        details={"candidate_id": body.candidate_id, "salary": body.salary},
    ))
    return offer


@router.get("")
async def list_offers(
    candidate_id: str | None = None,
    job_id: str | None = None,
    status: str | None = None,
    _: dict = Depends(get_current_user),
):
    offers = await offer_service.list_offers(candidate_id=candidate_id, job_id=job_id, status=status)
    return {"offers": offers}


@router.get("/{offer_id}")
async def get_offer(offer_id: str, _: dict = Depends(get_current_user)):
    offer = await offer_service.get_offer(offer_id)
    if not offer:
        raise HTTPException(404, "Offer not found")
    return offer


@router.post("/{offer_id}/approve")
async def approve_offer(offer_id: str, user: dict = Depends(require_admin)):
    try:
        updated = await offer_service.approve_offer(offer_id, approved_by=user["email"])
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    asyncio.create_task(log_audit_event(
        get_db(), actor_email=user["email"], actor_role=user.get("role"),
        action="offer_approve", resource_type="offer", resource_id=offer_id,
        details={},
    ))
    return updated


@router.post("/{offer_id}/send")
async def send_offer(offer_id: str, user: dict = Depends(require_admin)):
    try:
        updated = await offer_service.send_offer(offer_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except RuntimeError as exc:
        raise HTTPException(502, str(exc))

    asyncio.create_task(log_audit_event(
        get_db(), actor_email=user["email"], actor_role=user.get("role"),
        action="offer_send", resource_type="offer", resource_id=offer_id,
        details={},
    ))
    return updated


@router.post("/{offer_id}/withdraw")
async def withdraw_offer(offer_id: str, user: dict = Depends(require_admin)):
    try:
        updated = await offer_service.withdraw_offer(offer_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    asyncio.create_task(log_audit_event(
        get_db(), actor_email=user["email"], actor_role=user.get("role"),
        action="offer_withdraw", resource_type="offer", resource_id=offer_id,
        details={},
    ))
    return updated


@router.get("/public/{secure_token}")
async def get_public_offer(secure_token: str):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    offer = await db.offers.find_one({"secure_token": secure_token}, {"_id": 0})
    if not offer:
        raise HTTPException(404, "Offer not found")
    if offer.get("status") != "sent":
        raise HTTPException(410, "This offer is no longer available to respond to")

    job = await db.jobs.find_one({"job_id": offer.get("job_id")}) or {}
    return {
        "job_title": job.get("title"),
        "company_name": job.get("company_name"),
        "salary": offer.get("salary"),
        "benefits": offer.get("benefits"),
        "joining_date": offer.get("joining_date"),
        "status": offer.get("status"),
    }


def _respond_error(exc: ValueError) -> HTTPException:
    if str(exc) == "not_found":
        return HTTPException(404, "Offer not found")
    return HTTPException(410, "This offer is no longer available to respond to")


@router.post("/public/{secure_token}/accept")
async def accept_offer(secure_token: str):
    try:
        return await offer_service.respond_to_offer(secure_token, accept=True, reason=None)
    except ValueError as exc:
        raise _respond_error(exc)


@router.post("/public/{secure_token}/decline")
async def decline_offer(secure_token: str, body: DeclineOfferRequest = DeclineOfferRequest()):
    try:
        return await offer_service.respond_to_offer(secure_token, accept=False, reason=body.reason)
    except ValueError as exc:
        raise _respond_error(exc)
