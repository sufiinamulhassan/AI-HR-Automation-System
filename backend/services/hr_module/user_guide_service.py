"""User Guide service — hr_module (in-app documentation, MVP2 §2.20 slice).

Stores the three role guides (Super Admin / HR Admin / Recruiter) that the
frontend's `/guide` page renders, so a superadmin can correct or extend the
documentation without a frontend redeploy.

Storage: a `user_guides` collection, ONE DOCUMENT PER ROLE, with the role
string used directly as `_id`:

    {
      "_id":        "admin",              # == role; see the index note below
      "role":       "admin",
      "label":      "HR Admin",
      "tagline":    "…",
      "intro":      ["…", "…"],
      "chapters":   [ … opaque content tree, stored verbatim … ],
      "version":    3,                     # $inc'd on every publish
      "created_at": "2026-08-07T…+00:00",
      "updated_at": "2026-08-07T…+00:00",
      "updated_by": "superadmin@hirely.ai" | None,
    }

No index is added for `user_guides` in `config/database.py`: the role string
IS the `_id`, and MongoDB always maintains a unique index on `_id` for every
collection — an explicit `create_index([("role", ASCENDING)], unique=True)`
would be redundant, and this way the uniqueness of "one document per role" is
enforced by the database itself rather than by convention. The denormalized
`role` field is kept alongside it because that is the field the API contract
(and the frontend's `RoleGuide.role`) is written against, and because
`mongo_doc()` strips `_id` from every response.

**Absence of a document is the normal, expected state** — exactly like
`prompt_config_service.py`. Every guide ships bundled with the frontend
(`src/pages/guide/content/*.ts`); a stored document is an *override* of that
bundled copy, and DELETE removes the override so the bundled copy takes over
again. So an install that never publishes anything behaves precisely as it
does today.

The `chapters` tree is authored in the frontend against
`src/pages/guide/types.ts` and must survive a `JSON.stringify` round trip
unchanged. Two deliberate choices make that true:

  1. every content model below sets `extra="allow"`, so a field the frontend
     adds later is stored and returned rather than silently dropped;
  2. the route dumps the payload with `exclude_unset=True`, so a field the
     frontend never sent is not resurrected as an explicit `null` (TypeScript
     `undefined` is simply absent from the JSON, and it stays absent).

The Pydantic models live here rather than in routes/user_guide.py — unlike
prompt_config.py/email_templates_admin.py, whose request bodies are flat
strings — because they describe the *stored document schema*, and both the
route and `seed/seed_user_guides.py` validate against them before writing.

Role visibility (the real access control — the frontend's tab gating is only
cosmetic): a caller may read the guide for any role at or below their own
rank. `standard` → standard; `admin` → standard + admin; `superadmin` → all
three. An unrecognized role reads nothing.
"""
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
    """Base for every guide content node.

    `extra="allow"` is the whole point: the guide tree is authored in the
    frontend and only needs to *round-trip* through here, so a key this
    backend has never heard of must be stored and handed back untouched, not
    rejected (422) or quietly dropped. The typed fields below exist to catch
    genuinely malformed content (a section with no title, a control with no
    `what`), not to gate-keep the schema.
    """
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
    """PUT body — a `RoleGuide` from types.ts minus the routing concern.

    `role` is accepted (the frontend's bundled content objects carry it, so
    posting one verbatim just works) but never trusted: the path parameter is
    the only thing that decides which document is written.
    """
    role: str | None = None
    label: str
    tagline: str
    intro: list[str] = []
    chapters: list[GuideChapter] = []


def readable_roles(viewer_role: str | None) -> list[str]:
    """Guide roles `viewer_role` is allowed to read, lowest rank first.

    Anything not in ROLE_RANK (None, a custom role name from the `roles`
    collection, a typo) reads nothing rather than defaulting open — a custom
    role's guide access is a deliberate future decision, not something to
    guess at here.
    """
    rank = ROLE_RANK.get(viewer_role or "", 0)
    return [role for role in GUIDE_ROLES if ROLE_RANK[role] <= rank]


def can_read(viewer_role: str | None, target_role: str) -> bool:
    return target_role in readable_roles(viewer_role)


async def list_user_guides(viewer_role: str | None) -> list[dict]:
    """Every *stored* guide the caller may read, lowest rank first.

    Roles with no stored document are simply absent from the list — that is
    the signal for "use the bundled frontend copy for this role", not an
    error. Returns [] when the database is unavailable, for the same reason:
    the frontend already has a complete working copy of every guide.
    """
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
    """The stored guide for `role`, or None if no override exists (no DB, no
    document, or a lookup error) — the caller turns None into a 404 and the
    frontend falls back to its bundled copy."""
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
    """Upsert `role`'s guide and bump its `version`.

    `guide` is the already-validated payload (see `RoleGuidePayload`), dumped
    with `exclude_unset=True` so the stored `chapters` tree is byte-for-byte
    what the frontend sent. `version` is `$inc`'d rather than read-then-
    written, so two concurrent publishes can't land on the same number; a
    brand-new document gets version 1 because `$inc` on a missing field
    creates it at the increment value.
    """
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
    """Remove the stored override so the frontend's bundled copy takes over
    again. Returns True if a document was actually removed."""
    if role not in GUIDE_ROLES:
        raise KeyError(f"Unknown guide role: {role}")

    db = get_db()
    if db is None:
        return False
    result = await db.user_guides.delete_one({"_id": role})
    return result.deleted_count > 0
