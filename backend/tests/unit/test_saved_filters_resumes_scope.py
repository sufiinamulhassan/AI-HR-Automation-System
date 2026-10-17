from types import SimpleNamespace

import pytest
from httpx import ASGITransport, AsyncClient

import config.database as database
from config import tenancy
from config.settings import settings
from fake_mongo import FakeRaw
from main import app

pytestmark = pytest.mark.anyio

API = "/api/v1/saved-filters"
STANDARD = {"Authorization": "Bearer demo-standard-token"}
ADMIN = {"Authorization": "Bearer demo-admin-token"}
COMPANY = tenancy.DEFAULT_COMPANY_ID

SEARCH = {
    "search": "python, berlin", "skill": "Python,Java", "business_domain": "it_software", "domain": "devops",
    "seniority": "senior", "status": "processed", "experience_min": 3, "experience_max": 12,
    "department": "Backend Engineer", "education_level": "master", "certification": "pmp",
    "industry": "fintech", "salary_expectation_min": 50000,
    "salary_expectation_max": 150000, "worked_at_company": "Google", "location": "Berlin",
    "semantic": True, "folder": "it_software", "ui": {"view": "grid", "open": ["a", "b"], "n": None},
}


@pytest.fixture
async def world(monkeypatch):
    raw = FakeRaw()
    monkeypatch.setattr(database, "_db", raw)
    monkeypatch.setattr(tenancy, "_fallback_company_id", None)
    monkeypatch.setattr(settings, "ALLOW_DEMO_AUTH", True)
    monkeypatch.setattr(settings, "HACKATHON_DEMO_MODE", False)
    monkeypatch.setattr(settings, "DEMO_COMPANY_ID", "")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        yield SimpleNamespace(raw=raw, client=client)


async def create(world, name, params=None, scope="resumes", headers=STANDARD):
    body = {"name": name, "filter_params": params if params is not None else {}}
    if scope is not None:
        body["scope"] = scope
    response = await world.client.post(API, json=body, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


async def names(world, scope=None, headers=STANDARD):
    params = {"scope": scope} if scope else {}
    response = await world.client.get(API, params=params, headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == len(body["templates"])
    return [t["name"] for t in body["templates"]]


async def test_a_saved_resume_search_keeps_any_filter_dict_exactly(world):
    created = await create(world, "Senior backend in Berlin", SEARCH)
    assert created["scope"] == "resumes"
    assert created["created_by"] == "demo-standard@hirely.ai"
    assert created["filter_params"] == SEARCH
    fetched = (await world.client.get(f"{API}/{created['template_id']}", headers=STANDARD)).json()
    assert fetched["filter_params"] == SEARCH
    assert fetched["scope"] == "resumes"
    assert "_id" not in fetched


async def test_the_resumes_scope_lists_only_resume_searches_newest_first(world):
    await create(world, "first", {"skill": "go"})
    await create(world, "other kind", {"skill": "rust"}, scope="candidates")
    await create(world, "unscoped", {"skill": "c"}, scope=None)
    await create(world, "second", {"skill": "java"})
    assert await names(world, "resumes") == ["second", "first"]
    assert await names(world, "candidates") == ["other kind"]
    assert await names(world, "nothing") == []
    assert sorted(await names(world)) == ["first", "other kind", "second", "unscoped"]


async def test_each_person_sees_only_their_own_saved_searches(world):
    await create(world, "mine", {"skill": "go"})
    await create(world, "admins", {"skill": "rust"}, headers=ADMIN)
    assert await names(world, "resumes") == ["mine"]
    assert await names(world, "resumes", headers=ADMIN) == ["admins"]


async def test_only_the_owner_or_an_admin_can_open_edit_or_delete_one(world):
    admins = await create(world, "admins", {"skill": "rust"}, headers=ADMIN)
    url = f"{API}/{admins['template_id']}"
    assert (await world.client.get(url, headers=STANDARD)).status_code == 403
    assert (await world.client.patch(url, json={"name": "x"}, headers=STANDARD)).status_code == 403
    assert (await world.client.delete(url, headers=STANDARD)).status_code == 403
    mine = await create(world, "mine", {"skill": "go"})
    assert (await world.client.get(f"{API}/{mine['template_id']}", headers=ADMIN)).status_code == 200


async def test_a_saved_search_can_be_renamed_changed_and_deleted(world):
    created = await create(world, "before", {"skill": "go"})
    url = f"{API}/{created['template_id']}"
    renamed = (await world.client.patch(url, json={"name": "after"}, headers=STANDARD)).json()
    assert renamed["name"] == "after" and renamed["filter_params"] == {"skill": "go"}
    changed = (await world.client.patch(url, json={"filter_params": {"seniority": "lead"}}, headers=STANDARD)).json()
    assert changed["filter_params"] == {"seniority": "lead"}
    assert changed["name"] == "after" and changed["scope"] == "resumes"
    assert (await world.client.delete(url, headers=STANDARD)).status_code == 200
    assert (await world.client.get(url, headers=STANDARD)).status_code == 404
    assert await names(world, "resumes") == []


async def test_a_blank_name_is_refused_and_empty_filters_are_allowed(world):
    refused = await world.client.post(API, json={"name": "  ", "filter_params": {}, "scope": "resumes"}, headers=STANDARD)
    assert refused.status_code == 400
    created = (await world.client.post(API, json={"name": "everything", "scope": "resumes"}, headers=STANDARD)).json()
    assert created["filter_params"] == {}


async def test_another_companys_saved_searches_are_never_listed_or_opened(world):
    world.raw.add("saved_filter_templates", {
        "template_id": "theirs", "name": "their search", "created_by": "demo-standard@hirely.ai",
        "filter_params": {"skill": "cobol"}, "scope": "resumes", "created_at": "2099-01-01T00:00:00+00:00",
        "updated_at": "2099-01-01T00:00:00+00:00",
    }, "cmp_other")
    await create(world, "mine", {"skill": "go"})
    assert await names(world, "resumes") == ["mine"]
    assert (await world.client.get(f"{API}/theirs", headers=STANDARD)).status_code == 404


async def test_a_saved_search_returns_the_same_rows_when_its_filters_are_sent_back(world):
    python = {"job_domain": "software_engineering", "seniority_level": "senior", "skills": ["Python"], "years_experience": 8}
    for resume_id, years, domain in (("a", 8, "software_engineering"), ("b", 1, "software_engineering"), ("c", 9, "marketing")):
        world.raw.add("resumes", {
            "resume_id": resume_id, "candidate_name": resume_id, "filename": f"{resume_id}.pdf",
            "processing_status": "processed", "created_at": "2026-01-01T00:00:00+00:00",
            "classification": {**python, "years_experience": years, "job_domain": domain},
        }, COMPANY)
    saved = await create(world, "senior python", {"skill": "python", "business_domain": "it_software", "experience_min": 3})
    params = (await world.client.get(f"{API}/{saved['template_id']}", headers=STANDARD)).json()["filter_params"]
    response = await world.client.get("/api/v1/resumes", params=params, headers=STANDARD)
    assert [r["resume_id"] for r in response.json()["resumes"]] == ["a"]
