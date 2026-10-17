import hashlib
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

SUPERADMIN_ONLY_ACCOUNT_MESSAGE = "Only a Super Admin can change this account."
PLATFORM_OWNER_ACCOUNT_MESSAGE = "This account is managed by the platform owner and cannot be changed here."

DEFAULT_ROLE = "standard"


def normalize_email(value: str | None) -> str:
    return (value or "").strip().lower()


def _email_regex(email: str) -> dict:
    return {"$regex": f"^{re.escape(email)}$", "$options": "i"}


async def find_user(db, email: str | None) -> dict | None:
    raw = (email or "").strip()
    if not raw:
        return None
    user = await db.users.find_one({"email": raw})
    if user is None and raw != raw.lower():
        user = await db.users.find_one({"email": raw.lower()})
    if user is None:
        user = await db.users.find_one({"email": _email_regex(raw)})
    return user


async def email_taken(db, email: str) -> bool:
    return await db.users.find_one({"email": _email_regex(normalize_email(email))}, {"_id": 1}) is not None


async def active_superadmin_count(db) -> int:
    return await db.users.count_documents({"role": "superadmin", "is_active": {"$ne": False}})


def target_role(target: dict) -> str:
    return target.get("role") or DEFAULT_ROLE


def platform_owner_refusal(actor: dict, target: dict | None) -> str | None:
    if target and target.get("is_platform_admin") and not actor.get("is_platform_admin"):
        return PLATFORM_OWNER_ACCOUNT_MESSAGE
    return None


def customer_accounts(actor: dict) -> dict:
    return {} if actor.get("is_platform_admin") else {"is_platform_admin": {"$ne": True}}


def actor_may_modify(actor: dict, target: dict) -> bool:
    if actor.get("role") == "superadmin":
        return True
    return target_role(target) == DEFAULT_ROLE


def is_same_account(actor: dict, target: dict) -> bool:
    mine = normalize_email(actor.get("email"))
    return bool(mine) and mine == normalize_email(target.get("email"))


async def check_account_change(
    db, *, actor: dict, target: dict, deactivate: bool = False, new_role: str | None = None,
) -> str | None:
    changes_role = new_role is not None and new_role != target_role(target)
    if not (deactivate or changes_role):
        return None

    if is_same_account(actor, target):
        if deactivate:
            return "You cannot deactivate your own account."
        return "You cannot change your own role."

    if target_role(target) == "superadmin" and target.get("is_active", True) is not False:
        if await active_superadmin_count(db) <= 1:
            action = "deactivated" if deactivate else "demoted"
            return (
                f"The last active Super Admin cannot be {action}. "
                "Make another user a Super Admin first."
            )
    return None


LOCKED_MESSAGE = "Too many sign-in attempts. Try again later."
ACCOUNT_LOCK_FLOOR = 25
ACCOUNT_LOCK_FACTOR = 5
LOCK_KEY_PREFIX = "login:fail:"
DEFAULT_LOCK_MINUTES = 15


def account_threshold(max_attempts: int) -> int:
    return max(ACCOUNT_LOCK_FLOOR, ACCOUNT_LOCK_FACTOR * int(max_attempts))


def _digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:24]


def pair_key(email: str, address: str) -> str:
    email = normalize_email(email)
    return f"{LOCK_KEY_PREFIX}pair:{_digest(email)}:{_digest(email + '|' + (address or 'unknown'))}"


def account_key(email: str) -> str:
    return f"{LOCK_KEY_PREFIX}acct:{_digest(normalize_email(email))}"


def _aware(value) -> datetime | None:
    if not isinstance(value, datetime):
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _is_locked(doc: dict | None, now: datetime) -> bool:
    until = _aware((doc or {}).get("locked_until"))
    return until is not None and until > now


@dataclass
class LockState:
    locked: bool
    has_pair_record: bool = False


@dataclass
class FailureOutcome:
    locked: bool = False
    account_locked_now: bool = False


async def lock_state(db, email: str, address: str, *, now: datetime | None = None) -> LockState:
    now = now or datetime.now(timezone.utc)
    pid, aid = pair_key(email, address), account_key(email)
    docs = await db.rate_limits.find({"_id": {"$in": [pid, aid]}}).to_list(length=2)
    return LockState(
        locked=any(_is_locked(d, now) for d in docs),
        has_pair_record=any(d.get("_id") == pid for d in docs),
    )


async def _bump(col, key: str, *, threshold: int, window: timedelta, now: datetime) -> tuple[bool, bool]:
    expires = now + window
    doc = await col.find_one_and_update(
        {"_id": key},
        {"$inc": {"count": 1}, "$setOnInsert": {"expires_at": expires}},
        upsert=True, return_document=True,
    ) or {}
    count = int(doc.get("count") or 1)
    ends = _aware(doc.get("expires_at"))
    if ends is not None and ends <= now:
        await col.update_one(
            {"_id": key, "expires_at": doc["expires_at"]},
            {"$set": {"count": 1, "expires_at": expires}, "$unset": {"locked_until": ""}},
        )
        count = 1
    if count < threshold:
        return False, False
    tipped = await col.update_one(
        {"_id": key, "locked_until": {"$exists": False}},
        {"$set": {"locked_until": expires, "expires_at": expires}},
    )
    return True, tipped.modified_count == 1


async def record_failure(
    db, email: str, address: str, *, max_attempts: int, minutes: int | None = None, now: datetime | None = None,
) -> FailureOutcome:
    if not max_attempts or max_attempts <= 0:
        return FailureOutcome()
    now = now or datetime.now(timezone.utc)
    window = timedelta(minutes=minutes or DEFAULT_LOCK_MINUTES)
    col = db.rate_limits
    pair_locked, _ = await _bump(col, pair_key(email, address), threshold=int(max_attempts), window=window, now=now)
    acct_locked, acct_new = await _bump(
        col, account_key(email), threshold=account_threshold(max_attempts), window=window, now=now,
    )
    return FailureOutcome(locked=pair_locked or acct_locked, account_locked_now=acct_new)


async def clear_pair(db, email: str, address: str) -> None:
    await db.rate_limits.delete_one({"_id": pair_key(email, address)})


async def clear_email(db, email: str) -> None:
    digest = _digest(normalize_email(email))
    await db.rate_limits.delete_one({"_id": account_key(email)})
    await db.rate_limits.delete_many({"_id": {"$regex": "^" + re.escape(f"{LOCK_KEY_PREFIX}pair:{digest}:")}})


async def alert_account_locked(*, company_id: str | None, attempts: int = 0) -> None:
    try:
        from services.hr_module.alerts_service import alert_owners
    except ImportError:
        return
    except Exception as exc:
        logger.warning("Lockout alert unavailable: %s", type(exc).__name__)
        return
    who = "An account" if company_id else "An address that has no account"
    try:
        await alert_owners(
            f"login-lockout:{company_id or 'unknown'}",
            "Sign-in lockout",
            f"{who} was locked after {attempts} failed sign-ins from several addresses. "
            "It unlocks by itself when the lockout period ends.",
            company_id=company_id,
        )
    except Exception as exc:
        logger.warning("Lockout alert failed: %s", type(exc).__name__)
