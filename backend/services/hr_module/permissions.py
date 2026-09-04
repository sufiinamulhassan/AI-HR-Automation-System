"""Permission catalog, default role->permission mappings, and role resolution
for the RBAC system (MVP2 §2.1 — see docs/report.md §3 for the scoping note).

Deliberately realistic scope for this pass: this gives the app a genuine
Role/Permission model on top of the existing 3 flat role strings
(standard/admin/superadmin) plus admin-authored custom roles stored in the
`roles` collection. It does NOT attempt department/branch/company scoping or
multi-tenant support — every permission here is global, not scoped to a
department. That is an explicitly separate, larger effort (see MVP2.md §2.1
"Build" notes) left for a future pass.

Two building blocks:
  - PERMISSION_CATALOG / DEFAULT_ROLE_PERMISSIONS: static, in-process data —
    no DB round trip needed to know what a *default* role can do.
  - resolve_permissions(role_name): the one function everything else in the
    app should call to find out what a role can actually do right now, since
    it also accounts for any custom role document that overrides/extends a
    role's permissions.
"""
import logging

from config.database import get_db

logger = logging.getLogger(__name__)


PERMISSION_CATALOG: list[str] = [
    "jobs:read", "jobs:create", "jobs:update", "jobs:delete",
    "jobs:import", "jobs:manage_settings",

    "resumes:read", "resumes:upload", "resumes:delete",

    "intel:read", "intel:bulk_upload", "intel:purge",

    "candidates:read", "candidates:invite", "candidates:resend_invite",
    "candidates:decide", "candidates:send_email",

    "interview:read_report", "interview:schedule",

    "coding:read", "coding:manage", "coding:read_submissions",

    "scenarios:read", "scenarios:manage",

    "offers:read", "offers:create", "offers:approve", "offers:send", "offers:withdraw",

    "analytics:read",

    "workflows:manage",

    "webhooks:manage",

    "departments:manage", "designations:manage",

    "departments:cross_scope",

    "users:manage",
    "rbac:read", "rbac:manage",
    "audit:read",
]

_PERMISSION_SET: set[str] = set(PERMISSION_CATALOG)

_STANDARD_PERMISSIONS: set[str] = {
    "jobs:read", "resumes:read", "intel:read", "candidates:read",
    "coding:read", "scenarios:read",
    "offers:read", "analytics:read",
}

_ADMIN_EXCLUDED: set[str] = {"users:manage", "rbac:manage"}

DEFAULT_ROLE_PERMISSIONS: dict[str, list[str]] = {
    "standard": sorted(_STANDARD_PERMISSIONS),
    "admin": sorted(_PERMISSION_SET - _ADMIN_EXCLUDED),
    "superadmin": sorted(_PERMISSION_SET),
}


async def resolve_permissions(role_name: str) -> list[str]:
    """Effective permission list for a role name, right now.

    Looks up a custom role document in the `roles` collection first (an
    admin/superadmin-authored override of a built-in role, or an entirely
    custom role) — falls back to DEFAULT_ROLE_PERMISSIONS if no such document
    exists, so the three built-in roles (standard/admin/superadmin) keep
    working exactly as before with zero custom-role setup required.

    Never raises: a DB error degrades to the static defaults (logged, not
    fatal) rather than locking every request out with a 500. An unknown role
    name with no custom doc and no default resolves to an empty permission
    list (fail closed), not an exception.
    """
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


async def is_known_role(db, role_name: str) -> bool:
    """True if `role_name` is one of the 3 built-ins or an existing custom role.

    Single source of truth for "is this a role name you're allowed to assign?",
    shared by the two endpoints that write `users.role` — PATCH
    /rbac/users/{email}/role and PATCH /auth/users/{email} — so the two paths
    can never drift apart on which role names they accept.
    """
    if role_name in DEFAULT_ROLE_PERMISSIONS:
        return True
    if db is None:
        return False
    return await db.roles.find_one({"role_name": role_name}) is not None


async def get_department_scope(user: dict) -> str | None:
    """Department/branch scoping check (MVP2 §2.1).

    Returns the department_id a user's visibility should be restricted to,
    or None if they should see everything (unrestricted) — either because
    their role's permission set includes "departments:cross_scope" (true by
    default for admin/superadmin, exactly matching pre-existing behaviour),
    or because the user simply has no department_id set (an install that
    never assigns departments to users keeps working exactly as before,
    with nobody scoped).

    Route handlers that want department-based filtering should call this
    once per request and, if it returns a non-None value, add a
    `{"department_id": scope}` (or equivalent) clause to their query —
    this function only resolves the scope, it does not filter anything
    itself, since the right query shape differs per collection.
    """
    department_id = user.get("department_id")
    if not department_id:
        return None
    permissions = await resolve_permissions(user.get("role"))
    if "departments:cross_scope" in permissions:
        return None
    return department_id
