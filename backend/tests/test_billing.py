import asyncio
import csv
import io
import json
import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import httpx
import pytest
from jose import jwt
from passlib.context import CryptContext

from config.database import get_db, get_platform_db
from config.settings import settings
from config.tenancy import PLATFORM_COMPANY_ID, company_context, current_company_id
from routes import intel as intel_routes
from routes import resumes as resume_routes
from services.hr_module import alerts_service, billing_service, email_service, plan_service
from services.hr_module import platform_jobs, resume_intel
from services.hr_module import platform_service as svc

pytestmark = pytest.mark.anyio

API = "/api/v1"
PLAT = f"{API}/platform"
PLATFORM = {"Authorization": "Bearer demo-platform-token"}
DEMO_OWNER = "demo-superadmin@hirely.ai"
PASSWORD = "Password-123!"
SECRET = "whsec_billing_tests"
WEBHOOK = f"{API}/billing/webhook/stripe"
MB = 1024 * 1024
_pwd = CryptContext(schemes=["bcrypt"])
KEEP = {"clients", "companies", "settings", "rate_limits", "sso_states", "otp_logs", "password_tokens"}


def tag() -> str:
    return uuid.uuid4().hex[:8]


def jwt_headers(email: str) -> dict:
    token = jwt.encode(
        {"sub": email, "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
        settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM,
    )
    return {"Authorization": f"Bearer {token}"}


def ago(days: int = 0, hours: int = 0) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days, hours=hours, minutes=1)).isoformat()


def soon(days: float) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


@pytest.fixture(autouse=True)
def _live_console(monkeypatch):
    monkeypatch.setattr(svc, "CACHE_SECONDS", 0)


class Made:
    def __init__(self):
        self.clients: list[str] = []
        self.companies: list[str] = []
        self.emails: list[str] = []
        self.event_prefixes: list[str] = []


@pytest.fixture
async def made():
    m = Made()
    yield m
    raw = get_platform_db()
    ids = set(m.companies)
    async for row in raw.companies.find({"client_id": {"$in": m.clients}}, {"company_id": 1}):
        ids.add(row["company_id"])
    ids = sorted(ids)
    for name in await raw.list_collection_names():
        if name not in KEEP and not name.startswith("system."):
            await raw[name].delete_many({"company_id": {"$in": ids}})
    id_pattern = "|".join(re.escape(i) for i in [*ids, *m.clients]) or "^$"
    await asyncio.gather(
        raw.users.delete_many({"email": {"$in": m.emails}}),
        raw.companies.delete_many({"company_id": {"$in": ids}}),
        raw.clients.delete_many({"client_id": {"$in": m.clients}}),
        raw.audit_log.delete_many({"company_id": PLATFORM_COMPANY_ID, "actor_email": {"$in": [DEMO_OWNER, "stripe-webhook"]}}),
        raw.rate_limits.delete_many({"_id": {"$regex": f"^(login:|co:({id_pattern}):)"}}),
        raw.settings.delete_many({"_id": {"$regex": f"^alert:.*({id_pattern})"}}),
        raw.settings.delete_many({"_id": {"$regex": "^usage_cache:"}}),
        *(raw.settings.delete_many({"_id": {"$regex": f"^stripe_event:{re.escape(p)}"}}) for p in m.event_prefixes),
    )


async def make_client(client, made: Made, *, company: bool = True, name: str | None = None, **extra) -> dict:
    t = tag()
    body: dict = {"name": name or f"Billing Client {t}", **extra}
    if company:
        body["company"] = {
            "name": f"Billing Co {t}",
            "admin": {"name": "Ada Admin", "email": f"admin-{t}@Example.com", "password": PASSWORD},
        }
    r = await client.post(f"{PLAT}/clients", headers=PLATFORM, json=body)
    assert r.status_code == 201, r.text
    data = r.json()
    made.clients.append(data["client"]["client_id"])
    if data["company"]:
        made.companies.append(data["company"]["company_id"])
        made.emails.append(f"admin-{t}@example.com")
    data["email"] = f"admin-{t}@example.com"
    data["admin"] = jwt_headers(data["email"])
    return data


async def add_company(client, made: Made, client_id: str, name: str) -> dict:
    t = tag()
    email = f"extra-{t}@example.com"
    made.emails.append(email)
    r = await client.post(
        f"{PLAT}/clients/{client_id}/companies", headers=PLATFORM,
        json={"name": name, "admin": {"name": "Bo Boss", "email": email, "password": PASSWORD}},
    )
    assert r.status_code == 201, r.text
    made.companies.append(r.json()["company"]["company_id"])
    return {**r.json()["company"], "email": email, "admin": jwt_headers(email)}


async def add_user(made: Made, company_id: str, *, role: str = "standard", **extra) -> str:
    email = f"acct-{tag()}@example.com"
    made.emails.append(email)
    await get_platform_db().users.insert_one({
        "name": "Seeded", "email": email, "role": role, "is_active": True, "company_id": company_id,
        "password_hash": _pwd.hash(PASSWORD), **extra,
    })
    return email


async def login(client, email: str, password: str = PASSWORD):
    return await client.post(f"{API}/auth/login", json={"email": email, "password": password})


async def set_subscription(client, client_id: str, **body):
    r = await client.patch(f"{PLAT}/clients/{client_id}/subscription", headers=PLATFORM, json=body)
    assert r.status_code == 200, r.text
    return r.json()["client"]


async def set_storage(company_id: str, used_bytes: int) -> None:
    await get_platform_db().companies.update_one({"company_id": company_id}, {"$set": {"usage.storage_bytes": used_bytes}})


async def stored_bytes(company_id: str) -> int:
    row = await get_platform_db().companies.find_one({"company_id": company_id})
    return int((row.get("usage") or {}).get("storage_bytes") or 0)


class Mailbox:

    def __init__(self):
        self.sent: list[dict] = []

    async def __call__(self, *, to, subject, html_body, text_body, db=None, **kw):
        self.sent.append({"to": to, "subject": subject, "text": text_body, "company_id": current_company_id(), "logged": db is not None})
        return True

    def to(self, address: str) -> list[dict]:
        return [m for m in self.sent if m["to"] == address]


@pytest.fixture
def mailbox(monkeypatch):
    box = Mailbox()
    monkeypatch.setattr(email_service, "send_email", box)
    return box


@pytest.fixture
def ops(monkeypatch):
    address = f"ops-{tag()}@example.com"
    monkeypatch.setattr(settings, "PLATFORM_ALERT_EMAILS", address)
    return address


async def test_the_plan_catalog_lists_the_tiers_and_switches(client):
    r = await client.get(f"{PLAT}/plans", headers=PLATFORM)
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"default_tier", "tiers", "features"} and body["default_tier"] == "standard"
    assert [t["tier"] for t in body["tiers"]] == ["standard", "starter", "growth", "enterprise"]
    standard = body["tiers"][0]["plan"]
    assert standard["max_users_per_company"] is None and standard["price_monthly_usd"] is None
    assert standard["features"] == {flag: True for flag in plan_service.FEATURES}
    assert body["tiers"][1]["plan"] == plan_service.tier_plan("starter")
    assert [f["key"] for f in body["features"]] == list(plan_service.FEATURES) and all(f["label"] for f in body["features"])


async def test_a_tier_is_applied_then_tuned_and_a_bad_plan_is_a_422(client, made):
    data = await make_client(client, made, company=False, plan={"tier": "growth"})
    cid = data["client"]["client_id"]
    assert data["client"]["plan"] == plan_service.tier_plan("growth")

    tuned = await client.patch(
        f"{PLAT}/clients/{cid}", headers=PLATFORM,
        json={"plan": {"tier": "starter", "max_users_per_company": 9, "features": {"coding": True}}},
    )
    plan = tuned.json()["client"]["plan"]
    assert plan["name"] == "starter" and plan["max_users_per_company"] == 9 and plan["monthly_ai_budget_usd"] == 25.0
    assert plan["features"]["coding"] is True and plan["features"]["performance"] is False

    more = await client.patch(
        f"{PLAT}/clients/{cid}", headers=PLATFORM,
        json={"plan": {"features": {"webhooks": True}, "max_storage_mb": None, "price_monthly_usd": 12.5}},
    )
    plan = more.json()["client"]["plan"]
    assert plan["features"]["webhooks"] is True and plan["features"]["performance"] is False
    assert plan["max_storage_mb"] is None and plan["price_monthly_usd"] == 12.5 and plan["max_users_per_company"] == 9

    for bad in (
        {"tier": "platinum"}, {"features": {"teleport": True}}, {"trial_ends_at": "someday"},
        {"max_storage_mb": 0}, {"price_monthly_usd": -1}, {"features": {"coding": "maybe"}},
    ):
        r = await client.patch(f"{PLAT}/clients/{cid}", headers=PLATFORM, json={"plan": bad})
        assert r.status_code == 422, (bad, r.text)
    stored = await get_platform_db().clients.find_one({"client_id": cid})
    assert stored["plan"]["name"] == "starter" and stored["plan"]["price_monthly_usd"] == 12.5

    rows = [r async for r in get_platform_db().audit_log.find({"company_id": PLATFORM_COMPANY_ID, "action": "client_update", "resource_id": cid})]
    assert rows and all(r["details"].get("plan") for r in rows)


async def test_a_company_sees_its_features_storage_and_billing_state(client, made):
    data = await make_client(client, made, plan={"tier": "starter"})
    cid = data["company"]["company_id"]
    await set_storage(cid, MB // 2)
    r = await client.get(f"{API}/company-settings/usage", headers=data["admin"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["plan"]["name"] == "starter" and body["plan"]["max_users_per_company"] == 5
    assert body["storage"] == {"used_mb": 0.5, "limit_mb": 1024}
    assert body["features"] == {flag: False for flag in plan_service.FEATURES}
    assert body["subscription"] == {"status": "none", "trial_ends_at": None, "current_period_end": None, "cancel_at_period_end": False}
    await client.patch(f"{PLAT}/clients/{data['client']['client_id']}", headers=PLATFORM, json={"plan": {"tier": "enterprise"}})
    again = (await client.get(f"{API}/company-settings/usage", headers=data["admin"])).json()
    assert all(again["features"].values()) and again["storage"]["limit_mb"] == 102400


LACKING = {"performance": False, "webhooks": False, "workflows": False}


async def test_a_feature_the_plan_lacks_is_402_on_its_admin_routes_and_open_everywhere_else(client, made):
    locked = await make_client(client, made, plan={"features": LACKING})
    open_ = await make_client(client, made)
    standard = jwt_headers(await add_user(made, locked["company"]["company_id"]))

    cases = [
        ("get", "/performance/cycles", "performance reviews"), ("get", "/performance/employees", "performance reviews"),
        ("post", "/performance/cycles", "performance reviews"), ("get", "/webhooks", "outbound webhooks"),
        ("get", "/webhooks/event-types", "outbound webhooks"), ("post", "/webhooks", "outbound webhooks"),
        ("get", "/workflows", "workflow automation"), ("get", "/workflows/triggers", "workflow automation"),
        ("post", "/workflows", "workflow automation"),
    ]
    for method, path, label in cases:
        r = await client.request(method, f"{API}{path}", headers=locked["admin"], json={} if method == "post" else None)
        assert r.status_code == 402, f"{method} {path}: {r.status_code} {r.text[:120]}"
        assert r.json()["detail"] == f"Your plan does not include {label}."

    for path in ("/performance/cycles", "/webhooks", "/workflows"):
        assert (await client.get(f"{API}{path}", headers=open_["admin"])).status_code == 200, path

    assert (await client.get(f"{API}/performance/rating-config")).status_code == 200
    assert (await client.get(f"{API}/performance/rating-config", headers=locked["admin"])).status_code == 200
    public = await client.get(f"{API}/performance/public/{uuid.uuid4().hex}")
    assert public.status_code == 404

    assert (await client.get(f"{API}/webhooks", headers=standard)).status_code == 403
    assert (await client.get(f"{API}/performance/cycles", headers=standard)).status_code == 403

    cid = locked["client"]["client_id"]
    await client.patch(f"{PLAT}/clients/{cid}", headers=PLATFORM, json={"plan": {"features": {k: True for k in LACKING}}})
    for path in ("/performance/cycles", "/webhooks", "/workflows"):
        assert (await client.get(f"{API}{path}", headers=locked["admin"])).status_code == 200, path


async def test_marking_a_subscription_by_hand_is_validated_audited_and_ends_the_trial_when_active(client, made):
    data = await make_client(client, made, company=False)
    cid = data["client"]["client_id"]
    row = await set_subscription(client, cid, status="trialing", trial_ends_at="2099-01-31")
    assert row["subscription"]["status"] == "trialing" and row["subscription"]["provider"] == "manual"
    assert row["plan"]["trial_ends_at"] == "2099-01-31T23:59:59+00:00"

    kept = await set_subscription(client, cid, status="past_due")
    assert kept["plan"]["trial_ends_at"] == "2099-01-31T23:59:59+00:00"
    active = await set_subscription(client, cid, status="active", provider="stripe")
    assert active["subscription"]["status"] == "active" and active["subscription"]["provider"] == "stripe"
    assert active["plan"]["trial_ends_at"] is None
    shown = (await client.get(f"{PLAT}/clients/{cid}", headers=PLATFORM)).json()["client"]
    assert shown["subscription"]["status"] == "active"

    for bad in ({"status": "bogus"}, {}, {"status": "trialing", "trial_ends_at": "never"}, {"status": "active", "provider": "paypal"}):
        r = await client.patch(f"{PLAT}/clients/{cid}/subscription", headers=PLATFORM, json=bad)
        assert r.status_code == 422, (bad, r.text)
    assert (await client.patch(f"{PLAT}/clients/cli_nope/subscription", headers=PLATFORM, json={"status": "active"})).status_code == 404

    actions = [r["action"] async for r in get_platform_db().audit_log.find({"company_id": PLATFORM_COMPANY_ID, "resource_id": cid})]
    assert actions.count("client_subscription_update") == 3


async def test_an_ended_trial_blocks_sign_in_and_live_sessions_but_is_not_a_suspension(client, made):
    data = await make_client(client, made, plan={"trial_ends_at": ago(days=1)})
    cid, company_id, email = data["client"]["client_id"], data["company"]["company_id"], data["email"]
    await set_subscription(client, cid, status="trialing")
    ended = plan_service.TRIAL_ENDED_MESSAGE

    refused = await login(client, email)
    assert refused.status_code == 403 and refused.json()["detail"] == ended
    assert "suspended" not in ended.lower()
    assert (await login(client, email, "wrong-password-1")).status_code == 401
    live = await client.get(f"{API}/auth/me", headers=data["admin"])
    assert live.status_code == 403 and live.json()["detail"] == ended
    assert (await client.get(f"{API}/jobs", headers=data["admin"])).status_code == 403

    row = (await client.get(f"{PLAT}/companies/{company_id}", headers=PLATFORM)).json()["company"]
    assert row["status"] == "active" and row["client_status"] == "active" and row["plan"]["trial_ends_at"]

    await set_subscription(client, cid, status="active")
    assert (await login(client, email)).status_code == 200
    assert (await client.get(f"{API}/auth/me", headers=data["admin"])).status_code == 200

    await set_subscription(client, cid, status="trialing", trial_ends_at=soon(5))
    assert (await login(client, email)).status_code == 200
    await set_subscription(client, cid, status="trialing", trial_ends_at=ago(hours=2))
    assert (await login(client, email)).status_code == 403


async def test_a_canceled_subscription_blocks_with_its_own_message_and_past_due_does_not(client, made):
    data = await make_client(client, made)
    cid, email = data["client"]["client_id"], data["email"]
    await set_subscription(client, cid, status="canceled")
    ended = plan_service.SUBSCRIPTION_ENDED_MESSAGE
    refused = await login(client, email)
    assert refused.status_code == 403 and refused.json()["detail"] == ended
    live = await client.get(f"{API}/auth/me", headers=data["admin"])
    assert live.status_code == 403 and live.json()["detail"] == ended
    assert ended != plan_service.TRIAL_ENDED_MESSAGE and ended != "This workspace is suspended. Contact your administrator."

    await set_subscription(client, cid, status="past_due")
    assert (await login(client, email)).status_code == 200
    assert (await client.get(f"{API}/auth/me", headers=data["admin"])).status_code == 200


async def test_suspension_still_wins_over_a_billing_block(client, made):
    data = await make_client(client, made, plan={"trial_ends_at": ago(days=1)})
    await client.post(f"{PLAT}/companies/{data['company']['company_id']}/suspend", headers=PLATFORM, json={"reason": "r"})
    refused = await login(client, data["email"])
    assert refused.status_code == 403 and "suspended" in refused.json()["detail"].lower()


async def test_the_statement_counts_a_calendar_month_per_company_as_json_and_as_csv(client, made):
    data = await make_client(client, made, name=f"Statement Client {tag()}", plan={"tier": "growth"})
    cid = data["client"]["client_id"]
    a = data["company"]["company_id"]
    b_company = await add_company(client, made, cid, f"=Beta Unit {tag()}")
    b = b_company["company_id"]
    raw = get_platform_db()

    for created in ("2026-02-01T10:00:00+00:00", datetime(2026, 1, 5, tzinfo=timezone.utc), None):
        await add_user(made, a, **({"created_at": created} if created is not None else {}))
    await add_user(made, a, is_active=False, created_at="2026-01-01T00:00:00+00:00")
    await add_user(made, a, created_at="2026-04-05T00:00:00+00:00")
    with company_context(a):
        await get_db().cost_ledger.insert_many([
            {"source": "t", "cost_usd": 0.5, "llm_calls": 3, "created_at": "2026-03-10T10:00:00+00:00"},
            {"source": "t", "cost_usd": 0.25, "llm_calls": 2, "created_at": "2026-03-31T23:59:59+00:00"},
            {"source": "t", "cost_usd": 9.0, "llm_calls": 9, "created_at": "2026-04-01T00:00:00+00:00"},
            {"source": "t", "cost_usd": 9.0, "llm_calls": 9, "created_at": "2026-02-28T23:59:59+00:00"},
        ])
        await get_db().email_log.insert_many([
            {"to": "x@example.com", "status": status, "created_at": when}
            for status, when in (("sent", "2026-03-02T00:00:00+00:00"), ("sent", "2026-03-30T00:00:00+00:00"),
                                 ("failed", "2026-03-15T00:00:00+00:00"), ("sent", "2026-04-02T00:00:00+00:00"))
        ])
    with company_context(b):
        await get_db().cost_ledger.insert_one({"source": "t", "cost_usd": 0.1, "llm_calls": 1, "created_at": "2026-03-05T00:00:00+00:00"})
    await set_storage(a, 3 * MB)
    await set_storage(b, MB // 2)

    r = await client.get(f"{PLAT}/billing/statement", params={"client_id": cid, "month": "2026-03"}, headers=PLATFORM)
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["month"] == "2026-03" and s["period"] == {"kind": "month", "from": "2026-03-01T00:00:00+00:00", "to": "2026-04-01T00:00:00+00:00"}
    (entry,) = s["clients"]
    assert entry["client_id"] == cid and entry["plan"] == {"name": "growth", "price_monthly_usd": 199.0}
    lines = {line["company_id"]: line for line in entry["lines"]}
    assert lines[a]["seats"] == 3 and lines[a]["ai_cost_usd"] == 0.75 and lines[a]["ai_calls"] == 5
    assert lines[a]["emails_sent"] == 2 and lines[a]["storage_mb"] == 3.0
    assert lines[b]["seats"] == 0 and lines[b]["ai_cost_usd"] == 0.1 and lines[b]["emails_sent"] == 0 and lines[b]["storage_mb"] == 0.5
    assert entry["totals"] == {"companies": 2, "seats": 3, "ai_cost_usd": 0.85, "ai_calls": 6, "emails_sent": 2, "storage_mb": 3.5}
    assert s["totals"]["price_monthly_usd"] == 199.0 and s["totals"]["seats"] == 3

    now_month = datetime.now(timezone.utc).strftime("%Y-%m")
    current = (await client.get(f"{PLAT}/billing/statement", params={"client_id": cid}, headers=PLATFORM)).json()
    assert current["month"] == now_month
    assert {line["company_id"]: line["seats"] for line in current["clients"][0]["lines"]}[a] >= 5

    everyone = (await client.get(f"{PLAT}/billing/statement", params={"month": "2026-03"}, headers=PLATFORM)).json()
    assert cid in {c["client_id"] for c in everyone["clients"]} and everyone["totals"]["companies"] >= 2

    c = await client.get(f"{PLAT}/billing/statement", params={"client_id": cid, "month": "2026-03", "format": "csv"}, headers=PLATFORM)
    assert c.status_code == 200 and c.headers["content-type"].startswith("text/csv")
    assert c.headers["content-disposition"] == 'attachment; filename="statement-2026-03.csv"'
    rows = list(csv.reader(io.StringIO(c.text)))
    assert tuple(rows[0]) == billing_service.CSV_COLUMNS and len(rows) == 4
    by_company = {r[3]: dict(zip(billing_service.CSV_COLUMNS, r)) for r in rows[1:3]}
    assert by_company[a]["seats"] == "3" and by_company[a]["ai_cost_usd"] == "0.75" and by_company[a]["plan"] == "growth"
    assert by_company[b]["company"].startswith("'=Beta Unit")
    assert rows[-1][2] == "TOTAL" and rows[-1][8] == "3" and rows[-1][7] == "199.0"

    for bad in ({"month": "2026-13"}, {"month": "March"}, {"month": "2026-03", "format": "xml"}):
        assert (await client.get(f"{PLAT}/billing/statement", params=bad, headers=PLATFORM)).status_code == 422, bad
    assert (await client.get(f"{PLAT}/billing/statement", params={"client_id": "cli_nope"}, headers=PLATFORM)).status_code == 404


async def test_billing_endpoints_are_for_platform_owners_only(client, made):
    data = await make_client(client, made)
    cid = data["client"]["client_id"]
    calls = [
        ("get", f"{PLAT}/plans", None), ("get", f"{PLAT}/billing/statement", None),
        ("patch", f"{PLAT}/clients/{cid}/subscription", {"status": "active"}),
        ("post", f"{PLAT}/clients/{cid}/billing/checkout", {}), ("post", f"{PLAT}/clients/{cid}/billing/portal", None),
    ]
    for method, url, body in calls:
        assert (await client.request(method, url, headers=data["admin"], json=body)).status_code == 403, url
        assert (await client.request(method, url, json=body)).status_code == 401, url
    assert (await get_platform_db().clients.find_one({"client_id": cid}) or {}).get("subscription", {}).get("status") != "active"


def mock_stripe(monkeypatch, answer=None, status=200):
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(status, json=answer or {"url": "https://checkout.stripe.com/c/pay/cs_test_x"})

    monkeypatch.setattr(billing_service, "_http_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url=billing_service.STRIPE_API))
    return seen


async def test_checkout_and_the_portal_answer_503_without_keys_and_work_with_a_mocked_stripe(client, made, monkeypatch):
    data = await make_client(client, made, company=False, plan={"tier": "growth"}, contact_email="pay@example.com")
    cid = data["client"]["client_id"]
    monkeypatch.setattr(settings, "STRIPE_SECRET_KEY", "")
    for path in ("checkout", "portal"):
        r = await client.post(f"{PLAT}/clients/{cid}/billing/{path}", headers=PLATFORM, json={})
        assert r.status_code == 503 and r.json()["detail"] == "Stripe is not configured."

    monkeypatch.setattr(settings, "STRIPE_SECRET_KEY", "sk_test_billing")
    monkeypatch.setattr(settings, "STRIPE_PRICE_IDS", json.dumps({"growth": "price_growth_1"}))
    seen = mock_stripe(monkeypatch)
    r = await client.post(f"{PLAT}/clients/{cid}/billing/checkout", headers=PLATFORM, json={})
    assert r.status_code == 200 and r.json() == {"url": "https://checkout.stripe.com/c/pay/cs_test_x"}
    from urllib.parse import parse_qsl
    form = dict(parse_qsl(seen[0].content.decode()))
    assert str(seen[0].url) == "https://api.stripe.com/v1/checkout/sessions"
    assert form["mode"] == "subscription" and form["client_reference_id"] == cid and form["line_items[0][price]"] == "price_growth_1"
    assert form["customer_email"] == "pay@example.com"

    missing = await client.post(f"{PLAT}/clients/{cid}/billing/checkout", headers=PLATFORM, json={"tier": "enterprise"})
    assert missing.status_code == 422 and "enterprise" in missing.json()["detail"]
    no_customer = await client.post(f"{PLAT}/clients/{cid}/billing/portal", headers=PLATFORM)
    assert no_customer.status_code == 409

    await get_platform_db().clients.update_one({"client_id": cid}, {"$set": {"subscription.customer_id": "cus_billing"}})
    seen.clear()
    portal = await client.post(f"{PLAT}/clients/{cid}/billing/portal", headers=PLATFORM)
    assert portal.status_code == 200 and "url" in portal.json()
    assert dict(parse_qsl(seen[0].content.decode()))["customer"] == "cus_billing"
    assert (await client.post(f"{PLAT}/clients/cli_nope/billing/checkout", headers=PLATFORM, json={})).status_code == 404

    mock_stripe(monkeypatch, {"error": {"message": "secret detail"}}, status=400)
    refused = await client.post(f"{PLAT}/clients/{cid}/billing/checkout", headers=PLATFORM, json={})
    assert refused.status_code == 502 and "secret detail" not in refused.text
    actions = {r["action"] async for r in get_platform_db().audit_log.find({"company_id": PLATFORM_COMPANY_ID, "resource_id": cid})}
    assert {"client_billing_checkout", "client_billing_portal"} <= actions


def signed(event: dict, *, at: float | None = None, secret: str = SECRET) -> tuple[bytes, dict]:
    payload = json.dumps(event, separators=(",", ":")).encode()
    stamp = int(at if at is not None else time.time())
    return payload, {"Stripe-Signature": f"t={stamp},v1={billing_service.compute_signature(secret, stamp, payload)}", "Content-Type": "application/json"}


def event(made: Made, kind: str, obj: dict, prefix: str | None = None) -> dict:
    prefix = prefix or f"evt_{tag()}"
    if prefix not in made.event_prefixes:
        made.event_prefixes.append(prefix)
    return {"id": f"{prefix}_{tag()}", "type": kind, "data": {"object": obj}}


async def post_event(client, payload: bytes, headers: dict):
    return await client.post(WEBHOOK, content=payload, headers=headers)


async def test_a_signed_webhook_changes_the_subscription_and_everything_unsigned_or_stale_changes_nothing(client, made, monkeypatch):
    monkeypatch.setattr(settings, "STRIPE_WEBHOOK_SECRET", SECRET)
    data = await make_client(client, made, plan={"trial_ends_at": ago(days=1)})
    cid, email = data["client"]["client_id"], data["email"]
    await set_subscription(client, cid, status="trialing")
    assert (await login(client, email)).status_code == 403
    raw = get_platform_db()

    paid = event(made, "checkout.session.completed", {
        "mode": "subscription", "client_reference_id": cid, "customer": "cus_e2e", "subscription": "sub_e2e", "payment_status": "paid",
    })
    payload, headers = signed(paid)
    r = await post_event(client, payload, headers)
    assert r.status_code == 200, r.text
    assert r.json() == {"received": True, "handled": True, "client_id": cid, "status": "active"}
    stored = await raw.clients.find_one({"client_id": cid})
    assert stored["subscription"]["status"] == "active" and stored["subscription"]["provider"] == "stripe"
    assert stored["subscription"]["customer_id"] == "cus_e2e" and stored["subscription"]["subscription_id"] == "sub_e2e"
    assert stored["plan"]["trial_ends_at"] is None
    assert (await login(client, email)).status_code == 200

    rows_before = await raw.audit_log.count_documents({"company_id": PLATFORM_COMPANY_ID, "action": "client_subscription_stripe", "resource_id": cid})
    assert (await post_event(client, payload, headers)).json() == {"received": True, "duplicate": True}
    fresh_payload, fresh_headers = signed(paid)
    assert (await post_event(client, fresh_payload, fresh_headers)).json() == {"received": True, "duplicate": True}
    assert await raw.audit_log.count_documents({"company_id": PLATFORM_COMPANY_ID, "action": "client_subscription_stripe", "resource_id": cid}) == rows_before

    cancel = event(made, "customer.subscription.deleted", {"id": "sub_e2e", "customer": "cus_e2e", "status": "canceled", "metadata": {"client_id": cid}})
    good, good_headers = signed(cancel)
    for label, body, hdrs in (
        ("tampered", good.replace(b"canceled", b"active  "), good_headers),
        ("stale", *signed(cancel, at=time.time() - 3600)),
        ("wrong secret", *signed(cancel, secret="whsec_not_ours")),
        ("unsigned", good, {"Content-Type": "application/json"}),
        ("garbage header", good, {"Stripe-Signature": "nonsense"}),
    ):
        refused = await post_event(client, body, hdrs)
        assert refused.status_code == 400, (label, refused.status_code, refused.text)
    assert (await raw.clients.find_one({"client_id": cid}))["subscription"]["status"] == "active"
    assert (await login(client, email)).status_code == 200

    ok = await post_event(client, good, good_headers)
    assert ok.status_code == 200 and ok.json()["status"] == "canceled"
    blocked = await login(client, email)
    assert blocked.status_code == 403 and blocked.json()["detail"] == plan_service.SUBSCRIPTION_ENDED_MESSAGE

    other = event(made, "customer.created", {"id": "cus_other"})
    other_payload, other_headers = signed(other)
    assert (await post_event(client, other_payload, other_headers)).json() == {"received": True, "handled": False}
    trail = [r async for r in raw.audit_log.find({"company_id": PLATFORM_COMPANY_ID, "action": "client_subscription_stripe", "resource_id": cid})]
    assert trail and all(r["actor_role"] == "system" and r["actor_email"] == "stripe-webhook" for r in trail)

    monkeypatch.setattr(settings, "STRIPE_WEBHOOK_SECRET", "")
    off = await post_event(client, good, good_headers)
    assert off.status_code == 503 and off.json()["detail"] == "Stripe is not configured."


async def test_a_failed_payment_marks_the_client_past_due_and_tells_the_owners_once(client, made, monkeypatch, mailbox, ops):
    monkeypatch.setattr(settings, "STRIPE_WEBHOOK_SECRET", SECRET)
    data = await make_client(client, made, name=f"Payer {tag()}")
    cid = data["client"]["client_id"]
    await get_platform_db().clients.update_one({"client_id": cid}, {"$set": {"subscription.customer_id": "cus_pay", "subscription.status": "active"}})

    failed = event(made, "invoice.payment_failed", {"customer": "cus_pay", "subscription": "sub_pay", "amount_due": 4900, "currency": "usd", "attempt_count": 1})
    payload, headers = signed(failed)
    assert (await post_event(client, payload, headers)).status_code == 200
    assert (await get_platform_db().clients.find_one({"client_id": cid}))["subscription"]["status"] == "past_due"
    mails = mailbox.to(ops)
    assert len(mails) == 1 and data["client"]["name"] in mails[0]["subject"] and "49.00 USD" in mails[0]["text"]
    assert mails[0]["company_id"] == PLATFORM_COMPANY_ID
    total = len(mailbox.sent)

    assert (await post_event(client, payload, headers)).json()["duplicate"] is True
    again = event(made, "invoice.payment_failed", {"customer": "cus_pay", "subscription": "sub_pay", "amount_due": 4900, "currency": "usd", "attempt_count": 2})
    assert (await post_event(client, *signed(again))).status_code == 200
    assert len(mailbox.sent) == total
    assert (await login(client, data["email"])).status_code == 200


async def test_a_full_plan_refuses_an_upload_before_anything_is_stored_and_a_fitting_one_goes_through(client, made, monkeypatch):
    data = await make_client(client, made, plan={"max_storage_mb": 1})
    cid, admin = data["company"]["company_id"], data["admin"]
    raw = get_platform_db()
    await set_storage(cid, MB - 10)

    r = await client.post(f"{API}/resumes/upload", headers=admin, files={"file": ("cv.txt", b"x" * 100, "text/plain")})
    assert r.status_code == 413, r.text
    assert r.json()["detail"].startswith("Your plan's storage is full") and chr(0x2014) not in r.json()["detail"]
    assert await raw.resumes.count_documents({"company_id": cid}) == 0

    bulk = await client.post(f"{API}/intel/resumes/upload-bulk", headers=admin, files=[("files", ("a.txt", b"y" * 60, "text/plain")), ("files", ("b.txt", b"z" * 60, "text/plain"))])
    assert bulk.status_code == 413
    assert await raw.upload_batches.count_documents({"company_id": cid}) == 0

    monkeypatch.setattr(resume_routes, "_run_agent", AsyncMock())
    monkeypatch.setattr(intel_routes, "_run_batch", AsyncMock())
    fits = await client.post(f"{API}/resumes/upload", headers=admin, files={"file": ("cv.txt", b"x" * 10, "text/plain")})
    assert fits.status_code == 200 and fits.json()["status"] == "processing"
    assert await raw.resumes.count_documents({"company_id": cid, "processing_status": "pending"}) == 1
    await set_storage(cid, 0)
    ok_bulk = await client.post(f"{API}/intel/resumes/upload-bulk", headers=admin, files=[("files", ("c.txt", b"w" * 60, "text/plain"))])
    assert ok_bulk.status_code == 200 and ok_bulk.json()["total_files"] == 1

    free = await make_client(client, made)
    await set_storage(free["company"]["company_id"], 500 * MB)
    assert (await client.post(f"{API}/resumes/upload", headers=free["admin"], files={"file": ("cv.txt", b"x" * 10, "text/plain")})).status_code == 200


def a_resume(resume_id: str, size: int) -> dict:
    return {
        "resume_id": resume_id, "filename": f"{resume_id}.pdf", "text": "Jane Doe\nSenior engineer who builds payment services",
        "raw_bytes": b"r" * size, "classification": {}, "embedding": [], "matched_jds": [],
    }


async def file_size(company_id: str, resume_id: str) -> int:
    rows = await get_platform_db().resume_files.aggregate([
        {"$match": {"company_id": company_id, "resume_id": resume_id}},
        {"$group": {"_id": None, "bytes": {"$sum": {"$bsonSize": "$$ROOT"}}}},
    ]).to_list(1)
    return rows[0]["bytes"]


async def test_the_storage_counter_follows_every_store_and_every_kind_of_delete(client, made, monkeypatch):
    monkeypatch.setattr(resume_routes, "get_pinecone", lambda: None)
    monkeypatch.setattr(intel_routes, "get_pinecone", lambda: None)
    data = await make_client(client, made)
    cid, admin = data["company"]["company_id"], data["admin"]
    a, b, c = (f"res-{tag()}" for _ in range(3))
    with company_context(cid):
        await resume_intel.store_resume(a_resume(a, 3000))
        assert await stored_bytes(cid) == 3000
        await resume_intel.store_resume(a_resume(b, 5000))
        await resume_intel.store_resume(a_resume(c, 7000))
        await resume_intel.store_resume(a_resume(a, 3000))
    assert await stored_bytes(cid) == 15000

    freed_a = await file_size(cid, a)
    assert freed_a > 3000
    one = await client.delete(f"{API}/resumes/{a}", headers=admin)
    assert one.status_code == 200
    assert await stored_bytes(cid) == 15000 - freed_a

    freed_b = await file_size(cid, b)
    bulk = await client.post(f"{API}/resumes/bulk-delete", headers=admin, json={"resume_ids": [b]})
    assert bulk.status_code == 200 and bulk.json()["deleted"] == [b]
    assert await stored_bytes(cid) == 15000 - freed_a - freed_b

    purge = await client.post(f"{API}/intel/resumes/purge", headers=admin, json={})
    assert purge.status_code == 200 and purge.json()["deleted"] == 1
    assert await stored_bytes(cid) == 0
    assert await get_platform_db().resume_files.count_documents({"company_id": cid}) == 0


async def test_the_daily_check_puts_the_counter_right_and_the_owners_hear_about_a_full_company(client, made, monkeypatch):
    alert = AsyncMock(return_value=True)
    told = AsyncMock()
    monkeypatch.setattr(alerts_service, "alert_owners", alert)
    monkeypatch.setattr(alerts_service, "budget_threshold", told)
    t = tag()
    data = await make_client(client, made, name=f"Daily {t}", plan={"max_storage_mb": 1, "monthly_ai_budget_usd": 1.0, "trial_ends_at": soon(2)})
    cid, client_id = data["company"]["company_id"], data["client"]["client_id"]
    raw = get_platform_db()
    await raw.resume_files.insert_one({"company_id": cid, "resume_id": f"res-{t}", "filename": "big.pdf", "data": b"x" * (950 * 1024)})
    await set_storage(cid, 42)
    with company_context(cid):
        await get_db().cost_ledger.insert_one({"source": "t", "cost_usd": 0.9, "llm_calls": 1, "created_at": datetime.now(timezone.utc).isoformat()})
        await get_db().email_log.insert_many([{"to": "x@example.com", "status": "failed", "created_at": ago()} for _ in range(platform_jobs.EMAIL_FAILURE_THRESHOLD)])

    out = await platform_jobs.run_platform_checks(40)
    assert out["steps"]["storage_reconcile"]["drifted"] >= 1 and "error" not in out["steps"]["storage_reconcile"]
    expected = await file_size(cid, f"res-{t}")
    assert await stored_bytes(cid) == expected
    assert (await raw.companies.find_one({"company_id": cid}))["usage"]["storage_reconciled_at"]

    keys = [(c.args[0], c.kwargs) for c in alert.await_args_list]
    assert any(k == f"storage_90:{cid}" and kw.get("company_id") == cid for k, kw in keys)
    assert any(k.startswith(f"trial_ending:{client_id}:") for k, _ in keys)
    assert any(k == "email_failures" for k, _ in keys)
    assert any(c.args[:3] == (cid, 80, pytest.approx(0.9)) for c in told.await_args_list)

    again = await platform_jobs.run_platform_checks(40)
    assert again["ok"] and again["steps"]["storage_reconcile"]["drifted"] == 0 and await stored_bytes(cid) == expected
    cron = (await client.get(f"{PLAT}/health", headers=PLATFORM)).json()["cron"]
    assert "platform_checks" in {c["key"] for c in cron}


async def test_a_company_is_told_at_eighty_percent_and_again_when_the_budget_is_gone_once_each(client, made, mailbox, ops):
    data = await make_client(client, made, plan={"monthly_ai_budget_usd": 1.0})
    cid, admin, admin_email = data["company"]["company_id"], data["admin"], data["email"]
    month = plan_service.month_label()
    url = f"{API}/coding/questions/generate"

    async def spend(amount: float):
        with company_context(cid):
            await get_db().cost_ledger.insert_one({"source": "t", "cost_usd": amount, "llm_calls": 1, "created_at": datetime.now(timezone.utc).isoformat()})

    await spend(0.5)
    assert (await client.post(url, headers=admin, json={})).status_code == 422
    assert mailbox.sent == []

    await spend(0.35)
    assert (await client.post(url, headers=admin, json={})).status_code == 422
    owner_mail, company_mail = mailbox.to(ops), mailbox.to(admin_email)
    assert len(owner_mail) == 1 and "80%" in owner_mail[0]["subject"] and "$0.85 of its $1.00" in owner_mail[0]["text"]
    assert owner_mail[0]["company_id"] == PLATFORM_COMPANY_ID
    assert len(company_mail) == 1 and "80% used" in company_mail[0]["subject"]
    assert company_mail[0]["company_id"] == cid and company_mail[0]["logged"] is True
    marker = (await get_platform_db().companies.find_one({"company_id": cid}))["usage"]["ai_alert"]
    assert marker == {"month": month, "band": 80}

    sent = len(mailbox.sent)
    for _ in range(3):
        assert (await client.post(url, headers=admin, json={})).status_code == 422
    assert len(mailbox.sent) == sent

    await spend(0.3)
    over = await client.post(url, headers=admin, json={})
    assert over.status_code == 402 and over.json()["detail"].startswith("This company has used its monthly AI budget")
    owner_mail, company_mail = mailbox.to(ops), mailbox.to(admin_email)
    assert len(owner_mail) == 2 and "used its monthly AI budget" in owner_mail[1]["subject"]
    assert len(company_mail) == 2 and "used up" in company_mail[1]["subject"]
    assert (await get_platform_db().companies.find_one({"company_id": cid}))["usage"]["ai_alert"] == {"month": month, "band": 100}
    sent = len(mailbox.sent)
    assert (await client.post(url, headers=admin, json={})).status_code == 402
    assert len(mailbox.sent) == sent
    assert chr(0x2014) not in "".join(m["subject"] + m["text"] for m in mailbox.sent)


async def test_a_company_with_no_budget_is_never_told_anything(client, made, mailbox, ops):
    data = await make_client(client, made)
    with company_context(data["company"]["company_id"]):
        await get_db().cost_ledger.insert_one({"source": "t", "cost_usd": 500.0, "llm_calls": 1, "created_at": datetime.now(timezone.utc).isoformat()})
    assert (await client.post(f"{API}/coding/questions/generate", headers=data["admin"], json={})).status_code == 422
    assert mailbox.sent == []


async def test_a_repeated_console_read_is_served_from_the_cache_until_refreshed_or_a_write_or_five_minutes(client, made, monkeypatch):
    monkeypatch.setattr(svc, "CACHE_SECONDS", 300)
    t = tag()
    data = await make_client(client, made, name=f"Cached {t}")
    cid, company_id = data["client"]["client_id"], data["company"]["company_id"]
    url = f"{PLAT}/clients?search={t}"

    async def add_job():
        with company_context(company_id):
            await get_db().jobs.insert_one({"doc_type": "job", "job_id": f"job-{tag()}", "title": "T", "description": "d", "candidate_pipeline": [], "created_at": ago()})

    async def jobs(r) -> int:
        (row,) = r.json()["clients"]
        return row["jobs"]

    first = await client.get(url, headers=PLATFORM)
    assert first.status_code == 200 and await jobs(first) == 0 and datetime.fromisoformat(first.json()["computed_at"]).tzinfo
    await add_job()
    second = await client.get(url, headers=PLATFORM)
    assert await jobs(second) == 0 and second.json()["computed_at"] == first.json()["computed_at"]

    fresh = await client.get(f"{url}&refresh=1", headers=PLATFORM)
    assert await jobs(fresh) == 1 and fresh.json()["computed_at"] != first.json()["computed_at"]
    after = await client.get(url, headers=PLATFORM)
    assert await jobs(after) == 1 and after.json()["computed_at"] == fresh.json()["computed_at"]

    await add_job()
    assert await jobs(await client.get(url, headers=PLATFORM)) == 1
    patched = await client.patch(f"{PLAT}/clients/{cid}", headers=PLATFORM, json={"notes": "a write"})
    assert patched.status_code == 200
    assert await jobs(await client.get(url, headers=PLATFORM)) == 2

    raw = get_platform_db()
    stale_at = datetime.now(timezone.utc) - timedelta(minutes=10)
    await raw.settings.update_many({"_id": {"$regex": "^usage_cache:"}, "view": "clients"}, {"$set": {"created_at": stale_at}})
    await add_job()
    assert await jobs(await client.get(url, headers=PLATFORM)) == 3

    for path in ("/overview", "/usage", "/clients", "/companies", f"/clients/{cid}", f"/companies/{company_id}"):
        r = await client.get(f"{PLAT}{path}", params={"refresh": 1}, headers=PLATFORM)
        assert r.status_code == 200 and "computed_at" in r.json(), path
        cached = await client.get(f"{PLAT}{path}", headers=PLATFORM)
        assert cached.json()["computed_at"] == r.json()["computed_at"], path

    docs = [d async for d in raw.settings.find({"_id": {"$regex": "^usage_cache:"}})]
    assert docs and all(isinstance(d["created_at"], datetime) and d["payload"]["computed_at"] for d in docs)
    assert (await raw.settings.find_one({"_id": "usage_cache_epoch"}))["value"] >= 2
