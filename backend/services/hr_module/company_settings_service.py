"""Company Settings service — hr_module Admin Configuration (MVP2 §2.20 slice).

Two responsibilities:

1. A SINGLETON company-profile document (`company_settings` collection),
   looked up by a fixed `_id` of the literal string "singleton" — there is
   never more than one document, so GET/PATCH always target the same row
   with no id to look up or generate. On a fresh install, the first GET
   upserts sensible blank defaults into existence rather than 404ing, so the
   Company Settings admin page always has something to render/edit.

2. A read-only "integrations status" aggregation across every external
   dependency configured in `config/settings.py`, reporting only booleans
   (never the underlying secret values) — the same honest-disclosure pattern
   `services.hr_module.job_sources.list_sources()` already established for
   job boards, extended to cover OpenAI, Pinecone, Judge0, Google OAuth SSO,
   webhook signing, and SMTP email. Job-board entries are read directly from
   `list_sources()` (not duplicated) so the two never drift out of sync.
"""
import logging
from datetime import datetime, timezone

from config.database import get_db
from config.settings import sandbox_provider, settings
from shared.utils import mongo_doc

logger = logging.getLogger(__name__)

SINGLETON_ID = "singleton"

_EDITABLE_FIELDS = (
    "company_name", "industry", "size", "website", "address", "primary_contact_email",
)


def _default_doc() -> dict:
    now = datetime.now(timezone.utc).isoformat()
    doc = {"_id": SINGLETON_ID, "created_at": now, "updated_at": now}
    doc.update({field: "" for field in _EDITABLE_FIELDS})
    return doc


async def get_company_settings() -> dict:
    """Fetch the singleton company-profile document, upserting blank defaults
    into existence on first call so a fresh install never 404s."""
    db = get_db()
    if db is None:
        logger.warning("get_company_settings: database unavailable, returning in-memory defaults")
        return mongo_doc(_default_doc())

    doc = await db.company_settings.find_one({"_id": SINGLETON_ID})
    if doc is not None:
        return mongo_doc(doc)

    fresh = _default_doc()
    try:
        await db.company_settings.insert_one(dict(fresh))
    except Exception as exc:
        logger.info("company_settings singleton insert race, re-reading: %s", exc)
        existing = await db.company_settings.find_one({"_id": SINGLETON_ID})
        if existing is not None:
            return mongo_doc(existing)
    return mongo_doc(fresh)


async def update_company_settings(updates: dict, updated_by: str | None = None) -> dict:
    """Patch the singleton document (creating it first with defaults if it
    doesn't exist yet), applying only the whitelisted, explicitly-provided
    fields."""
    clean = {k: v for k, v in updates.items() if k in _EDITABLE_FIELDS and v is not None}

    db = get_db()
    if db is None:
        logger.warning("update_company_settings: database unavailable, update not persisted")
        merged = _default_doc()
        merged.update(clean)
        return mongo_doc(merged)

    await get_company_settings()

    clean["updated_at"] = datetime.now(timezone.utc).isoformat()
    if updated_by:
        clean["updated_by"] = updated_by

    await db.company_settings.update_one({"_id": SINGLETON_ID}, {"$set": clean}, upsert=True)
    doc = await db.company_settings.find_one({"_id": SINGLETON_ID})
    return mongo_doc(doc) if doc is not None else mongo_doc(_default_doc())


def _google_oauth_configured() -> bool:
    return bool(
        settings.GOOGLE_OAUTH_CLIENT_ID
        and settings.GOOGLE_OAUTH_CLIENT_SECRET
        and settings.GOOGLE_OAUTH_REDIRECT_URI
    )


def _core_integrations() -> list[dict]:
    """Booleans-only status for every non-job-board external dependency in
    config/settings.py. Never includes the actual key/secret values."""
    return [
        {"id": "openai", "label": "OpenAI", "configured": bool(settings.OPENAI_API_KEY)},
        {"id": "pinecone", "label": "Pinecone", "configured": bool(settings.PINECONE_API_KEY)},
        {
            "id": "judge0", "label": "Judge0 (Coding Assessment)",
            "configured": bool(settings.JUDGE0_API_URL),
            "active": sandbox_provider() == "judge0",
        },
        {
            "id": "piston", "label": "Piston (Coding Assessment)",
            "configured": bool(settings.PISTON_API_URL),
            "active": sandbox_provider() == "piston",
        },
        {"id": "google_oauth_sso", "label": "Google OAuth SSO", "configured": _google_oauth_configured()},
        {"id": "webhook_signing", "label": "Webhook Signing", "configured": bool(settings.WEBHOOK_SIGNING_SECRET)},
        {"id": "smtp_email", "label": "SMTP Email", "configured": bool(settings.EMAIL_HOST)},
    ]


async def get_integrations_status() -> dict:
    """Read-only configured/not-configured status for every external
    dependency: the 6 core integrations above, plus every job-board source
    from `job_sources.list_sources()` (reused directly, not duplicated)."""
    from services.hr_module.job_sources import list_sources

    return {
        "core": _core_integrations(),
        "job_sources": list_sources(),
    }
