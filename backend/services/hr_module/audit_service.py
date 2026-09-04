"""AuditLog service — hr_module RBAC (MVP2 §2.1).

log_audit_event() is intentionally best-effort / fire-and-forget-safe: every
call site schedules it via `asyncio.create_task(log_audit_event(...))`
(never awaited inline — same fire-and-forget contract as
`evaluate_and_apply_rules` in workflow_engine.py), so a slow or failing audit
write can never block or fail the request that triggered it. This function
must therefore never raise.

Scope note (see docs/report.md §3): this pass wires audit logging into user
create/update/delete (routes/auth.py) and department/designation
create/update/delete (routes/admin_config.py) plus RBAC's own role
create/update/delete and role-assignment endpoints (routes/rbac.py) — not
every mutating endpoint in the app. `log_audit_event` is a plain reusable
async function; adding a call at any other mutation site later is a one-line
change.
"""
import logging
import re
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

_DATE_ONLY = re.compile(r"^\d{4}-\d{2}-\d{2}$")

_END_OF_DAY = "T23:59:59.999999Z"


async def log_audit_event(
    db,
    actor_email: str | None,
    actor_role: str | None,
    action: str,
    resource_type: str,
    resource_id: str | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    """Best-effort audit write. Never raises — logs and swallows on failure.

    `db` is passed in explicitly (rather than calling get_db() internally)
    so callers that already hold a `db` handle (the common case — every
    route already fetched it) don't pay a second lookup, and so this
    function degrades identically whether `db` is None because the caller
    couldn't get one, or because Mongo is genuinely unavailable.
    """
    if db is None:
        logger.warning("log_audit_event skipped — database unavailable (action=%s)", action)
        return
    try:
        await db.audit_log.insert_one({
            "actor_email": actor_email,
            "actor_role": actor_role,
            "action": action,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "details": details or {},
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception as exc:
        logger.warning("log_audit_event failed (non-fatal, action=%s): %s", action, exc)


def _icontains(value: str) -> dict[str, str]:
    """Case-insensitive substring match. The value is a user-supplied filter
    string, so it is escaped — an actor email or action name must never be
    interpretable as a regex.
    """
    return {"$regex": re.escape(value.strip()), "$options": "i"}


def _created_at_range(start_date: str | None, end_date: str | None) -> dict[str, str]:
    """Build the `created_at` range clause from two ISO-8601 filter values.

    A date-only `end_date` ("2026-08-07" — what the UI's date input submits)
    is widened to the end of that day. Compared raw it would exclude every
    entry on that date, since "2026-08-07T09:15:00+00:00" > "2026-08-07".
    A date-only `start_date` needs no adjustment: it already sorts below
    every timestamp within its day.
    """
    clause: dict[str, str] = {}
    if start_date:
        clause["$gte"] = start_date.strip()
    if end_date:
        end = end_date.strip()
        clause["$lte"] = end + _END_OF_DAY if _DATE_ONLY.match(end) else end
    return clause


async def query_audit_log(filters: dict[str, Any] | None, page: int = 1, limit: int = 50) -> dict:
    """Paginated audit_log read. Supports filtering by actor_email, action,
    resource_type, resource_id, and a created_at date range
    (start_date/end_date, ISO 8601 strings — audit_log.created_at is stored as
    an ISO string like every other timestamped collection in this codebase, so
    string range queries sort correctly).

    actor_email / action / resource_id match as case-insensitive substrings so
    the UI's free-text boxes behave like search rather than demanding an exact
    value; resource_type comes from a fixed facet list and matches exactly.
    """
    from config.database import get_db

    db = get_db()
    if db is None:
        return {"items": [], "total": 0, "page": page, "limit": limit}

    filters = filters or {}
    query: dict[str, Any] = {}
    if filters.get("actor_email"):
        query["actor_email"] = _icontains(filters["actor_email"])
    if filters.get("action"):
        query["action"] = _icontains(filters["action"])
    if filters.get("resource_id"):
        query["resource_id"] = _icontains(filters["resource_id"])
    if filters.get("resource_type"):
        query["resource_type"] = filters["resource_type"]

    date_range = _created_at_range(filters.get("start_date"), filters.get("end_date"))
    if date_range:
        query["created_at"] = date_range

    page = max(page, 1)
    limit = max(min(limit, 200), 1)

    try:
        total = await db.audit_log.count_documents(query)
        cursor = (
            db.audit_log.find(query, {"_id": 0})
            .sort("created_at", -1)
            .skip((page - 1) * limit)
            .limit(limit)
        )
        items = await cursor.to_list(length=limit)
    except Exception as exc:
        logger.warning("query_audit_log failed: %s", exc)
        return {"items": [], "total": 0, "page": page, "limit": limit}

    return {"items": items, "total": total, "page": page, "limit": limit}


async def audit_log_facets(actor_limit: int = 200) -> dict:
    """Distinct values available as audit-log filters.

    Lets the UI offer real dropdowns for `action` and `resource_type` instead
    of asking an operator to type a value they can only learn by guessing.
    Degrades to empty lists on any failure — a filter bar with no suggestions
    is still usable, an erroring one is not.
    """
    from config.database import get_db

    db = get_db()
    empty = {"actions": [], "resource_types": [], "actors": []}
    if db is None:
        return empty

    try:
        actions = await db.audit_log.distinct("action")
        resource_types = await db.audit_log.distinct("resource_type")
        actors = await db.audit_log.distinct("actor_email")
    except Exception as exc:
        logger.warning("audit_log_facets failed: %s", exc)
        return empty

    def _clean(values: list) -> list[str]:
        return sorted({str(v) for v in values if v})

    return {
        "actions": _clean(actions),
        "resource_types": _clean(resource_types),
        "actors": _clean(actors)[:actor_limit],
    }
