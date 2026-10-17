from __future__ import annotations

import asyncio
import html as _html
import logging
import re
from datetime import datetime, timedelta, timezone

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from config.database import get_db, get_platform_db
from config.settings import settings
from config.tenancy import PLATFORM_COMPANY_ID, company_context

logger = logging.getLogger(__name__)

ALERT_PREFIX = "alert:"
MAX_RECIPIENTS = 20
SEND_CONCURRENCY = 4
BUDGET_ALERT_COOLDOWN_HOURS = 24 * 35

SENT, THROTTLED, FAILED = "sent", "throttled", "failed"

_PLATFORM_COMPANY = {"company_id": PLATFORM_COMPANY_ID, "name": "Platform Operations", "kind": "platform", "settings": {}}

_SEPARATORS = re.compile(r"[,;\s]+")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def throttle_id(key: str, company_id: str | None = None) -> str:
    scope = str(key).strip()
    if company_id and company_id not in scope:
        scope = f"{scope}:{company_id}"
    return f"{ALERT_PREFIX}{scope}"


def merge_recipients(owner_emails: list, extra_csv: str | None) -> list[str]:
    from services.hr_module.email_service import valid_email_address

    out: list[str] = []
    for raw in [*owner_emails, *_SEPARATORS.split(extra_csv or "")]:
        address = valid_email_address(raw)
        address = address.lower() if address else None
        if address and address not in out:
            out.append(address)
    return out[:MAX_RECIPIENTS]


def render(body: str) -> str:
    return "".join(f"<p>{_html.escape(line)}</p>" for line in body.splitlines() if line.strip())


async def _claim(raw, doc_id: str, cooldown_hours: float, now: datetime) -> tuple[bool, datetime | None]:
    cutoff = now - timedelta(hours=max(0.0, float(cooldown_hours)))
    try:
        before = await raw.settings.find_one_and_update(
            {"_id": doc_id, "$or": [{"last_sent_at": {"$lt": cutoff}}, {"last_sent_at": {"$exists": False}}]},
            {"$set": {"key": doc_id, "last_sent_at": now}, "$setOnInsert": {"created_at": now}},
            upsert=True, return_document=ReturnDocument.BEFORE,
        )
    except DuplicateKeyError:
        return False, None
    return True, (before or {}).get("last_sent_at")


async def _release(raw, doc_id: str, claimed_at: datetime, previous: datetime | None) -> None:
    try:
        if previous is None:
            await raw.settings.delete_one({"_id": doc_id, "last_sent_at": claimed_at})
        else:
            await raw.settings.update_one({"_id": doc_id, "last_sent_at": claimed_at}, {"$set": {"last_sent_at": previous}})
    except Exception as exc:
        logger.warning("Alert slot not released | key=%s error=%s", doc_id, type(exc).__name__)


async def _deliver(recipients: list[str], subject: str, body: str, db=None) -> int:
    from services.hr_module.email_service import send_email

    page = render(body)
    gate = asyncio.Semaphore(SEND_CONCURRENCY)

    async def one(to: str) -> bool:
        try:
            async with gate:
                return bool(await send_email(to=to, subject=subject, html_body=page, text_body=body, db=db))
        except Exception as exc:
            logger.warning("Alert mail failed | error=%s", type(exc).__name__)
            return False

    return sum(1 for ok in await asyncio.gather(*(one(a) for a in recipients)) if ok)


async def _owner_emails(raw) -> list[str]:
    rows = await raw.users.find(
        {"is_platform_admin": True, "is_active": {"$ne": False}}, {"_id": 0, "email": 1},
    ).sort("email", 1).to_list(100)
    return [r.get("email") for r in rows if r.get("email")]


async def _company_names(raw, company_id: str | None) -> tuple[str, str]:
    if not company_id:
        return "", ""
    company = await raw.companies.find_one({"company_id": company_id}, {"_id": 0, "name": 1, "client_id": 1})
    if not company:
        return "", ""
    client = await raw.clients.find_one({"client_id": company.get("client_id")}, {"_id": 0, "name": 1}) or {}
    return company.get("name") or "", client.get("name") or ""


async def _alert_owners(key: str, subject: str, body: str, company_id: str | None, cooldown_hours: float) -> str:
    raw = get_platform_db()
    if raw is None:
        return FAILED
    recipients = merge_recipients(await _owner_emails(raw), settings.PLATFORM_ALERT_EMAILS)
    if not recipients:
        logger.info("Owner alert not sent: no recipients | key=%s", key)
        return FAILED
    doc_id = throttle_id(key, company_id)
    claimed_at = _now()
    claimed, previous = await _claim(raw, doc_id, cooldown_hours, claimed_at)
    if not claimed:
        return THROTTLED
    sent = 0
    try:
        company_name, client_name = await _company_names(raw, company_id)
        lines = [body.rstrip()]
        if company_name:
            lines.append(f"Company: {company_name}" + (f" (client: {client_name})" if client_name else ""))
        with company_context(PLATFORM_COMPANY_ID, dict(_PLATFORM_COMPANY)):
            sent = await _deliver(recipients, subject, "\n".join(lines))
    except Exception as exc:
        logger.warning("Owner alert failed | key=%s error=%s", key, type(exc).__name__)
    if not sent:
        await _release(raw, doc_id, claimed_at, previous)
        return FAILED
    return SENT


async def alert_owners(
    key: str, subject: str, body: str, *, company_id: str | None = None, cooldown_hours: int = 24,
) -> bool:
    try:
        return await _alert_owners(key, subject, body, company_id, cooldown_hours) == SENT
    except Exception as exc:
        logger.warning("Owner alert failed | key=%s error=%s", key, type(exc).__name__)
        return False


async def _alert_company_admins(
    company_id: str, key: str, subject: str, body: str, cooldown_hours: float,
) -> str:
    raw = get_platform_db()
    if raw is None or not company_id:
        return FAILED
    from services.hr_module import workspace_service

    company = await workspace_service.load_company(company_id)
    if company is None:
        return FAILED
    doc_id = throttle_id(f"company:{key}", company_id)
    claimed_at = _now()
    claimed, previous = await _claim(raw, doc_id, cooldown_hours, claimed_at)
    if not claimed:
        return THROTTLED
    sent = 0
    try:
        with company_context(company_id, company):
            db = get_db()
            rows = await db.users.find(
                {"role": "superadmin", "is_active": {"$ne": False}, "is_platform_admin": {"$ne": True}},
                {"_id": 0, "email": 1},
            ).sort("email", 1).to_list(MAX_RECIPIENTS)
            recipients = merge_recipients([r.get("email") for r in rows], "")
            if recipients:
                sent = await _deliver(recipients, subject, body, db=db)
    except Exception as exc:
        logger.warning("Company notice failed | key=%s error=%s", key, type(exc).__name__)
    if not sent:
        await _release(raw, doc_id, claimed_at, previous)
        return FAILED
    return SENT


async def alert_company_admins(
    company_id: str, key: str, subject: str, body: str, *, cooldown_hours: int = 24,
) -> bool:
    try:
        return await _alert_company_admins(company_id, key, subject, body, cooldown_hours) == SENT
    except Exception as exc:
        logger.warning("Company notice failed | key=%s error=%s", key, type(exc).__name__)
        return False


def budget_texts(company_name: str, band: int, used: float, budget: float) -> tuple[str, str, str, str]:
    percent = "100%" if band >= 100 else f"{band}%"
    figures = f"${used:.2f} of its ${budget:.2f} monthly AI budget"
    name = company_name or "A company"
    if band >= 100:
        owner_subject = f"{name} has used its monthly AI budget"
        owner_body = f"{name} has used {figures}. New AI actions started by its administrators are refused until next month or until the budget is raised."
        company_subject = "Your monthly AI budget is used up"
        company_body = (
            f"Your workspace has used {figures}.\n"
            "New AI actions, such as uploading resumes or creating jobs, are paused until next month "
            "or until the limit is raised. Interviews already sent to candidates are not affected.\n"
            "Contact your account manager to raise the limit."
        )
    else:
        owner_subject = f"{name} has used {percent} of its monthly AI budget"
        owner_body = f"{name} has used {figures}."
        company_subject = f"Your monthly AI budget is {percent} used"
        company_body = (
            f"Your workspace has used {figures}.\n"
            "When the budget is used up, new AI actions such as uploading resumes are paused until next month. "
            "Interviews already sent to candidates are not affected.\n"
            "Contact your account manager if you need a higher limit."
        )
    return owner_subject, owner_body, company_subject, company_body


async def budget_threshold(company_id: str, band: int, used: float, budget: float, month: str) -> None:
    try:
        raw = get_platform_db()
        if raw is None:
            return
        company_name, _client = await _company_names(raw, company_id)
        owner_subject, owner_body, company_subject, company_body = budget_texts(company_name, band, used, budget)
        key = f"ai_budget_{band}:{month}"
        await asyncio.gather(
            alert_owners(
                key, owner_subject, owner_body, company_id=company_id, cooldown_hours=BUDGET_ALERT_COOLDOWN_HOURS,
            ),
            alert_company_admins(
                company_id, key, company_subject, company_body, cooldown_hours=BUDGET_ALERT_COOLDOWN_HOURS,
            ),
        )
        await raw.companies.update_one(
            {"company_id": company_id}, {"$set": {"usage.ai_alert": {"month": month, "band": int(band)}}},
        )
    except Exception as exc:
        logger.warning("Budget alert failed | company=%s error=%s", company_id, type(exc).__name__)
