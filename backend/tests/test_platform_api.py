import asyncio
import sys
import types
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from jose import jwt
from passlib.context import CryptContext

from config.database import get_db, get_platform_db
from config.settings import settings
from config.tenancy import DEFAULT_COMPANY_ID, PLATFORM_CLIENT_ID, PLATFORM_COMPANY_ID, company_context
from routes import auth as auth_routes
from services.hr_module import platform_service as svc
from services.hr_module import plan_service, workspace_service
from services.hr_module.platform_service import FEATURE_KEYS
from support_routes import MUTATING, all_routes

pytestmark = pytest.mark.anyio

API = "/api/v1/platform"
AUTH = "/api/v1/auth"
PLATFORM = {"Authorization": "Bearer demo-platform-token"}
DEMO_OWNER = "demo-superadmin@hirely.ai"
PASSWORD = "Password-123!"
_pwd = CryptContext(schemes=["bcrypt"])

MARKERS = (
    "MARK-CANDIDATE-NAME", "MARK-RESUME-TEXT", "MARK-REPORT-SUMMARY", "MARK-TRANSCRIPT", "MARK-CODE",
    "MARK-SALARY", "MARK-REVIEW-COMMENT", "MARK-SUBJECT", "mark-cand-", "mark-to@",
)


def tag() -> str:
    return uuid.uuid4().hex[:8]


def jwt_headers(email: str) -> dict:
    token = jwt.encode(
        {"sub": email, "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
        settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM,
    )
    return {"Authorization": f"Bearer {token}"}


def ago(days: int = 0) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days, minutes=1)).isoformat()


def assert_no_secrets(*responses):
    for r in responses:
        for needle in ("password_hash", "$2b$", "$2a$", "avatar", *MARKERS):
            assert needle not in r.text, f"{needle!r} leaked in {r.request.method} {r.request.url.path}"


@pytest.fixture(autouse=True)
def _live_console(monkeypatch):
    monkeypatch.setattr(svc, "CACHE_SECONDS", 0)


SEEDED_COLLECTIONS = (
    "users", "jobs", "resumes", "candidates", "coding_submissions", "offers", "performance_reviews",
    "email_log", "cost_ledger", "audit_log",
)


class Made:

    def __init__(self):
        self.clients: list[str] = []
        self.companies: list[str] = []
        self.emails: list[str] = []


@pytest.fixture
async def made():
    m = Made()
    yield m
    raw = get_platform_db()
    company_ids = set(m.companies)
    async for row in raw.companies.find({"client_id": {"$in": m.clients}}, {"company_id": 1}):
        company_ids.add(row["company_id"])
    ids = sorted(company_ids)
    await asyncio.gather(
        *(raw[name].delete_many({"company_id": {"$in": ids}}) for name in SEEDED_COLLECTIONS),
        raw.users.delete_many({"email": {"$in": m.emails}}),
        raw.companies.delete_many({"company_id": {"$in": ids}}),
        raw.clients.delete_many({"client_id": {"$in": m.clients}}),
        raw.audit_log.delete_many({"company_id": PLATFORM_COMPANY_ID, "actor_email": DEMO_OWNER}),
        raw.rate_limits.delete_many({"_id": {"$regex": "^login:"}}),
    )


async def make_client(client, made: Made, *, company: bool = True, name: str | None = None, **extra) -> dict:
    t = tag()
    body: dict = {"name": name or f"Plat Client {t}", **extra}
    if company:
        body["company"] = {
            "name": f"Plat Co {t}",
            "admin": {"name": "Ada Admin", "email": f"admin-{t}@Example.com", "password": PASSWORD},
        }
    r = await client.post(f"{API}/clients", headers=PLATFORM, json=body)
    if r.status_code == 201:
        data = r.json()
        made.clients.append(data["client"]["client_id"])
        if data["company"]:
            made.companies.append(data["company"]["company_id"])
            made.emails.append(f"admin-{t}@example.com")
    assert r.status_code == 201, r.text
    data["email"], data["password"] = f"admin-{t}@example.com", PASSWORD
    return data


async def make_user(made: Made, company_id: str, *, role: str = "standard", **extra) -> str:
    email = f"acct-{tag()}@example.com"
    made.emails.append(email)
    await get_platform_db().users.insert_one({
        "name": "Seeded", "email": email, "role": role, "is_active": True, "company_id": company_id,
        "password_hash": _pwd.hash(PASSWORD), **extra,
    })
    return email


async def login(client, email: str, password: str = PASSWORD):
    return await client.post(f"{AUTH}/login", json={"email": email, "password": password})


async def overview(client, window: int = 30) -> dict:
    r = await client.get(f"{API}/overview?window={window}", headers=PLATFORM)
    assert r.status_code == 200, r.text
    return r.json()


def _routes_to_try():
    out = []
    for info in all_routes():
        if info.path.startswith(API):
            path = info.path.replace("{client_id}", "cli_x").replace("{company_id}", "cmp_x").replace("{email}", "x@example.com")
            out.append((sorted(info.methods)[0], path, bool(info.methods & MUTATING)))
    return out


async def test_every_platform_route_refuses_every_company_account(client, admin_headers, superadmin_headers, standard_headers):
    routes = _routes_to_try()
    assert len(routes) >= 19
    for method, path, mutating in routes:
        body = {} if mutating else None
        for who, headers in (("admin", admin_headers), ("superadmin", superadmin_headers), ("standard", standard_headers)):
            r = await client.request(method, path, headers=headers, json=body)
            assert r.status_code == 403, f"{method} {path} as {who}: {r.status_code} {r.text[:120]}"
            assert "Platform owner access required" in r.text
        r = await client.request(method, path, json=body)
        assert r.status_code == 401, f"{method} {path} with no token: {r.status_code}"


async def test_a_company_top_admin_is_still_not_a_platform_owner(client, made):
    data = await make_client(client, made)
    headers = jwt_headers(data["email"])
    assert (await client.get(f"{AUTH}/me", headers=headers)).status_code == 200
    assert (await client.get(f"{API}/overview", headers=headers)).status_code == 403
    assert (await client.post(f"{API}/clients", headers=headers, json={"name": "Nope"})).status_code == 403


async def test_overview_has_the_documented_shape(client):
    body = await overview(client)
    assert set(body) == {"window_days", "period", "totals", "features", "top_clients", "growth", "recent", "computed_at"}
    assert datetime.fromisoformat(body["computed_at"]).tzinfo is not None
    assert body["window_days"] == 30
    assert body["period"]["kind"] == "window" and set(body["period"]) == {"kind", "from", "to"}

    contract = {
        "clients", "companies", "active_companies", "suspended_companies", "users", "active_users",
        "jobs", "resumes", "candidates", "interviews", "coding", "offers", "performance", "emails",
        "ai_calls", "ai_cost_usd", "email_cost_usd", "total_cost_usd",
    }
    assert contract <= set(body["totals"])
    assert body["totals"]["active_companies"] + body["totals"]["suspended_companies"] == body["totals"]["companies"]

    assert [f["key"] for f in body["features"]] == FEATURE_KEYS == [
        "jobs", "resumes", "candidates", "interviews", "coding", "offers", "performance", "emails", "ai",
    ]
    for feature in body["features"]:
        assert set(feature) == {"key", "label", "total", "window", "top_client"}
        assert 0 <= feature["window"] <= feature["total"]
        top = feature["top_client"]
        assert top is None or (set(top) == {"client_id", "name", "count"} and top["count"] > 0)

    assert len(body["top_clients"]) <= 5
    for row in body["top_clients"]:
        assert set(row) == {
            "client_id", "name", "companies", "users", "active_users", "activity", "ai_cost_usd",
            "email_cost_usd", "total_cost_usd",
        }
        assert row["total_cost_usd"] == pytest.approx(row["ai_cost_usd"] + row["email_cost_usd"])
    activity = [r["activity"] for r in body["top_clients"]]
    assert activity == sorted(activity, reverse=True)

    growth = body["growth"]
    assert len(growth) == 12
    assert [g["month"] for g in growth] == sorted(g["month"] for g in growth)
    assert growth[-1]["month"] == datetime.now(timezone.utc).strftime("%Y-%m")
    assert all(set(g) == {"month", "clients", "companies"} for g in growth)
    assert [g["clients"] for g in growth] == sorted(g["clients"] for g in growth)
    assert growth[-1]["clients"] == body["totals"]["clients"]
    assert growth[-1]["companies"] == body["totals"]["companies"]

    assert len(body["recent"]) <= 10
    for row in body["recent"]:
        assert set(row) == {"at", "action", "actor_email", "resource_type", "resource_id", "details"}


@pytest.mark.parametrize("window", [7, 30, 90])
async def test_the_window_is_7_30_or_90(client, window):
    assert (await overview(client, window))["window_days"] == window
    assert (await client.get(f"{API}/usage?window={window}", headers=PLATFORM)).json()["window_days"] == window


@pytest.mark.parametrize("bad", ["0", "14", "-7", "365", "abc", ""])
async def test_any_other_window_is_a_422(client, bad):
    for path in ("/overview", "/usage", "/clients/cli_default", "/companies/cmp_default"):
        r = await client.get(f"{API}{path}?window={bad}", headers=PLATFORM)
        assert r.status_code == 422, f"{path}?window={bad!r}: {r.status_code}"


async def test_the_internal_platform_workspace_never_appears(client):
    clients = (await client.get(f"{API}/clients", headers=PLATFORM)).json()["clients"]
    companies = (await client.get(f"{API}/companies", headers=PLATFORM)).json()["companies"]
    usage = (await client.get(f"{API}/usage", headers=PLATFORM)).json()["rows"]
    assert PLATFORM_CLIENT_ID not in {c["client_id"] for c in clients}
    assert PLATFORM_COMPANY_ID not in {c["company_id"] for c in companies}
    assert PLATFORM_CLIENT_ID not in {r["client_id"] for r in usage}
    assert all(c["client_id"] != PLATFORM_CLIENT_ID for c in companies)

    body = await overview(client)
    assert body["totals"]["clients"] == len(clients)
    assert body["totals"]["companies"] == len(companies)
    assert PLATFORM_CLIENT_ID not in {t["client_id"] for t in body["top_clients"]}

    assert (await client.get(f"{API}/clients/{PLATFORM_CLIENT_ID}", headers=PLATFORM)).status_code == 404
    assert (await client.get(f"{API}/companies/{PLATFORM_COMPANY_ID}", headers=PLATFORM)).status_code == 404
    assert (await client.post(f"{API}/clients/{PLATFORM_CLIENT_ID}/suspend", headers=PLATFORM, json={})).status_code == 404
    assert (await client.post(f"{API}/companies/{PLATFORM_COMPANY_ID}/suspend", headers=PLATFORM, json={})).status_code == 404
    assert (await client.patch(f"{API}/companies/{PLATFORM_COMPANY_ID}", headers=PLATFORM, json={"name": "x"})).status_code == 404
    assert (await client.post(
        f"{API}/companies/{PLATFORM_COMPANY_ID}/admins", headers=PLATFORM,
        json={"name": "x", "email": f"x-{tag()}@example.com", "password": PASSWORD},
    )).status_code == 404
    assert (await client.post(
        f"{API}/clients/{PLATFORM_CLIENT_ID}/companies", headers=PLATFORM,
        json={"name": "x", "admin": {"name": "x", "email": f"x-{tag()}@example.com", "password": PASSWORD}},
    )).status_code == 404


async def test_growth_counts_a_new_client_in_the_current_month_only(client, made):
    before = (await overview(client))["growth"]
    await make_client(client, made)
    after = (await overview(client))["growth"]
    assert after[-1]["clients"] == before[-1]["clients"] + 1
    assert after[-1]["companies"] == before[-1]["companies"] + 1
    assert after[-2] == before[-2]


async def test_create_a_client_without_a_company(client, made):
    t = tag()
    r = await client.post(
        f"{API}/clients", headers=PLATFORM,
        json={
            "name": f"  Acme Widgets {t}  ", "contact_name": "Sam Contact", "contact_email": "Sam@Example.com",
            "notes": "Pilot customer", "plan": {"name": "pro", "max_companies": 3, "monthly_ai_budget_usd": 50},
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    made.clients.append(body["client"]["client_id"])
    assert body["company"] is None
    row = body["client"]
    assert row["client_id"].startswith("cli_") and len(row["client_id"]) == len("cli_") + 12
    assert row["name"] == f"Acme Widgets {t}"
    assert row["slug"] == f"acme-widgets-{t}"
    assert row["status"] == "active"
    assert row["plan"] == {
        "name": "pro", "max_companies": 3, "max_users_per_company": None, "monthly_ai_budget_usd": 50.0,
        "max_storage_mb": None, "features": {flag: True for flag in plan_service.FEATURES},
        "price_monthly_usd": None, "trial_ends_at": None,
    }
    assert row["subscription"]["status"] == "none" and row["storage_mb"] == 0 and row["storage_limit_mb"] is None
    assert (row["contact_name"], row["contact_email"], row["notes"]) == ("Sam Contact", "sam@example.com", "Pilot customer")
    assert row["companies"] == 0 and row["users"] == 0 and row["active_users"] == 0
    assert row["last_active_at"] is None and row["top_feature"] is None
    for key in ("jobs", "resumes", "candidates", "interviews", "coding", "offers", "performance", "emails", "ai_calls"):
        assert row[key] == 0
    assert row["ai_cost_usd"] == 0 and row["usage"] == {k: 0 for k in FEATURE_KEYS}

    stored = await get_platform_db().clients.find_one({"client_id": row["client_id"]})
    assert stored["kind"] == "workspace" and isinstance(stored["created_at"], str)

    listed = (await client.get(f"{API}/clients?search={t}", headers=PLATFORM)).json()["clients"]
    assert [c["client_id"] for c in listed] == [row["client_id"]]
    detail = (await client.get(f"{API}/clients/{row['client_id']}", headers=PLATFORM)).json()
    assert set(detail) == {"client", "companies", "features", "cost_by_source", "activity", "period", "computed_at"}
    assert detail["client"]["client_id"] == row["client_id"] and detail["companies"] == []
    assert len(detail["activity"]) == 30 and sum(d["count"] for d in detail["activity"]) == 0
    assert detail["cost_by_source"] == []


async def test_create_a_client_with_its_first_company_and_admin(client, made):
    data = await make_client(client, made)
    row, company = data["client"], data["company"]
    assert row["companies"] == 1 and row["users"] == 1
    assert company["company_id"].startswith("cmp_") and len(company["company_id"]) == len("cmp_") + 12
    assert company["client_id"] == row["client_id"] and company["client_name"] == row["name"]
    assert company["status"] == "active" and company["sso_domains"] == []
    assert company["admins"] == [{"email": data["email"], "name": "Ada Admin"}]
    assert company["users"] == 1 and company["jobs"] == 0 and company["last_active_at"] is None

    user = await get_platform_db().users.find_one({"email": data["email"]})
    assert user["company_id"] == company["company_id"]
    assert user["role"] == "superadmin" and user["is_active"] is True and user["otp_required"] is False
    assert isinstance(user["created_at"], str) and not user.get("is_platform_admin")
    assert user["password_hash"].startswith("$2") and PASSWORD not in user["password_hash"]
    assert user["email"] == user["email"].lower() == data["email"]

    r = await login(client, data["email"])
    assert r.status_code == 200, r.text
    signed_in = r.json()["user"]
    assert signed_in["company_id"] == company["company_id"] and signed_in["client_id"] == row["client_id"]
    assert signed_in["role"] == "superadmin" and signed_in["is_platform_admin"] is False
    assert (await client.get(f"{AUTH}/me", headers={"Authorization": f"Bearer {r.json()['access_token']}"})).status_code == 200

    after = (await client.get(f"{API}/companies/{company['company_id']}", headers=PLATFORM)).json()["company"]
    assert after["last_active_at"] is not None
    assert after["active_users"] == 1


async def test_a_password_shorter_than_eight_is_refused_and_nothing_is_left_behind(client, made):
    t = tag()
    r = await client.post(
        f"{API}/clients", headers=PLATFORM,
        json={"name": f"Short Pw {t}", "company": {"name": "Co", "admin": {"name": "A", "email": f"a-{t}@example.com", "password": "1234567"}}},
    )
    assert r.status_code == 422
    assert (await client.get(f"{API}/clients?search=Short Pw {t}", headers=PLATFORM)).json()["clients"] == []
    assert await get_platform_db().users.find_one({"email": f"a-{t}@example.com"}) is None


@pytest.mark.parametrize("body", [
    {"name": ""},
    {},
    {"name": "X", "contact_email": "not an email"},
    {"name": "X", "plan": {"max_companies": 0}},
    {"name": "X", "plan": {"monthly_ai_budget_usd": -1}},
    {"name": "X", "company": {"name": "Co", "admin": {"name": "A", "email": "bad", "password": "Password-123!"}}},
    {"name": "X", "slug": "!!!"},
])
async def test_a_bad_client_body_is_a_422(client, made, body):
    r = await client.post(f"{API}/clients", headers=PLATFORM, json=body)
    assert r.status_code == 422, r.text


async def test_update_a_client_and_its_plan(client, made):
    data = await make_client(client, made, company=False, plan={"max_companies": 1})
    cid = data["client"]["client_id"]
    r = await client.patch(
        f"{API}/clients/{cid}", headers=PLATFORM,
        json={"name": "Renamed Co", "contact_name": "Pat", "contact_email": "Pat@Example.com", "notes": "n", "plan": {"name": "enterprise"}},
    )
    assert r.status_code == 200, r.text
    row = r.json()["client"]
    assert (row["name"], row["contact_name"], row["contact_email"], row["notes"]) == ("Renamed Co", "Pat", "pat@example.com", "n")
    assert row["plan"]["name"] == "enterprise" and row["plan"]["max_companies"] == 1
    assert row["slug"] == data["client"]["slug"]

    assert (await client.patch(f"{API}/clients/{cid}", headers=PLATFORM, json={})).status_code == 422
    assert (await client.patch(f"{API}/clients/{cid}", headers=PLATFORM, json={"name": "  "})).status_code == 422
    assert (await client.patch(f"{API}/clients/cli_nope", headers=PLATFORM, json={"name": "x"})).status_code == 404


async def test_a_plan_limit_on_companies_is_enforced_until_the_plan_changes(client, made):
    data = await make_client(client, made, plan={"max_companies": 1})
    cid = data["client"]["client_id"]
    body = {"name": "Second Co", "admin": {"name": "B", "email": f"b-{tag()}@example.com", "password": PASSWORD}}
    refused = await client.post(f"{API}/clients/{cid}/companies", headers=PLATFORM, json=body)
    assert refused.status_code == 409 and "plan" in refused.json()["detail"]

    assert (await client.patch(f"{API}/clients/{cid}", headers=PLATFORM, json={"plan": {"max_companies": None}})).status_code == 200
    ok = await client.post(f"{API}/clients/{cid}/companies", headers=PLATFORM, json=body)
    assert ok.status_code == 201, ok.text
    made.companies.append(ok.json()["company"]["company_id"])
    made.emails.append(body["admin"]["email"])
    assert (await client.get(f"{API}/clients/{cid}", headers=PLATFORM)).json()["client"]["companies"] == 2


async def test_an_email_is_unique_across_the_whole_platform(client, made):
    first = await make_client(client, made)
    second = await make_client(client, made)
    taken = first["email"]
    names = [first["client"]["name"], first["company"]["name"], first["company"]["company_id"], first["client"]["client_id"]]

    def assert_discreet(r):
        assert r.status_code == 409, r.text
        assert "already registered" in r.json()["detail"]
        assert not any(n in r.text for n in names)

    t = tag()
    refused = await client.post(
        f"{API}/clients", headers=PLATFORM,
        json={"name": f"Dup {t}", "company": {"name": "Dup Co", "admin": {"name": "D", "email": taken.upper(), "password": PASSWORD}}},
    )
    assert_discreet(refused)
    assert (await client.get(f"{API}/clients?search=Dup {t}", headers=PLATFORM)).json()["clients"] == []

    other = second["client"]["client_id"]
    refused = await client.post(
        f"{API}/clients/{other}/companies", headers=PLATFORM,
        json={"name": "Dup Co 2", "admin": {"name": "D", "email": taken, "password": PASSWORD}},
    )
    assert_discreet(refused)
    assert (await client.get(f"{API}/clients/{other}", headers=PLATFORM)).json()["client"]["companies"] == 1

    assert_discreet(await client.post(
        f"{API}/companies/{second['company']['company_id']}/admins", headers=PLATFORM,
        json={"name": "D", "email": taken, "password": PASSWORD},
    ))
    assert_discreet(await client.post(f"{API}/owners", headers=PLATFORM, json={"name": "D", "email": taken, "password": PASSWORD}))

    existing = await make_user(made, DEFAULT_COMPANY_ID, role="admin")
    assert (await client.post(
        f"{API}/companies/{second['company']['company_id']}/admins", headers=PLATFORM,
        json={"name": "D", "email": existing, "password": PASSWORD},
    )).status_code == 409


async def test_slugs_are_unique_reserved_ones_are_refused_and_derived_ones_get_a_suffix(client, made):
    t = tag()

    async def create(body):
        r = await client.post(f"{API}/clients", headers=PLATFORM, json=body)
        if r.status_code == 201:
            made.clients.append(r.json()["client"]["client_id"])
        return r

    first = await create({"name": f"Slug A {t}", "slug": f"Slug {t}"})
    assert first.status_code == 201 and first.json()["client"]["slug"] == f"slug-{t}"
    for slug in (f"slug-{t}", f"SLUG {t}", "platform", "Default"):
        r = await create({"name": f"Slug B {tag()}", "slug": slug})
        assert r.status_code == 409, (slug, r.text)
        assert "slug" in r.json()["detail"].lower()

    twin = f"Twin {t}"
    a, b, c = await create({"name": twin}), await create({"name": twin}), await create({"name": twin})
    assert [x.json()["client"]["slug"] for x in (a, b, c)] == [f"twin-{t}", f"twin-{t}-2", f"twin-{t}-3"]
    for name, reserved in (("Platform", "platform"), ("Default", "default")):
        r = await create({"name": name})
        assert r.status_code == 201
        slug = r.json()["client"]["slug"]
        assert slug != reserved and slug.startswith(f"{reserved}-")


async def test_company_slugs_are_unique_across_all_clients(client, made):
    t = tag()
    one = await make_client(client, made, company=False)
    two = await make_client(client, made, company=False)

    async def add(client_id, **extra):
        admin = {"name": "A", "email": f"s-{tag()}@example.com", "password": PASSWORD}
        r = await client.post(f"{API}/clients/{client_id}/companies", headers=PLATFORM, json={"admin": admin, **extra})
        if r.status_code == 201:
            made.companies.append(r.json()["company"]["company_id"])
            made.emails.append(admin["email"])
        return r, admin["email"]

    r1, _ = await add(one["client"]["client_id"], name=f"Branch {t}")
    r2, _ = await add(two["client"]["client_id"], name=f"Branch {t}")
    assert r1.status_code == r2.status_code == 201
    assert r1.json()["company"]["slug"] == f"branch-{t}" and r2.json()["company"]["slug"] == f"branch-{t}-2"

    refused, email = await add(two["client"]["client_id"], name="Another", slug=f"branch-{t}")
    assert refused.status_code == 409
    assert (await client.get(f"{API}/companies?client_id={two['client']['client_id']}", headers=PLATFORM)).json()["companies"][0]["slug"] == f"branch-{t}-2"
    assert await get_platform_db().users.find_one({"email": email}) is None
    for slug in ("platform", "default"):
        r, _ = await add(two["client"]["client_id"], name="Reserved", slug=slug)
        assert r.status_code == 409


async def test_suspending_a_client_locks_its_people_out_and_activating_restores_them(client, made):
    data = await make_client(client, made)
    cid, company_id, email = data["client"]["client_id"], data["company"]["company_id"], data["email"]
    headers = jwt_headers(email)
    raw = get_platform_db()
    assert (await client.get(f"{AUTH}/me", headers=headers)).status_code == 200
    before = (await overview(client))["totals"]

    r = await client.post(f"{API}/clients/{cid}/suspend", headers=PLATFORM, json={"reason": "Invoice unpaid"})
    assert r.status_code == 200, r.text
    assert r.json()["client"]["status"] == "suspended" and r.json()["client"]["suspended_reason"] == "Invoice unpaid"
    stored = await raw.clients.find_one({"client_id": cid})
    assert stored["status"] == "suspended" and isinstance(stored["suspended_at"], str)

    blocked = await client.get(f"{AUTH}/me", headers=headers)
    assert blocked.status_code == 403 and "suspended" in blocked.text.lower()
    refused = await login(client, email)
    assert refused.status_code == 403 and "suspended" in refused.text.lower()
    assert (await login(client, email, "wrong-password-1")).status_code == 401

    row = (await client.get(f"{API}/companies?client_id={cid}", headers=PLATFORM)).json()["companies"][0]
    assert row["status"] == "active" and row["client_status"] == "suspended"
    after = (await overview(client))["totals"]
    assert after["suspended_companies"] == before["suspended_companies"] + 1
    assert after["active_companies"] == before["active_companies"] - 1
    assert after["companies"] == before["companies"]
    suspended = (await client.get(f"{API}/clients?status=suspended", headers=PLATFORM)).json()["clients"]
    assert cid in {c["client_id"] for c in suspended}
    assert cid not in {c["client_id"] for c in (await client.get(f"{API}/clients?status=active", headers=PLATFORM)).json()["clients"]}

    again = await client.post(f"{API}/clients/{cid}/suspend", headers=PLATFORM, json={"reason": "Another"})
    assert again.status_code == 200 and again.json()["client"]["suspended_reason"] == "Invoice unpaid"

    r = await client.post(f"{API}/clients/{cid}/activate", headers=PLATFORM)
    assert r.status_code == 200 and r.json()["client"]["status"] == "active"
    stored = await raw.clients.find_one({"client_id": cid})
    assert stored["status"] == "active" and "suspended_at" not in stored and "suspended_reason" not in stored
    assert (await client.get(f"{AUTH}/me", headers=headers)).status_code == 200
    assert (await login(client, email)).status_code == 200
    restored = (await overview(client))["totals"]
    assert restored["suspended_companies"] == before["suspended_companies"]

    r = await client.post(f"{API}/companies/{company_id}/suspend", headers=PLATFORM)
    assert r.status_code == 200 and r.json()["company"]["status"] == "suspended"
    assert (await client.get(f"{AUTH}/me", headers=headers)).status_code == 403
    assert (await login(client, email)).status_code == 403
    assert (await raw.clients.find_one({"client_id": cid}))["status"] == "active"
    listed = (await client.get(f"{API}/companies?status=suspended", headers=PLATFORM)).json()["companies"]
    assert company_id in {c["company_id"] for c in listed}
    r = await client.post(f"{API}/companies/{company_id}/activate", headers=PLATFORM)
    assert r.status_code == 200 and r.json()["company"]["status"] == "active"
    assert (await client.get(f"{AUTH}/me", headers=headers)).status_code == 200
    stored = await raw.companies.find_one({"company_id": company_id})
    assert "suspended_at" not in stored


async def test_suspending_unknown_things_is_a_404(client):
    for path in ("/clients/cli_nope/suspend", "/clients/cli_nope/activate", "/companies/cmp_nope/suspend", "/companies/cmp_nope/activate"):
        assert (await client.post(f"{API}{path}", headers=PLATFORM, json={})).status_code == 404, path
    assert (await client.get(f"{API}/clients/cli_nope", headers=PLATFORM)).status_code == 404
    assert (await client.get(f"{API}/companies/cmp_nope", headers=PLATFORM)).status_code == 404


async def test_a_sso_domain_can_be_claimed_by_one_company_only(client, made):
    a = await make_client(client, made)
    b = await make_client(client, made)
    ca, cb = a["company"]["company_id"], b["company"]["company_id"]
    t = tag()
    domain, other = f"d{t}.example.org", f"e{t}.example.org"

    r = await client.patch(f"{API}/companies/{ca}", headers=PLATFORM, json={"sso_domains": [f" @{domain.upper()} ", domain]})
    assert r.status_code == 200, r.text
    assert r.json()["company"]["sso_domains"] == [domain]

    clash = await client.patch(f"{API}/companies/{cb}", headers=PLATFORM, json={"sso_domains": [other, domain]})
    assert clash.status_code == 409
    for secret in (ca, a["company"]["name"], a["client"]["name"], a["company"]["slug"]):
        assert secret not in clash.text
    assert (await get_platform_db().companies.find_one({"company_id": cb}))["sso_domains"] == []

    assert (await client.patch(f"{API}/companies/{ca}", headers=PLATFORM, json={"sso_domains": [domain]})).status_code == 200
    assert (await client.patch(f"{API}/companies/{cb}", headers=PLATFORM, json={"sso_domains": [other]})).status_code == 200
    assert (await client.patch(f"{API}/companies/{ca}", headers=PLATFORM, json={"sso_domains": [other]})).status_code == 409
    assert (await client.patch(f"{API}/companies/{ca}", headers=PLATFORM, json={"sso_domains": ["not a domain"]})).status_code == 422

    assert (await client.patch(f"{API}/companies/{ca}", headers=PLATFORM, json={"sso_domains": []})).json()["company"]["sso_domains"] == []
    assert (await client.patch(f"{API}/companies/{cb}", headers=PLATFORM, json={"sso_domains": [domain]})).status_code == 200


async def test_rename_a_company(client, made):
    data = await make_client(client, made)
    cid = data["company"]["company_id"]
    r = await client.patch(f"{API}/companies/{cid}", headers=PLATFORM, json={"name": "  Brand New Name "})
    assert r.status_code == 200 and r.json()["company"]["name"] == "Brand New Name"
    assert r.json()["company"]["slug"] == data["company"]["slug"]
    assert (await client.patch(f"{API}/companies/{cid}", headers=PLATFORM, json={})).status_code == 422
    assert (await client.patch(f"{API}/companies/{cid}", headers=PLATFORM, json={"name": ""})).status_code == 422
    assert (await client.patch(f"{API}/companies/cmp_nope", headers=PLATFORM, json={"name": "x"})).status_code == 404


async def test_add_an_admin_and_reset_its_password(client, made):
    data = await make_client(client, made)
    cid = data["company"]["company_id"]
    t = tag()
    email = f"second-{t}@example.com"
    made.emails.append(email)

    r = await client.post(f"{API}/companies/{cid}/admins", headers=PLATFORM, json={"name": "Second Admin", "email": email.upper(), "password": PASSWORD})
    assert r.status_code == 201, r.text
    assert r.json() == {"admin": {"email": email, "name": "Second Admin"}}
    stored = await get_platform_db().users.find_one({"email": email})
    assert stored["role"] == "superadmin" and stored["company_id"] == cid and stored["is_active"] is True
    assert stored["otp_required"] is False and isinstance(stored["created_at"], str)

    company = (await client.get(f"{API}/companies/{cid}", headers=PLATFORM)).json()["company"]
    assert company["admins"] == [
        {"email": data["email"], "name": "Ada Admin"},
        {"email": email, "name": "Second Admin"},
    ]
    assert all(set(a) == {"email", "name"} for a in company["admins"])
    assert company["users"] == 2

    for bad in ({"name": "N", "email": email, "password": "short"}, {"name": "", "email": email, "password": PASSWORD},
                {"name": "N", "email": "nope", "password": PASSWORD}):
        assert (await client.post(f"{API}/companies/{cid}/admins", headers=PLATFORM, json=bad)).status_code == 422
    assert (await client.post(f"{API}/companies/cmp_nope/admins", headers=PLATFORM, json={"name": "N", "email": f"n-{t}@example.com", "password": PASSWORD})).status_code == 404

    assert (await login(client, email)).status_code == 200

    raw = get_platform_db()
    await raw.users.update_one({"email": email}, {"$set": {"failed_login_attempts": 5, "locked_until": "2999-01-01T00:00:00+00:00"}})
    url = f"{API}/companies/{cid}/admins/{email}/reset-password"
    assert (await client.post(url, headers=PLATFORM, json={"new_password": "short"})).status_code == 422
    done = await client.post(url, headers=PLATFORM, json={"new_password": "Brand-New-Pass-9"})
    assert done.status_code == 200, done.text
    stored = await raw.users.find_one({"email": email})
    assert "locked_until" not in stored and stored["failed_login_attempts"] == 0
    assert (await login(client, email, PASSWORD)).status_code == 401
    assert (await login(client, email, "Brand-New-Pass-9")).status_code == 200

    other = await make_client(client, made)
    standard = f"std-{t}@example.com"
    made.emails.append(standard)
    with company_context(cid):
        await get_db().users.insert_one({"name": "Std", "email": standard, "role": "standard", "is_active": True, "password_hash": _pwd.hash(PASSWORD)})
    for target in (other["email"], standard, f"nobody-{t}@example.com"):
        r = await client.post(f"{API}/companies/{cid}/admins/{target}/reset-password", headers=PLATFORM, json={"new_password": PASSWORD})
        assert r.status_code == 404, (target, r.status_code)
    assert (await client.post(f"{API}/companies/cmp_nope/admins/{email}/reset-password", headers=PLATFORM, json={"new_password": PASSWORD})).status_code == 404
    assert (await login(client, other["email"])).status_code == 200

    owner_email = f"owner-in-co-{t}@example.com"
    made.emails.append(owner_email)
    await raw.users.insert_one({
        "name": "Owner", "email": owner_email, "role": "superadmin", "is_active": True, "company_id": cid,
        "is_platform_admin": True, "password_hash": _pwd.hash(PASSWORD),
    })
    r = await client.post(f"{API}/companies/{cid}/admins/{owner_email}/reset-password", headers=PLATFORM, json={"new_password": "Another-Pass-1"})
    assert r.status_code == 403
    listed = (await client.get(f"{API}/companies/{cid}", headers=PLATFORM)).json()["company"]["admins"]
    assert owner_email not in {a["email"] for a in listed}


async def test_every_write_is_audited_and_no_password_is_recorded(client, made):
    data = await make_client(client, made)
    cid, company_id = data["client"]["client_id"], data["company"]["company_id"]
    new_pw = "Audit-Pass-12345"
    email = f"aud-{tag()}@example.com"
    made.emails.append(email)
    steps = [
        ("client_update", await client.patch(f"{API}/clients/{cid}", headers=PLATFORM, json={"notes": "x"})),
        ("client_suspend", await client.post(f"{API}/clients/{cid}/suspend", headers=PLATFORM, json={"reason": "r"})),
        ("client_activate", await client.post(f"{API}/clients/{cid}/activate", headers=PLATFORM)),
        ("company_update", await client.patch(f"{API}/companies/{company_id}", headers=PLATFORM, json={"name": "Aud"})),
        ("company_suspend", await client.post(f"{API}/companies/{company_id}/suspend", headers=PLATFORM)),
        ("company_activate", await client.post(f"{API}/companies/{company_id}/activate", headers=PLATFORM)),
        ("company_admin_create", await client.post(f"{API}/companies/{company_id}/admins", headers=PLATFORM, json={"name": "A", "email": email, "password": new_pw})),
        ("company_admin_password_reset", await client.post(f"{API}/companies/{company_id}/admins/{email}/reset-password", headers=PLATFORM, json={"new_password": new_pw + "x"})),
    ]
    for action, resp in steps:
        assert resp.status_code in (200, 201), (action, resp.text)

    raw = get_platform_db()
    rows = [r async for r in raw.audit_log.find({"company_id": PLATFORM_COMPANY_ID, "actor_email": DEMO_OWNER})]
    seen = {(r["action"], r["resource_id"]) for r in rows}
    for action, _ in steps:
        assert any(a == action for a, _ in seen), f"{action} was not audited"
    assert ("client_create", cid) in seen and ("company_create", company_id) in seen
    assert all(r["actor_role"] == "platform_owner" for r in rows)
    dump = repr(rows)
    assert PASSWORD not in dump and new_pw not in dump and "password_hash" not in dump

    with company_context(company_id):
        own = await get_db().audit_log.find({}, {"_id": 0}).to_list(50)
    assert {r["action"] for r in own} == {
        "company_suspend", "company_activate", "company_admin_create", "company_admin_password_reset",
    }
    assert all(r["actor_role"] == "platform_owner" for r in own)
    assert PASSWORD not in repr(own) and new_pw not in repr(own) and "password_hash" not in repr(own)

    recent = (await overview(client))["recent"]
    assert recent and recent[0]["actor_email"] == DEMO_OWNER and recent[0]["action"] == "company_admin_password_reset"
    assert [r["at"] for r in recent] == sorted((r["at"] for r in recent), reverse=True)


async def _seed_a(company_id: str, t: str, made: Made) -> None:
    with company_context(company_id):
        db = get_db()
        await db.jobs.insert_many([
            {"doc_type": "job", "job_id": f"job-{t}-{i}", "title": "T", "description": "d", "candidate_pipeline": [], "created_at": when}
            for i, when in enumerate([ago(), ago(), ago(), ago(10), ago(60)])
        ])
        await db.resumes.insert_many([
            {"resume_id": f"res-{t}-{i}", "filename": "cv.pdf", "processing_status": status, "created_at": when,
             "candidate_name": "MARK-CANDIDATE-NAME", "text": "MARK-RESUME-TEXT"}
            for i, (status, when) in enumerate([("processed", ago()), ("processed", ago()), ("pending", ago()), ("processed", ago(10))])
        ])
        sensitive = {"name": "MARK-CANDIDATE-NAME", "report": {"summary": "MARK-REPORT-SUMMARY"}, "transcript": [{"answer": "MARK-TRANSCRIPT"}]}
        await db.candidates.insert_many([
            {"candidate_id": f"cand-{t}-1", "email": f"mark-cand-{t}-1@example.com", "status": "invited", "created_at": ago(), **sensitive},
            {"candidate_id": f"cand-{t}-2", "email": f"mark-cand-{t}-2@example.com", "status": "completed", "created_at": ago(),
             "interview_ended_at": ago(), **sensitive},
            {"candidate_id": f"cand-{t}-3", "email": f"mark-cand-{t}-3@example.com", "status": "hired", "created_at": ago(),
             "interview_ended_at": ago(10), **sensitive},
            {"candidate_id": f"cand-{t}-4", "email": f"mark-cand-{t}-4@example.com", "status": "completed", "created_at": ago(),
             "interview_mode": "external", "interview_ended_at": ago(), **sensitive},
            {"candidate_id": f"cand-{t}-5", "email": f"mark-cand-{t}-5@example.com", "status": "completed", "created_at": ago(60),
             "interview_ended_at": ago(60), **sensitive},
        ])
        await db.coding_submissions.insert_many([
            {"submission_id": f"sub-{t}-{i}", "candidate_id": f"cand-{t}-2", "status": "completed", "code": "MARK-CODE", "submitted_at": when}
            for i, when in enumerate([ago(), ago(), ago(60)])
        ])
        await db.offers.insert_one({"offer_id": f"off-{t}", "candidate_id": f"cand-{t}-2", "status": "draft", "salary": "MARK-SALARY", "created_at": ago()})
        await db.performance_reviews.insert_many([
            {"review_id": f"rev-{t}-{i}", "status": "pending", "comments": "MARK-REVIEW-COMMENT", "created_at": ago()} for i in range(2)
        ])
        await db.email_log.insert_many([
            {"to": "mark-to@example.com", "subject": "MARK-SUBJECT", "status": status, "created_at": when}
            for status, when in [("sent", ago()), ("sent", ago()), ("sent", ago(2)), ("failed", ago()), ("sent", ago(60))]
        ])
        await db.cost_ledger.insert_many([
            {"source": f"src-a-{t}", "cost_usd": 0.25, "llm_calls": 5, "created_at": ago()},
            {"source": f"src-a-{t}", "cost_usd": 0.5, "llm_calls": 3, "created_at": ago(10)},
            {"source": f"voice-{t}", "cost_type": "tts", "cost_usd": 0.01, "created_at": ago()},
            {"source": f"src-a-{t}", "cost_usd": 1.0, "llm_calls": 4, "created_at": ago(200)},
        ])
        users = [
            ("login-now", True, datetime.now(timezone.utc)),
            ("login-60d", True, datetime.now(timezone.utc) - timedelta(days=60)),
            ("deactivated", False, datetime.now(timezone.utc)),
        ]
        for name, active, when in users:
            email = f"u-{name}-{t}@example.com"
            made.emails.append(email)
            await db.users.insert_one({"name": name, "email": email, "role": "standard", "is_active": active, "last_login_at": when})


async def _seed_b(company_id: str, t: str, made: Made) -> None:
    with company_context(company_id):
        db = get_db()
        await db.jobs.insert_one({"doc_type": "job", "job_id": f"job-b-{t}", "title": "T", "description": "d", "candidate_pipeline": [], "created_at": ago()})
        await db.resumes.insert_one({"resume_id": f"res-b-{t}", "processing_status": "processed", "created_at": ago(), "text": "MARK-RESUME-TEXT"})
        await db.candidates.insert_one({"candidate_id": f"cand-b-{t}", "email": f"mark-cand-b-{t}@example.com", "status": "invited", "created_at": ago()})
        await db.cost_ledger.insert_one({"source": f"src-b-{t}", "cost_usd": 0.1, "llm_calls": 2, "created_at": ago()})
        email = f"u-b-{t}@example.com"
        made.emails.append(email)
        await db.users.insert_one({"name": "b", "email": email, "role": "standard", "is_active": True, "last_login_at": datetime.now(timezone.utc)})


A_WINDOW_30 = {"jobs": 4, "resumes": 3, "candidates": 4, "interviews": 2, "coding": 2, "offers": 1, "performance": 2, "emails": 3, "ai": 8}
A_TOTAL = {"jobs": 5, "resumes": 3, "candidates": 5, "interviews": 3, "coding": 3, "offers": 1, "performance": 2, "emails": 4, "ai": 12}
A_WINDOW_7 = {"jobs": 3, "resumes": 2, "candidates": 4, "interviews": 1, "coding": 2, "offers": 1, "performance": 2, "emails": 3, "ai": 5}
A_WINDOW_90 = {"jobs": 5, "resumes": 3, "candidates": 5, "interviews": 3, "coding": 3, "offers": 1, "performance": 2, "emails": 4, "ai": 8}


def _by_key(features: list[dict]) -> dict:
    return {f["key"]: f for f in features}


async def test_the_numbers_equal_what_was_inserted_for_each_company(client, made):
    base = await overview(client)
    a = await make_client(client, made)
    b = await make_client(client, made)
    ca, cb = a["company"]["company_id"], b["company"]["company_id"]
    t = tag()
    await _seed_a(ca, t, made)
    await _seed_b(cb, t, made)
    with company_context(PLATFORM_COMPANY_ID):
        await get_db().jobs.insert_many([
            {"doc_type": "job", "job_id": f"job-plat-{t}-{i}", "title": "T", "description": "d", "created_at": ago()} for i in range(2)
        ])
    try:
        r30 = await client.get(f"{API}/companies/{ca}", headers=PLATFORM)
        detail = r30.json()
        row = detail["company"]
        assert {k: row[k] for k in ("jobs", "resumes", "candidates", "interviews", "coding", "offers", "performance", "emails", "ai_calls")} == {
            **{k: v for k, v in A_TOTAL.items() if k != "ai"}, "ai_calls": 12,
        }
        assert row["ai_cost_usd"] == pytest.approx(1.76)
        assert row["email_cost_usd"] == pytest.approx(A_TOTAL["emails"] * settings.EMAIL_ESTIMATED_COST_PER_EMAIL)
        assert row["total_cost_usd"] == pytest.approx(row["ai_cost_usd"] + row["email_cost_usd"])
        assert (row["users"], row["active_users"]) == (3, 1)
        assert row["usage"] == A_WINDOW_30
        features = _by_key(detail["features"])
        for key in FEATURE_KEYS:
            assert (features[key]["total"], features[key]["window"]) == (A_TOTAL[key], A_WINDOW_30[key]), key
        assert row["last_active_at"] is not None and row["admins"] == [{"email": a["email"], "name": "Ada Admin"}]

        for window, expected in ((7, A_WINDOW_7), (90, A_WINDOW_90)):
            d = (await client.get(f"{API}/companies/{ca}?window={window}", headers=PLATFORM)).json()
            assert {f["key"]: f["window"] for f in d["features"]} == expected, window
            assert len(d["activity"]) == window
            assert sum(day["count"] for day in d["activity"]) == sum(expected.values()), window
            assert d["company"]["active_users"] == (1 if window < 90 else 2), window

        series = detail["activity"]
        assert len(series) == 30 and series[-1]["date"] == datetime.now(timezone.utc).date().isoformat()
        assert [d["date"] for d in series] == sorted(d["date"] for d in series)
        assert sum(d["count"] for d in series) == sum(A_WINDOW_30.values())

        by_source = {s["source"]: s for s in detail["cost_by_source"]}
        assert by_source[f"src-a-{t}"] == {"source": f"src-a-{t}", "cost_usd": pytest.approx(1.75), "calls": 12}
        assert by_source[f"voice-{t}"]["cost_usd"] == pytest.approx(0.01) and by_source[f"voice-{t}"]["calls"] == 1
        assert sum(s["cost_usd"] for s in detail["cost_by_source"]) == pytest.approx(row["total_cost_usd"])
        email_line = by_source["email_estimated"]
        assert (email_line["calls"], email_line["unit"]) == (A_TOTAL["emails"], "emails")
        assert email_line["cost_usd"] == pytest.approx(row["email_cost_usd"])
        assert [s["cost_usd"] for s in detail["cost_by_source"]] == sorted((s["cost_usd"] for s in detail["cost_by_source"]), reverse=True)

        rb = (await client.get(f"{API}/companies/{cb}", headers=PLATFORM)).json()["company"]
        assert (rb["jobs"], rb["resumes"], rb["candidates"], rb["interviews"], rb["coding"], rb["ai_calls"]) == (1, 1, 1, 0, 0, 2)
        assert rb["ai_cost_usd"] == pytest.approx(0.1) and (rb["users"], rb["active_users"]) == (2, 1)
        assert rb["jobs"] != row["jobs"] and rb["ai_calls"] != row["ai_calls"]

        clients = {c["client_id"]: c for c in (await client.get(f"{API}/clients", headers=PLATFORM)).json()["clients"]}
        ra, rcb = clients[a["client"]["client_id"]], clients[b["client"]["client_id"]]
        assert (ra["companies"], ra["users"], ra["active_users"], ra["jobs"], ra["interviews"], ra["ai_calls"]) == (1, 3, 1, 5, 3, 12)
        assert ra["ai_cost_usd"] == pytest.approx(1.76) and ra["usage"] == A_WINDOW_30
        assert ra["top_feature"] == {"key": "jobs", "label": "Jobs", "count": 4}
        assert (rcb["jobs"], rcb["ai_calls"], rcb["users"]) == (1, 2, 2)
        assert ra["last_active_at"] is not None
        client_detail = (await client.get(f"{API}/clients/{a['client']['client_id']}", headers=PLATFORM)).json()
        assert client_detail["client"]["jobs"] == 5 and [c["company_id"] for c in client_detail["companies"]] == [ca]
        assert {f["key"]: f["total"] for f in client_detail["features"]} == A_TOTAL
        assert sum(d["count"] for d in client_detail["activity"]) == sum(A_WINDOW_30.values())

        matrix = (await client.get(f"{API}/usage", headers=PLATFORM)).json()
        assert matrix["window_days"] == 30
        assert matrix["features"] == [{"key": k, "label": next(f["label"] for f in detail["features"] if f["key"] == k)} for k in FEATURE_KEYS]
        rows = {r["client_id"]: r for r in matrix["rows"]}
        assert rows[a["client"]["client_id"]]["counts"] == A_WINDOW_30
        assert rows[a["client"]["client_id"]]["top_feature"] == "jobs"
        assert rows[b["client"]["client_id"]]["counts"] == {**{k: 0 for k in FEATURE_KEYS}, "jobs": 1, "resumes": 1, "candidates": 1, "ai": 2}
        assert all(set(r) == {"client_id", "name", "status", "counts", "top_feature"} for r in matrix["rows"])
        assert set(rows) == set(clients)
        week = {r["client_id"]: r for r in (await client.get(f"{API}/usage?window=7", headers=PLATFORM)).json()["rows"]}
        assert week[a["client"]["client_id"]]["counts"] == A_WINDOW_7

        after = await overview(client)
        t0, t1 = base["totals"], after["totals"]
        assert t1["clients"] == t0["clients"] + 2 and t1["companies"] == t0["companies"] + 2
        assert t1["active_companies"] == t0["active_companies"] + 2
        for key, add in (("jobs", 6), ("resumes", 4), ("candidates", 6), ("interviews", 3), ("coding", 3), ("offers", 1), ("performance", 2)):
            assert t1[key] == t0[key] + add, key
        assert t1["emails"] >= t0["emails"] + 4 and t1["ai_calls"] >= t0["ai_calls"] + 14
        assert t1["users"] >= t0["users"] + 5 and t1["ai_cost_usd"] >= t0["ai_cost_usd"] + 1.86 - 1e-6
        f0, f1 = _by_key(base["features"]), _by_key(after["features"])
        assert f1["jobs"]["window"] == f0["jobs"]["window"] + 5 and f1["jobs"]["total"] == f0["jobs"]["total"] + 6
        assert f1["interviews"]["window"] == f0["interviews"]["window"] + 2

        for feature in after["features"]:
            best = max(c["usage"][feature["key"]] for c in clients.values())
            if best:
                assert feature["top_client"]["count"] == best
                assert clients[feature["top_client"]["client_id"]]["usage"][feature["key"]] == best
            else:
                assert feature["top_client"] is None

        every = [r30, await client.get(f"{API}/overview", headers=PLATFORM), await client.get(f"{API}/clients", headers=PLATFORM),
                 await client.get(f"{API}/companies", headers=PLATFORM), await client.get(f"{API}/usage", headers=PLATFORM),
                 await client.get(f"{API}/clients/{a['client']['client_id']}", headers=PLATFORM)]
        assert_no_secrets(*every)
    finally:
        raw = get_platform_db()
        await raw.jobs.delete_many({"company_id": PLATFORM_COMPANY_ID, "job_id": {"$regex": f"^job-plat-{t}"}})


async def test_lists_filter_by_client_search_and_status(client, made):
    a = await make_client(client, made)
    b = await make_client(client, made)
    only_a = (await client.get(f"{API}/companies?client_id={a['client']['client_id']}", headers=PLATFORM)).json()["companies"]
    assert [c["company_id"] for c in only_a] == [a["company"]["company_id"]]
    assert only_a[0]["client_name"] == a["client"]["name"]
    by_name = (await client.get(f"{API}/companies?search={b['company']['name']}", headers=PLATFORM)).json()["companies"]
    assert [c["company_id"] for c in by_name] == [b["company"]["company_id"]]
    by_client_name = (await client.get(f"{API}/companies?search={a['client']['name'].upper()}", headers=PLATFORM)).json()["companies"]
    assert a["company"]["company_id"] in {c["company_id"] for c in by_client_name}
    by_contact = await client.post(f"{API}/clients", headers=PLATFORM, json={"name": f"Contactable {tag()}", "contact_email": f"who-{a['company']['slug']}@example.com"})
    made.clients.append(by_contact.json()["client"]["client_id"])
    found = (await client.get(f"{API}/clients?search=who-{a['company']['slug']}", headers=PLATFORM)).json()["clients"]
    assert [c["client_id"] for c in found] == [by_contact.json()["client"]["client_id"]]
    assert (await client.get(f"{API}/clients?status=bogus", headers=PLATFORM)).status_code == 422
    assert (await client.get(f"{API}/companies?status=bogus", headers=PLATFORM)).status_code == 422
    nobody = (await client.get(f"{API}/companies?client_id=cli_nope", headers=PLATFORM)).json()
    assert nobody["companies"] == [] and set(nobody) == {"companies", "computed_at"}
    listed = {c["client_id"] for c in (await client.get(f"{API}/clients", headers=PLATFORM)).json()["clients"]}
    assert {a["client"]["client_id"], b["client"]["client_id"]} <= listed


async def test_owners_can_be_created_listed_deactivated_and_reactivated(client, made, monkeypatch):
    t = tag()
    email = f"owner-{t}@example.com"
    made.emails.append(email)

    r = await client.post(f"{API}/owners", headers=PLATFORM, json={"name": "New Owner", "email": email.upper(), "password": PASSWORD})
    assert r.status_code == 201, r.text
    owner = r.json()["owner"]
    assert owner == {
        "email": email, "name": "New Owner", "is_active": True, "last_login_at": None,
        "company_name": "Platform Operations", "otp_required": True,
    }
    stored = await get_platform_db().users.find_one({"email": email})
    assert stored["company_id"] == PLATFORM_COMPANY_ID and stored["is_platform_admin"] is True and stored["role"] == "superadmin"
    assert stored["password_hash"].startswith("$2")
    assert stored["otp_required"] is True and stored["otp_enforced"] is True
    assert_no_secrets(r)

    listed = (await client.get(f"{API}/owners", headers=PLATFORM))
    assert_no_secrets(listed)
    rows = {o["email"]: o for o in listed.json()["owners"]}
    assert rows[email]["is_active"] is True
    assert all(set(o) == {"email", "name", "is_active", "last_login_at", "company_name", "otp_required"} for o in rows.values())
    assert [o["email"] for o in listed.json()["owners"]] == sorted(rows)

    assert (await client.post(f"{API}/owners", headers=PLATFORM, json={"name": "N", "email": email, "password": PASSWORD})).status_code == 409
    for bad in ({"name": "N", "email": f"x-{t}@example.com", "password": "short"}, {"name": "N", "email": "nope", "password": PASSWORD},
                {"name": "", "email": f"x-{t}@example.com", "password": PASSWORD}):
        assert (await client.post(f"{API}/owners", headers=PLATFORM, json=bad)).status_code == 422

    monkeypatch.setattr(auth_routes, "_otp", lambda: "135790")
    monkeypatch.setattr(auth_routes, "_send_otp", AsyncMock(return_value=True))
    step = await login(client, email)
    assert step.status_code == 200 and step.json()["otp_required"] is True and "access_token" not in step.json()
    signed_in = await client.post(f"{AUTH}/verify-otp", json={"email": email, "otp_code": "135790"})
    assert signed_in.status_code == 200, signed_in.text
    assert signed_in.json()["user"]["is_platform_admin"] is True
    assert signed_in.json()["user"]["workspace_kind"] == "platform"
    mine = {"Authorization": f"Bearer {signed_in.json()['access_token']}"}
    assert (await client.get(f"{API}/overview", headers=mine)).status_code == 200
    assert {o["email"]: o for o in (await client.get(f"{API}/owners", headers=PLATFORM)).json()["owners"]}[email]["last_login_at"] is not None

    own = await client.patch(f"{API}/owners/{email}", headers=mine, json={"is_active": False})
    assert own.status_code == 409 and "own account" in own.json()["detail"]
    assert (await get_platform_db().users.find_one({"email": email}))["is_active"] is True

    off = await client.patch(f"{API}/owners/{email}", headers=PLATFORM, json={"is_active": False})
    assert off.status_code == 200 and off.json()["owner"]["is_active"] is False
    assert (await client.get(f"{API}/overview", headers=mine)).status_code == 401
    assert (await login(client, email)).status_code == 403
    on = await client.patch(f"{API}/owners/{email}", headers=PLATFORM, json={"is_active": True})
    assert on.status_code == 200 and on.json()["owner"]["is_active"] is True
    assert (await client.get(f"{API}/overview", headers=mine)).status_code == 200

    plain = await make_user(made, DEFAULT_COMPANY_ID, role="superadmin")
    assert (await client.patch(f"{API}/owners/{plain}", headers=PLATFORM, json={"is_active": False})).status_code == 404
    assert (await get_platform_db().users.find_one({"email": plain}))["is_active"] is True
    assert (await client.patch(f"{API}/owners/nobody-{t}@example.com", headers=PLATFORM, json={"is_active": False})).status_code == 404
    assert (await client.patch(f"{API}/owners/{email}", headers=PLATFORM, json={})).status_code == 422


async def test_the_last_active_owner_cannot_be_deactivated(client, made):
    t = tag()
    email = f"only-{t}@example.com"
    made.emails.append(email)
    assert (await client.post(f"{API}/owners", headers=PLATFORM, json={"name": "Only", "email": email, "password": PASSWORD})).status_code == 201
    raw = get_platform_db()
    others = [u["email"] async for u in raw.users.find(
        {"is_platform_admin": True, "email": {"$ne": email}, "is_active": {"$ne": False}}, {"email": 1},
    )]
    await raw.users.update_many({"email": {"$in": others}}, {"$set": {"is_active": False}})
    try:
        r = await client.patch(f"{API}/owners/{email}", headers=PLATFORM, json={"is_active": False})
        assert r.status_code == 409 and "last" in r.json()["detail"].lower()
        assert (await raw.users.find_one({"email": email}))["is_active"] is True
    finally:
        await raw.users.update_many({"email": {"$in": others}}, {"$set": {"is_active": True}})
    assert (await client.patch(f"{API}/owners/{email}", headers=PLATFORM, json={"is_active": False})).status_code == 200


async def test_an_owner_who_lives_in_a_customer_company_is_listed_under_that_company(client, made):
    cid = (await make_client(client, made))["company"]["company_id"]
    owner = await make_user(made, cid, role="superadmin", is_platform_admin=True)
    row = {o["email"]: o for o in (await client.get(f"{API}/owners", headers=PLATFORM)).json()["owners"]}[owner]
    assert row["company_name"].startswith("Plat Co ") and row["is_active"] is True
    admins = (await client.get(f"{API}/companies/{cid}", headers=PLATFORM)).json()["company"]["admins"]
    assert owner not in {a["email"] for a in admins}
    off = await client.patch(f"{API}/owners/{owner}", headers=PLATFORM, json={"is_active": False})
    assert off.status_code == 200 and off.json()["owner"]["is_active"] is False


USAGE_PATHS = ("/overview", "/usage", "/clients/{client_id}", "/companies/{company_id}")


async def _seed_march(company_id: str, t: str) -> None:
    with company_context(company_id):
        db = get_db()
        await db.jobs.insert_many([
            {"doc_type": "job", "job_id": f"job-m-{t}-{i}", "title": "T", "description": "d", "candidate_pipeline": [], "created_at": when}
            for i, when in enumerate([
                "2026-02-28T23:59:59.999999+00:00", "2026-03-01T00:00:00+00:00",
                "2026-03-31T23:59:59.999999+00:00", "2026-04-01T00:00:00+00:00",
            ])
        ])
        await db.resumes.insert_many([
            {"resume_id": f"res-m-{t}-{i}", "processing_status": status, "created_at": when}
            for i, (status, when) in enumerate([
                ("processed", "2026-03-05T09:00:00+00:00"), ("pending", "2026-03-06T09:00:00+00:00"),
                ("processed", "2026-04-02T09:00:00+00:00"),
            ])
        ])
        await db.email_log.insert_many([
            {"to": "mark-to@example.com", "subject": "MARK-SUBJECT", "status": status, "created_at": when}
            for status, when in [
                ("sent", "2026-03-15T08:00:00+00:00"), ("sent", "2026-03-15T09:00:00+00:00"),
                ("failed", "2026-03-15T10:00:00+00:00"), ("sent", "2026-04-02T08:00:00+00:00"),
            ]
        ])
        await db.cost_ledger.insert_many([
            {"source": f"src-m-{t}", "cost_usd": 0.5, "llm_calls": 3, "created_at": "2026-03-10T10:00:00+00:00"},
            {"source": f"src-m-{t}", "cost_usd": 0.25, "llm_calls": 1, "created_at": "2026-04-10T10:00:00+00:00"},
        ])


def _zero(**counts) -> dict:
    return {**{k: 0 for k in FEATURE_KEYS}, **counts}


async def test_a_calendar_month_counts_only_that_month_and_equals_its_daily_series(client, made):
    data = await make_client(client, made)
    company_id, client_id = data["company"]["company_id"], data["client"]["client_id"]
    await _seed_march(company_id, tag())

    march = (await client.get(f"{API}/companies/{company_id}?month=2026-03", headers=PLATFORM)).json()
    assert march["period"] == {"kind": "month", "from": "2026-03-01T00:00:00+00:00", "to": "2026-04-01T00:00:00+00:00"}
    expected = _zero(jobs=2, resumes=1, emails=2, ai=3)
    assert march["company"]["usage"] == expected
    assert {f["key"]: f["window"] for f in march["features"]} == expected
    assert (march["company"]["jobs"], march["company"]["resumes"], march["company"]["emails"]) == (4, 2, 3)
    assert march["company"]["ai_cost_usd"] == pytest.approx(0.75)
    assert march["company"]["ai_cost_window_usd"] == pytest.approx(0.5)
    assert [(s["cost_usd"], s["calls"]) for s in march["cost_by_source"]] == [
        (pytest.approx(0.5), 3), (pytest.approx(2 * settings.EMAIL_ESTIMATED_COST_PER_EMAIL), 2),
    ]

    days = {d["date"]: d["count"] for d in march["activity"]}
    assert len(march["activity"]) == 31 and list(days)[0] == "2026-03-01" and list(days)[-1] == "2026-03-31"
    assert sum(days.values()) == sum(expected.values()) == 8
    assert (days["2026-03-01"], days["2026-03-31"], days["2026-03-15"], days["2026-03-10"], days["2026-03-05"]) == (1, 1, 2, 3, 1)

    april = (await client.get(f"{API}/companies/{company_id}?month=2026-04", headers=PLATFORM)).json()
    assert april["company"]["usage"] == _zero(jobs=1, resumes=1, emails=1, ai=1)
    assert sum(d["count"] for d in april["activity"]) == 4 and len(april["activity"]) == 30
    assert [s["cost_usd"] for s in april["cost_by_source"]] == [
        pytest.approx(0.25), pytest.approx(settings.EMAIL_ESTIMATED_COST_PER_EMAIL),
    ]
    february = (await client.get(f"{API}/companies/{company_id}?month=2026-02", headers=PLATFORM)).json()
    assert february["company"]["usage"] == _zero(jobs=1) and len(february["activity"]) == 28
    empty = (await client.get(f"{API}/companies/{company_id}?month=2020-01", headers=PLATFORM)).json()
    assert empty["company"]["usage"] == _zero() and sum(d["count"] for d in empty["activity"]) == 0
    assert empty["cost_by_source"] == []

    detail = (await client.get(f"{API}/clients/{client_id}?month=2026-03", headers=PLATFORM)).json()
    assert detail["period"] == march["period"] and detail["client"]["usage"] == expected
    assert sum(d["count"] for d in detail["activity"]) == 8
    matrix = (await client.get(f"{API}/usage?month=2026-03", headers=PLATFORM)).json()
    assert matrix["period"] == march["period"] and matrix["window_days"] == 31
    assert {r["client_id"]: r for r in matrix["rows"]}[client_id]["counts"] == expected
    overall = (await client.get(f"{API}/overview?month=2026-03", headers=PLATFORM)).json()
    assert overall["period"] == march["period"] and overall["window_days"] == 31
    assert {f["key"]: f for f in overall["features"]}["jobs"]["window"] >= 2
    seen = [
        await client.get(f"{API}{p.format(client_id=client_id, company_id=company_id)}?month=2026-03", headers=PLATFORM)
        for p in USAGE_PATHS
    ]
    assert_no_secrets(*seen)


async def test_a_leap_february_has_twenty_nine_days_and_december_ends_in_january(client, made):
    company_id = (await make_client(client, made))["company"]["company_id"]
    leap = (await client.get(f"{API}/companies/{company_id}?month=2028-02", headers=PLATFORM)).json()
    assert len(leap["activity"]) == 29 and leap["period"]["to"] == "2028-03-01T00:00:00+00:00"
    december = (await client.get(f"{API}/companies/{company_id}?month=2026-12", headers=PLATFORM)).json()
    assert december["period"]["to"] == "2027-01-01T00:00:00+00:00" and len(december["activity"]) == 31


async def test_a_window_period_runs_from_utc_midnight_to_now(client):
    today = datetime.now(timezone.utc).date()
    for query, days in (("", 30), ("?window=7", 7), ("?window=90", 90)):
        body = (await client.get(f"{API}/usage{query}", headers=PLATFORM)).json()
        period = body["period"]
        assert period["kind"] == "window" and set(period) == {"kind", "from", "to"}
        start, end = datetime.fromisoformat(period["from"]), datetime.fromisoformat(period["to"])
        assert period["from"].endswith("T00:00:00+00:00")
        assert abs((start.date() - (today - timedelta(days=days - 1))).days) <= 1
        assert start < end <= datetime.now(timezone.utc) + timedelta(seconds=5)
        assert body["window_days"] == days


@pytest.mark.parametrize("query", [
    "?month=2026-03&window=7", "?month=2026-03&window=30", "?window=7&month=", "?month=2026-13", "?month=2026-00",
    "?month=nope", "?month=", "?month=2026-3", "?month=1999-12", "?month=2026-03-01",
])
async def test_a_bad_or_doubled_period_is_a_422_on_every_usage_endpoint(client, made, query):
    data = await make_client(client, made)
    for path in USAGE_PATHS:
        url = path.format(client_id=data["client"]["client_id"], company_id=data["company"]["company_id"])
        r = await client.get(f"{API}{url}{query}", headers=PLATFORM)
        assert r.status_code == 422, f"{url}{query}: {r.status_code}"


async def test_health_reports_the_platform_and_which_companies_failed_to_send_mail(client, made):
    a, b = await make_client(client, made), await make_client(client, made)
    ca, cb = a["company"]["company_id"], b["company"]["company_id"]
    t = tag()
    for company_id, rows in ((ca, [("failed", 0), ("failed", 0), ("failed", 2), ("sent", 0)]), (cb, [("failed", 0)])):
        with company_context(company_id):
            await get_db().email_log.insert_many([
                {"to": "mark-to@example.com", "subject": "MARK-SUBJECT", "status": status, "created_at": ago(days)}
                for status, days in rows
            ])
    await workspace_service.record_platform_cron_run(f"health{t}", {
        "started_at": ago(), "last_run_at": ago(), "status": "ok", "detail": "2 companies",
        "companies_total": 2, "companies_served": 2, "companies_failed": 0,
    })
    try:
        r = await client.get(f"{API}/health", headers=PLATFORM)
    finally:
        await get_platform_db().settings.delete_many({"key": f"cron_health{t}"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"mongo", "email", "pinecone", "cron", "failed_emails_24h"}
    assert body["mongo"]["ok"] is True and body["mongo"]["latency_ms"] >= 0
    assert set(body["email"]) == {"configured", "provider"}
    assert body["email"]["configured"] == (body["email"]["provider"] is not None)
    assert body["email"]["provider"] in (None, "smtp", "ses")
    assert body["pinecone"] == {"configured": bool(settings.PINECONE_API_KEY)}

    cron = {c["key"]: c for c in body["cron"]}
    assert cron[f"health{t}"]["status"] == "ok" and cron[f"health{t}"]["companies_served"] == 2
    assert set(cron[f"health{t}"]) == {
        "key", "last_run_at", "status", "detail", "companies_total", "companies_served", "companies_failed",
    }

    failed = body["failed_emails_24h"]
    rows = {f["company_id"]: f for f in failed}
    assert rows[ca] == {"company_id": ca, "company_name": a["company"]["name"], "client_name": a["client"]["name"], "failed": 2}
    assert rows[cb]["failed"] == 1 and rows[cb]["client_name"] == b["client"]["name"]
    assert [f["company_id"] for f in failed].index(ca) < [f["company_id"] for f in failed].index(cb)
    assert [f["failed"] for f in failed] == sorted((f["failed"] for f in failed), reverse=True)
    assert_no_secrets(r)


async def test_readiness_pings_the_database_and_liveness_stays_a_constant(client, monkeypatch):
    ready = await client.get("/health/ready")
    assert ready.status_code == 200 and ready.json() == {"status": "ready"}
    live = await client.get("/health")
    assert live.status_code == 200 and live.json()["status"] == "ok"

    monkeypatch.setattr(svc, "database_ping", AsyncMock(return_value={"ok": False, "latency_ms": None}))
    down = await client.get("/health/ready")
    assert down.status_code == 503 and down.json() == {"status": "unavailable"}
    assert (await client.get("/health")).status_code == 200


async def test_the_platform_audit_log_pages_newest_first(client, made):
    ids = [(await make_client(client, made, company=False))["client"]["client_id"] for _ in range(3)]

    first_response = await client.get(f"{API}/audit", params={"limit": 2}, headers=PLATFORM)
    assert first_response.status_code == 200, first_response.text
    first = first_response.json()
    assert set(first) == {"entries", "next_before"} and len(first["entries"]) == 2
    assert [e["resource_id"] for e in first["entries"]] == [ids[2], ids[1]]
    assert all(e["action"] == "client_create" and e["actor_email"] == DEMO_OWNER for e in first["entries"])
    assert all(set(e) == {"at", "action", "actor_email", "resource_type", "resource_id", "details"} for e in first["entries"])
    assert first["next_before"] == first["entries"][-1]["at"]

    second = (await client.get(f"{API}/audit", params={"limit": 2, "before": first["next_before"]}, headers=PLATFORM)).json()
    assert second["entries"][0]["resource_id"] == ids[0]
    assert all(e["at"] < first["next_before"] for e in second["entries"])
    assert not {e["at"] for e in second["entries"]} & {e["at"] for e in first["entries"]}
    assert second["next_before"] is None or second["next_before"] == second["entries"][-1]["at"]

    whole = (await client.get(f"{API}/audit?limit=200", headers=PLATFORM)).json()["entries"]
    assert [e["at"] for e in whole] == sorted((e["at"] for e in whole), reverse=True)
    assert len(whole) <= 200
    assert_no_secrets(first_response)


async def test_the_audit_cursor_and_limit_are_checked(client):
    ancient = "2000-01-01T00:00:00+00:00"
    gone = await client.get(f"{API}/audit", params={"before": ancient}, headers=PLATFORM)
    assert gone.status_code == 200 and gone.json() == {"entries": [], "next_before": None}
    assert (await client.get(f"{API}/audit?before={ancient}", headers=PLATFORM)).json() == {"entries": [], "next_before": None}
    assert (await client.get(f"{API}/audit", params={"before": "2000-01-01T00:00:00Z"}, headers=PLATFORM)).status_code == 200
    for bad in ("limit=0", "limit=201", "limit=-1", "limit=abc", "before=yesterday", "before=2026-13-45"):
        assert (await client.get(f"{API}/audit?{bad}", headers=PLATFORM)).status_code == 422, bad


async def test_a_suspension_reason_is_kept_trimmed_shown_and_cleared_by_activation(client, made):
    data = await make_client(client, made)
    cid, company_id = data["client"]["client_id"], data["company"]["company_id"]
    raw = get_platform_db()

    suspended = await client.post(f"{API}/companies/{company_id}/suspend", headers=PLATFORM, json={"reason": "  Unpaid invoice  "})
    assert suspended.status_code == 200
    assert suspended.json()["company"]["suspended_reason"] == "Unpaid invoice"
    assert (await raw.companies.find_one({"company_id": company_id}))["suspended_reason"] == "Unpaid invoice"
    shown = (await client.get(f"{API}/companies/{company_id}", headers=PLATFORM)).json()["company"]
    assert shown["status"] == "suspended" and shown["suspended_reason"] == "Unpaid invoice" and shown["suspended_at"]
    with company_context(company_id):
        rows = await get_db().audit_log.find({"action": "company_suspend"}, {"_id": 0}).to_list(5)
    assert [r["details"]["reason"] for r in rows] == ["Unpaid invoice"]

    cleared = await client.post(f"{API}/companies/{company_id}/activate", headers=PLATFORM)
    assert cleared.json()["company"]["suspended_reason"] is None and cleared.json()["company"]["status"] == "active"

    quiet = await client.post(f"{API}/clients/{cid}/suspend", headers=PLATFORM, json={})
    assert quiet.status_code == 200 and quiet.json()["client"]["suspended_reason"] == ""
    await client.post(f"{API}/clients/{cid}/activate", headers=PLATFORM)
    again = await client.post(f"{API}/clients/{cid}/suspend", headers=PLATFORM, json={"reason": "Contract ended"})
    assert again.json()["client"]["suspended_reason"] == "Contract ended"
    lifted = await client.post(f"{API}/clients/{cid}/activate", headers=PLATFORM)
    assert lifted.json()["client"]["suspended_reason"] is None
    assert (await client.post(f"{API}/clients/{cid}/suspend", headers=PLATFORM, json={"reason": "x" * 501})).status_code == 422


async def test_an_owner_always_needs_a_password_and_always_signs_in_with_a_code(client, made):
    t = tag()
    email = f"codes-{t}@example.com"
    made.emails.append(email)
    for body in ({"name": "N", "email": email}, {"name": "N", "email": email, "password": ""}, {"name": "N", "email": email, "password": "short"}):
        assert (await client.post(f"{API}/owners", headers=PLATFORM, json=body)).status_code == 422, body
    assert await get_platform_db().users.find_one({"email": email}) is None

    assert (await client.post(f"{API}/owners", headers=PLATFORM, json={"name": "N", "email": email, "password": PASSWORD})).status_code == 201
    stored = await get_platform_db().users.find_one({"email": email})
    assert stored["otp_required"] is True and stored["otp_enforced"] is True and stored["is_platform_admin"] is True
    refused = await client.post(f"{AUTH}/token", data={"username": email, "password": PASSWORD})
    assert refused.status_code == 403 and "one-time code" in refused.text


@pytest.fixture
def invites(monkeypatch):
    class Box:
        pass

    box = Box()
    box.calls = []
    box.answer = True

    async def send_invite(*, email, name, company_id, invited_by):
        box.calls.append({"email": email, "name": name, "company_id": company_id, "invited_by": invited_by})
        if isinstance(box.answer, Exception):
            raise box.answer
        return box.answer

    fake = types.ModuleType("services.hr_module.credentials_service")
    fake.send_invite = send_invite
    import services.hr_module as package

    monkeypatch.setitem(sys.modules, "services.hr_module.credentials_service", fake)
    monkeypatch.setattr(package, "credentials_service", fake, raising=False)
    return box


async def test_an_administrator_without_a_password_is_invited_by_email(client, made, invites):
    data = await make_client(client, made)
    cid = data["company"]["company_id"]
    email = f"invited-{tag()}@example.com"
    made.emails.append(email)

    r = await client.post(f"{API}/companies/{cid}/admins", headers=PLATFORM, json={"name": "Invited Admin", "email": email.upper()})
    assert r.status_code == 201, r.text
    assert r.json() == {"admin": {"email": email, "name": "Invited Admin"}, "email_sent": True}
    assert invites.calls == [{"email": email, "name": "Invited Admin", "company_id": cid, "invited_by": DEMO_OWNER}]

    stored = await get_platform_db().users.find_one({"email": email})
    assert stored["role"] == "superadmin" and stored["company_id"] == cid and stored["is_active"] is True
    assert stored["otp_required"] is False and stored["password_hash"].startswith("$2")
    for guess in (PASSWORD, "Password-1234", "password"):
        assert (await login(client, email, guess)).status_code == 401
    company = (await client.get(f"{API}/companies/{cid}", headers=PLATFORM)).json()["company"]
    assert email in {a["email"] for a in company["admins"]}

    rows = [row async for row in get_platform_db().audit_log.find(
        {"company_id": PLATFORM_COMPANY_ID, "action": "company_admin_create", "resource_id": cid},
    )]
    assert [row["details"] for row in rows if row["details"].get("email") == email] == [
        {"email": email, "invited": True, "email_sent": True},
    ]
    assert_no_secrets(r)


async def test_an_invitation_that_did_not_leave_is_reported_and_the_account_still_exists(client, made, invites):
    cid = (await make_client(client, made))["company"]["company_id"]
    for answer in (False, RuntimeError("mail host down")):
        invites.answer = answer
        email = f"failed-{tag()}@example.com"
        made.emails.append(email)
        r = await client.post(f"{API}/companies/{cid}/admins", headers=PLATFORM, json={"name": "A", "email": email})
        assert r.status_code == 201 and r.json()["email_sent"] is False, r.text
        assert "mail host down" not in r.text
        assert await get_platform_db().users.find_one({"email": email}) is not None


async def test_a_password_that_is_given_is_used_and_nothing_is_sent(client, made, invites):
    cid = (await make_client(client, made))["company"]["company_id"]
    email = f"handover-{tag()}@example.com"
    made.emails.append(email)
    r = await client.post(f"{API}/companies/{cid}/admins", headers=PLATFORM, json={"name": "A", "email": email, "password": PASSWORD})
    assert r.status_code == 201 and r.json() == {"admin": {"email": email, "name": "A"}}
    assert invites.calls == []
    assert (await login(client, email)).status_code == 200


async def test_an_empty_password_means_invite_and_a_taken_address_sends_nothing(client, made, invites):
    data = await make_client(client, made)
    cid = data["company"]["company_id"]
    email = f"blank-{tag()}@example.com"
    made.emails.append(email)
    r = await client.post(f"{API}/companies/{cid}/admins", headers=PLATFORM, json={"name": "A", "email": email, "password": "   "})
    assert r.status_code == 201 and r.json()["email_sent"] is True and len(invites.calls) == 1

    taken = await client.post(f"{API}/companies/{cid}/admins", headers=PLATFORM, json={"name": "A", "email": data["email"]})
    assert taken.status_code == 409 and len(invites.calls) == 1


async def test_the_first_administrator_of_a_new_company_can_be_invited_too(client, made, invites):
    t = tag()
    email = f"first-{t}@example.com"
    made.emails.append(email)
    r = await client.post(
        f"{API}/clients", headers=PLATFORM,
        json={"name": f"Invite Client {t}", "company": {"name": f"Invite Co {t}", "admin": {"name": "First", "email": email}}},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    made.clients.append(body["client"]["client_id"])
    made.companies.append(body["company"]["company_id"])
    assert body["email_sent"] is True
    assert invites.calls == [{"email": email, "name": "First", "company_id": body["company"]["company_id"], "invited_by": DEMO_OWNER}]
    assert body["company"]["admins"] == [{"email": email, "name": "First"}]

    second = f"second-{t}@example.com"
    made.emails.append(second)
    invites.answer = False
    more = await client.post(
        f"{API}/clients/{body['client']['client_id']}/companies", headers=PLATFORM,
        json={"name": f"Invite Co 2 {t}", "admin": {"name": "Second", "email": second}},
    )
    assert more.status_code == 201, more.text
    made.companies.append(more.json()["company"]["company_id"])
    assert more.json()["email_sent"] is False and len(invites.calls) == 2


async def test_an_address_on_a_domain_another_company_claimed_is_refused_everywhere(client, made):
    a, b = await make_client(client, made), await make_client(client, made)
    ca, cb = a["company"]["company_id"], b["company"]["company_id"]
    t = tag()
    domain = f"claimed{t}.example.org"
    assert (await client.patch(f"{API}/companies/{ca}", headers=PLATFORM, json={"sso_domains": [domain]})).status_code == 200
    message = "That email domain is reserved by another company."

    boss = f"boss@{domain}"
    r = await client.post(f"{API}/companies/{cb}/admins", headers=PLATFORM, json={"name": "B", "email": boss, "password": PASSWORD})
    assert r.status_code == 409 and r.json()["detail"] == message
    assert not any(n in r.text for n in (ca, a["company"]["name"], a["client"]["name"]))
    assert await get_platform_db().users.find_one({"email": boss}) is None

    refused = await client.post(
        f"{API}/clients", headers=PLATFORM,
        json={"name": f"Squatter {t}", "company": {"name": "Sq", "admin": {"name": "S", "email": f"s@{domain}", "password": PASSWORD}}},
    )
    assert refused.status_code == 409 and refused.json()["detail"] == message
    assert (await client.get(f"{API}/clients?search=Squatter {t}", headers=PLATFORM)).json()["clients"] == []
    more = await client.post(
        f"{API}/clients/{b['client']['client_id']}/companies", headers=PLATFORM,
        json={"name": "Another", "admin": {"name": "S", "email": f"s2@{domain}", "password": PASSWORD}},
    )
    assert more.status_code == 409 and more.json()["detail"] == message
    assert (await client.get(f"{API}/clients/{b['client']['client_id']}", headers=PLATFORM)).json()["client"]["companies"] == 1
    owner = await client.post(f"{API}/owners", headers=PLATFORM, json={"name": "O", "email": f"o@{domain}", "password": PASSWORD})
    assert owner.status_code == 409 and owner.json()["detail"] == message

    mine = f"mine@{domain}"
    made.emails.extend([mine, boss])
    assert (await client.post(f"{API}/companies/{ca}/admins", headers=PLATFORM, json={"name": "A2", "email": mine, "password": PASSWORD})).status_code == 201
    assert (await client.patch(f"{API}/companies/{ca}", headers=PLATFORM, json={"sso_domains": []})).status_code == 200
    assert (await client.post(f"{API}/companies/{cb}/admins", headers=PLATFORM, json={"name": "B", "email": boss, "password": PASSWORD})).status_code == 201


async def test_the_clients_plan_limits_the_users_of_each_company(client, made):
    data = await make_client(client, made, plan={"max_users_per_company": 2})
    cid, client_id = data["company"]["company_id"], data["client"]["client_id"]
    assert data["company"]["plan"]["max_users_per_company"] == 2 and data["company"]["users"] == 1
    raw = get_platform_db()
    emails = []

    async def add():
        email = f"seat-{tag()}@example.com"
        made.emails.append(email)
        emails.append(email)
        return await client.post(f"{API}/companies/{cid}/admins", headers=PLATFORM, json={"name": "S", "email": email, "password": PASSWORD})

    assert (await add()).status_code == 201
    refused = await add()
    assert refused.status_code == 409
    assert refused.json()["detail"] == "Your plan allows at most 2 users. Ask your administrator to raise the limit."
    assert await raw.users.find_one({"email": emails[-1]}) is None
    row = (await client.get(f"{API}/companies/{cid}", headers=PLATFORM)).json()["company"]
    assert row["users"] == 2 and row["plan"]["max_users_per_company"] == 2

    await raw.users.update_one({"email": emails[0]}, {"$set": {"is_active": False}})
    assert (await add()).status_code == 201
    assert (await add()).status_code == 409

    patched = await client.patch(f"{API}/clients/{client_id}", headers=PLATFORM, json={"plan": {"max_users_per_company": 10}})
    assert patched.json()["client"]["plan"]["max_users_per_company"] == 10
    assert (await add()).status_code == 201
    cleared = await client.patch(f"{API}/clients/{client_id}", headers=PLATFORM, json={"plan": {"max_users_per_company": None}})
    assert cleared.json()["client"]["plan"]["max_users_per_company"] is None


async def test_a_limit_of_one_is_filled_by_the_first_administrator_and_each_company_has_its_own_seats(client, made):
    data = await make_client(client, made, plan={"max_users_per_company": 1})
    assert data["company"]["users"] == 1
    email = f"second-{tag()}@example.com"
    made.emails.append(email)
    r = await client.post(f"{API}/companies/{data['company']['company_id']}/admins", headers=PLATFORM, json={"name": "S", "email": email, "password": PASSWORD})
    assert r.status_code == 409 and "at most 1 users" in r.json()["detail"]
    other = await client.post(
        f"{API}/clients/{data['client']['client_id']}/companies", headers=PLATFORM,
        json={"name": "Second Co", "admin": {"name": "S", "email": email, "password": PASSWORD}},
    )
    assert other.status_code == 201, other.text
    made.companies.append(other.json()["company"]["company_id"])


class FakeIndex:

    def __init__(self):
        self.calls: list[tuple[list[str], str | None]] = []

    def delete(self, ids, namespace=None):
        self.calls.append((list(ids), namespace))


TENANT_SKIP = {"clients", "companies", "settings", "rate_limits", "sso_states", "otp_logs", "password_tokens"}


async def _rows_for(company_id: str) -> dict[str, int]:
    raw = get_platform_db()
    left = {}
    for name in await raw.list_collection_names():
        if name in TENANT_SKIP or name.startswith("system."):
            continue
        n = await raw[name].count_documents({"company_id": company_id})
        if n:
            left[name] = n
    return left


async def _seed_for_deletion(company_id: str, t: str, made: Made) -> dict:
    with company_context(company_id):
        db = get_db()
        await db.jobs.insert_many([
            {"doc_type": "job", "job_id": f"job-d-{t}-{i}", "title": "T", "description": "d", "created_at": ago()} for i in range(3)
        ])
        await db.resumes.insert_many([
            {"resume_id": f"res-d-{t}-{i}", "processing_status": "processed", "created_at": ago(), "text": "MARK-RESUME-TEXT"}
            for i in range(4)
        ])
        await db.candidates.insert_many([
            {"candidate_id": f"cand-d-{t}-{i}", "email": f"mark-cand-{t}-{i}@example.com", "created_at": ago()} for i in range(2)
        ])
        await db.cost_ledger.insert_many([{"source": f"src-d-{t}", "cost_usd": 0.1, "llm_calls": 1, "created_at": ago()} for _ in range(2)])
        await db.email_log.insert_many([{"to": "mark-to@example.com", "status": "sent", "created_at": ago()} for _ in range(3)])
        await db.performance_reviews.insert_one({"review_id": f"rev-d-{t}", "status": "pending", "created_at": ago()})
        await db.company_settings.insert_one({"_id": "singleton", "company_name": "Doomed"})
        for i in range(2):
            email = f"doomed-{t}-{i}@example.com"
            made.emails.append(email)
            await db.users.insert_one({"name": "D", "email": email, "role": "standard", "is_active": True, "password_hash": _pwd.hash(PASSWORD)})
    return {
        "resume_ids": sorted(f"res-d-{t}-{i}" for i in range(4)),
        "job_ids": sorted(f"job-d-{t}-{i}" for i in range(3)),
        "counts": {
            "jobs": 3, "resumes": 4, "candidates": 2, "cost_ledger": 2, "email_log": 3, "performance_reviews": 1,
            "company_settings": 1, "users": 3,
        },
    }


async def _suspended_company_with_data(client, made, monkeypatch):
    index = FakeIndex()
    monkeypatch.setattr(svc, "get_pinecone", lambda: index)
    doomed, bystander = await make_client(client, made), await make_client(client, made)
    t = tag()
    seeded = await _seed_for_deletion(doomed["company"]["company_id"], t, made)
    with company_context(bystander["company"]["company_id"]):
        await get_db().jobs.insert_one({"doc_type": "job", "job_id": f"job-keep-{t}", "title": "T", "description": "d", "created_at": ago()})
        await get_db().resumes.insert_one({"resume_id": f"res-keep-{t}", "processing_status": "processed", "created_at": ago()})
    suspend = await client.post(f"{API}/companies/{doomed['company']['company_id']}/suspend", headers=PLATFORM, json={"reason": "Offboarding"})
    assert suspend.status_code == 200
    return doomed, bystander, seeded, index, t


async def _delete(client, kind: str, ident: str, slug: str):
    return await client.request("DELETE", f"{API}/{kind}/{ident}", headers=PLATFORM, json={"confirm_slug": slug})


async def test_deleting_a_company_removes_its_vectors_then_every_row_then_the_directory_entry(client, made, monkeypatch):
    doomed, bystander, seeded, index, t = await _suspended_company_with_data(client, made, monkeypatch)
    cid, slug, client_id = doomed["company"]["company_id"], doomed["company"]["slug"], doomed["client"]["client_id"]
    other = bystander["company"]["company_id"]
    assert set(await _rows_for(cid)) >= set(seeded["counts"])

    r = await _delete(client, "companies", cid, slug)
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"complete", "deleted"} and body["complete"] is True
    assert {k: body["deleted"].get(k) for k in seeded["counts"]} == seeded["counts"]
    assert body["deleted"]["audit_log"] >= 1

    assert await _rows_for(cid) == {}
    assert await get_platform_db().companies.find_one({"company_id": cid}) is None
    assert (await client.get(f"{API}/companies/{cid}", headers=PLATFORM)).status_code == 404
    assert cid not in {c["company_id"] for c in (await client.get(f"{API}/companies", headers=PLATFORM)).json()["companies"]}
    assert (await client.get(f"{API}/clients/{client_id}", headers=PLATFORM)).json()["client"]["companies"] == 0
    assert (await login(client, doomed["email"])).status_code == 401

    sent = {(tuple(sorted(ids)), ns) for ids, ns in index.calls}
    assert sent == {(tuple(seeded["resume_ids"]), None), (tuple(seeded["job_ids"]), "jobs")}

    assert {"jobs", "resumes"} <= set(await _rows_for(other))
    assert not any(f"keep-{t}" in i for ids, _ in index.calls for i in ids)

    rows = [row async for row in get_platform_db().audit_log.find({"company_id": PLATFORM_COMPANY_ID, "resource_id": cid})]
    by_action = {row["action"]: row for row in rows}
    assert {"company_create", "company_delete", "company_delete_complete"} <= set(by_action)
    assert by_action["company_delete"]["created_at"] <= by_action["company_delete_complete"]["created_at"]
    assert by_action["company_delete"]["details"]["slug"] == slug
    assert by_action["company_delete_complete"]["details"]["deleted"]["jobs"] == 3
    assert PASSWORD not in repr(rows) and "password_hash" not in repr(rows)

    assert (await _delete(client, "companies", cid, slug)).status_code == 404


async def test_deleting_a_company_is_refused_until_it_is_suspended_and_the_slug_is_typed(client, made):
    data = await make_client(client, made)
    cid, slug = data["company"]["company_id"], data["company"]["slug"]

    active = await _delete(client, "companies", cid, slug)
    assert active.status_code == 409 and "Suspend" in active.json()["detail"]

    await client.post(f"{API}/companies/{cid}/suspend", headers=PLATFORM, json={"reason": "r"})
    for wrong in ("not-the-slug", slug + "x", "other"):
        r = await _delete(client, "companies", cid, wrong)
        assert r.status_code == 422, wrong
    assert (await client.request("DELETE", f"{API}/companies/{cid}", headers=PLATFORM, json={})).status_code == 422
    assert (await client.request("DELETE", f"{API}/companies/{cid}", headers=PLATFORM, json={"confirm_slug": ""})).status_code == 422
    assert (await client.request("DELETE", f"{API}/companies/{cid}", headers=PLATFORM)).status_code == 422
    assert (await _delete(client, "companies", "cmp_nobody", "x")).status_code == 404

    assert await _rows_for(cid)
    assert await get_platform_db().companies.find_one({"company_id": cid}) is not None
    started = [row async for row in get_platform_db().audit_log.find(
        {"company_id": PLATFORM_COMPANY_ID, "action": "company_delete", "resource_id": cid},
    )]
    assert started == []


async def test_the_internal_workspaces_can_never_be_deleted(client):
    raw = get_platform_db()
    for kind, ident, slug in (
        ("companies", PLATFORM_COMPANY_ID, "platform"), ("companies", DEFAULT_COMPANY_ID, "default"),
        ("clients", PLATFORM_CLIENT_ID, "platform"), ("clients", "cli_default", "default"),
    ):
        r = await _delete(client, kind, ident, slug)
        assert r.status_code == 409, (ident, r.status_code, r.text)
    assert await raw.companies.find_one({"company_id": PLATFORM_COMPANY_ID}) is not None
    assert await raw.companies.find_one({"company_id": DEFAULT_COMPANY_ID}) is not None
    assert await raw.clients.find_one({"client_id": "cli_default"}) is not None
    assert await raw.users.count_documents({"company_id": DEFAULT_COMPANY_ID}) > 0


async def test_a_platform_owner_living_inside_a_company_blocks_its_deletion(client, made):
    data = await make_client(client, made)
    cid = data["company"]["company_id"]
    await make_user(made, cid, role="superadmin", is_platform_admin=True)
    await client.post(f"{API}/companies/{cid}/suspend", headers=PLATFORM, json={"reason": "r"})
    r = await _delete(client, "companies", cid, data["company"]["slug"])
    assert r.status_code == 409 and "platform owner" in r.json()["detail"]
    assert await _rows_for(cid)


async def test_a_vector_store_failure_leaves_every_row_in_place(client, made, monkeypatch):
    doomed, _, seeded, _, _ = await _suspended_company_with_data(client, made, monkeypatch)

    class Broken:
        def delete(self, ids, namespace=None):
            raise RuntimeError("index unavailable")

    monkeypatch.setattr(svc, "get_pinecone", lambda: Broken())
    r = await _delete(client, "companies", doomed["company"]["company_id"], doomed["company"]["slug"])
    assert r.status_code == 502
    assert "index unavailable" not in r.text
    assert set(await _rows_for(doomed["company"]["company_id"])) >= set(seeded["counts"])
    assert await get_platform_db().companies.find_one({"company_id": doomed["company"]["company_id"]}) is not None


async def test_deleting_a_company_resumes_under_a_time_budget_and_the_calls_add_up(client, made, monkeypatch):
    doomed, bystander, seeded, index, t = await _suspended_company_with_data(client, made, monkeypatch)
    cid, slug = doomed["company"]["company_id"], doomed["company"]["slug"]
    monkeypatch.setattr(svc, "OFFBOARD_BUDGET_SECONDS", 0)

    answers = []
    for _ in range(80):
        r = await _delete(client, "companies", cid, slug)
        assert r.status_code == 200, r.text
        answers.append(r.json())
        if answers[-1]["complete"]:
            break
        assert (await client.get(f"{API}/companies/{cid}", headers=PLATFORM)).status_code == 200
    assert answers[-1]["complete"] is True and len(answers) >= 3

    unfinished = answers[:-1]
    assert all(set(a) == {"complete", "deleted", "remaining"} and a["remaining"] > 0 for a in unfinished)
    left = [a["remaining"] for a in unfinished]
    assert left == sorted(left, reverse=True) and left[0] > left[-1]
    for before, after in zip(answers, answers[1:]):
        assert all(after["deleted"].get(k, 0) >= v for k, v in before["deleted"].items())
    assert {k: answers[-1]["deleted"].get(k) for k in seeded["counts"]} == seeded["counts"]

    assert await _rows_for(cid) == {}
    assert await get_platform_db().companies.find_one({"company_id": cid}) is None
    assert {"jobs", "resumes"} <= set(await _rows_for(bystander["company"]["company_id"]))
    resume_ids = [i for ids, ns in index.calls if ns is None for i in ids]
    assert sorted(resume_ids) == seeded["resume_ids"]
    started = [row async for row in get_platform_db().audit_log.find(
        {"company_id": PLATFORM_COMPANY_ID, "action": "company_delete", "resource_id": cid},
    )]
    assert len(started) == 1


async def test_deleting_a_client_needs_its_companies_gone_and_its_slug(client, made, monkeypatch):
    monkeypatch.setattr(svc, "get_pinecone", lambda: FakeIndex())
    data = await make_client(client, made)
    client_id, cid = data["client"]["client_id"], data["company"]["company_id"]
    client_slug, company_slug = data["client"]["slug"], data["company"]["slug"]

    busy = await _delete(client, "clients", client_id, client_slug)
    assert busy.status_code == 409 and "companies" in busy.json()["detail"]
    assert (await client.get(f"{API}/clients/{client_id}", headers=PLATFORM)).status_code == 200

    await client.post(f"{API}/companies/{cid}/suspend", headers=PLATFORM, json={"reason": "r"})
    assert (await _delete(client, "companies", cid, company_slug)).json()["complete"] is True

    for wrong in ("nope", company_slug):
        assert (await _delete(client, "clients", client_id, wrong)).status_code == 422
    assert (await client.request("DELETE", f"{API}/clients/{client_id}", headers=PLATFORM, json={})).status_code == 422
    done = await _delete(client, "clients", client_id, client_slug)
    assert done.status_code == 200 and done.json() == {"complete": True, "deleted": {"clients": 1}}
    assert (await client.get(f"{API}/clients/{client_id}", headers=PLATFORM)).status_code == 404
    assert client_id not in {c["client_id"] for c in (await client.get(f"{API}/clients", headers=PLATFORM)).json()["clients"]}
    assert (await _delete(client, "clients", client_id, client_slug)).status_code == 404
    actions = {row["action"] async for row in get_platform_db().audit_log.find({"company_id": PLATFORM_COMPANY_ID, "resource_id": client_id})}
    assert {"client_create", "client_delete"} <= actions
