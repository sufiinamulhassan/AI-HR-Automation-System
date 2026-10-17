import base64
import hashlib
import logging
import re
import secrets
import string
from datetime import datetime, timedelta, timezone
from typing import NoReturn

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.security import OAuth2PasswordRequestForm
from jose import jwt
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr

from shared import secrets as secret_store
from shared.auth import get_current_user, require_admin, require_permission, require_superadmin
from shared.rate_limit import enforce_rate_limit
from config.database import get_db, get_platform_db
from config.llm import selectable_models
from config.settings import settings
from config.tenancy import (
    DEFAULT_COMPANY_ID, NO_MATCH, bind_company, company_context, company_setting, current_company,
    current_company_id, db_for_company,
)
from services.hr_module import account_protection_service as lockout
from services.hr_module import credentials_service, oidc_service, plan_service, totp_service
from services.hr_module.account_protection_service import (
    SUPERADMIN_ONLY_ACCOUNT_MESSAGE,
    actor_may_modify,
    check_account_change,
    customer_accounts,
    email_taken,
    find_user,
    platform_owner_refusal,
    normalize_email,
    target_role,
)
from services.hr_module.audit_service import log_audit_event
from services.hr_module.permissions import is_known_role, resolve_permissions
from services.hr_module.security_policy_service import POLICY_FIELDS, get_security_policies
from services.hr_module.workspace_service import (
    blocked_reason, company_for_email_domain, domain_claimed_by_other, load_company, public_company,
)

logger = logging.getLogger(__name__)
router = APIRouter()
pwd_ctx = CryptContext(schemes=["bcrypt"])

_MAX_AVATAR_IMAGE_BYTES = 2 * 1024 * 1024
_MAX_PROFILE_TEXT_CHARS = 200
_TIMEZONE_NAME = re.compile(r"^[A-Za-z0-9_+\-/]{1,64}$")


def _sniff_avatar_type(raw: bytes) -> str | None:
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if raw.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if len(raw) >= 12 and raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "image/webp"
    return None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class OTPVerify(BaseModel):
    email: EmailStr
    otp_code: str

class UserCreate(BaseModel):
    name: str
    email: EmailStr
    password: str | None = None
    role: str = "standard"
    otp_required: bool = False
    department_id: str | None = None
    send_invite: bool = False

class UserUpdate(BaseModel):
    name: str | None = None
    role: str | None = None
    otp_required: bool | None = None
    is_active: bool | None = None
    department_id: str | None = None

class ProfileUpdate(BaseModel):
    name: str | None = None
    job_title: str | None = None
    timezone: str | None = None

class OtpUpdate(BaseModel):
    enabled: bool

class PasswordChange(BaseModel):
    current_password: str
    new_password: str

class AdminPasswordReset(BaseModel):
    email: EmailStr
    new_password: str

class ForgotPassword(BaseModel):
    email: EmailStr

class ResetPassword(BaseModel):
    token: str
    new_password: str

class ModelSettingUpdate(BaseModel):
    default_model: str

class TotpCode(BaseModel):
    code: str

class TotpDisable(BaseModel):
    password: str
    code: str


async def _make_token(email: str, company_id: str | None = None) -> str:
    policies = await get_security_policies()
    minutes = policies.get("session_timeout_minutes") or settings.ACCESS_TOKEN_EXPIRE_MINUTES
    exp = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    claims = {"sub": email, "exp": exp, "iat": int(datetime.now(timezone.utc).timestamp())}
    if company_id:
        claims["cid"] = company_id
    return jwt.encode(claims, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


async def _validate_password_policy(password: str) -> None:
    policies = await get_security_policies()
    min_length = policies.get("password_min_length") or 1
    if len(password) < min_length:
        raise HTTPException(400, f"Password must be at least {min_length} characters long")
    if policies.get("password_require_number") and not any(c.isdigit() for c in password):
        raise HTTPException(400, "Password must contain at least one number")
    if policies.get("password_require_symbol") and not any(not c.isalnum() for c in password):
        raise HTTPException(400, "Password must contain at least one symbol")

def _otp() -> str:
    return "".join(secrets.choice(string.digits) for _ in range(6))

async def _send_otp(email: str, code: str) -> bool:
    from services.hr_module.email_service import send_otp_email
    return await send_otp_email(to_email=email, otp_code=code)


def _client_ip(request: Request) -> str:
    from shared.rate_limit import client_ip

    return client_ip(request)


_DUMMY_HASH: str | None = None


def _dummy_hash() -> str:
    global _DUMMY_HASH
    if _DUMMY_HASH is None:
        _DUMMY_HASH = pwd_ctx.hash("not-a-password-anyone-has")
    return _DUMMY_HASH


def _verify_password(plain: str, stored_hash) -> bool:
    if not stored_hash or not isinstance(stored_hash, str):
        return False
    try:
        return bool(pwd_ctx.verify(plain, stored_hash))
    except Exception as exc:
        logger.warning("Stored password hash could not be verified: %s", type(exc).__name__)
        return False


async def _lockout_policy(email: str, company: dict | None) -> tuple[int, int]:
    if company is not None:
        policies = await get_security_policies()
    else:
        target = await company_for_email_domain(email)
        if target is None:
            target = await load_company(DEFAULT_COMPANY_ID)
            if target is not None and blocked_reason(target):
                target = None
        if target is None:
            return 0, lockout.DEFAULT_LOCK_MINUTES
        with company_context(target["company_id"], target):
            policies = await get_security_policies()
    return (
        int(policies.get("max_login_attempts_before_lockout") or 0),
        int(policies.get("account_lockout_duration_minutes") or lockout.DEFAULT_LOCK_MINUTES),
    )


async def _sign_in_failed(
    raw, email: str, address: str, company: dict | None, max_attempts: int, minutes: int,
) -> NoReturn:
    outcome = await lockout.record_failure(raw, email, address, max_attempts=max_attempts, minutes=minutes)
    if outcome.account_locked_now:
        logger.warning("Sign-in lockout: account locked after repeated failures from several addresses")
        await lockout.alert_account_locked(
            company_id=(company or {}).get("company_id"), attempts=lockout.account_threshold(max_attempts),
        )
    if outcome.locked:
        raise HTTPException(423, lockout.LOCKED_MESSAGE)
    raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")


async def _authenticate_password(db, request: Request, email: str, password: str) -> dict:
    await enforce_rate_limit(
        db, key=f"login:email:{email}",
        limit=settings.LOGIN_RATE_LIMIT, window_seconds=settings.LOGIN_RATE_LIMIT_WINDOW_SECONDS,
    )
    await enforce_rate_limit(
        db, key=f"login:ip:{_client_ip(request)}",
        limit=settings.LOGIN_RATE_LIMIT * 3, window_seconds=settings.LOGIN_RATE_LIMIT_WINDOW_SECONDS,
    )
    raw = get_platform_db()
    address = _client_ip(request)
    user = await raw.users.find_one({"email": email})

    company = await load_company(user.get("company_id")) if user else None
    if company is not None:
        bind_company(company["company_id"], company)
    max_attempts, lock_minutes = await _lockout_policy(email, company)

    if max_attempts > 0:
        state = await lockout.lock_state(raw, email, address)
        if state.locked:
            logger.warning("Login rejected: sign-in locked for this email and address")
            raise HTTPException(423, lockout.LOCKED_MESSAGE)
    else:
        state = None

    if user is None or company is None:
        logger.warning("Login failed: no usable account for email: %s", email)
        _verify_password(password, (user or {}).get("password_hash") or _dummy_hash())
        await _sign_in_failed(raw, email, address, company, max_attempts, lock_minutes)

    db = get_db()
    if oidc_service.enforcement_applies(await oidc_service.get_config(db), user, company):
        raise HTTPException(status.HTTP_403_FORBIDDEN, oidc_service.ENFORCED_MESSAGE)

    if not _verify_password(password, user.get("password_hash")):
        logger.warning("Login failed: wrong password for: %s", email)
        await _sign_in_failed(raw, email, address, company, max_attempts, lock_minutes)

    if state is not None and state.has_pair_record:
        await lockout.clear_pair(raw, email, address)
    reason = blocked_reason(company)
    if reason:
        raise HTTPException(status.HTTP_403_FORBIDDEN, reason)
    user["_company"] = company
    return user


def _session_user(user: dict, company: dict | None) -> dict:
    return {
        "email": user["email"], "name": user.get("name", ""), "role": user.get("role", "standard"),
        "has_avatar": bool(user.get("avatar_content_type")),
        "is_platform_admin": bool(user.get("is_platform_admin")),
        **(public_company(company) if company else {}),
    }


@router.post("/login")
async def login(body: LoginRequest, request: Request):
    db = get_platform_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    email = body.email.lower().strip()
    user = await _authenticate_password(db, request, email, body.password)
    company = user.pop("_company")
    db = get_db()

    if not user.get("is_active", True):
        logger.warning("Login failed: account disabled: %s", email)
        raise HTTPException(403, "Account disabled")
    if user.get("totp_enabled"):
        expires = datetime.now(timezone.utc) + timedelta(minutes=settings.OTP_EXPIRE_MINUTES)
        await db.otp_logs.insert_one({"email": email, "method": "totp", "expires_at": expires, "used": False, "attempts": 0})
        return {"otp_required": True, "method": "totp", "message": "Enter the code from your authenticator app"}
    if user.get("otp_required"):
        code = _otp()
        hashed = hashlib.sha256(code.encode()).hexdigest()
        exp = datetime.now(timezone.utc) + timedelta(minutes=settings.OTP_EXPIRE_MINUTES)
        stored = await db.otp_logs.insert_one({"email": email, "code_hash": hashed, "expires_at": exp, "used": False, "attempts": 0})
        if not await _send_otp(email, code):
            await db.otp_logs.delete_one({"_id": stored.inserted_id})
            raise HTTPException(
                502,
                "We could not send your one-time code. Try again in a moment, or ask your administrator to check email delivery.",
            )
        return {"otp_required": True, "method": "email", "message": "OTP sent to your email"}
    await db.users.update_one({"email": email}, {"$set": {"last_login_at": datetime.now(timezone.utc)}})
    return {
        "otp_required": False,
        "access_token": await _make_token(email, company["company_id"]),
        "token_type": "bearer",
        "user": _session_user(user, company),
    }


@router.post("/verify-otp")
async def verify_otp(body: OTPVerify, request: Request):
    db = get_platform_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    email = body.email.lower().strip()
    await enforce_rate_limit(
        db, key=f"otp-verify:email:{email}",
        limit=settings.OTP_VERIFY_RATE_LIMIT, window_seconds=settings.OTP_VERIFY_RATE_LIMIT_WINDOW_SECONDS,
    )
    await enforce_rate_limit(
        db, key=f"otp-verify:ip:{_client_ip(request)}",
        limit=settings.OTP_VERIFY_RATE_LIMIT * 3, window_seconds=settings.OTP_VERIFY_RATE_LIMIT_WINDOW_SECONDS,
    )

    user = await db.users.find_one({"email": email})
    if user and user.get("totp_enabled"):
        return await _verify_totp_login(email, user, body.otp_code)

    rec = await db.otp_logs.find_one(
        {
            "email": email, "used": False, "expires_at": {"$gt": datetime.now(timezone.utc)},
            "method": {"$ne": "totp"},
        },
        sort=[("_id", -1)],
    )
    if not rec:
        raise HTTPException(401, "Invalid or expired OTP")
    if rec.get("attempts", 0) >= settings.OTP_MAX_ATTEMPTS:
        await db.otp_logs.update_one({"_id": rec["_id"]}, {"$set": {"used": True}})
        raise HTTPException(401, "Too many incorrect attempts: request a new OTP")

    hashed = hashlib.sha256(body.otp_code.encode()).hexdigest()
    if hashed != rec.get("code_hash"):
        await db.otp_logs.update_one({"_id": rec["_id"]}, {"$inc": {"attempts": 1}})
        raise HTTPException(401, "Invalid or expired OTP")

    await db.otp_logs.update_one({"_id": rec["_id"]}, {"$set": {"used": True}})
    company = await load_company((user or {}).get("company_id"))
    if user is None or company is None:
        raise HTTPException(401, "Invalid or expired OTP")
    reason = blocked_reason(company)
    if reason:
        raise HTTPException(403, reason)
    bind_company(company["company_id"], company)
    await get_db().users.update_one({"email": email}, {"$set": {"last_login_at": datetime.now(timezone.utc)}})
    return {
        "access_token": await _make_token(email, company["company_id"]),
        "token_type": "bearer",
        "user": _session_user(user, company),
    }


async def _verify_totp_login(email: str, user: dict, code: str) -> dict:
    company = await load_company(user.get("company_id"))
    if company is None:
        raise HTTPException(401, "Invalid or expired OTP")
    bind_company(company["company_id"], company)
    db = get_db()
    rec = await db.otp_logs.find_one(
        {"email": email, "method": "totp", "used": False, "expires_at": {"$gt": datetime.now(timezone.utc)}},
        sort=[("_id", -1)],
    )
    if not rec:
        raise HTTPException(401, "Invalid or expired OTP")
    if rec.get("attempts", 0) >= settings.OTP_MAX_ATTEMPTS:
        await db.otp_logs.update_one({"_id": rec["_id"]}, {"$set": {"used": True}})
        raise HTTPException(401, "Too many incorrect attempts: sign in again")

    kind = await _check_second_factor(db, email, user, code)
    if kind is None:
        await db.otp_logs.update_one({"_id": rec["_id"]}, {"$inc": {"attempts": 1}})
        raise HTTPException(401, "Invalid or expired OTP")
    await db.otp_logs.update_one({"_id": rec["_id"]}, {"$set": {"used": True}})

    if not user.get("is_active", True):
        raise HTTPException(403, "Account disabled")
    reason = blocked_reason(company)
    if reason:
        raise HTTPException(403, reason)
    await db.users.update_one({"email": email}, {"$set": {"last_login_at": datetime.now(timezone.utc)}})
    signed_in = {
        "access_token": await _make_token(email, company["company_id"]),
        "token_type": "bearer",
        "user": _session_user(user, company),
    }
    if kind == "recovery":
        left = len(user.get("totp_recovery_hashes") or []) - 1
        await log_audit_event(
            db, actor_email=email, actor_role=user.get("role") or "standard",
            action="totp_recovery_used", resource_type="user", resource_id=email,
            details={"recovery_codes_left": max(left, 0)},
        )
        signed_in["recovery_codes_left"] = max(left, 0)
    return signed_in


async def _check_second_factor(db, email: str, user: dict, code, *, recovery_ok: bool = True) -> str | None:
    if totp_service.normalize_code(code) is not None:
        secret = secret_store.decrypt(user.get("totp_secret"))
        if not secret:
            return None
        step = totp_service.match_step(secret, code, last_step=user.get("totp_last_step"))
        if step is not None and await totp_service.claim_step(db, email, step):
            return "totp"
        return None
    if not recovery_ok:
        return None
    match = totp_service.find_recovery_hash(user.get("totp_recovery_hashes"), code)
    if match is not None and await totp_service.spend_stored_recovery_hash(db, email, match):
        return "recovery"
    return None


@router.post("/token")
async def oauth2_token(request: Request, form: OAuth2PasswordRequestForm = Depends()):
    db = get_platform_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    username = form.username.lower().strip()
    user = await _authenticate_password(db, request, username, form.password)
    company = user.pop("_company")

    if not user.get("is_active", True):
        logger.warning("Token refused: account disabled: %s", username)
        raise HTTPException(403, "Account disabled")
    if user.get("otp_required") or user.get("totp_enabled"):
        logger.warning("Token refused: account requires a one-time code: %s", username)
        raise HTTPException(403, "This account requires a one-time code: sign in through the app instead")
    return {"access_token": await _make_token(username, company["company_id"]), "token_type": "bearer"}


async def _link_target(raw, email: str) -> tuple[dict, dict] | None:
    user = await raw.users.find_one({"email": email}, {"_id": 0, "password_hash": 0, "avatar_base64": 0})
    company = await load_company(user.get("company_id") if user else NO_MATCH)
    if not user or not user.get("is_active", True) or blocked_reason(company):
        return None
    return user, company


@router.post("/forgot-password")
async def forgot_password(body: ForgotPassword, request: Request, tasks: BackgroundTasks):
    raw = get_platform_db()
    if raw is None:
        raise HTTPException(503, "Database unavailable")
    email = normalize_email(body.email)
    await enforce_rate_limit(
        raw, key=f"forgot:email:{email}",
        limit=credentials_service.FORGOT_EMAIL_LIMIT, window_seconds=credentials_service.LIMIT_WINDOW_SECONDS,
    )
    await enforce_rate_limit(
        raw, key=f"forgot:ip:{_client_ip(request)}",
        limit=credentials_service.FORGOT_IP_LIMIT, window_seconds=credentials_service.LIMIT_WINDOW_SECONDS,
    )
    target = await _link_target(raw, email)
    sso = await oidc_service.get_config(
        db_for_company(raw, target[1]["company_id"] if target is not None else NO_MATCH)
    )
    if target is not None and oidc_service.enforcement_applies(sso, target[0], target[1]):
        raise HTTPException(status.HTTP_403_FORBIDDEN, oidc_service.ENFORCED_MESSAGE)
    if target is not None:
        user, company = target
        purpose = credentials_service.PURPOSE_INVITE if user.get("invite_pending") else credentials_service.PURPOSE_RESET
        tasks.add_task(
            credentials_service.send_invite,
            email=user["email"], name=user.get("name") or "", company_id=company["company_id"],
            invited_by=None, purpose=purpose,
        )
    return {"message": credentials_service.FORGOT_MESSAGE}


@router.post("/reset-password")
async def reset_password(body: ResetPassword, request: Request):
    raw = get_platform_db()
    if raw is None:
        raise HTTPException(503, "Database unavailable")
    await enforce_rate_limit(
        raw, key=f"reset:ip:{_client_ip(request)}",
        limit=credentials_service.RESET_IP_LIMIT, window_seconds=credentials_service.LIMIT_WINDOW_SECONDS,
    )
    invalid = HTTPException(400, credentials_service.INVALID_LINK_MESSAGE)
    token = (body.token or "").strip()
    record = await credentials_service.find_open_token(raw, token)
    user = await raw.users.find_one({"email": record["email"]}) if record else None
    company = await load_company(user.get("company_id") if user else NO_MATCH)
    if not record or not user or not user.get("is_active", True) or blocked_reason(company):
        raise invalid
    if record.get("company_id") and record["company_id"] != user.get("company_id"):
        raise invalid

    bind_company(company["company_id"], company)
    db = get_db()
    await _validate_password_policy(body.new_password)
    claimed = await credentials_service.claim_token(raw, token)
    if claimed is None:
        raise invalid

    await db.users.update_one(
        {"email": user["email"]},
        {
            "$set": {
                "password_hash": pwd_ctx.hash(body.new_password), "failed_login_attempts": 0,
                "pwd_changed_at": int(datetime.now(timezone.utc).timestamp()),
            },
            "$unset": {"locked_until": "", "invite_pending": ""},
        },
    )
    await credentials_service.void_tokens(raw, record["email"])
    await lockout.clear_email(raw, user["email"])
    await log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role") or "standard",
        action="password_reset", resource_type="user", resource_id=user["email"],
        details={"via": claimed.get("purpose") or "reset"},
    )
    return {"message": "Password updated"}


async def _me_payload(db, user: dict) -> dict:
    rec: dict = {}
    if db is not None and user.get("email"):
        rec = await db.users.find_one(
            {"email": user["email"]},
            {"_id": 0, "password_hash": 1, "otp_required": 1, "otp_enforced": 1,
             "job_title": 1, "timezone": 1, "department_id": 1, "totp_enabled": 1},
        ) or {}
    payload = dict(user)
    payload.update({
        "has_password": bool(rec.get("password_hash")),
        "otp_enabled": bool(rec.get("otp_required", user.get("otp_required"))),
        "otp_enforced": bool(rec.get("otp_enforced")),
        "totp_enabled": bool(rec.get("totp_enabled")),
        "job_title": rec.get("job_title"),
        "timezone": rec.get("timezone"),
        "department_id": rec.get("department_id"),
    })
    return payload


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    return await _me_payload(get_db(), user)


def _clean_profile_text(value: str | None, label: str) -> str | None:
    text = (value or "").strip()
    if len(text) > _MAX_PROFILE_TEXT_CHARS:
        raise HTTPException(422, f"{label} must be at most {_MAX_PROFILE_TEXT_CHARS} characters.")
    return text or None


@router.patch("/me")
async def update_my_profile(body: ProfileUpdate, user: dict = Depends(get_current_user)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    sent = body.model_fields_set
    update: dict = {}
    if "name" in sent and body.name is not None:
        name = _clean_profile_text(body.name, "Name")
        if not name:
            raise HTTPException(422, "Name cannot be empty.")
        update["name"] = name
    if "job_title" in sent:
        update["job_title"] = _clean_profile_text(body.job_title, "Job title")
    if "timezone" in sent:
        zone = _clean_profile_text(body.timezone, "Time zone")
        if zone is not None and not _TIMEZONE_NAME.match(zone):
            raise HTTPException(422, "Choose a valid time zone.")
        update["timezone"] = zone
    if not update:
        raise HTTPException(422, "Send a name, a job title or a time zone to change.")

    found = await db.users.update_one({"email": user["email"]}, {"$set": update})
    if found.matched_count == 0:
        raise HTTPException(404, "Account not found.")
    await log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="profile_update", resource_type="user", resource_id=user["email"],
        details={"fields": sorted(update)},
    )
    return await _me_payload(db, {**user, **update})


@router.patch("/me/otp")
async def set_my_otp(body: OtpUpdate, user: dict = Depends(get_current_user)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    rec = await db.users.find_one({"email": user["email"]}, {"_id": 0, "otp_required": 1, "otp_enforced": 1})
    if rec is None:
        raise HTTPException(404, "Account not found.")
    enforced = bool(rec.get("otp_enforced"))
    if not body.enabled and enforced:
        raise HTTPException(
            403, "Your administrator requires one-time codes for your account, so they cannot be turned off here.",
        )
    await db.users.update_one({"email": user["email"]}, {"$set": {"otp_required": body.enabled}})
    await log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="otp_self_update", resource_type="user", resource_id=user["email"],
        details={"enabled": body.enabled},
    )
    return {"otp_enabled": body.enabled, "otp_enforced": enforced}


_TOTP_WRONG_CODE = "That code is not correct. Check the time on your phone and try again."
_TOTP_WINDOW_SECONDS = 900


async def _own_record(db, user: dict) -> dict:
    if db is None:
        raise HTTPException(503, "Database unavailable")
    rec = await db.users.find_one({"email": user["email"]})
    if rec is None:
        raise HTTPException(404, "Account not found.")
    return rec


@router.get("/me/totp")
async def my_totp(user: dict = Depends(get_current_user)):
    rec = await _own_record(get_db(), user)
    enabled = bool(rec.get("totp_enabled"))
    return {
        "enabled": enabled,
        "pending": bool(rec.get("totp_pending")) and not enabled,
        "recovery_codes_remaining": len(rec.get("totp_recovery_hashes") or []) if enabled else 0,
    }


@router.post("/me/totp/setup")
async def setup_my_totp(user: dict = Depends(get_current_user)):
    db = get_db()
    rec = await _own_record(db, user)
    await enforce_rate_limit(db, key=f"totp:setup:{user['email']}", limit=10, window_seconds=3600)
    if rec.get("totp_enabled"):
        raise HTTPException(409, "An authenticator app is already set up. Turn it off before setting up another.")
    if not rec.get("password_hash"):
        raise HTTPException(400, "This account signs in through single sign-on, so it has no authenticator app.")
    secret = totp_service.new_secret()
    await db.users.update_one({"email": user["email"]}, {"$set": {"totp_pending": secret_store.encrypt(secret)}})
    await log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="totp_setup", resource_type="user", resource_id=user["email"], details={},
    )
    return {"secret": secret, "otpauth_uri": totp_service.provisioning_uri(secret, user["email"], settings.APP_NAME)}


@router.post("/me/totp/enable")
async def enable_my_totp(body: TotpCode, user: dict = Depends(get_current_user)):
    db = get_db()
    rec = await _own_record(db, user)
    await enforce_rate_limit(
        db, key=f"totp:enable:{user['email']}", limit=10, window_seconds=_TOTP_WINDOW_SECONDS,
    )
    if rec.get("totp_enabled"):
        raise HTTPException(409, "An authenticator app is already set up.")
    pending = secret_store.decrypt(rec.get("totp_pending"))
    if not pending:
        raise HTTPException(400, "Start the setup first.")
    step = totp_service.match_step(pending, body.code)
    if step is None:
        raise HTTPException(400, _TOTP_WRONG_CODE)
    codes = totp_service.generate_recovery_codes()
    done = await db.users.update_one(
        {"email": user["email"], "totp_pending": rec["totp_pending"]},
        {
            "$set": {
                "totp_secret": rec["totp_pending"], "totp_enabled": True, "totp_last_step": step,
                "totp_recovery_hashes": totp_service.hash_recovery_codes(codes),
            },
            "$unset": {"totp_pending": ""},
        },
    )
    if done.matched_count == 0:
        raise HTTPException(409, "The setup changed. Start again.")
    await log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="totp_enable", resource_type="user", resource_id=user["email"], details={},
    )
    return {"recovery_codes": codes}


@router.post("/me/totp/disable")
async def disable_my_totp(body: TotpDisable, user: dict = Depends(get_current_user)):
    db = get_db()
    rec = await _own_record(db, user)
    await enforce_rate_limit(
        db, key=f"totp:disable:{user['email']}", limit=10, window_seconds=_TOTP_WINDOW_SECONDS,
    )
    if not rec.get("totp_enabled"):
        raise HTTPException(409, "No authenticator app is set up.")
    if not _verify_password(body.password, rec.get("password_hash")):
        raise HTTPException(400, "Current password incorrect")
    if await _check_second_factor(db, user["email"], rec, body.code) is None:
        raise HTTPException(400, _TOTP_WRONG_CODE)
    await db.users.update_one(
        {"email": user["email"]},
        {
            "$set": {"totp_enabled": False},
            "$unset": {"totp_secret": "", "totp_pending": "", "totp_recovery_hashes": "", "totp_last_step": ""},
        },
    )
    await log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="totp_disable", resource_type="user", resource_id=user["email"], details={},
    )
    return {"enabled": False}


@router.post("/me/totp/recovery-codes")
async def regenerate_my_recovery_codes(body: TotpCode, user: dict = Depends(get_current_user)):
    db = get_db()
    rec = await _own_record(db, user)
    await enforce_rate_limit(
        db, key=f"totp:recovery:{user['email']}", limit=10, window_seconds=_TOTP_WINDOW_SECONDS,
    )
    if not rec.get("totp_enabled"):
        raise HTTPException(409, "No authenticator app is set up.")
    if await _check_second_factor(db, user["email"], rec, body.code, recovery_ok=False) != "totp":
        raise HTTPException(400, _TOTP_WRONG_CODE)
    codes = totp_service.generate_recovery_codes()
    await db.users.update_one(
        {"email": user["email"]}, {"$set": {"totp_recovery_hashes": totp_service.hash_recovery_codes(codes)}},
    )
    await log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="totp_recovery_regenerate", resource_type="user", resource_id=user["email"], details={},
    )
    return {"recovery_codes": codes}


@router.post("/me/sign-out-everywhere")
async def sign_out_everywhere(user: dict = Depends(get_current_user)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    ended = await db.users.update_one(
        {"email": user["email"]}, {"$set": {"pwd_changed_at": int(datetime.now(timezone.utc).timestamp())}},
    )
    if ended.matched_count == 0:
        raise HTTPException(404, "Account not found.")
    await log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="sign_out_everywhere", resource_type="user", resource_id=user["email"], details={},
    )
    return {"access_token": await _make_token(user["email"], user.get("company_id")), "token_type": "bearer"}


@router.get("/password-policy")
async def password_policy(_: dict = Depends(get_current_user)):
    policy = await get_security_policies()
    rules = {field: policy.get(field) for field in POLICY_FIELDS}
    return {"min_length": rules.get("password_min_length") or 1, **rules}


@router.get("/me/permissions")
async def my_permissions(user: dict = Depends(get_current_user)):
    permissions = await resolve_permissions(user.get("role"))
    return {"role": user.get("role"), "permissions": permissions}


@router.post("/me/avatar")
async def upload_my_avatar(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    raw = await file.read(_MAX_AVATAR_IMAGE_BYTES + 1)
    if len(raw) > _MAX_AVATAR_IMAGE_BYTES:
        raise HTTPException(413, "The image is larger than 2 MB. Choose a smaller one.")
    if not raw:
        raise HTTPException(400, "The file is empty. Choose an image to upload.")
    content_type = _sniff_avatar_type(raw)
    if content_type is None:
        raise HTTPException(400, "That file is not an image. Upload a PNG, JPEG or WebP.")

    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    uploaded_at = datetime.now(timezone.utc).isoformat()
    await db.users.update_one(
        {"email": user["email"]},
        {"$set": {
            "avatar_base64": base64.b64encode(raw).decode("ascii"),
            "avatar_content_type": content_type,
            "avatar_uploaded_at": uploaded_at,
        }},
        upsert=True,
    )
    return {"content_type": content_type, "uploaded_at": uploaded_at}


@router.get("/me/avatar")
async def get_my_avatar(user: dict = Depends(get_current_user)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    rec = await db.users.find_one(
        {"email": user["email"]},
        {"_id": 0, "avatar_base64": 1, "avatar_content_type": 1, "avatar_uploaded_at": 1},
    )
    if not rec or not rec.get("avatar_base64"):
        return {"configured": False}
    return {
        "configured": True,
        "content_type": rec.get("avatar_content_type"),
        "uploaded_at": rec.get("avatar_uploaded_at"),
        "image_base64": rec["avatar_base64"],
    }


@router.delete("/me/avatar")
async def delete_my_avatar(user: dict = Depends(get_current_user)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    await db.users.update_one(
        {"email": user["email"]},
        {"$unset": {"avatar_base64": "", "avatar_content_type": "", "avatar_uploaded_at": ""}},
    )
    return {"message": "Avatar removed"}


async def _checked_department(db, actor: dict, department_id: str | None, *, target_role: str) -> str | None:
    value = (department_id or "").strip()
    if not value:
        return None
    if actor.get("role") != "superadmin" and target_role != "standard":
        raise HTTPException(403, SUPERADMIN_ONLY_ACCOUNT_MESSAGE)
    if not await db.departments.find_one({"department_id": value}, {"_id": 1}):
        raise HTTPException(400, "That department does not exist.")
    return value


@router.post("/users")
async def create_user(body: UserCreate, user: dict = Depends(require_admin)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    role = (body.role or "").strip() or "standard"
    if user.get("role") != "superadmin":
        if role != "standard":
            raise HTTPException(403, "Only a Super Admin can assign this role.")
    elif not await is_known_role(db, role):
        raise HTTPException(400, f"Unknown role: {role}")

    email = normalize_email(body.email)
    if await email_taken(get_platform_db(), email):
        raise HTTPException(400, "Email already registered")
    if await domain_claimed_by_other(email, user.get("company_id")):
        raise HTTPException(400, "That email domain is reserved by another company.")
    department_id = await _checked_department(db, user, body.department_id, target_role=role)

    invite = bool(body.send_invite) or not (body.password or "")
    if not invite:
        await _validate_password_policy(body.password)
    await plan_service.ensure_seat_available()
    await db.users.insert_one({
        "name": body.name, "email": email,
        "password_hash": pwd_ctx.hash(credentials_service.unusable_password() if invite else body.password),
        "role": role, "otp_required": body.otp_required,
        "otp_enforced": bool(body.otp_required),
        "department_id": department_id,
        "is_active": True, "created_at": datetime.now(timezone.utc).isoformat(),
        **({"invite_pending": True} if invite else {}),
    })

    await log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="user_create", resource_type="user", resource_id=email,
        details={"name": body.name, "role": role, "department_id": department_id, "invited": invite},
    )

    email_sent = False
    if invite:
        email_sent = await credentials_service.send_invite(
            email=email, name=body.name, company_id=current_company_id(), invited_by=user["email"],
        )
    return {"message": "User created", "invited": invite, "email_sent": email_sent}


@router.post("/users/{email}/invite")
async def resend_invite(email: str, user: dict = Depends(require_admin)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    target = await find_user(db, email)
    if target is None:
        raise HTTPException(404, "User not found")
    if refusal := platform_owner_refusal(user, target):
        raise HTTPException(403, refusal)
    if not actor_may_modify(user, target):
        raise HTTPException(403, SUPERADMIN_ONLY_ACCOUNT_MESSAGE)
    if not target.get("is_active", True):
        raise HTTPException(409, "This account is deactivated. Activate it before sending a link.")
    await enforce_rate_limit(
        db, key=f"invite:email:{normalize_email(target['email'])}",
        limit=credentials_service.INVITE_RESEND_LIMIT, window_seconds=credentials_service.LIMIT_WINDOW_SECONDS,
    )
    purpose = credentials_service.PURPOSE_INVITE if target.get("invite_pending") else credentials_service.PURPOSE_RESET
    email_sent = await credentials_service.send_invite(
        email=target["email"], name=target.get("name") or "", company_id=current_company_id(),
        invited_by=user["email"], purpose=purpose,
    )
    await log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="user_invite_resend", resource_type="user", resource_id=target["email"],
        details={"purpose": purpose, "email_sent": email_sent},
    )
    return {"email_sent": email_sent, "purpose": purpose}


@router.post("/users/{email}/totp/reset")
async def reset_user_totp(email: str, user: dict = Depends(require_admin)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    target = await find_user(db, email)
    if target is None:
        raise HTTPException(404, "User not found")
    if refusal := platform_owner_refusal(user, target):
        raise HTTPException(403, refusal)
    if not actor_may_modify(user, target):
        raise HTTPException(403, SUPERADMIN_ONLY_ACCOUNT_MESSAGE)
    if not target.get("totp_enabled") and not target.get("totp_pending"):
        raise HTTPException(409, "This account has no authenticator app.")
    await db.users.update_one(
        {"email": target["email"]},
        {
            "$set": {"totp_enabled": False},
            "$unset": {"totp_secret": "", "totp_pending": "", "totp_recovery_hashes": "", "totp_last_step": ""},
        },
    )
    await log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="totp_reset", resource_type="user", resource_id=target["email"], details={},
    )
    return {"message": "Authenticator app turned off"}


_USER_LIST_PROJECTION = {
    "_id": 0, "password_hash": 0, "avatar_base64": 0,
    "totp_secret": 0, "totp_pending": 0, "totp_recovery_hashes": 0, "totp_last_step": 0,
}


@router.get("/users")
async def list_users(
    response: Response,
    limit: int = Query(100, ge=1, le=500),
    skip: int = Query(0, ge=0),
    search: str | None = Query(None, max_length=200),
    current: dict = Depends(require_admin),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    query: dict = {} if current.get("role") == "superadmin" else {"role": "standard"}
    query.update(customer_accounts(current))
    term = (search or "").strip()
    if term:
        pattern = {"$regex": re.escape(term), "$options": "i"}
        match = {"$or": [{"name": pattern}, {"email": pattern}]}
        query = {"$and": [query, match]} if query else match
    total = await db.users.count_documents(query)
    rows = await db.users.find(query, _USER_LIST_PROJECTION).sort("_id", 1).skip(skip).limit(limit).to_list(length=limit)
    for row in rows:
        row.setdefault("department_id", None)
        row["totp_enabled"] = bool(row.get("totp_enabled"))
    response.headers["X-Total-Count"] = str(total)
    return rows


@router.patch("/users/{email}")
async def update_user(email: str, body: UserUpdate, user: dict = Depends(require_admin)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    update = {k: v for k, v in body.model_dump().items() if v is not None and k != "department_id"}
    sets_department = "department_id" in body.model_fields_set
    if not update and not sets_department:
        raise HTTPException(400, "No fields to update")

    target = await find_user(db, email)
    if target is None:
        raise HTTPException(404, "User not found")
    if refusal := platform_owner_refusal(user, target):
        raise HTTPException(403, refusal)

    if not actor_may_modify(user, target):
        raise HTTPException(403, SUPERADMIN_ONLY_ACCOUNT_MESSAGE)

    if "role" in update:
        if user.get("role") != "superadmin":
            raise HTTPException(403, "Only a Super Admin can change a user's role")
        if not await is_known_role(db, update["role"]):
            raise HTTPException(400, f"Unknown role: {update['role']}")

    refusal = await check_account_change(
        db, actor=user, target=target,
        deactivate=update.get("is_active") is False, new_role=update.get("role"),
    )
    if refusal:
        raise HTTPException(409, refusal)

    if sets_department:
        update["department_id"] = await _checked_department(
            db, user, body.department_id, target_role=update.get("role") or target_role(target),
        )
    if "otp_required" in update:
        update["otp_enforced"] = bool(update["otp_required"])

    await db.users.update_one({"email": target["email"]}, {"$set": update})

    await log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="user_update", resource_type="user", resource_id=target["email"],
        details=update,
    )
    return {"message": "Updated"}


@router.delete("/users/{email}")
async def delete_user(
    email: str,
    current: dict = Depends(require_superadmin),
    _perm: dict = Depends(require_permission("users:manage")),
):
    if email == current["email"]:
        raise HTTPException(400, "Cannot delete yourself")
    db = get_db()
    if db is not None:
        if refusal := platform_owner_refusal(current, await find_user(db, email)):
            raise HTTPException(403, refusal)
        await db.users.delete_one({"email": email})
        await log_audit_event(
            db, actor_email=current["email"], actor_role=current.get("role"),
            action="user_delete", resource_type="user", resource_id=email,
            details={},
        )
    return {"message": "Deleted"}


@router.post("/change-password")
async def change_password(body: PasswordChange, user: dict = Depends(get_current_user)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    rec = await db.users.find_one({"email": user["email"]})
    if not rec:
        raise HTTPException(401, "Invalid or expired credentials")
    if not rec.get("password_hash"):
        raise HTTPException(400, "This account has no password. It signs in through single sign-on.")
    if not _verify_password(body.current_password, rec.get("password_hash")):
        raise HTTPException(400, "Current password incorrect")
    await _validate_password_policy(body.new_password)
    await db.users.update_one(
        {"email": user["email"]},
        {"$set": {"password_hash": pwd_ctx.hash(body.new_password), "pwd_changed_at": int(datetime.now(timezone.utc).timestamp())}},
    )
    await log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="password_change", resource_type="user", resource_id=user["email"],
        details={},
    )
    return {
        "message": "Password changed",
        "access_token": await _make_token(user["email"], user.get("company_id")),
        "token_type": "bearer",
    }


@router.post("/admin/reset-password")
async def admin_reset_password(body: AdminPasswordReset, user: dict = Depends(require_admin)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    target = await find_user(db, body.email)
    if target is None:
        raise HTTPException(404, "User not found")
    if refusal := platform_owner_refusal(user, target):
        raise HTTPException(403, refusal)
    if not actor_may_modify(user, target):
        raise HTTPException(403, SUPERADMIN_ONLY_ACCOUNT_MESSAGE)
    await _validate_password_policy(body.new_password)
    await db.users.update_one(
        {"email": target["email"]},
        {
            "$set": {
                "password_hash": pwd_ctx.hash(body.new_password), "failed_login_attempts": 0,
                "pwd_changed_at": int(datetime.now(timezone.utc).timestamp()),
            },
            "$unset": {"locked_until": ""},
        },
    )
    await lockout.clear_email(get_platform_db(), target["email"])
    await log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="user_password_reset", resource_type="user", resource_id=target["email"],
        details={"target_role": target.get("role") or "standard"},
    )
    return {"message": "Password reset"}


@router.get("/models")
async def list_models(_: dict = Depends(get_current_user)):
    return {"models": selectable_models(), "current": company_setting("default_llm_model", settings.DEFAULT_LLM_MODEL)}


@router.patch("/models/default")
async def set_default_model(body: ModelSettingUpdate, user: dict = Depends(require_admin)):
    valid = {m["id"] for m in selectable_models()}
    if body.default_model not in valid:
        raise HTTPException(400, f"Unknown model. Valid: {sorted(valid)}")
    db = get_db()
    previous = company_setting("default_llm_model", settings.DEFAULT_LLM_MODEL)
    raw = get_platform_db()
    if raw is not None:
        await raw.companies.update_one(
            {"company_id": current_company_id()},
            {"$set": {"settings.default_llm_model": body.default_model}},
        )
    current_company().setdefault("settings", {})["default_llm_model"] = body.default_model
    await log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="default_model_change", resource_type="setting", resource_id="default_llm_model",
        details={"from": previous, "to": body.default_model},
    )
    return {"message": f"Default model → {body.default_model}"}
