import json
from unittest.mock import patch

import pytest

import main as _main_module
from routes import scenarios as _scenarios_routes
from services.hr_module.scenario_service import (
    build_scenario_prompt_addition,
    score_scenario_response,
    create_scenario,
    delete_scenario,
    DEFAULT_EVALUATION_DIMENSIONS,
)
from services.hr_module.interview_engine import generate_questions, evaluate_interview

if not any(getattr(route, "path", "").startswith("/api/v1/scenarios") for route in _main_module.app.routes):
    _main_module.app.include_router(
        _scenarios_routes.router, prefix="/api/v1/scenarios", tags=["hr_module · Scenarios"]
    )

pytestmark = pytest.mark.anyio

SCENARIO_PAYLOAD = {
    "name": "Stale Reads Under Load",
    "prompt": "A production database is returning stale reads under load. Walk the candidate through diagnosis.",
    "job_domain": "software_engineering",
}


async def test_create_scenario_requires_admin(client, standard_headers):
    response = await client.post(
        "/api/v1/scenarios",
        json=SCENARIO_PAYLOAD,
        headers=standard_headers,
    )
    assert response.status_code == 403


async def test_create_and_get_scenario_roundtrip(client, admin_headers):
    create_resp = await client.post(
        "/api/v1/scenarios",
        json=SCENARIO_PAYLOAD,
        headers=admin_headers,
    )
    assert create_resp.status_code == 200
    created = create_resp.json()
    assert "scenario_id" in created
    assert created["name"] == SCENARIO_PAYLOAD["name"]
    assert created["evaluation_dimensions"] == DEFAULT_EVALUATION_DIMENSIONS
    assert created["is_active"] is True

    scenario_id = created["scenario_id"]

    get_resp = await client.get(
        f"/api/v1/scenarios/{scenario_id}",
        headers=admin_headers,
    )
    assert get_resp.status_code == 200
    assert get_resp.json()["prompt"] == SCENARIO_PAYLOAD["prompt"]


async def test_list_scenarios(client, admin_headers, standard_headers):
    create_resp = await client.post(
        "/api/v1/scenarios",
        json={**SCENARIO_PAYLOAD, "name": "List Test Scenario"},
        headers=admin_headers,
    )
    assert create_resp.status_code == 200
    scenario_id = create_resp.json()["scenario_id"]

    list_resp = await client.get("/api/v1/scenarios", headers=standard_headers)
    assert list_resp.status_code == 200
    scenarios = list_resp.json()["scenarios"]
    assert any(s["scenario_id"] == scenario_id for s in scenarios)

    filtered_resp = await client.get(
        "/api/v1/scenarios",
        params={"job_domain": "software_engineering"},
        headers=standard_headers,
    )
    assert filtered_resp.status_code == 200
    assert all(s["job_domain"] == "software_engineering" for s in filtered_resp.json()["scenarios"])


async def test_update_scenario(client, admin_headers):
    create_resp = await client.post(
        "/api/v1/scenarios",
        json={**SCENARIO_PAYLOAD, "name": "Update Test Scenario"},
        headers=admin_headers,
    )
    scenario_id = create_resp.json()["scenario_id"]

    update_resp = await client.patch(
        f"/api/v1/scenarios/{scenario_id}",
        json={"name": "Updated Name", "is_active": False},
        headers=admin_headers,
    )
    assert update_resp.status_code == 200
    assert update_resp.json() == {"message": "Updated"}

    get_resp = await client.get(
        f"/api/v1/scenarios/{scenario_id}",
        headers=admin_headers,
    )
    assert get_resp.json()["name"] == "Updated Name"
    assert get_resp.json()["is_active"] is False


async def test_delete_scenario(client, admin_headers):
    create_resp = await client.post(
        "/api/v1/scenarios",
        json={**SCENARIO_PAYLOAD, "name": "Delete Test Scenario"},
        headers=admin_headers,
    )
    scenario_id = create_resp.json()["scenario_id"]

    delete_resp = await client.delete(
        f"/api/v1/scenarios/{scenario_id}",
        headers=admin_headers,
    )
    assert delete_resp.status_code == 200
    assert delete_resp.json() == {"message": "Deleted"}

    get_resp = await client.get(
        f"/api/v1/scenarios/{scenario_id}",
        headers=admin_headers,
    )
    assert get_resp.status_code == 404


async def test_get_scenario_not_found(client, admin_headers):
    response = await client.get(
        "/api/v1/scenarios/non-existent-scenario-id",
        headers=admin_headers,
    )
    assert response.status_code == 404


async def test_update_scenario_not_found(client, admin_headers):
    response = await client.patch(
        "/api/v1/scenarios/non-existent-scenario-id",
        json={"name": "Nope"},
        headers=admin_headers,
    )
    assert response.status_code == 404


def test_build_scenario_prompt_addition_pure_function():
    scenario = {
        "name": "Stale Reads",
        "prompt": "A production database is returning stale reads under load.",
        "evaluation_dimensions": ["technical", "problem_solving"],
    }
    text = build_scenario_prompt_addition(scenario)
    assert isinstance(text, str)
    assert "Stale Reads" in text
    assert "technical" in text
    assert "problem_solving" in text
    assert "stale reads under load" in text.lower()


async def test_score_scenario_response_empty_transcript_short_circuits():
    scenario = {
        "prompt": "A production database is returning stale reads under load.",
        "evaluation_dimensions": ["technical", "communication"],
    }
    result = await score_scenario_response([], scenario)
    assert result == {"technical": 50, "communication": 50}


async def test_generate_questions_includes_scenario_prompt_content():
    scenario = await create_scenario(
        {
            "name": "Live Wiring Scenario",
            "prompt": "A production database is returning stale reads under load.",
            "job_domain": "software_engineering",
        },
        created_by="test@hirely.ai",
    )
    try:
        job = {
            "title": "Backend Engineer",
            "difficulty": "medium",
            "description": "Build and operate backend APIs.",
            "parsed_criteria": {},
        }
        candidate = {"scenario_id": scenario["scenario_id"]}

        with patch(
            "services.hr_module.interview_engine.ask_llm",
            return_value='{"questions": ["Q1", "Q2"]}',
        ) as mock_llm:
            questions = await generate_questions(job, candidate)

        assert questions == ["Q1", "Q2"]
        sent_prompt = mock_llm.call_args.kwargs["prompt"]
        assert "stale reads under load" in sent_prompt.lower()
        assert "Live Wiring Scenario" in sent_prompt
    finally:
        await delete_scenario(scenario["scenario_id"])


async def test_evaluate_interview_populates_scenario_scores_end_to_end():
    scenario = await create_scenario(
        {
            "name": "Live Eval Scenario",
            "prompt": "A production database is returning stale reads under load.",
            "evaluation_dimensions": ["technical", "communication"],
            "job_domain": "software_engineering",
        },
        created_by="test@hirely.ai",
    )
    try:
        job = {"title": "Backend Engineer"}
        candidate = {"scenario_id": scenario["scenario_id"]}
        transcript = [
            {"role": "assistant", "content": "How would you diagnose stale reads under load?"},
            {"role": "user", "content": "I'd check replica lag first, then cache invalidation."},
        ]

        eval_response = json.dumps({
            "overall_score": 82,
            "technical_score": 80,
            "communication_score": 75,
            "problem_solving_score": 78,
            "cultural_fit_score": 70,
            "confidence_score": 65,
            "strengths": ["Clear diagnostic reasoning"],
            "areas_for_improvement": ["More depth on caching strategy"],
            "recommendation": "hire",
            "summary": "Strong, structured technical answer.",
            "integrity_assessment": "No flags raised.",
        })
        dimension_response = json.dumps({"technical": 88, "communication": 72})

        with patch("services.hr_module.interview_engine.ask_llm", return_value=eval_response), \
             patch("services.hr_module.scenario_service.ask_llm", return_value=dimension_response):
            score, report = await evaluate_interview(transcript, job, candidate, integrity_flags=[])

        assert score == 82.0
        assert report["overall_score"] == 82
        assert report["scenario_scores"] == {"technical": 88, "communication": 72}
    finally:
        await delete_scenario(scenario["scenario_id"])
