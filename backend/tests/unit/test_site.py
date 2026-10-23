from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient

import config.database as database
from config import tenancy
from fake_mongo import FakeRaw
from main import app
from services.hr_module import plan_service, site_service, workspace_service
from shared import quotas, rate_limit

pytestmark = pytest.mark.anyio

API = "/api/v1/site"
PLATFORM = {"Authorization": "Bearer demo-platform-token"}
COMPANY_ADMIN = {"Authorization": "Bearer demo-admin-token"}
GOOD = {
    "name": "Sara Khan",
    "email": "Sara@Example.com",
    "company": "Globex",
    "topic": "sales",
    "message": "We would like to see the platform with our recruiting team.",
    "consent": True,
}


@pytest.fixture
async def world(monkeypatch):
    raw = FakeRaw()
    monkeypatch.setattr(database, "_db", raw)
    tenancy.use_fallback_company(None)

    keys: list[str] = []

    async def record(db, *, key, limit, window_seconds):
        keys.append(key)

    monkeypatch.setattr(rate_limit, "enforce_rate_limit", record)
    monkeypatch.setattr(quotas, "enforce_rate_limit", record)

    audits: list[tuple] = []

    async def audit(actor, action, resource_type, resource_id=None, details=None, **kwargs):
        audits.append((actor.get("email"), action, resource_type, resource_id, details))

    monkeypatch.setattr(workspace_service, "platform_audit", audit)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        yield SimpleNamespace(raw=raw, client=client, keys=keys, audits=audits)


def rows(world):
    return world.raw["contact_requests"].docs


def seed(world, **over):
    now = datetime.now(timezone.utc)
    index = len(rows(world))
    base = {
        "request_id": f"00000000-0000-4000-8000-{index:012d}",
        "name": f"Person {index}",
        "email": f"p{index}@example.com",
        "company": "",
        "topic": "other",
        "message": "A message long enough to be accepted.",
        "status": "new",
        "note": "",
        "source": "website",
        "created_at": (now - timedelta(minutes=index)).isoformat(),
        "updated_at": now.isoformat(),
        "handled_by": None,
    }
    base.update(over)
    rows(world).append(base)
    return base


async def test_plans_are_read_from_the_plan_catalogue_and_hide_the_internal_tier(world):
    response = await world.client.get(f"{API}/plans")
    assert response.status_code == 200
    assert "max-age=300" in response.headers["cache-control"]
    plans = response.json()["plans"]
    assert [p["tier"] for p in plans] == ["starter", "growth", "max", "enterprise"]
    assert [p["price_monthly_usd"] for p in plans] == [109.0, 199.0, 379.0, None]
    assert plans[0]["max_companies"] == 1 and plans[0]["max_users_per_company"] == 5 and plans[0]["max_storage_mb"] == 20480
    assert all(set(p) == {
        "tier", "label", "price_monthly_usd", "max_companies", "max_users_per_company",
        "monthly_ai_budget_usd", "max_storage_mb", "allowances", "features",
    } for p in plans)
    assert [p["allowances"]["positions_per_month"] for p in plans] == [10, 15, 25, None]
    assert [p["allowances"]["interviews_per_position"] for p in plans] == [10, 15, 20, None]
    assert [p["allowances"]["resumes_per_position"] for p in plans] == [500, 750, 1000, None]


async def test_each_plan_lists_every_feature_with_the_catalogue_labels(world):
    plans = {p["tier"]: p for p in (await world.client.get(f"{API}/plans")).json()["plans"]}
    for plan in plans.values():
        assert [f["key"] for f in plan["features"]] == list(plan_service.FEATURES)
        assert all(f["label"] == plan_service.FEATURE_LABELS[f["key"]] for f in plan["features"])
    included = {t: {f["key"] for f in p["features"] if f["included"]} for t, p in plans.items()}
    assert "coding" in included["starter"] and "integrations" not in included["starter"]
    assert "performance" not in included["growth"] and "workflows" in included["growth"]
    assert "oidc_sso" not in included["max"] and "custom_domain" not in included["max"] and "performance" in included["max"]
    assert included["enterprise"] == set(plan_service.FEATURES)


async def test_a_message_is_stored_for_the_platform_team_and_answered_with_a_reference(world):
    response = await world.client.post(f"{API}/contact", json=GOOD)
    assert response.status_code == 200, response.text
    body = response.json()
    (row,) = rows(world)
    assert body["status"] == "received" and body["reference"] == row["request_id"].split("-")[0].upper()
    assert row["name"] == "Sara Khan" and row["email"] == "sara@example.com" and row["company"] == "Globex"
    assert row["topic"] == "sales" and row["status"] == "new" and row["handled_by"] is None and row["source"] == "website"
    assert "company_id" not in row
    assert any(k.startswith("public:site_contact:ip:") for k in world.keys)


@pytest.mark.parametrize("change,message", [
    ({"name": "S"}, "Enter your name."),
    ({"name": "x" * 121}, "Your name must be at most 120 characters."),
    ({"email": "not-an-email"}, "Enter a valid email address."),
    ({"company": "c" * 161}, "The company name must be at most 160 characters."),
    ({"topic": "spam"}, "Choose what your message is about."),
    ({"message": "short"}, "Write at least 10 characters so we can help."),
    ({"message": "m" * 4001}, "Your message must be at most 4000 characters."),
    ({"consent": False}, "Please agree that we may use your details to reply."),
])
async def test_a_bad_message_is_refused_with_a_clear_reason_and_stores_nothing(world, change, message):
    response = await world.client.post(f"{API}/contact", json={**GOOD, **change})
    assert response.status_code == 400 and response.json()["detail"] == message
    assert rows(world) == []


async def test_a_filled_honeypot_gets_the_normal_answer_and_stores_nothing(world):
    response = await world.client.post(f"{API}/contact", json={**GOOD, "website": "https://spam.example"})
    assert response.status_code == 200 and response.json() == {"status": "received", "reference": ""}
    assert rows(world) == []


async def test_sending_the_same_message_twice_in_a_row_is_stored_once(world):
    first = await world.client.post(f"{API}/contact", json=GOOD)
    second = await world.client.post(f"{API}/contact", json=GOOD)
    assert first.json() == second.json() and len(rows(world)) == 1

    rows(world)[0]["created_at"] = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    await world.client.post(f"{API}/contact", json=GOOD)
    assert len(rows(world)) == 2


async def test_the_limiters_own_answer_is_passed_on(world, monkeypatch):
    async def limited(db, *, key, limit, window_seconds):
        raise HTTPException(429, "Too many attempts: please try again later")

    monkeypatch.setattr(rate_limit, "enforce_rate_limit", limited)
    response = await world.client.post(f"{API}/contact", json=GOOD)
    assert response.status_code == 429 and rows(world) == []


async def test_a_missing_database_is_a_503_not_a_crash(world, monkeypatch):
    monkeypatch.setattr(site_service, "get_platform_db", lambda: None)
    response = await world.client.post(f"{API}/contact", json=GOOD)
    assert response.status_code == 503


async def test_only_a_platform_owner_can_read_the_inbox(world):
    assert (await world.client.get("/api/v1/platform/contact-requests")).status_code == 401
    assert (await world.client.get("/api/v1/platform/contact-requests", headers=COMPANY_ADMIN)).status_code == 403
    assert (await world.client.get("/api/v1/platform/contact-requests", headers=PLATFORM)).status_code == 200
    assert (await world.client.patch("/api/v1/platform/contact-requests/x", headers=COMPANY_ADMIN, json={"status": "done"})).status_code == 403
    assert (await world.client.delete("/api/v1/platform/contact-requests/x", headers=COMPANY_ADMIN)).status_code == 403


async def test_the_inbox_lists_newest_first_with_counts_and_filters(world):
    seed(world, topic="sales", name="Ada Lovelace", company="Analytical")
    seed(world, topic="privacy", status="done")
    seed(world, topic="sales", status="in_progress", message="Please call us about the Growth plan.")
    seed(world, topic="security", status="spam")

    everything = (await world.client.get("/api/v1/platform/contact-requests", headers=PLATFORM)).json()
    assert everything["total"] == 4 and everything["counts"] == {"new": 1, "in_progress": 1, "done": 1, "spam": 1}
    assert [r["created_at"] for r in everything["items"]] == sorted((r["created_at"] for r in everything["items"]), reverse=True)
    assert all("_id" not in r for r in everything["items"])

    sales = (await world.client.get("/api/v1/platform/contact-requests?topic=sales", headers=PLATFORM)).json()
    assert sales["total"] == 2
    open_ones = (await world.client.get("/api/v1/platform/contact-requests?status=new", headers=PLATFORM)).json()
    assert open_ones["total"] == 1 and open_ones["items"][0]["name"] == "Ada Lovelace"
    found = (await world.client.get("/api/v1/platform/contact-requests?q=growth", headers=PLATFORM)).json()
    assert found["total"] == 1 and found["items"][0]["status"] == "in_progress"
    by_company = (await world.client.get("/api/v1/platform/contact-requests?q=analytical", headers=PLATFORM)).json()
    assert by_company["total"] == 1


async def test_the_inbox_pages(world):
    for _ in range(5):
        seed(world)
    page = (await world.client.get("/api/v1/platform/contact-requests?limit=2&page=3", headers=PLATFORM)).json()
    assert page["total"] == 5 and page["pages"] == 3 and len(page["items"]) == 1 and page["page"] == 3
    assert (await world.client.get("/api/v1/platform/contact-requests?limit=500", headers=PLATFORM)).status_code == 422


async def test_a_request_can_be_triaged_and_the_change_is_audited(world):
    row = seed(world)
    url = f"/api/v1/platform/contact-requests/{row['request_id']}"
    response = await world.client.patch(url, headers=PLATFORM, json={"status": "in_progress", "note": "Called on Monday"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "in_progress" and body["note"] == "Called on Monday" and body["handled_by"] == "demo-superadmin@hirely.ai"
    assert world.audits == [(
        "demo-superadmin@hirely.ai", "contact_request_update", "contact_request", row["request_id"],
        {"status": "in_progress", "note": "Called on Monday"},
    )]


@pytest.mark.parametrize("payload,status", [
    ({}, 400),
    ({"status": "archived"}, 422),
    ({"note": "n" * 1001}, 400),
])
async def test_a_bad_triage_request_is_refused(world, payload, status):
    row = seed(world)
    response = await world.client.patch(f"/api/v1/platform/contact-requests/{row['request_id']}", headers=PLATFORM, json=payload)
    assert response.status_code == status
    assert rows(world)[0]["status"] == "new" and world.audits == []


async def test_triaging_or_deleting_an_unknown_request_is_a_404(world):
    assert (await world.client.patch("/api/v1/platform/contact-requests/nope", headers=PLATFORM, json={"status": "done"})).status_code == 404
    assert (await world.client.delete("/api/v1/platform/contact-requests/nope", headers=PLATFORM)).status_code == 404


async def test_a_request_can_be_deleted_and_the_deletion_is_audited(world):
    row = seed(world)
    response = await world.client.delete(f"/api/v1/platform/contact-requests/{row['request_id']}", headers=PLATFORM)
    assert response.status_code == 200 and rows(world) == []
    assert world.audits[-1][1:4] == ("contact_request_delete", "contact_request", row["request_id"])
