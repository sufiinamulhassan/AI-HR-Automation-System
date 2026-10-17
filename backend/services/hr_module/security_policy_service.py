import logging
from datetime import datetime, timezone

from config.database import get_db
from config.settings import settings
from shared.utils import mongo_doc

logger = logging.getLogger(__name__)

SINGLETON_ID = "singleton"

_EDITABLE_FIELDS = (
    "password_min_length",
    "password_require_number",
    "password_require_symbol",
    "max_login_attempts_before_lockout",
    "account_lockout_duration_minutes",
    "session_timeout_minutes",
)

POLICY_FIELDS = _EDITABLE_FIELDS

_DEFAULTS = {
    "password_min_length": 1,
    "password_require_number": False,
    "password_require_symbol": False,
    "max_login_attempts_before_lockout": 0,
    "account_lockout_duration_minutes": 15,
    "session_timeout_minutes": None,
}

_HARDENED_DEFAULTS = {
    "password_min_length": 8,
    "password_require_number": True,
    "password_require_symbol": False,
    "max_login_attempts_before_lockout": 5,
    "account_lockout_duration_minutes": 15,
    "session_timeout_minutes": None,
}


def _default_doc() -> dict:
    now = datetime.now(timezone.utc).isoformat()
    doc = {"_id": SINGLETON_ID, "created_at": now, "updated_at": now}
    doc.update(_DEFAULTS if settings.DEBUG else _HARDENED_DEFAULTS)
    return doc


def _validate_fields(fields: dict) -> dict:
    clean: dict = {}

    if "password_min_length" in fields:
        v = fields["password_min_length"]
        if not isinstance(v, int) or isinstance(v, bool) or v < 1:
            raise ValueError("password_min_length must be an integer >= 1")
        clean["password_min_length"] = v

    if "password_require_number" in fields:
        v = fields["password_require_number"]
        if not isinstance(v, bool):
            raise ValueError("password_require_number must be a boolean")
        clean["password_require_number"] = v

    if "password_require_symbol" in fields:
        v = fields["password_require_symbol"]
        if not isinstance(v, bool):
            raise ValueError("password_require_symbol must be a boolean")
        clean["password_require_symbol"] = v

    if "max_login_attempts_before_lockout" in fields:
        v = fields["max_login_attempts_before_lockout"]
        if not isinstance(v, int) or isinstance(v, bool) or v < 0:
            raise ValueError(
                "max_login_attempts_before_lockout must be an integer >= 0 "
                "(0 disables lockout entirely)"
            )
        clean["max_login_attempts_before_lockout"] = v

    if "account_lockout_duration_minutes" in fields:
        v = fields["account_lockout_duration_minutes"]
        if not isinstance(v, int) or isinstance(v, bool) or v < 1:
            raise ValueError("account_lockout_duration_minutes must be an integer >= 1")
        clean["account_lockout_duration_minutes"] = v

    if "session_timeout_minutes" in fields:
        v = fields["session_timeout_minutes"]
        if v is not None and (not isinstance(v, int) or isinstance(v, bool) or v < 1):
            raise ValueError(
                "session_timeout_minutes must be a positive integer, or null "
                "to fall back to the default token lifetime"
            )
        clean["session_timeout_minutes"] = v

    return clean


async def get_security_policies() -> dict:
    db = get_db()
    if db is None:
        logger.warning("get_security_policies: database unavailable, returning in-memory defaults")
        return mongo_doc(_default_doc())

    doc = await db.security_policies.find_one({"_id": SINGLETON_ID})
    if doc is not None:
        return mongo_doc(doc)

    fresh = _default_doc()
    try:
        await db.security_policies.insert_one(dict(fresh))
    except Exception as exc:
        logger.info("security_policies singleton insert race, re-reading: %s", exc)
        existing = await db.security_policies.find_one({"_id": SINGLETON_ID})
        if existing is not None:
            return mongo_doc(existing)
    return mongo_doc(fresh)


async def update_security_policies(updated_by: str | None = None, **fields) -> dict:
    known = {k: v for k, v in fields.items() if k in _EDITABLE_FIELDS}
    clean = _validate_fields(known)

    db = get_db()
    if db is None:
        raise RuntimeError("Database unavailable")

    if not clean:
        return await get_security_policies()

    await get_security_policies()

    clean["updated_at"] = datetime.now(timezone.utc).isoformat()
    if updated_by:
        clean["updated_by"] = updated_by

    await db.security_policies.update_one({"_id": SINGLETON_ID}, {"$set": clean}, upsert=True)
    doc = await db.security_policies.find_one({"_id": SINGLETON_ID})
    return mongo_doc(doc) if doc is not None else mongo_doc(_default_doc())
