import uuid
from datetime import datetime, timezone

import pytest

from config.database import get_db
from services.hr_module.workflow_engine import evaluate_conditions, evaluate_and_apply_rules


pytestmark = pytest.mark.anyio


async def test_evaluate_and_apply_rules_changes_pipeline_stage():
    db = get_db()
    assert db is not None

    candidate_id = f"cand_{uuid.uuid4().hex[:10]}"
    rule_id = f"rule_{uuid.uuid4().hex[:10]}"
    now = datetime.now(timezone.utc).isoformat()

    await db.candidates.insert_one({
        "candidate_id": candidate_id,
        "job_id": "job_test",
        "name": "Test Candidate",
        "email": "wf.candidate@example.com",
        "pipeline_stage": "invited",
        "created_at": now,
    })

    await db.workflow_rules.insert_one({
        "rule_id": rule_id,
        "name": "Auto-advance on high score",
        "trigger_type": "interview_completed",
        "conditions": [{"field": "score", "operator": "gte", "value": 0.8}],
        "action_type": "change_pipeline_stage",
        "action_params": {"candidate_id": candidate_id, "stage": "shortlisted"},
        "is_active": True,
        "created_by": "hradmin@hirely.ai",
        "created_at": now,
        "updated_at": now,
    })

    applied = await evaluate_and_apply_rules("interview_completed", {"candidate_id": candidate_id, "score": 0.92})
    assert rule_id in applied

    updated = await db.candidates.find_one({"candidate_id": candidate_id})
    assert updated["pipeline_stage"] == "shortlisted"

    await db.candidates.delete_one({"candidate_id": candidate_id})
    await db.workflow_rules.delete_one({"rule_id": rule_id})


async def test_evaluate_and_apply_rules_skips_non_matching_and_inactive():
    db = get_db()
    assert db is not None
    rule_id_inactive = f"rule_{uuid.uuid4().hex[:10]}"
    rule_id_nonmatch = f"rule_{uuid.uuid4().hex[:10]}"
    now = datetime.now(timezone.utc).isoformat()

    await db.workflow_rules.insert_many([
        {
            "rule_id": rule_id_inactive,
            "name": "Inactive rule",
            "trigger_type": "candidate_status_changed",
            "conditions": [],
            "action_type": "change_pipeline_stage",
            "action_params": {"candidate_id": "whatever", "stage": "hired"},
            "is_active": False,
            "created_by": "hradmin@hirely.ai",
            "created_at": now,
            "updated_at": now,
        },
        {
            "rule_id": rule_id_nonmatch,
            "name": "Non-matching rule",
            "trigger_type": "candidate_status_changed",
            "conditions": [{"field": "status", "operator": "eq", "value": "does_not_match"}],
            "action_type": "change_pipeline_stage",
            "action_params": {"candidate_id": "whatever", "stage": "hired"},
            "is_active": True,
            "created_by": "hradmin@hirely.ai",
            "created_at": now,
            "updated_at": now,
        },
    ])

    applied = await evaluate_and_apply_rules("candidate_status_changed", {"status": "rejected"})
    assert rule_id_inactive not in applied
    assert rule_id_nonmatch not in applied

    await db.workflow_rules.delete_many({"rule_id": {"$in": [rule_id_inactive, rule_id_nonmatch]}})


async def test_create_rule_requires_admin(client, standard_headers):
    response = await client.post(
        "/api/v1/workflows",
        json={
            "name": "Standard user attempt",
            "trigger_type": "resume_processed",
            "conditions": [],
            "action_type": "fire_webhook",
            "action_params": {},
        },
        headers=standard_headers,
    )
    assert response.status_code == 403


async def test_create_and_get_rule_roundtrip(client, admin_headers):
    create_resp = await client.post(
        "/api/v1/workflows",
        json={
            "name": "Notify on invite",
            "trigger_type": "candidate_invited",
            "conditions": [{"field": "job_id", "operator": "eq", "value": "job_123"}],
            "action_type": "fire_webhook",
            "action_params": {"event_type": "candidate.invited"},
        },
        headers=admin_headers,
    )
    assert create_resp.status_code == 200
    rule = create_resp.json()
    assert rule["is_active"] is True
    rule_id = rule["rule_id"]

    get_resp = await client.get(f"/api/v1/workflows/{rule_id}", headers=admin_headers)
    assert get_resp.status_code == 200
    assert get_resp.json()["name"] == "Notify on invite"


async def test_dry_run_endpoint_requires_admin_and_does_not_mutate(client, admin_headers, standard_headers):
    create_resp = await client.post(
        "/api/v1/workflows",
        json={
            "name": "Dry run target",
            "trigger_type": "resume_processed",
            "conditions": [{"field": "domain", "operator": "eq", "value": "software_engineering"}],
            "action_type": "change_pipeline_stage",
            "action_params": {"candidate_id": "some-candidate", "stage": "shortlisted"},
        },
        headers=admin_headers,
    )
    assert create_resp.status_code == 200
    rule_id = create_resp.json()["rule_id"]

    forbidden_resp = await client.post(
        f"/api/v1/workflows/{rule_id}/test",
        json={"context": {"domain": "software_engineering"}},
        headers=standard_headers,
    )
    assert forbidden_resp.status_code == 403

    match_resp = await client.post(
        f"/api/v1/workflows/{rule_id}/test",
        json={"context": {"domain": "software_engineering"}},
        headers=admin_headers,
    )
    assert match_resp.status_code == 200
    assert match_resp.json() == {"matched": True}

    nonmatch_resp = await client.post(
        f"/api/v1/workflows/{rule_id}/test",
        json={"context": {"domain": "marketing"}},
        headers=admin_headers,
    )
    assert nonmatch_resp.status_code == 200
    assert nonmatch_resp.json() == {"matched": False}

    db = get_db()
    still_missing = await db.candidates.find_one({"candidate_id": "some-candidate"})
    assert still_missing is None


async def test_delete_rule(client, admin_headers):
    create_resp = await client.post(
        "/api/v1/workflows",
        json={
            "name": "Temp rule",
            "trigger_type": "offer_status_changed",
            "conditions": [],
            "action_type": "fire_webhook",
            "action_params": {},
        },
        headers=admin_headers,
    )
    rule_id = create_resp.json()["rule_id"]

    delete_resp = await client.delete(f"/api/v1/workflows/{rule_id}", headers=admin_headers)
    assert delete_resp.status_code == 200

    get_resp = await client.get(f"/api/v1/workflows/{rule_id}", headers=admin_headers)
    assert get_resp.status_code == 404


async def test_run_reminders_requires_admin(client, standard_headers):
    response = await client.post("/api/v1/workflows/run-reminders", json={}, headers=standard_headers)
    assert response.status_code == 403


async def test_run_reminders_returns_sent_count(client, admin_headers):
    response = await client.post(
        "/api/v1/workflows/run-reminders", json={"reminder_after_hours": 72}, headers=admin_headers
    )
    assert response.status_code == 200
    assert isinstance(response.json()["sent"], int)


def test_eq_operator_match_and_nonmatch():
    assert evaluate_conditions([{"field": "status", "operator": "eq", "value": "invited"}], {"status": "invited"})
    assert not evaluate_conditions([{"field": "status", "operator": "eq", "value": "invited"}], {"status": "hired"})


def test_neq_operator():
    assert evaluate_conditions([{"field": "status", "operator": "neq", "value": "hired"}], {"status": "invited"})
    assert not evaluate_conditions([{"field": "status", "operator": "neq", "value": "hired"}], {"status": "hired"})


def test_gte_operator():
    assert evaluate_conditions([{"field": "score", "operator": "gte", "value": 0.7}], {"score": 0.85})
    assert not evaluate_conditions([{"field": "score", "operator": "gte", "value": 0.7}], {"score": 0.5})


def test_lte_operator():
    assert evaluate_conditions([{"field": "score", "operator": "lte", "value": 0.5}], {"score": 0.3})
    assert not evaluate_conditions([{"field": "score", "operator": "lte", "value": 0.5}], {"score": 0.9})


def test_contains_operator_string_and_list():
    assert evaluate_conditions([{"field": "title", "operator": "contains", "value": "Engineer"}], {"title": "Senior Engineer"})
    assert evaluate_conditions([{"field": "skills", "operator": "contains", "value": "python"}], {"skills": ["python", "go"]})
    assert not evaluate_conditions([{"field": "skills", "operator": "contains", "value": "rust"}], {"skills": ["python", "go"]})


def test_all_conditions_must_pass_and_semantics():
    conditions = [
        {"field": "status", "operator": "eq", "value": "invited"},
        {"field": "score", "operator": "gte", "value": 0.7},
    ]
    assert evaluate_conditions(conditions, {"status": "invited", "score": 0.9})
    assert not evaluate_conditions(conditions, {"status": "invited", "score": 0.5})


def test_type_mismatch_does_not_raise():
    assert evaluate_conditions([{"field": "score", "operator": "gte", "value": 0.7}], {"score": "not-a-number"}) is False
    assert evaluate_conditions([{"field": "score", "operator": "lte", "value": "abc"}], {"score": 5}) is False
    assert evaluate_conditions([{"field": "missing_field", "operator": "gte", "value": 1}], {}) is False


def test_empty_conditions_list_matches_unconditionally():
    assert evaluate_conditions([], {"anything": "goes"}) is True


def test_unknown_operator_is_non_match():
    assert evaluate_conditions([{"field": "status", "operator": "regex", "value": ".*"}], {"status": "invited"}) is False


def test_never_uses_eval_or_exec():
    payload = "__import__('os').system('echo pwned')"
    assert evaluate_conditions([{"field": "status", "operator": "eq", "value": payload}], {"status": "invited"}) is False
