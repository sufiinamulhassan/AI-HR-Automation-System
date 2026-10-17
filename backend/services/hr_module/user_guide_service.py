import logging
from datetime import datetime, timezone

from pydantic import BaseModel, ConfigDict

from config.database import get_db
from shared.utils import mongo_doc

logger = logging.getLogger(__name__)

GUIDE_ROLES: tuple[str, ...] = ("standard", "admin", "superadmin")

ROLE_RANK: dict[str, int] = {"standard": 1, "admin": 2, "superadmin": 3}

_SERVER_OWNED_FIELDS = frozenset({"_id", "role", "version", "created_at", "updated_at", "updated_by"})


class _GuideNode(BaseModel):
    model_config = ConfigDict(extra="allow")


class GuideControl(_GuideNode):
    name: str
    kind: str | None = None
    what: str
    how: str | None = None
    access: str | None = None


class GuideFaq(_GuideNode):
    q: str
    a: str


class GuideSubsection(_GuideNode):
    id: str
    title: str
    body: list[str] | None = None
    steps: list[str] | None = None
    controls: list[GuideControl] | None = None
    tips: list[str] | None = None
    warnings: list[str] | None = None
    faqs: list[GuideFaq] | None = None


class GuideSection(_GuideNode):
    id: str
    title: str
    path: str | None = None
    summary: str
    access: str | None = None
    subsections: list[GuideSubsection] = []


class GuideChapter(_GuideNode):
    id: str
    title: str
    blurb: str | None = None
    sections: list[GuideSection] = []


class RoleGuidePayload(_GuideNode):
    role: str | None = None
    label: str
    tagline: str
    intro: list[str] = []
    chapters: list[GuideChapter] = []


def readable_roles(viewer_role: str | None) -> list[str]:
    rank = ROLE_RANK.get(viewer_role or "", 0)
    return [role for role in GUIDE_ROLES if ROLE_RANK[role] <= rank]


def can_read(viewer_role: str | None, target_role: str) -> bool:
    return target_role in readable_roles(viewer_role)


async def list_user_guides(viewer_role: str | None) -> list[dict]:
    allowed = readable_roles(viewer_role)
    if not allowed:
        return []

    db = get_db()
    if db is None:
        logger.warning("list_user_guides: database unavailable, returning no stored overrides")
        return []

    try:
        docs = await db.user_guides.find({"_id": {"$in": allowed}}).to_list(length=len(allowed))
    except Exception as exc:
        logger.warning("list_user_guides failed, falling back to bundled guides: %s", exc)
        return []

    by_role = {doc.get("role") or doc.get("_id"): doc for doc in docs}
    return [mongo_doc(by_role[role]) for role in allowed if role in by_role]


async def get_user_guide(role: str) -> dict | None:
    db = get_db()
    if db is None:
        return None
    try:
        doc = await db.user_guides.find_one({"_id": role})
    except Exception as exc:
        logger.warning("get_user_guide failed (role=%s): %s", role, exc)
        return None
    return mongo_doc(doc) if doc is not None else None


async def publish_user_guide(
    role: str,
    guide: dict,
    updated_by: str | None = None,
) -> dict:
    if role not in GUIDE_ROLES:
        raise KeyError(f"Unknown guide role: {role}")

    db = get_db()
    if db is None:
        raise RuntimeError("Database unavailable")

    now = datetime.now(timezone.utc).isoformat()
    fields = {key: value for key, value in guide.items() if key not in _SERVER_OWNED_FIELDS}
    fields.update({"role": role, "updated_at": now, "updated_by": updated_by})

    await db.user_guides.update_one(
        {"_id": role},
        {"$set": fields, "$inc": {"version": 1}, "$setOnInsert": {"created_at": now}},
        upsert=True,
    )
    doc = await db.user_guides.find_one({"_id": role})
    return mongo_doc(doc) if doc is not None else {}


async def delete_user_guide(role: str) -> bool:
    if role not in GUIDE_ROLES:
        raise KeyError(f"Unknown guide role: {role}")

    db = get_db()
    if db is None:
        return False
    result = await db.user_guides.delete_one({"_id": role})
    return result.deleted_count > 0
