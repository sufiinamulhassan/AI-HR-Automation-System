"""Shared utility functions."""
import hashlib
import re
import unicodedata
from datetime import datetime, timedelta, timezone


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    text = re.sub(r"[^\w\s-]", "", text).strip().lower()
    return re.sub(r"[-\s]+", "-", text)


def truncate(text: str, max_chars: int = 500) -> str:
    return text[:max_chars] + "…" if len(text) > max_chars else text


def mongo_doc(doc: dict) -> dict:
    """Strip MongoDB internal fields."""
    doc.pop("_id", None)
    doc.pop("embedding", None)
    return doc


def compute_invite_expiry(*, sent_at: str | None, regenerated_at: str | None, days: int) -> str:
    """Expiry timestamp (ISO string), `days` after whichever came later —
    invite creation or the most recent token regeneration."""
    base = regenerated_at or sent_at or datetime.now(timezone.utc).isoformat()
    base_dt = datetime.fromisoformat(base)
    if base_dt.tzinfo is None:
        base_dt = base_dt.replace(tzinfo=timezone.utc)
    return (base_dt + timedelta(days=days)).isoformat()


def is_invite_expired(candidate: dict, *, days: int) -> bool:
    """True if the candidate's interview link has passed its expiry.

    Uses the stored `invite_expires_at` when present; candidate documents
    created before this field existed fall back to computing it from
    `token_regenerated_at`/`invite_sent_at`/`created_at` so expiry applies
    retroactively without a backfill migration.
    """
    expires_at = candidate.get("invite_expires_at") or compute_invite_expiry(
        sent_at=candidate.get("invite_sent_at") or candidate.get("created_at"),
        regenerated_at=candidate.get("token_regenerated_at"),
        days=days,
    )
    try:
        expires_dt = datetime.fromisoformat(expires_at)
        if expires_dt.tzinfo is None:
            expires_dt = expires_dt.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return False
    return datetime.now(timezone.utc) > expires_dt
