import logging
from datetime import datetime, timezone
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from pymongo.errors import DuplicateKeyError

from config.database import get_db, get_platform_db
from config.settings import settings
from config.tenancy import bind_company
from services.hr_module import oidc_service, plan_service
from services.hr_module.audit_service import log_audit_event
from services.hr_module.oidc_service import SsoError
from services.hr_module.workspace_service import blocked_reason, load_company
from shared.rate_limit import public_token_throttle

logger = logging.getLogger(__name__)

router = APIRouter()

_throttle = public_token_throttle("sso-oidc", ip_limit=180, param=None)

BINDING_COOKIE = "hr_oidc_binding"
BINDING_PATH = "/api/v1/sso/oidc"
BINDING_MAX_AGE = oidc_service.STATE_MAX_AGE_SECONDS


def _cookie_secure() -> bool:
    return settings.FRONTEND_URL.lower().startswith("https://")


def _failure(message: str) -> RedirectResponse:
    response = RedirectResponse(url=f"{settings.FRONTEND_URL}/sso-callback?{urlencode({'error': message})}")
    response.headers["Cache-Control"] = "no-store"
    response.delete_cookie(BINDING_COOKIE, path=BINDING_PATH)
    return response


async def _company_by_slug(slug: str | None) -> dict | None:
    slug = (slug or "").strip().lower()
    raw = get_platform_db()
    if not slug or raw is None:
        return None
    found = await raw.companies.find_one({"slug": slug, "kind": {"$ne": "platform"}}, {"company_id": 1})
    company = await load_company(found["company_id"]) if found else None
    return None if company is None or blocked_reason(company) else company


@router.get("/config", dependencies=[Depends(_throttle)])
async def oidc_config(company: str | None = Query(None, max_length=100)):
    off = {"enabled": False, "enforce": False, "name": ""}
    found = await _company_by_slug(company)
    if found is None:
        return off
    bind_company(found["company_id"], found)
    cfg = await oidc_service.get_config(get_db())
    if not oidc_service.is_available(cfg, found):
        return off
    return {"enabled": True, "enforce": bool(cfg.get("enforce")), "name": found.get("name") or ""}


@router.get("/login", dependencies=[Depends(_throttle)])
async def oidc_login(company: str | None = Query(None, max_length=100)):
    found = await _company_by_slug(company)
    if found is None:
        return _failure(oidc_service.UNAVAILABLE_MESSAGE)
    bind_company(found["company_id"], found)
    db = get_db()
    if db is None:
        return _failure(oidc_service.FAILED_MESSAGE)
    cfg = await oidc_service.get_config(db)
    if not oidc_service.is_available(cfg, found):
        return _failure(oidc_service.UNAVAILABLE_MESSAGE)
    try:
        meta = await oidc_service.discover(cfg["issuer"])
    except SsoError as exc:
        logger.warning("OIDC login: discovery failed | company=%s reason=%s", found["company_id"], exc)
        return _failure(oidc_service.FAILED_MESSAGE)

    start = oidc_service.begin_login(found["company_id"], cfg, meta)
    await db.sso_states.insert_one(start.state_doc)

    response = RedirectResponse(url=start.url)
    response.headers["Cache-Control"] = "no-store"
    response.set_cookie(
        BINDING_COOKIE, start.binding, max_age=BINDING_MAX_AGE, path=BINDING_PATH,
        httponly=True, samesite="lax", secure=_cookie_secure(),
    )
    return response


@router.get("/callback", dependencies=[Depends(_throttle)])
async def oidc_callback(
    request: Request,
    code: str | None = Query(None, max_length=4096),
    state: str | None = Query(None, max_length=512),
    error: str | None = Query(None, max_length=200),
):
    raw = get_platform_db()
    if raw is None:
        return _failure(oidc_service.FAILED_MESSAGE)
    if not state:
        return _failure(oidc_service.FAILED_MESSAGE)

    doc = await raw.sso_states.find_one_and_delete({"state": state, "kind": "oidc"})
    if doc is None or not oidc_service.state_is_fresh(doc):
        logger.warning("OIDC callback: unknown or expired state")
        return _failure(oidc_service.FAILED_MESSAGE)
    if error or not code:
        logger.warning("OIDC callback: the provider reported an error | error=%s", (error or "no code")[:60])
        return _failure(oidc_service.FAILED_MESSAGE)
    if not oidc_service.binding_matches(doc, request.cookies.get(BINDING_COOKIE)):
        logger.warning("OIDC callback: not the browser that started the sign-in")
        return _failure(oidc_service.FAILED_MESSAGE)

    company = await load_company(doc.get("company_id"))
    if company is None or blocked_reason(company):
        return _failure(oidc_service.UNAVAILABLE_MESSAGE)
    bind_company(company["company_id"], company)
    db = get_db()
    cfg = await oidc_service.get_config(db)
    if (
        not oidc_service.is_available(cfg, company)
        or cfg["client_id"] != doc.get("client_id") or cfg["issuer"] != doc.get("config_issuer")
    ):
        return _failure(oidc_service.UNAVAILABLE_MESSAGE)

    try:
        claims = await oidc_service.complete_login(doc, cfg, code)
    except SsoError as exc:
        logger.warning("OIDC callback: sign-in refused | company=%s reason=%s", company["company_id"], exc)
        return _failure(oidc_service.FAILED_MESSAGE)
    except Exception as exc:
        logger.warning("OIDC callback: unexpected failure | company=%s error=%s", company["company_id"], type(exc).__name__)
        return _failure(oidc_service.FAILED_MESSAGE)

    email = claims["email"]
    users = raw.users
    existing = await users.find_one({"email": email}, {"_id": 0, "password_hash": 0, "avatar_base64": 0})
    if existing is None:
        refusal = await _provision(db, company, email, claims)
        if refusal:
            return _failure(refusal)
    else:
        if existing.get("company_id") != company["company_id"] or existing.get("is_platform_admin"):
            logger.warning("OIDC callback: account belongs elsewhere | company=%s", company["company_id"])
            return _failure(oidc_service.ACCOUNT_REFUSED_MESSAGE)
        if not existing.get("is_active", True):
            return _failure(oidc_service.DEACTIVATED_MESSAGE)

    await db.users.update_one({"email": email}, {"$set": {"last_login_at": datetime.now(timezone.utc)}})

    from routes.auth import _make_token

    token = await _make_token(email, company["company_id"])
    response = RedirectResponse(url=f"{settings.FRONTEND_URL}/sso-callback?token={token}")
    response.headers["Cache-Control"] = "no-store"
    response.delete_cookie(BINDING_COOKIE, path=BINDING_PATH)
    return response


async def _provision(db, company: dict, email: str, claims: dict) -> str | None:
    if not oidc_service.domain_allowed(company, email):
        logger.warning("OIDC sign-up refused: domain not assigned to the company | company=%s", company["company_id"])
        return oidc_service.ACCOUNT_REFUSED_MESSAGE
    try:
        await plan_service.ensure_seat_available()
    except HTTPException as exc:
        return str(exc.detail)
    name = str(claims.get("name") or "").strip() or " ".join(
        str(claims.get(k) or "").strip() for k in ("given_name", "family_name")
    ).strip() or email
    try:
        await db.users.insert_one({
            "name": name[:200], "email": email, "role": "standard", "is_active": True, "otp_required": False,
            "sso_provider": "oidc", "created_at": datetime.now(timezone.utc).isoformat(),
        })
    except DuplicateKeyError:
        again = await get_platform_db().users.find_one({"email": email}, {"company_id": 1, "is_platform_admin": 1})
        if not again or again.get("company_id") != company["company_id"] or again.get("is_platform_admin"):
            return oidc_service.ACCOUNT_REFUSED_MESSAGE
        return None
    await log_audit_event(
        db, actor_email=email, actor_role="standard", action="user_create", resource_type="user",
        resource_id=email, details={"name": name[:200], "role": "standard", "via": "oidc"},
    )
    return None
