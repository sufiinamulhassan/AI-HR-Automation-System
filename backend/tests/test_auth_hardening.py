import asyncio
import hashlib
import hmac
import json
import types
import uuid

import pytest
from passlib.context import CryptContext

from config.database import get_db
from config.settings import settings
from routes import webhooks as webhook_routes
from routes.auth import _make_token
from services.hr_module import webhook_service
from services.hr_module.permissions import DEFAULT_ROLE_PERMISSIONS, is_reserved_role_name

pytestmark = pytest.mark.anyio

pwd_ctx = CryptContext(schemes=["bcrypt"])

AUTH = "/api/v1/auth"
RBAC = "/api/v1/rbac"
PASSWORD = "Correct@123"
ADMIN_ONLY_MESSAGE = "Only a Super Admin can change this account."


@pytest.fixture(autouse=True)
async def clean_login_state():
    db = get_db()

    async def _clean():
        await db.rate_limits.delete_many({"_id": {"$regex": "^login:"}})
        await db.security_policies.delete_many({})

    await _clean()
    yield
    await _clean()


@pytest.fixture
async def users():
    emails: list[str] = []
    yield emails
    db = get_db()
    await db.users.delete_many({"email": {"$in": emails}})
    await db.audit_log.delete_many({"resource_id": {"$in": emails}})


async def _insert_user(users, *, role="standard", password=PASSWORD, email=None, **extra) -> str:
    email = email or f"hard-{uuid.uuid4().hex[:10]}@example.com"
    doc = {
        "name": "Hardening Probe", "email": email, "role": role,
        "is_active": True, "otp_required": False,
    }
    if password is not None:
        doc["password_hash"] = pwd_ctx.hash(password)
    doc.update(extra)
    await get_db().users.insert_one(doc)
    users.append(email.lower())
    users.append(email)
    return email


async def _bearer(email: str) -> dict:
    return {"Authorization": f"Bearer {await _make_token(email.lower())}"}


async def _stored(email: str) -> dict | None:
    return await get_db().users.find_one({"email": email})


@pytest.fixture
async def sole_superadmin(users):
    db = get_db()
    previously_active = [
        u["email"] async for u in db.users.find({"role": "superadmin", "is_active": {"$ne": False}}, {"email": 1})
    ]
    await db.users.update_many({"role": "superadmin"}, {"$set": {"is_active": False}})
    email = await _insert_user(users, role="superadmin")
    yield email
    await db.users.update_many({"email": {"$in": previously_active}}, {"$set": {"is_active": True}})


@pytest.mark.parametrize("role", ["admin", "superadmin", "some-custom-role"])
async def test_admin_can_only_create_standard_users(client, admin_headers, users, role):
    email = f"made-{uuid.uuid4().hex[:8]}@example.com"
    users.append(email)
    resp = await client.post(
        f"{AUTH}/users",
        json={"name": "Nope", "email": email, "password": PASSWORD, "role": role},
        headers=admin_headers,
    )
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Only a Super Admin can assign this role."
    assert await _stored(email) is None, "a refused create must not leave an account behind"


async def test_admin_creates_a_standard_user_by_default_and_explicitly(client, admin_headers, users):
    for body_role in (None, "standard"):
        email = f"made-{uuid.uuid4().hex[:8]}@example.com"
        users.append(email)
        payload = {"name": "Std", "email": email, "password": PASSWORD}
        if body_role:
            payload["role"] = body_role
        resp = await client.post(f"{AUTH}/users", json=payload, headers=admin_headers)
        assert resp.status_code == 200, resp.text
        assert (await _stored(email))["role"] == "standard"


async def test_superadmin_can_assign_any_known_role(client, superadmin_headers, users):
    db = get_db()
    role_name = f"hard_custom_{uuid.uuid4().hex[:6]}"
    await db.roles.insert_one({"role_name": role_name, "permissions": ["jobs:read"]})
    try:
        for role in ("standard", "admin", "superadmin", role_name):
            email = f"made-{uuid.uuid4().hex[:8]}@example.com"
            users.append(email)
            resp = await client.post(
                f"{AUTH}/users",
                json={"name": "Any", "email": email, "password": PASSWORD, "role": role},
                headers=superadmin_headers,
            )
            assert resp.status_code == 200, f"{role}: {resp.text}"
            assert (await _stored(email))["role"] == role
    finally:
        await db.roles.delete_one({"role_name": role_name})


async def test_superadmin_cannot_assign_an_unknown_role(client, superadmin_headers, users):
    email = f"made-{uuid.uuid4().hex[:8]}@example.com"
    users.append(email)
    resp = await client.post(
        f"{AUTH}/users",
        json={"name": "Odd", "email": email, "password": PASSWORD, "role": f"nope-{uuid.uuid4().hex[:6]}"},
        headers=superadmin_headers,
    )
    assert resp.status_code == 400
    assert "Unknown role" in resp.json()["detail"]
    assert await _stored(email) is None


async def test_created_email_is_stored_lower_cased_and_can_sign_in(client, admin_headers, users):
    local = f"Mixed.Case.{uuid.uuid4().hex[:6]}"
    typed = f"{local}@Example.COM"
    lowered = typed.lower()
    users.append(lowered)
    resp = await client.post(
        f"{AUTH}/users",
        json={"name": "Mixed", "email": typed, "password": PASSWORD},
        headers=admin_headers,
    )
    assert resp.status_code == 200, resp.text
    assert await _stored(lowered) is not None
    assert await _stored(typed) is None, "the original casing must not be stored"

    for spelling in (typed, lowered):
        login = await client.post(f"{AUTH}/login", json={"email": spelling, "password": PASSWORD})
        assert login.status_code == 200, f"{spelling}: {login.text}"
        assert login.json()["user"]["email"] == lowered


async def test_duplicate_email_is_rejected_whatever_the_case(client, admin_headers, users):
    local = f"dup.{uuid.uuid4().hex[:8]}"
    first = f"{local}@example.com"
    users.append(first)
    ok = await client.post(
        f"{AUTH}/users", json={"name": "First", "email": first, "password": PASSWORD}, headers=admin_headers,
    )
    assert ok.status_code == 200
    for spelling in (first, first.upper().replace("@EXAMPLE.COM", "@example.com"), f"{local.title()}@EXAMPLE.com"):
        dup = await client.post(
            f"{AUTH}/users", json={"name": "Second", "email": spelling, "password": PASSWORD}, headers=admin_headers,
        )
        assert dup.status_code == 400, spelling
        assert dup.json()["detail"] == "Email already registered"


async def test_duplicate_check_also_sees_a_legacy_mixed_case_account(client, admin_headers, users):
    legacy = f"Legacy.{uuid.uuid4().hex[:8]}@example.com"
    await _insert_user(users, email=legacy)
    resp = await client.post(
        f"{AUTH}/users",
        json={"name": "Again", "email": legacy.lower(), "password": PASSWORD},
        headers=admin_headers,
    )
    assert resp.status_code == 400


async def test_user_create_is_audited_with_the_stored_email(client, admin_headers, users):
    email = f"Audit.{uuid.uuid4().hex[:8]}@example.com"
    users.append(email.lower())
    await client.post(f"{AUTH}/users", json={"name": "A", "email": email, "password": PASSWORD}, headers=admin_headers)
    row = await get_db().audit_log.find_one({"action": "user_create", "resource_id": email.lower()})
    assert row is not None, "the audit row is written before the response, not in a detached task"
    assert row["details"]["role"] == "standard"


@pytest.mark.parametrize("target_role", ["admin", "superadmin"])
async def test_admin_cannot_modify_a_privileged_account(client, admin_headers, users, target_role):
    email = await _insert_user(users, role=target_role)
    for change in ({"name": "Renamed"}, {"is_active": False}, {"otp_required": False}):
        resp = await client.patch(f"{AUTH}/users/{email}", json=change, headers=admin_headers)
        assert resp.status_code == 403, change
        assert resp.json()["detail"] == ADMIN_ONLY_MESSAGE
    stored = await _stored(email)
    assert stored["name"] == "Hardening Probe" and stored["is_active"] is True


async def test_admin_cannot_modify_a_custom_role_account_either(client, admin_headers, users):
    db = get_db()
    role_name = f"hard_ops_{uuid.uuid4().hex[:6]}"
    await db.roles.insert_one({"role_name": role_name, "permissions": ["jobs:read"]})
    try:
        email = await _insert_user(users, role=role_name)
        resp = await client.patch(f"{AUTH}/users/{email}", json={"is_active": False}, headers=admin_headers)
        assert resp.status_code == 403
        assert (await _stored(email))["is_active"] is True
    finally:
        await db.roles.delete_one({"role_name": role_name})


async def test_admin_can_still_edit_a_standard_account(client, admin_headers, users):
    email = await _insert_user(users)
    resp = await client.patch(
        f"{AUTH}/users/{email}", json={"name": "Renamed", "is_active": False}, headers=admin_headers,
    )
    assert resp.status_code == 200
    stored = await _stored(email)
    assert stored["name"] == "Renamed" and stored["is_active"] is False


async def test_superadmin_can_modify_an_admin_account(client, superadmin_headers, users):
    email = await _insert_user(users, role="admin")
    resp = await client.patch(f"{AUTH}/users/{email}", json={"name": "By Super"}, headers=superadmin_headers)
    assert resp.status_code == 200
    assert (await _stored(email))["name"] == "By Super"


@pytest.mark.parametrize("headers_name", ["admin_headers", "superadmin_headers"])
async def test_patching_an_unknown_user_is_a_404(client, request, headers_name):
    headers = request.getfixturevalue(headers_name)
    resp = await client.patch(
        f"{AUTH}/users/nobody-{uuid.uuid4().hex[:8]}@example.com", json={"name": "Ghost"}, headers=headers,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "User not found"


async def test_patch_finds_a_legacy_mixed_case_account_by_any_casing(client, superadmin_headers, users):
    legacy = f"Legacy.{uuid.uuid4().hex[:8]}@example.com"
    await _insert_user(users, email=legacy)
    resp = await client.patch(f"{AUTH}/users/{legacy.lower()}", json={"name": "Found"}, headers=superadmin_headers)
    assert resp.status_code == 200
    assert (await _stored(legacy))["name"] == "Found"


async def test_nobody_can_deactivate_or_change_their_own_account(client, users):
    me = await _insert_user(users, role="superadmin")
    other = await _insert_user(users, role="superadmin")
    headers = await _bearer(me)

    deactivate = await client.patch(f"{AUTH}/users/{me}", json={"is_active": False}, headers=headers)
    assert deactivate.status_code == 409
    assert deactivate.json()["detail"] == "You cannot deactivate your own account."

    for role in ("standard", "admin"):
        demote = await client.patch(f"{AUTH}/users/{me}", json={"role": role}, headers=headers)
        assert demote.status_code == 409, role
        assert demote.json()["detail"] == "You cannot change your own role."

    stored = await _stored(me)
    assert stored["role"] == "superadmin" and stored["is_active"] is True

    assert (await client.patch(f"{AUTH}/users/{me}", json={"name": "Me Again"}, headers=headers)).status_code == 200
    assert (await client.patch(f"{AUTH}/users/{me}", json={"role": "superadmin"}, headers=headers)).status_code == 200
    assert (await client.patch(f"{AUTH}/users/{other}", json={"is_active": False}, headers=headers)).status_code == 200


async def test_the_last_active_superadmin_cannot_be_deactivated_or_demoted(client, superadmin_headers, sole_superadmin):
    for change, word in (({"is_active": False}, "deactivated"), ({"role": "admin"}, "demoted")):
        resp = await client.patch(f"{AUTH}/users/{sole_superadmin}", json=change, headers=superadmin_headers)
        assert resp.status_code == 409, change
        assert "last active Super Admin" in resp.json()["detail"]
        assert word in resp.json()["detail"]
    stored = await _stored(sole_superadmin)
    assert stored["role"] == "superadmin" and stored["is_active"] is True


async def test_a_superadmin_can_be_deactivated_once_another_exists(client, superadmin_headers, users, sole_superadmin):
    await _insert_user(users, role="superadmin")
    resp = await client.patch(f"{AUTH}/users/{sole_superadmin}", json={"is_active": False}, headers=superadmin_headers)
    assert resp.status_code == 200
    assert (await _stored(sole_superadmin))["is_active"] is False


async def test_an_inactive_superadmin_does_not_count_as_a_second_one(client, superadmin_headers, users, sole_superadmin):
    await _insert_user(users, role="superadmin", is_active=False)
    resp = await client.patch(f"{AUTH}/users/{sole_superadmin}", json={"is_active": False}, headers=superadmin_headers)
    assert resp.status_code == 409


async def test_user_update_is_audited(client, admin_headers, users):
    email = await _insert_user(users)
    await client.patch(f"{AUTH}/users/{email}", json={"name": "Audited"}, headers=admin_headers)
    row = await get_db().audit_log.find_one({"action": "user_update", "resource_id": email})
    assert row is not None and row["details"] == {"name": "Audited"}


async def test_rbac_assignment_refuses_self_demotion(client, users):
    me = await _insert_user(users, role="superadmin")
    await _insert_user(users, role="superadmin")
    resp = await client.patch(f"{RBAC}/users/{me}/role", json={"role_name": "standard"}, headers=await _bearer(me))
    assert resp.status_code == 409
    assert resp.json()["detail"] == "You cannot change your own role."
    assert (await _stored(me))["role"] == "superadmin"


async def test_rbac_assignment_protects_the_last_superadmin(client, superadmin_headers, users, sole_superadmin):
    resp = await client.patch(
        f"{RBAC}/users/{sole_superadmin}/role", json={"role_name": "standard"}, headers=superadmin_headers,
    )
    assert resp.status_code == 409
    assert "last active Super Admin" in resp.json()["detail"]
    assert (await _stored(sole_superadmin))["role"] == "superadmin"

    await _insert_user(users, role="superadmin")
    ok = await client.patch(
        f"{RBAC}/users/{sole_superadmin}/role", json={"role_name": "admin"}, headers=superadmin_headers,
    )
    assert ok.status_code == 200
    assert (await _stored(sole_superadmin))["role"] == "admin"


async def test_rbac_assignment_still_promotes_other_users(client, superadmin_headers, users):
    email = await _insert_user(users)
    resp = await client.patch(f"{RBAC}/users/{email}/role", json={"role_name": "admin"}, headers=superadmin_headers)
    assert resp.status_code == 200
    assert resp.json() == {"email": email, "role": "admin"}


@pytest.mark.parametrize("target_role", ["admin", "superadmin"])
async def test_admin_cannot_reset_a_privileged_accounts_password(client, admin_headers, users, target_role):
    email = await _insert_user(users, role=target_role)
    resp = await client.post(
        f"{AUTH}/admin/reset-password", json={"email": email, "new_password": "Hijacked@999"}, headers=admin_headers,
    )
    assert resp.status_code == 403
    assert resp.json()["detail"] == ADMIN_ONLY_MESSAGE
    assert (await client.post(f"{AUTH}/login", json={"email": email, "password": PASSWORD})).status_code == 200
    assert (await client.post(f"{AUTH}/login", json={"email": email, "password": "Hijacked@999"})).status_code == 401
    assert await get_db().audit_log.find_one({"action": "user_password_reset", "resource_id": email}) is None


async def test_admin_resets_a_standard_users_password_and_it_is_audited(client, admin_headers, users):
    email = await _insert_user(users)
    resp = await client.post(
        f"{AUTH}/admin/reset-password", json={"email": email, "new_password": "Fresh@4567"}, headers=admin_headers,
    )
    assert resp.status_code == 200
    assert (await client.post(f"{AUTH}/login", json={"email": email, "password": "Fresh@4567"})).status_code == 200
    assert (await client.post(f"{AUTH}/login", json={"email": email, "password": PASSWORD})).status_code == 401

    row = await get_db().audit_log.find_one({"action": "user_password_reset", "resource_id": email})
    assert row is not None
    assert row["actor_email"] == "demo-admin@hirely.ai"
    assert row["resource_type"] == "user"
    assert "Fresh@4567" not in json.dumps(row, default=str), "the new password must never reach the audit log"


async def test_superadmin_can_reset_an_admins_password(client, superadmin_headers, users):
    email = await _insert_user(users, role="admin")
    resp = await client.post(
        f"{AUTH}/admin/reset-password", json={"email": email, "new_password": "ByRoot@1234"}, headers=superadmin_headers,
    )
    assert resp.status_code == 200
    assert (await client.post(f"{AUTH}/login", json={"email": email, "password": "ByRoot@1234"})).status_code == 200
    assert await get_db().audit_log.find_one({"action": "user_password_reset", "resource_id": email}) is not None


async def test_reset_for_an_unknown_email_is_a_404_and_writes_no_audit_row(client, admin_headers):
    email = f"nobody-{uuid.uuid4().hex[:8]}@example.com"
    resp = await client.post(
        f"{AUTH}/admin/reset-password", json={"email": email, "new_password": "Whatever@1"}, headers=admin_headers,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "User not found"
    assert await get_db().audit_log.find_one({"action": "user_password_reset", "resource_id": email}) is None


async def test_reset_matches_the_email_case_insensitively(client, admin_headers, users):
    email = await _insert_user(users)
    resp = await client.post(
        f"{AUTH}/admin/reset-password",
        json={"email": email.upper().replace("@EXAMPLE.COM", "@example.com"), "new_password": "Cased@12345"},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    assert (await client.post(f"{AUTH}/login", json={"email": email, "password": "Cased@12345"})).status_code == 200


async def test_reset_still_requires_an_admin(client, standard_headers):
    resp = await client.post(
        f"{AUTH}/admin/reset-password", json={"email": "user@hirely.ai", "new_password": "x"}, headers=standard_headers,
    )
    assert resp.status_code == 403


async def _token(client, email, password=PASSWORD):
    return await client.post(f"{AUTH}/token", data={"username": email, "password": password})


async def test_token_issues_a_token_for_a_normal_account(client, users):
    email = await _insert_user(users)
    resp = await _token(client, email)
    assert resp.status_code == 200
    assert resp.json()["token_type"] == "bearer"
    me = await client.get(f"{AUTH}/me", headers={"Authorization": f"Bearer {resp.json()['access_token']}"})
    assert me.json()["email"] == email


async def test_token_refuses_an_account_that_requires_a_one_time_code(client, users):
    email = await _insert_user(users, otp_required=True)
    resp = await _token(client, email)
    assert resp.status_code == 403
    assert "one-time code" in resp.json()["detail"]
    assert "access_token" not in resp.json()


async def test_token_refuses_a_disabled_account_but_only_after_the_password_is_right(client, users):
    email = await _insert_user(users, is_active=False)
    refused = await _token(client, email)
    assert refused.status_code == 403
    assert refused.json()["detail"] == "Account disabled"
    assert (await _token(client, email, "wrong-password")).status_code == 401


async def test_token_wrong_password_and_unknown_user_are_401(client, users):
    email = await _insert_user(users)
    assert (await _token(client, email, "wrong-password")).status_code == 401
    assert (await _token(client, f"ghost-{uuid.uuid4().hex[:8]}@example.com")).status_code == 401


async def test_token_shares_the_account_lockout_with_login(client, superadmin_headers, users):
    email = await _insert_user(users)
    patch = await client.patch(
        "/api/v1/security-policies",
        json={"max_login_attempts_before_lockout": 2, "account_lockout_duration_minutes": 15},
        headers=superadmin_headers,
    )
    assert patch.status_code == 200

    assert (await _token(client, email, "wrong-1")).status_code == 401
    assert (await _token(client, email, "wrong-2")).status_code == 423

    assert (await _token(client, email)).status_code == 423
    assert (await client.post(f"{AUTH}/login", json={"email": email, "password": PASSWORD})).status_code == 423


async def test_login_failures_count_toward_the_token_lockout_too(client, superadmin_headers, users):
    email = await _insert_user(users)
    await client.patch(
        "/api/v1/security-policies", json={"max_login_attempts_before_lockout": 2}, headers=superadmin_headers,
    )
    assert (await client.post(f"{AUTH}/login", json={"email": email, "password": "wrong-1"})).status_code == 401
    assert (await _token(client, email, "wrong-2")).status_code == 423


async def test_token_shares_the_login_rate_limit(client, monkeypatch):
    monkeypatch.setattr(settings, "LOGIN_RATE_LIMIT", 3)
    email = f"ratelimit-{uuid.uuid4().hex[:8]}@example.com"
    statuses = []
    for attempt in range(5):
        if attempt < 2:
            resp = await client.post(f"{AUTH}/login", json={"email": email, "password": "wrong"})
        else:
            resp = await _token(client, email, "wrong")
        statuses.append(resp.status_code)
    assert statuses == [401, 401, 401, 429, 429]


@pytest.mark.parametrize("stored", ["missing", None, ""])
async def test_accounts_with_no_password_are_refused_cleanly_everywhere(client, users, stored):
    extra = {} if stored == "missing" else {"password_hash": stored}
    email = await _insert_user(users, password=None, **extra)

    login = await client.post(f"{AUTH}/login", json={"email": email, "password": PASSWORD})
    assert login.status_code == 401
    assert login.json()["detail"] == "Invalid credentials"

    token = await _token(client, email)
    assert token.status_code == 401

    change = await client.post(
        f"{AUTH}/change-password",
        json={"current_password": PASSWORD, "new_password": "Brand@New1"},
        headers=await _bearer(email),
    )
    assert change.status_code == 400
    assert "single sign-on" in change.json()["detail"]
    assert (await _stored(email)).get("password_hash") == extra.get("password_hash")


async def test_an_unreadable_stored_hash_is_a_wrong_password_not_a_500(client, users):
    email = await _insert_user(users, password=None, password_hash="not-a-bcrypt-hash")
    assert (await client.post(f"{AUTH}/login", json={"email": email, "password": PASSWORD})).status_code == 401
    assert (await _token(client, email)).status_code == 401
    change = await client.post(
        f"{AUTH}/change-password",
        json={"current_password": PASSWORD, "new_password": "Brand@New1"},
        headers=await _bearer(email),
    )
    assert change.status_code == 400


async def test_wrong_current_password_is_a_400_not_a_401(client, users):
    email = await _insert_user(users)
    headers = await _bearer(email)
    resp = await client.post(
        f"{AUTH}/change-password",
        json={"current_password": "not-my-password", "new_password": "Brand@New1"},
        headers=headers,
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Current password incorrect"
    assert (await client.post(f"{AUTH}/login", json={"email": email, "password": PASSWORD})).status_code == 200


async def test_correct_current_password_changes_it(client, users):
    email = await _insert_user(users)
    resp = await client.post(
        f"{AUTH}/change-password",
        json={"current_password": PASSWORD, "new_password": "Brand@New1"},
        headers=await _bearer(email),
    )
    assert resp.status_code == 200
    assert (await client.post(f"{AUTH}/login", json={"email": email, "password": "Brand@New1"})).status_code == 200


async def test_change_password_with_no_session_is_still_a_401(client):
    resp = await client.post(f"{AUTH}/change-password", json={"current_password": "a", "new_password": "b"})
    assert resp.status_code == 401


@pytest.mark.parametrize("name", ["standard", "admin", "superadmin", "Admin", "SUPERADMIN", " Standard ", "sUpErAdMiN"])
async def test_built_in_role_names_cannot_be_created_as_custom_roles(client, superadmin_headers, name):
    db = get_db()
    resp = await client.post(
        f"{RBAC}/roles", json={"role_name": name, "permissions": []}, headers=superadmin_headers,
    )
    assert resp.status_code == 400
    assert "reserved" in resp.json()["detail"]
    assert await db.roles.find_one({"role_name": name}) is None
    from services.hr_module.permissions import resolve_permissions
    assert await resolve_permissions("superadmin") == DEFAULT_ROLE_PERMISSIONS["superadmin"]


async def test_other_role_names_are_still_fine(client, superadmin_headers):
    name = f"administrator_{uuid.uuid4().hex[:6]}"
    resp = await client.post(
        f"{RBAC}/roles", json={"role_name": name, "permissions": ["jobs:read"]}, headers=superadmin_headers,
    )
    try:
        assert resp.status_code == 200, resp.text
    finally:
        await get_db().roles.delete_one({"role_name": name})


async def test_reserved_name_check_ignores_case_and_whitespace():
    for name in ("admin", "ADMIN", " superadmin", "Standard "):
        assert is_reserved_role_name(name)
    for name in ("", None, "administrator", "super admin", "recruiter"):
        assert not is_reserved_role_name(name)


async def test_security_manage_is_superadmin_only_by_default():
    assert "security:manage" in DEFAULT_ROLE_PERMISSIONS["superadmin"]
    assert "security:manage" not in DEFAULT_ROLE_PERMISSIONS["admin"]
    assert "security:manage" not in DEFAULT_ROLE_PERMISSIONS["standard"]


async def test_an_admin_cannot_weaken_the_security_policy_but_a_superadmin_can(client, admin_headers, superadmin_headers):
    refused = await client.patch(
        "/api/v1/security-policies", json={"password_min_length": 2}, headers=admin_headers,
    )
    assert refused.status_code == 403
    assert isinstance(refused.json()["detail"], str)

    allowed = await client.patch(
        "/api/v1/security-policies", json={"password_min_length": 12}, headers=superadmin_headers,
    )
    assert allowed.status_code == 200
    assert allowed.json()["password_min_length"] == 12


@pytest.fixture
def public_webhooks(monkeypatch):
    monkeypatch.setattr(webhook_routes, "is_url_ssrf_safe", lambda url: True)
    monkeypatch.setattr(webhook_service, "is_url_ssrf_safe", lambda url: True)


@pytest.fixture
async def webhook_ids():
    ids: list[str] = []
    yield ids
    await get_db().webhook_subscriptions.delete_many({"webhook_id": {"$in": ids}})


async def _create_webhook(client, headers, ids, **fields) -> dict:
    wanted = fields.pop("event_types", ["hardening.never"])
    payload = {"url": "https://hooks.example.test/in", "event_types": ["candidate.invited"]}
    payload.update(fields)
    resp = await client.post("/api/v1/webhooks", json=payload, headers=headers)
    assert resp.status_code == 200, resp.text
    ids.append(resp.json()["webhook_id"])
    await get_db().webhook_subscriptions.update_one(
        {"webhook_id": resp.json()["webhook_id"]}, {"$set": {"event_types": wanted}},
    )
    return {**resp.json(), "event_types": wanted}


async def test_webhook_secret_is_never_returned(client, admin_headers, public_webhooks, webhook_ids):
    secret = f"whsec-{uuid.uuid4().hex}"
    created = await _create_webhook(client, admin_headers, webhook_ids, secret=secret)
    wid = created["webhook_id"]

    assert "secret" not in created and created["has_secret"] is True

    listed = [w for w in (await client.get("/api/v1/webhooks", headers=admin_headers)).json()["webhooks"]
              if w["webhook_id"] == wid]
    assert len(listed) == 1 and "secret" not in listed[0] and listed[0]["has_secret"] is True

    single = await client.get(f"/api/v1/webhooks/{wid}", headers=admin_headers)
    assert "secret" not in single.json() and single.json()["has_secret"] is True

    patched = await client.patch(f"/api/v1/webhooks/{wid}", json={"is_active": False}, headers=admin_headers)
    assert "secret" not in patched.json() and patched.json()["has_secret"] is True

    for response in (single, patched):
        assert secret not in response.text
    assert secret not in (await client.get("/api/v1/webhooks", headers=admin_headers)).text

    assert (await get_db().webhook_subscriptions.find_one({"webhook_id": wid}))["secret"] == secret


async def test_has_secret_tracks_whether_one_is_set(client, admin_headers, public_webhooks, webhook_ids):
    created = await _create_webhook(client, admin_headers, webhook_ids)
    wid = created["webhook_id"]
    assert created["has_secret"] is False

    with_secret = await client.patch(f"/api/v1/webhooks/{wid}", json={"secret": "newly-set"}, headers=admin_headers)
    assert with_secret.json()["has_secret"] is True and "secret" not in with_secret.json()

    cleared = await client.patch(f"/api/v1/webhooks/{wid}", json={"secret": None}, headers=admin_headers)
    assert cleared.json()["has_secret"] is False
    assert (await client.get(f"/api/v1/webhooks/{wid}", headers=admin_headers)).json()["has_secret"] is False


async def test_webhook_secret_is_not_written_to_the_audit_log(client, admin_headers, public_webhooks, webhook_ids):
    secret = f"whsec-{uuid.uuid4().hex}"
    created = await _create_webhook(client, admin_headers, webhook_ids, secret=secret)
    await client.patch(f"/api/v1/webhooks/{created['webhook_id']}", json={"secret": secret + "-2"}, headers=admin_headers)
    await asyncio.sleep(0.3)
    audit = get_db().audit_log
    try:
        rows = await audit.find({"resource_id": created["webhook_id"]}).to_list(length=10)
        assert rows, "expected the create and update to be audited"
        assert secret not in json.dumps(rows, default=str)
    finally:
        await audit.delete_many({"resource_id": created["webhook_id"]})


async def test_delivery_still_signs_with_the_stored_secret(monkeypatch, client, admin_headers, public_webhooks, webhook_ids):
    secret = f"whsec-{uuid.uuid4().hex}"
    event = f"hardening.signed.{uuid.uuid4().hex[:8]}"
    await _create_webhook(client, admin_headers, webhook_ids, secret=secret, event_types=[event])

    posts: list[dict] = []

    async def fake_safe_request(method, url, *, content=None, headers=None, **kwargs):
        posts.append({"url": url, "content": content, "headers": headers})
        return types.SimpleNamespace(status_code=200)

    monkeypatch.setattr(webhook_service, "safe_request", fake_safe_request)
    await webhook_service.fire_webhook_event(event, {"candidate_id": "abc"})

    assert len(posts) == 1
    expected = hmac.new(secret.encode(), posts[0]["content"], hashlib.sha256).hexdigest()
    assert posts[0]["headers"]["X-Webhook-Signature"] == expected
    assert json.loads(posts[0]["content"]) == {"candidate_id": "abc"}


STATUS = "/api/v1/company-settings/integrations-status"


async def _core(client, headers) -> dict:
    resp = await client.get(STATUS, headers=headers)
    assert resp.status_code == 200, resp.text
    return {item["id"]: item for item in resp.json()["core"]}


async def test_integrations_lists_anthropic_without_leaking_the_key(client, admin_headers, monkeypatch):
    key = f"sk-ant-{uuid.uuid4().hex}"
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", key)
    resp = await client.get(STATUS, headers=admin_headers)
    core = {item["id"]: item for item in resp.json()["core"]}
    assert core["anthropic"] == {"id": "anthropic", "label": "Anthropic", "configured": True}
    assert key not in resp.text

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")
    assert (await _core(client, admin_headers))["anthropic"]["configured"] is False
    assert "openai" in await _core(client, admin_headers), "nothing else was removed"


@pytest.mark.parametrize("host,ses,expected", [
    ("", False, False),
    ("smtp.example.test", False, True),
    ("", True, True),
    ("smtp.example.test", True, True),
])
async def test_smtp_email_counts_ses_as_configured(client, admin_headers, monkeypatch, host, ses, expected):
    monkeypatch.setattr(settings, "EMAIL_HOST", host)
    monkeypatch.setattr(settings, "AWS_SES_ENABLED", ses)
    assert (await _core(client, admin_headers))["smtp_email"]["configured"] is expected


@pytest.mark.parametrize("provider,judge0_url,piston_url,judge0_on,piston_on", [
    ("judge0", "http://judge0.test", "http://piston.test/api/v2", True, False),
    ("piston", "http://judge0.test", "http://piston.test/api/v2", False, True),
    ("piston", "http://judge0.test", "", False, False),
    ("judge0", "", "http://piston.test/api/v2", False, False),
    ("judge0", "", "", False, False),
])
async def test_code_sandbox_is_configured_only_for_the_active_provider(
    client, admin_headers, monkeypatch, provider, judge0_url, piston_url, judge0_on, piston_on,
):
    monkeypatch.setattr(settings, "CODE_SANDBOX_PROVIDER", provider)
    monkeypatch.setattr(settings, "JUDGE0_API_URL", judge0_url)
    monkeypatch.setattr(settings, "PISTON_API_URL", piston_url)
    core = await _core(client, admin_headers)
    assert core["judge0"]["configured"] is judge0_on
    assert core["piston"]["configured"] is piston_on
    assert core["judge0"]["active"] is (provider == "judge0")
    assert core["piston"]["active"] is (provider == "piston")
