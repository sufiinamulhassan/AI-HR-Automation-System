import uuid
from datetime import datetime, timedelta, timezone

import pytest
from passlib.context import CryptContext

from config.database import get_db
from config.settings import settings
from services.hr_module import employee_service
from services.hr_module.permissions import DEFAULT_ROLE_PERMISSIONS

pytestmark = pytest.mark.anyio

pwd_ctx = CryptContext(schemes=["bcrypt"])

JOB_PAYLOAD = {
    "title": "Performance Test Engineer",
    "description": "Build and ship reliable systems for the OPR test suite.",
    "difficulty": "mid",
    "employment_type": "full-time",
    "location": "Remote",
    "is_remote": True,
    "company_name": "Test Corp",
}

OFFER_PAYLOAD = {
    "salary": "100000 USD/year",
    "benefits": "Health, dental",
    "joining_date": "2026-10-01",
}


async def _create_job(client, headers, *, department_id=None, job_grade=None, suffix=""):
    payload = {**JOB_PAYLOAD, "title": f"{JOB_PAYLOAD['title']} {suffix}".strip()}
    if department_id is not None:
        payload["department_id"] = department_id
    if job_grade is not None:
        payload["job_grade"] = job_grade
    resp = await client.post("/api/v1/jobs", json=payload, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["job_id"]


async def _create_candidate(client, headers, job_id, email):
    resp = await client.post(
        "/api/v1/candidates",
        json={"job_id": job_id, "name": email.split("@")[0], "email": email},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["candidate_id"]


async def _hire(client, headers, job_id, email) -> dict:
    candidate_id = await _create_candidate(client, headers, job_id, email)
    create_resp = await client.post(
        "/api/v1/offers", json={"candidate_id": candidate_id, **OFFER_PAYLOAD}, headers=headers,
    )
    assert create_resp.status_code == 200, create_resp.text
    offer = create_resp.json()
    offer_id = offer["offer_id"]

    assert (await client.post(f"/api/v1/offers/{offer_id}/approve", headers=headers)).status_code == 200
    assert (await client.post(f"/api/v1/offers/{offer_id}/send", headers=headers)).status_code == 200

    accept_resp = await client.post(
        f"/api/v1/offers/public/{offer['secure_token']}/accept",
        json={"typed_name": email.split("@")[0], "consent": True},
    )
    assert accept_resp.status_code == 200, accept_resp.text

    db = get_db()
    employee = await db.employees.find_one({"candidate_id": candidate_id}, {"_id": 0})
    assert employee is not None, "employee record was not auto-created on offer acceptance"
    return employee


async def _make_staff_user(client, db, *, permissions: list[str], email: str | None = None) -> tuple[dict, str]:
    role_name = f"perf_test_role_{uuid.uuid4().hex[:8]}"
    await db.roles.insert_one({"role_name": role_name, "permissions": permissions})
    email = email or f"perf-staff-{uuid.uuid4().hex[:10]}@example.com"
    password = "Test@12345"
    await db.users.insert_one({
        "name": "Perf Test Staff", "email": email, "password_hash": pwd_ctx.hash(password),
        "role": role_name, "is_active": True,
    })
    resp = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}, email


async def _active_cycle(client, admin_headers, *, review_types) -> dict:
    create_resp = await client.post(
        "/api/v1/performance/cycles",
        json={
            "name": f"Cycle {uuid.uuid4().hex[:6]}",
            "period_start": "2026-01-01",
            "period_end": "2026-06-30",
            "scope": {"type": "org_wide"},
            "review_types": review_types,
        },
        headers=admin_headers,
    )
    assert create_resp.status_code == 200, create_resp.text
    cycle = create_resp.json()
    activate_resp = await client.patch(
        f"/api/v1/performance/cycles/{cycle['cycle_id']}", json={"status": "active"}, headers=admin_headers,
    )
    assert activate_resp.status_code == 200, activate_resp.text
    return activate_resp.json()


async def test_employee_created_on_offer_acceptance(client, admin_headers):
    db = get_db()
    dept_resp = await client.post(
        "/api/v1/admin/departments", json={"name": f"Engineering {uuid.uuid4().hex[:6]}"}, headers=admin_headers,
    )
    assert dept_resp.status_code == 200, dept_resp.text
    department_id = dept_resp.json()["department_id"]

    grade_resp = await client.post(
        "/api/v1/admin/job-grades", json={"name": f"Grade-{uuid.uuid4().hex[:6]}"}, headers=admin_headers,
    )
    assert grade_resp.status_code == 200, grade_resp.text
    job_grade = grade_resp.json()["name"]

    job_id = await _create_job(client, admin_headers, department_id=department_id, job_grade=job_grade)
    employee = await _hire(client, admin_headers, job_id, f"hire-{uuid.uuid4().hex[:8]}@example.com")

    assert employee["job_id"] == job_id
    assert employee["department"] == department_id
    assert employee["job_grade"] == job_grade
    assert employee["manager_id"] is None
    assert employee["status"] == "active"
    assert employee["hired_at"]
    assert employee["offer_id"]

    job_id2 = await _create_job(client, admin_headers, suffix="decline-path")
    decline_email = f"decline-{uuid.uuid4().hex[:8]}@example.com"
    candidate_id = await _create_candidate(client, admin_headers, job_id2, decline_email)
    create_resp = await client.post(
        "/api/v1/offers", json={"candidate_id": candidate_id, **OFFER_PAYLOAD}, headers=admin_headers,
    )
    offer = create_resp.json()
    await client.post(f"/api/v1/offers/{offer['offer_id']}/approve", headers=admin_headers)
    await client.post(f"/api/v1/offers/{offer['offer_id']}/send", headers=admin_headers)
    decline_resp = await client.post(f"/api/v1/offers/public/{offer['secure_token']}/decline", json={})
    assert decline_resp.status_code == 200
    assert await db.employees.find_one({"candidate_id": candidate_id}) is None


async def test_employee_creation_is_idempotent_for_same_offer():
    db = get_db()
    offer = {
        "offer_id": f"offer-{uuid.uuid4().hex[:10]}",
        "candidate_id": f"cand-{uuid.uuid4().hex[:10]}",
        "job_id": "nonexistent-job",
    }
    first = await employee_service.create_employee_from_offer(db, offer)
    second = await employee_service.create_employee_from_offer(db, offer)
    assert first is not None and second is not None
    assert first["employee_id"] == second["employee_id"]
    count = await db.employees.count_documents({"offer_id": offer["offer_id"]})
    assert count == 1


async def test_cycle_create_requires_admin(client, standard_headers):
    resp = await client.post(
        "/api/v1/performance/cycles",
        json={
            "name": "Q1 Review", "period_start": "2026-01-01", "period_end": "2026-03-31",
            "scope": {"type": "org_wide"}, "review_types": ["self"],
        },
        headers=standard_headers,
    )
    assert resp.status_code == 403


async def test_cycle_lifecycle_and_read_gating(client, admin_headers, standard_headers):
    cycle = await _active_cycle(client, admin_headers, review_types=["self", "manager"])
    assert cycle["status"] == "active"

    denied = await client.get("/api/v1/performance/cycles", headers=standard_headers)
    assert denied.status_code == 403

    listed = await client.get("/api/v1/performance/cycles", headers=admin_headers)
    assert listed.status_code == 200
    assert any(c["cycle_id"] == cycle["cycle_id"] for c in listed.json()["cycles"])

    got = await client.get(f"/api/v1/performance/cycles/{cycle['cycle_id']}", headers=admin_headers)
    assert got.status_code == 200

    close_resp = await client.post(f"/api/v1/performance/cycles/{cycle['cycle_id']}/close", headers=admin_headers)
    assert close_resp.status_code == 200
    assert close_resp.json()["status"] == "closed"

    patch_after_close = await client.patch(
        f"/api/v1/performance/cycles/{cycle['cycle_id']}", json={"name": "renamed"}, headers=admin_headers,
    )
    assert patch_after_close.status_code == 400
    close_again = await client.post(f"/api/v1/performance/cycles/{cycle['cycle_id']}/close", headers=admin_headers)
    assert close_again.status_code == 400


async def test_cycle_scope_and_review_type_validation(client, admin_headers):
    missing_value = await client.post(
        "/api/v1/performance/cycles",
        json={
            "name": "Bad Scope", "period_start": "2026-01-01", "period_end": "2026-03-31",
            "scope": {"type": "department"}, "review_types": ["self"],
        },
        headers=admin_headers,
    )
    assert missing_value.status_code == 400

    bad_type = await client.post(
        "/api/v1/performance/cycles",
        json={
            "name": "Bad Review Type", "period_start": "2026-01-01", "period_end": "2026-03-31",
            "scope": {"type": "org_wide"}, "review_types": ["nonsense"],
        },
        headers=admin_headers,
    )
    assert bad_type.status_code == 400


async def test_cycle_create_audit_logged(client, admin_headers):
    import asyncio

    db = get_db()
    cycle = await _active_cycle(client, admin_headers, review_types=["self"])

    entry = None
    for _ in range(10):
        entry = await db.audit_log.find_one({"action": "performance_cycle_create", "resource_id": cycle["cycle_id"]})
        if entry:
            break
        await asyncio.sleep(0.2)
    assert entry is not None
    assert entry["actor_email"] == "demo-admin@hirely.ai"


async def test_performance_manage_checked_even_for_admin_role(client, admin_headers):
    db = get_db()
    await db.roles.insert_one({
        "role_name": "admin",
        "permissions": [p for p in DEFAULT_ROLE_PERMISSIONS["admin"] if p != "performance:manage"],
    })
    try:
        resp = await client.post(
            "/api/v1/performance/cycles",
            json={
                "name": "Blocked Cycle", "period_start": "2026-01-01", "period_end": "2026-03-31",
                "scope": {"type": "org_wide"}, "review_types": ["self"],
            },
            headers=admin_headers,
        )
        assert resp.status_code == 403
    finally:
        await db.roles.delete_one({"role_name": "admin"})


async def test_performance_read_grants_visibility_without_manage(client):
    db = get_db()
    headers, _email = await _make_staff_user(client, db, permissions=["performance:read"])

    read_cycles = await client.get("/api/v1/performance/cycles", headers=headers)
    assert read_cycles.status_code == 200
    read_employees = await client.get("/api/v1/performance/employees", headers=headers)
    assert read_employees.status_code == 200

    cannot_manage = await client.post(
        "/api/v1/performance/cycles",
        json={
            "name": "Should Fail", "period_start": "2026-01-01", "period_end": "2026-03-31",
            "scope": {"type": "org_wide"}, "review_types": ["self"],
        },
        headers=headers,
    )
    assert cannot_manage.status_code == 403

    cannot_review = await client.post(
        "/api/v1/performance/reviews/manager-submit",
        json={"cycle_id": "does-not-matter", "employee_id": "does-not-matter", "reviewer_type": "manager", "ratings": {}},
        headers=headers,
    )
    assert cannot_review.status_code == 403


async def test_performance_review_alone_cannot_read_or_manage(client):
    db = get_db()
    headers, _email = await _make_staff_user(client, db, permissions=["performance:review"])

    cannot_read = await client.get("/api/v1/performance/cycles", headers=headers)
    assert cannot_read.status_code == 403

    cannot_manage = await client.patch(
        "/api/v1/performance/rating-scale", json={"scale_min": 1, "scale_max": 5}, headers=headers,
    )
    assert cannot_manage.status_code == 403

    my_reports = await client.get("/api/v1/performance/my-reports", headers=headers)
    assert my_reports.status_code == 200


async def test_rating_dimension_and_scale_crud(client, admin_headers, standard_headers):
    create_resp = await client.post(
        "/api/v1/performance/rating-dimensions",
        json={"name": f"Communication-{uuid.uuid4().hex[:6]}", "description": "Clarity and responsiveness"},
        headers=admin_headers,
    )
    assert create_resp.status_code == 200
    dimension = create_resp.json()

    duplicate = await client.post(
        "/api/v1/performance/rating-dimensions",
        json={"name": dimension["name"]},
        headers=admin_headers,
    )
    assert duplicate.status_code == 409

    denied = await client.post(
        "/api/v1/performance/rating-dimensions", json={"name": "Nope"}, headers=standard_headers,
    )
    assert denied.status_code == 403

    update_resp = await client.patch(
        f"/api/v1/performance/rating-dimensions/{dimension['dimension_id']}",
        json={"description": "Updated description"},
        headers=admin_headers,
    )
    assert update_resp.status_code == 200

    scale_resp = await client.patch(
        "/api/v1/performance/rating-scale", json={"scale_min": 1, "scale_max": 10}, headers=admin_headers,
    )
    assert scale_resp.status_code == 200
    assert scale_resp.json() == {"scale_min": 1, "scale_max": 10}

    bad_scale = await client.patch(
        "/api/v1/performance/rating-scale", json={"scale_min": 5, "scale_max": 1}, headers=admin_headers,
    )
    assert bad_scale.status_code == 400

    public_config = await client.get("/api/v1/performance/rating-config", headers=admin_headers)
    assert public_config.status_code == 200
    assert public_config.json()["scale_max"] == 10
    assert any(d["dimension_id"] == dimension["dimension_id"] for d in public_config.json()["dimensions"])
    anonymous = await client.get("/api/v1/performance/rating-config")
    assert anonymous.status_code == 200
    assert anonymous.json() == {"scale_min": 1, "scale_max": 5, "dimensions": []}

    delete_resp = await client.delete(
        f"/api/v1/performance/rating-dimensions/{dimension['dimension_id']}", headers=admin_headers,
    )
    assert delete_resp.status_code == 200

    await client.patch("/api/v1/performance/rating-scale", json={"scale_min": 1, "scale_max": 5}, headers=admin_headers)


async def test_self_review_token_flow_including_goals(client, admin_headers):
    db = get_db()
    dim_resp = await client.post(
        "/api/v1/performance/rating-dimensions",
        json={"name": f"Ownership-{uuid.uuid4().hex[:6]}"},
        headers=admin_headers,
    )
    dimension_name = dim_resp.json()["name"]

    job_id = await _create_job(client, admin_headers, suffix="self-review")
    employee = await _hire(client, admin_headers, job_id, f"self-{uuid.uuid4().hex[:8]}@example.com")
    cycle = await _active_cycle(client, admin_headers, review_types=["self", "peer"])

    goal_resp = await client.post(
        f"/api/v1/performance/employees/{employee['employee_id']}/goals",
        json={"title": "Ship the OPR module", "description": "MVP2 §6"},
        headers=admin_headers,
    )
    assert goal_resp.status_code == 200
    goal = goal_resp.json()
    assert goal["progress_pct"] == 0

    assign_resp = await client.post(
        "/api/v1/performance/reviews/assign",
        json={"cycle_id": cycle["cycle_id"], "employee_id": employee["employee_id"], "reviewer_type": "self"},
        headers=admin_headers,
    )
    assert assign_resp.status_code == 200
    review = assign_resp.json()
    assert review["reviewer_type"] == "self"
    assert review["secure_token"]
    assert "email_sent" in review

    public_get = await client.get(f"/api/v1/performance/public/{review['secure_token']}")
    assert public_get.status_code == 200
    body = public_get.json()
    assert body["reviewer_type"] == "self"
    assert body["status"] == "pending"
    assert body["rating_config"]["dimensions"]
    assert any(g["goal_id"] == goal["goal_id"] for g in body["goals"])

    submit_resp = await client.post(
        f"/api/v1/performance/public/{review['secure_token']}/submit",
        json={"ratings": {dimension_name: 4}, "comments": "Solid quarter"},
    )
    assert submit_resp.status_code == 200
    assert submit_resp.json()["status"] == "submitted"

    after_submit = await client.get(f"/api/v1/performance/public/{review['secure_token']}")
    assert after_submit.status_code == 200
    assert after_submit.json()["status"] == "submitted"

    resubmit = await client.post(
        f"/api/v1/performance/public/{review['secure_token']}/submit",
        json={"ratings": {dimension_name: 3}},
    )
    assert resubmit.status_code == 409

    progress_resp = await client.patch(
        f"/api/v1/performance/public/{review['secure_token']}/goals/{goal['goal_id']}",
        json={"progress_pct": 65},
    )
    assert progress_resp.status_code == 200
    assert progress_resp.json()["progress_pct"] == 65

    admin_goal_view = await client.get(
        f"/api/v1/performance/employees/{employee['employee_id']}/goals", headers=admin_headers,
    )
    assert any(g["goal_id"] == goal["goal_id"] and g["progress_pct"] == 65 for g in admin_goal_view.json()["goals"])

    admin_review_view = await client.get(
        "/api/v1/performance/reviews", params={"cycle_id": cycle["cycle_id"]}, headers=admin_headers,
    )
    assert any(r["review_id"] == review["review_id"] and r["status"] == "submitted" for r in admin_review_view.json()["reviews"])


async def test_peer_review_cannot_see_or_edit_reviewee_goals(client, admin_headers):
    db = get_db()
    dim_resp = await client.post(
        "/api/v1/performance/rating-dimensions",
        json={"name": f"Teamwork-{uuid.uuid4().hex[:6]}"},
        headers=admin_headers,
    )
    dimension_name = dim_resp.json()["name"]

    job_id = await _create_job(client, admin_headers, suffix="peer-review")
    reviewee = await _hire(client, admin_headers, job_id, f"reviewee-{uuid.uuid4().hex[:8]}@example.com")
    peer = await _hire(client, admin_headers, job_id, f"peer-{uuid.uuid4().hex[:8]}@example.com")
    cycle = await _active_cycle(client, admin_headers, review_types=["self", "peer"])

    goal_resp = await client.post(
        f"/api/v1/performance/employees/{reviewee['employee_id']}/goals",
        json={"title": "Reviewee's private goal"},
        headers=admin_headers,
    )
    goal = goal_resp.json()

    assign_resp = await client.post(
        "/api/v1/performance/reviews/assign",
        json={
            "cycle_id": cycle["cycle_id"], "employee_id": reviewee["employee_id"],
            "reviewer_type": "peer", "reviewer_employee_id": peer["employee_id"],
        },
        headers=admin_headers,
    )
    assert assign_resp.status_code == 200
    review = assign_resp.json()

    public_get = await client.get(f"/api/v1/performance/public/{review['secure_token']}")
    assert public_get.status_code == 200
    body = public_get.json()
    assert body["reviewer_type"] == "peer"
    assert body["employee_name"]
    assert body["reviewer_name"]
    assert body["goals"] is None

    blocked_progress = await client.patch(
        f"/api/v1/performance/public/{review['secure_token']}/goals/{goal['goal_id']}",
        json={"progress_pct": 99},
    )
    assert blocked_progress.status_code == 403

    submit_resp = await client.post(
        f"/api/v1/performance/public/{review['secure_token']}/submit",
        json={"ratings": {dimension_name: 5}, "comments": "Great collaborator"},
    )
    assert submit_resp.status_code == 200


async def test_review_assign_rejects_manager_and_skip_level(client, admin_headers):
    job_id = await _create_job(client, admin_headers, suffix="assign-validation")
    employee = await _hire(client, admin_headers, job_id, f"assign-{uuid.uuid4().hex[:8]}@example.com")
    cycle = await _active_cycle(client, admin_headers, review_types=["self", "manager"])

    resp = await client.post(
        "/api/v1/performance/reviews/assign",
        json={"cycle_id": cycle["cycle_id"], "employee_id": employee["employee_id"], "reviewer_type": "manager"},
        headers=admin_headers,
    )
    assert resp.status_code == 400


async def test_review_assign_requires_active_cycle_and_enabled_type(client, admin_headers):
    job_id = await _create_job(client, admin_headers, suffix="draft-cycle")
    employee = await _hire(client, admin_headers, job_id, f"draft-{uuid.uuid4().hex[:8]}@example.com")

    draft_resp = await client.post(
        "/api/v1/performance/cycles",
        json={
            "name": "Draft Cycle", "period_start": "2026-01-01", "period_end": "2026-03-31",
            "scope": {"type": "org_wide"}, "review_types": ["self"],
        },
        headers=admin_headers,
    )
    draft_cycle = draft_resp.json()
    on_draft = await client.post(
        "/api/v1/performance/reviews/assign",
        json={"cycle_id": draft_cycle["cycle_id"], "employee_id": employee["employee_id"], "reviewer_type": "self"},
        headers=admin_headers,
    )
    assert on_draft.status_code == 400

    cycle_without_peer = await _active_cycle(client, admin_headers, review_types=["self"])
    wrong_type = await client.post(
        "/api/v1/performance/reviews/assign",
        json={
            "cycle_id": cycle_without_peer["cycle_id"], "employee_id": employee["employee_id"],
            "reviewer_type": "peer", "reviewer_employee_id": employee["employee_id"],
        },
        headers=admin_headers,
    )
    assert wrong_type.status_code == 400


async def test_public_review_unknown_token(client):
    get_resp = await client.get("/api/v1/performance/public/tok_doesnotexist")
    assert get_resp.status_code == 404
    submit_resp = await client.post("/api/v1/performance/public/tok_doesnotexist/submit", json={"ratings": {}})
    assert submit_resp.status_code == 404


async def test_manager_and_skip_level_review_submission(client, admin_headers):
    db = get_db()
    dim_resp = await client.post(
        "/api/v1/performance/rating-dimensions",
        json={"name": f"Delivery-{uuid.uuid4().hex[:6]}"},
        headers=admin_headers,
    )
    dimension_name = dim_resp.json()["name"]

    job_id = await _create_job(client, admin_headers, suffix="manager-chain")

    email_a = f"report-a-{uuid.uuid4().hex[:8]}@example.com"
    email_b = f"manager-b-{uuid.uuid4().hex[:8]}@example.com"
    email_skip = f"skip-mgr-{uuid.uuid4().hex[:8]}@example.com"

    employee_a = await _hire(client, admin_headers, job_id, email_a)
    employee_b = await _hire(client, admin_headers, job_id, email_b)
    await _hire(client, admin_headers, job_id, email_skip)

    headers_b, _ = await _make_staff_user(client, db, permissions=["performance:review"], email=email_b)
    headers_skip, _ = await _make_staff_user(client, db, permissions=["performance:review"], email=email_skip)
    headers_stranger, _ = await _make_staff_user(client, db, permissions=["performance:review"])

    set_a_manager = await client.patch(
        f"/api/v1/performance/employees/{employee_a['employee_id']}/manager",
        json={"manager_id": email_b}, headers=admin_headers,
    )
    assert set_a_manager.status_code == 200
    set_b_manager = await client.patch(
        f"/api/v1/performance/employees/{employee_b['employee_id']}/manager",
        json={"manager_id": email_skip}, headers=admin_headers,
    )
    assert set_b_manager.status_code == 200

    cycle = await _active_cycle(client, admin_headers, review_types=["manager", "skip_level"])

    my_reports_b = await client.get("/api/v1/performance/my-reports", headers=headers_b)
    assert my_reports_b.status_code == 200
    assert {e["employee_id"] for e in my_reports_b.json()["direct_reports"]} == {employee_a["employee_id"]}

    my_reports_skip = await client.get("/api/v1/performance/my-reports", headers=headers_skip)
    assert my_reports_skip.status_code == 200
    assert {e["employee_id"] for e in my_reports_skip.json()["direct_reports"]} == {employee_b["employee_id"]}
    assert {e["employee_id"] for e in my_reports_skip.json()["skip_level_reports"]} == {employee_a["employee_id"]}

    stranger_attempt = await client.post(
        "/api/v1/performance/reviews/manager-submit",
        json={
            "cycle_id": cycle["cycle_id"], "employee_id": employee_a["employee_id"], "reviewer_type": "manager",
            "ratings": {dimension_name: 4},
        },
        headers=headers_stranger,
    )
    assert stranger_attempt.status_code == 403

    wrong_relation = await client.post(
        "/api/v1/performance/reviews/manager-submit",
        json={
            "cycle_id": cycle["cycle_id"], "employee_id": employee_a["employee_id"], "reviewer_type": "skip_level",
            "ratings": {dimension_name: 4},
        },
        headers=headers_b,
    )
    assert wrong_relation.status_code == 403

    direct_submit = await client.post(
        "/api/v1/performance/reviews/manager-submit",
        json={
            "cycle_id": cycle["cycle_id"], "employee_id": employee_a["employee_id"], "reviewer_type": "manager",
            "ratings": {dimension_name: 4}, "comments": "Consistently reliable",
        },
        headers=headers_b,
    )
    assert direct_submit.status_code == 200
    assert direct_submit.json()["status"] == "submitted"
    assert direct_submit.json()["reviewer_id"] == email_b

    duplicate_submit = await client.post(
        "/api/v1/performance/reviews/manager-submit",
        json={
            "cycle_id": cycle["cycle_id"], "employee_id": employee_a["employee_id"], "reviewer_type": "manager",
            "ratings": {dimension_name: 4},
        },
        headers=headers_b,
    )
    assert duplicate_submit.status_code == 409

    skip_submit = await client.post(
        "/api/v1/performance/reviews/manager-submit",
        json={
            "cycle_id": cycle["cycle_id"], "employee_id": employee_a["employee_id"], "reviewer_type": "skip_level",
            "ratings": {dimension_name: 5}, "comments": "Great trajectory",
        },
        headers=headers_skip,
    )
    assert skip_submit.status_code == 200
    assert skip_submit.json()["reviewer_type"] == "skip_level"

    mine_b = await client.get("/api/v1/performance/reviews/mine", headers=headers_b)
    assert mine_b.status_code == 200
    assert {r["review_id"] for r in mine_b.json()["reviews"]} == {direct_submit.json()["review_id"]}

    out_of_range = await client.post(
        "/api/v1/performance/reviews/manager-submit",
        json={
            "cycle_id": cycle["cycle_id"], "employee_id": employee_b["employee_id"], "reviewer_type": "manager",
            "ratings": {dimension_name: 999},
        },
        headers=headers_skip,
    )
    assert out_of_range.status_code == 400


async def test_employee_listing_filters_and_manager_assignment_validation(client, admin_headers):
    job_id = await _create_job(client, admin_headers, suffix="listing")
    employee = await _hire(client, admin_headers, job_id, f"listing-{uuid.uuid4().hex[:8]}@example.com")

    by_department = await client.get(
        "/api/v1/performance/employees", params={"department": "no-such-department"}, headers=admin_headers,
    )
    assert by_department.status_code == 200
    assert employee["employee_id"] not in {e["employee_id"] for e in by_department.json()["employees"]}

    unfiltered = await client.get("/api/v1/performance/employees", headers=admin_headers)
    assert employee["employee_id"] in {e["employee_id"] for e in unfiltered.json()["employees"]}

    got_one = await client.get(f"/api/v1/performance/employees/{employee['employee_id']}", headers=admin_headers)
    assert got_one.status_code == 200

    not_found = await client.get("/api/v1/performance/employees/does-not-exist", headers=admin_headers)
    assert not_found.status_code == 404

    unknown_manager = await client.patch(
        f"/api/v1/performance/employees/{employee['employee_id']}/manager",
        json={"manager_id": "no-such-manager@example.com"},
        headers=admin_headers,
    )
    assert unknown_manager.status_code == 404


async def test_goal_admin_crud_and_permission_gating(client, admin_headers, standard_headers):
    job_id = await _create_job(client, admin_headers, suffix="goals")
    employee = await _hire(client, admin_headers, job_id, f"goals-{uuid.uuid4().hex[:8]}@example.com")

    denied_create = await client.post(
        f"/api/v1/performance/employees/{employee['employee_id']}/goals",
        json={"title": "Should be denied"}, headers=standard_headers,
    )
    assert denied_create.status_code == 403

    create_resp = await client.post(
        f"/api/v1/performance/employees/{employee['employee_id']}/goals",
        json={"title": "Improve test coverage", "due_date": "2026-12-31"},
        headers=admin_headers,
    )
    assert create_resp.status_code == 200
    goal = create_resp.json()

    denied_read = await client.get(
        f"/api/v1/performance/employees/{employee['employee_id']}/goals", headers=standard_headers,
    )
    assert denied_read.status_code == 403

    update_resp = await client.patch(
        f"/api/v1/performance/goals/{goal['goal_id']}",
        json={"progress_pct": 40, "status": "active"},
        headers=admin_headers,
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["progress_pct"] == 40

    bad_progress = await client.patch(
        f"/api/v1/performance/goals/{goal['goal_id']}", json={"progress_pct": 150}, headers=admin_headers,
    )
    assert bad_progress.status_code == 400


async def test_cycles_active_reachable_with_review_only_permission(client):
    db = get_db()
    headers, _email = await _make_staff_user(client, db, permissions=["performance:review"])

    denied = await client.get("/api/v1/performance/cycles", headers=headers)
    assert denied.status_code == 403

    resp = await client.get("/api/v1/performance/cycles/active", headers=headers)
    assert resp.status_code == 200
    assert "cycles" in resp.json()


async def test_cycles_active_reachable_with_read_permission(client, admin_headers):
    headers_admin = admin_headers
    resp = await client.get("/api/v1/performance/cycles/active", headers=headers_admin)
    assert resp.status_code == 200


async def test_cycles_active_denied_without_either_permission(client, standard_headers):
    resp = await client.get("/api/v1/performance/cycles/active", headers=standard_headers)
    assert resp.status_code == 403


async def test_cycles_active_shape_is_minimal_and_excludes_non_active(client, admin_headers):
    active_cycle = await _active_cycle(client, admin_headers, review_types=["self"])

    draft_resp = await client.post(
        "/api/v1/performance/cycles",
        json={
            "name": f"Draft Only {uuid.uuid4().hex[:6]}", "period_start": "2026-01-01", "period_end": "2026-03-31",
            "scope": {"type": "org_wide"}, "review_types": ["self"],
        },
        headers=admin_headers,
    )
    draft_cycle = draft_resp.json()

    db = get_db()
    headers, _email = await _make_staff_user(client, db, permissions=["performance:review"])
    resp = await client.get("/api/v1/performance/cycles/active", headers=headers)
    assert resp.status_code == 200
    cycles = resp.json()["cycles"]

    ids = {c["cycle_id"] for c in cycles}
    assert active_cycle["cycle_id"] in ids
    assert draft_cycle["cycle_id"] not in ids

    matched = next(c for c in cycles if c["cycle_id"] == active_cycle["cycle_id"])
    assert set(matched.keys()) == {"cycle_id", "name", "status"}
    assert matched["status"] == "active"


async def test_cycle_coverage_identifies_outstanding_and_submitted_reviews(client, admin_headers):
    db = get_db()
    dim_resp = await client.post(
        "/api/v1/performance/rating-dimensions",
        json={"name": f"Coverage-{uuid.uuid4().hex[:6]}"},
        headers=admin_headers,
    )
    dimension_name = dim_resp.json()["name"]

    job_id = await _create_job(client, admin_headers, suffix="coverage")

    email_a = f"cov-report-a-{uuid.uuid4().hex[:8]}@example.com"
    email_b = f"cov-manager-b-{uuid.uuid4().hex[:8]}@example.com"
    email_no_manager = f"cov-lone-{uuid.uuid4().hex[:8]}@example.com"

    employee_a = await _hire(client, admin_headers, job_id, email_a)
    employee_b = await _hire(client, admin_headers, job_id, email_b)
    employee_lone = await _hire(client, admin_headers, job_id, email_no_manager)

    headers_b, _ = await _make_staff_user(client, db, permissions=["performance:review"], email=email_b)

    set_manager = await client.patch(
        f"/api/v1/performance/employees/{employee_a['employee_id']}/manager",
        json={"manager_id": email_b}, headers=admin_headers,
    )
    assert set_manager.status_code == 200

    cycle = await _active_cycle(client, admin_headers, review_types=["manager", "skip_level"])

    before = await client.get(
        f"/api/v1/performance/cycles/{cycle['cycle_id']}/coverage", headers=admin_headers,
    )
    assert before.status_code == 200
    body = before.json()
    assert body["cycle_id"] == cycle["cycle_id"]
    assert set(body["reviewer_types"]) == {"manager", "skip_level"}

    def _find(outstanding, employee_id, reviewer_type):
        return next(
            (o for o in outstanding if o["employee_id"] == employee_id and o["reviewer_type"] == reviewer_type),
            None,
        )

    a_manager_entry = _find(body["outstanding"], employee_a["employee_id"], "manager")
    assert a_manager_entry is not None
    assert a_manager_entry["expected_reviewer_email"] == email_b
    assert a_manager_entry["blocked"] is False

    a_skip_entry = _find(body["outstanding"], employee_a["employee_id"], "skip_level")
    assert a_skip_entry is not None
    assert a_skip_entry["expected_reviewer_email"] is None
    assert a_skip_entry["blocked"] is True

    lone_manager_entry = _find(body["outstanding"], employee_lone["employee_id"], "manager")
    assert lone_manager_entry is not None
    assert lone_manager_entry["blocked"] is True

    submit_resp = await client.post(
        "/api/v1/performance/reviews/manager-submit",
        json={
            "cycle_id": cycle["cycle_id"], "employee_id": employee_a["employee_id"], "reviewer_type": "manager",
            "ratings": {dimension_name: 4},
        },
        headers=headers_b,
    )
    assert submit_resp.status_code == 200

    after = await client.get(
        f"/api/v1/performance/cycles/{cycle['cycle_id']}/coverage", headers=admin_headers,
    )
    assert after.status_code == 200
    after_body = after.json()
    assert _find(after_body["outstanding"], employee_a["employee_id"], "manager") is None
    assert _find(after_body["outstanding"], employee_a["employee_id"], "skip_level") is not None
    assert after_body["submitted_reviews"] == body["submitted_reviews"] + 1
    assert after_body["outstanding_reviews"] == body["outstanding_reviews"] - 1
    assert after_body["expected_reviews"] == body["expected_reviews"]


async def test_cycle_coverage_permission_gate_accepts_either_read_or_manage(client, admin_headers):
    db = get_db()
    cycle = await _active_cycle(client, admin_headers, review_types=["manager"])

    read_only_headers, _ = await _make_staff_user(client, db, permissions=["performance:read"])
    manage_only_headers, _ = await _make_staff_user(client, db, permissions=["performance:manage"])
    review_only_headers, _ = await _make_staff_user(client, db, permissions=["performance:review"])

    read_resp = await client.get(
        f"/api/v1/performance/cycles/{cycle['cycle_id']}/coverage", headers=read_only_headers,
    )
    assert read_resp.status_code == 200

    manage_resp = await client.get(
        f"/api/v1/performance/cycles/{cycle['cycle_id']}/coverage", headers=manage_only_headers,
    )
    assert manage_resp.status_code == 200

    review_resp = await client.get(
        f"/api/v1/performance/cycles/{cycle['cycle_id']}/coverage", headers=review_only_headers,
    )
    assert review_resp.status_code == 403


async def test_cycle_coverage_unknown_cycle_404(client, admin_headers):
    resp = await client.get("/api/v1/performance/cycles/does-not-exist/coverage", headers=admin_headers)
    assert resp.status_code == 404


async def test_cycle_coverage_excludes_self_and_peer_reviewer_types(client, admin_headers):
    cycle = await _active_cycle(client, admin_headers, review_types=["self", "peer"])
    resp = await client.get(
        f"/api/v1/performance/cycles/{cycle['cycle_id']}/coverage", headers=admin_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["reviewer_types"] == []
    assert body["outstanding"] == []
    assert body["expected_reviews"] == 0


async def test_expired_pending_review_token_rejected_on_get_and_submit(client, admin_headers):
    db = get_db()
    dim_resp = await client.post(
        "/api/v1/performance/rating-dimensions",
        json={"name": f"Expiry-{uuid.uuid4().hex[:6]}"},
        headers=admin_headers,
    )
    dimension_name = dim_resp.json()["name"]

    job_id = await _create_job(client, admin_headers, suffix="expiry-pending")
    employee = await _hire(client, admin_headers, job_id, f"expiry-{uuid.uuid4().hex[:8]}@example.com")
    cycle = await _active_cycle(client, admin_headers, review_types=["self"])

    assign_resp = await client.post(
        "/api/v1/performance/reviews/assign",
        json={"cycle_id": cycle["cycle_id"], "employee_id": employee["employee_id"], "reviewer_type": "self"},
        headers=admin_headers,
    )
    assert assign_resp.status_code == 200
    review = assign_resp.json()

    stale_created_at = (
        datetime.now(timezone.utc) - timedelta(days=settings.PERFORMANCE_REVIEW_EXPIRY_DAYS + 1)
    ).isoformat()
    await db.performance_reviews.update_one(
        {"review_id": review["review_id"]}, {"$set": {"created_at": stale_created_at}},
    )

    get_resp = await client.get(f"/api/v1/performance/public/{review['secure_token']}")
    assert get_resp.status_code == 410

    submit_resp = await client.post(
        f"/api/v1/performance/public/{review['secure_token']}/submit",
        json={"ratings": {dimension_name: 4}},
    )
    assert submit_resp.status_code == 410


async def test_non_expired_pending_review_token_still_works(client, admin_headers):
    job_id = await _create_job(client, admin_headers, suffix="expiry-fresh")
    employee = await _hire(client, admin_headers, job_id, f"fresh-{uuid.uuid4().hex[:8]}@example.com")
    cycle = await _active_cycle(client, admin_headers, review_types=["self"])

    assign_resp = await client.post(
        "/api/v1/performance/reviews/assign",
        json={"cycle_id": cycle["cycle_id"], "employee_id": employee["employee_id"], "reviewer_type": "self"},
        headers=admin_headers,
    )
    review = assign_resp.json()

    get_resp = await client.get(f"/api/v1/performance/public/{review['secure_token']}")
    assert get_resp.status_code == 200


async def test_expired_but_already_submitted_review_token_still_allows_goal_progress_update(client, admin_headers):
    db = get_db()
    dim_resp = await client.post(
        "/api/v1/performance/rating-dimensions",
        json={"name": f"ExpiredSubmitted-{uuid.uuid4().hex[:6]}"},
        headers=admin_headers,
    )
    dimension_name = dim_resp.json()["name"]

    job_id = await _create_job(client, admin_headers, suffix="expiry-submitted")
    employee = await _hire(client, admin_headers, job_id, f"expsub-{uuid.uuid4().hex[:8]}@example.com")
    cycle = await _active_cycle(client, admin_headers, review_types=["self"])

    goal_resp = await client.post(
        f"/api/v1/performance/employees/{employee['employee_id']}/goals",
        json={"title": "Goal that outlives the review token's nominal expiry"},
        headers=admin_headers,
    )
    goal = goal_resp.json()

    assign_resp = await client.post(
        "/api/v1/performance/reviews/assign",
        json={"cycle_id": cycle["cycle_id"], "employee_id": employee["employee_id"], "reviewer_type": "self"},
        headers=admin_headers,
    )
    review = assign_resp.json()

    submit_resp = await client.post(
        f"/api/v1/performance/public/{review['secure_token']}/submit",
        json={"ratings": {dimension_name: 4}},
    )
    assert submit_resp.status_code == 200

    stale_created_at = (
        datetime.now(timezone.utc) - timedelta(days=settings.PERFORMANCE_REVIEW_EXPIRY_DAYS + 30)
    ).isoformat()
    await db.performance_reviews.update_one(
        {"review_id": review["review_id"]}, {"$set": {"created_at": stale_created_at}},
    )

    get_resp = await client.get(f"/api/v1/performance/public/{review['secure_token']}")
    assert get_resp.status_code == 200
    assert get_resp.json()["status"] == "submitted"

    progress_resp = await client.patch(
        f"/api/v1/performance/public/{review['secure_token']}/goals/{goal['goal_id']}",
        json={"progress_pct": 42},
    )
    assert progress_resp.status_code == 200
    assert progress_resp.json()["progress_pct"] == 42
