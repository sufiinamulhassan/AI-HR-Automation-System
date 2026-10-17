import hashlib
import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from httpx import ASGITransport, AsyncClient
from jose import jwt
from passlib.context import CryptContext

from config import tenancy
from config.database import get_db, get_platform_db
from config.settings import settings
from config.tenancy import company_context
from config.tenancy_migration import client_doc, company_doc
from main import app
from routes import sso
from services.hr_module import credentials_service, email_service
from services.hr_module.security_policy_service import update_security_policies

pytestmark = pytest.mark.anyio

API = "/api/v1"
_pwd = CryptContext(schemes=["bcrypt"])
PASSWORD = "Password-123!"
NEW_PASSWORD = "Fresh-Pass-456!"
INVALID = "This link is invalid or has expired."
FORGOT = "If that address has an account, we have sent a link."
SEATS = "Your plan allows at most {n} users. Ask your administrator to raise the limit."


def _jwt(email: str, *, iat: int | None = None) -> dict:
    claims = {"sub": email, "exp": datetime.now(timezone.utc) + timedelta(hours=1)}
    if iat is not None:
        claims["iat"] = iat
    return {"Authorization": f"Bearer {jwt.encode(claims, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)}"}


@pytest.fixture
def no_fallback():
    previous = tenancy._fallback_company_id
    tenancy.use_fallback_company(None)
    yield
    tenancy.use_fallback_company(previous)


@pytest.fixture(autouse=True)
async def clean_limits():
    pattern = {"_id": {"$regex": "^(forgot|reset|invite|login:ip):"}}
    await get_platform_db().rate_limits.delete_many(pattern)
    yield
    await get_platform_db().rate_limits.delete_many(pattern)


@pytest.fixture
async def make_company():
    made: list[tuple[str, str]] = []

    async def make(*, plan: dict | None = None, status: str = "active", client_status: str = "active") -> SimpleNamespace:
        tag = uuid.uuid4().hex[:8]
        client_id, company_id = f"cli_c{tag}", f"cmp_c{tag}"
        client = client_doc(client_id, f"Client {tag}", f"client-{tag}")
        client["status"] = client_status
        if plan:
            client["plan"] = {**client["plan"], **plan}
        raw = get_platform_db()
        await raw.clients.insert_one(client)
        await raw.companies.insert_one({**company_doc(company_id, client_id, f"Acme {tag}", f"acme-{tag}"), "status": status})
        made.append((client_id, company_id))
        return SimpleNamespace(company_id=company_id, client_id=client_id, name=f"Acme {tag}", tag=tag)

    yield make
    raw = get_platform_db()
    for client_id, company_id in made:
        for name in await raw.list_collection_names():
            if name not in ("clients", "companies", "settings"):
                await raw[name].delete_many({"company_id": company_id})
        await raw.companies.delete_many({"company_id": company_id})
        await raw.clients.delete_many({"client_id": client_id})


@pytest.fixture
def make_user():
    async def make(company, *, role: str = "standard", **extra) -> str:
        email = f"cred-{uuid.uuid4().hex[:10]}@example.com"
        await get_platform_db().users.insert_one({
            "name": "Cred Person", "email": email, "password_hash": _pwd.hash(PASSWORD), "role": role,
            "is_active": True, "otp_required": False, "company_id": company.company_id,
            "created_at": "2026-01-01T00:00:00+00:00", **extra,
        })
        return email

    return make


class Outbox:

    def __init__(self):
        self.mail: list[dict] = []
        self.result = True

    def token(self, index: int = -1) -> str:
        return re.search(r"token=([A-Za-z0-9_-]+)", self.mail[index]["text_body"]).group(1)


@pytest.fixture
def outbox(monkeypatch):
    box = Outbox()

    async def fake_send_email(**kwargs):
        box.mail.append(kwargs)
        return box.result

    monkeypatch.setattr(email_service, "send_email", fake_send_email)
    return box


async def _forgot(client, email):
    return await client.post(f"{API}/auth/forgot-password", json={"email": email})


async def _reset(client, token, password=NEW_PASSWORD):
    return await client.post(f"{API}/auth/reset-password", json={"token": token, "new_password": password})


async def _login(client, email, password):
    return await client.post(f"{API}/auth/login", json={"email": email, "password": password})


def _expires(row: dict) -> datetime:
    value = row["expires_at"]
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


async def test_forgot_then_reset_round_trip(client, make_company, make_user, outbox, no_fallback):
    co = await make_company()
    email = await make_user(
        co, failed_login_attempts=7, locked_until=(datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
    )
    old_session = _jwt(email, iat=int(time.time()) - 120)
    assert (await client.get(f"{API}/auth/me", headers=old_session)).status_code == 200

    asked = await _forgot(client, email)
    assert asked.status_code == 200 and asked.json() == {"message": FORGOT}
    assert len(outbox.mail) == 1
    mail = outbox.mail[0]
    assert mail["to"] == email and mail["template"] == "password_reset"
    assert mail["subject"] == f"{co.name}: Reset your password"
    token = outbox.token()
    assert f"{settings.FRONTEND_URL}/reset-password?token={token}" in mail["text_body"]
    assert "invite=1" not in mail["text_body"]
    assert mail["text_body"] and mail["html_body"]

    rows = await get_platform_db().password_tokens.find({"email": email}).to_list(10)
    assert len(rows) == 1 and rows[0]["token_hash"] == hashlib.sha256(token.encode()).hexdigest()
    assert token not in str(rows) and rows[0]["purpose"] == "reset" and rows[0]["used_at"] is None
    assert timedelta(minutes=55) < _expires(rows[0]) - datetime.now(timezone.utc) <= timedelta(hours=1)

    done = await _reset(client, token)
    assert done.status_code == 200 and done.json() == {"message": "Password updated"}

    row = await get_platform_db().users.find_one({"email": email})
    assert _pwd.verify(NEW_PASSWORD, row["password_hash"])
    assert row["failed_login_attempts"] == 0 and "locked_until" not in row and isinstance(row["pwd_changed_at"], int)
    assert (await client.get(f"{API}/auth/me", headers=old_session)).status_code == 401
    assert (await _login(client, email, PASSWORD)).status_code == 401
    signed_in = await _login(client, email, NEW_PASSWORD)
    assert signed_in.status_code == 200 and signed_in.json()["access_token"]

    with company_context(co.company_id):
        audit = await get_db().audit_log.find({"action": "password_reset", "resource_id": email}).to_list(5)
    assert len(audit) == 1 and audit[0]["actor_email"] == email
    assert NEW_PASSWORD not in str(audit) and token not in str(audit)


async def test_a_wrong_used_or_expired_link_all_get_the_same_400(client, make_company, make_user, outbox, no_fallback):
    co = await make_company()
    email = await make_user(co)
    await _forgot(client, email)
    good = outbox.token()
    refusals = [
        await _reset(client, "x" * 43),
        await _reset(client, ""),
        await _reset(client, f"{good[:-1]}{'A' if good[-1] != 'A' else 'B'}"),
    ]
    assert (await _reset(client, good)).status_code == 200
    refusals.append(await _reset(client, good, "Another-Pass-789!"))

    await _forgot(client, email)
    stale = outbox.token()
    await get_platform_db().password_tokens.update_many(
        {"email": email, "used_at": None}, {"$set": {"expires_at": datetime.now(timezone.utc) - timedelta(minutes=1)}},
    )
    refusals.append(await _reset(client, stale))

    assert [r.status_code for r in refusals] == [400] * 5
    assert {r.text for r in refusals} == {refusals[0].text} and refusals[0].json() == {"detail": INVALID}
    row = await get_platform_db().users.find_one({"email": email})
    assert _pwd.verify(NEW_PASSWORD, row["password_hash"])


async def test_an_unknown_address_gets_the_same_answer_as_a_known_one(client, make_company, make_user, outbox, no_fallback):
    co = await make_company()
    known = await make_user(co)
    switched_off = await make_user(co, is_active=False)
    unknown = f"nobody-{uuid.uuid4().hex[:8]}@example.com"
    answers = []
    for address in (known, unknown, switched_off):
        resp = await _forgot(client, address)
        answers.append((resp.status_code, resp.text))
    assert len(set(answers)) == 1 and answers[0][0] == 200 and FORGOT in answers[0][1]
    assert [m["to"] for m in outbox.mail] == [known]
    assert await get_platform_db().password_tokens.count_documents({"email": {"$in": [unknown, switched_off]}}) == 0


async def test_a_suspended_company_gets_no_mail_and_an_open_link_stops_working(client, make_company, make_user, outbox, no_fallback):
    raw = get_platform_db()
    suspended = await make_company(status="suspended")
    client_off = await make_company(client_status="suspended")
    active = await make_company()
    emails = [await make_user(suspended), await make_user(client_off), await make_user(active)]
    answers = [(await _forgot(client, e)) for e in emails]
    assert {(a.status_code, a.text) for a in answers} == {(200, answers[0].text)}
    assert [m["to"] for m in outbox.mail] == [emails[2]]
    assert await raw.password_tokens.count_documents({"email": {"$in": emails[:2]}}) == 0

    token = outbox.token()
    await raw.companies.update_one({"company_id": active.company_id}, {"$set": {"status": "suspended"}})
    refused = await _reset(client, token)
    assert refused.status_code == 400 and refused.json() == {"detail": INVALID}
    assert _pwd.verify(PASSWORD, (await raw.users.find_one({"email": emails[2]}))["password_hash"])


async def test_the_accounts_own_company_policy_is_the_one_enforced(client, make_company, make_user, outbox, no_fallback):
    strict, lenient = await make_company(), await make_company()
    with company_context(strict.company_id):
        await update_security_policies(password_min_length=12, password_require_number=True)
    hard_user, easy_user = await make_user(strict), await make_user(lenient)

    await _forgot(client, hard_user)
    token = outbox.token()
    short = await _reset(client, token, "short")
    assert short.status_code == 400 and "at least 12 characters" in short.json()["detail"]
    no_digit = await _reset(client, token, "long-enough-without-digits")
    assert no_digit.status_code == 400 and "number" in no_digit.json()["detail"]
    assert (await _reset(client, token, "long-enough-with-9-digits")).status_code == 200

    await _forgot(client, easy_user)
    assert (await _reset(client, outbox.token(), "ab")).status_code == 200


async def test_a_new_link_voids_the_older_one(client, make_company, make_user, outbox, no_fallback):
    co = await make_company()
    email = await make_user(co)
    await _forgot(client, email)
    first = outbox.token()
    await _forgot(client, email)
    second = outbox.token()
    assert first != second
    assert (await _reset(client, first)).status_code == 400
    assert (await _reset(client, second)).status_code == 200


async def test_the_forgot_password_limits_are_per_address_and_per_ip(client, outbox, no_fallback):
    address = f"limit-{uuid.uuid4().hex[:8]}@example.com"
    for _ in range(credentials_service.FORGOT_EMAIL_LIMIT):
        assert (await _forgot(client, address)).status_code == 200
    blocked = await _forgot(client, address)
    assert blocked.status_code == 429
    other = await _forgot(client, f"limit-{uuid.uuid4().hex[:8]}@example.com")
    assert other.status_code == 200 and other.json() == {"message": FORGOT}

    await get_platform_db().rate_limits.delete_many({"_id": {"$regex": "^forgot:"}})
    for _ in range(credentials_service.FORGOT_IP_LIMIT):
        assert (await _forgot(client, f"ip-{uuid.uuid4().hex[:10]}@example.com")).status_code == 200
    assert (await _forgot(client, f"ip-{uuid.uuid4().hex[:10]}@example.com")).status_code == 429


async def test_resetting_is_limited_per_ip_before_the_token_is_looked_at(client, no_fallback):
    for _ in range(credentials_service.RESET_IP_LIMIT):
        assert (await _reset(client, "x" * 43)).status_code == 400
    assert (await _reset(client, "x" * 43)).status_code == 429


async def test_send_invite_works_with_no_company_bound(make_company, make_user, outbox, no_fallback):
    co = await make_company()
    email = f"console-{uuid.uuid4().hex[:8]}@example.com"
    sent = await credentials_service.send_invite(email=email, name="Console Admin", company_id=co.company_id, invited_by=None)
    assert sent is True
    mail = outbox.mail[0]
    assert mail["to"] == email and mail["template"] == "account_invitation"
    assert mail["subject"] == f"You have been invited to {co.name}"
    assert outbox.token() and "&invite=1" in mail["text_body"]
    row = await get_platform_db().password_tokens.find_one({"email": email})
    assert row["purpose"] == "invite" and row["company_id"] == co.company_id
    assert timedelta(days=6, hours=23) < _expires(row) - datetime.now(timezone.utc) <= timedelta(days=7)

    outbox.result = False
    assert await credentials_service.send_invite(email=email, name="X", company_id=co.company_id, invited_by=None) is False
    assert await credentials_service.send_invite(email=email, name="X", company_id="cmp_does_not_exist", invited_by=None) is False


async def test_an_invited_account_cannot_sign_in_until_the_link_is_used(client, make_company, make_user, outbox, no_fallback):
    co = await make_company()
    boss = await make_user(co, role="superadmin")
    email = f"invitee-{uuid.uuid4().hex[:8]}@example.com"
    created = await client.post(
        f"{API}/auth/users", headers=_jwt(boss),
        json={"name": "New Person", "email": email, "role": "standard", "otp_required": True},
    )
    assert created.status_code == 200, created.text
    assert created.json()["email_sent"] is True and created.json()["invited"] is True

    row = await get_platform_db().users.find_one({"email": email})
    assert row["is_active"] is True and row["invite_pending"] is True
    assert row["otp_required"] is True and row["otp_enforced"] is True
    assert row["password_hash"].startswith("$2") and not _pwd.verify(PASSWORD, row["password_hash"])
    for guess in (PASSWORD, ""):
        assert (await _login(client, email, guess)).status_code == 401, guess

    mail = outbox.mail[0]
    assert mail["to"] == email and mail["template"] == "account_invitation"
    assert mail["subject"] == f"You have been invited to {co.name}"
    token = outbox.token()
    assert f"{settings.FRONTEND_URL}/reset-password?token={token}&invite=1" in mail["text_body"]
    assert (await get_platform_db().password_tokens.find_one({"email": email}))["purpose"] == "invite"

    assert (await _reset(client, token)).status_code == 200
    row = await get_platform_db().users.find_one({"email": email})
    assert "invite_pending" not in row and _pwd.verify(NEW_PASSWORD, row["password_hash"])
    signed_in = await _login(client, email, NEW_PASSWORD)
    assert signed_in.status_code == 200 and signed_in.json()["otp_required"] is True
    await get_platform_db().otp_logs.delete_many({"email": email})


async def test_a_password_with_send_invite_is_not_used_and_a_password_alone_still_works(client, make_company, make_user, outbox, no_fallback):
    co = await make_company()
    headers = _jwt(await make_user(co, role="superadmin"))
    tag = uuid.uuid4().hex[:8]

    invited = await client.post(
        f"{API}/auth/users", headers=headers,
        json={"name": "Both", "email": f"both-{tag}@example.com", "password": PASSWORD, "send_invite": True},
    )
    assert invited.status_code == 200 and invited.json()["invited"] is True and invited.json()["email_sent"] is True
    assert (await _login(client, f"both-{tag}@example.com", PASSWORD)).status_code == 401
    assert len(outbox.mail) == 1

    direct = await client.post(
        f"{API}/auth/users", headers=headers,
        json={"name": "Direct", "email": f"direct-{tag}@example.com", "password": PASSWORD},
    )
    assert direct.status_code == 200 and direct.json()["invited"] is False and direct.json()["email_sent"] is False
    assert len(outbox.mail) == 1
    row = await get_platform_db().users.find_one({"email": f"direct-{tag}@example.com"})
    assert "invite_pending" not in row
    assert (await _login(client, f"direct-{tag}@example.com", PASSWORD)).status_code == 200


async def test_a_password_that_breaks_the_policy_is_still_refused_without_an_invitation(client, make_company, make_user, outbox, no_fallback):
    co = await make_company()
    with company_context(co.company_id):
        await update_security_policies(password_min_length=12)
    headers = _jwt(await make_user(co, role="superadmin"))
    resp = await client.post(
        f"{API}/auth/users", headers=headers, json={"name": "Weak", "email": f"weak-{uuid.uuid4().hex[:8]}@example.com", "password": "short"},
    )
    assert resp.status_code == 400 and "at least 12" in resp.json()["detail"]
    assert outbox.mail == []


async def test_email_sent_is_false_when_the_message_did_not_leave(client, make_company, make_user, outbox, no_fallback):
    co = await make_company()
    headers = _jwt(await make_user(co, role="superadmin"))
    email = f"unsent-{uuid.uuid4().hex[:8]}@example.com"
    outbox.result = False
    created = await client.post(f"{API}/auth/users", headers=headers, json={"name": "Unsent", "email": email})
    assert created.status_code == 200
    assert created.json()["email_sent"] is False and created.json()["invited"] is True
    assert await get_platform_db().users.find_one({"email": email}) is not None
    assert await get_platform_db().password_tokens.count_documents({"email": email, "used_at": None}) == 0

    resent = await client.post(f"{API}/auth/users/{email}/invite", headers=headers)
    assert resent.status_code == 200 and resent.json()["email_sent"] is False

    outbox.result = True
    resent = await client.post(f"{API}/auth/users/{email}/invite", headers=headers)
    assert resent.status_code == 200 and resent.json() == {"email_sent": True, "purpose": "invite"}
    assert (await _reset(client, outbox.token(), NEW_PASSWORD)).status_code == 200


async def test_the_plans_seat_limit_stops_a_new_account_with_a_409(client, make_company, make_user, outbox, no_fallback):
    co = await make_company(plan={"max_users_per_company": 2})
    headers = _jwt(await make_user(co, role="superadmin"))
    tag = uuid.uuid4().hex[:8]
    second = await client.post(
        f"{API}/auth/users", headers=headers, json={"name": "Two", "email": f"two-{tag}@example.com", "password": PASSWORD},
    )
    assert second.status_code == 200, second.text

    for index, extra in enumerate(({"password": PASSWORD}, {})):
        full = await client.post(
            f"{API}/auth/users", headers=headers, json={"name": "Three", "email": f"three{index}-{tag}@example.com", **extra},
        )
        assert full.status_code == 409 and full.json()["detail"] == SEATS.format(n=2)
    assert outbox.mail == []
    assert await get_platform_db().users.count_documents({"company_id": co.company_id}) == 2

    await get_platform_db().users.update_one({"email": f"two-{tag}@example.com"}, {"$set": {"is_active": False}})
    freed = await client.post(
        f"{API}/auth/users", headers=headers, json={"name": "Three", "email": f"three-{tag}@example.com", "password": PASSWORD},
    )
    assert freed.status_code == 200, freed.text


class _Resp:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


async def _google_callback(monkeypatch, email: str):
    state = f"state-{uuid.uuid4().hex}"
    await get_platform_db().sso_states.insert_one({"state": state, "created_at": datetime.now(timezone.utc)})
    raw_client = AsyncClient(transport=ASGITransport(app=app), base_url="http://test", follow_redirects=False)

    class Google:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, data=None):
            return _Resp({"access_token": "fake-access-token"})

        async def get(self, url, headers=None):
            return _Resp({"email": email, "email_verified": True, "name": "Google Person"})

    monkeypatch.setattr(sso.httpx, "AsyncClient", Google)
    try:
        return await raw_client.get(f"{API}/sso/google/callback", params={"code": "c", "state": state})
    finally:
        await raw_client.aclose()


async def test_first_time_sso_sign_up_respects_the_seat_limit(client, make_company, make_user, monkeypatch, no_fallback):
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_ID", "test-client-id")
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_SECRET", "test-client-secret")
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_REDIRECT_URI", "http://localhost/callback")
    monkeypatch.setattr(settings, "SSO_ALLOWED_EMAIL_DOMAINS", "")
    co = await make_company(plan={"max_users_per_company": 1})
    domain = f"seats-{co.tag}.example"
    raw = get_platform_db()
    await raw.companies.update_one({"company_id": co.company_id}, {"$set": {"sso_domains": [domain]}})
    await make_user(co)
    newcomer = f"newcomer@{domain}"

    refused = await _google_callback(monkeypatch, newcomer)
    assert refused.status_code == 403 and SEATS.format(n=1) in refused.text
    assert await raw.users.find_one({"email": newcomer}) is None

    await raw.clients.update_one({"client_id": co.client_id}, {"$set": {"plan.max_users_per_company": 5}})
    allowed = await _google_callback(monkeypatch, newcomer)
    assert allowed.status_code in (302, 307) and "/sso-callback?token=" in allowed.headers["location"]
    assert (await raw.users.find_one({"email": newcomer}))["company_id"] == co.company_id


async def test_resending_a_link_follows_the_account_rules(client, make_company, make_user, outbox, no_fallback):
    co = await make_company()
    boss = await make_user(co, role="superadmin")
    hr = await make_user(co, role="admin")
    other_hr = await make_user(co, role="admin")
    standard = await make_user(co)
    pending = await make_user(co, invite_pending=True)
    owner = await make_user(co, role="superadmin", is_platform_admin=True)
    deactivated = await make_user(co, is_active=False)
    raw = get_platform_db()

    first = await credentials_service.issue_token(raw, email=pending, purpose="invite", company_id=co.company_id)
    resent = await client.post(f"{API}/auth/users/{pending}/invite", headers=_jwt(boss))
    assert resent.status_code == 200 and resent.json() == {"email_sent": True, "purpose": "invite"}
    assert outbox.mail[-1]["to"] == pending and outbox.mail[-1]["template"] == "account_invitation"
    assert (await _reset(client, first)).status_code == 400
    assert (await _reset(client, outbox.token())).status_code == 200

    again = await client.post(f"{API}/auth/users/{pending}/invite", headers=_jwt(boss))
    assert again.json() == {"email_sent": True, "purpose": "reset"}
    assert outbox.mail[-1]["template"] == "password_reset"

    assert (await client.post(f"{API}/auth/users/{standard}/invite", headers=_jwt(hr))).status_code == 200
    blocked = await client.post(f"{API}/auth/users/{other_hr}/invite", headers=_jwt(hr))
    assert blocked.status_code == 403 and "Super Admin" in blocked.json()["detail"]
    assert (await client.post(f"{API}/auth/users/{standard}/invite", headers=_jwt(standard))).status_code == 403

    refused = await client.post(f"{API}/auth/users/{owner}/invite", headers=_jwt(boss))
    assert refused.status_code == 403 and "managed by the platform owner" in refused.json()["detail"]
    assert (await client.post(f"{API}/auth/users/nobody-{uuid.uuid4().hex[:6]}@example.com/invite", headers=_jwt(boss))).status_code == 404
    assert (await client.post(f"{API}/auth/users/{deactivated}/invite", headers=_jwt(boss))).status_code == 409

    with company_context(co.company_id):
        audit = await get_db().audit_log.find({"action": "user_invite_resend"}).to_list(20)
    assert {row["resource_id"] for row in audit} >= {pending, standard}
    assert all(token_text not in str(audit) for token_text in (first, NEW_PASSWORD))
