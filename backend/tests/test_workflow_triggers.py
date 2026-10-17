import ast
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest

from config.database import get_db
from services.hr_module import workflow_engine

pytestmark = pytest.mark.anyio

URL = "/api/v1/workflows"
EXPECTED = {
    "candidate_invited", "candidate_status_changed", "interview_completed", "offer_created", "offer_status_changed",
}


def _rule(**fields) -> dict:
    body = {
        "name": f"Trigger test {uuid.uuid4().hex[:6]}", "trigger_type": "candidate_invited", "conditions": [],
        "action_type": "fire_webhook", "action_params": {}, "is_active": False,
    }
    body.update(fields)
    return body


@pytest.fixture
async def stored():
    ids: list[str] = []
    yield ids
    await get_db().workflow_rules.delete_many({"rule_id": {"$in": ids}})
    await get_db().audit_log.delete_many({"resource_id": {"$in": ids}})


async def _legacy_rule(stored, trigger="resume_processed", **fields) -> str:
    rule_id = f"rule-legacy-{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc).isoformat()
    await get_db().workflow_rules.insert_one({
        "rule_id": rule_id, "name": "Stored before the catalog", "trigger_type": trigger, "conditions": [],
        "action_type": "fire_webhook", "action_params": {}, "is_active": True, "created_by": "old@hirely.ai",
        "created_at": now, "updated_at": now, **fields,
    })
    stored.append(rule_id)
    return rule_id


async def test_triggers_lists_exactly_what_the_backend_emits(client, admin_headers):
    response = await client.get(f"{URL}/triggers", headers=admin_headers)
    assert response.status_code == 200
    listed = response.json()["triggers"]
    assert all(set(t) == {"key", "label"} and t["label"] for t in listed)
    assert {t["key"] for t in listed} == EXPECTED
    assert "resume_processed" not in {t["key"] for t in listed}


async def test_any_signed_in_user_can_read_the_triggers_but_anonymous_cannot(client, standard_headers):
    assert (await client.get(f"{URL}/triggers", headers=standard_headers)).status_code == 200
    assert (await client.get(f"{URL}/triggers")).status_code == 401


async def test_triggers_is_not_swallowed_by_the_rule_id_route(client, admin_headers):
    assert "triggers" in (await client.get(f"{URL}/triggers", headers=admin_headers)).json()


async def test_every_listed_trigger_has_an_emitter_and_every_emitter_is_listed():
    backend = Path(__file__).resolve().parent.parent
    emitted: set[str] = set()
    for path in backend.rglob("*.py"):
        parts = set(path.relative_to(backend).parts)
        if parts & {"venv", "tests", "__pycache__"}:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and getattr(node.func, "id", getattr(node.func, "attr", "")) == "evaluate_and_apply_rules":
                for keyword in node.keywords:
                    if keyword.arg != "trigger_type":
                        continue
                    value = keyword.value
                    if isinstance(value, ast.Constant):
                        emitted.add(value.value)
                    else:
                        assert isinstance(value, ast.Name) and value.id.startswith("TRIGGER_"), (
                            f"{path.name}:{node.lineno} must pass a TRIGGER_ constant"
                        )
                        emitted.add(getattr(workflow_engine, value.id))
    assert emitted == EXPECTED == {t["key"] for t in workflow_engine.TRIGGERS}


@pytest.mark.parametrize("trigger", sorted(EXPECTED))
async def test_a_rule_can_be_created_on_every_listed_trigger(client, admin_headers, stored, trigger):
    response = await client.post(URL, json=_rule(trigger_type=trigger), headers=admin_headers)
    assert response.status_code == 200, response.text
    stored.append(response.json()["rule_id"])


@pytest.mark.parametrize("trigger", ["resume_processed", "no_such_trigger", ""])
async def test_an_unknown_trigger_is_a_422_with_a_string_detail(client, admin_headers, stored, trigger):
    before = await get_db().workflow_rules.count_documents({})
    response = await client.post(URL, json=_rule(trigger_type=trigger), headers=admin_headers)
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert isinstance(detail, str) and f"Unknown trigger_type: {trigger}" in detail
    assert "candidate_invited" in detail
    assert await get_db().workflow_rules.count_documents({}) == before


async def test_changing_a_rule_to_an_unknown_trigger_is_a_422(client, admin_headers, stored):
    created = await client.post(URL, json=_rule(), headers=admin_headers)
    rule_id = created.json()["rule_id"]
    stored.append(rule_id)
    for bad in ("resume_processed", "nope", None):
        response = await client.patch(f"{URL}/{rule_id}", json={"trigger_type": bad}, headers=admin_headers)
        assert response.status_code == 422, bad
        assert isinstance(response.json()["detail"], str)
    assert (await get_db().workflow_rules.find_one({"rule_id": rule_id}))["trigger_type"] == "candidate_invited"

    ok = await client.patch(f"{URL}/{rule_id}", json={"trigger_type": "interview_completed"}, headers=admin_headers)
    assert ok.status_code == 200 and ok.json()["trigger_type"] == "interview_completed"


async def test_a_stored_rule_on_the_old_trigger_can_still_be_edited_and_still_runs(client, admin_headers, stored):
    rule_id = await _legacy_rule(stored)
    switched_off = await client.patch(f"{URL}/{rule_id}", json={"is_active": False, "name": "Renamed"}, headers=admin_headers)
    assert switched_off.status_code == 200, switched_off.text
    assert switched_off.json()["trigger_type"] == "resume_processed" and switched_off.json()["is_active"] is False

    listed = (await client.get(URL, headers=admin_headers)).json()["rules"]
    assert any(r["rule_id"] == rule_id and r["trigger_type"] == "resume_processed" for r in listed)
    await get_db().workflow_rules.update_one({"rule_id": rule_id}, {"$set": {
        "is_active": True, "action_type": "change_pipeline_stage",
        "action_params": {"candidate_id": "nobody", "stage": "shortlisted"},
    }})
    applied = await workflow_engine.evaluate_and_apply_rules("resume_processed", {"candidate_id": "nobody"})
    assert rule_id in applied


async def test_editing_a_rule_without_touching_its_trigger_does_not_revalidate_it(client, admin_headers, stored):
    rule_id = await _legacy_rule(stored, trigger="something_retired")
    response = await client.patch(f"{URL}/{rule_id}", json={"is_active": False}, headers=admin_headers)
    assert response.status_code == 200
    assert response.json()["trigger_type"] == "something_retired"
