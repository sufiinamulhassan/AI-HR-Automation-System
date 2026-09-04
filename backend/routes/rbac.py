"""RBAC management route — hr_module (MVP2 §2.1).

Realistic scope (see docs/report.md §3 / docs/MVP2.md §2.1): a genuine
Role/Permission model and audit log on top of the existing 3 flat roles
(standard/admin/superadmin) — NOT a full multi-tenant company/branch
hierarchy, which is a separate, larger effort.

    GET    /permissions            the full permission catalog          (admin read)
    GET    /roles                  custom roles + built-in defaults     (admin read)
    GET    /roles/{role_name}      one role (custom, or built-in default) (admin read)
    POST   /roles                  create a custom role                 (superadmin)
    PATCH  /roles/{role_name}      update a custom role                 (superadmin)
    DELETE /roles/{role_name}      delete a custom role                 (superadmin)
    PATCH  /users/{email}/role     assign a role (built-in or custom)   (superadmin)
    GET    /audit-log              paginated audit log                  (admin read)
    GET    /audit-log/facets       distinct actions/resources/actors    (admin read)

Access is enforced via `require_permission` (shared/auth.py), not hardcoded
require_admin/require_superadmin — "admin read / superadmin mutate" falls
out naturally from DEFAULT_ROLE_PERMISSIONS (services/hr_module/permissions.py):
admin has rbac:read + audit:read but not rbac:manage; only superadmin has
rbac:manage. This means the read/mutate split here is itself governed by the
same permission system this route manages — if a superadmin edits the
"admin" role's default permission set via a custom role document, that
change takes effect here too.
"""
import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

from shared.auth import require_permission
from config.database import get_db
from services.hr_module.permissions import PERMISSION_CATALOG, DEFAULT_ROLE_PERMISSIONS, is_known_role
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
async def list_roles(_: dict = Depends(require_permission("rbac:read"))):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    custom_roles = await db.roles.find({}, {"_id": 0}).sort("role_name", 1).to_list(length=200)
    return {"custom_roles": custom_roles, "built_in_defaults": DEFAULT_ROLE_PERMISSIONS}


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
            "description": "Built-in role — default permission set, no custom override exists yet.",
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

    asyncio.create_task(log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="role_create", resource_type="role", resource_id=body.role_name,
        details={"permissions": body.permissions},
    ))
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
            "Custom role not found — built-in roles have no override document yet; "
            "POST /rbac/roles with this role_name to create one",
        )

    asyncio.create_task(log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="role_update", resource_type="role", resource_id=role_name,
        details=update,
    ))
    return {"message": "Updated"}


@router.delete("/roles/{role_name}")
async def delete_role(role_name: str, user: dict = Depends(require_permission("rbac:manage"))):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    result = await db.roles.delete_one({"role_name": role_name})
    if result.deleted_count == 0:
        raise HTTPException(404, "Custom role not found")

    asyncio.create_task(log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="role_delete", resource_type="role", resource_id=role_name,
        details={},
    ))
    return {"message": "Deleted"}


@router.patch("/users/{email}/role")
async def assign_user_role(email: str, body: AssignRoleRequest, user: dict = Depends(require_permission("rbac:manage"))):
    """Reuses the existing `users.role` string field — no schema change, and
    nothing about login or the existing require_admin/require_superadmin
    checks changes. `role_name` may be one of the 3 built-ins or any custom
    role already created via POST /rbac/roles.
    """
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    target = await db.users.find_one({"email": email})
    if not target:
        raise HTTPException(404, "User not found")

    if not await is_known_role(db, body.role_name):
        raise HTTPException(400, f"Unknown role: {body.role_name}")

    await db.users.update_one({"email": email}, {"$set": {"role": body.role_name}})

    asyncio.create_task(log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="user_role_assign", resource_type="user", resource_id=email,
        details={"old_role": target.get("role"), "new_role": body.role_name},
    ))
    return {"email": email, "role": body.role_name}


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
    """Distinct actions / resource types / actors currently in the log, so the
    audit filter bar can offer real choices instead of free-text guesswork.

    Declared after GET /audit-log but on a distinct literal path, so ordering
    between the two is irrelevant — neither has a path parameter to greedily
    capture the other.
    """
    return await audit_log_facets()
