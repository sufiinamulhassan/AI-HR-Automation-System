"""Company Settings route — hr_module Admin Configuration (MVP2 §2.20 slice).

Two admin-only surfaces, kept together in this one file (rather than a
second file) since both are small, read-mostly admin endpoints with no
shared complexity that would justify a split — this is documented here per
the task's own "small second file if you prefer, your call" note:

  GET   /company-settings                    singleton company profile
                                               (auto-created with blank
                                               defaults on first call)
  PATCH /company-settings                    update the company profile
  GET   /company-settings/integrations-status read-only configured/
                                               not-configured booleans for
                                               every external dependency —
                                               never the secret values
                                               themselves
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from shared.auth import require_admin
from config.database import get_db
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
    if get_db() is None:
        raise HTTPException(503, "Database unavailable")
    return await update_company_settings(
        body.model_dump(exclude_unset=True), updated_by=user.get("email"),
    )


@router.get("/integrations-status")
async def integrations_status_route(_: dict = Depends(require_admin)):
    return await get_integrations_status()
