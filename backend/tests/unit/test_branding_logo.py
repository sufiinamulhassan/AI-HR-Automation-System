import base64
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from httpx import ASGITransport, AsyncClient

import config.database as database
from config import tenancy
from config.tenancy import DEFAULT_COMPANY_ID
from fake_mongo import FakeRaw
from main import app
from services.hr_module import branding_service
from shared import auth as auth_module, rate_limit, tenant_deps

pytestmark = pytest.mark.anyio

A, B = "cmp_a", "cmp_b"
API = "/api/v1/branding"
ADMIN = {"Authorization": f"Bearer demo-admin-token@@{A}"}
STANDARD = {"Authorization": f"Bearer demo-standard-token@@{A}"}
PNG = b"\x89PNG\r\n\x1a\n" + b"logo-bytes" * 20
JPEG = b"\xff\xd8\xff\xe0" + b"jpeg-bytes" * 20
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'


def company(company_id, **over):
    return {"company_id": company_id, "name": f"Co {company_id}", "status": "active", "client_status": "active", "kind": "workspace", **over}


@pytest.fixture
async def world(monkeypatch):
    raw = FakeRaw()
    directory = {A: company(A), B: company(B), "cmp_gone": company("cmp_gone", status="suspended"), "cmp_platform": company("cmp_platform", kind="platform")}

    async def fake_load(company_id):
        return dict(directory[company_id]) if company_id in directory else None

    monkeypatch.setattr(database, "_db", raw)
    monkeypatch.setattr(tenant_deps, "load_company", fake_load)
    monkeypatch.setattr(rate_limit, "enforce_rate_limit", AsyncMock())
    real_bind = auth_module.bind_company

    def bind_stored(company_id, comp):
        real_bind(company_id, {**comp, "settings": {}})

    monkeypatch.setattr(auth_module, "bind_company", bind_stored)
    import routes.branding as route

    async def public_ok(url):
        return url

    monkeypatch.setattr(route, "assert_public_https_url", public_ok)
    tenancy.use_fallback_company(None)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        yield SimpleNamespace(raw=raw, client=client)
    tenancy.use_fallback_company(DEFAULT_COMPANY_ID)


def upload(world, data, name="logo.png", headers=ADMIN, kind="image/png"):
    return world.client.post(f"{API}/logo", files={"file": (name, data, kind)}, headers=headers)


def stored(world, company_id=A):
    docs = [d for d in world.raw["branding_settings"].docs if d.get("company_id") == company_id]
    return docs[0] if docs else {}


async def test_an_admin_uploads_a_png_and_the_company_logo_becomes_that_file(world):
    response = await upload(world, PNG)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["company_logo_url"].startswith(f"/api/v1/branding/logo/{A}?v=")
    assert "logo_base64" not in body and base64.b64encode(PNG).decode() not in response.text
    doc = stored(world)
    assert base64.b64decode(doc["logo_base64"]) == PNG and doc["logo_content_type"] == "image/png"
    (audit,) = world.raw.rows("audit_log", action="branding_logo_upload")
    assert audit["details"] == {"bytes": len(PNG), "type": "image/png"}


async def test_a_jpeg_is_accepted_too_and_served_as_a_jpeg(world):
    assert (await upload(world, JPEG, "logo.jpg", kind="image/jpeg")).status_code == 200
    served = await world.client.get(f"{API}/logo/{A}")
    assert served.status_code == 200 and served.headers["content-type"] == "image/jpeg" and served.content == JPEG


@pytest.mark.parametrize("data,name,kind", [
    (SVG, "logo.svg", "image/svg+xml"),
    (b"GIF89a" + b"x" * 40, "logo.gif", "image/gif"),
    (b"%PDF-1.4 not an image", "logo.png", "image/png"),
    (b"plain text", "logo.png", "image/png"),
])
async def test_anything_that_is_not_a_png_or_jpeg_is_refused_and_nothing_is_kept(world, data, name, kind):
    response = await upload(world, data, name, kind=kind)
    assert response.status_code == 400 and response.json()["detail"] == "The logo must be a PNG or JPEG image."
    assert stored(world).get("logo_base64") is None


async def test_an_empty_file_and_a_file_over_one_megabyte_are_refused(world):
    empty = await upload(world, b"")
    assert empty.status_code == 400 and empty.json()["detail"] == "The file is empty."
    big = await upload(world, b"\x89PNG\r\n\x1a\n" + b"0" * 1_000_000)
    assert big.status_code == 413 and "1 MB" in big.json()["detail"]
    assert stored(world).get("logo_base64") is None


async def test_only_an_admin_may_change_the_logo(world):
    assert (await upload(world, PNG, headers=STANDARD)).status_code == 403
    assert (await upload(world, PNG, headers={})).status_code == 401
    assert (await world.client.delete(f"{API}/logo", headers=STANDARD)).status_code == 403
    assert stored(world).get("logo_base64") is None


async def test_anyone_can_fetch_a_logo_by_the_company_id_and_it_is_cached_by_its_digest(world):
    await upload(world, PNG)
    first = await world.client.get(f"{API}/logo/{A}")
    assert first.status_code == 200 and first.content == PNG and first.headers["content-type"] == "image/png"
    assert first.headers["x-content-type-options"] == "nosniff"
    assert "max-age" in first.headers["cache-control"] and first.headers["etag"]
    again = await world.client.get(f"{API}/logo/{A}", headers={"If-None-Match": first.headers["etag"]})
    assert again.status_code == 304 and again.content == b""


async def test_a_logo_is_only_ever_served_for_its_own_company(world):
    await upload(world, PNG)
    assert (await world.client.get(f"{API}/logo/{B}")).status_code == 404
    assert (await world.client.get(f"{API}/logo/cmp_missing")).status_code == 404
    assert (await world.client.get(f"{API}/logo/cmp_gone")).status_code == 404
    assert (await world.client.get(f"{API}/logo/cmp_platform")).status_code == 404


async def test_a_company_with_no_logo_answers_a_plain_not_found(world):
    response = await world.client.get(f"{API}/logo/{A}")
    assert response.status_code == 404 and response.json() == {"detail": "Not found"}


async def test_replacing_the_logo_changes_the_address_so_the_old_one_is_not_served_from_cache(world):
    first = (await upload(world, PNG)).json()["company_logo_url"]
    second = (await upload(world, JPEG, "logo.jpg", kind="image/jpeg")).json()["company_logo_url"]
    assert first != second and first.split("?")[0] == second.split("?")[0]


async def test_saving_the_branding_form_with_the_uploaded_path_unchanged_keeps_the_file(world):
    url = (await upload(world, PNG)).json()["company_logo_url"]
    response = await world.client.patch(API, json={"company_logo_url": url, "primary_color": "#112233"}, headers=ADMIN)
    assert response.status_code == 200 and response.json()["primary_color"] == "#112233"
    assert stored(world)["logo_base64"] and response.json()["company_logo_url"] == url


async def test_a_path_that_is_not_the_stored_logo_is_refused(world):
    response = await world.client.patch(API, json={"company_logo_url": f"/api/v1/branding/logo/{B}?v=abc"}, headers=ADMIN)
    assert response.status_code == 400
    await upload(world, PNG)
    other = await world.client.patch(API, json={"company_logo_url": f"/api/v1/branding/logo/{A}?v=forged"}, headers=ADMIN)
    assert other.status_code == 400 and stored(world)["logo_base64"]


async def test_a_pasted_https_address_replaces_an_uploaded_logo_and_drops_its_bytes(world):
    await upload(world, PNG)
    response = await world.client.patch(API, json={"company_logo_url": "https://cdn.example.com/logo.png"}, headers=ADMIN)
    assert response.status_code == 200 and response.json()["company_logo_url"] == "https://cdn.example.com/logo.png"
    assert stored(world).get("logo_base64") is None
    assert (await world.client.get(f"{API}/logo/{A}")).status_code == 404


async def test_removing_the_logo_clears_the_address_and_the_file(world):
    await upload(world, PNG)
    response = await world.client.delete(f"{API}/logo", headers=ADMIN)
    assert response.status_code == 200 and response.json()["company_logo_url"] == ""
    assert stored(world).get("logo_base64") is None and stored(world).get("logo_sha") is None
    assert (await world.client.get(f"{API}/logo/{A}")).status_code == 404
    assert world.raw.rows("audit_log", action="branding_logo_remove")


async def test_removing_a_pasted_address_works_the_same_way(world):
    await world.client.patch(API, json={"company_logo_url": "https://cdn.example.com/logo.png"}, headers=ADMIN)
    response = await world.client.delete(f"{API}/logo", headers=ADMIN)
    assert response.status_code == 200 and response.json()["company_logo_url"] == ""


async def test_the_public_branding_carries_the_path_of_the_uploaded_logo(world):
    url = (await upload(world, PNG)).json()["company_logo_url"]
    public = await world.client.get(f"{API}/public", headers=ADMIN)
    assert public.status_code == 200 and public.json()["company_logo_url"] == url
    assert "logo_base64" not in public.text


def test_the_type_is_read_from_the_files_own_first_bytes():
    assert branding_service.sniff_logo_type(PNG) == "image/png"
    assert branding_service.sniff_logo_type(JPEG) == "image/jpeg"
    assert branding_service.sniff_logo_type(SVG) is None and branding_service.sniff_logo_type(b"") is None


def test_only_the_logo_route_path_counts_as_an_uploaded_logo():
    assert branding_service.is_uploaded_logo_url("/api/v1/branding/logo/cmp_a?v=1")
    assert not branding_service.is_uploaded_logo_url("https://example.com/api/v1/branding/logo/cmp_a")
    assert not branding_service.is_uploaded_logo_url("") and not branding_service.is_uploaded_logo_url(None)
