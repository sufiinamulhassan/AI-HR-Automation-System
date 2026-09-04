"""Branding route — hr_module Admin Configuration (MVP2 §2.20 slice:
Branding/White-Labeling).

  GET   /public   UNauthenticated — the login page and public candidate-
                   facing pages (offer acceptance, coding assessment, SSO
                   callback, shared marketplace profile) need the company
                   logo/colors before any user is logged in, so this
                   deliberately has no auth dependency.
  GET   /         admin-only — full singleton doc (incl. updated_at/
                   updated_by), for the admin edit form to prefill/show
                   "last saved" — same shape as company_settings' GET.
  PATCH /         admin-only — update logo URL / primary / accent color.

Kept as its own router (not folded into routes/notification_settings.py)
because its top-level path shape (`/branding/public`, `/branding`) is a
distinct resource from `/notification-settings` — see
routes/notification_settings.py for that one. The frontend combines both
into a single admin page (src/pages/admin/BrandingPage.tsx) purely for UI
convenience; the backend keeps them as two small, single-purpose
routers/services, matching this repo's one-router-per-resource convention
(every other entry in main.py's include_router list follows the same
one-file-one-router shape).
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from shared.auth import require_admin
from services.hr_module.branding_service import (
    get_branding_settings,
    update_branding_settings,
    get_public_branding,
)

router = APIRouter()


class BrandingUpdate(BaseModel):
    company_logo_url: str | None = None
    primary_color: str | None = None
    accent_color: str | None = None


@router.get("/public")
async def get_public_branding_route():
    return await get_public_branding()


@router.get("")
async def get_branding_route(_: dict = Depends(require_admin)):
    return await get_branding_settings()


@router.patch("")
async def update_branding_route(body: BrandingUpdate, user: dict = Depends(require_admin)):
    try:
        return await update_branding_settings(
            body.model_dump(exclude_unset=True), updated_by=user.get("email"),
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))
