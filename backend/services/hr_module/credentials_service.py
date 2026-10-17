from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone

from config.database import get_db
from config.settings import settings
from config.tenancy import company_context, current_company, current_company_id
from shared.links import base_url

logger = logging.getLogger(__name__)

PURPOSE_INVITE = "invite"
PURPOSE_RESET = "reset"
PURPOSES = (PURPOSE_RESET, PURPOSE_INVITE)

_TTL = {PURPOSE_RESET: timedelta(hours=1), PURPOSE_INVITE: timedelta(days=7)}
_EXPIRES_IN = {PURPOSE_RESET: "1 hour", PURPOSE_INVITE: "7 days"}

INVALID_LINK_MESSAGE = "This link is invalid or has expired."
FORGOT_MESSAGE = "If that address has an account, we have sent a link."

LIMIT_WINDOW_SECONDS = 3600
FORGOT_EMAIL_LIMIT = 5
FORGOT_IP_LIMIT = 20
RESET_IP_LIMIT = 30
INVITE_RESEND_LIMIT = 10


def hash_token(token: str) -> str:
    return hashlib.sha256(str(token or "").encode("utf-8")).hexdigest()


def unusable_password() -> str:
    return secrets.token_hex(32)


def build_link(token: str, purpose: str) -> str:
    link = f"{base_url().rstrip('/')}/reset-password?token={token}"
    return f"{link}&invite=1" if purpose == PURPOSE_INVITE else link


async def issue_token(
    db, *, email: str, purpose: str, company_id: str | None = None, invited_by: str | None = None,
) -> str:
    if purpose not in PURPOSES:
        raise ValueError(f"unknown purpose: {purpose}")
    now = datetime.now(timezone.utc)
    token = secrets.token_urlsafe(32)
    await void_tokens(db, email, now)
    await db.password_tokens.insert_one({
        "token_hash": hash_token(token),
        "email": email,
        "purpose": purpose,
        "company_id": company_id,
        "invited_by": invited_by,
        "created_at": now,
        "expires_at": now + _TTL[purpose],
        "used_at": None,
    })
    return token


async def void_tokens(db, email: str, when: datetime | None = None) -> None:
    await db.password_tokens.update_many(
        {"email": email, "used_at": None}, {"$set": {"used_at": when or datetime.now(timezone.utc)}},
    )


async def find_open_token(db, token: str) -> dict | None:
    if not token:
        return None
    return await db.password_tokens.find_one({
        "token_hash": hash_token(token), "used_at": None, "expires_at": {"$gt": datetime.now(timezone.utc)},
    })


async def claim_token(db, token: str) -> dict | None:
    if not token:
        return None
    now = datetime.now(timezone.utc)
    return await db.password_tokens.find_one_and_update(
        {"token_hash": hash_token(token), "used_at": None, "expires_at": {"$gt": now}},
        {"$set": {"used_at": now}},
    )


async def send_invite(
    *, email: str, name: str, company_id: str, invited_by: str | None, purpose: str = "invite",
) -> bool:
    from services.hr_module import email_service
    from services.hr_module.workspace_service import load_company

    if purpose not in PURPOSES:
        raise ValueError(f"unknown purpose: {purpose}")
    email = (email or "").strip().lower()
    try:
        if current_company_id() == company_id and current_company().get("name"):
            company = current_company()
        else:
            company = await load_company(company_id)
        if company is None:
            logger.warning("Credential link not sent: no such company | company_id=%s", company_id)
            return False
        with company_context(company_id, company):
            db = get_db()
            if db is None:
                return False
            token = await issue_token(db, email=email, purpose=purpose, company_id=company_id, invited_by=invited_by)
            link = build_link(token, purpose)
            send = email_service.send_invitation_email if purpose == PURPOSE_INVITE else email_service.send_password_reset_email
            link_kwarg = "invite_url" if purpose == PURPOSE_INVITE else "reset_url"
            sent = bool(await send(
                to_email=email, name=name or "", expires_in=_EXPIRES_IN[purpose], db=db, **{link_kwarg: link},
            ))
            if not sent:
                await db.password_tokens.delete_one({"token_hash": hash_token(token)})
            return sent
    except Exception as exc:
        logger.warning("Credential link failed | purpose=%s error=%s", purpose, type(exc).__name__)
        return False
