import hashlib
import re
import secrets
import unicodedata
from datetime import datetime, timedelta, timezone


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def new_secure_token() -> str:
    return f"tok_{secrets.token_hex(16)}"


def slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    text = re.sub(r"[^\w\s-]", "", text).strip().lower()
    return re.sub(r"[-\s]+", "-", text)


def truncate(text: str, max_chars: int = 500) -> str:
    return text[:max_chars] + "…" if len(text) > max_chars else text


def mongo_doc(doc: dict) -> dict:
    doc.pop("_id", None)
    doc.pop("embedding", None)
    return doc


def compute_invite_expiry(*, sent_at: str | None, regenerated_at: str | None, days: int) -> str:
    base = regenerated_at or sent_at or datetime.now(timezone.utc).isoformat()
    base_dt = datetime.fromisoformat(base)
    if base_dt.tzinfo is None:
        base_dt = base_dt.replace(tzinfo=timezone.utc)
    return (base_dt + timedelta(days=days)).isoformat()


def is_invite_expired(candidate: dict, *, days: int) -> bool:
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


EM_DASH = chr(0x2014)
_EM_DASH_ENTITIES = ("-", "-", "-")
_SPACED_EM_DASH = re.compile(r"[ \t]+" + EM_DASH + r"[ \t]*|" + EM_DASH + r"[ \t]+")


def strip_em_dashes(text):
    if not isinstance(text, str) or (EM_DASH not in text and not any(e in text for e in _EM_DASH_ENTITIES)):
        return text
    for entity in _EM_DASH_ENTITIES:
        text = text.replace(entity, EM_DASH)
    text = re.sub(r"(^|\n)([ \t]*)" + EM_DASH + r"[ \t]+(?=\S)", r"\1\2- ", text)
    text = re.sub(r"[ \t]+" + EM_DASH + r"[ \t]*(?=\n|$)", ",", text)
    text = _SPACED_EM_DASH.sub(", ", text)
    return text.replace(EM_DASH, "-")


def require_selectable_model(model):
    from fastapi import HTTPException

    from config.llm import SELECTABLE_MODEL_IDS

    if model is None or not str(model).strip():
        return None
    if model not in SELECTABLE_MODEL_IDS:
        raise HTTPException(400, f"Unknown model. Choose one of: {', '.join(SELECTABLE_MODEL_IDS)}")
    return model
