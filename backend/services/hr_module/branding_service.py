"""Branding service — hr_module Admin Configuration (MVP2 §2.20 slice:
Branding/White-Labeling).

SINGLETON `branding_settings` document, looked up by a fixed `_id` of the
literal string "singleton" — same pattern as
`services.hr_module.company_settings_service` (there is never more than one
document, so GET/PATCH always target the same row with no id to look up or
generate). On a fresh install, the first GET upserts sensible defaults into
existence rather than 404ing.

Defaults are chosen to exactly match this app's shipped orange/amber theme
(see frontend `src/index.css`'s `:root` block: `--primary: #fca311;` /
`--secondary: #14213d;`), so an install that has never touched branding
renders pixel-identical to today. `company_logo_url` defaults to an empty
string (no default-hosted logo asset exists to point at) — the frontend
falls back to its built-in SVG mark whenever this is unset.

No index is added for `branding_settings` in `config/database.py`: every
lookup here is by the fixed `_id` "singleton", and MongoDB always maintains
a unique index on `_id` for every collection by default — an explicit
`create_index` call would be redundant. `company_settings_service.py`
established this same no-extra-index precedent for the same reason.
"""
import logging
import re
from datetime import datetime, timezone

from config.database import get_db
from shared.utils import mongo_doc

logger = logging.getLogger(__name__)

SINGLETON_ID = "singleton"

DEFAULT_PRIMARY_COLOR = "#fca311"
DEFAULT_ACCENT_COLOR = "#14213d"

_EDITABLE_FIELDS = ("company_logo_url", "primary_color", "accent_color")
_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def _default_doc() -> dict:
    now = datetime.now(timezone.utc).isoformat()
    return {
        "_id": SINGLETON_ID,
        "company_logo_url": "",
        "primary_color": DEFAULT_PRIMARY_COLOR,
        "accent_color": DEFAULT_ACCENT_COLOR,
        "created_at": now,
        "updated_at": now,
    }


async def get_branding_settings() -> dict:
    """Fetch the singleton branding document, upserting defaults into
    existence on first call so a fresh install never 404s."""
    db = get_db()
    if db is None:
        logger.warning("get_branding_settings: database unavailable, returning in-memory defaults")
        return mongo_doc(_default_doc())

    doc = await db.branding_settings.find_one({"_id": SINGLETON_ID})
    if doc is not None:
        return mongo_doc(doc)

    fresh = _default_doc()
    try:
        await db.branding_settings.insert_one(dict(fresh))
    except Exception as exc:
        logger.info("branding_settings singleton insert race, re-reading: %s", exc)
        existing = await db.branding_settings.find_one({"_id": SINGLETON_ID})
        if existing is not None:
            return mongo_doc(existing)
    return mongo_doc(fresh)


async def get_public_branding() -> dict:
    """Unauthenticated-safe subset for GET /branding/public. Identical to
    get_branding_settings() today (every editable field here is already
    meant to be public: a logo URL and two theme colors), but kept as its
    own function so the public route has an explicit, intentional contract
    rather than accidentally leaking a future admin-only field (e.g. an
    internal notes column) added to the singleton doc down the line."""
    doc = await get_branding_settings()
    return {
        "company_logo_url": doc.get("company_logo_url") or "",
        "primary_color": doc.get("primary_color") or DEFAULT_PRIMARY_COLOR,
        "accent_color": doc.get("accent_color") or DEFAULT_ACCENT_COLOR,
    }


def _validate_updates(updates: dict) -> dict:
    """Whitelists editable fields and validates hex-color format. Raises
    ValueError on an invalid color so the route can 400 instead of
    persisting a value that would silently break the whole app's theme."""
    clean = {k: v for k, v in updates.items() if k in _EDITABLE_FIELDS and v is not None}
    for field in ("primary_color", "accent_color"):
        if field in clean and clean[field] != "" and not _HEX_COLOR_RE.match(clean[field]):
            raise ValueError(f"{field} must be a 6-digit hex color, e.g. #fca311")
    return clean


async def update_branding_settings(updates: dict, updated_by: str | None = None) -> dict:
    """Patch the singleton document (creating it first with defaults if it
    doesn't exist yet), applying only the whitelisted, explicitly-provided,
    validated fields."""
    clean = _validate_updates(updates)

    db = get_db()
    if db is None:
        logger.warning("update_branding_settings: database unavailable, update not persisted")
        merged = _default_doc()
        merged.update(clean)
        return mongo_doc(merged)

    await get_branding_settings()

    clean["updated_at"] = datetime.now(timezone.utc).isoformat()
    if updated_by:
        clean["updated_by"] = updated_by

    await db.branding_settings.update_one({"_id": SINGLETON_ID}, {"$set": clean}, upsert=True)
    doc = await db.branding_settings.find_one({"_id": SINGLETON_ID})
    return mongo_doc(doc) if doc is not None else mongo_doc(_default_doc())
