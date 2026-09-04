"""Departments & Designations referential integrity (routes/admin_config.py).

A department is referenced two different ways — designations store its NAME,
while jobs/users/alumni store its department_id — and both a delete and a
rename used to leave those references dangling without any error. A dangling
users.department_id is the dangerous one: get_department_scope turns it into
"this user sees almost nothing" rather than into a failure anyone would notice.

These tests pin the guards, not the happy path CRUD.
"""
import uuid

import pytest

from config.database import get_db

pytestmark = pytest.mark.anyio


async def _create_department(client, headers, name: str) -> dict:
    response = await client.post(
        "/api/v1/admin/departments", json={"name": name, "description": "test"}, headers=headers
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _create_designation(client, headers, name: str, department: str | None) -> dict:
    response = await client.post(
        "/api/v1/admin/designations",
        json={"name": name, "department": department},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _get_department(client, headers, department_id: str) -> dict | None:
    response = await client.get("/api/v1/admin/departments", headers=headers)
    assert response.status_code == 200
    return next(
        (d for d in response.json()["departments"] if d["department_id"] == department_id), None
    )


@pytest.fixture
async def department_fixture(client, admin_headers):
    """A department with one designation naming it. Cleans up whatever survives."""
    suffix = uuid.uuid4().hex[:8]
    dept = await _create_department(client, admin_headers, f"Engineering {suffix}")
    desig = await _create_designation(
        client, admin_headers, f"Senior Engineer {suffix}", dept["name"]
    )
    yield dept, desig
    db = get_db()
    await db.departments.delete_one({"department_id": dept["department_id"]})
    await db.designations.delete_one({"designation_id": desig["designation_id"]})


async def test_list_departments_reports_usage(client, admin_headers, department_fixture):
    dept, _ = department_fixture
    listed = await _get_department(client, admin_headers, dept["department_id"])
    assert listed is not None
    assert listed["usage"]["designations"] == 1
    assert listed["usage"]["total"] == 1


async def test_usage_is_admin_only(client, standard_headers, department_fixture):
    """A standard user still gets the department list (job forms populate their
    picker from it) but not the headcount behind each one."""
    response = await client.get("/api/v1/admin/departments", headers=standard_headers)
    assert response.status_code == 200
    assert response.json()["departments"], "list itself must stay readable"
    assert all("usage" not in d for d in response.json()["departments"])


async def test_delete_department_refuses_while_referenced(client, admin_headers, department_fixture):
    dept, desig = department_fixture

    response = await client.delete(
        f"/api/v1/admin/departments/{dept['department_id']}", headers=admin_headers
    )
    assert response.status_code == 409
    assert "1 designations" in response.json()["detail"]

    assert await _get_department(client, admin_headers, dept["department_id"]) is not None
    stored = await get_db().designations.find_one({"designation_id": desig["designation_id"]})
    assert stored["department"] == dept["name"]


async def test_delete_department_with_force_detaches_designations(client, admin_headers, department_fixture):
    dept, desig = department_fixture

    response = await client.delete(
        f"/api/v1/admin/departments/{dept['department_id']}?force=true", headers=admin_headers
    )
    assert response.status_code == 200
    assert response.json()["designations_detached"] == 1

    assert await _get_department(client, admin_headers, dept["department_id"]) is None
    stored = await get_db().designations.find_one({"designation_id": desig["designation_id"]})
    assert stored["department"] is None


async def test_delete_department_blocked_by_a_scoped_user(client, admin_headers):
    """users.department_id is the reference that silently breaks visibility."""
    suffix = uuid.uuid4().hex[:8]
    dept = await _create_department(client, admin_headers, f"Support {suffix}")
    db = get_db()
    email = f"scoped.{suffix}@example.com"
    await db.users.insert_one({
        "email": email, "name": "Scoped User", "role": "standard",
        "department_id": dept["department_id"], "is_active": True,
    })
    try:
        response = await client.delete(
            f"/api/v1/admin/departments/{dept['department_id']}", headers=admin_headers
        )
        assert response.status_code == 409
        assert "1 users" in response.json()["detail"]
    finally:
        await db.users.delete_one({"email": email})
        await db.departments.delete_one({"department_id": dept["department_id"]})


async def test_rename_department_cascades_to_designations(client, admin_headers, department_fixture):
    dept, desig = department_fixture
    new_name = f"Platform {uuid.uuid4().hex[:8]}"

    response = await client.patch(
        f"/api/v1/admin/departments/{dept['department_id']}",
        json={"name": new_name}, headers=admin_headers,
    )
    assert response.status_code == 200
    assert response.json()["designations_renamed"] == 1

    stored = await get_db().designations.find_one({"designation_id": desig["designation_id"]})
    assert stored["department"] == new_name


async def test_delete_unknown_department_is_404(client, admin_headers):
    response = await client.delete("/api/v1/admin/departments/no-such-id", headers=admin_headers)
    assert response.status_code == 404


async def test_delete_unknown_designation_is_404(client, admin_headers):
    response = await client.delete("/api/v1/admin/designations/no-such-id", headers=admin_headers)
    assert response.status_code == 404


async def test_department_writes_require_admin(client, standard_headers):
    response = await client.post(
        "/api/v1/admin/departments", json={"name": "Nope"}, headers=standard_headers
    )
    assert response.status_code == 403
