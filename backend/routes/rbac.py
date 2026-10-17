from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

from shared.auth import require_permission
from config.database import get_db
from services.hr_module.account_protection_service import (
    check_account_change, customer_accounts, find_user, platform_owner_refusal,
)
from services.hr_module.permissions import (
    PERMISSION_CATALOG,
    DEFAULT_ROLE_PERMISSIONS,
    is_known_role,
    is_reserved_role_name,
)
from services.hr_module.audit_service import audit_log_facets, log_audit_event, query_audit_log

router = APIRouter()

_PERMISSION_SET = set(PERMISSION_CATALOG)


class RoleCreate(BaseModel):
    role_name: str
    permissions: list[str] = Field(default_factory=list)
    description: str | None = None


class RoleUpdate(BaseModel):
    permissions: list[str] | None = None
    description: str | None = None


class AssignRoleRequest(BaseModel):
    role_name: str


def _validate_permissions(permissions: list[str]) -> None:
    invalid = sorted(set(permissions) - _PERMISSION_SET)
    if invalid:
        raise HTTPException(400, f"Unknown permission(s): {invalid}")


@router.get("/permissions")
async def get_permission_catalog(_: dict = Depends(require_permission("rbac:read"))):
    return {"permissions": PERMISSION_CATALOG, "default_role_permissions": DEFAULT_ROLE_PERMISSIONS}


@router.get("/roles")
async def list_roles(user: dict = Depends(require_permission("rbac:read"))):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    custom_roles = await db.roles.find({}, {"_id": 0}).sort("role_name", 1).to_list(length=200)
    held = {
        row["_id"]: row["count"]
        async for row in db.users.aggregate([
            {"$match": customer_accounts(user)},
            {"$group": {"_id": "$role", "count": {"$sum": 1}}},
        ])
    }
    for role in custom_roles:
        role["user_count"] = held.get(role.get("role_name"), 0)
    return {
        "custom_roles": custom_roles,
        "built_in_defaults": DEFAULT_ROLE_PERMISSIONS,
        "user_counts": {name: held.get(name, 0) for name in [*DEFAULT_ROLE_PERMISSIONS, *[r["role_name"] for r in custom_roles]]},
    }


@router.get("/roles/{role_name}")
async def get_role(role_name: str, _: dict = Depends(require_permission("rbac:read"))):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    custom = await db.roles.find_one({"role_name": role_name}, {"_id": 0})
    if custom:
        return custom
    if role_name in DEFAULT_ROLE_PERMISSIONS:
        return {
            "role_name": role_name,
            "permissions": DEFAULT_ROLE_PERMISSIONS[role_name],
            "description": "Built-in role: default permission set, no custom override exists yet.",
            "is_builtin_default": True,
        }
    raise HTTPException(404, "Role not found")


@router.post("/roles")
async def create_role(body: RoleCreate, user: dict = Depends(require_permission("rbac:manage"))):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    if not body.role_name or not body.role_name.strip():
        raise HTTPException(400, "role_name is required")
    if is_reserved_role_name(body.role_name):
        raise HTTPException(
            400, "This role name is reserved for a built-in role. Choose a different name.",
        )
    _validate_permissions(body.permissions)

    doc = {
        "role_name": body.role_name,
        "permissions": body.permissions,
        "description": body.description,
        "created_by": user["email"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        await db.roles.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(409, "A role with this name already exists")
    doc.pop("_id", None)

    await log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="role_create", resource_type="role", resource_id=body.role_name,
        details={"permissions": body.permissions},
    )
    return doc


@router.patch("/roles/{role_name}")
async def update_role(role_name: str, body: RoleUpdate, user: dict = Depends(require_permission("rbac:manage"))):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    update = {k: v for k, v in body.model_dump().items() if v is not None}
    if "permissions" in update:
        _validate_permissions(update["permissions"])
    if not update:
        raise HTTPException(400, "No fields to update")
    update["updated_at"] = datetime.now(timezone.utc).isoformat()

    result = await db.roles.update_one({"role_name": role_name}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(
            404,
            "Custom role not found: built-in roles cannot be edited here, "
            "only roles created through POST /rbac/roles",
        )

    await log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="role_update", resource_type="role", resource_id=role_name,
        details=update,
    )
    return {"message": "Updated"}


@router.delete("/roles/{role_name}")
async def delete_role(
    role_name: str,
    reassign_to: str | None = None,
    user: dict = Depends(require_permission("rbac:manage")),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    if not await db.roles.find_one({"role_name": role_name}, {"_id": 1}):
        raise HTTPException(404, "Custom role not found")

    holding = await db.users.count_documents({"role": role_name})
    reassigned = 0
    if holding:
        target = (reassign_to or "").strip()
        if not target:
            noun = "user holds" if holding == 1 else "users hold"
            return JSONResponse(
                status_code=409,
                content={
                    "detail": f"{holding} {noun} this role. Choose a role to move them to before deleting it.",
                    "users_holding": holding,
                },
            )
        if target == role_name:
            raise HTTPException(400, "Choose a different role to move these users to.")
        if not await is_known_role(db, target):
            raise HTTPException(400, f"Unknown role: {target}")
        moved = await db.users.update_many({"role": role_name}, {"$set": {"role": target}})
        reassigned = moved.modified_count

    await db.roles.delete_one({"role_name": role_name})

    await log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="role_delete", resource_type="role", resource_id=role_name,
        details={"reassigned": reassigned, "reassigned_to": (reassign_to or None) if reassigned else None},
    )
    return {"deleted": True, "reassigned": reassigned}


@router.patch("/users/{email}/role")
async def assign_user_role(email: str, body: AssignRoleRequest, user: dict = Depends(require_permission("rbac:manage"))):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    target = await find_user(db, email)
    if not target:
        raise HTTPException(404, "User not found")
    if refusal := platform_owner_refusal(user, target):
        raise HTTPException(403, refusal)

    if not await is_known_role(db, body.role_name):
        raise HTTPException(400, f"Unknown role: {body.role_name}")

    refusal = await check_account_change(db, actor=user, target=target, new_role=body.role_name)
    if refusal:
        raise HTTPException(409, refusal)

    await db.users.update_one({"email": target["email"]}, {"$set": {"role": body.role_name}})

    await log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="user_role_assign", resource_type="user", resource_id=target["email"],
        details={"old_role": target.get("role"), "new_role": body.role_name},
    )
    return {"email": target["email"], "role": body.role_name}


@router.get("/audit-log")
async def get_audit_log(
    actor_email: str | None = None,
    action: str | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    page: int = 1,
    limit: int = 50,
    _: dict = Depends(require_permission("audit:read")),
):
    return await query_audit_log(
        filters={
            "actor_email": actor_email,
            "action": action,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "start_date": start_date,
            "end_date": end_date,
        },
        page=page,
        limit=limit,
    )


@router.get("/audit-log/facets")
async def get_audit_log_facets(_: dict = Depends(require_permission("audit:read"))):
    return await audit_log_facets()
