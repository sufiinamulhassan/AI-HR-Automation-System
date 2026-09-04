"""
SSO — Google OAuth2 Authorization Code flow (MVP2 §2.19, prioritized ahead of
the calendar/Zoom/Teams/Slack/HRMS connectors per the doc's own guidance).

Hand-rolled with httpx only (no new OAuth library dependency — this is a
small enough flow to do safely by hand):

    GET /sso/google/login      -> redirects to Google's consent screen
    GET /sso/google/callback   -> exchanges code, verifies identity via
                                   Google's userinfo endpoint, finds-or-creates
                                   a local user, mints our own JWT, redirects
                                   to the frontend with it in the query string

Both endpoints return a clear 503 "SSO not configured" when
GOOGLE_OAUTH_CLIENT_ID is blank, rather than attempting (and failing deep
into) the flow.

We deliberately do NOT verify the id_token's JWT signature against Google's
JWKS ourselves — calling /oauth2/v3/userinfo with the freshly-exchanged
access_token is simpler and equally safe for this scope, since the access
token itself was only just obtained directly from Google over TLS.
"""
import logging
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import RedirectResponse
from jose import jwt

from config.database import get_db
from config.settings import settings

logger = logging.getLogger(__name__)

router = APIRouter()

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


def _make_token(email: str) -> str:
    """Mirrors routes/auth.py's private _make_token — duplicated here (not
    imported) since routes/auth.py is frozen for this task."""
    exp = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode({"sub": email, "exp": exp}, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


@router.get("/google/login")
async def google_login():
    if not _sso_configured():
        raise HTTPException(503, "SSO not configured")

    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    state = secrets.token_urlsafe(24)
    await db.sso_states.insert_one({
        "state": state,
        "created_at": datetime.now(timezone.utc).isoformat(),
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


@router.get("/google/callback")
async def google_callback(code: str | None = None, state: str | None = None):
    if not _sso_configured():
        raise HTTPException(503, "SSO not configured")

    if not code or not state:
        raise HTTPException(400, "Missing code or state")

    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    state_doc = await db.sso_states.find_one_and_delete({"state": state})
    if not state_doc:
        raise HTTPException(400, "Invalid or expired state — possible CSRF, retry login")

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
    if userinfo.get("email_verified") is False:
        raise HTTPException(403, "Google account email is not verified")

    existing = await db.users.find_one({"email": email})
    if not existing:
        await db.users.insert_one({
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

    token = _make_token(email)
    return RedirectResponse(url=f"{settings.FRONTEND_URL}/sso-callback?token={token}")
