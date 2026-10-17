from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from httpx import ASGITransport, AsyncClient

import config.database as database
from config import tenancy
from config.tenancy import DEFAULT_COMPANY_ID, namespaced_id
from fake_mongo import FakeRaw
from main import app
from shared import auth as auth_module, rate_limit

pytestmark = pytest.mark.anyio

A, B = "cmp_a", "cmp_b"
URL = "/api/v1/branding/public"
AS_A = {"Authorization": f"Bearer demo-admin-token@@{A}"}
AS_B = {"Authorization": f"Bearer demo-admin-token@@{B}"}


@pytest.fixture
async def world(monkeypatch):
    raw = FakeRaw()
    monkeypatch.setattr(database, "_db", raw)
    monkeypatch.setattr(rate_limit, "enforce_rate_limit", AsyncMock())
    real_bind = auth_module.bind_company
    monkeypatch.setattr(auth_module, "bind_company", lambda cid, comp: real_bind(cid, {**comp, "name": "Default", "slug": cid, "settings": {}}))
    tenancy.use_fallback_company(None)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        yield SimpleNamespace(raw=raw, client=client)
    tenancy.use_fallback_company(DEFAULT_COMPANY_ID)


def profile(world, company: str, name):
    world.raw.add("company_settings", {"_id": namespaced_id(company, "singleton"), "company_name": name}, company)


async def name_for(world, headers) -> str:
    response = await world.client.get(URL, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["company_name"]


async def test_the_name_on_the_organization_page_is_the_name_shown(world):
    profile(world, A, "Hirely.ai")
    assert await name_for(world, AS_A) == "Hirely.ai"


async def test_the_workspace_name_is_the_fallback_when_the_organization_page_has_none(world):
    assert await name_for(world, AS_A) == "Default"
    world.raw["company_settings"].docs.clear()
    profile(world, A, "   ")
    assert await name_for(world, AS_A) == "Default"


async def test_a_name_is_trimmed(world):
    profile(world, A, "  Hirely.ai  ")
    assert await name_for(world, AS_A) == "Hirely.ai"


async def test_one_companys_name_never_reaches_another(world):
    profile(world, A, "Hirely.ai")
    profile(world, B, "Beta Staffing")
    assert await name_for(world, AS_A) == "Hirely.ai"
    assert await name_for(world, AS_B) == "Beta Staffing"
    world.raw["company_settings"].docs[:] = [d for d in world.raw["company_settings"].docs if d["company_id"] == A]
    assert await name_for(world, AS_B) == "Default"


async def test_a_read_of_the_public_branding_does_not_create_the_organization_profile(world):
    await name_for(world, AS_A)
    assert world.raw.rows("company_settings", A) == []


async def test_a_visitor_with_no_company_gets_the_product_defaults_and_no_name(world):
    profile(world, A, "Hirely.ai")
    response = await world.client.get(URL)
    assert response.status_code == 200 and response.json()["company_name"] == ""
