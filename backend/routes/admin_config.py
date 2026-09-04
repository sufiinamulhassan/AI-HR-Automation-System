"""Admin configuration route — Departments and Designations CRUD.

The first slice of MVP2's Admin Configuration area (company/department/
designation entities) — kept intentionally minimal (name + description,
no company/branch scoping) so it doesn't overreach into the RBAC/multi-tenant
work that's scoped separately.

REFERENTIAL INTEGRITY: a department is pointed at from three places, and by two
different keys — designations store the department NAME, while jobs and users
store the department_id. Both a delete and a rename used to be silent
data corruption: deleting left designations naming a department that no longer
existed and, worse, left scoped users pointing at a dangling department_id,
which services.hr_module.permissions.get_department_scope turns into "sees
almost nothing" rather than an error anyone would notice. So:
  - GET /departments reports a `usage` breakdown per department;
  - DELETE refuses with 409 while a department is referenced (?force=true
    overrides, detaching designations as it goes);
  - PATCH cascades a rename to the designations that referenced the old name.
"""
import asyncio
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pymongo.errors import DuplicateKeyError

from shared.auth import get_current_user, require_admin
from shared.schemas import DepartmentCreate, DepartmentUpdate, DesignationCreate, DesignationUpdate
from config.database import get_db
from services.hr_module.audit_service import log_audit_event

router = APIRouter()


_ID_REFERENCES = (
    ("jobs", "jobs", "department_id"),
    ("users", "users", "department_id"),
)


async def _count_by(db, collection: str, field: str) -> dict[str, int]:
    """{field value: count} for every non-null value of `field`."""
    cursor = db[collection].aggregate([
        {"$match": {field: {"$ne": None}}},
        {"$group": {"_id": f"${field}", "n": {"$sum": 1}}},
    ])
    return {row["_id"]: row["n"] async for row in cursor if row["_id"]}


async def _usage_index(db) -> tuple[dict[str, int], dict[str, dict[str, int]]]:
    """Reference counts for ALL departments in a fixed number of queries.

    Returns (by_name, by_id) — by_name counts designations, by_id counts the
    department_id-keyed collections. Four aggregations regardless of how many
    departments exist, rather than a per-department fan-out.
    """
    by_name = await _count_by(db, "designations", "department")
    by_id: dict[str, dict[str, int]] = {}
    for key, collection, field in _ID_REFERENCES:
        for dept_id, n in (await _count_by(db, collection, field)).items():
            by_id.setdefault(dept_id, {})[key] = n
    return by_name, by_id


def _usage_for(dept: dict, by_name: dict[str, int], by_id: dict[str, dict[str, int]]) -> dict[str, int]:
    usage = {"designations": by_name.get(dept.get("name"), 0)}
    counts = by_id.get(dept.get("department_id"), {})
    for key, _, _ in _ID_REFERENCES:
        usage[key] = counts.get(key, 0)
    usage["total"] = sum(v for k, v in usage.items() if k != "total")
    return usage


def _usage_summary(usage: dict[str, int]) -> str:
    parts = [f"{n} {key}" for key, n in usage.items() if key != "total" and n]
    return ", ".join(parts)


@router.get("/departments")
async def list_departments(user: dict = Depends(get_current_user)):
    """For an admin, each department carries a `usage` breakdown so the caller
    can see what a delete would break before attempting one (additive field —
    callers that only read name/description are unaffected).

    Usage is admin-only. This endpoint stays readable by any authenticated user
    (job/candidate forms populate their department picker from it), and headcount
    per department is not something every user needs to be handed.
    """
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    departments = await db.departments.find({}, {"_id": 0}).sort("name", 1).to_list(length=500)
    if user.get("role") in ("admin", "superadmin"):
        by_name, by_id = await _usage_index(db)
        for dept in departments:
            dept["usage"] = _usage_for(dept, by_name, by_id)
    return {"departments": departments}


@router.post("/departments")
async def create_department(body: DepartmentCreate, user: dict = Depends(require_admin)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    doc = {
        "department_id": str(uuid.uuid4()),
        "name": body.name,
        "description": body.description,
        "created_by": user["email"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        await db.departments.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(409, "A department with this name already exists")
    doc.pop("_id", None)

    asyncio.create_task(log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="department_create", resource_type="department", resource_id=doc["department_id"],
        details={"name": body.name},
    ))
    return doc


@router.patch("/departments/{department_id}")
async def update_department(department_id: str, body: DepartmentUpdate, user: dict = Depends(require_admin)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    update = {k: v for k, v in body.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(400, "No fields to update")

    existing = await db.departments.find_one({"department_id": department_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Department not found")

    old_name = existing.get("name")
    new_name = update.get("name")
    try:
        await db.departments.update_one({"department_id": department_id}, {"$set": update})
    except DuplicateKeyError:
        raise HTTPException(409, "A department with this name already exists")

    renamed = 0
    if new_name and new_name != old_name:
        result = await db.designations.update_many(
            {"department": old_name}, {"$set": {"department": new_name}}
        )
        renamed = result.modified_count

    asyncio.create_task(log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="department_update", resource_type="department", resource_id=department_id,
        details={**update, **({"designations_renamed": renamed} if renamed else {})},
    ))
    return {"message": "Updated", "designations_renamed": renamed}


@router.delete("/departments/{department_id}")
async def delete_department(
    department_id: str,
    force: bool = False,
    user: dict = Depends(require_admin),
):
    """Refuses (409) while anything still references the department.

    `force=true` deletes anyway and detaches the designations that named it —
    the id-keyed references (jobs, users) are left as they are, since
    rewriting them is a data decision this endpoint should not make silently.
    The 409 detail names the counts so the caller can decide.
    """
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    dept = await db.departments.find_one({"department_id": department_id}, {"_id": 0})
    if not dept:
        raise HTTPException(404, "Department not found")

    by_name, by_id = await _usage_index(db)
    usage = _usage_for(dept, by_name, by_id)
    if usage["total"] and not force:
        raise HTTPException(
            409,
            f"Department \"{dept['name']}\" is still referenced by {_usage_summary(usage)}. "
            "Reassign them first, or repeat this request with force=true.",
        )

    detached = 0
    if usage["designations"]:
        result = await db.designations.update_many(
            {"department": dept["name"]}, {"$set": {"department": None}}
        )
        detached = result.modified_count

    await db.departments.delete_one({"department_id": department_id})

    asyncio.create_task(log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="department_delete", resource_type="department", resource_id=department_id,
        details={"name": dept.get("name"), "forced": force, "usage": usage},
    ))
    return {"message": "Deleted", "designations_detached": detached, "usage": usage}


@router.get("/designations")
async def list_designations(_: dict = Depends(get_current_user)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    return {"designations": await db.designations.find({}, {"_id": 0}).sort("name", 1).to_list(length=500)}


@router.post("/designations")
async def create_designation(body: DesignationCreate, user: dict = Depends(require_admin)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    doc = {
        "designation_id": str(uuid.uuid4()),
        "name": body.name,
        "department": body.department,
        "description": body.description,
        "created_by": user["email"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        await db.designations.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(409, "A designation with this name already exists")
    doc.pop("_id", None)

    asyncio.create_task(log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="designation_create", resource_type="designation", resource_id=doc["designation_id"],
        details={"name": body.name, "department": body.department},
    ))
    return doc


@router.patch("/designations/{designation_id}")
async def update_designation(designation_id: str, body: DesignationUpdate, user: dict = Depends(require_admin)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    update = {k: v for k, v in body.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(400, "No fields to update")
    try:
        result = await db.designations.update_one({"designation_id": designation_id}, {"$set": update})
    except DuplicateKeyError:
        raise HTTPException(409, "A designation with this name already exists")
    if result.matched_count == 0:
        raise HTTPException(404, "Designation not found")

    asyncio.create_task(log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="designation_update", resource_type="designation", resource_id=designation_id,
        details=update,
    ))
    return {"message": "Updated"}


@router.delete("/designations/{designation_id}")
async def delete_designation(designation_id: str, user: dict = Depends(require_admin)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    result = await db.designations.delete_one({"designation_id": designation_id})
    if result.deleted_count == 0:
        raise HTTPException(404, "Designation not found")

    asyncio.create_task(log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="designation_delete", resource_type="designation", resource_id=designation_id,
        details={},
    ))
    return {"message": "Deleted"}
