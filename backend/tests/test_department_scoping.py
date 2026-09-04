"""Tests for task C1 (MVP2 §2.1):

  Part A — department/branch scoping for the Jobs resource
           (routes/jobs.py: create_job/update_job store department_id,
           list_jobs applies services.hr_module.permissions.get_department_scope).

  Part B — full audit-log coverage for jobs/interview/offers/scenarios/coding
           routes (all previously had zero log_audit_event call sites).

Department-scoped users must be REAL DB users with a real JWT (obtained via
POST /auth/login) — the `demo-<role>-token` bypass in
shared.auth.get_current_user always returns a static dict with no
department_id, so it can never exercise get_department_scope's restricted
branch. admin_headers/standard_headers/superadmin_headers (conftest.py) stay
on the demo bypass and are used for everything that doesn't need a
department_id set on the acting user.
"""
import asyncio
import uuid

import pytest
from passlib.context import CryptContext

from config.database import get_db

pytestmark = pytest.mark.anyio

pwd_ctx = CryptContext(schemes=["bcrypt"])

JOB_PAYLOAD = {
    "title": "Scoped Backend Engineer",
    "description": "Build APIs and services for the department-scoping test suite.",
    "difficulty": "mid",
    "employment_type": "full-time",
    "location": "Remote",
    "is_remote": True,
    "company_name": "Test Corp",
}


async def _make_scoped_user(client, db, *, department_id: str) -> tuple[dict, str]:
    """Insert a real 'standard' user with department_id set and log in for a
    real bearer token. Returns (headers, email) — caller is responsible for
    deleting the user afterwards."""
    email = f"dept-user-{uuid.uuid4().hex[:10]}@example.com"
    password = "Test@12345"
    await db.users.insert_one({
        "name": "Dept Scoping Test User",
        "email": email,
        "password_hash": pwd_ctx.hash(password),
        "role": "standard",
        "department_id": department_id,
        "otp_required": False,
        "is_active": True,
    })
    resp = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}, email


async def _create_job(client, headers, *, department_id: str | None = None, suffix: str = "") -> dict:
    payload = {**JOB_PAYLOAD, "title": f"{JOB_PAYLOAD['title']} {suffix}".strip()}
    if department_id is not None:
        payload["department_id"] = department_id
    resp = await client.post("/api/v1/jobs", json=payload, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _list_job_ids(client, headers) -> set:
    resp = await client.get("/api/v1/jobs", params={"limit": 500}, headers=headers)
    assert resp.status_code == 200, resp.text
    return {j["job_id"] for j in resp.json()["jobs"]}


async def _find_audit_entry(db, *, action: str, resource_id: str, attempts: int = 10, delay: float = 0.2):
    """Fire-and-forget audit writes (asyncio.create_task, never awaited inline)
    need a moment to land — poll briefly instead of a single fixed sleep."""
    for _ in range(attempts):
        entry = await db.audit_log.find_one({"action": action, "resource_id": resource_id})
        if entry:
            return entry
        await asyncio.sleep(delay)
    return None


async def test_job_with_department_id_visible_only_within_same_department(
    client, admin_headers, standard_headers,
):
    db = get_db()
    assert db is not None

    dept_a_headers, dept_a_email = await _make_scoped_user(client, db, department_id="dept-a")
    dept_b_headers, dept_b_email = await _make_scoped_user(client, db, department_id="dept-b")

    job = await _create_job(client, admin_headers, department_id="dept-a", suffix=uuid.uuid4().hex[:8])
    job_id = job["job_id"]
    try:
        assert job.get("department_id") == "dept-a"

        same_dept_ids = await _list_job_ids(client, dept_a_headers)
        assert job_id in same_dept_ids

        other_dept_ids = await _list_job_ids(client, dept_b_headers)
        assert job_id not in other_dept_ids

        no_dept_ids = await _list_job_ids(client, standard_headers)
        assert job_id in no_dept_ids
    finally:
        await db.jobs.delete_one({"job_id": job_id})
        await db.audit_log.delete_many({"resource_id": job_id})
        await db.users.delete_many({"email": {"$in": [dept_a_email, dept_b_email]}})


async def test_job_with_department_id_visible_to_admin_and_superadmin_regardless(
    client, admin_headers, superadmin_headers,
):
    db = get_db()
    assert db is not None

    job = await _create_job(client, admin_headers, department_id="dept-a", suffix=uuid.uuid4().hex[:8])
    job_id = job["job_id"]
    try:
        admin_ids = await _list_job_ids(client, admin_headers)
        assert job_id in admin_ids

        superadmin_ids = await _list_job_ids(client, superadmin_headers)
        assert job_id in superadmin_ids
    finally:
        await db.jobs.delete_one({"job_id": job_id})
        await db.audit_log.delete_many({"resource_id": job_id})


async def test_job_without_department_id_is_visible_to_everyone(client, admin_headers):
    """Backward compatibility: a job with no department_id (the default —
    every job created before this feature existed) stays visible to every
    account, department-scoped or not."""
    db = get_db()
    assert db is not None

    dept_a_headers, dept_a_email = await _make_scoped_user(client, db, department_id="dept-a")

    job = await _create_job(client, admin_headers, suffix=uuid.uuid4().hex[:8])
    job_id = job["job_id"]
    try:
        assert job.get("department_id") is None

        assert job_id in await _list_job_ids(client, dept_a_headers)
        assert job_id in await _list_job_ids(client, admin_headers)
    finally:
        await db.jobs.delete_one({"job_id": job_id})
        await db.audit_log.delete_many({"resource_id": job_id})
        await db.users.delete_many({"email": dept_a_email})


async def test_update_job_can_set_department_id(client, admin_headers):
    db = get_db()
    assert db is not None

    job = await _create_job(client, admin_headers, suffix=uuid.uuid4().hex[:8])
    job_id = job["job_id"]
    try:
        assert job.get("department_id") is None

        patch_resp = await client.patch(
            f"/api/v1/jobs/{job_id}", json={"department_id": "dept-a"}, headers=admin_headers
        )
        assert patch_resp.status_code == 200
        assert patch_resp.json()["department_id"] == "dept-a"
    finally:
        await db.jobs.delete_one({"job_id": job_id})
        await db.audit_log.delete_many({"resource_id": job_id})


async def test_job_create_is_audit_logged(client, admin_headers):
    db = get_db()
    assert db is not None

    job = await _create_job(client, admin_headers, department_id="dept-a", suffix=uuid.uuid4().hex[:8])
    job_id = job["job_id"]
    try:
        entry = await _find_audit_entry(db, action="job_create", resource_id=job_id)
        assert entry is not None
        assert entry["actor_email"] == "demo-admin@hirely.ai"
        assert entry["actor_role"] == "admin"
        assert entry["resource_type"] == "job"
        assert entry["details"]["department_id"] == "dept-a"
    finally:
        await db.jobs.delete_one({"job_id": job_id})
        await db.audit_log.delete_many({"resource_id": job_id})


async def test_job_update_is_audit_logged(client, admin_headers):
    db = get_db()
    assert db is not None

    job = await _create_job(client, admin_headers, suffix=uuid.uuid4().hex[:8])
    job_id = job["job_id"]
    try:
        patch_resp = await client.patch(
            f"/api/v1/jobs/{job_id}", json={"location": "Berlin"}, headers=admin_headers
        )
        assert patch_resp.status_code == 200

        entry = await _find_audit_entry(db, action="job_update", resource_id=job_id)
        assert entry is not None
        assert entry["actor_email"] == "demo-admin@hirely.ai"
        assert entry["resource_type"] == "job"
        assert entry["details"]["location"] == "Berlin"
    finally:
        await db.jobs.delete_one({"job_id": job_id})
        await db.audit_log.delete_many({"resource_id": job_id})


async def test_job_delete_is_audit_logged(client, admin_headers):
    db = get_db()
    assert db is not None

    job = await _create_job(client, admin_headers, suffix=uuid.uuid4().hex[:8])
    job_id = job["job_id"]

    delete_resp = await client.delete(f"/api/v1/jobs/{job_id}", headers=admin_headers)
    assert delete_resp.status_code == 200

    try:
        entry = await _find_audit_entry(db, action="job_delete", resource_id=job_id)
        assert entry is not None
        assert entry["actor_email"] == "demo-admin@hirely.ai"
        assert entry["resource_type"] == "job"
    finally:
        await db.audit_log.delete_many({"resource_id": job_id})


async def test_interview_schedule_is_audit_logged(client, admin_headers):
    db = get_db()
    assert db is not None

    job = await _create_job(client, admin_headers, suffix=uuid.uuid4().hex[:8])
    job_id = job["job_id"]
    cand_resp = await client.post(
        "/api/v1/candidates",
        json={"job_id": job_id, "name": "Schedule Audit Candidate", "email": f"sched.{uuid.uuid4().hex[:8]}@example.com"},
        headers=admin_headers,
    )
    assert cand_resp.status_code == 200
    candidate_id = cand_resp.json()["candidate_id"]

    try:
        sched_resp = await client.patch(
            f"/api/v1/interview/{candidate_id}/schedule",
            json={"scheduled_start_at": "2026-08-01T10:00:00+00:00"},
            headers=admin_headers,
        )
        assert sched_resp.status_code == 200

        entry = await _find_audit_entry(db, action="interview_schedule", resource_id=candidate_id)
        assert entry is not None
        assert entry["actor_email"] == "demo-admin@hirely.ai"
        assert entry["resource_type"] == "candidate"
    finally:
        await db.jobs.delete_one({"job_id": job_id})
        await db.candidates.delete_one({"candidate_id": candidate_id})
        await db.audit_log.delete_many({"resource_id": {"$in": [job_id, candidate_id]}})


async def test_offer_lifecycle_is_audit_logged(client, admin_headers):
    db = get_db()
    assert db is not None

    job = await _create_job(client, admin_headers, suffix=uuid.uuid4().hex[:8])
    job_id = job["job_id"]
    cand_resp = await client.post(
        "/api/v1/candidates",
        json={"job_id": job_id, "name": "Offer Audit Candidate", "email": f"offer.audit.{uuid.uuid4().hex[:8]}@example.com"},
        headers=admin_headers,
    )
    assert cand_resp.status_code == 200
    candidate_id = cand_resp.json()["candidate_id"]

    offer_id = None
    try:
        create_resp = await client.post(
            "/api/v1/offers",
            json={"candidate_id": candidate_id, "salary": "100000 USD/year"},
            headers=admin_headers,
        )
        assert create_resp.status_code == 200
        offer_id = create_resp.json()["offer_id"]

        entry = await _find_audit_entry(db, action="offer_create", resource_id=offer_id)
        assert entry is not None
        assert entry["resource_type"] == "offer"

        approve_resp = await client.post(f"/api/v1/offers/{offer_id}/approve", headers=admin_headers)
        assert approve_resp.status_code == 200
        assert await _find_audit_entry(db, action="offer_approve", resource_id=offer_id) is not None

        send_resp = await client.post(f"/api/v1/offers/{offer_id}/send", headers=admin_headers)
        assert send_resp.status_code == 200
        assert await _find_audit_entry(db, action="offer_send", resource_id=offer_id) is not None

        withdraw_resp = await client.post(f"/api/v1/offers/{offer_id}/withdraw", headers=admin_headers)
        assert withdraw_resp.status_code == 200
        assert await _find_audit_entry(db, action="offer_withdraw", resource_id=offer_id) is not None
    finally:
        await db.jobs.delete_one({"job_id": job_id})
        await db.candidates.delete_one({"candidate_id": candidate_id})
        if offer_id:
            await db.offers.delete_one({"offer_id": offer_id})
            await db.audit_log.delete_many({"resource_id": offer_id})
        await db.audit_log.delete_many({"resource_id": {"$in": [job_id, candidate_id]}})


async def test_scenario_crud_is_audit_logged(client, admin_headers):
    db = get_db()
    assert db is not None

    scenario_id = None
    try:
        create_resp = await client.post(
            "/api/v1/scenarios",
            json={
                "name": f"Audit Scenario {uuid.uuid4().hex[:8]}",
                "prompt": "Walk the candidate through a production incident.",
                "job_domain": "software_engineering",
            },
            headers=admin_headers,
        )
        assert create_resp.status_code == 200
        scenario_id = create_resp.json()["scenario_id"]
        assert await _find_audit_entry(db, action="scenario_create", resource_id=scenario_id) is not None

        update_resp = await client.patch(
            f"/api/v1/scenarios/{scenario_id}", json={"is_active": False}, headers=admin_headers
        )
        assert update_resp.status_code == 200
        update_entry = await _find_audit_entry(db, action="scenario_update", resource_id=scenario_id)
        assert update_entry is not None
        assert update_entry["details"]["is_active"] is False

        delete_resp = await client.delete(f"/api/v1/scenarios/{scenario_id}", headers=admin_headers)
        assert delete_resp.status_code == 200
        assert await _find_audit_entry(db, action="scenario_delete", resource_id=scenario_id) is not None
    finally:
        if scenario_id:
            await db.scenarios.delete_one({"scenario_id": scenario_id})
            await db.audit_log.delete_many({"resource_id": scenario_id})


async def test_coding_question_crud_and_assign_is_audit_logged(client, admin_headers):
    db = get_db()
    assert db is not None

    question_id = None
    candidate_id = None
    try:
        create_resp = await client.post(
            "/api/v1/coding/questions",
            json={
                "title": "Audit Coverage Question",
                "description": "Return the sum of two integers.",
                "language_templates": {"python": "print(sum(map(int, input().split())))\n"},
                "test_cases": [{"input": "2 3", "expected_output": "5", "is_hidden": False}],
                "job_domain": "software_engineering",
                "difficulty": "easy",
            },
            headers=admin_headers,
        )
        assert create_resp.status_code == 200
        question_id = create_resp.json()["question_id"]
        assert await _find_audit_entry(db, action="coding_question_create", resource_id=question_id) is not None

        update_resp = await client.patch(
            f"/api/v1/coding/questions/{question_id}", json={"difficulty": "medium"}, headers=admin_headers
        )
        assert update_resp.status_code == 200
        update_entry = await _find_audit_entry(db, action="coding_question_update", resource_id=question_id)
        assert update_entry is not None
        assert update_entry["details"]["difficulty"] == "medium"

        candidate_id = str(uuid.uuid4())
        await db.candidates.insert_one({
            "doc_type": "candidate",
            "candidate_id": candidate_id,
            "job_id": None,
            "secure_token": f"tok_{uuid.uuid4().hex[:12]}",
            "name": "Coding Audit Candidate",
            "email": f"coding.audit.{uuid.uuid4().hex[:8]}@example.com",
            "status": "invited",
        })
        assign_resp = await client.patch(
            f"/api/v1/coding/assign/{candidate_id}",
            json={"question_id": question_id},
            headers=admin_headers,
        )
        assert assign_resp.status_code == 200
        assign_entry = await _find_audit_entry(db, action="coding_question_assign", resource_id=candidate_id)
        assert assign_entry is not None
        assert assign_entry["details"]["question_id"] == question_id

        delete_resp = await client.delete(f"/api/v1/coding/questions/{question_id}", headers=admin_headers)
        assert delete_resp.status_code == 200
        assert await _find_audit_entry(db, action="coding_question_delete", resource_id=question_id) is not None
    finally:
        if question_id:
            await db.coding_questions.delete_one({"question_id": question_id})
            await db.audit_log.delete_many({"resource_id": question_id})
        if candidate_id:
            await db.candidates.delete_one({"candidate_id": candidate_id})
            await db.audit_log.delete_many({"resource_id": candidate_id})
