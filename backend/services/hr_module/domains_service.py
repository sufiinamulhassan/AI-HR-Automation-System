from __future__ import annotations

import logging
from urllib.parse import urlsplit

from fastapi import HTTPException

from config.database import get_platform_db
from config.settings import settings
from config.tenancy import PLATFORM_COMPANY_ID
from services.hr_module import plan_service
from services.hr_module.workspace_service import load_company
from shared.links import valid_hostname

logger = logging.getLogger(__name__)

MAX_DOMAINS = 5
CONFLICT_MESSAGE = "That domain is already used by another company."


class DomainError(ValueError):
    pass


def normalize_domains(domains) -> list[str]:
    if domains is None:
        domains = []
    if not isinstance(domains, (list, tuple)):
        raise DomainError("Domains must be a list of host names.")
    own = (urlsplit(settings.FRONTEND_URL).hostname or "").lower()
    cleaned: list[str] = []
    for entry in domains:
        host = valid_hostname(entry)
        if host is None:
            shown = str(entry)[:80].replace("\r", " ").replace("\n", " ")
            raise DomainError(
                f"'{shown}' is not a valid domain. Use the host name only, for example careers.example.com."
            )
        if host == own:
            raise DomainError("That domain is the address of the product itself and cannot be used.")
        if host not in cleaned:
            cleaned.append(host)
    if len(cleaned) > MAX_DOMAINS:
        raise DomainError(f"A company can have at most {MAX_DOMAINS} domains.")
    return cleaned


async def get_domains(company_id: str) -> dict:
    company = await _workspace(company_id)
    return {
        "company_id": company_id,
        "domains": list(company.get("custom_domains") or []),
        "plan_allows": plan_service.feature_enabled("custom_domain", company),
    }


async def _workspace(company_id: str) -> dict:
    company = await load_company(company_id)
    if company is None or company.get("kind") == "platform" or company_id == PLATFORM_COMPANY_ID:
        raise HTTPException(404, "Company not found")
    return company


async def set_domains(company_id: str, domains) -> list[str]:
    company = await _workspace(company_id)
    try:
        cleaned = normalize_domains(domains)
    except DomainError as exc:
        raise HTTPException(400, str(exc))
    if cleaned and not plan_service.feature_enabled("custom_domain", company):
        raise HTTPException(402, "This company's plan does not include a custom domain.")

    raw = get_platform_db()
    if raw is None:
        raise HTTPException(503, "Database unavailable")
    if cleaned and await raw.companies.find_one(
        {"custom_domains": {"$in": cleaned}, "company_id": {"$ne": company_id}}, {"company_id": 1},
    ):
        raise HTTPException(409, CONFLICT_MESSAGE)
    try:
        await raw.companies.update_one({"company_id": company_id}, {"$set": {"custom_domains": cleaned}})
    except Exception as exc:
        if "duplicate key" in str(exc).lower() or "E11000" in str(exc):
            raise HTTPException(409, CONFLICT_MESSAGE)
        raise
    return cleaned
