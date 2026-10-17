import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from jose import jwt
from passlib.context import CryptContext

from config import database
from config.database import get_platform_db
from config.settings import settings
from config.tenancy import DEFAULT_COMPANY_ID

pytestmark = pytest.mark.anyio

API = "/api/v1"
_pwd = CryptContext(schemes=["bcrypt"])
PASSWORD = "Password-123!"


def _token(email: str, *, iat: int | None, company: str = DEFAULT_COMPANY_ID) -> dict:
    claims = {"sub": email, "exp": datetime.now(timezone.utc) + timedelta(hours=1), "cid": company}
    if iat is not None:
        claims["iat"] = iat
    token = jwt.encode(claims, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def accounts():
    made: list[str] = []

    async def make(role: str = "standard", **extra) -> str:
        email = f"hard-{uuid.uuid4().hex[:10]}@example.com"
        await get_platform_db().users.insert_one({
            "name": "Hardening", "email": email, "password_hash": _pwd.hash(PASSWORD), "role": role,
            "is_active": True, "otp_required": False, "company_id": DEFAULT_COMPANY_ID,
            "created_at": "2026-01-01T00:00:00+00:00", **extra,
        })
        made.append(email)
        return email

    yield make
    await get_platform_db().users.delete_many({"email": {"$in": made}})
    await get_platform_db().otp_logs.delete_many({"email": {"$in": made}})


async def test_a_password_change_ends_older_sessions_and_hands_back_a_fresh_one(client, accounts):
    email = await accounts()
    old = _token(email, iat=int(time.time()) - 120)
    assert (await client.get(f"{API}/auth/me", headers=old)).status_code == 200

    changed = await client.post(
        f"{API}/auth/change-password", headers=old,
        json={"current_password": PASSWORD, "new_password": "Another-Pass-456!"},
    )
    assert changed.status_code == 200, changed.text
    body = changed.json()
    assert body["message"] == "Password changed" and body["access_token"]

    assert (await client.get(f"{API}/auth/me", headers=old)).status_code == 401
    fresh = {"Authorization": f"Bearer {body['access_token']}"}
    assert (await client.get(f"{API}/auth/me", headers=fresh)).status_code == 200


async def test_a_token_issued_before_this_check_existed_still_works(client, accounts):
    email = await accounts(pwd_changed_at=int(time.time()))
    assert (await client.get(f"{API}/auth/me", headers=_token(email, iat=None))).status_code == 200


async def test_an_admin_reset_ends_the_sessions_and_clears_a_lockout(client, accounts, superadmin_headers):
    email = await accounts(
        failed_login_attempts=7,
        locked_until=(datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
    )
    old = _token(email, iat=int(time.time()) - 120)
    reset = await client.post(
        f"{API}/auth/admin/reset-password", headers=superadmin_headers,
        json={"email": email, "new_password": "Reset-Pass-789!"},
    )
    assert reset.status_code == 200, reset.text
    row = await get_platform_db().users.find_one({"email": email})
    assert row["failed_login_attempts"] == 0 and "locked_until" not in row
    assert (await client.get(f"{API}/auth/me", headers=old)).status_code == 401
    login = await client.post(f"{API}/auth/login", json={"email": email, "password": "Reset-Pass-789!"})
    assert login.status_code == 200, login.text


async def test_a_company_superadmin_cannot_touch_the_platform_owner_in_their_company(client, accounts, superadmin_headers):
    owner = await accounts("superadmin", is_platform_admin=True)
    message = "managed by the platform owner"

    changes = [
        await client.patch(f"{API}/auth/users/{owner}", headers=superadmin_headers, json={"is_active": False}),
        await client.patch(f"{API}/auth/users/{owner}", headers=superadmin_headers, json={"name": "Renamed"}),
        await client.post(
            f"{API}/auth/admin/reset-password", headers=superadmin_headers,
            json={"email": owner, "new_password": "Takeover-123!"},
        ),
        await client.delete(f"{API}/auth/users/{owner}", headers=superadmin_headers),
        await client.patch(f"{API}/rbac/users/{owner}/role", headers=superadmin_headers, json={"role_name": "standard"}),
    ]
    for resp in changes:
        assert resp.status_code == 403 and message in resp.text, (resp.request.url, resp.status_code, resp.text)

    row = await get_platform_db().users.find_one({"email": owner})
    assert row["is_active"] is True and row["role"] == "superadmin" and row["name"] == "Hardening"
    assert _pwd.verify(PASSWORD, row["password_hash"])


async def test_ordinary_users_in_the_same_company_are_still_manageable(client, accounts, superadmin_headers):
    email = await accounts()
    resp = await client.patch(f"{API}/auth/users/{email}", headers=superadmin_headers, json={"name": "Fine"})
    assert resp.status_code == 200, resp.text


async def test_a_login_that_needs_a_code_says_so_when_the_code_could_not_be_sent(client, accounts, monkeypatch):
    from services.hr_module import email_service

    email = await accounts(otp_required=True)

    async def not_sent(**kwargs):
        return False

    monkeypatch.setattr(email_service, "send_otp_email", not_sent)
    resp = await client.post(f"{API}/auth/login", json={"email": email, "password": PASSWORD})
    assert resp.status_code == 502 and "could not send" in resp.text.lower()
    assert await get_platform_db().otp_logs.count_documents({"email": email}) == 0


async def test_a_login_that_needs_a_code_still_works_when_it_is_sent(client, accounts, monkeypatch):
    from services.hr_module import email_service

    email = await accounts(otp_required=True)

    async def sent(**kwargs):
        return True

    monkeypatch.setattr(email_service, "send_otp_email", sent)
    resp = await client.post(f"{API}/auth/login", json={"email": email, "password": PASSWORD})
    assert resp.status_code == 200 and resp.json()["otp_required"] is True


async def test_the_seed_keeps_a_deactivated_owner_off_unless_it_is_the_only_one(monkeypatch):
    raw = get_platform_db()
    tag = uuid.uuid4().hex[:8]
    owner, other = f"seed-owner-{tag}@example.com", f"seed-other-{tag}@example.com"
    monkeypatch.setattr(settings, "DEFAULT_SUPERADMIN_EMAIL", owner)
    base = {
        "name": "Owner", "password_hash": _pwd.hash(PASSWORD), "role": "superadmin", "otp_required": False,
        "is_platform_admin": True, "company_id": "cmp_platform", "created_at": "2026-01-01T00:00:00+00:00",
    }
    try:
        await raw.users.insert_one({**base, "email": owner, "is_active": False})
        await raw.users.insert_one({**base, "email": other, "is_active": True})
        await database._seed_superadmin()
        assert (await raw.users.find_one({"email": owner}))["is_active"] is False

        await raw.users.update_one({"email": other}, {"$set": {"is_active": False}})
        existing_active = await raw.users.count_documents({
            "is_platform_admin": True, "is_active": {"$ne": False}, "email": {"$ne": owner},
        })
        await database._seed_superadmin()
        row = await raw.users.find_one({"email": owner})
        assert row["is_active"] is (existing_active == 0)
    finally:
        await raw.users.delete_many({"email": {"$in": [owner, other]}})


async def test_a_company_cannot_create_an_account_at_a_domain_another_company_claimed(client, superadmin_headers):
    from config.tenancy_migration import client_doc, company_doc

    tag = uuid.uuid4().hex[:8]
    domain = f"claimed-{tag}.example"
    client_id, company_id = f"cli_q{tag}", f"cmp_q{tag}"
    raw = get_platform_db()
    await raw.clients.insert_one(client_doc(client_id, f"Squat {tag}", f"squat-{tag}"))
    await raw.companies.insert_one({**company_doc(company_id, client_id, f"Squat {tag}", f"squat-{tag}"), "sso_domains": [domain]})
    victim = f"ceo@{domain}"
    try:
        resp = await client.post(
            f"{API}/auth/users", headers=superadmin_headers,
            json={"name": "Squatter", "email": victim, "password": PASSWORD, "role": "standard"},
        )
        assert resp.status_code == 400 and "reserved by another company" in resp.text
        assert await raw.users.find_one({"email": victim}) is None
        ok_email = f"fine-{tag}@unclaimed-{tag}.example"
        ok = await client.post(
            f"{API}/auth/users", headers=superadmin_headers,
            json={"name": "Fine", "email": ok_email, "password": PASSWORD, "role": "standard"},
        )
        assert ok.status_code == 200, ok.text
        await raw.users.delete_many({"email": ok_email})
    finally:
        await raw.companies.delete_many({"company_id": company_id})
        await raw.clients.delete_many({"client_id": client_id})
        await raw.users.delete_many({"email": victim})


async def test_the_seed_does_not_promote_an_account_inside_a_customer_company(monkeypatch):
    raw = get_platform_db()
    tag = uuid.uuid4().hex[:8]
    email = f"customer-{tag}@example.com"
    monkeypatch.setattr(settings, "DEFAULT_SUPERADMIN_EMAIL", email)
    await raw.users.insert_one({
        "name": "Customer", "email": email, "password_hash": _pwd.hash(PASSWORD), "role": "standard",
        "is_active": True, "company_id": f"cmp_customer_{tag}", "created_at": "2026-01-01T00:00:00+00:00",
    })
    try:
        await database._seed_superadmin()
        row = await raw.users.find_one({"email": email})
        assert not row.get("is_platform_admin") and row["role"] == "standard"
    finally:
        await raw.users.delete_many({"email": email})
