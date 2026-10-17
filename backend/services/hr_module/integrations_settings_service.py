from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from urllib.parse import urlsplit

from config.database import get_db
from config.settings import settings
from config.tenancy import DEFAULT_COMPANY_ID, current_company_id
from shared import secrets
from shared.safe_http import UnsafeTarget, resolve_public

logger = logging.getLogger(__name__)

SINGLETON_ID = "singleton"
NAMES = ("hrms", "zoom", "teams")

SPECS: dict[str, tuple[tuple[str, ...], str]] = {
    "hrms": (("url", "auth_header", "auto_push_on_hire"), "auth_token"),
    "zoom": (("account_id", "client_id"), "client_secret"),
    "teams": (("tenant_id", "client_id", "organizer"), "client_secret"),
}

MAX_URL_CHARS = 2048
MAX_SECRET_CHARS = 2048

_HEADER_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9-]{0,63}$")
_FORBIDDEN_HEADERS = frozenset({
    "host", "content-length", "content-type", "transfer-encoding", "connection", "upgrade", "te", "trailer", "expect",
})
_PATTERNS = {
    ("zoom", "account_id"): (re.compile(r"^[A-Za-z0-9_.-]{1,128}$"), "The Zoom account ID"),
    ("zoom", "client_id"): (re.compile(r"^[A-Za-z0-9_.-]{1,128}$"), "The Zoom client ID"),
    ("teams", "tenant_id"): (re.compile(r"^[A-Za-z0-9.-]{3,128}$"), "The Microsoft tenant ID"),
    ("teams", "client_id"): (re.compile(r"^[A-Za-z0-9._-]{8,128}$"), "The Microsoft application ID"),
    ("teams", "organizer"): (re.compile(r"^[A-Za-z0-9._@+-]{3,254}$"), "The organizer"),
}


class IntegrationSettingsError(ValueError):
    pass


def _environment(name: str) -> dict:
    if name == "hrms":
        return {
            "url": settings.HRMS_WEBHOOK_URL, "auth_header": settings.HRMS_AUTH_HEADER,
            "auth_token": settings.HRMS_AUTH_TOKEN, "auto_push_on_hire": bool(settings.HRMS_AUTO_PUSH_ON_HIRE),
        }
    if name == "zoom":
        return {
            "account_id": settings.ZOOM_ACCOUNT_ID, "client_id": settings.ZOOM_CLIENT_ID,
            "client_secret": settings.ZOOM_CLIENT_SECRET,
        }
    return {
        "tenant_id": settings.MS_TEAMS_TENANT_ID, "client_id": settings.MS_TEAMS_CLIENT_ID,
        "client_secret": settings.MS_TEAMS_CLIENT_SECRET, "organizer": settings.MS_TEAMS_ORGANIZER_USER_ID,
    }


def is_default_company() -> bool:
    return current_company_id() == DEFAULT_COMPANY_ID


def is_complete(name: str, config: dict | None) -> bool:
    config = config or {}
    if name == "hrms":
        return bool(config.get("url"))
    needed = ("account_id", "client_id", "client_secret") if name == "zoom" else (
        "tenant_id", "client_id", "client_secret", "organizer",
    )
    return all(config.get(key) for key in needed)


def environment_config(name: str) -> dict | None:
    if not is_default_company():
        return None
    config = _environment(name)
    return config if is_complete(name, config) else None


async def _load_stored(name: str) -> dict:
    db = get_db()
    if db is None:
        return {}
    row = await db.company_settings.find_one({"_id": SINGLETON_ID}, {"integrations": 1})
    stored = ((row or {}).get("integrations") or {}).get(name)
    return dict(stored) if isinstance(stored, dict) else {}


def _plain(name: str, stored: dict) -> dict:
    fields, secret = SPECS[name]
    out = {key: stored.get(key) for key in fields}
    if "auto_push_on_hire" in out:
        out["auto_push_on_hire"] = bool(out["auto_push_on_hire"])
    out[secret] = secrets.decrypt(stored.get(secret)) or ""
    return out


def _resolve(name: str, stored: dict) -> tuple[dict | None, str | None]:
    own = _plain(name, stored)
    if is_complete(name, own):
        return own, "company"
    env = environment_config(name)
    return (env, "platform") if env else (None, None)


async def runtime_config(name: str) -> dict | None:
    if name not in NAMES:
        return None
    return _resolve(name, await _load_stored(name))[0]


async def source(name: str) -> str | None:
    if name not in NAMES:
        return None
    return _resolve(name, await _load_stored(name))[1]


async def hrms_auto_push() -> bool:
    config = await runtime_config("hrms")
    return bool(config and config.get("auto_push_on_hire"))


async def get_view(name: str) -> dict:
    fields, secret = SPECS[name]
    stored = await _load_stored(name)
    out: dict = {"name": name}
    for key in fields:
        out[key] = bool(stored.get(key)) if key == "auto_push_on_hire" else (stored.get(key) or "")
    out[f"has_{secret}"] = secrets.decrypt(stored.get(secret)) is not None
    config, origin = _resolve(name, stored)
    out["configured"] = config is not None
    out["source"] = origin
    out["updated_at"] = stored.get("updated_at")
    out["updated_by"] = stored.get("updated_by")
    return out


async def get_all_views() -> dict:
    return {name: await get_view(name) for name in NAMES}


def _line(value, label: str, max_chars: int) -> str:
    text = "" if value is None else str(value)
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in text):
        raise IntegrationSettingsError(f"{label} must be a single line of text.")
    text = text.strip()
    if len(text) > max_chars:
        raise IntegrationSettingsError(f"{label} must be at most {max_chars} characters.")
    return text


async def clean_hrms_url(value) -> str:
    text = _line(value, "The HRMS address", MAX_URL_CHARS)
    if not text:
        return ""
    if any(ch.isspace() for ch in text):
        raise IntegrationSettingsError("Enter a valid web address.")
    try:
        parts = urlsplit(text)
        port = parts.port
    except ValueError:
        raise IntegrationSettingsError("Enter a valid web address.")
    if parts.scheme.lower() != "https":
        raise IntegrationSettingsError("The HRMS address must start with https://.")
    if not parts.hostname:
        raise IntegrationSettingsError("Enter a valid web address.")
    if parts.username or parts.password:
        raise IntegrationSettingsError("The HRMS address cannot contain a user name or password.")
    try:
        await resolve_public(parts.hostname, port or 443)
    except UnsafeTarget:
        raise IntegrationSettingsError("The HRMS address must be a public website that can be reached.")
    return text


def _clean_field(name: str, key: str, value) -> str:
    if name == "hrms" and key == "auth_header":
        text = _line(value, "The header name", 64)
        if text and (not _HEADER_NAME.match(text) or text.lower() in _FORBIDDEN_HEADERS):
            raise IntegrationSettingsError("Enter a valid header name, for example Authorization.")
        return text
    pattern, label = _PATTERNS[(name, key)]
    text = _line(value, label, 254)
    if text and not pattern.match(text):
        raise IntegrationSettingsError(f"{label} is not in the expected format.")
    return text


def _clean_secret(value, label: str) -> str:
    text = "" if value is None else str(value)
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in text):
        raise IntegrationSettingsError(f"{label} cannot contain line breaks or control characters.")
    if len(text) > MAX_SECRET_CHARS:
        raise IntegrationSettingsError(f"{label} must be at most {MAX_SECRET_CHARS} characters.")
    return text.strip()


_SECRET_LABELS = {"auth_token": "The token", "client_secret": "The client secret"}


async def merge_changes(name: str, existing: dict, changes: dict) -> dict:
    if name not in NAMES:
        raise IntegrationSettingsError("That integration does not exist.")
    fields, secret = SPECS[name]
    merged = dict(existing)
    for key in fields:
        if key not in changes or changes[key] is None:
            continue
        if key == "auto_push_on_hire":
            merged[key] = bool(changes[key])
        elif name == "hrms" and key == "url":
            merged[key] = await clean_hrms_url(changes[key])
        else:
            merged[key] = _clean_field(name, key, changes[key])
    if changes.get("clear_secret"):
        merged[secret] = ""
    new_secret = _clean_secret(changes.get(secret), _SECRET_LABELS[secret]) if changes.get(secret) else ""
    if new_secret:
        merged[secret] = secrets.encrypt(new_secret)
    return merged


async def save(name: str, changes: dict, *, updated_by: str | None = None) -> tuple[dict, dict]:
    if name not in NAMES:
        raise IntegrationSettingsError("That integration does not exist.")
    db = get_db()
    if db is None:
        raise IntegrationSettingsError("The database is unavailable. Try again shortly.")
    fields, secret = SPECS[name]
    merged = await merge_changes(name, await _load_stored(name), changes)
    merged["updated_at"] = datetime.now(timezone.utc).isoformat()
    if updated_by:
        merged["updated_by"] = updated_by

    from services.hr_module.company_settings_service import get_company_settings

    await get_company_settings()
    await db.company_settings.update_one(
        {"_id": SINGLETON_ID}, {"$set": {f"integrations.{name}": merged}}, upsert=True,
    )
    summary = {
        "integration": name,
        "fields": sorted(key for key in fields if key in changes and changes[key] is not None),
        "secret_changed": bool(changes.get(secret)) or bool(changes.get("clear_secret")),
        "configured": is_complete(name, _plain(name, merged)),
    }
    return await get_view(name), summary
