import base64
import hashlib
import re
import sys
import time
import types
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from httpx import ASGITransport, AsyncClient
from jose import jwt
from passlib.context import CryptContext

from config import tenancy
from config.database import get_db, get_platform_db
from config.settings import settings
from config.tenancy import DEFAULT_COMPANY_ID, PLATFORM_COMPANY_ID, company_context
from config.tenancy_migration import client_doc, company_doc
from main import app
from routes import auth as auth_routes
from routes import oidc as oidc_routes
from services.hr_module import account_protection_service as lockout
from services.hr_module import email_service, oidc_service, totp_service
from services.hr_module.security_policy_service import update_security_policies
from shared import safe_http
from shared import secrets as secret_store
from shared.safe_http import UnsafeTarget

pytestmark = pytest.mark.anyio

API = "/api/v1"
_pwd = CryptContext(schemes=["bcrypt"])
PASSWORD = "Password-123!"
LOCKED = {"detail": "Too many sign-in attempts. Try again later."}
ENFORCED = "Your company requires single sign-on."
ISSUER = "https://idp.example.test/tenant1"
CLIENT_ID = "hrbot-client"
CLIENT_SECRET = "the-very-secret-value"


@pytest.fixture
def no_fallback():
    previous = tenancy._fallback_company_id
    tenancy.use_fallback_company(None)
    yield
    tenancy.use_fallback_company(previous)


@pytest.fixture(autouse=True)
async def clean_state():
    pattern = {"_id": {"$regex": "^(login|otp-verify|forgot|reset|invite|totp|sso-test|public:sso-oidc):"}}

    async def _clean():
        await get_platform_db().rate_limits.delete_many(pattern)
        with company_context(DEFAULT_COMPANY_ID):
            await get_db().security_policies.delete_many({})

    await _clean()
    yield
    await _clean()


@pytest.fixture
async def web():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest.fixture
async def make_company():
    made: list[tuple[str, str]] = []

    async def make(*, plan: dict | None = None, status: str = "active") -> SimpleNamespace:
        tag = uuid.uuid4().hex[:8]
        client_id, company_id = f"cli_i{tag}", f"cmp_i{tag}"
        client = client_doc(client_id, f"Client {tag}", f"client-{tag}")
        if plan:
            client["plan"] = {**client["plan"], **plan}
        domain = f"{tag}.example.com"
        raw = get_platform_db()
        await raw.clients.insert_one(client)
        await raw.companies.insert_one({
            **company_doc(company_id, client_id, f"Acme {tag}", f"acme-{tag}"), "status": status, "sso_domains": [domain],
        })
        made.append((client_id, company_id))
        return SimpleNamespace(company_id=company_id, client_id=client_id, name=f"Acme {tag}", slug=f"acme-{tag}", domain=domain, tag=tag)

    yield make
    raw = get_platform_db()
    for client_id, company_id in made:
        for name in await raw.list_collection_names():
            if name not in ("clients", "companies", "settings"):
                await raw[name].delete_many({"company_id": company_id})
        await raw.companies.delete_many({"company_id": company_id})
        await raw.clients.delete_many({"client_id": client_id})


@pytest.fixture
async def make_user():
    emails: list[str] = []

    async def make(company, *, role: str = "standard", email: str | None = None, password: str | None = PASSWORD, **extra) -> str:
        email = email or f"id-{uuid.uuid4().hex[:10]}@{company.domain}"
        doc = {
            "name": "Identity Person", "email": email, "role": role, "is_active": True, "otp_required": False,
            "company_id": company.company_id, "created_at": "2026-01-01T00:00:00+00:00", **extra,
        }
        if password is not None:
            doc["password_hash"] = _pwd.hash(password)
        await get_platform_db().users.insert_one(doc)
        emails.append(email)
        return email

    yield make
    await get_platform_db().users.delete_many({"email": {"$in": emails}})
    await get_platform_db().otp_logs.delete_many({"email": {"$in": emails}})


class Outbox:
    def __init__(self):
        self.mail: list[dict] = []

    def codes(self) -> list[dict]:
        return [m for m in self.mail if m.get("template") == "otp"]


@pytest.fixture
def outbox(monkeypatch):
    box = Outbox()

    async def fake_send_email(**kwargs):
        box.mail.append(kwargs)
        return True

    monkeypatch.setattr(email_service, "send_email", fake_send_email)
    return box


class Clock:

    def __init__(self, step: int):
        self.step = step

    def advance(self, steps: int = 1) -> None:
        self.step += steps

    def code(self, secret: str, offset: int = 0) -> str:
        return totp_service.hotp(base64.b32decode(secret), self.step + offset)


@pytest.fixture
def clock(monkeypatch):
    state = Clock(step=58_000_000)
    monkeypatch.setattr(totp_service, "step_for", lambda timestamp=None: state.step)
    return state


@pytest.fixture
def alerts(monkeypatch):
    calls: list[dict] = []

    async def alert_owners(key, subject, body, *, company_id=None, cooldown_hours=24):
        calls.append({"key": key, "subject": subject, "body": body, "company_id": company_id})
        return True

    module = types.ModuleType("services.hr_module.alerts_service")
    module.alert_owners = alert_owners
    monkeypatch.setitem(sys.modules, "services.hr_module.alerts_service", module)
    return SimpleNamespace(calls=calls)


def bearer(email: str, *, iat: int | None = None) -> dict:
    claims = {"sub": email, "exp": datetime.now(timezone.utc) + timedelta(hours=1)}
    if iat is not None:
        claims["iat"] = iat
    return {"Authorization": f"Bearer {jwt.encode(claims, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)}"}


async def login(web, email, password=PASSWORD, ip=None):
    return await web.post(
        f"{API}/auth/login", json={"email": email, "password": password}, headers={"x-test-ip": ip} if ip else {},
    )


async def verify(web, email, code):
    return await web.post(f"{API}/auth/verify-otp", json={"email": email, "otp_code": code})


async def set_policy(company, attempts: int, minutes: int = 15) -> None:
    with company_context(company.company_id):
        await update_security_policies(
            max_login_attempts_before_lockout=attempts, account_lockout_duration_minutes=minutes,
        )


async def stored(email: str) -> dict:
    return await get_platform_db().users.find_one({"email": email})


async def test_an_authenticator_app_from_setup_to_turning_it_off(web, make_company, make_user, clock, outbox, monkeypatch, no_fallback):
    monkeypatch.setattr(settings, "OTP_VERIFY_RATE_LIMIT", 50)
    co = await make_company()
    email = await make_user(co)
    boss = await make_user(co, role="superadmin")
    mine, totp = bearer(email), f"{API}/auth/me/totp"

    assert (await web.get(totp, headers=mine)).json() == {"enabled": False, "pending": False, "recovery_codes_remaining": 0}

    setup = await web.post(f"{totp}/setup", headers=mine)
    assert setup.status_code == 200, setup.text
    secret = setup.json()["secret"]
    assert set(setup.json()) == {"secret", "otpauth_uri"} and re.fullmatch(r"[A-Z2-7]{32}", secret)
    assert setup.json()["otpauth_uri"].startswith("otpauth://totp/") and f"secret={secret}" in setup.json()["otpauth_uri"]
    assert (await web.get(totp, headers=mine)).json()["pending"] is True
    row = await stored(email)
    assert row["totp_pending"].startswith("enc:v1:") and secret not in str(row)
    assert not row.get("totp_enabled") and "totp_secret" not in row

    wrong = await web.post(f"{totp}/enable", headers=mine, json={"code": clock.code(secret, 5)})
    assert wrong.status_code == 400 and "not correct" in wrong.json()["detail"]
    enabled = await web.post(f"{totp}/enable", headers=mine, json={"code": clock.code(secret)})
    assert enabled.status_code == 200, enabled.text
    codes = enabled.json()["recovery_codes"]
    assert set(enabled.json()) == {"recovery_codes"} and len(codes) == 8 == len(set(codes))
    assert all(re.fullmatch(r"[a-z2-7]{5}-[a-z2-7]{5}", c) for c in codes)
    row = await stored(email)
    assert row["totp_enabled"] is True and row["totp_secret"].startswith("enc:v1:") and "totp_pending" not in row
    assert row["totp_last_step"] == clock.step
    assert row["totp_recovery_hashes"] == [hashlib.sha256(c.encode()).hexdigest() for c in codes]
    assert not any(c in str(row) for c in codes) and secret not in str(row)
    assert (await web.get(totp, headers=mine)).json() == {"enabled": True, "pending": False, "recovery_codes_remaining": 8}

    me = await web.get(f"{API}/auth/me", headers=mine)
    assert me.json()["totp_enabled"] is True and secret not in me.text
    assert not {"totp_secret", "totp_pending", "totp_recovery_hashes", "totp_last_step"} & set(me.json())
    listed = await web.get(f"{API}/auth/users", headers=bearer(boss))
    mine_row = next(u for u in listed.json() if u["email"] == email)
    assert mine_row["totp_enabled"] is True and not {"totp_secret", "totp_pending", "totp_recovery_hashes", "totp_last_step"} & set(mine_row)
    assert secret not in listed.text and all(c not in listed.text for c in codes)
    others = [u for u in listed.json() if u["email"] != email]
    assert others and all(u["totp_enabled"] is False for u in others)

    assert (await web.post(f"{totp}/setup", headers=mine)).status_code == 409

    clock.advance()
    step_one = await login(web, email)
    assert step_one.status_code == 200
    assert step_one.json() == {"otp_required": True, "method": "totp", "message": "Enter the code from your authenticator app"}
    assert outbox.mail == []
    form = await web.post(f"{API}/auth/token", data={"username": email, "password": PASSWORD})
    assert form.status_code == 403 and "access_token" not in form.json()

    code = clock.code(secret)
    assert (await verify(web, email, clock.code(secret, 5))).status_code == 401
    signed_in = await verify(web, email, code)
    assert signed_in.status_code == 200, signed_in.text
    assert signed_in.json()["user"]["email"] == email and signed_in.json()["token_type"] == "bearer"
    assert "recovery_codes_left" not in signed_in.json()
    token = {"Authorization": f"Bearer {signed_in.json()['access_token']}"}
    assert (await web.get(f"{API}/auth/me", headers=token)).json()["email"] == email

    assert (await login(web, email)).json()["method"] == "totp"
    assert (await verify(web, email, code)).status_code == 401

    opened = await verify(web, email, codes[0].upper())
    assert opened.status_code == 200 and opened.json()["recovery_codes_left"] == 7
    assert (await login(web, email)).json()["method"] == "totp"
    assert (await verify(web, email, codes[0])).status_code == 401
    assert (await web.get(totp, headers=mine)).json()["recovery_codes_remaining"] == 7
    audit = await get_platform_db().audit_log.find_one({"company_id": co.company_id, "action": "totp_recovery_used", "resource_id": email})
    assert audit and "recovery_codes_left" in audit["details"] and codes[0] not in str(audit)

    clock.advance()
    assert (await web.post(f"{totp}/recovery-codes", headers=mine, json={"code": codes[1]})).status_code == 400
    assert (await web.post(f"{totp}/recovery-codes", headers=mine, json={"code": clock.code(secret, 5)})).status_code == 400
    fresh = await web.post(f"{totp}/recovery-codes", headers=mine, json={"code": clock.code(secret)})
    assert fresh.status_code == 200 and len(fresh.json()["recovery_codes"]) == 8
    assert not set(fresh.json()["recovery_codes"]) & set(codes)
    assert (await login(web, email)).json()["method"] == "totp"
    assert (await verify(web, email, codes[1])).status_code == 401

    clock.advance()
    off = f"{totp}/disable"
    bad_password = await web.post(off, headers=mine, json={"password": "wrong", "code": clock.code(secret)})
    assert bad_password.status_code == 400 and bad_password.json()["detail"] == "Current password incorrect"
    bad_code = await web.post(off, headers=mine, json={"password": PASSWORD, "code": clock.code(secret, 5)})
    assert bad_code.status_code == 400
    assert (await stored(email))["totp_enabled"] is True
    done = await web.post(off, headers=mine, json={"password": PASSWORD, "code": clock.code(secret)})
    assert done.status_code == 200 and done.json() == {"enabled": False}
    row = await stored(email)
    assert row["totp_enabled"] is False and not {"totp_secret", "totp_pending", "totp_recovery_hashes", "totp_last_step"} & set(row)
    assert (await web.get(totp, headers=mine)).json() == {"enabled": False, "pending": False, "recovery_codes_remaining": 0}
    plain = await login(web, email)
    assert plain.status_code == 200 and plain.json()["otp_required"] is False and plain.json()["access_token"]
    assert (await web.post(off, headers=mine, json={"password": PASSWORD, "code": "123456"})).status_code == 409

    actions = {
        a["action"] async for a in get_platform_db().audit_log.find({"company_id": co.company_id, "resource_id": email})
    }
    assert {"totp_setup", "totp_enable", "totp_recovery_regenerate", "totp_disable"} <= actions
    dump = str([a async for a in get_platform_db().audit_log.find({"company_id": co.company_id})])
    assert secret not in dump and not any(c in dump for c in codes)


async def test_enable_needs_a_setup_and_a_disable_may_use_a_recovery_code(web, make_company, make_user, clock, monkeypatch, no_fallback):
    co = await make_company()
    email = await make_user(co)
    mine, totp = bearer(email), f"{API}/auth/me/totp"
    assert (await web.post(f"{totp}/enable", headers=mine, json={"code": "123456"})).status_code == 400
    secret = (await web.post(f"{totp}/setup", headers=mine)).json()["secret"]
    second = (await web.post(f"{totp}/setup", headers=mine)).json()["secret"]
    assert second != secret
    assert (await web.post(f"{totp}/enable", headers=mine, json={"code": clock.code(secret)})).status_code == 400
    codes = (await web.post(f"{totp}/enable", headers=mine, json={"code": clock.code(second)})).json()["recovery_codes"]
    assert (await web.post(f"{totp}/enable", headers=mine, json={"code": clock.code(second)})).status_code == 409
    off = await web.post(f"{totp}/disable", headers=mine, json={"password": PASSWORD, "code": codes[2]})
    assert off.status_code == 200 and (await stored(email))["totp_enabled"] is False


async def test_an_account_without_a_password_cannot_set_up_an_app(web, make_company, make_user, no_fallback):
    co = await make_company()
    email = await make_user(co, password=None, sso_provider="oidc")
    refused = await web.post(f"{API}/auth/me/totp/setup", headers=bearer(email))
    assert refused.status_code == 400 and "single sign-on" in refused.json()["detail"]
    assert "totp_pending" not in await stored(email)


async def test_a_code_on_its_own_opens_nothing_and_wrong_codes_are_capped(web, make_company, make_user, clock, monkeypatch, no_fallback):
    monkeypatch.setattr(settings, "OTP_VERIFY_RATE_LIMIT", 50)
    co = await make_company()
    email = await make_user(co)
    mine, totp = bearer(email), f"{API}/auth/me/totp"
    secret = (await web.post(f"{totp}/setup", headers=mine)).json()["secret"]
    await web.post(f"{totp}/enable", headers=mine, json={"code": clock.code(secret)})
    clock.advance()

    assert (await verify(web, email, clock.code(secret))).status_code == 401
    assert (await verify(web, f"ghost-{uuid.uuid4().hex[:6]}@{co.domain}", clock.code(secret))).status_code == 401

    assert (await login(web, email)).json()["method"] == "totp"
    for _ in range(settings.OTP_MAX_ATTEMPTS):
        assert (await verify(web, email, clock.code(secret, 5))).status_code == 401
    capped = await verify(web, email, clock.code(secret))
    assert capped.status_code == 401 and "Too many incorrect attempts" in capped.json()["detail"]
    assert (await login(web, email)).status_code == 200
    assert (await verify(web, email, clock.code(secret))).status_code == 200


async def test_an_authenticator_app_replaces_the_emailed_code(web, make_company, make_user, clock, outbox, monkeypatch, no_fallback):
    monkeypatch.setattr(settings, "OTP_VERIFY_RATE_LIMIT", 50)
    platform = SimpleNamespace(company_id=PLATFORM_COMPANY_ID, domain="platform.example.com")
    owner = await make_user(platform, role="superadmin", is_platform_admin=True, otp_required=True, otp_enforced=True)
    secret = totp_service.new_secret()
    await get_platform_db().users.update_one({"email": owner}, {"$set": {
        "totp_enabled": True, "totp_secret": secret_store.encrypt(secret),
        "totp_recovery_hashes": [],
    }})
    step = await login(web, owner)
    assert step.json() == {"otp_required": True, "method": "totp", "message": "Enter the code from your authenticator app"}
    assert outbox.mail == []
    signed_in = await verify(web, owner, clock.code(secret))
    assert signed_in.status_code == 200 and signed_in.json()["user"]["is_platform_admin"] is True

    co = await make_company()
    emailed = await make_user(co, otp_required=True)
    asked = await login(web, emailed)
    assert asked.status_code == 200
    assert asked.json() == {"otp_required": True, "method": "email", "message": "OTP sent to your email"}
    assert len(outbox.codes()) == 1 and outbox.codes()[0]["to"] == emailed


async def test_an_administrator_can_turn_off_a_lost_authenticator_app(web, make_company, make_user, no_fallback):
    co = await make_company()
    boss = await make_user(co, role="superadmin")
    hr = await make_user(co, role="admin")
    worker = await make_user(co, totp_enabled=True, totp_secret="enc:v1:x", totp_recovery_hashes=["h"], totp_last_step=5)
    peer = await make_user(co, role="admin", totp_enabled=True, totp_secret="enc:v1:x")
    owner = await make_user(co, role="superadmin", is_platform_admin=True, totp_enabled=True, totp_secret="enc:v1:x")
    url = lambda e: f"{API}/auth/users/{e}/totp/reset"

    assert (await web.post(url(worker), headers=bearer(await make_user(co)))).status_code == 403
    assert (await web.post(url(peer), headers=bearer(hr))).status_code == 403
    assert (await web.post(url(owner), headers=bearer(boss))).status_code == 403
    assert (await web.post(url(f"nobody@{co.domain}"), headers=bearer(boss))).status_code == 404
    assert (await web.post(url(hr), headers=bearer(boss))).status_code == 409
    done = await web.post(url(worker), headers=bearer(hr))
    assert done.status_code == 200, done.text
    row = await stored(worker)
    assert row["totp_enabled"] is False and not {"totp_secret", "totp_recovery_hashes", "totp_last_step"} & set(row)
    assert (await web.post(url(peer), headers=bearer(boss))).status_code == 200
    assert (await stored(owner))["totp_enabled"] is True
    audit = await get_platform_db().audit_log.find_one({"company_id": co.company_id, "action": "totp_reset", "resource_id": worker})
    assert audit and audit["actor_email"] == hr


async def test_sign_out_everywhere_ends_every_session_and_hands_back_a_fresh_one(web, make_company, make_user, no_fallback):
    co = await make_company()
    email = await make_user(co)
    laptop = bearer(email, iat=int(time.time()) - 120)
    phone = bearer(email, iat=int(time.time()) - 60)
    me = f"{API}/auth/me"
    assert (await web.get(me, headers=laptop)).status_code == 200

    out = await web.post(f"{API}/auth/me/sign-out-everywhere", headers=phone)
    assert out.status_code == 200, out.text
    assert set(out.json()) == {"access_token", "token_type"} and out.json()["token_type"] == "bearer"
    assert (await web.get(me, headers=laptop)).status_code == 401
    assert (await web.get(me, headers=phone)).status_code == 401
    fresh = {"Authorization": f"Bearer {out.json()['access_token']}"}
    assert (await web.get(me, headers=fresh)).json()["email"] == email
    assert isinstance((await stored(email))["pwd_changed_at"], int)

    audit = await get_platform_db().audit_log.find_one({"company_id": co.company_id, "action": "sign_out_everywhere", "resource_id": email})
    assert audit and audit["actor_email"] == email and out.json()["access_token"] not in str(audit)


async def test_a_lockout_answers_the_same_for_an_address_with_an_account_and_one_without(web, make_company, make_user, no_fallback):
    co = await make_company()
    await set_policy(co, 2)
    known = await make_user(co)
    ghost = f"ghost-{uuid.uuid4().hex[:8]}@{co.domain}"
    seen = {}
    for label, email in (("known", known), ("ghost", ghost)):
        answers = [await login(web, email, "wrong-1"), await login(web, email, "wrong-2"), await login(web, email, PASSWORD)]
        seen[label] = [(r.status_code, r.json()) for r in answers]
    assert seen["known"] == seen["ghost"] == [(401, {"detail": "Invalid credentials"}), (423, LOCKED), (423, LOCKED)]
    row = await stored(known)
    assert "failed_login_attempts" not in row and "locked_until" not in row
    assert await get_platform_db().users.count_documents({"email": ghost}) == 0


async def test_an_address_nobody_claims_is_counted_by_the_default_workspace_policy(web, no_fallback):
    with company_context(DEFAULT_COMPANY_ID):
        await update_security_policies(max_login_attempts_before_lockout=2)
    ghost = f"ghost-{uuid.uuid4().hex[:8]}@unclaimed-{uuid.uuid4().hex[:6]}.example.com"
    answers = [await login(web, ghost, "wrong-1"), await login(web, ghost, "wrong-2"), await login(web, ghost, "wrong-3")]
    assert [(r.status_code, r.json()) for r in answers] == [(401, {"detail": "Invalid credentials"}), (423, LOCKED), (423, LOCKED)]


async def test_a_lock_is_for_one_email_from_one_address(web, make_company, make_user, monkeypatch, no_fallback):
    monkeypatch.setattr(settings, "CLIENT_IP_HEADER", "x-test-ip")
    co = await make_company()
    await set_policy(co, 2)
    email, other = await make_user(co), await make_user(co)
    here, there = "203.0.113.10", "203.0.113.11"
    assert [(await login(web, email, "bad", here)).status_code for _ in range(2)] == [401, 423]
    assert (await login(web, email, PASSWORD, here)).status_code == 423
    assert (await login(web, other, PASSWORD, here)).status_code == 200
    assert (await login(web, email, PASSWORD, there)).status_code == 200
    assert (await login(web, email, PASSWORD, here)).status_code == 423


async def test_a_correct_sign_in_clears_the_pair(web, make_company, make_user, monkeypatch, no_fallback):
    monkeypatch.setattr(settings, "CLIENT_IP_HEADER", "x-test-ip")
    co = await make_company()
    await set_policy(co, 3)
    email = await make_user(co)
    ip = "203.0.113.20"
    assert [(await login(web, email, "bad", ip)).status_code for _ in range(2)] == [401, 401]
    assert (await login(web, email, PASSWORD, ip)).status_code == 200
    assert [(await login(web, email, "bad", ip)).status_code for _ in range(3)] == [401, 401, 423]


async def test_the_token_endpoint_shares_the_lock(web, make_company, make_user, no_fallback):
    co = await make_company()
    await set_policy(co, 2)
    email = await make_user(co)
    form = lambda pw: web.post(f"{API}/auth/token", data={"username": email, "password": pw})
    assert (await form("bad")).status_code == 401
    locked = await form("bad")
    assert locked.status_code == 423 and locked.json() == LOCKED
    assert (await login(web, email, PASSWORD)).status_code == 423


@pytest.mark.parametrize("who", ["known", "ghost"])
async def test_failures_from_many_addresses_lock_the_account_and_tell_the_owners(
    web, make_company, make_user, monkeypatch, alerts, who, no_fallback,
):
    monkeypatch.setattr(settings, "CLIENT_IP_HEADER", "x-test-ip")
    monkeypatch.setattr(settings, "LOGIN_RATE_LIMIT", 1000)
    monkeypatch.setattr(auth_routes, "_verify_password", lambda plain, stored_hash: False)
    co = await make_company()
    await set_policy(co, 2)
    email = await make_user(co) if who == "known" else f"ghost-{uuid.uuid4().hex[:8]}@{co.domain}"
    for i in range(24):
        assert (await login(web, email, "bad", f"198.51.100.{i}")).status_code == 401, i
    assert alerts.calls == []
    tipped = await login(web, email, "bad", "198.51.100.200")
    assert tipped.status_code == 423 and tipped.json() == LOCKED
    assert len(alerts.calls) == 1
    call = alerts.calls[0]
    assert call["key"] == (f"login-lockout:{co.company_id}" if who == "known" else "login-lockout:unknown")
    assert call["company_id"] == (co.company_id if who == "known" else None)
    assert email not in call["body"] and call["subject"]
    assert (await login(web, email, PASSWORD, "192.0.2.1")).status_code == 423
    assert len(alerts.calls) == 1
    past = datetime.now(timezone.utc) - timedelta(minutes=1)
    await get_platform_db().rate_limits.update_many(
        {"_id": lockout.account_key(email)}, {"$set": {"locked_until": past, "expires_at": past}},
    )
    assert (await login(web, email, "bad", "192.0.2.2")).status_code == 401


async def test_a_policy_of_zero_changes_nothing(web, make_company, make_user, monkeypatch, no_fallback):
    monkeypatch.setattr(settings, "LOGIN_RATE_LIMIT", 1000)
    co = await make_company()
    email = await make_user(co)
    for _ in range(12):
        assert (await login(web, email, "bad")).status_code == 401
    assert (await login(web, email, PASSWORD)).status_code == 200
    ghost = f"ghost-{uuid.uuid4().hex[:8]}@{co.domain}"
    for _ in range(12):
        assert (await login(web, ghost, "bad")).status_code == 401
    keys = [lockout.pair_key(e, "127.0.0.1") for e in (email, ghost)] + [lockout.account_key(e) for e in (email, ghost)]
    assert await get_platform_db().rate_limits.count_documents({"_id": {"$in": keys}}) == 0


async def test_an_administrators_password_reset_lifts_the_lock(web, make_company, make_user, no_fallback):
    co = await make_company()
    await set_policy(co, 2)
    boss = await make_user(co, role="superadmin")
    email = await make_user(co)
    assert [(await login(web, email, "bad")).status_code for _ in range(2)] == [401, 423]
    reset = await web.post(
        f"{API}/auth/admin/reset-password", headers=bearer(boss), json={"email": email, "new_password": "Brand-New-1!"},
    )
    assert reset.status_code == 200, reset.text
    assert (await login(web, email, "Brand-New-1!")).status_code == 200


async def test_the_user_list_pages_searches_and_counts(web, make_company, make_user, no_fallback):
    co = await make_company()
    boss = await make_user(co, role="superadmin", name="Boss Person")
    hr = await make_user(co, role="admin", name="Hr Person")
    names = ["Zed Alpha", "Mia ALPHA", "Bob Beta", "Cy Gamma", "Dot Delta"]
    people = [await make_user(co, name=name, email=f"p{i}-{uuid.uuid4().hex[:6]}@{co.domain}") for i, name in enumerate(names)]
    users = f"{API}/auth/users"
    mine = bearer(boss)

    everyone = await web.get(users, headers=mine)
    assert everyone.status_code == 200 and isinstance(everyone.json(), list)
    assert everyone.headers["x-total-count"] == "7" and len(everyone.json()) == 7
    assert [u["email"] for u in everyone.json()] == [boss, hr, *people]
    assert all("password_hash" not in u and "avatar_base64" not in u and "totp_secret" not in u for u in everyone.json())

    page = await web.get(users, headers=mine, params={"limit": 2, "skip": 1})
    assert [u["email"] for u in page.json()] == [hr, people[0]] and page.headers["x-total-count"] == "7"
    assert (await web.get(users, headers=mine, params={"skip": 6})).json()[0]["email"] == people[-1]
    assert (await web.get(users, headers=mine, params={"skip": 50})).json() == []

    found = await web.get(users, headers=mine, params={"search": "alpha"})
    assert [u["name"] for u in found.json()] == ["Zed Alpha", "Mia ALPHA"] and found.headers["x-total-count"] == "2"
    assert [u["email"] for u in (await web.get(users, headers=mine, params={"search": people[3].upper()})).json()] == [people[3]]
    for pattern in (".*", "^Zed", "Zed|Bob", "(", "[a-z]+"):
        none = await web.get(users, headers=mine, params={"search": pattern})
        assert none.status_code == 200 and none.json() == [] and none.headers["x-total-count"] == "0", pattern
    both = await web.get(users, headers=mine, params={"search": "alpha", "limit": 1})
    assert len(both.json()) == 1 and both.headers["x-total-count"] == "2"

    as_hr = await web.get(users, headers=bearer(hr))
    assert as_hr.headers["x-total-count"] == "5" and all(u["role"] == "standard" for u in as_hr.json())

    for bad in ({"limit": 0}, {"limit": 501}, {"skip": -1}, {"limit": "many"}):
        assert (await web.get(users, headers=mine, params=bad)).status_code == 422, bad
    assert len((await web.get(users, headers=mine, params={"limit": 500})).json()) == 7


def _b64u(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _uint(n: int) -> str:
    return _b64u(n.to_bytes((n.bit_length() + 7) // 8, "big"))


class KeyPair:
    def __init__(self, kid: str):
        private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        numbers = private.public_key().public_numbers()
        self.jwk = {"kty": "RSA", "kid": kid, "use": "sig", "alg": "RS256", "n": _uint(numbers.n), "e": _uint(numbers.e)}
        self.pem = private.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption(),
        ).decode()


@pytest.fixture(scope="module")
def keys():
    return SimpleNamespace(good=KeyPair("k1"), other=KeyPair("k1"))


class Provider:

    def __init__(self, keys):
        self.keys = keys
        self.requests: list[httpx.Request] = []
        self.token_status = 200
        self.token_body: dict = {}
        self.discovery = {
            "issuer": ISSUER, "authorization_endpoint": f"{ISSUER}/authorize", "token_endpoint": f"{ISSUER}/token",
            "jwks_uri": f"{ISSUER}/keys", "id_token_signing_alg_values_supported": ["RS256"],
            "code_challenge_methods_supported": ["S256"], "token_endpoint_auth_methods_supported": ["client_secret_basic"],
        }

    def issue(self, *, email: str, nonce: str, key: KeyPair | None = None, **overrides) -> None:
        now = int(time.time())
        payload = {
            "iss": ISSUER, "aud": CLIENT_ID, "sub": f"sub-{email}", "email": email, "email_verified": True,
            "nonce": nonce, "iat": now, "exp": now + 300, "name": "Ann Example",
        }
        payload.update(overrides)
        payload = {k: v for k, v in payload.items() if v is not None}
        signer = key or self.keys.good
        token = jwt.encode(payload, signer.pem, algorithm="RS256", headers={"kid": signer.jwk["kid"]})
        self.token_body = {"id_token": token, "access_token": "at", "token_type": "Bearer"}

    def hits(self, suffix: str) -> list[httpx.Request]:
        return [r for r in self.requests if r.url.path.endswith(suffix)]


@pytest.fixture
def idp(monkeypatch, keys):
    provider = Provider(keys)

    async def resolve(host, port):
        if host.startswith("internal"):
            raise UnsafeTarget("The address points to a private or reserved network.")
        return ["93.184.216.34"]

    def handler(request: httpx.Request) -> httpx.Response:
        provider.requests.append(request)
        path = request.url.path
        if path == "/tenant1/.well-known/openid-configuration":
            return httpx.Response(200, json=provider.discovery)
        if path == "/tenant1/keys":
            return httpx.Response(200, json={"keys": [provider.keys.good.jwk]})
        if path == "/tenant1/token":
            return httpx.Response(provider.token_status, json=provider.token_body)
        return httpx.Response(404)

    monkeypatch.setattr(safe_http, "resolve_public", resolve)
    monkeypatch.setattr(oidc_service, "_transport", httpx.MockTransport(handler))
    return provider


SSO = f"{API}/company-settings/sso"


async def configure(web, boss: str, **extra) -> httpx.Response:
    body = {"enabled": True, "issuer": ISSUER, "client_id": CLIENT_ID, "client_secret": CLIENT_SECRET}
    body.update(extra)
    response = await web.put(SSO, headers=bearer(boss), json=body)
    assert response.status_code == 200, response.text
    return response


async def test_the_sso_page_never_shows_and_never_loses_the_secret(web, make_company, make_user, no_fallback):
    co = await make_company()
    boss = await make_user(co, role="superadmin")
    mine = bearer(boss)

    blank = await web.get(SSO, headers=mine)
    assert blank.status_code == 200
    assert blank.json() == {
        "enabled": False, "issuer": "", "client_id": "", "has_client_secret": False, "scopes": "openid email profile",
        "enforce": False, "redirect_uri": f"{settings.FRONTEND_URL.rstrip('/')}/api/v1/sso/oidc/callback", "sso_domains": [co.domain],
    }

    saved = await configure(web, boss)
    assert saved.json()["has_client_secret"] is True and saved.json()["enabled"] is True and saved.json()["issuer"] == ISSUER
    assert CLIENT_SECRET not in saved.text and "client_secret" not in saved.json()
    row = await get_platform_db().company_settings.find_one({"company_id": co.company_id, "_id": f"{co.company_id}:sso"})
    assert row["client_secret"].startswith("enc:v1:") and CLIENT_SECRET not in str(row)
    ciphertext = row["client_secret"]

    for response in (await web.get(SSO, headers=mine), await web.get(f"{API}/company-settings", headers=mine)):
        assert response.status_code == 200
        assert CLIENT_SECRET not in response.text and ciphertext not in response.text
    assert (await web.get(SSO, headers=mine)).json()["has_client_secret"] is True

    kept = await web.put(SSO, headers=mine, json={"scopes": "openid, email groups", "enforce": True, "client_secret": ""})
    assert kept.status_code == 200 and kept.json()["scopes"] == "openid email groups" and kept.json()["enforce"] is True
    assert (await get_platform_db().company_settings.find_one({"_id": f"{co.company_id}:sso"}))["client_secret"] == ciphertext

    moved = await web.put(SSO, headers=mine, json={"issuer": "https://other.example.test"})
    assert moved.status_code == 400 and "secret again" in moved.json()["detail"]
    ok = await web.put(SSO, headers=mine, json={"issuer": "https://other.example.test", "client_secret": "another-secret"})
    assert ok.status_code == 200
    assert (await get_platform_db().company_settings.find_one({"_id": f"{co.company_id}:sso"}))["client_secret"] != ciphertext

    for body, fragment in (
        ({"issuer": "http://idp.example.test", "client_secret": "x"}, "https://"),
        ({"scopes": "profile"}, "openid and email"),
        ({"enabled": False, "enforce": True}, "Turn single sign-on on"),
    ):
        refused = await web.put(SSO, headers=mine, json=body)
        assert refused.status_code == 400 and fragment in refused.json()["detail"], body
    nothing = await make_company()
    nobody = await make_user(nothing, role="superadmin")
    assert (await web.put(SSO, headers=bearer(nobody), json={"enabled": True})).status_code == 400

    audit = await get_platform_db().audit_log.find_one({"company_id": co.company_id, "action": "company_sso_update"})
    assert audit and CLIENT_SECRET not in str(audit) and "another-secret" not in str(audit)


async def test_only_the_top_administrator_may_use_the_sso_page_and_only_on_a_plan_that_has_it(web, make_company, make_user, no_fallback):
    co = await make_company()
    hr, worker = await make_user(co, role="admin"), await make_user(co)
    for who in (hr, worker):
        assert (await web.get(SSO, headers=bearer(who))).status_code == 403
        assert (await web.put(SSO, headers=bearer(who), json={"scopes": "openid email"})).status_code == 403
        assert (await web.post(f"{SSO}/test", headers=bearer(who))).status_code == 403
    assert (await web.get(SSO)).status_code == 401

    capped = await make_company(plan={"features": {"oidc_sso": False}})
    boss = await make_user(capped, role="superadmin")
    for call in (web.get(SSO, headers=bearer(boss)), web.put(SSO, headers=bearer(boss), json={"scopes": "openid email"}),
                 web.post(f"{SSO}/test", headers=bearer(boss))):
        response = await call
        assert response.status_code == 402
        assert response.json()["detail"] == "Your plan does not include single sign-on with your identity provider."


async def test_the_connection_test_reports_what_it_found_without_naming_internal_hosts(web, idp, make_company, make_user, no_fallback):
    co = await make_company()
    boss = await make_user(co, role="superadmin")
    mine = bearer(boss)
    assert (await web.post(f"{SSO}/test", headers=mine)).json() == {"ok": False, "detail": "Enter the issuer first."}
    await configure(web, boss)

    good = await web.post(f"{SSO}/test", headers=mine)
    assert good.status_code == 200 and good.json()["ok"] is True and "idp.example.test" not in good.json()["detail"]
    assert idp.hits("openid-configuration") and idp.hits("/keys")

    internal = await web.post(f"{SSO}/test", headers=mine, json={"issuer": "https://internal.example.test/x"})
    assert internal.json()["ok"] is False and "internal.example.test" not in internal.text
    idp.discovery = {**idp.discovery, "token_endpoint": "https://internal.example.test/token"}
    private = await web.post(f"{SSO}/test", headers=mine)
    assert private.json()["ok"] is False and "public address" in private.json()["detail"] and "internal.example.test" not in private.text
    idp.discovery = {**idp.discovery, "token_endpoint": f"{ISSUER}/token", "issuer": "https://someone-else.example.test"}
    assert (await web.post(f"{SSO}/test", headers=mine)).json()["ok"] is False


def cookie_of(response: httpx.Response) -> str:
    return re.search(rf"{oidc_routes.BINDING_COOKIE}=([^;]+)", response.headers["set-cookie"]).group(1)


async def begin(web, co):
    response = await web.get(f"{API}/sso/oidc/login", params={"company": co.slug})
    assert response.status_code == 307, response.text
    query = {k: v[0] for k, v in parse_qs(urlsplit(response.headers["location"]).query).items()}
    cookie = cookie_of(response)
    web.cookies.clear()
    return query, cookie, response


async def finish(web, idp, query, cookie, *, email, code="the-code", **issue):
    doc = await get_platform_db().sso_states.find_one({"state": query["state"]})
    idp.issue(email=email, nonce=issue.pop("nonce", None) or (doc["nonce"] if doc else "unknown"), **issue)
    web.cookies.clear()
    headers = {"Cookie": f"{oidc_routes.BINDING_COOKIE}={cookie}"} if cookie else {}
    return await web.get(f"{API}/sso/oidc/callback", params={"code": code, "state": query["state"]}, headers=headers)


def session_token(response: httpx.Response) -> str:
    assert response.status_code == 307, response.text
    location = response.headers["location"]
    assert location.startswith(f"{settings.FRONTEND_URL}/sso-callback?token="), location
    return parse_qs(urlsplit(location).query)["token"][0]


def failure(response: httpx.Response) -> str:
    assert response.status_code == 307, response.text
    location = response.headers["location"]
    assert location.startswith(f"{settings.FRONTEND_URL}/sso-callback?error="), location
    assert "token=" not in location
    return parse_qs(urlsplit(location).query)["error"][0]


@pytest.fixture
async def acme(web, make_company, make_user):
    co = await make_company()
    boss = await make_user(co, role="superadmin", email=f"boss@{co.domain}")
    person = await make_user(co, email=f"ann@{co.domain}")
    previous = tenancy._fallback_company_id
    await configure(web, boss)
    tenancy.use_fallback_company(None)
    yield SimpleNamespace(co=co, boss=boss, person=person)
    tenancy.use_fallback_company(previous)


async def test_an_existing_account_signs_in_through_the_provider(web, idp, acme):
    co = acme.co
    public = await web.get(f"{API}/sso/oidc/config", params={"company": co.slug})
    assert public.status_code == 200 and public.json() == {"enabled": True, "enforce": False, "name": co.name}

    query, cookie, started = await begin(web, co)
    assert started.headers["location"].startswith(f"{ISSUER}/authorize?")
    assert query["response_type"] == "code" and query["client_id"] == CLIENT_ID and query["scope"] == "openid email profile"
    assert query["code_challenge_method"] == "S256" and query["redirect_uri"].endswith("/api/v1/sso/oidc/callback")
    assert "httponly" in started.headers["set-cookie"].lower() and "samesite=lax" in started.headers["set-cookie"].lower()
    doc = await get_platform_db().sso_states.find_one({"state": query["state"]})
    assert isinstance(doc["created_at"], datetime) and doc["company_id"] == co.company_id
    assert doc["nonce"] == query["nonce"] and query["code_challenge"] == oidc_service.pkce_challenge(doc["code_verifier"])
    assert cookie not in str(doc)

    done = await finish(web, idp, query, cookie, email=acme.person.upper())
    token = session_token(done)
    me = await web.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["email"] == acme.person and me.json()["company_id"] == co.company_id and me.json()["role"] == "standard"
    assert (await stored(acme.person)).get("last_login_at") is not None
    assert await get_platform_db().sso_states.find_one({"state": query["state"]}) is None
    assert oidc_routes.BINDING_COOKIE in done.headers["set-cookie"] and "max-age=0" in done.headers["set-cookie"].lower()

    token_request = idp.hits("/token")[-1]
    form = {k: v[0] for k, v in parse_qs(token_request.content.decode()).items()}
    assert form["code_verifier"] == doc["code_verifier"] and form["code"] == "the-code" and form["grant_type"] == "authorization_code"
    assert token_request.headers["authorization"].startswith("Basic ")
    assert CLIENT_SECRET not in done.headers["location"]


async def test_a_first_time_person_is_created_only_for_an_assigned_domain_with_a_seat(web, idp, make_company, make_user, no_fallback):
    co = await make_company(plan={"max_users_per_company": 3})
    boss = await make_user(co, role="superadmin")
    await configure(web, boss)
    newcomer = f"new.person@{co.domain}"
    try:
        query, cookie, _ = await begin(web, co)
        token = session_token(await finish(web, idp, query, cookie, email=newcomer))
        me = (await web.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"})).json()
        assert me["email"] == newcomer and me["role"] == "standard" and me["company_id"] == co.company_id
        row = await stored(newcomer)
        assert row["role"] == "standard" and row["company_id"] == co.company_id and row["sso_provider"] == "oidc"
        assert row["is_active"] is True and row["name"] == "Ann Example" and "password_hash" not in row
        audit = await get_platform_db().audit_log.find_one({"company_id": co.company_id, "action": "user_create", "resource_id": newcomer})
        assert audit and audit["details"]["via"] == "oidc"

        await make_user(co)
        query, cookie, _ = await begin(web, co)
        message = failure(await finish(web, idp, query, cookie, email=f"second@{co.domain}"))
        assert message == "Your plan allows at most 3 users. Ask your administrator to raise the limit."
        assert await get_platform_db().users.count_documents({"email": f"second@{co.domain}"}) == 0

        query, cookie, _ = await begin(web, co)
        outsider = f"someone@elsewhere-{co.tag}.example.com"
        assert failure(await finish(web, idp, query, cookie, email=outsider)) == oidc_service.ACCOUNT_REFUSED_MESSAGE
        assert await get_platform_db().users.count_documents({"email": outsider}) == 0
    finally:
        await get_platform_db().users.delete_many({"email": {"$in": [newcomer, f"second@{co.domain}"]}})


async def test_an_oidc_sign_in_never_touches_an_account_of_another_company_or_a_platform_owner(web, idp, make_company, make_user, no_fallback):
    mine, theirs = await make_company(), await make_company()
    boss = await make_user(mine, role="superadmin")
    await configure(web, boss)
    victim = await make_user(theirs, email=f"victim@{theirs.domain}")
    anomaly = await make_user(theirs, email=f"anomaly@{mine.domain}")
    owner = await make_user(mine, role="superadmin", is_platform_admin=True, email=f"owner@{mine.domain}")
    gone = await make_user(mine, is_active=False, email=f"gone@{mine.domain}")

    refused = []
    for email in (victim, anomaly, owner, f"nobody@{theirs.domain}"):
        query, cookie, _ = await begin(web, mine)
        refused.append(failure(await finish(web, idp, query, cookie, email=email)))
    assert set(refused) == {oidc_service.ACCOUNT_REFUSED_MESSAGE}
    for email, company in ((victim, theirs), (anomaly, theirs)):
        row = await stored(email)
        assert row["company_id"] == company.company_id and "last_login_at" not in row and "sso_provider" not in row
        assert await get_platform_db().users.count_documents({"email": email}) == 1
    assert "last_login_at" not in await stored(owner)

    query, cookie, _ = await begin(web, mine)
    assert failure(await finish(web, idp, query, cookie, email=gone)) == oidc_service.DEACTIVATED_MESSAGE
    assert "last_login_at" not in await stored(gone)


async def test_the_state_is_single_use_and_tied_to_the_browser_that_started_it(web, idp, acme):
    co, email = acme.co, acme.person
    failed = oidc_service.FAILED_MESSAGE

    query, cookie, _ = await begin(web, co)
    first = await finish(web, idp, query, cookie, email=email)
    session_token(first)
    assert failure(await finish(web, idp, query, cookie, email=email)) == failed

    query, cookie, _ = await begin(web, co)
    assert failure(await finish(web, idp, query, "someone-elses-cookie", email=email)) == failed
    assert failure(await finish(web, idp, query, cookie, email=email)) == failed
    query, cookie, _ = await begin(web, co)
    assert failure(await finish(web, idp, query, None, email=email)) == failed

    query, cookie, _ = await begin(web, co)
    await get_platform_db().sso_states.update_one(
        {"state": query["state"]}, {"$set": {"created_at": datetime.now(timezone.utc) - timedelta(minutes=11)}},
    )
    assert failure(await finish(web, idp, query, cookie, email=email)) == failed

    assert failure(await web.get(f"{API}/sso/oidc/callback", params={"code": "c", "state": "never-issued"})) == failed
    query, cookie, _ = await begin(web, co)
    headers = {"Cookie": f"{oidc_routes.BINDING_COOKIE}={cookie}"}
    assert failure(await web.get(f"{API}/sso/oidc/callback", params={"state": query["state"]}, headers=headers)) == failed
    query, cookie, _ = await begin(web, co)
    headers = {"Cookie": f"{oidc_routes.BINDING_COOKIE}={cookie}"}
    denied = await web.get(f"{API}/sso/oidc/callback", params={"error": "access_denied", "state": query["state"]}, headers=headers)
    assert failure(denied) == failed
    assert await get_platform_db().sso_states.find_one({"state": query["state"]}) is None

    for issue in (
        {"nonce": "a-different-sign-in"}, {"email_verified": False}, {"email_verified": "true"}, {"aud": "another-client"},
        {"iss": "https://evil.example.test/tenant1"}, {"exp": int(time.time()) - 3600}, {"key": idp.keys.other},
    ):
        query, cookie, _ = await begin(web, co)
        assert failure(await finish(web, idp, query, cookie, email=email, **issue)) == failed, list(issue)
    query, cookie, _ = await begin(web, co)
    idp.token_status, idp.token_body = 400, {"error": "invalid_grant"}
    headers = {"Cookie": f"{oidc_routes.BINDING_COOKIE}={cookie}"}
    assert failure(await web.get(f"{API}/sso/oidc/callback", params={"code": "c", "state": query["state"]}, headers=headers)) == failed
    idp.token_status = 200


async def test_the_google_callback_does_not_accept_an_oidc_state(web, idp, acme, monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_ID", "google-client")
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_SECRET", "google-secret")
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_REDIRECT_URI", "http://localhost/callback")
    query, cookie, _ = await begin(web, acme.co)
    response = await web.get(f"{API}/sso/google/callback", params={"code": "c", "state": query["state"]})
    assert response.status_code == 400
    assert await get_platform_db().sso_states.find_one({"state": query["state"]}) is not None


async def test_the_public_config_and_login_say_nothing_extra_for_a_company_that_cannot_use_sso(web, idp, make_company, make_user, no_fallback):
    off = {"enabled": False, "enforce": False, "name": ""}
    assert (await web.get(f"{API}/sso/oidc/config", params={"company": "no-such-company"})).json() == off
    assert (await web.get(f"{API}/sso/oidc/config")).json() == off
    plain = await make_company()
    assert (await web.get(f"{API}/sso/oidc/config", params={"company": plain.slug})).json() == off
    unavailable = oidc_service.UNAVAILABLE_MESSAGE
    assert failure(await web.get(f"{API}/sso/oidc/login", params={"company": plain.slug})) == unavailable
    assert failure(await web.get(f"{API}/sso/oidc/login", params={"company": "no-such-company"})) == unavailable
    assert failure(await web.get(f"{API}/sso/oidc/login")) == unavailable

    suspended = await make_company()
    boss = await make_user(suspended, role="superadmin")
    await configure(web, boss)
    assert (await web.get(f"{API}/sso/oidc/config", params={"company": suspended.slug})).json()["enabled"] is True
    await get_platform_db().companies.update_one({"company_id": suspended.company_id}, {"$set": {"status": "suspended"}})
    assert (await web.get(f"{API}/sso/oidc/config", params={"company": suspended.slug})).json() == off
    assert failure(await web.get(f"{API}/sso/oidc/login", params={"company": suspended.slug})) == unavailable

    capped = await make_company()
    boss = await make_user(capped, role="superadmin")
    worker = await make_user(capped)
    await configure(web, boss, enforce=True)
    await get_platform_db().clients.update_one({"client_id": capped.client_id}, {"$set": {"plan.features": {"oidc_sso": False}}})
    assert (await web.get(f"{API}/sso/oidc/config", params={"company": capped.slug})).json() == off
    assert (await login(web, worker)).status_code == 200


async def test_a_provider_that_cannot_be_reached_ends_as_a_plain_failure(web, idp, acme):
    idp.discovery = {**idp.discovery, "issuer": "https://someone-else.example.test"}
    message = failure(await web.get(f"{API}/sso/oidc/login", params={"company": acme.co.slug}))
    assert message == oidc_service.FAILED_MESSAGE and "example.test" not in message


async def test_when_single_sign_on_is_required_passwords_are_refused_except_for_the_top_administrator(web, idp, make_company, make_user, outbox, no_fallback):
    a, b = await make_company(), await make_company()
    boss, hr, worker = await make_user(a, role="superadmin"), await make_user(a, role="admin"), await make_user(a)
    elsewhere = await make_user(b)
    await configure(web, boss, enforce=True)
    form = lambda email, pw=PASSWORD: web.post(f"{API}/auth/token", data={"username": email, "password": pw})
    forgot = lambda email: web.post(f"{API}/auth/forgot-password", json={"email": email})

    for email in (worker, hr):
        for call in (login(web, email), login(web, email, "wrong-password"), form(email), forgot(email)):
            refused = await call
            assert refused.status_code == 403 and refused.json() == {"detail": ENFORCED}, email
    assert outbox.mail == []

    assert (await login(web, boss)).status_code == 200
    assert (await form(boss)).status_code == 200
    assert (await forgot(boss)).status_code == 200
    assert (await login(web, elsewhere)).status_code == 200
    assert (await forgot(f"ghost-{uuid.uuid4().hex[:6]}@{a.domain}")).status_code == 200

    await web.put(SSO, headers=bearer(boss), json={"enforce": False})
    assert (await login(web, worker)).status_code == 200
    assert (await web.get(f"{API}/sso/oidc/config", params={"company": a.slug})).json() == {"enabled": True, "enforce": False, "name": a.name}
    await web.put(SSO, headers=bearer(boss), json={"enforce": True})
    assert (await web.get(f"{API}/sso/oidc/config", params={"company": a.slug})).json()["enforce"] is True


async def test_a_platform_owner_inside_a_company_is_not_one_of_its_users(web, make_company, make_user):
    co = await make_company()
    boss = await make_user(co, role="superadmin")
    staff = await make_user(co)
    owner = await make_user(co, role="superadmin", is_platform_admin=True)

    listed = await web.get(f"{API}/auth/users", headers=bearer(boss))
    assert listed.status_code == 200
    emails = {u["email"] for u in listed.json()}
    assert emails == {boss, staff}
    assert listed.headers["X-Total-Count"] == "2"

    searched = await web.get(f"{API}/auth/users", params={"search": owner.split("@")[0]}, headers=bearer(boss))
    assert searched.json() == [] and searched.headers["X-Total-Count"] == "0"

    roles = await web.get(f"{API}/rbac/roles", headers=bearer(boss))
    assert roles.status_code == 200
    counts = roles.json()["user_counts"]
    assert counts["superadmin"] == 1 and counts["standard"] == 1

    admin = await make_user(co, role="admin")
    hr_view = await web.get(f"{API}/auth/users", headers=bearer(admin))
    assert {u["email"] for u in hr_view.json()} == {staff}

    seen = await web.get(f"{API}/auth/users", headers=bearer(owner))
    assert {u["email"] for u in seen.json()} == {boss, staff, owner, admin}
