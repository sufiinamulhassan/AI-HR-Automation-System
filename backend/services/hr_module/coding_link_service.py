from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from config.settings import settings
from shared.utils import compute_invite_expiry

EXPIRED_MESSAGE = "This assessment link has expired. Ask your recruiter for a new one."

EXPIRY_FIELDS = (
    "coding_invite_expires_at", "invite_expires_at", "invite_sent_at", "token_regenerated_at", "created_at",
)
EXPIRY_PROJECTION = {name: 1 for name in EXPIRY_FIELDS}


def _parse(value) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment.replace(tzinfo=timezone.utc) if moment.tzinfo is None else moment.astimezone(timezone.utc)


def coding_expiry_stamp(now: datetime | None = None) -> str:
    moment = now or datetime.now(timezone.utc)
    return (moment + timedelta(days=settings.INVITE_LINK_EXPIRY_DAYS)).isoformat()


def interview_link_expiry(cand: dict) -> datetime | None:
    stored = _parse(cand.get("invite_expires_at"))
    if stored is not None:
        return stored
    try:
        computed = compute_invite_expiry(
            sent_at=cand.get("invite_sent_at") or cand.get("created_at"),
            regenerated_at=cand.get("token_regenerated_at"),
            days=settings.INVITE_LINK_EXPIRY_DAYS,
        )
    except (TypeError, ValueError):
        return None
    return _parse(computed)


def coding_link_expires_at(cand: dict) -> datetime | None:
    own = _parse(cand.get("coding_invite_expires_at"))
    if own is not None:
        return own
    interview = interview_link_expiry(cand)
    if interview is None:
        return None
    return interview + timedelta(days=settings.CODING_LINK_GRACE_DAYS)


def coding_link_expired(cand: dict, now: datetime | None = None) -> bool:
    expires = coding_link_expires_at(cand or {})
    if expires is None:
        return False
    return (now or datetime.now(timezone.utc)) > expires


def require_live_coding_link(cand: dict) -> None:
    if coding_link_expired(cand):
        raise HTTPException(410, EXPIRED_MESSAGE)
