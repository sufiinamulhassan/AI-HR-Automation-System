import asyncio

from fastapi import APIRouter, Depends, HTTPException

from config.database import get_db
from services.hr_module.audit_service import log_audit_event
from services.hr_module.user_guide_service import (
    GUIDE_ROLES,
    RoleGuidePayload,
    can_read,
    delete_user_guide,
    get_user_guide,
    list_user_guides,
    publish_user_guide,
    readable_roles,
)
from shared.auth import get_current_user, require_superadmin

router = APIRouter()


@router.get("")
async def list_user_guides_route(user: dict = Depends(get_current_user)):
    if get_db() is None:
        raise HTTPException(503, "Database unavailable")
    role = user.get("role")
    return {"guides": await list_user_guides(role), "roles": readable_roles(role)}


@router.get("/{role}")
async def get_user_guide_route(role: str, user: dict = Depends(get_current_user)):
    if get_db() is None:
        raise HTTPException(503, "Database unavailable")
    if role not in GUIDE_ROLES:
        raise HTTPException(404, "Unknown guide role")
    if not can_read(user.get("role"), role):
        raise HTTPException(403, "This guide is not available for your role")

    guide = await get_user_guide(role)
    if guide is None:
        raise HTTPException(404, "No stored guide for this role")
    return guide


@router.put("/{role}")
async def publish_user_guide_route(
    role: str,
    body: RoleGuidePayload,
    user: dict = Depends(require_superadmin),
):
    if get_db() is None:
        raise HTTPException(503, "Database unavailable")
    if role not in GUIDE_ROLES:
        raise HTTPException(404, "Unknown guide role")

    payload = body.model_dump(exclude_unset=True)
    try:
        guide = await publish_user_guide(role, payload, updated_by=user.get("email"))
    except RuntimeError:
        raise HTTPException(503, "Database unavailable")

    asyncio.create_task(log_audit_event(
        get_db(), actor_email=user.get("email"), actor_role=user.get("role"),
        action="user_guide_publish", resource_type="user_guide", resource_id=role,
        details={"version": guide.get("version"), "chapters": len(guide.get("chapters") or [])},
    ))
    return guide


@router.delete("/{role}")
async def reset_user_guide_route(role: str, user: dict = Depends(require_superadmin)):
    if get_db() is None:
        raise HTTPException(503, "Database unavailable")
    if role not in GUIDE_ROLES:
        raise HTTPException(404, "Unknown guide role")

    was_customized = await delete_user_guide(role)

    asyncio.create_task(log_audit_event(
        get_db(), actor_email=user.get("email"), actor_role=user.get("role"),
        action="user_guide_reset", resource_type="user_guide", resource_id=role,
        details={"was_customized": was_customized},
    ))
    return {"message": "Reset to bundled default", "was_customized": was_customized}
