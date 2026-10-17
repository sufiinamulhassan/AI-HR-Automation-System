import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from config.database import get_db
from config.tenancy import current_company, current_company_id
from services.hr_module import oidc_service
from services.hr_module.audit_service import log_audit_event
from services.hr_module.plan_service import require_feature
from shared.auth import require_permission, require_superadmin
from shared.rate_limit import enforce_rate_limit

logger = logging.getLogger(__name__)

router = APIRouter()

TEST_LIMIT_PER_HOUR = 20


class SsoUpdate(BaseModel):
    enabled: bool | None = None
    issuer: str | None = None
    client_id: str | None = None
    client_secret: str | None = None
    scopes: str | list[str] | None = None
    enforce: bool | None = None


class SsoTest(BaseModel):
    issuer: str | None = None


@router.get("")
async def get_sso(
    user: dict = Depends(require_superadmin),
    _plan: None = Depends(require_feature("oidc_sso")),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    return oidc_service.public_view(await oidc_service.get_config(db), current_company())


@router.put("")
async def put_sso(
    body: SsoUpdate,
    user: dict = Depends(require_superadmin),
    _perm: dict = Depends(require_permission("security:manage")),
    _plan: None = Depends(require_feature("oidc_sso")),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    current = await oidc_service.get_config(db)
    changes = body.model_dump(exclude_unset=True)
    try:
        updated = oidc_service.apply_changes(current, changes)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    await oidc_service.save_config(db, updated, updated_by=user.get("email"))
    await log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="company_sso_update", resource_type="company_settings", resource_id="sso",
        details={
            "enabled": updated["enabled"], "enforce": updated["enforce"], "issuer": updated["issuer"],
            "client_id": updated["client_id"], "scopes": updated["scopes"],
            "secret_changed": bool(changes.get("client_secret")),
        },
    )
    return oidc_service.public_view(updated, current_company())


@router.post("/test")
async def test_sso(
    body: SsoTest | None = None,
    user: dict = Depends(require_superadmin),
    _perm: dict = Depends(require_permission("security:manage")),
    _plan: None = Depends(require_feature("oidc_sso")),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    await enforce_rate_limit(
        db, key=f"sso-test:{current_company_id()}", limit=TEST_LIMIT_PER_HOUR, window_seconds=3600,
    )
    issuer = ((body.issuer if body else None) or "").strip() or (await oidc_service.get_config(db))["issuer"]
    if not issuer:
        return {"ok": False, "detail": "Enter the issuer first."}
    ok, detail = await oidc_service.check_provider(issuer)
    return {"ok": ok, "detail": detail}
