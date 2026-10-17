from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
import logging
from config.database import get_platform_db
from config.settings import settings
from config.tenancy import DEFAULT_COMPANY_ID, bind_company
from services.hr_module.permissions import resolve_permissions
from services.hr_module.workspace_service import blocked_reason, load_company, public_company

logger = logging.getLogger(__name__)


oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token")
oauth2_scheme_optional = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token", auto_error=False)


_USER_PROJECTION = {
    "_id": 0, "password_hash": 0, "avatar_base64": 0,
    "totp_secret": 0, "totp_pending": 0, "totp_recovery_hashes": 0, "totp_last_step": 0,
}


def _demo_user(token: str) -> dict:
    token, _, company_id = token.partition("@@")
    if not settings.DEBUG:
        company_id = ""
    role = "standard"
    platform = settings.DEBUG and "platform" in token
    if platform or "superadmin" in token:
        role = "superadmin"
    elif "admin" in token:
        role = "admin"
    company_id = company_id or DEFAULT_COMPANY_ID
    pinned = settings.DEMO_COMPANY_ID.strip()
    if pinned and not platform:
        company_id = pinned
    return {
        "name": f"Demo {role.capitalize()}",
        "email": f"demo-{role}@hirely.ai",
        "role": role,
        "is_active": True,
        "has_avatar": False,
        "company_id": company_id,
        "is_platform_admin": platform,
        **({"demo_read_only": True} if pinned else {}),
    }


async def _demo_company(company_id: str) -> dict:
    pinned = settings.DEMO_COMPANY_ID.strip()
    if pinned and company_id == pinned:
        company = await load_company(company_id)
        if company is None:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "The demo company is not available")
        return company
    return {"company_id": company_id, "name": "Demo Company", "settings": {}}


async def _account_from_token(token: str) -> dict:
    exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        email: str | None = payload.get("sub")
        if not email:
            raise exc
        email = email.lower().strip()
    except Exception as e:
        logger.warning("Token verification failed: %s", e)
        raise exc

    raw = get_platform_db()
    if raw is None:
        raise HTTPException(503, "Database unavailable")

    user = await raw.users.find_one({"email": email}, _USER_PROJECTION)
    if not user or not user.get("is_active", True):
        raise exc
    changed = user.pop("pwd_changed_at", None)
    issued = payload.get("iat")
    if changed and issued is not None and int(issued) < int(changed):
        raise exc
    user["has_avatar"] = bool(user.get("avatar_content_type"))
    user["is_platform_admin"] = bool(user.get("is_platform_admin"))
    return user


async def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    if settings.ALLOW_DEMO_AUTH and token and token.startswith("demo-"):
        user = _demo_user(token)
        company = await _demo_company(user["company_id"])
        bind_company(user["company_id"], company)
        if user.get("demo_read_only"):
            user.update(public_company(company))
        return user

    user = await _account_from_token(token)
    company = await load_company(user.get("company_id"))
    reason = blocked_reason(company)
    if reason:
        raise HTTPException(status.HTTP_403_FORBIDDEN, reason)
    bind_company(company["company_id"], company)
    user.update(public_company(company))
    return user


async def get_optional_user(token: str | None = Depends(oauth2_scheme_optional)) -> dict | None:
    if not token:
        return None
    try:
        return await get_current_user(token)
    except HTTPException:
        return None
    except Exception as exc:
        logger.warning("Optional sign-in check failed: %s", type(exc).__name__)
        return None


async def require_platform_admin(token: str = Depends(oauth2_scheme)) -> dict:
    if settings.ALLOW_DEMO_AUTH and token and token.startswith("demo-"):
        user = _demo_user(token)
    else:
        user = await _account_from_token(token)
    if not user.get("is_platform_admin"):
        raise HTTPException(403, "Platform owner access required")
    return user


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") not in ("admin", "superadmin"):
        raise HTTPException(403, "Admin access required")
    return user


async def require_superadmin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "superadmin":
        raise HTTPException(403, "Superadmin access required")
    return user


def require_permission(permission: str):
    async def _check_permission(user: dict = Depends(get_current_user)) -> dict:
        permissions = await resolve_permissions(user.get("role"))
        if permission not in permissions:
            raise HTTPException(403, f"Missing required permission: {permission}")
        return user

    return _check_permission


def require_any_permission(*permissions: str):
    async def _check_any_permission(user: dict = Depends(get_current_user)) -> dict:
        granted = await resolve_permissions(user.get("role"))
        if not any(p in granted for p in permissions):
            raise HTTPException(403, f"Missing required permission (any of): {list(permissions)}")
        return user

    return _check_any_permission
