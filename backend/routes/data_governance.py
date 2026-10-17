from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from config.database import get_db
from services.hr_module import department_access, erasure_service, retention_service
from services.hr_module.audit_service import log_audit_event
from services.hr_module.permissions import get_department_scope
from shared.auth import require_admin, require_permission

router = APIRouter()

_PERMISSION = "candidates:erase"


class EraseRequest(BaseModel):
    reason: str | None = None
    include_employment: bool = False


class EraseByEmailRequest(BaseModel):
    email: str | None = None
    reason: str | None = None
    include_employment: bool = False


class RetentionUpdate(BaseModel):
    candidate_days: int | None = None
    resume_days: int | None = None


def _database():
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    return db


def _reason(raw) -> str:
    try:
        return erasure_service.clean_reason(raw)
    except erasure_service.ErasureError as exc:
        raise HTTPException(exc.status, exc.message)


@router.post("/candidates/erase-by-email")
async def erase_by_email_route(
    body: EraseByEmailRequest,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission(_PERMISSION)),
):
    db = _database()
    reason = _reason(body.reason)
    if await get_department_scope(user) is not None:
        raise HTTPException(403, "Erasing by email covers every job, so it needs access to all departments.")
    try:
        return await erasure_service.erase_by_email(
            db, body.email or "", actor=user, reason=reason, include_employment=body.include_employment,
        )
    except erasure_service.ErasureError as exc:
        raise HTTPException(exc.status, exc.message)


@router.post("/candidates/{candidate_id}/erase")
async def erase_candidate_route(
    candidate_id: str,
    body: EraseRequest,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission(_PERMISSION)),
):
    db = _database()
    reason = _reason(body.reason)
    await department_access.ensure_candidate_in_scope(db, user, candidate_id)
    try:
        return await erasure_service.erase_candidate(
            db, candidate_id, actor=user, reason=reason, include_employment=body.include_employment,
        )
    except erasure_service.ErasureError as exc:
        raise HTTPException(exc.status, exc.message)


@router.get("/company-settings/retention")
async def get_retention(
    _user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission(_PERMISSION)),
):
    db = _database()
    return {**await retention_service.get_policy(db), "last_purge": await retention_service.last_purge(db)}


@router.patch("/company-settings/retention")
async def update_retention(
    body: RetentionUpdate,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission(_PERMISSION)),
):
    db = _database()
    changes = {key: getattr(body, key) for key in body.model_fields_set}
    try:
        before, after = await retention_service.set_policy(db, changes, updated_by=user.get("email"))
    except retention_service.RetentionError as exc:
        raise HTTPException(422, str(exc))
    await log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="retention_update", resource_type="retention", resource_id="singleton",
        details={
            "before": {k: before.get(k) for k in ("candidate_days", "resume_days")},
            "after": {k: after.get(k) for k in ("candidate_days", "resume_days")},
        },
    )
    return {**after, "last_purge": await retention_service.last_purge(db)}
