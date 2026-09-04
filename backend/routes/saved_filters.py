"""
Saved filter templates route — hr_module (MVP2 §2.7).

Any authenticated user (standard/admin/superadmin) may create and manage
their own saved filters — recruiters, not just admins, run searches day to
day. `filter_params` is stored and returned opaquely: whatever query params
the caller's marketplace/resumes list call used round-trip unchanged, so this
route never needs to know their shape.

  POST   /                    create a saved filter (owned by the caller)
  GET    /                    list the caller's own saved filters (scoped)
  GET    /{template_id}       get one (owner or admin only)
  PATCH  /{template_id}       rename / replace filter_params (owner or admin)
  DELETE /{template_id}       delete (owner or admin)
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from shared.auth import get_current_user
from services.hr_module import saved_filter_service

router = APIRouter()


class SavedFilterCreate(BaseModel):
    name: str
    filter_params: dict = {}
    scope: str | None = None


class SavedFilterUpdate(BaseModel):
    name: str | None = None
    filter_params: dict | None = None


def _assert_owner_or_admin(template: dict, user: dict) -> None:
    if template.get("created_by") == user.get("email"):
        return
    if user.get("role") in ("admin", "superadmin"):
        return
    raise HTTPException(403, "Not your saved filter")


@router.post("")
async def create_saved_filter(body: SavedFilterCreate, user: dict = Depends(get_current_user)):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "name is required")
    return await saved_filter_service.create_template(
        name=name,
        created_by=user["email"],
        filter_params=body.filter_params,
        scope=body.scope,
    )


@router.get("")
async def list_saved_filters(scope: str | None = None, user: dict = Depends(get_current_user)):
    """Scoped strictly to the requesting user's own saved filters."""
    templates = await saved_filter_service.list_templates(created_by=user["email"], scope=scope)
    return {"templates": templates, "total": len(templates)}


@router.get("/{template_id}")
async def get_saved_filter(template_id: str, user: dict = Depends(get_current_user)):
    template = await saved_filter_service.get_template(template_id)
    if not template:
        raise HTTPException(404, "Saved filter not found")
    _assert_owner_or_admin(template, user)
    return template


@router.patch("/{template_id}")
async def update_saved_filter(
    template_id: str, body: SavedFilterUpdate, user: dict = Depends(get_current_user)
):
    template = await saved_filter_service.get_template(template_id)
    if not template:
        raise HTTPException(404, "Saved filter not found")
    _assert_owner_or_admin(template, user)
    updated = await saved_filter_service.update_template(
        template_id, name=body.name, filter_params=body.filter_params
    )
    if not updated:
        raise HTTPException(404, "Saved filter not found")
    return updated


@router.delete("/{template_id}")
async def delete_saved_filter(template_id: str, user: dict = Depends(get_current_user)):
    template = await saved_filter_service.get_template(template_id)
    if not template:
        raise HTTPException(404, "Saved filter not found")
    _assert_owner_or_admin(template, user)
    await saved_filter_service.delete_template(template_id)
    return {"message": "Saved filter deleted"}
