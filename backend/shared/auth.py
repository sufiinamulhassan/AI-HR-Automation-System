"""Shared JWT auth dependencies used by all routes."""
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
import logging
from config.database import get_db
from config.settings import settings
from services.hr_module.permissions import resolve_permissions

logger = logging.getLogger(__name__)


oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token")


async def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    if settings.ALLOW_DEMO_AUTH and token and token.startswith("demo-"):
        role = "standard"
        if "superadmin" in token:
            role = "superadmin"
        elif "admin" in token:
            role = "admin"
        return {
            "name": f"Demo {role.capitalize()}",
            "email": f"demo-{role}@hirely.ai",
            "role": role,
            "is_active": True,
        }

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

    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    user = await db.users.find_one({"email": email}, {"_id": 0, "password_hash": 0})
    if not user or not user.get("is_active", True):
        raise exc
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
    """Dependency factory — RBAC permission check (MVP2 §2.1).

    Returns a FastAPI dependency that resolves the current user's role to
    its effective permission set via `resolve_permissions` (built-in role
    defaults, or a custom `roles` collection override if one exists) and
    raises 403 if `permission` isn't in it.

    Purely additive: require_admin/require_superadmin above are completely
    unchanged, so every existing route that depends on them keeps working
    exactly as before. This is a new, optional, finer-grained check for
    routes that want it (e.g. routes/rbac.py) — it does not replace the two
    hardcoded role checks anywhere they're already used.
    """
    async def _check_permission(user: dict = Depends(get_current_user)) -> dict:
        permissions = await resolve_permissions(user.get("role"))
        if permission not in permissions:
            raise HTTPException(403, f"Missing required permission: {permission}")
        return user

    return _check_permission
