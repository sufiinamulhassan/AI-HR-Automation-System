from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from config.database import get_db
from services.hr_module import integrations_settings_service as svc
from services.hr_module.audit_service import log_audit_event
from services.hr_module.integrations_settings_service import IntegrationSettingsError
from services.hr_module.plan_service import require_feature
from shared.auth import require_superadmin

router = APIRouter()


class IntegrationUpdate(BaseModel):
    url: str | None = None
    auth_header: str | None = None
    auth_token: str | None = None
    auto_push_on_hire: bool | None = None
    account_id: str | None = None
    tenant_id: str | None = None
    client_id: str | None = None
    client_secret: str | None = None
    organizer: str | None = None
    clear_secret: bool | None = None


def _require_db():
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    return db


def _known(name: str) -> str:
    if name not in svc.NAMES:
        raise HTTPException(404, "Integration not found")
    return name


@router.get("")
async def list_integrations(
    _user: dict = Depends(require_superadmin),
    _plan: None = Depends(require_feature("integrations")),
):
    _require_db()
    return {"integrations": await svc.get_all_views()}


@router.get("/{name}")
async def get_integration(
    name: str,
    _user: dict = Depends(require_superadmin),
    _plan: None = Depends(require_feature("integrations")),
):
    _require_db()
    return await svc.get_view(_known(name))


@router.put("/{name}")
async def put_integration(
    name: str,
    body: IntegrationUpdate,
    user: dict = Depends(require_superadmin),
    _plan: None = Depends(require_feature("integrations")),
):
    db = _require_db()
    _known(name)
    try:
        saved, summary = await svc.save(name, body.model_dump(exclude_unset=True), updated_by=user.get("email"))
    except IntegrationSettingsError as exc:
        raise HTTPException(400, str(exc))
    await log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="company_integration_update", resource_type="company_settings", resource_id=f"integration:{name}",
        details=summary,
    )
    return saved
