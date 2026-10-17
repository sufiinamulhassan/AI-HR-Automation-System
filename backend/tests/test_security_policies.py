import time
import uuid

import pytest
from jose import jwt
from passlib.context import CryptContext

from config.database import get_db
from config.settings import settings
from services.hr_module.permissions import DEFAULT_ROLE_PERMISSIONS

pytestmark = pytest.mark.anyio

pwd_ctx = CryptContext(schemes=["bcrypt"])

_DEFAULTS = {
    "password_min_length": 1,
    "password_require_number": False,
    "password_require_symbol": False,
    "max_login_attempts_before_lockout": 0,
    "account_lockout_duration_minutes": 15,
    "session_timeout_minutes": None,
}


@pytest.fixture(autouse=True)
async def _clean_security_policies():
    db = get_db()
    if db is not None:
        await db.security_policies.delete_many({})
    yield
    if db is not None:
        await db.security_policies.delete_many({})


async def _wait_for_audit_entry(db, query: dict, attempts: int = 20, delay: float = 0.15):
    import asyncio
    for _ in range(attempts):
        entry = await db.audit_log.find_one(query)
        if entry is not None:
            return entry
        await asyncio.sleep(delay)
    return None


async def test_get_requires_admin(client, standard_headers):
    resp = await client.get("/api/v1/security-policies", headers=standard_headers)
    assert resp.status_code == 403


async def test_get_requires_authentication(client):
    resp = await client.get("/api/v1/security-policies")
    assert resp.status_code == 401


async def test_get_is_readable_by_a_plain_hr_admin(client, admin_headers):
    resp = await client.get("/api/v1/security-policies", headers=admin_headers)
    assert resp.status_code == 200
    for field in _DEFAULTS:
        assert field in resp.json()


async def test_get_does_not_need_the_manage_permission_but_patch_still_does(client, admin_headers, superadmin_headers):
    db = get_db()
    await db.roles.insert_one({
        "role_name": "superadmin",
        "permissions": [p for p in DEFAULT_ROLE_PERMISSIONS["superadmin"] if p != "security:manage"],
    })
    try:
        assert (await client.get("/api/v1/security-policies", headers=superadmin_headers)).status_code == 200
        blocked = await client.patch(
            "/api/v1/security-policies", json={"password_min_length": 9}, headers=superadmin_headers,
        )
        assert blocked.status_code == 403
        admin_blocked = await client.patch(
            "/api/v1/security-policies", json={"password_min_length": 9}, headers=admin_headers,
        )
        assert admin_blocked.status_code == 403
    finally:
        await db.roles.delete_one({"role_name": "superadmin"})


async def test_get_upserts_permissive_defaults_on_fresh_install(client, superadmin_headers):
    resp = await client.get("/api/v1/security-policies", headers=superadmin_headers)
    assert resp.status_code == 200
    body = resp.json()
    for field, default in _DEFAULTS.items():
        assert body[field] == default, f"{field} default changed, this is a behavior-change regression"

    db = get_db()
    doc = await db.security_policies.find_one({"_id": "singleton"})
    assert doc is not None, "first GET must persist the singleton document, not just return defaults in-memory"


async def test_get_is_idempotent_singleton(client, superadmin_headers):
    first = await client.get("/api/v1/security-policies", headers=superadmin_headers)
    second = await client.get("/api/v1/security-policies", headers=superadmin_headers)
    assert first.status_code == second.status_code == 200

    db = get_db()
    count = await db.security_policies.count_documents({})
    assert count == 1, "GET must never create more than one security_policies document"


async def test_get_allowed_for_superadmin(client, superadmin_headers):
    resp = await client.get("/api/v1/security-policies", headers=superadmin_headers)
    assert resp.status_code == 200


async def test_patch_requires_admin(client, standard_headers):
    resp = await client.patch(
        "/api/v1/security-policies", json={"password_min_length": 8}, headers=standard_headers,
    )
    assert resp.status_code == 403


async def test_patch_updates_only_provided_fields(client, superadmin_headers):
    await client.get("/api/v1/security-policies", headers=superadmin_headers)

    resp = await client.patch(
        "/api/v1/security-policies",
        json={"password_min_length": 8, "password_require_number": True},
        headers=superadmin_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["password_min_length"] == 8
    assert body["password_require_number"] is True
    assert body["password_require_symbol"] is False
    assert body["max_login_attempts_before_lockout"] == 0

    db = get_db()
    count = await db.security_policies.count_documents({})
    assert count == 1, "PATCH must update the existing singleton, never insert a second document"


async def test_patch_ignores_unknown_fields(client, superadmin_headers):
    resp = await client.patch(
        "/api/v1/security-policies",
        json={"password_min_length": 6, "not_a_real_field": "should be dropped"},
        headers=superadmin_headers,
    )
    assert resp.status_code == 200
    assert "not_a_real_field" not in resp.json()


async def test_patch_rejects_invalid_password_min_length(client, superadmin_headers):
    resp = await client.patch(
        "/api/v1/security-policies", json={"password_min_length": 0}, headers=superadmin_headers,
    )
    assert resp.status_code == 400


async def test_patch_rejects_negative_lockout_attempts(client, superadmin_headers):
    resp = await client.patch(
        "/api/v1/security-policies",
        json={"max_login_attempts_before_lockout": -1},
        headers=superadmin_headers,
    )
    assert resp.status_code == 400


async def test_patch_can_explicitly_reset_session_timeout_to_null(client, superadmin_headers):
    first = await client.patch(
        "/api/v1/security-policies", json={"session_timeout_minutes": 30}, headers=superadmin_headers,
    )
    assert first.json()["session_timeout_minutes"] == 30

    second = await client.patch(
        "/api/v1/security-policies", json={"session_timeout_minutes": None}, headers=superadmin_headers,
    )
    assert second.status_code == 200
    assert second.json()["session_timeout_minutes"] is None


async def test_patch_requires_permission_even_for_superadmin_role(client, superadmin_headers):
    db = get_db()
    await db.roles.insert_one({
        "role_name": "superadmin",
        "permissions": [p for p in DEFAULT_ROLE_PERMISSIONS["superadmin"] if p != "security:manage"],
    })
    try:
        resp = await client.patch(
            "/api/v1/security-policies", json={"password_min_length": 8}, headers=superadmin_headers,
        )
        assert resp.status_code == 403
    finally:
        await db.roles.delete_one({"role_name": "superadmin"})


async def test_patch_is_superadmin_only_by_default(client, admin_headers):
    assert "security:manage" not in DEFAULT_ROLE_PERMISSIONS["admin"]
    assert "security:manage" in DEFAULT_ROLE_PERMISSIONS["superadmin"]
    resp = await client.patch(
        "/api/v1/security-policies", json={"password_min_length": 3}, headers=admin_headers,
    )
    assert resp.status_code == 403
    assert isinstance(resp.json()["detail"], str)
    assert "security:manage" in resp.json()["detail"]

    db = get_db()
    stored = await db.security_policies.find_one({"_id": "singleton"})
    assert stored is None or stored.get("password_min_length") != 3, "the refused write must not persist"


async def test_patch_is_audit_logged(client, superadmin_headers):
    from datetime import datetime, timezone

    db = get_db()
    assert db is not None
    started = datetime.now(timezone.utc).isoformat()
    resp = await client.patch(
        "/api/v1/security-policies", json={"password_min_length": 9}, headers=superadmin_headers,
    )
    assert resp.status_code == 200

    entry = await _wait_for_audit_entry(
        db, {
            "action": "security_policy_update", "resource_type": "security_policy",
            "details.password_min_length": 9, "actor_email": "demo-superadmin@hirely.ai",
            "created_at": {"$gte": started},
        },
    )
    assert entry is not None
    assert entry["actor_role"] == "superadmin"


async def _insert_real_user(db, *, password: str, role: str = "standard") -> str:
    email = f"secpolicy-{uuid.uuid4().hex[:10]}@example.com"
    await db.users.insert_one({
        "name": "Security Policy Probe", "email": email,
        "password_hash": pwd_ctx.hash(password),
        "role": role, "is_active": True,
    })
    return email


async def test_password_policy_min_length_enforced_on_user_create(client, superadmin_headers):
    patch_resp = await client.patch(
        "/api/v1/security-policies", json={"password_min_length": 10}, headers=superadmin_headers,
    )
    assert patch_resp.status_code == 200

    too_short = await client.post(
        "/api/v1/auth/users",
        json={"name": "Short Pw", "email": f"shortpw-{uuid.uuid4().hex[:8]}@example.com", "password": "short1"},
        headers=superadmin_headers,
    )
    assert too_short.status_code == 400

    long_enough_email = f"longpw-{uuid.uuid4().hex[:8]}@example.com"
    ok = await client.post(
        "/api/v1/auth/users",
        json={"name": "Long Pw", "email": long_enough_email, "password": "longenough123"},
        headers=superadmin_headers,
    )
    assert ok.status_code == 200

    db = get_db()
    await db.users.delete_one({"email": long_enough_email})


async def test_password_policy_require_number_enforced_on_change_password(client, superadmin_headers):
    db = get_db()
    email = await _insert_real_user(db, password="LettersOnly")
    try:
        patch_resp = await client.patch(
            "/api/v1/security-policies", json={"password_require_number": True}, headers=superadmin_headers,
        )
        assert patch_resp.status_code == 200

        token = await _login_token(client, email, "LettersOnly")
        resp = await client.post(
            "/api/v1/auth/change-password",
            json={"current_password": "LettersOnly", "new_password": "StillNoDigits"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 400

        resp_ok = await client.post(
            "/api/v1/auth/change-password",
            json={"current_password": "LettersOnly", "new_password": "HasADigit1"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp_ok.status_code == 200
    finally:
        await db.users.delete_one({"email": email})


async def _login_token(client, email: str, password: str) -> str:
    resp = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


async def test_default_policy_never_locks_account_regardless_of_failed_attempts(client):
    db = get_db()
    email = await _insert_real_user(db, password="Correct@123")
    try:
        for _ in range(5):
            resp = await client.post(
                "/api/v1/auth/login", json={"email": email, "password": "wrong-password"},
            )
            assert resp.status_code == 401

        ok = await client.post("/api/v1/auth/login", json={"email": email, "password": "Correct@123"})
        assert ok.status_code == 200
    finally:
        await db.users.delete_one({"email": email})


async def test_patch_lockout_threshold_actually_locks_account(client, superadmin_headers):
    db = get_db()
    email = await _insert_real_user(db, password="Correct@123")
    try:
        patch_resp = await client.patch(
            "/api/v1/security-policies",
            json={"max_login_attempts_before_lockout": 2, "account_lockout_duration_minutes": 15},
            headers=superadmin_headers,
        )
        assert patch_resp.status_code == 200

        first = await client.post("/api/v1/auth/login", json={"email": email, "password": "wrong-password"})
        assert first.status_code == 401

        second = await client.post("/api/v1/auth/login", json={"email": email, "password": "wrong-password"})
        assert second.status_code == 423
        assert second.json() == {"detail": "Too many sign-in attempts. Try again later."}

        third = await client.post("/api/v1/auth/login", json={"email": email, "password": "Correct@123"})
        assert third.status_code == 423
        assert third.json() == second.json()

        row = await db.users.find_one({"email": email})
        assert "failed_login_attempts" not in row and "locked_until" not in row
    finally:
        await db.users.delete_one({"email": email})
        await db.rate_limits.delete_many({"_id": {"$regex": "^login:"}})


async def test_patch_session_timeout_actually_shortens_token_lifetime(client, superadmin_headers):
    from routes.auth import _make_token

    db = get_db()
    email = await _insert_real_user(db, password="Correct@123")
    try:
        patch_resp = await client.patch(
            "/api/v1/security-policies", json={"session_timeout_minutes": 5}, headers=superadmin_headers,
        )
        assert patch_resp.status_code == 200

        token = await _make_token(email)
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        ttl_minutes = (payload["exp"] - time.time()) / 60
        assert 3 < ttl_minutes <= 5, f"expected ~5 minute TTL, got {ttl_minutes}"
    finally:
        await db.users.delete_one({"email": email})
