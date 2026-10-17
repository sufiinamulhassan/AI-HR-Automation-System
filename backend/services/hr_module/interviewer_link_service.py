from __future__ import annotations

import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from config.settings import settings
from services.hr_module.interview_guide_service import load_resume_profile
from services.hr_module.scorecard_service import (
    MAX_NAME_CHARS,
    MUTABLE_FIELDS,
    ROLES,
    build_scorecard,
    rebuild_review_and_report,
)
from services.hr_module.external_interview_service import ExternalInterviewError
from shared.links import base_url
from shared.utils import sha256_hex

logger = logging.getLogger(__name__)

COLLECTION = "interviewer_links"
MAX_ACTIVE_LINKS = 5
DEFAULT_ROLE = "engineer"
MIN_EXPIRY_DAYS, MAX_EXPIRY_DAYS, DEFAULT_EXPIRY_DAYS = 1, 30, 7
MAX_TOKEN_CHARS = 300
MAX_HIGHLIGHT_SKILLS = 15


class LinkNotFound(LookupError):
    pass


class TooManyLinks(Exception):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_dt(value) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def hash_token(token: str) -> str:
    return sha256_hex(token.encode("utf-8"))


def link_url(token: str) -> str:
    return f"{base_url().rstrip('/')}/interviewer/{token}"


def inactive_reason(link: dict) -> str | None:
    if link.get("revoked"):
        return "revoked"
    expires = _parse_dt(link.get("expires_at"))
    if expires is not None and _now() > expires:
        return "expired"
    return None


def public_link_row(doc: dict) -> dict:
    return {
        "link_id": doc.get("link_id"),
        "interviewer_name": doc.get("interviewer_name"),
        "interviewer_role": doc.get("interviewer_role"),
        "created_at": doc.get("created_at"),
        "expires_at": doc.get("expires_at"),
        "revoked": bool(doc.get("revoked")),
        "submitted": bool(doc.get("scorecard_id")),
    }


def clean_inputs(
    interviewer_name: str | None, interviewer_role: str | None, expires_in_days: int | None,
) -> tuple[str | None, str, int]:
    name = (interviewer_name or "").strip()
    if len(name) > MAX_NAME_CHARS:
        raise ExternalInterviewError(f"The name can be at most {MAX_NAME_CHARS} characters.")
    role = interviewer_role or DEFAULT_ROLE
    if role not in ROLES:
        raise ExternalInterviewError("Choose a valid interviewer role.")
    days = max(MIN_EXPIRY_DAYS, min(MAX_EXPIRY_DAYS, int(expires_in_days or DEFAULT_EXPIRY_DAYS)))
    return name or None, role, days


async def ensure_capacity(db, candidate_id: str) -> None:
    live = await db[COLLECTION].count_documents({"candidate_id": candidate_id, "revoked": False})
    if live >= MAX_ACTIVE_LINKS:
        raise TooManyLinks()


async def create_link(
    db,
    *,
    candidate: dict,
    created_by: str | None,
    interviewer_name: str | None,
    interviewer_role: str | None,
    expires_in_days: int | None,
) -> tuple[str, dict]:
    name, role, days = clean_inputs(interviewer_name, interviewer_role, expires_in_days)
    await ensure_capacity(db, candidate["candidate_id"])

    token = secrets.token_urlsafe(32)
    now = _now()
    doc = {
        "link_id": uuid.uuid4().hex,
        "candidate_id": candidate["candidate_id"],
        "job_id": candidate.get("job_id"),
        "token_hash": hash_token(token),
        "interviewer_name": name,
        "interviewer_role": role,
        "created_by": created_by,
        "created_at": now.isoformat(),
        "expires_at": (now + timedelta(days=days)).isoformat(),
        "revoked": False,
        "revoked_at": None,
        "revoked_by": None,
        "scorecard_id": None,
    }
    await db[COLLECTION].insert_one(dict(doc))
    return token, doc


async def list_links(db, candidate_id: str) -> list[dict]:
    cursor = db[COLLECTION].find({"candidate_id": candidate_id}, {"_id": 0}).sort("created_at", -1)
    return [public_link_row(doc) async for doc in cursor]


async def revoke_link(db, *, candidate_id: str, link_id: str, actor_email: str | None) -> dict | None:
    doc = await db[COLLECTION].find_one({"candidate_id": candidate_id, "link_id": link_id}, {"_id": 0})
    if not doc:
        return None
    if not doc.get("revoked"):
        stamp = _now().isoformat()
        await db[COLLECTION].update_one(
            {"link_id": link_id},
            {"$set": {"revoked": True, "revoked_at": stamp, "revoked_by": actor_email}},
        )
        doc.update({"revoked": True, "revoked_at": stamp, "revoked_by": actor_email})
    return public_link_row(doc)


async def resolve_link(db, token: str) -> dict:
    if not token or len(token) > MAX_TOKEN_CHARS:
        raise LinkNotFound()
    doc = await db[COLLECTION].find_one({"token_hash": hash_token(token)}, {"_id": 0})
    if not doc:
        raise LinkNotFound()
    return doc


async def candidate_highlights(db, candidate: dict) -> dict:
    profile = await load_resume_profile(db, candidate)
    return {
        "seniority": profile["seniority"],
        "domain": profile["domain"],
        "skills": profile["skills"][:MAX_HIGHLIGHT_SKILLS],
    }


async def upsert_link_scorecard(db, link: dict, card: dict) -> None:
    candidate_id = link["candidate_id"]
    scorecard_id = link.get("scorecard_id")
    if not scorecard_id:
        claimed = await db[COLLECTION].update_one(
            {"link_id": link["link_id"], "scorecard_id": None},
            {"$set": {"scorecard_id": card["scorecard_id"]}},
        )
        if claimed.matched_count:
            await db.candidates.update_one(
                {"candidate_id": candidate_id}, {"$push": {"interview_scorecards": card}},
            )
            return
        fresh = await db[COLLECTION].find_one({"link_id": link["link_id"]}, {"_id": 0, "scorecard_id": 1})
        scorecard_id = (fresh or {}).get("scorecard_id")
    updated = await db.candidates.update_one(
        {"candidate_id": candidate_id, "interview_scorecards.scorecard_id": scorecard_id},
        {"$set": {f"interview_scorecards.$.{k}": card[k] for k in MUTABLE_FIELDS}},
    )
    if not updated.matched_count:
        await db.candidates.update_one(
            {"candidate_id": candidate_id},
            {"$push": {"interview_scorecards": {**card, "scorecard_id": scorecard_id}}},
        )


async def file_link_scorecard(db, candidate: dict, link: dict, *, fields: dict) -> dict:
    cards = candidate.get("interview_scorecards") or []
    scorecard_id = link.get("scorecard_id")
    existing = next((c for c in cards if scorecard_id and c.get("scorecard_id") == scorecard_id), None)
    card = build_scorecard(
        source="link",
        submitted_by=None,
        interviewer_name=fields.get("interviewer_name"),
        interviewer_role=fields.get("interviewer_role"),
        questions=fields.get("questions"),
        ratings=fields.get("ratings"),
        recommendation=fields.get("recommendation"),
        summary=fields.get("summary"),
        strengths=fields.get("strengths"),
        concerns=fields.get("concerns"),
        guide=candidate.get("interview_guide"),
        existing=existing,
    )
    if scorecard_id:
        card["scorecard_id"] = scorecard_id
    await upsert_link_scorecard(db, link, card)
    built = await rebuild_review_and_report(db, candidate["candidate_id"])
    return {"scorecard": card, "rebuilt": built is not None}
