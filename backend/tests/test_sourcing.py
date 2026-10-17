import uuid

import pytest

from config.database import get_db

pytestmark = pytest.mark.anyio

JOB_PAYLOAD = {
    "title": "Senior Backend Engineer",
    "description": "Build and scale backend services.",
    "difficulty": "senior",
    "employment_type": "full-time",
    "location": "Bangalore",
    "salary_min": 150000,
    "salary_max": 220000,
    "is_remote": False,
    "company_name": "Test Corp",
}

PARSED_CRITERIA = {
    "skills": ["Python", "Django", "PostgreSQL", "AWS"],
    "nice_to_have": ["Kubernetes", "Terraform"],
    "experience_level": "senior",
    "job_domain": "software_engineering",
    "industry": "technology",
    "key_requirements": ["5+ years backend experience"],
    "keywords": ["fintech", "payments"],
}


async def _create_parsed_job(client, headers):
    response = await client.post("/api/v1/jobs", json=JOB_PAYLOAD, headers=headers)
    assert response.status_code == 200
    job_id = response.json()["job_id"]

    db = get_db()
    await db.jobs.update_one(
        {"job_id": job_id},
        {"$set": {
            "parsed_criteria": PARSED_CRITERIA,
            "targeting": {
                "required_domain": "software_engineering",
                "required_seniority": ["mid", "senior", "lead"],
                "required_skills": PARSED_CRITERIA["skills"],
            },
        }},
    )
    return job_id


async def test_sourcing_tiers_differ_in_breadth(client, admin_headers):
    job_id = await _create_parsed_job(client, admin_headers)

    response = await client.get(f"/api/v1/jobs/{job_id}/sourcing", headers=admin_headers)
    assert response.status_code == 200
    body = response.json()

    assert body["job_id"] == job_id
    spec = body["spec"]
    assert spec["title"] == "Senior Backend Engineer"
    assert spec["seniority"] == "senior"
    assert spec["skills"] == PARSED_CRITERIA["skills"]
    assert "Kubernetes" in spec["nice_to_have"]

    queries = body["queries"]
    assert set(queries.keys()) == {"strict", "balanced", "broad"}
    strict, balanced, broad = queries["strict"], queries["balanced"], queries["broad"]

    for skill in PARSED_CRITERIA["skills"]:
        assert skill in strict
    assert " OR " not in strict

    balanced_skill_hits = sum(1 for s in PARSED_CRITERIA["skills"] if s in balanced)
    strict_skill_hits = sum(1 for s in PARSED_CRITERIA["skills"] if s in strict)
    assert balanced_skill_hits < strict_skill_hits

    assert " OR " in broad
    assert "Kubernetes" in broad
    assert "Kubernetes" not in strict
    assert "Kubernetes" not in balanced

    assert len({strict, balanced, broad}) == 3

    assert "Bangalore" in strict
    assert "Bangalore" in balanced
    assert "Bangalore" in broad


async def test_sourcing_reachable_by_standard_user(client, standard_headers):
    create_resp = await client.post(
        "/api/v1/jobs", json=JOB_PAYLOAD, headers={"Authorization": "Bearer demo-admin-token"}
    )
    job_id = create_resp.json()["job_id"]

    response = await client.get(f"/api/v1/jobs/{job_id}/sourcing", headers=standard_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["job_id"] == job_id
    assert "spec" in body and "queries" in body


async def test_sourcing_requires_auth(client):
    response = await client.get("/api/v1/jobs/some-job-id/sourcing")
    assert response.status_code == 401


async def test_sourcing_404_on_unknown_job(client, admin_headers):
    response = await client.get(
        f"/api/v1/jobs/{uuid.uuid4()}/sourcing", headers=admin_headers
    )
    assert response.status_code == 404
    assert "Job not found" in response.json()["detail"]
