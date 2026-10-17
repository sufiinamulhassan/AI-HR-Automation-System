from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from config.database import get_db
from shared.auth import require_admin, require_permission
from services.hr_module.audit_service import log_audit_event
from services.hr_module.security_policy_service import get_security_policies, update_security_policies

router = APIRouter()

_PERMISSION = "security:manage"


class SecurityPolicyUpdate(BaseModel):
    password_min_length: int | None = None
    password_require_number: bool | None = None
    password_require_symbol: bool | None = None
    max_login_attempts_before_lockout: int | None = None
    account_lockout_duration_minutes: int | None = None
    session_timeout_minutes: int | None = None


@router.get("")
async def get_security_policies_route(_admin: dict = Depends(require_admin)):
    return await get_security_policies()


@router.patch("")
async def update_security_policies_route(
    body: SecurityPolicyUpdate,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission(_PERMISSION)),
):
    fields = body.model_dump(exclude_unset=True)

    try:
        updated = await update_security_policies(updated_by=user["email"], **fields)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except RuntimeError as exc:
        raise HTTPException(503, str(exc))

    await log_audit_event(
        get_db(), actor_email=user["email"], actor_role=user.get("role"),
        action="security_policy_update", resource_type="security_policy", resource_id="singleton",
        details=fields,
    )
    return updated
