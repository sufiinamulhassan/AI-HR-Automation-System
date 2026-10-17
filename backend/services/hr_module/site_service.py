from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from pydantic import EmailStr, TypeAdapter, ValidationError

from config.database import get_platform_db
from services.hr_module import plan_service, workspace_service

TOPICS = ("sales", "support", "privacy", "security", "other")
STATUSES = ("new", "in_progress", "done", "spam")
MAX_NAME_CHARS = 120
MAX_COMPANY_CHARS = 160
MIN_MESSAGE_CHARS = 10
MAX_MESSAGE_CHARS = 4000
MAX_NOTE_CHARS = 1000
DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 100
DUPLICATE_WINDOW = timedelta(minutes=10)

_EMAIL = TypeAdapter(EmailStr)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _plain(value: str | None) -> str:
    return " ".join(str(value or "").split())


def reference_of(request_id: str) -> str:
    return str(request_id).split("-")[0].upper()


def public_plans() -> list[dict]:
    plans = []
    for entry in plan_service.tier_catalog():
        if entry["tier"] == plan_service.DEFAULT_TIER:
            continue
        plan = entry["plan"]
        plans.append({
            "tier": entry["tier"],
            "label": entry["label"],
            "price_monthly_usd": plan.get("price_monthly_usd"),
            "max_companies": plan.get("max_companies"),
            "max_users_per_company": plan.get("max_users_per_company"),
            "monthly_ai_budget_usd": plan.get("monthly_ai_budget_usd"),
            "max_storage_mb": plan.get("max_storage_mb"),
            "features": [
                {"key": key, "label": plan_service.FEATURE_LABELS.get(key, key), "included": bool((plan.get("features") or {}).get(key))}
                for key in plan_service.FEATURES
            ],
        })
    return plans


def validate_contact(*, name: str, email: str, company: str, topic: str, message: str, consent: bool) -> dict:
    clean_name = _plain(name)
    if len(clean_name) < 2:
        raise HTTPException(400, "Enter your name.")
    if len(clean_name) > MAX_NAME_CHARS:
        raise HTTPException(400, f"Your name must be at most {MAX_NAME_CHARS} characters.")
    try:
        clean_email = str(_EMAIL.validate_python(str(email or "").strip())).strip().lower()
    except ValidationError:
        raise HTTPException(400, "Enter a valid email address.")
    clean_company = _plain(company)
    if len(clean_company) > MAX_COMPANY_CHARS:
        raise HTTPException(400, f"The company name must be at most {MAX_COMPANY_CHARS} characters.")
    clean_topic = str(topic or "other").strip().lower()
    if clean_topic not in TOPICS:
        raise HTTPException(400, "Choose what your message is about.")
    text = re.sub(r"\r\n?", "\n", str(message or "")).strip()
    if len(text) < MIN_MESSAGE_CHARS:
        raise HTTPException(400, f"Write at least {MIN_MESSAGE_CHARS} characters so we can help.")
    if len(text) > MAX_MESSAGE_CHARS:
        raise HTTPException(400, f"Your message must be at most {MAX_MESSAGE_CHARS} characters.")
    if not consent:
        raise HTTPException(400, "Please agree that we may use your details to reply.")
    return {"name": clean_name, "email": clean_email, "company": clean_company, "topic": clean_topic, "message": text}


async def submit_contact(form: dict) -> dict:
    raw = get_platform_db()
    if raw is None:
        raise HTTPException(503, "The service is unavailable right now. Please try again shortly.")
    cutoff = (_now() - DUPLICATE_WINDOW).isoformat()
    existing = await raw.contact_requests.find_one(
        {"email": form["email"], "message": form["message"], "created_at": {"$gte": cutoff}}, {"_id": 0, "request_id": 1},
    )
    if existing:
        return {"status": "received", "reference": reference_of(existing["request_id"])}
    request_id = str(uuid.uuid4())
    now = _now().isoformat()
    await raw.contact_requests.insert_one({
        "request_id": request_id,
        **form,
        "status": "new",
        "note": "",
        "source": "website",
        "created_at": now,
        "updated_at": now,
        "handled_by": None,
    })
    return {"status": "received", "reference": reference_of(request_id)}


def _public_row(row: dict) -> dict:
    return {key: value for key, value in row.items() if key != "_id"}


async def list_requests(
    *, status: str | None = None, topic: str | None = None, q: str | None = None, page: int = 1, limit: int = DEFAULT_PAGE_SIZE,
) -> dict:
    raw = get_platform_db()
    page = max(1, int(page or 1))
    limit = max(1, min(int(limit or DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE))
    empty = {"items": [], "total": 0, "page": page, "limit": limit, "pages": 0, "counts": {s: 0 for s in STATUSES}}
    if raw is None:
        return empty
    clauses: list[dict] = []
    if status in STATUSES:
        clauses.append({"status": status})
    if topic in TOPICS:
        clauses.append({"topic": topic})
    term = _plain(q)[:120]
    if term:
        pattern = re.escape(term)
        clauses.append({"$or": [
            {field: {"$regex": pattern, "$options": "i"}} for field in ("name", "email", "company", "message")
        ]})
    query = {"$and": clauses} if clauses else {}
    total = await raw.contact_requests.count_documents(query)
    rows = []
    if total:
        rows = await (
            raw.contact_requests.find(query, {"_id": 0}).sort("created_at", -1).skip((page - 1) * limit).limit(limit)
        ).to_list(length=limit)
    counts = {s: await raw.contact_requests.count_documents({"status": s}) for s in STATUSES}
    return {
        "items": [_public_row(r) for r in rows],
        "total": total,
        "page": page,
        "limit": limit,
        "pages": -(-total // limit) if total else 0,
        "counts": counts,
    }


async def update_request(request_id: str, *, status: str | None, note: str | None, actor: dict) -> dict:
    raw = get_platform_db()
    if raw is None:
        raise HTTPException(503, "The database is unavailable.")
    changes: dict = {}
    if status is not None:
        if status not in STATUSES:
            raise HTTPException(400, "Unknown status.")
        changes["status"] = status
    if note is not None:
        clean = str(note).strip()
        if len(clean) > MAX_NOTE_CHARS:
            raise HTTPException(400, f"The note must be at most {MAX_NOTE_CHARS} characters.")
        changes["note"] = clean
    if not changes:
        raise HTTPException(400, "Nothing to update.")
    changes["updated_at"] = _now().isoformat()
    changes["handled_by"] = actor.get("email")
    result = await raw.contact_requests.update_one({"request_id": request_id}, {"$set": changes})
    if not result.matched_count:
        raise HTTPException(404, "Request not found.")
    await workspace_service.platform_audit(
        actor, "contact_request_update", "contact_request", request_id, {k: v for k, v in changes.items() if k in ("status", "note")},
    )
    row = await raw.contact_requests.find_one({"request_id": request_id}, {"_id": 0})
    return _public_row(row)


async def delete_request(request_id: str, *, actor: dict) -> None:
    raw = get_platform_db()
    if raw is None:
        raise HTTPException(503, "The database is unavailable.")
    result = await raw.contact_requests.delete_one({"request_id": request_id})
    if not result.deleted_count:
        raise HTTPException(404, "Request not found.")
    await workspace_service.platform_audit(actor, "contact_request_delete", "contact_request", request_id, {})
