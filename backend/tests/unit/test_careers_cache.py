import pytest

from config.settings import settings
from services.hr_module import careers_service
from test_careers import A, API, add_job, iso, world

pytestmark = pytest.mark.anyio


@pytest.fixture
def cached(monkeypatch):
    monkeypatch.setattr(settings, "CAREERS_CACHE_SECONDS", 30)
    careers_service.clear_cache()
    clock = [1000.0]
    monkeypatch.setattr(careers_service, "_clock", lambda: clock[0])
    yield clock
    careers_service.clear_cache()


async def total(world, path="/jobs"):
    return (await world.client.get(f"{API}{path}")).json()["total"]


async def test_a_repeat_list_request_is_served_from_the_cache(world, cached):
    first = await total(world)
    add_job(world.raw, A, "a-fresh", "Fresh Role", created_at=iso(0))
    assert await total(world) == first
    careers_service.clear_cache()
    assert await total(world) == first + 1


async def test_the_filters_are_cached_as_well(world, cached):
    before = (await world.client.get(f"{API}/filters")).json()["total_open"]
    add_job(world.raw, A, "a-fresh", "Fresh Role", created_at=iso(0))
    assert (await world.client.get(f"{API}/filters")).json()["total_open"] == before
    careers_service.clear_cache()
    assert (await world.client.get(f"{API}/filters")).json()["total_open"] == before + 1


async def test_a_job_page_is_never_older_than_the_job(world, cached):
    await total(world)
    add_job(world.raw, A, "a-fresh", "Fresh Role", created_at=iso(0))
    response = await world.client.get(f"{API}/jobs/a-fresh")
    assert response.status_code == 200 and response.json()["title"] == "Fresh Role"
    world.raw["jobs"].docs[-1]["is_public"] = False
    assert (await world.client.get(f"{API}/jobs/a-fresh")).status_code == 404


async def test_different_searches_do_not_share_an_entry(world, cached):
    everything = await total(world)
    designers = await total(world, "/jobs?q=Data")
    assert 0 < designers < everything
    assert await total(world) == everything
    assert await total(world, "/jobs?q=Data") == designers


async def test_the_same_search_written_differently_shares_its_entry(world, cached):
    first = await total(world, "/jobs?company=ACME")
    add_job(world.raw, A, "a-fresh", "Fresh Role", created_at=iso(0))
    assert await total(world, "/jobs?company=acme") == first


async def test_an_entry_lasts_for_the_configured_time_only(world, cached):
    first = await total(world)
    add_job(world.raw, A, "a-fresh", "Fresh Role", created_at=iso(0))
    cached[0] += 29
    assert await total(world) == first
    cached[0] += 2
    assert await total(world) == first + 1


async def test_nothing_is_kept_when_the_time_is_zero(world, monkeypatch):
    monkeypatch.setattr(settings, "CAREERS_CACHE_SECONDS", 0)
    careers_service.clear_cache()
    first = await total(world)
    add_job(world.raw, A, "a-fresh", "Fresh Role", created_at=iso(0))
    assert await total(world) == first + 1
