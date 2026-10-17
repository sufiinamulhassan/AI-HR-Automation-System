from __future__ import annotations

import logging
from datetime import datetime, timezone

from config.database import get_platform_db
from config.tenancy import PLATFORM_COMPANY_ID, db_for_company
from services.hr_module import plan_service
from services.hr_module.audit_service import log_audit_event

logger = logging.getLogger(__name__)

SUSPENDED_MESSAGE = "This workspace is suspended. Contact your administrator."


async def load_company(company_id: str | None) -> dict | None:
    if not company_id:
        return None
    raw = get_platform_db()
    if raw is None:
        return None
    rows = await raw.companies.aggregate([
        {"$match": {"company_id": company_id}},
        {"$limit": 1},
        {"$lookup": {"from": "clients", "localField": "client_id", "foreignField": "client_id", "as": "_client"}},
    ]).to_list(length=1)
    if not rows:
        return None
    company = rows[0]
    client = (company.pop("_client", None) or [{}])[0]
    company.pop("_id", None)
    company["client_name"] = client.get("name") or ""
    company["client_status"] = client.get("status") or "active"
    company["client_plan"] = client.get("plan") or {}
    company["client_subscription"] = client.get("subscription") or {}
    company.setdefault("settings", {})
    return company


def blocked_reason(company: dict | None, now: datetime | None = None) -> str | None:
    if company is None:
        return "This account is not attached to a workspace. Contact your administrator."
    if company.get("status", "active") != "active" or company.get("client_status", "active") != "active":
        return SUSPENDED_MESSAGE
    if company.get("kind") == "platform":
        return None
    return plan_service.subscription_block_reason(
        company.get("client_plan"), company.get("client_subscription"), now,
    )


async def list_active_companies() -> list[dict]:
    raw = get_platform_db()
    if raw is None:
        return []
    now = datetime.now(timezone.utc)
    inactive = {
        c["client_id"]
        async for c in raw.clients.find(
            {}, {"client_id": 1, "status": 1, "plan.trial_ends_at": 1, "subscription.status": 1},
        )
        if c.get("status", "active") != "active"
        or plan_service.subscription_block_reason(c.get("plan"), c.get("subscription"), now)
    }
    return [
        {k: v for k, v in c.items() if k != "_id"}
        async for c in raw.companies.find(
            {"status": "active", "kind": {"$ne": "platform"}, "client_id": {"$nin": list(inactive)}},
        ).sort("created_at", 1)
    ]


def public_company(company: dict) -> dict:
    return {
        "company_id": company.get("company_id"),
        "company_name": company.get("name") or "",
        "client_id": company.get("client_id"),
        "client_name": company.get("client_name") or "",
        "workspace_kind": company.get("kind") or "workspace",
    }


async def platform_audit(
    actor: dict, action: str, resource_type: str, resource_id: str | None = None, details: dict | None = None,
    *, also_company: str | None = None, actor_role: str = "platform_owner",
) -> None:
    raw = get_platform_db()
    if raw is None:
        return
    fields = dict(
        actor_email=actor.get("email"), actor_role=actor_role,
        action=action, resource_type=resource_type, resource_id=resource_id, details=details or {},
    )
    await log_audit_event(db_for_company(raw, PLATFORM_COMPANY_ID), **fields)
    if also_company and also_company != PLATFORM_COMPANY_ID:
        await log_audit_event(db_for_company(raw, also_company), **fields)
    await bump_console_cache(raw)


CACHE_EPOCH_ID = "usage_cache_epoch"


async def bump_console_cache(raw=None) -> None:
    try:
        raw = raw if raw is not None else get_platform_db()
        if raw is None:
            return
        await raw.settings.update_one(
            {"_id": CACHE_EPOCH_ID}, {"$inc": {"value": 1}, "$set": {"key": CACHE_EPOCH_ID}}, upsert=True,
        )
    except Exception as exc:
        logger.warning("Console cache not invalidated | error=%s", type(exc).__name__)


async def company_for_email_domain(email: str, *, legacy_domains: set[str] | None = None) -> dict | None:
    from config.tenancy import DEFAULT_COMPANY_ID

    domain = (email or "").rpartition("@")[2].strip().lower()
    raw = get_platform_db()
    if not domain or raw is None:
        return None
    claimed = await raw.companies.find_one(
        {"sso_domains": domain, "status": "active", "kind": {"$ne": "platform"}}, {"company_id": 1},
    )
    company_id = claimed["company_id"] if claimed else (DEFAULT_COMPANY_ID if domain in (legacy_domains or set()) else None)
    company = await load_company(company_id)
    return None if blocked_reason(company) else company


CRON_RUN_KEY_PREFIX = "cron_"


async def companies_due(job_key: str) -> list[dict]:
    companies = await list_active_companies()
    return sorted(companies, key=lambda c: str((c.get("cron") or {}).get(job_key) or ""))


async def mark_company_served(company_id: str, job_key: str, at: str | None = None) -> None:
    raw = get_platform_db()
    if raw is None:
        return
    stamp = at or datetime.now(timezone.utc).isoformat()
    await raw.companies.update_one({"company_id": company_id}, {"$set": {f"cron.{job_key}": stamp}})


async def save_task_model(company_id: str, task: str, model: str | None) -> None:
    raw = get_platform_db()
    if raw is None:
        return
    path = f"settings.task_models.{task}"
    change = {"$set": {path: model}} if model else {"$unset": {path: ""}}
    await raw.companies.update_one({"company_id": company_id}, change)


async def record_platform_cron_run(job_key: str, run: dict) -> None:
    raw = get_platform_db()
    if raw is None:
        return
    key = f"{CRON_RUN_KEY_PREFIX}{job_key}"
    await raw.settings.update_one({"key": key}, {"$set": {"key": key, **run}}, upsert=True)


async def platform_cron_status() -> list[dict]:
    raw = get_platform_db()
    if raw is None:
        return []
    return [
        {k: v for k, v in doc.items() if k != "_id"}
        async for doc in raw.settings.find({"key": {"$regex": f"^{CRON_RUN_KEY_PREFIX}"}}).sort("key", 1)
    ]


async def domain_claimed_by_other(email: str, company_id: str | None) -> bool:
    domain = (email or "").rpartition("@")[2].strip().lower()
    raw = get_platform_db()
    if not domain or raw is None:
        return False
    claimant = await raw.companies.find_one({"sso_domains": domain}, {"company_id": 1})
    return bool(claimant) and claimant.get("company_id") != company_id


async def adjust_storage_bytes(company_id: str, delta: int) -> None:
    raw = get_platform_db()
    if raw is None or not company_id or not delta:
        return
    await raw.companies.update_one(
        {"company_id": company_id},
        [{"$set": {"usage.storage_bytes": {"$max": [0, {"$add": [{"$ifNull": ["$usage.storage_bytes", 0]}, int(delta)]}]}}}],
    )
