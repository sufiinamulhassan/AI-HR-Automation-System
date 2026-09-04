"""Tests for the in-app User Guide API (routes/user_guide.py).

The load-bearing assertions here are the role filter and the lossless
round-trip of the `chapters` tree:

  * The frontend hides guide tabs a user may not read, but that is cosmetic —
    anyone can curl the API. Every read test below therefore asserts on what
    the *server* is willing to hand over, not on what the UI would draw.
  * The guide is authored in the frontend against src/pages/guide/types.ts and
    stored opaquely. `test_chapters_round_trip_losslessly` PUTs a deliberately
    deep tree using every field in that file and asserts the GET response is
    equal to it — if a future schema change starts dropping or defaulting a
    key, that test fails rather than the content quietly degrading in prod.
"""
import asyncio
import copy

import pytest

import main as _main_module
from routes import user_guide as _user_guide_routes
from config.database import get_db
from seed.seed_user_guides import _normalize_payload, validate_guides

_PREFIX = "/api/v1/user-guide"


def _is_registered() -> bool:
    """True if the app already serves this feature's routes.

    Two shapes to check: this FastAPI version keeps an included router lazy —
    `app.routes` holds an `_IncludedRouter` carrying an `include_context`
    rather than the flattened `APIRoute`s that older versions produced. The
    guards in tests/test_company_settings.py and tests/test_security_policies.py
    only look at `.path`, which silently misses the lazy shape and re-includes
    an already-registered router (harmless — the first match wins — but not
    something worth copying).
    """
    for route in _main_module.app.routes:
        if getattr(route, "path", "").startswith(_PREFIX):
            return True
        context = getattr(route, "include_context", None)
        if getattr(context, "prefix", None) == _PREFIX:
            return True
    return False


if not _is_registered():
    _main_module.app.include_router(
        _user_guide_routes.router,
        prefix=_PREFIX,
        tags=["hr_module · User Guide"],
    )

pytestmark = pytest.mark.anyio


def _guide(role: str, label: str = "Test Guide") -> dict:
    """Minimal but valid RoleGuide payload."""
    return {
        "role": role,
        "label": label,
        "tagline": f"Everything a {role} needs.",
        "intro": ["First orientation paragraph."],
        "chapters": [{
            "id": "getting-started",
            "title": "Getting Started",
            "sections": [{
                "id": "dashboard",
                "title": "Dashboard",
                "summary": "The landing screen.",
                "subsections": [{"id": "overview", "title": "Overview"}],
            }],
        }],
    }


_FULL_TREE = [{
    "id": "recruiting",
    "title": "Recruiting",
    "blurb": "Everything from job post to offer.",
    "sections": [{
        "id": "pipeline",
        "title": "Candidate Pipeline",
        "path": "/dashboard/hrbot",
        "summary": "Where candidates move between stages.",
        "access": "HR Admin & Super Admin",
        "subsections": [{
            "id": "pipeline-filters",
            "title": "Filtering the pipeline",
            "body": ["Prose paragraph one.", "Prose paragraph two."],
            "steps": ["Open the pipeline.", "Set Min Score.", "Press Refresh."],
            "controls": [
                {
                    "name": "Min Score",
                    "kind": "filter",
                    "what": "Hides candidates below the given match score.",
                    "how": "Start at 0.70; lower it if the shortlist is empty.",
                    "access": "All signed-in users",
                },
                {"name": "↻ Refresh", "kind": "button", "what": "Re-runs the query."},
            ],
            "tips": ["Filters stack."],
            "warnings": ["Deleting a candidate is permanent."],
            "faqs": [{"q": "Why is the list empty?", "a": "Min Score is probably too high."}],
        }],
    }],
}]


@pytest.fixture(autouse=True)
async def _clean_user_guides():
    """`user_guides` is a brand-new collection owned entirely by this feature —
    safe to clear before and after each test (no shared conftest fixture data
    lives here, unlike users/jobs/resumes/candidates). Clearing it up front
    also means every test starts from the true "nothing published" state."""
    db = get_db()
    if db is not None:
        await db.user_guides.delete_many({})
        await db.audit_log.delete_many({"resource_type": "user_guide"})
    yield
    if db is not None:
        await db.user_guides.delete_many({})


async def _publish_all(client, superadmin_headers):
    for role in ("standard", "admin", "superadmin"):
        response = await client.put(
            f"/api/v1/user-guide/{role}", json=_guide(role), headers=superadmin_headers,
        )
        assert response.status_code == 200, response.text


async def _wait_for_audit_entry(db, query: dict, attempts: int = 20, delay: float = 0.15):
    """Poll audit_log for the fire-and-forget write to land (same helper shape
    as tests/test_audit_log_coverage.py)."""
    for _ in range(attempts):
        entry = await db.audit_log.find_one(query, sort=[("created_at", -1)])
        if entry is not None:
            return entry
        await asyncio.sleep(delay)
    return None


async def test_list_requires_authentication(client):
    response = await client.get("/api/v1/user-guide")
    assert response.status_code == 401


async def test_get_one_requires_authentication(client):
    response = await client.get("/api/v1/user-guide/standard")
    assert response.status_code == 401


async def test_standard_user_lists_only_the_standard_guide(client, standard_headers, superadmin_headers):
    await _publish_all(client, superadmin_headers)

    response = await client.get("/api/v1/user-guide", headers=standard_headers)
    assert response.status_code == 200
    body = response.json()
    assert [guide["role"] for guide in body["guides"]] == ["standard"]
    assert body["roles"] == ["standard"]


async def test_admin_lists_standard_and_admin_but_never_superadmin(client, admin_headers, superadmin_headers):
    await _publish_all(client, superadmin_headers)

    response = await client.get("/api/v1/user-guide", headers=admin_headers)
    assert response.status_code == 200
    body = response.json()
    assert [guide["role"] for guide in body["guides"]] == ["standard", "admin"]
    assert body["roles"] == ["standard", "admin"]
    assert "Everything a superadmin needs." not in response.text


async def test_superadmin_lists_all_three(client, superadmin_headers):
    await _publish_all(client, superadmin_headers)

    response = await client.get("/api/v1/user-guide", headers=superadmin_headers)
    assert response.status_code == 200
    body = response.json()
    assert [guide["role"] for guide in body["guides"]] == ["standard", "admin", "superadmin"]
    assert body["roles"] == ["standard", "admin", "superadmin"]


async def test_list_omits_roles_with_no_published_guide(client, superadmin_headers):
    response = await client.put(
        "/api/v1/user-guide/admin", json=_guide("admin"), headers=superadmin_headers,
    )
    assert response.status_code == 200

    body = (await client.get("/api/v1/user-guide", headers=superadmin_headers)).json()
    assert [guide["role"] for guide in body["guides"]] == ["admin"]
    assert body["roles"] == ["standard", "admin", "superadmin"]


async def test_list_never_leaks_the_mongo_id(client, superadmin_headers):
    await _publish_all(client, superadmin_headers)
    body = (await client.get("/api/v1/user-guide", headers=superadmin_headers)).json()
    assert all("_id" not in guide for guide in body["guides"])


@pytest.mark.parametrize("target_role", ["admin", "superadmin"])
async def test_standard_user_cannot_read_a_higher_role_guide(
    client, standard_headers, superadmin_headers, target_role,
):
    await _publish_all(client, superadmin_headers)
    response = await client.get(f"/api/v1/user-guide/{target_role}", headers=standard_headers)
    assert response.status_code == 403


async def test_admin_cannot_read_the_superadmin_guide(client, admin_headers, superadmin_headers):
    await _publish_all(client, superadmin_headers)
    response = await client.get("/api/v1/user-guide/superadmin", headers=admin_headers)
    assert response.status_code == 403


async def test_admin_can_read_its_own_and_lower_guides(client, admin_headers, superadmin_headers):
    await _publish_all(client, superadmin_headers)
    for role in ("standard", "admin"):
        response = await client.get(f"/api/v1/user-guide/{role}", headers=admin_headers)
        assert response.status_code == 200
        assert response.json()["role"] == role


async def test_forbidden_beats_missing_for_a_higher_role(client, standard_headers):
    """Nothing is published at all here — a standard user asking for the
    superadmin guide must still get 403, not a 404 that confirms whether one
    exists."""
    response = await client.get("/api/v1/user-guide/superadmin", headers=standard_headers)
    assert response.status_code == 403


async def test_unknown_role_is_404(client, superadmin_headers):
    response = await client.get("/api/v1/user-guide/root", headers=superadmin_headers)
    assert response.status_code == 404


async def test_get_one_404s_when_nothing_is_published(client, standard_headers):
    response = await client.get("/api/v1/user-guide/standard", headers=standard_headers)
    assert response.status_code == 404


@pytest.mark.parametrize("headers_fixture", ["standard_headers", "admin_headers"])
async def test_publish_requires_superadmin(client, request, headers_fixture):
    headers = request.getfixturevalue(headers_fixture)
    response = await client.put("/api/v1/user-guide/standard", json=_guide("standard"), headers=headers)
    assert response.status_code == 403

    db = get_db()
    assert await db.user_guides.count_documents({}) == 0


async def test_publish_to_an_unknown_role_is_404(client, superadmin_headers):
    response = await client.put(
        "/api/v1/user-guide/root", json=_guide("standard"), headers=superadmin_headers,
    )
    assert response.status_code == 404


async def test_publish_creates_version_one_then_bumps(client, superadmin_headers):
    first = await client.put(
        "/api/v1/user-guide/admin", json=_guide("admin", "v1"), headers=superadmin_headers,
    )
    assert first.status_code == 200
    assert first.json()["version"] == 1

    second = await client.put(
        "/api/v1/user-guide/admin", json=_guide("admin", "v2"), headers=superadmin_headers,
    )
    assert second.status_code == 200
    body = second.json()
    assert body["version"] == 2
    assert body["label"] == "v2"

    db = get_db()
    assert await db.user_guides.count_documents({}) == 1, "publish must upsert, never insert a second row"


async def test_publish_stamps_metadata_and_ignores_the_body_role(client, superadmin_headers):
    payload = _guide("standard")
    payload["role"] = "superadmin"

    response = await client.put("/api/v1/user-guide/standard", json=payload, headers=superadmin_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["role"] == "standard"
    assert body["updated_by"] == "demo-superadmin@hirely.ai"
    assert body["updated_at"] and body["created_at"]
    assert "_id" not in body

    db = get_db()
    assert await db.user_guides.find_one({"_id": "superadmin"}) is None


async def test_chapters_round_trip_losslessly(client, superadmin_headers):
    payload = _guide("superadmin")
    payload["chapters"] = copy.deepcopy(_FULL_TREE)
    payload["intro"] = ["One.", "Two.", "Three."]

    put_response = await client.put(
        "/api/v1/user-guide/superadmin", json=payload, headers=superadmin_headers,
    )
    assert put_response.status_code == 200
    assert put_response.json()["chapters"] == _FULL_TREE

    get_response = await client.get("/api/v1/user-guide/superadmin", headers=superadmin_headers)
    assert get_response.status_code == 200
    body = get_response.json()
    assert body["chapters"] == _FULL_TREE, "the guide tree must survive Mongo unchanged"
    assert body["intro"] == ["One.", "Two.", "Three."]
    assert body["label"] == payload["label"]
    assert body["tagline"] == payload["tagline"]


async def test_republishing_a_fetched_guide_verbatim_works(client, superadmin_headers):
    """Fetch → edit → PUT the whole object back is the obvious editing loop,
    and the GET response carries server-owned fields (`version`, `created_at`,
    …). Those must be stripped before the update: a `version` left in the
    `$set` document collides with the `$inc` on the same path and MongoDB
    rejects the entire write."""
    first = await client.put(
        "/api/v1/user-guide/admin", json=_guide("admin"), headers=superadmin_headers,
    )
    assert first.status_code == 200

    fetched = (await client.get("/api/v1/user-guide/admin", headers=superadmin_headers)).json()
    assert "version" in fetched and "created_at" in fetched
    fetched["label"] = "Edited in place"

    second = await client.put("/api/v1/user-guide/admin", json=fetched, headers=superadmin_headers)
    assert second.status_code == 200, second.text
    body = second.json()
    assert body["version"] == 2, "the server owns version — a client-supplied one must not stick"
    assert body["label"] == "Edited in place"
    assert body["created_at"] == fetched["created_at"]


async def test_unset_optional_fields_are_not_resurrected_as_nulls(client, superadmin_headers):
    """TypeScript `undefined` is simply absent from JSON.stringify output; it
    must stay absent rather than coming back as an explicit null, otherwise the
    frontend's `subsection.body && …` checks start rendering empty blocks."""
    response = await client.put(
        "/api/v1/user-guide/standard", json=_guide("standard"), headers=superadmin_headers,
    )
    assert response.status_code == 200
    subsection = response.json()["chapters"][0]["sections"][0]["subsections"][0]
    assert set(subsection) == {"id", "title"}


async def test_unknown_content_fields_are_preserved(client, superadmin_headers):
    """The tree is authored in the frontend; a key this backend has never heard
    of must round-trip, not be silently dropped."""
    payload = _guide("standard")
    payload["chapters"][0]["sections"][0]["subsections"][0]["videoUrl"] = "https://example.com/v.mp4"
    payload["chapters"][0]["future_field"] = {"nested": [1, 2, 3]}

    response = await client.put(
        "/api/v1/user-guide/standard", json=payload, headers=superadmin_headers,
    )
    assert response.status_code == 200
    chapter = response.json()["chapters"][0]
    assert chapter["future_field"] == {"nested": [1, 2, 3]}
    assert chapter["sections"][0]["subsections"][0]["videoUrl"] == "https://example.com/v.mp4"


@pytest.mark.parametrize("mutate", [
    pytest.param(lambda p: p.pop("label"), id="missing-label"),
    pytest.param(lambda p: p["chapters"][0].pop("title"), id="chapter-missing-title"),
    pytest.param(lambda p: p["chapters"][0]["sections"][0].pop("summary"), id="section-missing-summary"),
    pytest.param(lambda p: p.__setitem__("chapters", "not-a-list"), id="chapters-not-a-list"),
])
async def test_publish_rejects_malformed_content(client, superadmin_headers, mutate):
    payload = _guide("standard")
    mutate(payload)
    response = await client.put(
        "/api/v1/user-guide/standard", json=payload, headers=superadmin_headers,
    )
    assert response.status_code == 422


async def test_publish_is_audit_logged(client, superadmin_headers):
    response = await client.put(
        "/api/v1/user-guide/admin", json=_guide("admin"), headers=superadmin_headers,
    )
    assert response.status_code == 200

    db = get_db()
    entry = await _wait_for_audit_entry(
        db, {"action": "user_guide_publish", "resource_type": "user_guide", "resource_id": "admin"},
    )
    assert entry is not None, "publish must write an audit event"
    assert entry["actor_email"] == "demo-superadmin@hirely.ai"
    assert entry["details"]["version"] == 1


@pytest.mark.parametrize("headers_fixture", ["standard_headers", "admin_headers"])
async def test_delete_requires_superadmin(client, request, superadmin_headers, headers_fixture):
    await client.put("/api/v1/user-guide/standard", json=_guide("standard"), headers=superadmin_headers)

    headers = request.getfixturevalue(headers_fixture)
    response = await client.delete("/api/v1/user-guide/standard", headers=headers)
    assert response.status_code == 403

    db = get_db()
    assert await db.user_guides.count_documents({"_id": "standard"}) == 1


async def test_delete_removes_the_override(client, superadmin_headers):
    await client.put("/api/v1/user-guide/standard", json=_guide("standard"), headers=superadmin_headers)

    response = await client.delete("/api/v1/user-guide/standard", headers=superadmin_headers)
    assert response.status_code == 200
    assert response.json()["was_customized"] is True

    assert (await client.get("/api/v1/user-guide/standard", headers=superadmin_headers)).status_code == 404
    db = get_db()
    assert await db.user_guides.count_documents({"_id": "standard"}) == 0


async def test_delete_is_idempotent(client, superadmin_headers):
    response = await client.delete("/api/v1/user-guide/standard", headers=superadmin_headers)
    assert response.status_code == 200
    assert response.json()["was_customized"] is False


async def test_delete_of_an_unknown_role_is_404(client, superadmin_headers):
    response = await client.delete("/api/v1/user-guide/root", headers=superadmin_headers)
    assert response.status_code == 404


async def test_delete_is_audit_logged(client, superadmin_headers):
    await client.put("/api/v1/user-guide/admin", json=_guide("admin"), headers=superadmin_headers)
    response = await client.delete("/api/v1/user-guide/admin", headers=superadmin_headers)
    assert response.status_code == 200

    db = get_db()
    entry = await _wait_for_audit_entry(
        db, {"action": "user_guide_reset", "resource_type": "user_guide", "resource_id": "admin"},
    )
    assert entry is not None, "reset must write an audit event"
    assert entry["details"]["was_customized"] is True


async def test_seed_normalizes_the_bare_list_shape():
    guides = _normalize_payload([_guide("standard")])
    assert [item["role"] for item in guides] == ["standard"]


async def test_seed_normalizes_the_api_response_shape():
    guides = _normalize_payload({"guides": [_guide("admin"), _guide("standard")]})
    assert {item["role"] for item in guides} == {"admin", "standard"}


async def test_seed_normalizes_the_role_keyed_shape():
    payload = {role: {k: v for k, v in _guide(role).items() if k != "role"} for role in ("admin", "standard")}
    guides = _normalize_payload(payload)
    assert {item["role"] for item in guides} == {"admin", "standard"}


async def test_seed_validates_before_writing_anything():
    validated = validate_guides([_guide("standard"), _guide("admin")])
    assert [role for role, _ in validated] == ["standard", "admin"]

    with pytest.raises(ValueError, match="expected one of"):
        validate_guides([_guide("standard"), {**_guide("admin"), "role": "root"}])

    with pytest.raises(ValueError, match="more than one guide"):
        validate_guides([_guide("admin"), _guide("admin")])
