from __future__ import annotations

from urllib.parse import urlsplit

from config.database import get_platform_db
from config.settings import settings
from config.tenancy import NO_MATCH, bind_company
from services.hr_module.workspace_service import blocked_reason, load_company
from shared.links import valid_hostname
from shared.utils import sha256_hex

TOKEN_KINDS: dict[str, tuple[str, str, bool]] = {
    "candidate": ("candidates", "secure_token", False),
    "offer": ("offers", "secure_token", False),
    "review": ("performance_reviews", "secure_token", False),
    "share": ("report_shares", "token_hash", True),
    "interviewer": ("interviewer_links", "token_hash", True),
    "job": ("jobs", "job_id", False),
}


async def company_id_for_token(kind: str, token: str) -> str | None:
    collection, field, hashed = TOKEN_KINDS[kind]
    raw = get_platform_db()
    if raw is None or not token:
        return None
    value = sha256_hex(token.encode("utf-8")) if hashed else token
    doc = await raw[collection].find_one({field: value}, {"company_id": 1})
    return (doc or {}).get("company_id")


async def bind_company_for_token(kind: str, token: str | None) -> bool:
    company = await load_company(await company_id_for_token(kind, token or ""))
    if blocked_reason(company):
        bind_company(NO_MATCH, {})
        return False
    bind_company(company["company_id"], company)
    return True


async def bind_company_for_slug(slug: str | None) -> bool:
    raw = get_platform_db()
    slug = (slug or "").strip().lower()
    if raw is None or not slug:
        return False
    doc = await raw.companies.find_one({"slug": slug, "kind": {"$ne": "platform"}}, {"company_id": 1})
    company = await load_company((doc or {}).get("company_id"))
    if blocked_reason(company):
        return False
    bind_company(company["company_id"], company)
    return True


async def bind_company_for_id(company_id: str | None) -> bool:
    company = await load_company(company_id) if company_id else None
    if blocked_reason(company) or (company or {}).get("kind") == "platform":
        return False
    bind_company(company["company_id"], company)
    return True


def request_host(request) -> str:
    headers = getattr(request, "headers", None) or {}
    forwarded = str(headers.get("x-forwarded-host") or "").split(",")[0].strip()
    raw = (forwarded or str(headers.get("host") or "")).strip().lower()
    if not raw or raw.startswith("[") or raw.count(":") > 1:
        return ""
    return raw.partition(":")[0].rstrip(".")


def custom_host_candidate(request) -> str | None:
    host = valid_hostname(request_host(request))
    if not host:
        return None
    own = (urlsplit(settings.FRONTEND_URL).hostname or "").lower()
    return None if host == own else host


async def bind_company_for_host(request) -> bool:
    from services.hr_module.plan_service import feature_enabled

    host = custom_host_candidate(request)
    raw = get_platform_db()
    if raw is None or not host:
        return False
    doc = await raw.companies.find_one(
        {"custom_domains": host, "status": "active", "kind": {"$ne": "platform"}}, {"company_id": 1},
    )
    if not doc:
        return False
    company = await load_company(doc.get("company_id"))
    if blocked_reason(company) or not feature_enabled("custom_domain", company):
        return False
    bind_company(company["company_id"], company)
    return True
