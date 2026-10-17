import logging
import secrets
from datetime import datetime, timezone
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse

from config.database import get_db, get_platform_db
from config.settings import settings
from config.tenancy import bind_company
from services.hr_module import plan_service
from services.hr_module.workspace_service import blocked_reason, company_for_email_domain, load_company
from shared.rate_limit import public_token_throttle

logger = logging.getLogger(__name__)

router = APIRouter()

_sso_throttle = public_token_throttle("sso", ip_limit=60, param=None)

_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_TOKEN_URL = "https://oauth2.googleapis.com/token"
_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"
_TIMEOUT = 10.0


def _sso_configured() -> bool:
    return bool(
        settings.GOOGLE_OAUTH_CLIENT_ID
        and settings.GOOGLE_OAUTH_CLIENT_SECRET
        and settings.GOOGLE_OAUTH_REDIRECT_URI
    )


def allowed_email_domains() -> set[str]:
    raw = settings.SSO_ALLOWED_EMAIL_DOMAINS or ""
    return {part.strip().lower().lstrip("@") for part in raw.split(",") if part.strip()}


def domain_allowed(email: str) -> bool:
    allowed = allowed_email_domains()
    if not allowed:
        return True
    return email.rpartition("@")[2].lower() in allowed


@router.get("/google/login", dependencies=[Depends(_sso_throttle)])
async def google_login():
    if not _sso_configured():
        raise HTTPException(503, "SSO not configured")

    db = get_platform_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    state = secrets.token_urlsafe(24)
    await db.sso_states.insert_one({
        "state": state,
        "kind": "google",
        "created_at": datetime.now(timezone.utc),
    })

    params = {
        "client_id": settings.GOOGLE_OAUTH_CLIENT_ID,
        "redirect_uri": settings.GOOGLE_OAUTH_REDIRECT_URI,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "online",
    }
    return RedirectResponse(url=f"{_AUTH_URL}?{urlencode(params)}")


@router.get("/google/callback", dependencies=[Depends(_sso_throttle)])
async def google_callback(code: str | None = None, state: str | None = None):
    if not _sso_configured():
        raise HTTPException(503, "SSO not configured")

    if not code or not state:
        raise HTTPException(400, "Missing code or state")

    db = get_platform_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    state_doc = await db.sso_states.find_one_and_delete({"state": state, "kind": {"$ne": "oidc"}})
    if not state_doc:
        raise HTTPException(400, "Invalid or expired state: possible CSRF, retry login")

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            token_resp = await client.post(
                _TOKEN_URL,
                data={
                    "client_id": settings.GOOGLE_OAUTH_CLIENT_ID,
                    "client_secret": settings.GOOGLE_OAUTH_CLIENT_SECRET,
                    "code": code,
                    "grant_type": "authorization_code",
                    "redirect_uri": settings.GOOGLE_OAUTH_REDIRECT_URI,
                },
            )
            token_resp.raise_for_status()
            access_token = token_resp.json().get("access_token")
            if not access_token:
                raise HTTPException(502, "Google did not return an access token")

            userinfo_resp = await client.get(
                _USERINFO_URL,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            userinfo_resp.raise_for_status()
            userinfo = userinfo_resp.json()
    except HTTPException:
        raise
    except httpx.HTTPError as exc:
        logger.warning("Google SSO token/userinfo exchange failed: %s", exc)
        raise HTTPException(502, "Failed to complete Google sign-in")

    email = (userinfo.get("email") or "").lower().strip()
    if not email:
        raise HTTPException(502, "Google did not return an email address")
    if userinfo.get("email_verified") is not True:
        raise HTTPException(403, "Google account email is not verified")

    existing = await get_platform_db().users.find_one({"email": email})
    if not existing:
        company = await company_for_email_domain(email, legacy_domains=allowed_email_domains())
        if company is None:
            logger.warning("SSO sign-up refused: no company claims the domain | email=%s", email)
            raise HTTPException(
                403,
                "This email domain is not allowed to sign up with single sign-on. "
                "Ask your administrator to create your account.",
            )
        bind_company(company["company_id"], company)
        try:
            await plan_service.ensure_seat_available()
        except HTTPException as exc:
            raise HTTPException(403, exc.detail)
        await get_db().users.insert_one({
            "name": userinfo.get("name") or email,
            "email": email,
            "role": "standard",
            "is_active": True,
            "otp_required": False,
            "sso_provider": "google",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    elif not existing.get("is_active", True):
        raise HTTPException(403, "Account is deactivated")
    else:
        company = await load_company(existing.get("company_id"))
        reason = blocked_reason(company)
        if reason:
            raise HTTPException(403, reason)
        bind_company(company["company_id"], company)

    await get_db().users.update_one({"email": email}, {"$set": {"last_login_at": datetime.now(timezone.utc)}})

    from routes.auth import _make_token

    token = await _make_token(email, company["company_id"])
    return RedirectResponse(url=f"{settings.FRONTEND_URL}/sso-callback?token={token}")
