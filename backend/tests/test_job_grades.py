import uuid

import pytest

from config.database import get_db

pytestmark = pytest.mark.anyio

JOB_PAYLOAD = {
    "title": "Banking Ops Analyst",
    "description": "Reconcile daily settlement reports.",
    "difficulty": "medium",
    "employment_type": "full-time",
    "location": "Remote",
    "is_remote": True,
    "company_name": "Test Bank",
}


async def _create_job_grade(client, headers, name: str) -> dict:
    response = await client.post(
        "/api/v1/admin/job-grades", json={"name": name, "description": "test grade"}, headers=headers,
    )
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
async def job_grade_fixture(client, admin_headers):
    name = f"Grade {uuid.uuid4().hex[:8]}"
    grade = await _create_job_grade(client, admin_headers, name)
    yield grade
    await get_db().job_grades.delete_one({"job_grade_id": grade["job_grade_id"]})


async def test_list_job_grades_is_readable_by_standard_user(client, standard_headers, job_grade_fixture):
    response = await client.get("/api/v1/admin/job-grades", headers=standard_headers)
    assert response.status_code == 200
    names = [g["name"] for g in response.json()["job_grades"]]
    assert job_grade_fixture["name"] in names


async def test_create_job_grade_requires_admin(client, standard_headers):
    response = await client.post(
        "/api/v1/admin/job-grades", json={"name": "Nope"}, headers=standard_headers,
    )
    assert response.status_code == 403


async def test_create_job_grade_success(client, admin_headers):
    name = f"AVP {uuid.uuid4().hex[:8]}"
    response = await client.post(
        "/api/v1/admin/job-grades", json={"name": name, "description": "Assistant VP"}, headers=admin_headers,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["name"] == name
    assert body["description"] == "Assistant VP"
    assert body["created_by"] == "demo-admin@hirely.ai"
    await get_db().job_grades.delete_one({"job_grade_id": body["job_grade_id"]})


async def test_create_duplicate_job_grade_conflicts(client, admin_headers, job_grade_fixture):
    response = await client.post(
        "/api/v1/admin/job-grades", json={"name": job_grade_fixture["name"]}, headers=admin_headers,
    )
    assert response.status_code == 409


async def test_update_job_grade_renames_it(client, admin_headers, job_grade_fixture):
    new_name = f"VP {uuid.uuid4().hex[:8]}"
    response = await client.patch(
        f"/api/v1/admin/job-grades/{job_grade_fixture['job_grade_id']}",
        json={"name": new_name}, headers=admin_headers,
    )
    assert response.status_code == 200

    stored = await get_db().job_grades.find_one({"job_grade_id": job_grade_fixture["job_grade_id"]})
    assert stored["name"] == new_name


async def test_update_unknown_job_grade_is_404(client, admin_headers):
    response = await client.patch(
        "/api/v1/admin/job-grades/no-such-id", json={"name": "X"}, headers=admin_headers,
    )
    assert response.status_code == 404


async def test_delete_job_grade(client, admin_headers):
    grade = await _create_job_grade(client, admin_headers, f"Grade {uuid.uuid4().hex[:8]}")
    response = await client.delete(f"/api/v1/admin/job-grades/{grade['job_grade_id']}", headers=admin_headers)
    assert response.status_code == 200
    assert await get_db().job_grades.find_one({"job_grade_id": grade["job_grade_id"]}) is None


async def test_delete_unknown_job_grade_is_404(client, admin_headers):
    response = await client.delete("/api/v1/admin/job-grades/no-such-id", headers=admin_headers)
    assert response.status_code == 404


async def test_job_grade_free_text_allowed_when_none_configured(client, admin_headers):
    db = get_db()
    await db.job_grades.delete_many({})

    response = await client.post(
        "/api/v1/jobs", json={**JOB_PAYLOAD, "job_grade": "Whatever Free Text"}, headers=admin_headers,
    )
    assert response.status_code == 200
    job = response.json()
    assert job["job_grade"] == "Whatever Free Text"
    await db.jobs.delete_one({"job_id": job["job_id"]})


async def test_job_grade_validated_once_a_list_is_configured(client, admin_headers, job_grade_fixture):
    db = get_db()

    bad = await client.post(
        "/api/v1/jobs", json={**JOB_PAYLOAD, "job_grade": "Not A Configured Grade"}, headers=admin_headers,
    )
    assert bad.status_code == 400
    assert "not a configured job grade" in bad.json()["detail"].lower()

    good = await client.post(
        "/api/v1/jobs", json={**JOB_PAYLOAD, "job_grade": job_grade_fixture["name"]}, headers=admin_headers,
    )
    assert good.status_code == 200
    job = good.json()
    assert job["job_grade"] == job_grade_fixture["name"]
    await db.jobs.delete_one({"job_id": job["job_id"]})


async def test_job_grade_validated_on_update(client, admin_headers, job_grade_fixture):
    db = get_db()
    created = await client.post("/api/v1/jobs", json=JOB_PAYLOAD, headers=admin_headers)
    assert created.status_code == 200
    job_id = created.json()["job_id"]

    try:
        bad = await client.patch(
            f"/api/v1/jobs/{job_id}", json={"job_grade": "Not A Configured Grade"}, headers=admin_headers,
        )
        assert bad.status_code == 400

        good = await client.patch(
            f"/api/v1/jobs/{job_id}", json={"job_grade": job_grade_fixture["name"]}, headers=admin_headers,
        )
        assert good.status_code == 200
        assert good.json()["job_grade"] == job_grade_fixture["name"]
    finally:
        await db.jobs.delete_one({"job_id": job_id})
