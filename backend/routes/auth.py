"""Auth route — login, OTP, user management, model settings."""
import asyncio
import hashlib
import logging
import random
import string
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from jose import jwt
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr

from shared.auth import get_current_user, require_admin, require_superadmin
from shared.rate_limit import enforce_rate_limit
from config.database import get_db
from config.llm import MODEL_REGISTRY
from config.settings import settings
from services.hr_module.audit_service import log_audit_event
from services.hr_module.permissions import is_known_role
from services.hr_module.security_policy_service import get_security_policies

logger = logging.getLogger(__name__)
router = APIRouter()
pwd_ctx = CryptContext(schemes=["bcrypt"])


class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class OTPVerify(BaseModel):
    email: EmailStr
    otp_code: str

class UserCreate(BaseModel):
    name: str
    email: EmailStr
    password: str
    role: str = "standard"
    otp_required: bool = False

class UserUpdate(BaseModel):
    name: str | None = None
    role: str | None = None
    otp_required: bool | None = None
    is_active: bool | None = None

class PasswordChange(BaseModel):
    current_password: str
    new_password: str

class AdminPasswordReset(BaseModel):
    email: EmailStr
    new_password: str

class ModelSettingUpdate(BaseModel):
    default_model: str


async def _make_token(email: str) -> str:
    policies = await get_security_policies()
    minutes = policies.get("session_timeout_minutes") or settings.ACCESS_TOKEN_EXPIRE_MINUTES
    exp = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    return jwt.encode({"sub": email, "exp": exp}, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


async def _validate_password_policy(password: str) -> None:
    """Enforce the admin-configured password policy (MVP2 §2.20 Security
    Policies) — falls back to the permissive defaults (min length 1, no
    number/symbol requirement) whenever unconfigured, which is provably
    identical to today's behavior (no password check exists at all) for
    every existing account and every existing test."""
    policies = await get_security_policies()
    min_length = policies.get("password_min_length") or 1
    if len(password) < min_length:
        raise HTTPException(400, f"Password must be at least {min_length} characters long")
    if policies.get("password_require_number") and not any(c.isdigit() for c in password):
        raise HTTPException(400, "Password must contain at least one number")
    if policies.get("password_require_symbol") and not any(not c.isalnum() for c in password):
        raise HTTPException(400, "Password must contain at least one symbol")

def _otp() -> str:
    return "".join(random.choices(string.digits, k=6))

async def _send_otp(email: str, code: str):
    from services.hr_module.email_service import send_otp_email
    await send_otp_email(to_email=email, otp_code=code)


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _parse_locked_until(value) -> datetime | None:
    """Best-effort parse of the `users.locked_until` field back into an
    aware UTC datetime. Always written as an isoformat() string by this
    module (see login() below), but tolerates a stray native datetime or a
    malformed/legacy value without ever raising — a parse failure is treated
    as "not locked" rather than failing the login request."""
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value) if isinstance(value, str) else value
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


@router.post("/login")
async def login(body: LoginRequest, request: Request):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    email = body.email.lower().strip()
    await enforce_rate_limit(
        db, key=f"login:email:{email}",
        limit=settings.LOGIN_RATE_LIMIT, window_seconds=settings.LOGIN_RATE_LIMIT_WINDOW_SECONDS,
    )
    await enforce_rate_limit(
        db, key=f"login:ip:{_client_ip(request)}",
        limit=settings.LOGIN_RATE_LIMIT * 3, window_seconds=settings.LOGIN_RATE_LIMIT_WINDOW_SECONDS,
    )
    user = await db.users.find_one({"email": email})
    if not user:
        logger.warning("Login failed — no user found for email: %s", email)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")

    policies = await get_security_policies()
    max_attempts = policies.get("max_login_attempts_before_lockout") or 0
    if max_attempts > 0:
        locked_until = _parse_locked_until(user.get("locked_until"))
        if locked_until and locked_until > datetime.now(timezone.utc):
            logger.warning("Login rejected — account locked until %s: %s", locked_until, email)
            raise HTTPException(423, "Account temporarily locked due to too many failed login attempts. Try again later.")

    pw_ok = pwd_ctx.verify(body.password, user.get("password_hash", ""))
    if not pw_ok:
        logger.warning("Login failed — wrong password for: %s", email)
        if max_attempts > 0:
            attempts = user.get("failed_login_attempts", 0) + 1
            update: dict = {"failed_login_attempts": attempts}
            if attempts >= max_attempts:
                lockout_minutes = policies.get("account_lockout_duration_minutes") or 15
                update["locked_until"] = (
                    datetime.now(timezone.utc) + timedelta(minutes=lockout_minutes)
                ).isoformat()
                await db.users.update_one({"email": email}, {"$set": update})
                raise HTTPException(423, "Account locked due to too many failed login attempts. Try again later.")
            await db.users.update_one({"email": email}, {"$set": update})
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")

    if max_attempts > 0 and (user.get("failed_login_attempts") or user.get("locked_until")):
        await db.users.update_one(
            {"email": email},
            {"$set": {"failed_login_attempts": 0}, "$unset": {"locked_until": ""}},
        )

    if not user.get("is_active", True):
        logger.warning("Login failed — account disabled: %s", email)
        raise HTTPException(403, "Account disabled")
    if user.get("otp_required"):
        code = _otp()
        hashed = hashlib.sha256(code.encode()).hexdigest()
        exp = datetime.now(timezone.utc) + timedelta(minutes=settings.OTP_EXPIRE_MINUTES)
        await db.otp_logs.insert_one({"email": email, "code_hash": hashed, "expires_at": exp, "used": False, "attempts": 0})
        await _send_otp(email, code)
        return {"otp_required": True, "message": "OTP sent to your email"}
    await db.users.update_one({"email": email}, {"$set": {"last_login_at": datetime.now(timezone.utc)}})
    return {
        "otp_required": False,
        "access_token": await _make_token(email),
        "token_type": "bearer",
        "user": {"email": user["email"], "name": user.get("name", ""), "role": user.get("role", "standard")},
    }


@router.post("/verify-otp")
async def verify_otp(body: OTPVerify, request: Request):
    db = get_db()
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

    rec = await db.otp_logs.find_one(
        {"email": email, "used": False, "expires_at": {"$gt": datetime.now(timezone.utc)}},
        sort=[("_id", -1)],
    )
    if not rec:
        raise HTTPException(401, "Invalid or expired OTP")
    if rec.get("attempts", 0) >= settings.OTP_MAX_ATTEMPTS:
        await db.otp_logs.update_one({"_id": rec["_id"]}, {"$set": {"used": True}})
        raise HTTPException(401, "Too many incorrect attempts — request a new OTP")

    hashed = hashlib.sha256(body.otp_code.encode()).hexdigest()
    if hashed != rec.get("code_hash"):
        await db.otp_logs.update_one({"_id": rec["_id"]}, {"$inc": {"attempts": 1}})
        raise HTTPException(401, "Invalid or expired OTP")

    await db.otp_logs.update_one({"_id": rec["_id"]}, {"$set": {"used": True}})
    user = await db.users.find_one({"email": email})
    await db.users.update_one({"email": email}, {"$set": {"last_login_at": datetime.now(timezone.utc)}})
    return {
        "access_token": await _make_token(email),
        "token_type": "bearer",
        "user": {"email": email, "name": user.get("name", "") if user else "", "role": user.get("role", "standard") if user else "standard"},
    }


@router.post("/token")
async def oauth2_token(form: OAuth2PasswordRequestForm = Depends()):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    username = form.username.lower().strip()
    user = await db.users.find_one({"email": username})
    if not user or not pwd_ctx.verify(form.password, user["password_hash"]):
        raise HTTPException(401, "Incorrect credentials")
    return {"access_token": await _make_token(username), "token_type": "bearer"}


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    return user


@router.post("/users")
async def create_user(body: UserCreate, user: dict = Depends(require_admin)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    if await db.users.find_one({"email": body.email}):
        raise HTTPException(400, "Email already registered")
    await _validate_password_policy(body.password)
    await db.users.insert_one({
        "name": body.name, "email": body.email,
        "password_hash": pwd_ctx.hash(body.password),
        "role": body.role, "otp_required": body.otp_required,
        "is_active": True, "created_at": datetime.now(timezone.utc).isoformat(),
    })

    asyncio.create_task(log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="user_create", resource_type="user", resource_id=body.email,
        details={"name": body.name, "role": body.role},
    ))
    return {"message": "User created"}


@router.get("/users")
async def list_users(current: dict = Depends(require_admin)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    query = {} if current.get("role") == "superadmin" else {"role": "standard"}
    return await db.users.find(query, {"_id": 0, "password_hash": 0}).to_list(length=500)


@router.patch("/users/{email}")
async def update_user(email: str, body: UserUpdate, user: dict = Depends(require_admin)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    update = {k: v for k, v in body.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(400, "No fields to update")

    if "role" in update:
        if user.get("role") != "superadmin":
            raise HTTPException(403, "Only a Super Admin can change a user's role")
        if not await is_known_role(db, update["role"]):
            raise HTTPException(400, f"Unknown role: {update['role']}")

    await db.users.update_one({"email": email}, {"$set": update})

    asyncio.create_task(log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="user_update", resource_type="user", resource_id=email,
        details=update,
    ))
    return {"message": "Updated"}


@router.delete("/users/{email}")
async def delete_user(email: str, current: dict = Depends(require_superadmin)):
    if email == current["email"]:
        raise HTTPException(400, "Cannot delete yourself")
    db = get_db()
    if db is not None:
        await db.users.delete_one({"email": email})
        asyncio.create_task(log_audit_event(
            db, actor_email=current["email"], actor_role=current.get("role"),
            action="user_delete", resource_type="user", resource_id=email,
            details={},
        ))
    return {"message": "Deleted"}


@router.post("/change-password")
async def change_password(body: PasswordChange, user: dict = Depends(get_current_user)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    rec = await db.users.find_one({"email": user["email"]})
    if not rec or not pwd_ctx.verify(body.current_password, rec["password_hash"]):
        raise HTTPException(401, "Current password incorrect")
    await _validate_password_policy(body.new_password)
    await db.users.update_one({"email": user["email"]}, {"$set": {"password_hash": pwd_ctx.hash(body.new_password)}})
    return {"message": "Password changed"}


@router.post("/admin/reset-password")
async def admin_reset_password(body: AdminPasswordReset, _: dict = Depends(require_admin)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    await _validate_password_policy(body.new_password)
    await db.users.update_one({"email": body.email}, {"$set": {"password_hash": pwd_ctx.hash(body.new_password)}})
    return {"message": "Password reset"}


@router.get("/models")
async def list_models(_: dict = Depends(get_current_user)):
    return {"models": MODEL_REGISTRY, "current": settings.DEFAULT_LLM_MODEL}


@router.patch("/models/default")
async def set_default_model(body: ModelSettingUpdate, _: dict = Depends(require_admin)):
    valid = {m["id"] for m in MODEL_REGISTRY}
    if body.default_model not in valid:
        raise HTTPException(400, f"Unknown model. Valid: {sorted(valid)}")
    db = get_db()
    if db is not None:
        await db.settings.update_one(
            {"key": "default_llm_model"}, {"$set": {"value": body.default_model}}, upsert=True
        )
    settings.DEFAULT_LLM_MODEL = body.default_model
    return {"message": f"Default model → {body.default_model}"}
