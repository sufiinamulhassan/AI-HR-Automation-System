import hashlib
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest

from services.hr_module import platform_service as svc, workspace_service

pytestmark = pytest.mark.anyio


class Settings:
    def __init__(self):
        self.docs: dict[str, dict] = {}
        self.reads = 0
        self.writes = 0

    async def find_one(self, flt, projection=None):
        self.reads += 1
        doc = self.docs.get(flt["_id"])
        return dict(doc) if doc else None

    async def replace_one(self, flt, doc, upsert=False):
        self.writes += 1
        self.docs[flt["_id"]] = dict(doc)

    async def update_one(self, flt, update, upsert=False):
        self.writes += 1
        doc = self.docs.setdefault(flt["_id"], {"_id": flt["_id"]})
        for field, by in update.get("$inc", {}).items():
            doc[field] = doc.get(field, 0) + by
        doc.update(update.get("$set", {}))


class Raw:
    def __init__(self):
        self.settings = Settings()


class Counter:

    def __init__(self):
        self.calls = 0

    async def __call__(self):
        self.calls += 1
        return {"rows": [self.calls]}


@pytest.fixture
def raw(monkeypatch):
    fake = Raw()
    monkeypatch.setattr(svc, "get_platform_db", lambda: fake)
    monkeypatch.setattr(workspace_service, "get_platform_db", lambda: fake)
    monkeypatch.setattr(svc, "CACHE_SECONDS", 300)
    return fake


def test_a_key_is_the_prefix_and_a_hash_of_the_view_the_parameters_and_the_epoch():
    key = svc.cache_key("clients", {"search": "acme", "status": None}, 3)
    assert key.startswith("usage_cache:") and len(key) == len("usage_cache:") + 32
    assert key == svc.cache_key("clients", {"status": None, "search": "acme"}, 3)
    assert key != svc.cache_key("companies", {"search": "acme", "status": None}, 3)
    assert key != svc.cache_key("clients", {"search": "acme", "status": "active"}, 3)
    assert key != svc.cache_key("clients", {"search": "acme", "status": None}, 4)
    assert svc.cache_key("clients", None, 0) == svc.cache_key("clients", {}, 0)


def test_the_key_hash_covers_exactly_view_params_epoch_and_payload_version():
    import json

    blob = json.dumps(
        {"view": "v", "params": {"a": 1}, "epoch": 2, "shape": svc.PAYLOAD_VERSION},
        sort_keys=True, default=str, separators=(",", ":"),
    )
    assert svc.cache_key("v", {"a": 1}, 2) == "usage_cache:" + hashlib.sha256(blob.encode()).hexdigest()[:32]


def test_a_change_of_payload_shape_never_serves_a_copy_cached_in_the_old_shape(monkeypatch):
    before = svc.cache_key("ai", {"kind": "window", "days": 30}, 0)
    monkeypatch.setattr(svc, "PAYLOAD_VERSION", svc.PAYLOAD_VERSION + 1)
    assert svc.cache_key("ai", {"kind": "window", "days": 30}, 0) != before


def test_a_period_is_keyed_by_the_day_it_started_so_a_window_never_outlives_midnight():
    monday = svc.window_period(30, datetime(2026, 10, 12, 9, 0, tzinfo=timezone.utc))
    tuesday = svc.window_period(30, datetime(2026, 10, 13, 9, 0, tzinfo=timezone.utc))
    assert svc.period_params(monday) == {"kind": "window", "days": 30, "start": "2026-09-13"}
    assert svc.period_params(monday) != svc.period_params(tuesday)
    assert svc.period_params(svc.month_period("2026-03")) == {"kind": "month", "days": 31, "start": "2026-03-01"}
    assert svc.period_params(7)["days"] == 7


async def test_the_first_read_computes_and_stores_and_the_second_is_served_from_the_cache(raw):
    view = Counter()
    first = await svc.cached_view("overview", {"days": 30}, False, view)
    second = await svc.cached_view("overview", {"days": 30}, False, view)
    assert view.calls == 1 and first == second and first["rows"] == [1]
    assert datetime.fromisoformat(first["computed_at"]).tzinfo is not None
    stored = [d for k, d in raw.settings.docs.items() if k.startswith("usage_cache:")]
    assert len(stored) == 1 and stored[0]["view"] == "overview" and isinstance(stored[0]["created_at"], datetime)
    assert stored[0]["key"] == stored[0]["_id"] and stored[0]["payload"] == first


async def test_two_views_or_two_parameter_sets_do_not_share_an_answer(raw):
    view = Counter()
    await svc.cached_view("clients", {"search": "a"}, False, view)
    await svc.cached_view("clients", {"search": "b"}, False, view)
    await svc.cached_view("companies", {"search": "a"}, False, view)
    assert view.calls == 3


async def test_refresh_always_recomputes_and_what_it_stores_is_what_the_next_read_gets(raw):
    view = Counter()
    await svc.cached_view("overview", {}, False, view)
    refreshed = await svc.cached_view("overview", {}, True, view)
    assert view.calls == 2 and refreshed["rows"] == [2]
    later = await svc.cached_view("overview", {}, False, view)
    assert view.calls == 2 and later == refreshed


async def test_a_write_bumps_the_epoch_and_every_older_answer_is_unreachable(raw):
    view = Counter()
    await svc.cached_view("overview", {}, False, view)
    await svc.cached_view("clients", {}, False, view)
    assert view.calls == 2
    await svc.invalidate_console_cache()
    assert raw.settings.docs["usage_cache_epoch"]["value"] == 1
    await svc.cached_view("overview", {}, False, view)
    await svc.cached_view("clients", {}, False, view)
    assert view.calls == 4
    await svc.invalidate_console_cache()
    assert raw.settings.docs["usage_cache_epoch"]["value"] == 2


async def test_an_audited_platform_write_invalidates_the_cache_whoever_made_it(raw, monkeypatch):
    monkeypatch.setattr(workspace_service, "log_audit_event", AsyncMock())
    view = Counter()
    await svc.cached_view("overview", {}, False, view)
    await workspace_service.platform_audit({"email": "owner@platform.test"}, "client_update", "client", "cli_1", {})
    await svc.cached_view("overview", {}, False, view)
    assert view.calls == 2


async def test_an_answer_older_than_five_minutes_is_computed_again(raw):
    view = Counter()
    await svc.cached_view("overview", {}, False, view)
    (doc,) = [d for k, d in raw.settings.docs.items() if k.startswith("usage_cache:")]
    doc["created_at"] = datetime.now(timezone.utc) - timedelta(seconds=299)
    await svc.cached_view("overview", {}, False, view)
    assert view.calls == 1
    doc["created_at"] = datetime.now(timezone.utc) - timedelta(seconds=301)
    await svc.cached_view("overview", {}, False, view)
    assert view.calls == 2


async def test_mongo_hands_back_naive_utc_datetimes_and_those_count_as_utc(raw):
    view = Counter()
    await svc.cached_view("overview", {}, False, view)
    (doc,) = [d for k, d in raw.settings.docs.items() if k.startswith("usage_cache:")]
    doc["created_at"] = datetime.now(timezone.utc).replace(tzinfo=None)
    await svc.cached_view("overview", {}, False, view)
    assert view.calls == 1


async def test_a_zero_lifetime_turns_the_cache_off_but_the_answer_still_says_when_it_was_computed(raw, monkeypatch):
    monkeypatch.setattr(svc, "CACHE_SECONDS", 0)
    view = Counter()
    a = await svc.cached_view("overview", {}, False, view)
    b = await svc.cached_view("overview", {}, False, view)
    assert view.calls == 2 and a["computed_at"] and b["rows"] == [2]
    assert raw.settings.docs == {}


async def test_a_broken_cache_falls_back_to_computing_the_answer(raw, monkeypatch):
    async def broken(*a, **k):
        raise RuntimeError("settings collection unavailable")

    monkeypatch.setattr(raw.settings, "find_one", broken)
    monkeypatch.setattr(raw.settings, "replace_one", broken)
    view = Counter()
    out = await svc.cached_view("overview", {}, False, view)
    assert out["rows"] == [1] and out["computed_at"]


async def test_an_error_while_computing_is_not_cached(raw):
    async def refuses():
        raise svc.PlatformError(404, "Client not found.")

    with pytest.raises(svc.PlatformError):
        await svc.cached_view("client", {"client_id": "cli_nope"}, False, refuses)
    assert [k for k in raw.settings.docs if k.startswith("usage_cache:")] == []


async def test_the_cache_lives_in_the_database_not_in_the_process(raw, monkeypatch):
    view = Counter()
    await svc.cached_view("overview", {}, False, view)
    elsewhere = Raw()
    monkeypatch.setattr(svc, "get_platform_db", lambda: elsewhere)
    await svc.cached_view("overview", {}, False, view)
    assert view.calls == 2
    elsewhere.settings.docs = {k: dict(v) for k, v in raw.settings.docs.items()}
    await svc.cached_view("overview", {}, False, view)
    assert view.calls == 2


def test_the_console_has_no_module_level_cache():
    import ast
    import inspect

    tree = ast.parse(inspect.getsource(svc))
    holders = []
    for node in tree.body:
        if isinstance(node, ast.Assign) and isinstance(node.value, (ast.Dict, ast.List, ast.Set)) \
                and any(isinstance(t, ast.Name) and any(w in t.id.lower() for w in ("cache", "memo", "_last")) for t in node.targets):
            holders.append([t.id for t in node.targets if isinstance(t, ast.Name)])
    assert holders == []
