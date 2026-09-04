import uuid
from datetime import datetime, timedelta, timezone

import pytest

pytestmark = pytest.mark.anyio

EXPECTED_KEYS = {
    "jobs_active_vs_total",
    "source_wise_applications",
    "recruiter_performance",
    "time_to_hire",
    "offer_acceptance_rate",
    "candidate_drop_off",
    "ai_recommendations",
    "diversity_metrics",
}


async def test_dashboard_smoke(client, standard_headers):
    response = await client.get("/api/v1/analytics/dashboard", headers=standard_headers)
    assert response.status_code == 200
    body = response.json()
    assert EXPECTED_KEYS.issubset(body.keys())
    assert body["diversity_metrics"]["status"] == "insufficient_data"


async def test_jobs_active_vs_total_counts_by_deadline(client, standard_headers):
    from config.database import get_db

    db = get_db()
    now = datetime.now(timezone.utc)
    past = (now - timedelta(days=5)).isoformat()
    future = (now + timedelta(days=5)).isoformat()

    docs = [
        {
            "doc_type": "job",
            "job_id": str(uuid.uuid4()),
            "title": "Expired Job",
            "company_name": "Acme",
            "deadline_at": past,
            "candidate_pipeline": [],
            "created_at": now.isoformat(),
            "created_by": "tester@hirely.ai",
        },
        {
            "doc_type": "job",
            "job_id": str(uuid.uuid4()),
            "title": "Future Deadline Job",
            "company_name": "Acme",
            "deadline_at": future,
            "candidate_pipeline": [],
            "created_at": now.isoformat(),
            "created_by": "tester@hirely.ai",
        },
        {
            "doc_type": "job",
            "job_id": str(uuid.uuid4()),
            "title": "No Deadline Job",
            "company_name": "Acme",
            "deadline_at": None,
            "candidate_pipeline": [],
            "created_at": now.isoformat(),
            "created_by": "tester@hirely.ai",
        },
    ]
    await db.jobs.insert_many(docs)

    try:
        response = await client.get("/api/v1/analytics/dashboard", headers=standard_headers)
        assert response.status_code == 200
        body = response.json()
        total_before = await db.jobs.count_documents({"doc_type": "job"})
        expected_active = 0
        async for j in db.jobs.find({"doc_type": "job"}, {"deadline_at": 1}):
            d = j.get("deadline_at")
            if not d or d > now.isoformat():
                expected_active += 1
        assert body["jobs_active_vs_total"]["total"] == total_before
        assert body["jobs_active_vs_total"]["active"] == expected_active
    finally:
        await db.jobs.delete_many({"job_id": {"$in": [d["job_id"] for d in docs]}})
