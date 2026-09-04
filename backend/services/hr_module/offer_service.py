"""
Offer service — hr_module Offer Management (MVP2 §2.15).

Lifecycle:
  draft -> pending_approval -> approved -> sent -> accepted | declined
  (any of draft/pending_approval/approved/sent) -> withdrawn

Public accept/decline flow is driven entirely by `secure_token` (same pattern
as candidates.secure_token / interview session tokens) — no auth dependency.
"""
import asyncio
import uuid
from datetime import datetime, timezone

from config.database import get_db

_NON_TERMINAL_STATUSES = {"draft", "pending_approval", "approved", "sent"}


def _offer_context(offer: dict, workflow_depth: int) -> dict:
    """Flat context every offer trigger publishes to the rules engine.

    `_workflow_depth` is how a rule-driven transition tells the next round of
    rule evaluation how deep the chain already is; workflow_engine stops
    applying offer actions past MAX_WORKFLOW_CHAIN_DEPTH so an
    approve→send→approve cycle terminates. A human-initiated transition starts
    at 0.
    """
    return {
        "offer_id": offer.get("offer_id"), "candidate_id": offer.get("candidate_id"),
        "job_id": offer.get("job_id"), "status": offer.get("status"),
        "salary": offer.get("salary"), "joining_date": offer.get("joining_date"),
        "_workflow_depth": workflow_depth,
    }


def _fire_offer_status_changed(offer: dict, workflow_depth: int = 0) -> None:
    """Fire-and-forget workflow-rule trigger for any offer status transition —
    see services/hr_module/workflow_engine.py's call-site contract."""
    from services.hr_module.workflow_engine import evaluate_and_apply_rules
    asyncio.create_task(evaluate_and_apply_rules(
        trigger_type="offer_status_changed",
        context=_offer_context(offer, workflow_depth),
    ))


def _fire_offer_created(offer: dict) -> None:
    """Trigger fired the moment an offer is drafted (MVP2 §2.18).

    Distinct from offer_status_changed so a rule can act on creation without
    also matching every later transition — this is the hook an
    "auto-approve offers at or below X" rule attaches to. Always depth 0: an
    offer is only ever created by a human/API caller, never by a rule.
    """
    from services.hr_module.workflow_engine import evaluate_and_apply_rules
    asyncio.create_task(evaluate_and_apply_rules(
        trigger_type="offer_created",
        context=_offer_context(offer, 0),
    ))


async def create_offer(
    candidate_id: str,
    salary: str,
    benefits: str | None,
    joining_date: str | None,
    created_by: str,
) -> dict:
    db = get_db()
    if db is None:
        raise RuntimeError("Database unavailable")

    cand = await db.candidates.find_one({"candidate_id": candidate_id})
    if not cand:
        raise ValueError("Candidate not found")

    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "doc_type": "offer",
        "offer_id": str(uuid.uuid4()),
        "candidate_id": candidate_id,
        "job_id": cand.get("job_id"),
        "salary": salary,
        "benefits": benefits,
        "joining_date": joining_date,
        "status": "draft",
        "secure_token": f"tok_{uuid.uuid4().hex[:12]}",
        "created_by": created_by,
        "approved_by": None,
        "sent_at": None,
        "responded_at": None,
        "decline_reason": None,
        "created_at": now,
        "updated_at": now,
    }
    await db.offers.insert_one(doc)
    doc.pop("_id", None)
    _fire_offer_created(doc)
    return doc


async def get_offer(offer_id: str) -> dict | None:
    db = get_db()
    if db is None:
        raise RuntimeError("Database unavailable")
    return await db.offers.find_one({"offer_id": offer_id}, {"_id": 0})


async def list_offers(
    candidate_id: str | None = None,
    job_id: str | None = None,
    status: str | None = None,
) -> list[dict]:
    db = get_db()
    if db is None:
        raise RuntimeError("Database unavailable")
    query: dict = {"doc_type": "offer"}
    if candidate_id:
        query["candidate_id"] = candidate_id
    if job_id:
        query["job_id"] = job_id
    if status:
        query["status"] = status
    cursor = db.offers.find(query, {"_id": 0}).sort("created_at", -1)
    return await cursor.to_list(length=1000)


async def approve_offer(offer_id: str, approved_by: str, workflow_depth: int = 0) -> dict:
    db = get_db()
    if db is None:
        raise RuntimeError("Database unavailable")
    offer = await db.offers.find_one({"offer_id": offer_id})
    if not offer:
        raise ValueError("Offer not found")
    if offer.get("status") not in ("draft", "pending_approval"):
        raise ValueError(f"Cannot approve an offer in status '{offer.get('status')}'")

    now = datetime.now(timezone.utc).isoformat()
    await db.offers.update_one(
        {"offer_id": offer_id},
        {"$set": {"status": "approved", "approved_by": approved_by, "updated_at": now}},
    )
    updated = await db.offers.find_one({"offer_id": offer_id}, {"_id": 0})
    _fire_offer_status_changed(updated, workflow_depth)
    return updated


async def send_offer(offer_id: str, workflow_depth: int = 0) -> dict:
    db = get_db()
    if db is None:
        raise RuntimeError("Database unavailable")
    offer = await db.offers.find_one({"offer_id": offer_id})
    if not offer:
        raise ValueError("Offer not found")
    if offer.get("status") != "approved":
        raise ValueError(f"Cannot send an offer in status '{offer.get('status')}'")

    cand = await db.candidates.find_one({"candidate_id": offer.get("candidate_id")}) or {}
    job = await db.jobs.find_one({"job_id": offer.get("job_id")}) or {}

    from config.settings import settings
    accept_url = f"{settings.FRONTEND_URL}/offer/{offer['secure_token']}"

    from services.hr_module.email_service import send_offer_letter_email
    import logging
    delivered = await send_offer_letter_email(
        to_email=cand.get("email", ""),
        candidate_name=cand.get("name", "Candidate"),
        job_title=job.get("title", ""),
        company_name=job.get("company_name"),
        salary=offer.get("salary"),
        joining_date=offer.get("joining_date"),
        benefits=offer.get("benefits"),
        accept_url=accept_url,
        db=db,
        candidate_id=offer.get("candidate_id"),
        job_id=offer.get("job_id"),
    )
    if not delivered:
        logging.getLogger(__name__).warning("Offer letter email failed to send | offer_id=%s", offer_id)

    now = datetime.now(timezone.utc).isoformat()
    await db.offers.update_one(
        {"offer_id": offer_id},
        {"$set": {"status": "sent", "sent_at": now, "updated_at": now}},
    )
    updated = await db.offers.find_one({"offer_id": offer_id}, {"_id": 0})
    _fire_offer_status_changed(updated, workflow_depth)
    return updated


async def withdraw_offer(offer_id: str, workflow_depth: int = 0) -> dict:
    db = get_db()
    if db is None:
        raise RuntimeError("Database unavailable")
    offer = await db.offers.find_one({"offer_id": offer_id})
    if not offer:
        raise ValueError("Offer not found")
    if offer.get("status") not in _NON_TERMINAL_STATUSES:
        raise ValueError(f"Cannot withdraw an offer in status '{offer.get('status')}'")

    now = datetime.now(timezone.utc).isoformat()
    await db.offers.update_one(
        {"offer_id": offer_id},
        {"$set": {"status": "withdrawn", "updated_at": now}},
    )
    updated = await db.offers.find_one({"offer_id": offer_id}, {"_id": 0})
    _fire_offer_status_changed(updated, workflow_depth)
    return updated


async def respond_to_offer(secure_token: str, accept: bool, reason: str | None) -> dict:
    db = get_db()
    if db is None:
        raise RuntimeError("Database unavailable")
    offer = await db.offers.find_one({"secure_token": secure_token})
    if not offer:
        raise ValueError("not_found")
    if offer.get("status") != "sent":
        raise ValueError("not_respondable")

    now = datetime.now(timezone.utc).isoformat()
    new_status = "accepted" if accept else "declined"
    await db.offers.update_one(
        {"secure_token": secure_token},
        {"$set": {
            "status": new_status,
            "responded_at": now,
            "decline_reason": (reason if not accept else None),
            "updated_at": now,
        }},
    )
    updated = await db.offers.find_one({"secure_token": secure_token}, {"_id": 0})
    _fire_offer_status_changed(updated, 0)
    return updated
