import logging

from config.database import get_db

logger = logging.getLogger(__name__)


PERMISSION_CATALOG: list[str] = [
    "jobs:read", "jobs:create", "jobs:update", "jobs:delete",
    "jobs:import", "jobs:manage_settings",
    "jobs:ai_fit_opinion", "jobs:bulk_stage",

    "resumes:read", "resumes:upload", "resumes:delete",

    "intel:read", "intel:bulk_upload", "intel:purge",

    "candidates:read", "candidates:invite", "candidates:resend_invite",
    "candidates:decide", "candidates:send_email",
    "candidates:erase",

    "interview:read_report", "interview:schedule",
    "interview:share_report",
    "interview:external_schedule", "interview:external_review",

    "coding:read", "coding:manage", "coding:read_submissions",

    "scenarios:read", "scenarios:manage",

    "offers:read", "offers:create", "offers:approve", "offers:send", "offers:withdraw",

    "offers:draft_letter", "offers:approve_letter",
    "offers:manage_letterhead", "offers:manage_signature",

    "analytics:read",

    "attention:read",

    "demographics:read",

    "cost:read",

    "workflows:manage",

    "webhooks:manage",

    "departments:manage", "designations:manage", "job_grades:manage",

    "departments:cross_scope",

    "users:manage",
    "rbac:read", "rbac:manage",
    "audit:read",

    "security:manage",

    "email:manage",

    "performance:manage", "performance:review", "performance:read",

    "hrms:read", "hrms:manage",
]

_PERMISSION_SET: set[str] = set(PERMISSION_CATALOG)

_STANDARD_PERMISSIONS: set[str] = {
    "jobs:read", "resumes:read", "intel:read", "candidates:read",
    "coding:read", "scenarios:read",
    "offers:read", "analytics:read", "hrms:read",
}

_ADMIN_EXCLUDED: set[str] = {"users:manage", "rbac:manage", "security:manage", "candidates:erase"}

DEFAULT_ROLE_PERMISSIONS: dict[str, list[str]] = {
    "standard": sorted(_STANDARD_PERMISSIONS),
    "admin": sorted(_PERMISSION_SET - _ADMIN_EXCLUDED),
    "superadmin": sorted(_PERMISSION_SET),
}


async def resolve_permissions(role_name: str) -> list[str]:
    if not role_name:
        return []

    try:
        db = get_db()
        if db is not None:
            custom = await db.roles.find_one({"role_name": role_name}, {"_id": 0})
            if custom and isinstance(custom.get("permissions"), list):
                return custom["permissions"]
    except Exception as exc:
        logger.warning(
            "resolve_permissions custom-role lookup failed for role=%s (falling back to defaults): %s",
            role_name, exc,
        )

    return DEFAULT_ROLE_PERMISSIONS.get(role_name, [])


def is_reserved_role_name(role_name: str | None) -> bool:
    return (role_name or "").strip().lower() in DEFAULT_ROLE_PERMISSIONS


async def is_known_role(db, role_name: str) -> bool:
    if role_name in DEFAULT_ROLE_PERMISSIONS:
        return True
    if db is None:
        return False
    return await db.roles.find_one({"role_name": role_name}) is not None


async def get_department_scope(user: dict) -> str | None:
    department_id = user.get("department_id")
    if not department_id:
        return None
    permissions = await resolve_permissions(user.get("role"))
    if "departments:cross_scope" in permissions:
        return None
    return department_id
