"""Security Policies service — hr_module Admin Configuration (MVP2 §2.20,
final named gap — see docs/report.md §3 / docs/MVP2.md §2.20).

Same singleton-document, override-with-fallback shape already established in
this codebase by `services/hr_module/company_settings_service.py` (read that
file first if this one is unclear) and by `config/database.py`'s
`_load_runtime_settings()` (which shadows `settings.DEFAULT_LLM_MODEL` from a
DB collection the same way this module shadows password/lockout/session
behavior). One fixed document (`_id == SINGLETON_ID`) in a new
`security_policies` collection — upserted into existence with permissive
defaults on first read, never absent, never more than one row, so no index
beyond Mongo's implicit `_id` index is required (see the manifest note for
`config/database.py` — deliberately not adding a `create_index` call for a
singleton keyed by a fixed literal `_id`).

CRITICAL SAFETY REQUIREMENT (this module exists only to satisfy it): every
default value below must change NOTHING about current behavior for any
existing account or test until an admin explicitly opts in via PATCH:

  password_min_length                 1      — no real minimum (any current
                                                 password, including a
                                                 1-character one, still
                                                 passes)
  password_require_number              False  — no requirement (matches
                                                 today, where no such check
                                                 exists at all)
  password_require_symbol              False  — same
  max_login_attempts_before_lockout    0      — 0 means the lockout feature
                                                 is fully disabled; only 0 or
                                                 a positive integer are valid,
                                                 and 0 always means off,
                                                 exactly like `_EDITABLE`
                                                 lockout logic in
                                                 routes/auth.py checks
                                                 `> 0` before doing anything
  account_lockout_duration_minutes     15     — irrelevant while lockout is
                                                 disabled; only used once an
                                                 admin sets a positive
                                                 max_login_attempts_before_lockout
  session_timeout_minutes              None   — None means "fall through to
                                                 the existing hardcoded
                                                 settings.ACCESS_TOKEN_EXPIRE_MINUTES
                                                 exactly as today" (see
                                                 routes/auth.py `_make_token`)

The consuming logic (password-policy checks, login lockout, token lifetime)
lives in routes/auth.py — this module only stores/validates/returns the
policy document itself, exactly the same separation of concerns
prompt_config_service.py uses (it stores prompt overrides; jd_intel.py /
interview_engine.py decide how to use them).
"""
import logging
from datetime import datetime, timezone

from config.database import get_db
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

_DEFAULTS = {
    "password_min_length": 1,
    "password_require_number": False,
    "password_require_symbol": False,
    "max_login_attempts_before_lockout": 0,
    "account_lockout_duration_minutes": 15,
    "session_timeout_minutes": None,
}


def _default_doc() -> dict:
    now = datetime.now(timezone.utc).isoformat()
    doc = {"_id": SINGLETON_ID, "created_at": now, "updated_at": now}
    doc.update(_DEFAULTS)
    return doc


def _validate_fields(fields: dict) -> dict:
    """Validate + coerce only the known editable fields present in `fields`.
    Raises ValueError (caught by the route and turned into a 400) on an
    invalid value. Unknown keys are dropped by the caller before this runs.
    """
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
    """Fetch the singleton security-policies document, upserting the
    permissive defaults into existence on first call so a fresh install (or
    a fresh test database) never 404s and never behaves any differently from
    "no policy configured" until an admin explicitly PATCHes a change."""
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
    """Admin-authored partial update. Only whitelisted, explicitly-provided
    fields are validated and persisted; anything else is ignored. Raises
    ValueError on an invalid value (the route turns this into a 400)."""
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
