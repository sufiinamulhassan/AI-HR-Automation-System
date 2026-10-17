from fastapi import APIRouter, Depends, HTTPException

from config.database import get_db
from services.hr_module.attention_service import KEYS, build_attention, list_attention
from services.hr_module.department_access import scoped_job_ids
from services.hr_module.permissions import get_department_scope
from shared.auth import require_admin, require_permission

router = APIRouter()


async def _visible_job_ids(db, user: dict) -> list[str] | None:
    scope = await get_department_scope(user)
    return None if scope is None else await scoped_job_ids(db, scope)


@router.get("")
async def get_attention(
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("attention:read")),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    return await build_attention(db, job_ids=await _visible_job_ids(db, user))


@router.get("/{key}")
async def get_attention_items(
    key: str,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("attention:read")),
):
    if key not in KEYS:
        raise HTTPException(404, "Unknown attention item")
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    return await list_attention(db, key, job_ids=await _visible_job_ids(db, user))
