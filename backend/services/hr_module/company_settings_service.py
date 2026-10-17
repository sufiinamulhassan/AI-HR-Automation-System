import logging
from datetime import datetime, timezone
from urllib.parse import urlsplit

from config.database import get_db
from config.settings import sandbox_provider, settings
from config.tenancy import current_company
from shared.utils import mongo_doc

logger = logging.getLogger(__name__)

SINGLETON_ID = "singleton"

_EDITABLE_FIELDS = (
    "company_name", "industry", "size", "website", "address", "primary_contact_email",
    "terms_url", "privacy_url",
)

_LEGAL_LINK_FIELDS = {"terms_url": "The terms link", "privacy_url": "The privacy link"}
MAX_LEGAL_URL_CHARS = 300

_PRIVATE_SECTIONS = ("mail", "integrations", "sso")


def clean_legal_url(value, label: str = "The link") -> str:
    text = "" if value is None else str(value).strip()
    if not text:
        return ""
    if len(text) > MAX_LEGAL_URL_CHARS:
        raise ValueError(f"{label} must be at most {MAX_LEGAL_URL_CHARS} characters.")
    if any(ch.isspace() or ord(ch) < 32 or ord(ch) == 127 for ch in text):
        raise ValueError(f"{label} must be a web address starting with https://.")
    try:
        parts = urlsplit(text)
        parts.port
    except ValueError:
        raise ValueError(f"{label} must be a web address starting with https://.")
    if parts.scheme.lower() != "https" or not parts.hostname or parts.username or parts.password:
        raise ValueError(f"{label} must be a web address starting with https://.")
    return text


def _public_view(doc: dict) -> dict:
    for key in _PRIVATE_SECTIONS:
        doc.pop(key, None)
    for field in _EDITABLE_FIELDS:
        doc.setdefault(field, "")
    return doc


def _default_doc() -> dict:
    now = datetime.now(timezone.utc).isoformat()
    doc = {"_id": SINGLETON_ID, "created_at": now, "updated_at": now}
    doc.update({field: "" for field in _EDITABLE_FIELDS})
    return doc


async def get_company_settings() -> dict:
    db = get_db()
    if db is None:
        logger.warning("get_company_settings: database unavailable, returning in-memory defaults")
        return _public_view(mongo_doc(_default_doc()))

    doc = await db.company_settings.find_one({"_id": SINGLETON_ID})
    if doc is not None:
        return _public_view(mongo_doc(doc))

    fresh = _default_doc()
    try:
        await db.company_settings.insert_one(dict(fresh))
    except Exception as exc:
        logger.info("company_settings singleton insert race, re-reading: %s", exc)
        existing = await db.company_settings.find_one({"_id": SINGLETON_ID})
        if existing is not None:
            return _public_view(mongo_doc(existing))
    return _public_view(mongo_doc(fresh))


async def organization_name() -> str:
    db = get_db()
    stored = (await db.company_settings.find_one({"_id": SINGLETON_ID}, {"company_name": 1}) or {}) if db is not None else {}
    return " ".join(str(stored.get("company_name") or "").split())


async def display_name() -> str:
    return await organization_name() or str(current_company().get("name") or "").strip()


async def update_company_settings(updates: dict, updated_by: str | None = None) -> dict:
    clean = {k: v for k, v in updates.items() if k in _EDITABLE_FIELDS and v is not None}
    for field, label in _LEGAL_LINK_FIELDS.items():
        if field in clean:
            clean[field] = clean_legal_url(clean[field], label)

    db = get_db()
    if db is None:
        logger.warning("update_company_settings: database unavailable, update not persisted")
        merged = _default_doc()
        merged.update(clean)
        return _public_view(mongo_doc(merged))

    await get_company_settings()

    clean["updated_at"] = datetime.now(timezone.utc).isoformat()
    if updated_by:
        clean["updated_by"] = updated_by

    await db.company_settings.update_one({"_id": SINGLETON_ID}, {"$set": clean}, upsert=True)
    doc = await db.company_settings.find_one({"_id": SINGLETON_ID})
    return _public_view(mongo_doc(doc) if doc is not None else mongo_doc(_default_doc()))


def _google_oauth_configured() -> bool:
    return bool(
        settings.GOOGLE_OAUTH_CLIENT_ID
        and settings.GOOGLE_OAUTH_CLIENT_SECRET
        and settings.GOOGLE_OAUTH_REDIRECT_URI
    )


def _core_integrations() -> list[dict]:
    active_sandbox = sandbox_provider()
    return [
        {"id": "openai", "label": "OpenAI", "configured": bool(settings.OPENAI_API_KEY)},
        {"id": "anthropic", "label": "Anthropic", "configured": bool(settings.ANTHROPIC_API_KEY)},
        {"id": "pinecone", "label": "Pinecone", "configured": bool(settings.PINECONE_API_KEY)},
        {
            "id": "judge0", "label": "Judge0 (Coding Assessment)",
            "configured": active_sandbox == "judge0" and bool(settings.JUDGE0_API_URL),
            "active": active_sandbox == "judge0",
        },
        {
            "id": "piston", "label": "Piston (Coding Assessment)",
            "configured": active_sandbox == "piston" and bool(settings.PISTON_API_URL),
            "active": active_sandbox == "piston",
        },
        {"id": "google_oauth_sso", "label": "Google OAuth SSO", "configured": _google_oauth_configured()},
        {"id": "webhook_signing", "label": "Webhook Signing", "configured": bool(settings.WEBHOOK_SIGNING_SECRET)},
        {
            "id": "smtp_email", "label": "SMTP Email",
            "configured": bool(settings.AWS_SES_ENABLED) or bool(settings.EMAIL_HOST),
        },
    ]


async def get_integrations_status() -> dict:
    from services.hr_module.job_sources import list_sources

    return {
        "core": _core_integrations(),
        "job_sources": list_sources(),
    }
