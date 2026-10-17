import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from jose import jwt
from passlib.context import CryptContext

from config.database import get_db, get_platform_db
from config.settings import settings
from config.tenancy import DEFAULT_COMPANY_ID, company_context
from config.tenancy_migration import client_doc, company_doc
from services.hr_module import plan_service

pytestmark = pytest.mark.anyio

API = "/api/v1"
PASSWORD = "Password-123!"
_pwd = CryptContext(schemes=["bcrypt"])
KEEP = {"clients", "companies", "settings", "rate_limits", "sso_states", "otp_logs", "password_tokens"}


def _jwt(email: str) -> dict:
    token = jwt.encode(
        {"sub": email, "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
        settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM,
    )
    return {"Authorization": f"Bearer {token}"}


def _ago(**delta) -> str:
    return (datetime.now(timezone.utc) - timedelta(**delta)).isoformat()


@pytest.fixture(autouse=True)
def _no_real_mail(monkeypatch):
    from services.hr_module import email_service

    async def nothing(**kwargs):
        return True

    monkeypatch.setattr(email_service, "send_email", nothing)


@pytest.fixture
async def make_company():
    made: list[SimpleNamespace] = []
    raw = get_platform_db()

    async def make(*, plan: dict | None = None) -> SimpleNamespace:
        tag = uuid.uuid4().hex[:8]
        client_id, company_id = f"cli_u{tag}", f"cmp_u{tag}"
        client = client_doc(client_id, f"Usage Client {tag}", f"usage-client-{tag}")
        client["plan"] = {**client["plan"], **(plan or {})}
        await raw.clients.insert_one(client)
        await raw.companies.insert_one(company_doc(company_id, client_id, f"Usage Co {tag}", f"usage-co-{tag}"))
        accounts = {}
        for role in ("superadmin", "standard"):
            email = f"usage-{role}-{tag}@example.com"
            await raw.users.insert_one({
                "name": role.title(), "email": email, "role": role, "is_active": True,
                "company_id": company_id, "password_hash": _pwd.hash(PASSWORD),
            })
            accounts[role] = email
        company = SimpleNamespace(
            client_id=client_id, company_id=company_id, admin_email=accounts["superadmin"],
            admin=_jwt(accounts["superadmin"]), standard=_jwt(accounts["standard"]), emails=list(accounts.values()),
        )
        made.append(company)
        return company

    yield make

    for company in made:
        for name in await raw.list_collection_names():
            if name not in KEEP and not name.startswith("system."):
                await raw[name].delete_many({"company_id": company.company_id})
        await raw.rate_limits.delete_many({"_id": {"$regex": f"^co:{company.company_id}:"}})
        await raw.settings.delete_many({"_id": {"$regex": f"^alert:.*{company.company_id}"}})
        await raw.users.delete_many({"email": {"$in": company.emails}})
        await raw.companies.delete_many({"company_id": company.company_id})
        await raw.clients.delete_many({"client_id": company.client_id})


async def _spend(company_id: str, *amounts: float, created_at: str | None = None) -> None:
    with company_context(company_id):
        await get_db().cost_ledger.insert_many([
            {"source": "test", "cost_usd": amount, "llm_calls": 1, "created_at": created_at or datetime.now(timezone.utc).isoformat()}
            for amount in amounts
        ])


def _this_month() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


async def test_usage_of_a_company_with_no_plan_limits_has_the_documented_shape(client, admin_headers):
    r = await client.get(f"{API}/company-settings/usage", headers=admin_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"plan", "users", "ai", "emails_30d", "storage", "features", "subscription"}
    assert body["plan"] == {"name": "", "max_users_per_company": None, "monthly_ai_budget_usd": None}
    assert set(body["storage"]) == {"used_mb", "limit_mb"} and body["storage"]["limit_mb"] is None
    assert body["features"] == {flag: True for flag in plan_service.FEATURES}
    assert body["subscription"]["status"] == "none" and body["subscription"]["trial_ends_at"] is None
    assert set(body["users"]) == {"used", "limit"} and body["users"]["limit"] is None and body["users"]["used"] >= 0
    assert set(body["ai"]) == {"month", "used_usd", "budget_usd", "percent"}
    assert body["ai"]["month"] == _this_month() and body["ai"]["budget_usd"] is None and body["ai"]["percent"] is None
    assert isinstance(body["ai"]["used_usd"], (int, float)) and isinstance(body["emails_30d"], int)


async def test_usage_is_admin_only(client, make_company, standard_headers):
    company = await make_company()
    assert (await client.get(f"{API}/company-settings/usage", headers=standard_headers)).status_code == 403
    assert (await client.get(f"{API}/company-settings/usage", headers=company.standard)).status_code == 403
    assert (await client.get(f"{API}/company-settings/usage")).status_code == 401
    assert (await client.get(f"{API}/company-settings/usage", headers=company.admin)).status_code == 200


async def test_usage_reads_the_plan_the_seats_and_this_months_spend(client, make_company):
    company = await make_company(plan={"name": "pro", "max_users_per_company": 5, "monthly_ai_budget_usd": 10.0})
    other = await make_company(plan={"monthly_ai_budget_usd": 10.0})
    cid = company.company_id
    start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    await _spend(cid, 2.5, 1.0)
    await _spend(cid, 7.0, created_at=(start - timedelta(seconds=1)).isoformat())
    await _spend(other.company_id, 4.0)
    with company_context(cid):
        db = get_db()
        await db.users.insert_many([
            {"name": "A", "email": f"extra-a-{cid}@example.com", "role": "standard", "is_active": True},
            {"name": "B", "email": f"extra-b-{cid}@example.com", "role": "standard", "is_active": True},
            {"name": "Off", "email": f"extra-c-{cid}@example.com", "role": "standard", "is_active": False},
        ])
        await db.email_log.insert_many([
            {"to": "x@example.com", "status": status, "created_at": when}
            for status, when in [
                ("sent", _ago(days=1)), ("sent", _ago(days=2)), ("sent", _ago(days=29)),
                ("sent", _ago(days=31)), ("failed", _ago(days=1)), ("not_sent", _ago(days=1)),
            ]
        ])

    body = (await client.get(f"{API}/company-settings/usage", headers=company.admin)).json()
    assert body["plan"] == {"name": "pro", "max_users_per_company": 5, "monthly_ai_budget_usd": 10.0}
    assert body["users"] == {"used": 4, "limit": 5}
    assert body["ai"] == {"month": _this_month(), "used_usd": 3.5, "budget_usd": 10.0, "percent": 35.0}
    assert body["emails_30d"] == 3

    quiet = (await client.get(f"{API}/company-settings/usage", headers=other.admin)).json()
    assert quiet["ai"]["used_usd"] == 4.0 and quiet["emails_30d"] == 0 and quiet["users"] == {"used": 2, "limit": None}


async def test_usage_goes_past_a_hundred_percent_when_the_budget_is_overspent(client, make_company):
    company = await make_company(plan={"monthly_ai_budget_usd": 2.0})
    await _spend(company.company_id, 3.0)
    ai = (await client.get(f"{API}/company-settings/usage", headers=company.admin)).json()["ai"]
    assert ai["used_usd"] == 3.0 and ai["budget_usd"] == 2.0 and ai["percent"] == 150.0


async def test_emails_count_only_what_left_in_the_last_thirty_days(client, admin_headers):
    marker = uuid.uuid4().hex[:8]
    before = (await client.get(f"{API}/company-settings/usage", headers=admin_headers)).json()["emails_30d"]
    with company_context(DEFAULT_COMPANY_ID):
        rows = [
            {"to": f"count-{marker}@example.com", "status": status, "created_at": when}
            for status, when in [("sent", _ago(minutes=5)), ("sent", _ago(days=10)), ("sent", _ago(days=40)), ("failed", _ago(minutes=5))]
        ]
        await get_db().email_log.insert_many(rows)
    try:
        after = (await client.get(f"{API}/company-settings/usage", headers=admin_headers)).json()["emails_30d"]
    finally:
        with company_context(DEFAULT_COMPANY_ID):
            await get_db().email_log.delete_many({"to": f"count-{marker}@example.com"})
    assert after - before == 2


STEP_KEYS = ["profile", "branding", "users", "job", "resume"]


def _done(body: dict) -> dict:
    return {s["key"]: s["done"] for s in body["steps"]}


async def test_onboarding_follows_what_the_company_has_actually_done(client, make_company):
    company = await make_company()
    cid, admin = company.company_id, company.admin
    url = f"{API}/company-settings/onboarding"

    fresh = (await client.get(url, headers=admin)).json()
    assert set(fresh) == {"steps", "dismissed"} and fresh["dismissed"] is False
    assert [s["key"] for s in fresh["steps"]] == STEP_KEYS
    assert all(set(s) == {"key", "label", "done"} and s["label"].strip() for s in fresh["steps"])
    assert _done(fresh) == {"profile": False, "branding": False, "users": True, "job": False, "resume": False}

    assert (await client.get(f"{API}/branding", headers=admin)).status_code == 200
    assert (await client.get(f"{API}/company-settings", headers=admin)).status_code == 200
    assert _done((await client.get(url, headers=admin)).json())["branding"] is False
    assert _done((await client.get(url, headers=admin)).json())["profile"] is False

    assert (await client.patch(f"{API}/company-settings", headers=admin, json={"company_name": "   "})).status_code == 200
    assert _done((await client.get(url, headers=admin)).json())["profile"] is False
    assert (await client.patch(f"{API}/company-settings", headers=admin, json={"company_name": "Acme Widgets"})).status_code == 200
    assert _done((await client.get(url, headers=admin)).json())["profile"] is True

    assert (await client.patch(f"{API}/branding", headers=admin, json={"primary_color": "#112233"})).status_code == 200
    assert _done((await client.get(url, headers=admin)).json())["branding"] is True

    with company_context(cid):
        await get_db().jobs.insert_one({"doc_type": "job", "job_id": f"job-ob-{cid}", "title": "T", "description": "d", "created_at": _ago(minutes=1)})
    assert _done((await client.get(url, headers=admin)).json())["job"] is True
    assert _done((await client.get(url, headers=admin)).json())["resume"] is False
    with company_context(cid):
        await get_db().resumes.insert_one({"resume_id": f"res-ob-{cid}", "processing_status": "pending", "created_at": _ago(minutes=1)})
    assert _done((await client.get(url, headers=admin)).json()) == {
        "profile": True, "branding": True, "users": True, "job": True, "resume": True,
    }


async def test_a_company_with_only_its_administrator_has_not_added_a_teammate(client, make_company):
    company = await make_company()
    raw = get_platform_db()
    await raw.users.delete_many({"email": company.emails[1]})
    assert _done((await client.get(f"{API}/company-settings/onboarding", headers=company.admin)).json())["users"] is False
    with company_context(company.company_id):
        await get_db().users.insert_one({"name": "Mate", "email": f"mate-{company.company_id}@example.com", "role": "standard", "is_active": True})
    assert _done((await client.get(f"{API}/company-settings/onboarding", headers=company.admin)).json())["users"] is True


async def test_a_logo_alone_completes_the_branding_step(client, make_company):
    company = await make_company()
    with company_context(company.company_id):
        await get_db().branding_settings.insert_one({
            "_id": "singleton", "company_logo_url": "https://cdn.example.com/logo.png",
            "primary_color": "#4778f3", "accent_color": "#222022",
        })
    body = (await client.get(f"{API}/company-settings/onboarding", headers=company.admin)).json()
    assert _done(body)["branding"] is True


async def test_dismissing_hides_the_checklist_for_this_company_only_and_is_audited(client, make_company):
    company, other = await make_company(), await make_company()
    url = f"{API}/company-settings/onboarding"

    first = await client.post(f"{url}/dismiss", headers=company.admin)
    assert first.status_code == 200 and first.json() == {"dismissed": True}
    again = await client.post(f"{url}/dismiss", headers=company.admin)
    assert again.status_code == 200 and again.json() == {"dismissed": True}

    seen = (await client.get(url, headers=company.admin)).json()
    assert seen["dismissed"] is True and [s["key"] for s in seen["steps"]] == STEP_KEYS
    assert (await client.get(url, headers=other.admin)).json()["dismissed"] is False

    profile = (await client.get(f"{API}/company-settings", headers=company.admin)).json()
    assert profile["onboarding_dismissed"] is True and profile["company_name"] == "" and profile["created_at"]
    assert "onboarding_dismissed" not in (await client.get(f"{API}/company-settings", headers=other.admin)).json()
    saved = await client.patch(f"{API}/company-settings", headers=company.admin, json={"company_name": "Acme"})
    assert saved.json()["onboarding_dismissed"] is True and saved.json()["company_name"] == "Acme"
    assert (await client.get(url, headers=company.admin)).json()["dismissed"] is True

    with company_context(company.company_id):
        rows = await get_db().audit_log.find({"action": "onboarding_dismiss"}, {"_id": 0}).to_list(10)
    assert len(rows) == 2 and all(r["actor_email"] == company.admin_email for r in rows)


async def test_onboarding_is_admin_only(client, make_company, standard_headers):
    company = await make_company()
    url = f"{API}/company-settings/onboarding"
    for headers in (standard_headers, company.standard):
        assert (await client.get(url, headers=headers)).status_code == 403
        assert (await client.post(f"{url}/dismiss", headers=headers)).status_code == 403
    assert (await client.get(url)).status_code == 401 and (await client.post(f"{url}/dismiss")).status_code == 401
    assert (await client.get(url, headers=company.admin)).json()["dismissed"] is False


def _upload():
    return {"file": ("cv.txt", b"A short resume", "text/plain")}


def _bulk():
    return [("files", ("cv.txt", b"A short resume", "text/plain"))]


GUARDED = [
    ("post", "/coding/questions/generate", lambda: {"json": {"job_domain": "backend"}}),
    ("post", "/jobs", lambda: {"json": {"title": "Engineer", "description": "Build things"}}),
    ("post", "/jobs/rematch-all", lambda: {}),
    ("post", "/jobs/import", lambda: {"json": {"source": "any"}}),
    ("post", "/jobs/scheduled-sync", lambda: {}),
    ("post", "/candidates/cand-none/interview-guide", lambda: {}),
    ("post", "/offers/off-none/draft-letter", lambda: {}),
    ("post", "/resumes/upload", lambda: {"files": _upload()}),
    ("post", "/intel/resumes/upload-bulk", lambda: {"files": _bulk()}),
]
BUDGET_MESSAGE = "This company has used its monthly AI budget ($0.50 of $0.25). Ask your administrator to raise it."


async def test_an_exhausted_budget_stops_every_admin_started_ai_action(client, make_company):
    company = await make_company(plan={"monthly_ai_budget_usd": 0.25})
    await _spend(company.company_id, 0.5)
    for method, path, kwargs in GUARDED:
        r = await client.request(method, f"{API}{path}", headers=company.admin, **kwargs())
        assert r.status_code == 402, f"{method} {path}: {r.status_code} {r.text[:120]}"
        assert r.json()["detail"] == BUDGET_MESSAGE, path

    with company_context(company.company_id):
        await get_db().jobs.insert_one({"doc_type": "job", "job_id": "job-edit", "title": "Old", "description": "Old text", "created_at": _ago(minutes=1)})
    blocked = await client.patch(f"{API}/jobs/job-edit", headers=company.admin, json={"description": "New text"})
    assert blocked.status_code == 402 and blocked.json()["detail"] == BUDGET_MESSAGE
    with company_context(company.company_id):
        assert (await get_db().jobs.find_one({"job_id": "job-edit"}))["description"] == "Old text"
    renamed = await client.patch(f"{API}/jobs/job-edit", headers=company.admin, json={"title": "Renamed"})
    assert renamed.status_code == 200 and renamed.json()["title"] == "Renamed"


async def test_reading_and_everything_a_candidate_does_stay_open_when_the_budget_is_spent(client, make_company):
    company = await make_company(plan={"monthly_ai_budget_usd": 0.25})
    await _spend(company.company_id, 0.5)
    token = f"tok-{uuid.uuid4().hex}"
    with company_context(company.company_id):
        await get_db().offers.insert_one({"offer_id": f"off-{token[:12]}", "secure_token": token, "status": "sent", "salary": 1})

    public = await client.get(f"{API}/offers/public/{token}")
    assert public.status_code == 200 and public.json()["status"] == "sent"
    assert (await client.get(f"{API}/jobs", headers=company.admin)).status_code == 200
    usage = await client.get(f"{API}/company-settings/usage", headers=company.admin)
    assert usage.status_code == 200 and usage.json()["ai"]["percent"] == 200.0


async def test_the_guard_lets_work_through_when_there_is_room_or_no_budget(client, make_company):
    roomy = await make_company(plan={"monthly_ai_budget_usd": 100.0})
    await _spend(roomy.company_id, 0.5)
    unlimited = await make_company()
    await _spend(unlimited.company_id, 1000.0)
    zero = await make_company(plan={"monthly_ai_budget_usd": 0})
    await _spend(zero.company_id, 5.0)
    for company in (roomy, unlimited, zero):
        generate = await client.post(f"{API}/coding/questions/generate", headers=company.admin, json={})
        assert generate.status_code == 422, generate.text
        job = await client.post(f"{API}/jobs", headers=company.admin, json={})
        assert job.status_code == 422, job.text
        guide = await client.post(f"{API}/candidates/cand-none/interview-guide", headers=company.admin)
        offer = await client.post(f"{API}/offers/off-none/draft-letter", headers=company.admin)
        assert guide.status_code != 402 and offer.status_code != 402


async def test_spending_exactly_the_budget_is_over_it_and_last_months_spend_does_not_count(client, make_company):
    company = await make_company(plan={"monthly_ai_budget_usd": 0.5})
    start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    await _spend(company.company_id, 9.0, created_at=(start - timedelta(seconds=1)).isoformat())
    assert (await client.post(f"{API}/coding/questions/generate", headers=company.admin, json={})).status_code == 422
    await _spend(company.company_id, 0.5, created_at=start.isoformat())
    assert (await client.post(f"{API}/coding/questions/generate", headers=company.admin, json={})).status_code == 402


async def test_raising_the_budget_lifts_the_block_at_once(client, make_company):
    company = await make_company(plan={"monthly_ai_budget_usd": 0.25})
    await _spend(company.company_id, 0.5)
    url = f"{API}/coding/questions/generate"
    assert (await client.post(url, headers=company.admin, json={})).status_code == 402
    await get_platform_db().clients.update_one({"client_id": company.client_id}, {"$set": {"plan.monthly_ai_budget_usd": 5.0}})
    assert (await client.post(url, headers=company.admin, json={})).status_code == 422
    await get_platform_db().clients.update_one({"client_id": company.client_id}, {"$set": {"plan.monthly_ai_budget_usd": None}})
    assert (await client.post(url, headers=company.admin, json={})).status_code == 422


async def test_one_companys_budget_never_blocks_another(client, make_company):
    spent, fine = await make_company(plan={"monthly_ai_budget_usd": 0.25}), await make_company(plan={"monthly_ai_budget_usd": 0.25})
    await _spend(spent.company_id, 0.5)
    url = f"{API}/coding/questions/generate"
    assert (await client.post(url, headers=spent.admin, json={})).status_code == 402
    assert (await client.post(url, headers=fine.admin, json={})).status_code == 422


async def test_a_caller_who_may_not_use_the_route_is_told_so_and_spends_nothing(client, make_company):
    company = await make_company(plan={"monthly_ai_budget_usd": 0.25})
    await _spend(company.company_id, 0.5)
    url = f"{API}/coding/questions/generate"
    assert (await client.post(url, headers=company.standard, json={"job_domain": "backend"})).status_code == 403
    assert (await client.post(url, json={"job_domain": "backend"})).status_code == 401
    counters = await get_platform_db().rate_limits.count_documents({"_id": {"$regex": f"^co:{company.company_id}:"}})
    assert counters == 0


async def _fill_the_hour(company_id: str, scope: str, count: int) -> None:
    now = datetime.now(timezone.utc).timestamp()
    window = int(now // 3600) * 3600
    await get_platform_db().rate_limits.insert_many([
        {"_id": f"co:{company_id}:{scope}:{start}", "count": count, "expires_at": datetime.fromtimestamp(start + 3600, tz=timezone.utc)}
        for start in (window, window + 3600)
    ])


async def test_a_company_that_starts_too_many_ai_actions_in_an_hour_is_slowed_down(client, make_company):
    busy, calm = await make_company(), await make_company()
    await _fill_the_hour(busy.company_id, "coding_generate", 120)
    url = f"{API}/coding/questions/generate"
    refused = await client.post(url, headers=busy.admin, json={})
    assert refused.status_code == 429 and "try again later" in refused.json()["detail"]
    assert (await client.post(url, headers=calm.admin, json={})).status_code == 422
    other_scope = await client.post(f"{API}/jobs", headers=busy.admin, json={})
    assert other_scope.status_code == 422


async def test_only_actions_that_got_past_the_role_check_use_the_allowance(client, make_company):
    company = await make_company()
    await _fill_the_hour(company.company_id, "coding_generate", 118)
    url = f"{API}/coding/questions/generate"
    for _ in range(3):
        assert (await client.post(url, headers=company.standard, json={})).status_code == 403
    assert (await client.post(url, headers=company.admin, json={})).status_code == 422
    assert (await client.post(url, headers=company.admin, json={})).status_code == 422
    assert (await client.post(url, headers=company.admin, json={})).status_code == 429


async def test_public_routes_have_no_allowance_to_exhaust(client, make_company):
    company = await make_company()
    token = f"tok-{uuid.uuid4().hex}"
    with company_context(company.company_id):
        await get_db().offers.insert_one({"offer_id": f"off-{token[:12]}", "secure_token": token, "status": "sent"})
    for scope in ("coding_generate", "jobs", "resumes", "guide", "offer_draft"):
        await _fill_the_hour(company.company_id, scope, 100000)
    assert (await client.get(f"{API}/offers/public/{token}")).status_code == 200
