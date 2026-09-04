"""Saved filter templates — hr_module (MVP2 §2.7).

Lets any recruiter (standard/admin/superadmin — search isn't an admin-only
activity) save and reapply their own search filters against the marketplace
or resumes list endpoints. Each template stores an opaque `filter_params`
blob — this service never interprets, validates, or reads the shape of that
blob, it just round-trips it. That is what lets it work unmodified whichever
list endpoint the caller used (`/marketplace` or `/resumes`) and whatever
params that endpoint accepts, now or added later.
"""
import logging
import uuid
from datetime import datetime, timezone

from config.database import get_db

logger = logging.getLogger(__name__)

COLLECTION = "saved_filter_templates"


async def create_template(
    name: str,
    created_by: str,
    filter_params: dict | None = None,
    scope: str | None = None,
) -> dict:
    """Create a new saved filter template owned by `created_by`."""
    db = get_db()
    if db is None:
        raise RuntimeError("Database unavailable")
    template_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "template_id": template_id,
        "name": name,
        "created_by": created_by,
        "filter_params": filter_params or {},
        "scope": scope,
        "created_at": now,
        "updated_at": now,
    }
    await db[COLLECTION].insert_one(doc)
    doc.pop("_id", None)
    logger.info("Saved filter template created | template_id=%s created_by=%s", template_id, created_by)
    return doc


async def list_templates(created_by: str, scope: str | None = None) -> list[dict]:
    """List templates owned by `created_by` — never another user's."""
    db = get_db()
    if db is None:
        return []
    query: dict = {"created_by": created_by}
    if scope:
        query["scope"] = scope
    cursor = db[COLLECTION].find(query, {"_id": 0}).sort("created_at", -1)
    return await cursor.to_list(length=None)


async def get_template(template_id: str) -> dict | None:
    db = get_db()
    if db is None:
        return None
    return await db[COLLECTION].find_one({"template_id": template_id}, {"_id": 0})


async def update_template(
    template_id: str,
    name: str | None = None,
    filter_params: dict | None = None,
) -> dict | None:
    """Only fields explicitly passed (not None) are updated."""
    db = get_db()
    if db is None:
        return None
    update: dict = {}
    if name is not None:
        update["name"] = name
    if filter_params is not None:
        update["filter_params"] = filter_params
    if not update:
        return await get_template(template_id)
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = await db[COLLECTION].update_one({"template_id": template_id}, {"$set": update})
    if result.matched_count == 0:
        return None
    return await get_template(template_id)


async def delete_template(template_id: str) -> bool:
    db = get_db()
    if db is None:
        return False
    result = await db[COLLECTION].delete_one({"template_id": template_id})
    return result.deleted_count > 0
