from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from shared.auth import require_admin
from config.database import get_db
from services.hr_module import onboarding_service, plan_service
from services.hr_module.audit_service import log_audit_event
from services.hr_module.company_settings_service import (
    get_company_settings,
    update_company_settings,
    get_integrations_status,
)

router = APIRouter()


class CompanySettingsUpdate(BaseModel):
    company_name: str | None = None
    industry: str | None = None
    size: str | None = None
    website: str | None = None
    address: str | None = None
    primary_contact_email: str | None = None
    terms_url: str | None = None
    privacy_url: str | None = None


@router.get("")
async def get_company_settings_route(_: dict = Depends(require_admin)):
    if get_db() is None:
        raise HTTPException(503, "Database unavailable")
    return await get_company_settings()


@router.patch("")
async def update_company_settings_route(
    body: CompanySettingsUpdate,
    user: dict = Depends(require_admin),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    changes = body.model_dump(exclude_unset=True)
    try:
        saved = await update_company_settings(changes, updated_by=user.get("email"))
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    await log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="company_settings_update", resource_type="company_settings", resource_id="singleton",
        details={k: (v[:200] if isinstance(v, str) else v) for k, v in changes.items()},
    )
    return saved


@router.get("/integrations-status")
async def integrations_status_route(_: dict = Depends(require_admin)):
    return await get_integrations_status()


@router.get("/usage")
async def company_usage_route(_: dict = Depends(require_admin)):
    if get_db() is None:
        raise HTTPException(503, "Database unavailable")
    return await plan_service.company_usage()


@router.get("/onboarding")
async def onboarding_route(_: dict = Depends(require_admin)):
    if get_db() is None:
        raise HTTPException(503, "Database unavailable")
    return await onboarding_service.onboarding_status()


@router.post("/onboarding/dismiss")
async def dismiss_onboarding_route(user: dict = Depends(require_admin)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    result = await onboarding_service.dismiss_onboarding()
    await log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="onboarding_dismiss", resource_type="company_settings", resource_id="singleton",
        details={},
    )
    return result
