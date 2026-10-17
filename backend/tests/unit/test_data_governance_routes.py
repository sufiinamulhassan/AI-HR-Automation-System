import pytest
from httpx import ASGITransport, AsyncClient

import config.database as database
from config import tenancy
from config.tenancy import DEFAULT_COMPANY_ID
from fake_mongo import FakeRaw
from main import app
from services.hr_module import erasure_service
from test_erasure_service import EMAIL, FakeIndex, REASON, seed_person

pytestmark = pytest.mark.anyio

A, B = "cmp_a", "cmp_b"
API = "/api/v1"
SUPER = {"Authorization": f"Bearer demo-superadmin-token@@{A}"}
ADMIN = {"Authorization": f"Bearer demo-admin-token@@{A}"}
STANDARD = {"Authorization": f"Bearer demo-standard-token@@{A}"}


@pytest.fixture
async def world(monkeypatch):
    from types import SimpleNamespace

    raw = FakeRaw()
    index = FakeIndex()
    monkeypatch.setattr(database, "_db", raw)
    monkeypatch.setattr(erasure_service, "get_pinecone", lambda: index)
    tenancy.use_fallback_company(None)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        yield SimpleNamespace(raw=raw, index=index, db=tenancy.TenantDB(raw, A), client=client)
    tenancy.use_fallback_company(DEFAULT_COMPANY_ID)


async def test_a_superadmin_erases_a_candidate_through_the_route(world):
    seed_person(world, tag="1")
    response = await world.client.post(f"{API}/candidates/cand-1/erase", json={"reason": REASON}, headers=SUPER)

    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {"candidate_id", "erased", "already_erased", "erased_at", "counts", "vectors_failed", "other_applications"}
    assert body["candidate_id"] == "cand-1" and body["erased"] is True and body["already_erased"] is False
    assert body["counts"]["candidates"] == 1 and body["counts"]["resumes"] == 2 and body["vectors_failed"] == 0
    (tomb,) = world.raw.rows("candidates")
    assert tomb["erased"] is True and tomb["erasure"] == {"by": "demo-superadmin@hirely.ai", "reason": REASON}
    (audit,) = world.raw.rows("audit_log", action="candidate_erase")
    assert audit["actor_role"] == "superadmin" and REASON not in str(audit) and "Jane" not in str(audit)
    assert world.index.vectors == {}

    again = await world.client.post(f"{API}/candidates/cand-1/erase", json={"reason": REASON}, headers=SUPER)
    assert again.status_code == 200 and again.json()["already_erased"] is True
    assert again.json()["erased_at"] == body["erased_at"] and all(v == 0 for v in again.json()["counts"].values())


async def test_only_a_superadmin_passes_and_a_refused_call_changes_nothing(world):
    seed_person(world, tag="1")
    snapshot = world.raw.snapshot(A)
    calls = [
        ("post", "/candidates/cand-1/erase", {"reason": REASON}),
        ("post", "/candidates/erase-by-email", {"email": EMAIL, "reason": REASON}),
        ("get", "/company-settings/retention", None),
        ("patch", "/company-settings/retention", {"candidate_days": 90}),
    ]
    for method, path, body in calls:
        denied = await world.client.request(method, API + path, json=body, headers=ADMIN)
        assert denied.status_code == 403 and "candidates:erase" in denied.json()["detail"], (method, path)
        assert (await world.client.request(method, API + path, json=body, headers=STANDARD)).status_code == 403
        assert (await world.client.request(method, API + path, json=body)).status_code == 401
    assert world.raw.snapshot(A) == snapshot


async def test_the_reason_is_required_and_the_message_is_a_plain_sentence(world):
    seed_person(world, tag="1")
    for body in ({}, {"reason": ""}, {"reason": "ab"}, {"reason": "x" * 501}):
        response = await world.client.post(f"{API}/candidates/cand-1/erase", json=body, headers=SUPER)
        assert response.status_code == 422 and response.json()["detail"] == "Give a reason of 3 to 500 characters.", body
    assert world.raw.rows("candidates")[0]["name"] == "Jane Doe"
    assert (await world.client.post(f"{API}/candidates/cand-missing/erase", json={"reason": REASON}, headers=SUPER)).status_code == 404


async def test_erase_by_email_is_reached_not_read_as_a_candidate_id(world):
    seed_person(world, tag="1", job="job-1")
    seed_person(world, tag="2", job="job-2", email=EMAIL.lower())
    seed_person(world, tag="b", company=B)
    before = world.raw.snapshot(B)

    response = await world.client.post(
        f"{API}/candidates/erase-by-email", json={"email": EMAIL.upper(), "reason": REASON}, headers=SUPER,
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {"matched", "candidate_ids", "erased_at", "counts", "vectors_failed"}
    assert body["matched"] == 2 and sorted(body["candidate_ids"]) == ["cand-1", "cand-2"] and body["counts"]["candidates"] == 2
    assert world.raw.snapshot(B) == before
    empty = await world.client.post(f"{API}/candidates/erase-by-email", json={"email": "nobody@acme.test", "reason": REASON}, headers=SUPER)
    assert empty.status_code == 200 and empty.json()["matched"] == 0 and empty.json()["candidate_ids"] == []
    assert empty.json()["erased_at"] is None
    for bad in ({"reason": REASON}, {"email": "no-at", "reason": REASON}):
        invalid = await world.client.post(f"{API}/candidates/erase-by-email", json=bad, headers=SUPER)
        assert invalid.status_code == 422 and invalid.json()["detail"] == "Enter a valid email address."


async def test_employment_refuses_with_409_unless_the_request_says_otherwise(world):
    seed_person(world, tag="1")
    world.raw.add("offers", {"doc_type": "offer", "offer_id": "acc", "candidate_id": "cand-1", "status": "accepted", "salary": "9"})
    snapshot = world.raw.snapshot(A)

    refused = await world.client.post(f"{API}/candidates/cand-1/erase", json={"reason": REASON}, headers=SUPER)
    assert refused.status_code == 409 and refused.json()["detail"] == erasure_service.EMPLOYMENT_REFUSAL
    by_email = await world.client.post(f"{API}/candidates/erase-by-email", json={"email": EMAIL, "reason": REASON}, headers=SUPER)
    assert by_email.status_code == 409
    assert world.raw.snapshot(A) == snapshot

    allowed = await world.client.post(
        f"{API}/candidates/cand-1/erase", json={"reason": REASON, "include_employment": True}, headers=SUPER,
    )
    assert allowed.status_code == 200 and allowed.json()["counts"]["offers"] == 2
    assert "salary" not in world.raw.rows("offers", offer_id="acc")[0]


async def test_the_retention_periods_are_read_and_changed_through_the_route(world):
    first = await world.client.get(f"{API}/company-settings/retention", headers=SUPER)
    assert first.status_code == 200
    assert first.json() == {"candidate_days": None, "resume_days": None, "updated_at": None, "updated_by": None, "last_purge": None}

    patched = await world.client.patch(f"{API}/company-settings/retention", json={"candidate_days": 365}, headers=SUPER)
    assert patched.status_code == 200
    body = patched.json()
    assert (body["candidate_days"], body["resume_days"]) == (365, None) and body["updated_by"] == "demo-superadmin@hirely.ai"
    again = await world.client.patch(f"{API}/company-settings/retention", json={"resume_days": 30}, headers=SUPER)
    assert (again.json()["candidate_days"], again.json()["resume_days"]) == (365, 30)
    cleared = await world.client.patch(f"{API}/company-settings/retention", json={"candidate_days": None}, headers=SUPER)
    assert (cleared.json()["candidate_days"], cleared.json()["resume_days"]) == (None, 30)
    assert (await world.client.patch(f"{API}/company-settings/retention", json={}, headers=SUPER)).json()["resume_days"] == 30

    (doc,) = world.raw.rows("company_settings")
    assert doc["retention"]["resume_days"] == 30 and doc["retention"]["candidate_days"] is None
    audits = world.raw.rows("audit_log", action="retention_update")
    assert [a["details"]["after"]["candidate_days"] for a in audits] == [365, 365, None, None]
    assert audits[0]["details"]["before"] == {"candidate_days": None, "resume_days": None}

    for bad in ({"candidate_days": 29}, {"resume_days": 0}, {"candidate_days": -1}, {"resume_days": 7}, {"candidate_days": 40000}):
        response = await world.client.patch(f"{API}/company-settings/retention", json=bad, headers=SUPER)
        assert response.status_code == 422, bad
        assert isinstance(response.json()["detail"], str) and "-" not in response.json()["detail"]
    assert (await world.client.get(f"{API}/company-settings/retention", headers=SUPER)).json()["resume_days"] == 30


async def test_retention_is_per_company(world):
    await world.client.patch(f"{API}/company-settings/retention", json={"candidate_days": 60}, headers=SUPER)
    other = await world.client.get(f"{API}/company-settings/retention", headers={"Authorization": f"Bearer demo-superadmin-token@@{B}"})
    assert other.json()["candidate_days"] is None


async def test_a_tombstone_reads_cleanly_and_every_change_to_it_is_refused(world):
    seed_person(world, tag="1")
    seed_person(world, tag="2", email="second@acme.test")
    await world.client.post(f"{API}/candidates/cand-1/erase", json={"reason": REASON}, headers=SUPER)

    admin_view = (await world.client.get(f"{API}/candidates/cand-1", headers=ADMIN)).json()
    assert admin_view["erased"] is True and admin_view["erasure"]["reason"] == REASON
    assert not ({"name", "email", "secure_token", "transcript"} & set(admin_view))
    standard_view = (await world.client.get(f"{API}/candidates/cand-1", headers=STANDARD)).json()
    assert standard_view["erased"] is True and "erasure" not in standard_view and "secure_token" not in standard_view

    listing = await world.client.get(f"{API}/candidates", headers=ADMIN)
    assert listing.status_code == 200
    rows = {r["candidate_id"]: r for r in listing.json()["candidates"]}
    assert rows["cand-1"]["erased"] is True and rows["cand-2"]["name"] == "Jane Doe" and "erased" not in rows["cand-2"]
    assert (await world.client.get(f"{API}/candidates/cand-1/timeline", headers=STANDARD)).json() == {"timeline": []}

    attempts = [
        ("post", "/candidates/cand-1/regenerate-token", {"resend": False}),
        ("post", "/candidates/cand-1/decision", {"decision": "reject"}),
        ("patch", "/candidates/cand-1/notes", {"notes": "a new personal note"}),
        ("post", "/candidates/cand-1/resend-invite", None),
        ("post", "/candidates/cand-1/send-email", {"template": "reminder"}),
        ("patch", "/interview/cand-1/schedule", {"scheduled_start_at": "2030-01-01T10:00:00+00:00"}),
        ("patch", "/coding/assign/cand-1", {"question_id": "q1"}),
    ]
    for method, path, body in attempts:
        response = await world.client.request(method, API + path, json=body, headers=ADMIN)
        assert response.status_code == 409, (method, path, response.text)
        assert response.json()["detail"] == erasure_service.ERASED_MESSAGE
    assert (await world.client.post(f"{API}/offers", json={"candidate_id": "cand-1", "salary": "1"}, headers=ADMIN)).status_code == 404
    assert set(world.raw.rows("candidates", candidate_id="cand-1")[0]) <= erasure_service.CANDIDATE_KEEP
    assert (await world.client.post(f"{API}/candidates/cand-2/regenerate-token", json={"resend": False}, headers=ADMIN)).status_code == 200


async def test_a_company_cannot_reach_another_companys_candidate_through_the_route(world):
    seed_person(world, tag="1")
    other = {"Authorization": f"Bearer demo-superadmin-token@@{B}"}
    assert (await world.client.post(f"{API}/candidates/cand-1/erase", json={"reason": REASON}, headers=other)).status_code == 404
    assert world.raw.rows("candidates")[0]["name"] == "Jane Doe"
