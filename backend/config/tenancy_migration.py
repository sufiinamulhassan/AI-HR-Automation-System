from __future__ import annotations

import logging
from datetime import datetime, timezone

from config.tenancy import (
    DEFAULT_CLIENT_ID,
    DEFAULT_COMPANY_ID,
    NAMESPACED_ID,
    PLATFORM_CLIENT_ID,
    PLATFORM_COMPANY_ID,
    PLATFORM_ONLY,
    SHARED_INFRA,
)

logger = logging.getLogger(__name__)

SCHEMA_KEY = "tenancy_schema"
SCHEMA_VERSION = 1

_DEFAULT_PLAN = {"name": "standard", "max_companies": None, "max_users_per_company": None, "monthly_ai_budget_usd": None}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def client_doc(client_id: str, name: str, slug: str, *, kind: str = "workspace") -> dict:
    return {
        "client_id": client_id, "name": name, "slug": slug, "status": "active", "kind": kind,
        "plan": dict(_DEFAULT_PLAN), "contact_name": "", "contact_email": "", "notes": "",
        "created_at": _now(),
    }


def company_doc(company_id: str, client_id: str, name: str, slug: str, *, kind: str = "workspace") -> dict:
    return {
        "company_id": company_id, "client_id": client_id, "name": name, "slug": slug,
        "status": "active", "kind": kind, "settings": {}, "sso_domains": [], "created_at": _now(),
    }


async def _upsert_directory(raw, collection: str, key: str, doc: dict) -> None:
    await raw[collection].update_one({key: doc[key]}, {"$setOnInsert": doc}, upsert=True)


async def ensure_platform_workspace(raw) -> None:
    await _upsert_directory(
        raw, "clients", "client_id",
        client_doc(PLATFORM_CLIENT_ID, "Platform", "platform", kind="platform"),
    )
    await _upsert_directory(
        raw, "companies", "company_id",
        company_doc(PLATFORM_COMPANY_ID, PLATFORM_CLIENT_ID, "Platform Operations", "platform", kind="platform"),
    )


async def ensure_default_workspace(raw, name: str | None = None) -> None:
    label = (name or "").strip() or "Default"
    await _upsert_directory(raw, "clients", "client_id", client_doc(DEFAULT_CLIENT_ID, label, "default"))
    await _upsert_directory(
        raw, "companies", "company_id", company_doc(DEFAULT_COMPANY_ID, DEFAULT_CLIENT_ID, label, "default"),
    )


async def _tenant_collections(raw) -> list[str]:
    skip = PLATFORM_ONLY | SHARED_INFRA
    return [n for n in await raw.list_collection_names() if not n.startswith("system.") and n not in skip]


async def _has_unstamped_data(raw) -> bool:
    for name in await _tenant_collections(raw):
        if await raw[name].find_one({"company_id": {"$exists": False}}, {"_id": 1}) is not None:
            return True
    return False


async def _stamp_all(raw) -> int:
    stamped = 0
    for name in await _tenant_collections(raw):
        result = await raw[name].update_many(
            {"company_id": {"$exists": False}}, {"$set": {"company_id": DEFAULT_COMPANY_ID}},
        )
        stamped += result.modified_count
    return stamped


async def _rekey_namespaced(raw) -> int:
    moved = 0
    for name in NAMESPACED_ID:
        prefix = f"{DEFAULT_COMPANY_ID}:"
        async for doc in raw[name].find({"company_id": DEFAULT_COMPANY_ID}):
            old = doc.get("_id")
            if not isinstance(old, str) or old.startswith("cmp_") and ":" in old:
                continue
            fresh = {**doc, "_id": f"{prefix}{old}"}
            try:
                await raw[name].insert_one(fresh)
            except Exception as exc:
                logger.info("re-key of %s/%s skipped: %s", name, old, exc)
            await raw[name].delete_one({"_id": old})
            moved += 1
    return moved


async def _mark_owner(raw, owner_email: str) -> None:
    if not owner_email:
        return
    await raw.users.update_one(
        {"email": owner_email.lower().strip(), "company_id": DEFAULT_COMPANY_ID},
        {"$set": {"is_platform_admin": True}},
    )


async def migrate(raw, *, owner_email: str = "", force_default_workspace: bool = False) -> dict:
    report = {"already_done": False, "stamped": 0, "rekeyed": 0, "default_workspace": False}
    await ensure_platform_workspace(raw)

    marker = await raw.settings.find_one({"key": SCHEMA_KEY})
    if marker and marker.get("version", 0) >= SCHEMA_VERSION and not force_default_workspace:
        report["already_done"] = True
        return report

    legacy = await _has_unstamped_data(raw)
    if legacy or force_default_workspace:
        company_name = ""
        if legacy:
            settings_doc = await raw.company_settings.find_one({"_id": "singleton"}, {"company_name": 1})
            company_name = (settings_doc or {}).get("company_name") or ""
        await ensure_default_workspace(raw, company_name)
        report["default_workspace"] = True
        report["stamped"] = await _stamp_all(raw)
        report["rekeyed"] = await _rekey_namespaced(raw)
        await _mark_owner(raw, owner_email)

    await raw.settings.update_one(
        {"key": SCHEMA_KEY},
        {"$set": {"version": SCHEMA_VERSION, "migrated_at": _now()}},
        upsert=True,
    )
    logger.info("Tenancy migration complete: %s", report)
    return report
