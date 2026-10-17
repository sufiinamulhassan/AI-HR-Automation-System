import uuid
from datetime import datetime, timedelta, timezone

import pytest
from jose import jwt
from passlib.context import CryptContext

from config import tenancy
from config.database import get_db, get_platform_db
from config.settings import settings
from config.tenancy import DEFAULT_COMPANY_ID, company_context
from config.tenancy_migration import client_doc, company_doc

pytestmark = pytest.mark.anyio

API = "/api/v1"
A = DEFAULT_COMPANY_ID
NOW = "2026-01-01T00:00:00+00:00"
_pwd = CryptContext(schemes=["bcrypt"])


def _admin(company: str) -> dict:
    return {"Authorization": f"Bearer demo-admin-token@@{company}"}


def _superadmin(company: str) -> dict:
    return {"Authorization": f"Bearer demo-superadmin-token@@{company}"}


def _jwt(email: str) -> dict:
    token = jwt.encode(
        {"sub": email, "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
        settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM,
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def b():
    tag = uuid.uuid4().hex[:8]
    client_id, company_id = f"cli_t{tag}", f"cmp_t{tag}"
    raw = get_platform_db()
    await raw.clients.insert_one(client_doc(client_id, f"Client {tag}", f"client-{tag}"))
    await raw.companies.insert_one(company_doc(company_id, client_id, f"Company {tag}", f"company-{tag}"))
    yield company_id
    for name in await raw.list_collection_names():
        if name not in ("clients", "companies", "settings"):
            await raw[name].delete_many({"company_id": company_id})
    await raw.companies.delete_many({"company_id": company_id})
    await raw.clients.delete_many({"client_id": client_id})


@pytest.fixture
def no_fallback():
    previous = tenancy._fallback_company_id
    tenancy.use_fallback_company(None)
    yield
    tenancy.use_fallback_company(previous)


async def _seed_job(company: str, tag: str, **extra) -> str:
    job_id = f"job-iso-{tag}"
    with company_context(company):
        await get_db().jobs.insert_one({
            "doc_type": "job", "job_id": job_id, "title": f"Isolation {tag}", "description": "d",
            "created_at": NOW, "candidate_pipeline": [], **extra,
        })
    return job_id


async def test_a_company_cannot_list_anothers_jobs(client, b):
    tag = uuid.uuid4().hex[:8]
    job_id = await _seed_job(A, tag)
    try:
        seen_by_a = await client.get(f"{API}/jobs?limit=500", headers=_admin(A))
        seen_by_b = await client.get(f"{API}/jobs?limit=500", headers=_admin(b))
        assert seen_by_a.status_code == 200 and seen_by_b.status_code == 200
        assert job_id in {j["job_id"] for j in seen_by_a.json().get("jobs", seen_by_a.json())}
        assert job_id not in str(seen_by_b.json())
    finally:
        with company_context(A):
            await get_db().jobs.delete_many({"job_id": job_id})


async def test_a_company_cannot_open_change_or_delete_anothers_job_by_id(client, b):
    tag = uuid.uuid4().hex[:8]
    job_id = await _seed_job(A, tag)
    try:
        for method, url, body in (
            ("get", f"{API}/jobs/{job_id}/comparison", None),
            ("patch", f"{API}/jobs/{job_id}", {"title": "hijacked"}),
        ):
            r = await client.request(method, url, headers=_superadmin(b), json=body)
            assert r.status_code in (404, 405), (method, url, r.status_code)
        gone = await client.request("delete", f"{API}/jobs/{job_id}", headers=_superadmin(b))
        assert gone.status_code in (200, 404)
        with company_context(A):
            still = await get_db().jobs.find_one({"job_id": job_id})
        assert still is not None and still["title"] == f"Isolation {tag}"
    finally:
        with company_context(A):
            await get_db().jobs.delete_many({"job_id": job_id})


async def test_one_company_can_never_write_into_another(b):
    with company_context(b):
        await get_db().jobs.insert_one({"job_id": "job-forged", "company_id": A, "title": "forged"})
    raw = get_platform_db()
    row = await raw.jobs.find_one({"job_id": "job-forged"})
    try:
        assert row["company_id"] == b
        with company_context(A):
            assert await get_db().jobs.find_one({"job_id": "job-forged"}) is None
    finally:
        await raw.jobs.delete_many({"job_id": "job-forged"})


async def test_unbound_database_access_fails_closed(no_fallback):
    with pytest.raises(tenancy.TenantContextMissing):
        get_db()


async def test_users_are_per_company_and_emails_are_platform_wide(client, b):
    tag = uuid.uuid4().hex[:8]
    email_b = f"only-b-{tag}@example.com"
    with company_context(b):
        await get_db().users.insert_one({
            "name": "B Person", "email": email_b, "password_hash": _pwd.hash("x"), "role": "standard",
            "is_active": True, "created_at": NOW,
        })
    try:
        listed_a = await client.get(f"{API}/auth/users", headers=_superadmin(A))
        listed_b = await client.get(f"{API}/auth/users", headers=_superadmin(b))
        assert email_b not in str(listed_a.json())
        assert email_b in str(listed_b.json())

        assert (await client.patch(f"{API}/auth/users/{email_b}", headers=_superadmin(A), json={"name": "x"})).status_code == 404
        assert (await client.post(
            f"{API}/auth/admin/reset-password", headers=_superadmin(A),
            json={"email": email_b, "new_password": "Password-123!"},
        )).status_code == 404

        dup = await client.post(
            f"{API}/auth/users", headers=_superadmin(A),
            json={"name": "Dup", "email": email_b, "password": "Password-123!", "role": "standard"},
        )
        assert dup.status_code == 400
        assert "Company" not in dup.text and b not in dup.text
    finally:
        await get_platform_db().users.delete_many({"email": email_b})


async def test_each_company_has_its_own_roles_departments_and_audit_trail(client, b):
    name = f"Iso-{uuid.uuid4().hex[:6]}"
    try:
        for company in (A, b):
            role = await client.post(
                f"{API}/rbac/roles", headers=_superadmin(company),
                json={"role_name": name, "permissions": ["jobs:read"]},
            )
            assert role.status_code in (200, 201), role.text
            dept = await client.post(f"{API}/admin/departments", headers=_superadmin(company), json={"name": name})
            assert dept.status_code in (200, 201), dept.text

        roles_a = (await client.get(f"{API}/rbac/roles", headers=_superadmin(A))).json()["custom_roles"]
        assert [r["role_name"] for r in roles_a].count(name) == 1

        patch = await client.patch(
            f"{API}/rbac/roles/{name}", headers=_superadmin(b), json={"permissions": ["jobs:read", "jobs:create"]},
        )
        assert patch.status_code == 200
        role_a = (await client.get(f"{API}/rbac/roles/{name}", headers=_superadmin(A))).json()
        assert role_a["permissions"] == ["jobs:read"]

        audit_a = (await client.get(f"{API}/rbac/audit-log?limit=200", headers=_superadmin(A))).text
        audit_b = (await client.get(f"{API}/rbac/audit-log?limit=200", headers=_superadmin(b))).text
        assert audit_a.count(name) and audit_b.count(name)
        assert "role_update" in audit_b
    finally:
        for company in (A, b):
            await client.delete(f"{API}/rbac/roles/{name}", headers=_superadmin(company))
            with company_context(company):
                await get_db().departments.delete_many({"name": name})


async def test_settings_documents_do_not_collide_between_companies(client, b):
    color_a, color_b = "#112233", "#445566"
    brand_before = (await client.get(f"{API}/branding", headers=_admin(A))).json()["primary_color"]
    name_before = (await client.get(f"{API}/company-settings", headers=_admin(A))).json()["company_name"]
    try:
        ra = await client.patch(f"{API}/branding", headers=_admin(A), json={"primary_color": color_a})
        rb = await client.patch(f"{API}/branding", headers=_admin(b), json={"primary_color": color_b})
        assert ra.status_code == 200 and rb.status_code == 200
        assert (await client.get(f"{API}/branding", headers=_admin(A))).json()["primary_color"] == color_a
        assert (await client.get(f"{API}/branding", headers=_admin(b))).json()["primary_color"] == color_b

        ca = await client.patch(f"{API}/company-settings", headers=_admin(A), json={"company_name": "Alpha Co"})
        cb = await client.patch(f"{API}/company-settings", headers=_admin(b), json={"company_name": "Beta Co"})
        assert ca.status_code == 200 and cb.status_code == 200
        assert (await client.get(f"{API}/company-settings", headers=_admin(A))).json()["company_name"] == "Alpha Co"
        assert (await client.get(f"{API}/company-settings", headers=_admin(b))).json()["company_name"] == "Beta Co"

        raw = get_platform_db()
        ids = {d["_id"] async for d in raw.branding_settings.find({"company_id": {"$in": [A, b]}})}
        assert f"{A}:singleton" in ids and f"{b}:singleton" in ids
    finally:
        await client.patch(f"{API}/branding", headers=_admin(A), json={"primary_color": brand_before})
        await client.patch(f"{API}/company-settings", headers=_admin(A), json={"company_name": name_before})


async def test_security_policy_is_per_company(client, b):
    before = (await client.get(f"{API}/security-policies", headers=_superadmin(A))).json()["password_min_length"]
    try:
        ra = await client.patch(f"{API}/security-policies", headers=_superadmin(A), json={"password_min_length": 14})
        assert ra.status_code == 200, ra.text
        pol_b = (await client.get(f"{API}/security-policies", headers=_superadmin(b))).json()
        assert pol_b["password_min_length"] != 14
    finally:
        await client.patch(f"{API}/security-policies", headers=_superadmin(A), json={"password_min_length": before})


async def test_default_model_is_per_company(client, b):
    models = (await client.get(f"{API}/auth/models", headers=_admin(A))).json()
    ids = [m["id"] for m in models["models"]]
    assert len(ids) >= 2
    before = settings.DEFAULT_LLM_MODEL
    chosen = next(i for i in ids if i != models["current"])
    try:
        set_b = await client.patch(f"{API}/auth/models/default", headers=_admin(b), json={"default_model": chosen})
        assert set_b.status_code == 200, set_b.text
        assert (await client.get(f"{API}/auth/models", headers=_admin(A))).json()["current"] == models["current"]
        assert settings.DEFAULT_LLM_MODEL == before
        raw = get_platform_db()
        assert (await raw.companies.find_one({"company_id": b}))["settings"]["default_llm_model"] == chosen
    finally:
        await get_platform_db().companies.update_one({"company_id": b}, {"$unset": {"settings.default_llm_model": ""}})


async def _seed_offer(company: str, tag: str) -> str:
    token = f"tok_iso{tag}"
    with company_context(company):
        db = get_db()
        await db.jobs.insert_one({
            "doc_type": "job", "job_id": f"job-offer-{tag}", "title": "Offer Job", "description": "d",
            "company_name": f"Employer {tag}", "created_at": NOW, "candidate_pipeline": [],
        })
        await db.offers.insert_one({
            "offer_id": f"offer-{tag}", "job_id": f"job-offer-{tag}", "candidate_id": f"cand-{tag}",
            "secure_token": token, "status": "sent", "salary": "100", "created_at": NOW,
        })
    return token


async def test_a_public_link_works_for_its_own_company_with_nothing_else_bound(client, b, no_fallback):
    tag = uuid.uuid4().hex[:8]
    token_a, token_b = await _seed_offer(A, tag), await _seed_offer(b, f"{tag}b")
    try:
        ra = await client.get(f"{API}/offers/public/{token_a}")
        rb = await client.get(f"{API}/offers/public/{token_b}")
        assert ra.status_code == 200 and ra.json()["company_name"] == f"Employer {tag}"
        assert rb.status_code == 200 and rb.json()["company_name"] == f"Employer {tag}b"
        assert (await client.get(f"{API}/offers/public/tok_does_not_exist")).status_code == 404
    finally:
        raw = get_platform_db()
        for coll in ("offers", "jobs"):
            await raw[coll].delete_many({"company_id": {"$in": [A, b]}, "job_id": {"$regex": f"^job-offer-{tag}"}})
            await raw[coll].delete_many({"offer_id": {"$regex": f"^offer-{tag}"}})


async def test_a_signed_in_user_cannot_use_another_companys_public_token(client, b, no_fallback):
    tag = uuid.uuid4().hex[:8]
    await _seed_offer(A, tag)
    try:
        with company_context(b):
            assert await get_db().offers.find_one({"secure_token": f"tok_iso{tag}"}) is None
    finally:
        raw = get_platform_db()
        await raw.offers.delete_many({"offer_id": f"offer-{tag}"})
        await raw.jobs.delete_many({"job_id": f"job-offer-{tag}"})


async def test_a_suspended_company_loses_its_public_links(client, b, no_fallback):
    tag = uuid.uuid4().hex[:8]
    token = await _seed_offer(b, tag)
    raw = get_platform_db()
    try:
        assert (await client.get(f"{API}/offers/public/{token}")).status_code == 200
        await raw.companies.update_one({"company_id": b}, {"$set": {"status": "suspended"}})
        assert (await client.get(f"{API}/offers/public/{token}")).status_code == 404
        await raw.companies.update_one({"company_id": b}, {"$set": {"status": "active"}})
        assert (await client.get(f"{API}/offers/public/{token}")).status_code == 200
    finally:
        await raw.offers.delete_many({"offer_id": f"offer-{tag}b"})
        await raw.jobs.delete_many({"job_id": f"job-offer-{tag}b"})


async def _real_user(company: str, role: str = "admin") -> tuple[str, str]:
    tag = uuid.uuid4().hex[:8]
    email, password = f"iso-{tag}@example.com", "Password-123!"
    with company_context(company):
        await get_db().users.insert_one({
            "name": "Iso User", "email": email, "password_hash": _pwd.hash(password), "role": role,
            "is_active": True, "otp_required": False, "created_at": NOW,
        })
    return email, password


async def test_login_returns_the_workspace_and_binds_it(client, b):
    email, password = await _real_user(b, role="superadmin")
    try:
        r = await client.post(f"{API}/auth/login", json={"email": email, "password": password})
        assert r.status_code == 200, r.text
        user = r.json()["user"]
        assert user["company_id"] == b and user["workspace_kind"] == "workspace"
        assert user["is_platform_admin"] is False
        claims = jwt.get_unverified_claims(r.json()["access_token"])
        assert claims["cid"] == b

        me = await client.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {r.json()['access_token']}"})
        assert me.json()["company_id"] == b
        users = await client.get(f"{API}/auth/users", headers={"Authorization": f"Bearer {r.json()['access_token']}"})
        assert users.status_code == 200 and email in str(users.json()) and "hradmin@hirely.ai" not in str(users.json())
    finally:
        await get_platform_db().users.delete_many({"email": email})


async def test_a_suspended_company_cannot_sign_in_or_use_a_live_session(client, b):
    email, password = await _real_user(b)
    raw = get_platform_db()
    try:
        ok = await client.post(f"{API}/auth/login", json={"email": email, "password": password})
        token_headers = {"Authorization": f"Bearer {ok.json()['access_token']}"}
        assert (await client.get(f"{API}/auth/me", headers=token_headers)).status_code == 200

        await raw.companies.update_one({"company_id": b}, {"$set": {"status": "suspended"}})
        blocked = await client.post(f"{API}/auth/login", json={"email": email, "password": password})
        assert blocked.status_code == 403 and "suspended" in blocked.text.lower()
        wrong = await client.post(f"{API}/auth/login", json={"email": email, "password": "nope-nope-1"})
        assert wrong.status_code == 401
        assert (await client.get(f"{API}/auth/me", headers=token_headers)).status_code == 403

        await raw.companies.update_one({"company_id": b}, {"$set": {"status": "active"}})
        assert (await client.get(f"{API}/auth/me", headers=token_headers)).status_code == 200
    finally:
        await raw.users.delete_many({"email": email})


async def test_suspending_a_client_switches_off_all_its_companies(client, b):
    email, password = await _real_user(b)
    raw = get_platform_db()
    client_id = (await raw.companies.find_one({"company_id": b}))["client_id"]
    try:
        await raw.clients.update_one({"client_id": client_id}, {"$set": {"status": "suspended"}})
        r = await client.post(f"{API}/auth/login", json={"email": email, "password": password})
        assert r.status_code == 403
        await raw.clients.update_one({"client_id": client_id}, {"$set": {"status": "active"}})
        assert (await client.post(f"{API}/auth/login", json={"email": email, "password": password})).status_code == 200
    finally:
        await raw.users.delete_many({"email": email})


async def test_a_user_with_no_workspace_cannot_sign_in(client):
    tag = uuid.uuid4().hex[:8]
    email = f"orphan-{tag}@example.com"
    raw = get_platform_db()
    await raw.users.insert_one({
        "name": "Orphan", "email": email, "password_hash": _pwd.hash("Password-123!"), "role": "admin",
        "is_active": True, "company_id": "cmp_missing", "created_at": NOW,
    })
    try:
        r = await client.post(f"{API}/auth/login", json={"email": email, "password": "Password-123!"})
        assert r.status_code == 401
    finally:
        await raw.users.delete_many({"email": email})


async def test_a_platform_owner_is_not_a_member_of_other_companies(client, b):
    owner = await client.get(f"{API}/platform/overview", headers={"Authorization": "Bearer demo-platform-token"})
    assert owner.status_code == 200
    normal = await client.get(f"{API}/platform/overview", headers=_superadmin(A))
    assert normal.status_code == 403
