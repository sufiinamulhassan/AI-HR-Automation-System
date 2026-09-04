"""
Offer-approval automation — MVP2 §2.18's last gap.

§2.18 was PARTIAL only because "offer-approval-specific workflow automation
remains manual": the rules engine could email/webhook/change-stage, but the
offer lifecycle itself could only be advanced by an admin clicking through it.

Adds an `offer_created` trigger and three lifecycle actions
(approve_offer / send_offer / withdraw_offer), so a rule can express
"auto-approve anything at or below X, then send it". The chain-depth guard
matters as much as the feature: approve fires offer_status_changed, which can
match another offer rule, which is a loop waiting to happen.
"""
import asyncio
import uuid

import pytest

from services.hr_module.workflow_engine import (
    MAX_WORKFLOW_CHAIN_DEPTH,
    _ACTION_TYPES,
    _TRIGGER_TYPES,
    evaluate_and_apply_rules,
)

pytestmark = pytest.mark.anyio


async def _make_candidate(db) -> str:
    candidate_id = str(uuid.uuid4())
    await db.candidates.insert_one({
        "candidate_id": candidate_id,
        "job_id": str(uuid.uuid4()),
        "name": "Offer Automation",
        "email": "offer-automation@example.com",
        "status": "completed",
    })
    return candidate_id


@pytest.fixture
async def offer_env(setup_test_db):
    """A candidate plus cleanup of everything a test here can create."""
    db = setup_test_db
    candidate_id = await _make_candidate(db)
    rule_ids: list[str] = []
    yield db, candidate_id, rule_ids
    await db.workflow_rules.delete_many({"rule_id": {"$in": rule_ids}})
    await db.offers.delete_many({"candidate_id": candidate_id})
    await db.candidates.delete_one({"candidate_id": candidate_id})


async def _add_rule(db, rule_ids, *, trigger, action, conditions=None, params=None) -> str:
    rule_id = str(uuid.uuid4())
    await db.workflow_rules.insert_one({
        "rule_id": rule_id,
        "name": f"test-{rule_id[:8]}",
        "trigger_type": trigger,
        "conditions": conditions or [],
        "action_type": action,
        "action_params": params or {},
        "is_active": True,
    })
    rule_ids.append(rule_id)
    return rule_id


async def test_new_trigger_and_actions_are_registered(setup_test_db):
    assert "offer_created" in _TRIGGER_TYPES
    for action in ("approve_offer", "send_offer", "withdraw_offer"):
        assert action in _ACTION_TYPES


async def test_route_validator_accepts_the_new_values(client, admin_headers, setup_test_db):
    """routes/workflows.py used to re-declare these sets, so the API rejected
    rules the engine had just learned to run. It now imports them."""
    r = await client.post("/api/v1/workflows", json={
        "name": f"auto-approve-{uuid.uuid4().hex[:6]}",
        "trigger_type": "offer_created",
        "conditions": [],
        "action_type": "approve_offer",
        "action_params": {},
    }, headers=admin_headers)
    assert r.status_code in (200, 201), r.text
    await setup_test_db.workflow_rules.delete_one({"rule_id": r.json()["rule_id"]})


async def test_offer_created_trigger_fires_on_creation(offer_env):
    """The hook an "auto-approve below X" rule attaches to."""
    db, candidate_id, rule_ids = offer_env
    from services.hr_module.offer_service import create_offer, get_offer

    rule_id = await _add_rule(db, rule_ids, trigger="offer_created", action="approve_offer")
    offer = await create_offer(candidate_id, "90000", None, None, "tester")

    for _ in range(20):
        await asyncio.sleep(0.05)
        if (await get_offer(offer["offer_id"]))["status"] == "approved":
            break

    updated = await get_offer(offer["offer_id"])
    assert updated["status"] == "approved", f"rule {rule_id} did not advance the offer"
    assert updated["approved_by"] == "workflow-automation"


async def test_conditions_gate_the_action(offer_env):
    """A salary above the rule's threshold must NOT be auto-approved —
    otherwise the condition system is decorative."""
    db, candidate_id, rule_ids = offer_env
    from services.hr_module.offer_service import create_offer, get_offer

    await _add_rule(
        db, rule_ids, trigger="offer_created", action="approve_offer",
        conditions=[{"field": "salary", "operator": "lte", "value": 50000}],
    )
    offer = await create_offer(candidate_id, "200000", None, None, "tester")
    await asyncio.sleep(0.6)

    assert (await get_offer(offer["offer_id"]))["status"] == "draft"


async def test_matching_condition_applies_the_action(offer_env):
    db, candidate_id, rule_ids = offer_env
    from services.hr_module.offer_service import create_offer, get_offer

    await _add_rule(
        db, rule_ids, trigger="offer_created", action="approve_offer",
        conditions=[{"field": "salary", "operator": "lte", "value": 100000}],
    )
    offer = await create_offer(candidate_id, "80000", None, None, "tester")
    for _ in range(20):
        await asyncio.sleep(0.05)
        if (await get_offer(offer["offer_id"]))["status"] == "approved":
            break
    assert (await get_offer(offer["offer_id"]))["status"] == "approved"


async def test_withdraw_action_works(offer_env):
    db, candidate_id, rule_ids = offer_env
    from services.hr_module.offer_service import create_offer, get_offer

    offer = await create_offer(candidate_id, "70000", None, None, "tester")
    rule_id = await _add_rule(db, rule_ids, trigger="offer_status_changed", action="withdraw_offer")
    result = await evaluate_and_apply_rules(
        trigger_type="offer_status_changed",
        context={"offer_id": offer["offer_id"], "status": "draft"},
    )
    assert rule_id in result
    assert (await get_offer(offer["offer_id"]))["status"] == "withdrawn"


async def test_illegal_transition_is_swallowed_not_raised(offer_env):
    """A rule authored against the wrong state is an authoring mistake, not a
    system fault — it must never take down the request that triggered it."""
    db, candidate_id, rule_ids = offer_env
    from services.hr_module.offer_service import create_offer, get_offer

    offer = await create_offer(candidate_id, "70000", None, None, "tester")
    await _add_rule(db, rule_ids, trigger="offer_status_changed", action="send_offer")

    applied = await evaluate_and_apply_rules(
        trigger_type="offer_status_changed",
        context={"offer_id": offer["offer_id"], "status": "draft"},
    )
    assert applied == []
    assert (await get_offer(offer["offer_id"]))["status"] == "draft"


async def test_missing_offer_id_is_skipped_cleanly(offer_env):
    db, _, rule_ids = offer_env
    await _add_rule(db, rule_ids, trigger="offer_status_changed", action="approve_offer")
    assert await evaluate_and_apply_rules(
        trigger_type="offer_status_changed", context={"status": "draft"},
    ) == []


async def test_chain_depth_limit_stops_offer_action_recursion(offer_env):
    """approve → offer_status_changed → approve → … must terminate.

    At or past the limit the offer action is skipped, so a cyclic rule set
    burns a bounded number of steps instead of spinning forever.
    """
    db, candidate_id, rule_ids = offer_env
    from services.hr_module.offer_service import create_offer, get_offer

    offer = await create_offer(candidate_id, "60000", None, None, "tester")
    rule_id = await _add_rule(db, rule_ids, trigger="offer_status_changed", action="approve_offer")

    at_limit = await evaluate_and_apply_rules(
        trigger_type="offer_status_changed",
        context={"offer_id": offer["offer_id"], "status": "draft",
                 "_workflow_depth": MAX_WORKFLOW_CHAIN_DEPTH},
    )
    assert at_limit == [], "offer action ran past the chain-depth limit"
    assert (await get_offer(offer["offer_id"]))["status"] == "draft"

    below_limit = await evaluate_and_apply_rules(
        trigger_type="offer_status_changed",
        context={"offer_id": offer["offer_id"], "status": "draft",
                 "_workflow_depth": MAX_WORKFLOW_CHAIN_DEPTH - 1},
    )
    assert rule_id in below_limit, "the guard is rejecting depths it should allow"


async def test_depth_limit_does_not_affect_non_offer_actions(offer_env):
    """Only the offer actions can recurse — email/webhook rules must keep
    firing regardless of the depth counter."""
    db, candidate_id, rule_ids = offer_env
    rule_id = await _add_rule(
        db, rule_ids, trigger="offer_status_changed", action="send_email",
        params={"to_email": "someone@example.com", "kind": "reminder"},
    )
    applied = await evaluate_and_apply_rules(
        trigger_type="offer_status_changed",
        context={"candidate_id": candidate_id, "status": "sent",
                 "_workflow_depth": MAX_WORKFLOW_CHAIN_DEPTH + 5},
    )
    assert rule_id in applied
