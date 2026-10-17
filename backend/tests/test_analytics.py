import uuid
from datetime import datetime, timedelta, timezone

import pytest

from config.database import get_db

pytestmark = pytest.mark.anyio

EXPECTED_KEYS = {
    "jobs_active_vs_total",
    "source_wise_applications",
    "recruiter_performance",
    "time_to_hire",
    "offer_acceptance_rate",
    "candidate_drop_off",
    "ai_recommendations",
    "coding_assessment",
    "diversity_metrics",
    "cost_summary",
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


@pytest.fixture
async def diversity_fixture(client, admin_headers):
    db = get_db()
    suffix = uuid.uuid4().hex[:8]
    now = datetime.now(timezone.utc).isoformat()

    grade_x = f"GradeX-{suffix}"
    grade_y = f"GradeY-{suffix}"
    gender_shared = f"GenderShared-{suffix}"
    location_a = f"CityA-{suffix}"
    location_b = f"CityB-{suffix}"

    job_x = f"job-{suffix}-x"
    job_y = f"job-{suffix}-y"
    await db.jobs.insert_many([
        {"doc_type": "job", "job_id": job_x, "title": "Analyst", "job_grade": grade_x,
         "candidate_pipeline": [], "created_at": now, "created_by": "tester@hirely.ai"},
        {"doc_type": "job", "job_id": job_y, "title": "Manager", "job_grade": grade_y,
         "candidate_pipeline": [], "created_at": now, "created_by": "tester@hirely.ai"},
    ])

    cand_1 = f"cand-{suffix}-1"
    cand_2 = f"cand-{suffix}-2"
    cand_3 = f"cand-{suffix}-3"
    await db.candidates.insert_many([
        {"doc_type": "candidate", "candidate_id": cand_1, "job_id": job_x,
         "secure_token": f"tok-{suffix}-1", "name": "C1", "email": f"c1.{suffix}@example.com",
         "status": "completed", "created_at": now},
        {"doc_type": "candidate", "candidate_id": cand_2, "job_id": job_y,
         "secure_token": f"tok-{suffix}-2", "name": "C2", "email": f"c2.{suffix}@example.com",
         "status": "completed", "created_at": now},
        {"doc_type": "candidate", "candidate_id": cand_3, "job_id": job_x,
         "secure_token": f"tok-{suffix}-3", "name": "C3", "email": f"c3.{suffix}@example.com",
         "status": "invited", "created_at": now},
    ])

    await db.candidate_demographics.insert_many([
        {"candidate_id": cand_1, "gender": gender_shared, "location": location_a, "submitted_at": now},
        {"candidate_id": cand_2, "gender": gender_shared, "location": location_b, "submitted_at": now},
    ])

    yield {
        "grade_x": grade_x, "grade_y": grade_y, "gender_shared": gender_shared,
        "location_a": location_a, "location_b": location_b,
        "job_ids": [job_x, job_y], "candidate_ids": [cand_1, cand_2, cand_3],
    }

    await db.jobs.delete_many({"job_id": {"$in": [job_x, job_y]}})
    await db.candidates.delete_many({"candidate_id": {"$in": [cand_1, cand_2, cand_3]}})
    await db.candidate_demographics.delete_many({"candidate_id": {"$in": [cand_1, cand_2, cand_3]}})


async def test_diversity_metrics_ready_with_real_breakdown_for_demographics_read(
    client, admin_headers, diversity_fixture,
):
    db = get_db()
    total_candidates = await db.candidates.count_documents({"doc_type": "candidate"})
    total_demographics = await db.candidate_demographics.count_documents({})

    response = await client.get("/api/v1/analytics/dashboard", headers=admin_headers)
    assert response.status_code == 200
    diversity = response.json()["diversity_metrics"]

    assert diversity["status"] == "ready"
    breakdown = diversity["breakdown"]
    assert breakdown["by_gender"][diversity_fixture["gender_shared"]] == 2
    assert breakdown["by_location"][diversity_fixture["location_a"]] == 1
    assert breakdown["by_location"][diversity_fixture["location_b"]] == 1
    assert breakdown["by_grade"][diversity_fixture["grade_x"]] == 1
    assert breakdown["by_grade"][diversity_fixture["grade_y"]] == 1
    assert breakdown["response_rate"] == round(total_demographics / total_candidates, 4)


async def test_diversity_metrics_hidden_for_analytics_read_only(
    client, standard_headers, diversity_fixture,
):
    response = await client.get("/api/v1/analytics/dashboard", headers=standard_headers)
    assert response.status_code == 200
    body = response.json()

    assert body["diversity_metrics"] == {
        "status": "insufficient_data",
        "note": body["diversity_metrics"]["note"],
        "breakdown": None,
    }
    assert "jobs_active_vs_total" in body
    assert "time_to_hire" in body


async def test_diversity_metrics_insufficient_data_when_collection_empty(client, admin_headers):
    db = get_db()
    existing = await db.candidate_demographics.count_documents({})
    if existing:
        pytest.skip("candidate_demographics is not empty in this shared test DB run")

    response = await client.get("/api/v1/analytics/dashboard", headers=admin_headers)
    assert response.status_code == 200
    assert response.json()["diversity_metrics"]["status"] == "insufficient_data"
    assert response.json()["diversity_metrics"]["breakdown"] is None


@pytest.fixture
async def coding_assessment_fixture(client, admin_headers):
    db = get_db()
    suffix = uuid.uuid4().hex[:8]
    now = datetime.now(timezone.utc).isoformat()

    before_assigned = await db.candidates.count_documents(
        {"doc_type": "candidate", "coding_question_id": {"$exists": True, "$ne": None}}
    )
    before_finished = len(await db.coding_submissions.distinct("candidate_id"))
    before_total_submissions = await db.coding_submissions.count_documents({})
    before_graded = await db.coding_submissions.find(
        {"score": {"$ne": None}}, {"_id": 0, "score": 1},
    ).to_list(length=None)
    before_graded_scores = [d["score"] for d in before_graded]

    question_id = f"cq-{suffix}"
    await db.coding_questions.insert_one({
        "question_id": question_id, "title": f"Analytics Fixture Q-{suffix}",
        "description": "d", "language_templates": {"python": "print()"},
        "test_cases": [], "job_domain": "software_engineering", "difficulty": "easy",
        "created_by": "tester@hirely.ai", "created_at": now,
    })

    cand_ids = [f"cand-coding-{suffix}-{i}" for i in range(3)]
    await db.candidates.insert_many([
        {
            "doc_type": "candidate", "candidate_id": cid, "job_id": None,
            "secure_token": f"tok-coding-{suffix}-{i}", "name": f"Coding Fixture C{i}",
            "email": f"coding-fixture-{i}.{suffix}@example.com",
            "status": "invited", "coding_question_id": question_id, "created_at": now,
        }
        for i, cid in enumerate(cand_ids)
    ])

    submission_ids = [f"sub-coding-{suffix}-1", f"sub-coding-{suffix}-2"]
    await db.coding_submissions.insert_many([
        {
            "submission_id": submission_ids[0], "candidate_id": cand_ids[0], "question_id": question_id,
            "language": "python", "code": "print(1)", "status": "completed", "results": [],
            "score": 10.0, "submitted_at": now, "evaluated_at": now,
        },
        {
            "submission_id": submission_ids[1], "candidate_id": cand_ids[1], "question_id": question_id,
            "language": "python", "code": "print(1)", "status": "completed", "results": [],
            "score": 90.0, "submitted_at": now, "evaluated_at": now,
        },
    ])

    yield {
        "before_assigned": before_assigned,
        "before_finished": before_finished,
        "before_total_submissions": before_total_submissions,
        "before_graded_scores": before_graded_scores,
        "question_id": question_id,
        "candidate_ids": cand_ids,
        "submission_ids": submission_ids,
    }

    await db.coding_submissions.delete_many({"submission_id": {"$in": submission_ids}})
    await db.candidates.delete_many({"candidate_id": {"$in": cand_ids}})
    await db.coding_questions.delete_one({"question_id": question_id})


async def test_coding_assessment_summary_computes_from_seeded_data(
    client, admin_headers, coding_assessment_fixture,
):
    f = coding_assessment_fixture

    response = await client.get("/api/v1/analytics/dashboard", headers=admin_headers)
    assert response.status_code == 200
    coding = response.json()["coding_assessment"]

    expected_assigned = f["before_assigned"] + 3
    expected_finished = f["before_finished"] + 2
    expected_total_submissions = f["before_total_submissions"] + 2
    expected_scores = f["before_graded_scores"] + [10.0, 90.0]
    expected_avg = round(sum(expected_scores) / len(expected_scores), 2)

    assert coding["candidates_assigned"] == expected_assigned
    assert coding["candidates_completed"] == expected_finished
    assert coding["completion_rate_pct"] == round(100 * expected_finished / expected_assigned, 1)
    assert coding["total_submissions"] == expected_total_submissions
    assert coding["graded_submissions"] == len(expected_scores)
    assert coding["avg_score"] == expected_avg

    before_low = sum(1 for s in f["before_graded_scores"] if 0 <= s < 20)
    before_high = sum(1 for s in f["before_graded_scores"] if 80 <= s <= 100)
    assert coding["score_distribution"]["0-20"] == before_low + 1
    assert coding["score_distribution"]["80-100"] == before_high + 1


async def test_coding_assessment_summary_empty_defaults(client, standard_headers):
    response = await client.get("/api/v1/analytics/dashboard", headers=standard_headers)
    assert response.status_code == 200
    coding = response.json()["coding_assessment"]
    assert set(coding.keys()) == {
        "candidates_assigned", "candidates_completed", "completion_rate_pct",
        "total_submissions", "graded_submissions", "avg_score", "score_distribution",
    }
    assert set(coding["score_distribution"].keys()) == {"0-20", "20-40", "40-60", "60-80", "80-100"}


@pytest.fixture
async def cost_summary_fixture(client, admin_headers):
    db = get_db()
    suffix = uuid.uuid4().hex[:8]
    now = datetime.now(timezone.utc).isoformat()

    before_agg = await db.cost_ledger.aggregate(
        [{"$group": {"_id": None, "total": {"$sum": "$cost_usd"}}}]
    ).to_list(1)
    before_llm_cost = (before_agg[0]["total"] if before_agg else 0.0) or 0.0
    before_sent = await db.email_log.count_documents({"status": "sent"})

    source_a = f"test_feature_a_{suffix}"
    source_b = f"test_feature_b_{suffix}"
    await db.cost_ledger.insert_many([
        {
            "source": source_a, "ref_id": f"ref-a-{suffix}", "cost_usd": 0.01,
            "prompt_tokens": 1000, "completion_tokens": 500, "embedding_tokens": 0,
            "llm_calls": 1, "embedding_calls": 0, "model": "gpt-4o-mini",
            "models": {"gpt-4o-mini": {
                "prompt_tokens": 1000, "completion_tokens": 500, "calls": 1, "cost_usd": 0.01,
            }},
            "created_at": now,
        },
        {
            "source": source_b, "ref_id": f"ref-b-{suffix}", "cost_usd": 0.02,
            "prompt_tokens": 2000, "completion_tokens": 1000, "embedding_tokens": 0,
            "llm_calls": 1, "embedding_calls": 0, "model": "claude-sonnet-5",
            "models": {"claude-sonnet-5": {
                "prompt_tokens": 2000, "completion_tokens": 1000, "calls": 1, "cost_usd": 0.02,
            }},
            "created_at": now,
        },
    ])

    await db.email_log.insert_many([
        {"to": f"a-{suffix}@example.com", "subject": "s", "template": None,
         "candidate_id": None, "job_id": None, "status": "sent", "created_at": now,
         "test_marker": suffix},
        {"to": f"b-{suffix}@example.com", "subject": "s", "template": None,
         "candidate_id": None, "job_id": None, "status": "sent", "created_at": now,
         "test_marker": suffix},
        {"to": f"c-{suffix}@example.com", "subject": "s", "template": None,
         "candidate_id": None, "job_id": None, "status": "sent", "created_at": now,
         "test_marker": suffix},
        {"to": f"d-{suffix}@example.com", "subject": "s", "template": None,
         "candidate_id": None, "job_id": None, "status": "failed", "created_at": now,
         "test_marker": suffix},
    ])

    yield {
        "source_a": source_a, "source_b": source_b,
        "before_llm_cost": before_llm_cost, "before_sent": before_sent,
    }

    await db.cost_ledger.delete_many({"source": {"$in": [source_a, source_b]}})
    await db.email_log.delete_many({"test_marker": suffix})


async def test_cost_summary_computes_from_seeded_data_for_cost_read(
    client, admin_headers, cost_summary_fixture,
):
    from config.settings import settings

    f = cost_summary_fixture
    response = await client.get("/api/v1/analytics/dashboard", headers=admin_headers)
    assert response.status_code == 200
    cost = response.json()["cost_summary"]

    assert cost["status"] == "ready"
    assert cost["llm"]["by_feature"][f["source_a"]] == 0.01
    assert cost["llm"]["by_feature"][f["source_b"]] == 0.02

    expected_llm_total = round(f["before_llm_cost"] + 0.01 + 0.02, 6)
    assert abs(cost["llm"]["total_cost_usd"] - expected_llm_total) < 1e-6

    expected_sent = f["before_sent"] + 3
    assert cost["email"]["sent_count"] == expected_sent
    expected_email_cost = round(expected_sent * settings.EMAIL_ESTIMATED_COST_PER_EMAIL, 6)
    assert abs(cost["email"]["estimated_cost_usd"] - expected_email_cost) < 1e-6
    assert cost["email"]["cost_per_email_usd"] == settings.EMAIL_ESTIMATED_COST_PER_EMAIL

    expected_total = round(expected_llm_total + expected_email_cost, 6)
    assert abs(cost["total_cost_usd"] - expected_total) < 1e-6

    assert cost["code_execution"]["trackable"] is False


async def test_cost_summary_prices_each_area_and_they_add_up_to_the_total(
    client, admin_headers, cost_summary_fixture,
):
    f = cost_summary_fixture
    cost = (await client.get("/api/v1/analytics/dashboard", headers=admin_headers)).json()["cost_summary"]

    keys = [c["key"] for c in cost["categories"]]
    assert keys == [
        "resume_parsing", "interviews", "voice", "job_descriptions", "coding", "offers", "matching", "email", "other",
    ]
    areas = {c["key"]: c for c in cost["categories"]}
    assert areas["other"]["cost_usd"] >= 0.03 - 1e-9
    assert areas["other"]["calls"] >= 2
    assert areas["email"]["calls"] == cost["email"]["sent_count"]
    assert abs(areas["email"]["cost_usd"] - cost["email"]["estimated_cost_usd"]) < 1e-6
    assert abs(areas["voice"]["cost_usd"] - cost["voice"]["estimated_cost_usd"]) < 1e-6
    assert abs(sum(c["cost_usd"] for c in cost["categories"]) - cost["total_cost_usd"]) < 1e-4
    assert f["source_a"] in cost["llm"]["by_feature"]
    assert cost["llm"]["embedding_tokens"] >= 0


async def test_cost_summary_hidden_for_analytics_read_only(
    client, standard_headers, cost_summary_fixture,
):
    response = await client.get("/api/v1/analytics/dashboard", headers=standard_headers)
    assert response.status_code == 200
    body = response.json()

    assert body["cost_summary"]["status"] == "insufficient_data"
    assert body["cost_summary"]["total_cost_usd"] == 0.0
    assert body["cost_summary"]["llm"]["by_feature"] == {}
    assert all(c["cost_usd"] == 0.0 and c["calls"] == 0 for c in body["cost_summary"]["categories"])
    assert "jobs_active_vs_total" in body
    assert "coding_assessment" in body


@pytest.fixture
async def voice_cost_summary_fixture(client, admin_headers):
    db = get_db()
    suffix = uuid.uuid4().hex[:8]
    now = datetime.now(timezone.utc).isoformat()

    before_llm_agg = await db.cost_ledger.aggregate([
        {"$match": {"cost_type": {"$nin": ["tts", "stt"]}}},
        {"$group": {"_id": None, "total": {"$sum": "$cost_usd"}}},
    ]).to_list(1)
    before_llm_cost = (before_llm_agg[0]["total"] if before_llm_agg else 0.0) or 0.0

    before_tts_agg = await db.cost_ledger.aggregate([
        {"$match": {"cost_type": "tts"}},
        {"$group": {"_id": None, "cost": {"$sum": "$cost_usd"}, "calls": {"$sum": 1}}},
    ]).to_list(1)
    before_tts_cost = (before_tts_agg[0]["cost"] if before_tts_agg else 0.0) or 0.0
    before_tts_calls = (before_tts_agg[0]["calls"] if before_tts_agg else 0) or 0

    before_stt_agg = await db.cost_ledger.aggregate([
        {"$match": {"cost_type": "stt"}},
        {"$group": {"_id": None, "cost": {"$sum": "$cost_usd"}, "calls": {"$sum": 1}}},
    ]).to_list(1)
    before_stt_cost = (before_stt_agg[0]["cost"] if before_stt_agg else 0.0) or 0.0
    before_stt_calls = (before_stt_agg[0]["calls"] if before_stt_agg else 0) or 0
    before_estimated_calls = await db.cost_ledger.count_documents(
        {"cost_type": "stt", "duration_source": "estimated_from_file_size"}
    )

    tts_source = f"test_voice_tts_{suffix}"
    stt_source = f"test_voice_stt_{suffix}"
    await db.cost_ledger.insert_many([
        {
            "source": tts_source, "cost_type": "tts", "ref_id": None,
            "model": "tts-1", "characters": 2000, "cost_usd": 0.03,
            "created_at": now,
        },
        {
            "source": stt_source, "cost_type": "stt", "ref_id": None,
            "model": "whisper-1", "duration_seconds": 60.0,
            "duration_source": "api", "audio_bytes": 200_000,
            "cost_usd": 0.006, "created_at": now,
        },
        {
            "source": stt_source, "cost_type": "stt", "ref_id": None,
            "model": "whisper-1", "duration_seconds": 30.0,
            "duration_source": "estimated_from_file_size", "audio_bytes": 100_000,
            "cost_usd": 0.003, "created_at": now,
        },
    ])

    yield {
        "tts_source": tts_source, "stt_source": stt_source,
        "before_llm_cost": before_llm_cost,
        "before_tts_cost": before_tts_cost, "before_tts_calls": before_tts_calls,
        "before_stt_cost": before_stt_cost, "before_stt_calls": before_stt_calls,
        "before_estimated_calls": before_estimated_calls,
    }

    await db.cost_ledger.delete_many({"source": {"$in": [tts_source, stt_source]}})


async def test_cost_summary_voice_section_computes_from_seeded_data(
    client, admin_headers, voice_cost_summary_fixture,
):
    f = voice_cost_summary_fixture
    response = await client.get("/api/v1/analytics/dashboard", headers=admin_headers)
    assert response.status_code == 200
    cost = response.json()["cost_summary"]
    assert cost["status"] == "ready"
    voice = cost["voice"]

    expected_tts_cost = round(f["before_tts_cost"] + 0.03, 6)
    expected_stt_cost = round(f["before_stt_cost"] + 0.006 + 0.003, 6)
    expected_voice_cost = round(expected_tts_cost + expected_stt_cost, 6)

    assert abs(voice["tts"]["cost_usd"] - expected_tts_cost) < 1e-6
    assert abs(voice["stt"]["cost_usd"] - expected_stt_cost) < 1e-6
    assert abs(voice["estimated_cost_usd"] - expected_voice_cost) < 1e-6
    assert voice["tts"]["calls"] == f["before_tts_calls"] + 1
    assert voice["stt"]["calls"] == f["before_stt_calls"] + 2
    assert voice["stt"]["estimated_calls"] == f["before_estimated_calls"] + 1

    assert "estimated" in voice["note"].lower()

    assert f["tts_source"] not in cost["llm"]["by_feature"]
    assert f["stt_source"] not in cost["llm"]["by_feature"]
    expected_llm_total = round(f["before_llm_cost"], 6)
    assert abs(cost["llm"]["total_cost_usd"] - expected_llm_total) < 1e-6

    expected_total = round(
        cost["llm"]["total_cost_usd"] + cost["email"]["estimated_cost_usd"] + expected_voice_cost,
        6,
    )
    assert abs(cost["total_cost_usd"] - expected_total) < 1e-6


async def test_cost_summary_voice_section_hidden_for_analytics_read_only(
    client, standard_headers, voice_cost_summary_fixture,
):
    response = await client.get("/api/v1/analytics/dashboard", headers=standard_headers)
    assert response.status_code == 200
    voice = response.json()["cost_summary"]["voice"]
    assert voice["estimated_cost_usd"] == 0.0
    assert voice["tts"]["calls"] == 0
    assert voice["stt"]["calls"] == 0
