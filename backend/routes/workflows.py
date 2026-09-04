"""
Workflow automation routes — hr_module Workflow Automation (MVP2 §2.18).

    POST   /                    create a workflow rule                  (admin)
    GET    /                    list workflow rules                     (any authenticated user)
    GET    /{rule_id}           get a single rule                       (any authenticated user)
    PATCH  /{rule_id}           update a rule                           (admin)
    DELETE /{rule_id}           delete a rule                           (admin)
    POST   /{rule_id}/test      dry-run conditions against a sample context, no action applied (admin)
    POST   /run-reminders       manually trigger send_pending_reminders (admin)
"""
import asyncio
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from config.database import get_db
from shared.auth import get_current_user, require_admin
from services.hr_module.audit_service import log_audit_event
from services.hr_module.workflow_engine import evaluate_conditions, send_pending_reminders

router = APIRouter()

from services.hr_module.workflow_engine import (  # noqa: E402
    _ACTION_TYPES, _OPERATORS, _TRIGGER_TYPES,
)


class Condition(BaseModel):
    field: str
    operator: str
    value: Any = None


class CreateRuleRequest(BaseModel):
    name: str
    trigger_type: str
    conditions: list[Condition] = Field(default_factory=list)
    action_type: str
    action_params: dict = Field(default_factory=dict)
    is_active: bool = True


class UpdateRuleRequest(BaseModel):
    name: str | None = None
    trigger_type: str | None = None
    conditions: list[Condition] | None = None
    action_type: str | None = None
    action_params: dict | None = None
    is_active: bool | None = None


class TestRuleRequest(BaseModel):
    context: dict = Field(default_factory=dict)


class RunRemindersRequest(BaseModel):
    reminder_after_hours: int | None = None


def _validate_rule_fields(trigger_type: str, conditions: list[Condition], action_type: str) -> None:
    if trigger_type not in _TRIGGER_TYPES:
        raise HTTPException(422, f"Invalid trigger_type. Must be one of: {sorted(_TRIGGER_TYPES)}")
    if action_type not in _ACTION_TYPES:
        raise HTTPException(422, f"Invalid action_type. Must be one of: {sorted(_ACTION_TYPES)}")
    for cond in conditions:
        if cond.operator not in _OPERATORS:
            raise HTTPException(422, f"Invalid operator '{cond.operator}'. Must be one of: {sorted(_OPERATORS)}")


@router.post("")
async def create_rule(body: CreateRuleRequest, user: dict = Depends(require_admin)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    _validate_rule_fields(body.trigger_type, body.conditions, body.action_type)

    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "rule_id": str(uuid.uuid4()),
        "name": body.name,
        "trigger_type": body.trigger_type,
        "conditions": [c.model_dump() for c in body.conditions],
        "action_type": body.action_type,
        "action_params": body.action_params,
        "is_active": body.is_active,
        "created_by": user.get("email"),
        "created_at": now,
        "updated_at": now,
    }
    await db.workflow_rules.insert_one(doc)
    doc.pop("_id", None)
    asyncio.create_task(log_audit_event(
        db, actor_email=user.get("email"), actor_role=user.get("role"),
        action="workflow_rule_created", resource_type="workflow_rule", resource_id=doc["rule_id"],
        details={"name": doc["name"], "trigger_type": doc["trigger_type"], "action_type": doc["action_type"]},
    ))
    return doc


@router.get("")
async def list_rules(
    trigger_type: str | None = None,
    is_active: bool | None = None,
    _: dict = Depends(get_current_user),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    query: dict = {}
    if trigger_type:
        query["trigger_type"] = trigger_type
    if is_active is not None:
        query["is_active"] = is_active

    cursor = db.workflow_rules.find(query, {"_id": 0}).sort("created_at", -1)
    rules = await cursor.to_list(length=None)
    return {"rules": rules}


@router.get("/{rule_id}")
async def get_rule(rule_id: str, _: dict = Depends(get_current_user)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    rule = await db.workflow_rules.find_one({"rule_id": rule_id}, {"_id": 0})
    if not rule:
        raise HTTPException(404, "Workflow rule not found")
    return rule


@router.patch("/{rule_id}")
async def update_rule(rule_id: str, body: UpdateRuleRequest, user: dict = Depends(require_admin)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    existing = await db.workflow_rules.find_one({"rule_id": rule_id})
    if not existing:
        raise HTTPException(404, "Workflow rule not found")

    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    if "conditions" in updates and updates["conditions"] is not None:
        updates["conditions"] = [
            c if isinstance(c, dict) else c.model_dump() for c in updates["conditions"]
        ]

    trigger_type = updates.get("trigger_type", existing.get("trigger_type"))
    action_type = updates.get("action_type", existing.get("action_type"))
    conditions = updates.get("conditions", existing.get("conditions") or [])
    _validate_rule_fields(trigger_type, [Condition(**c) for c in conditions], action_type)

    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.workflow_rules.update_one({"rule_id": rule_id}, {"$set": updates})
    updated = await db.workflow_rules.find_one({"rule_id": rule_id}, {"_id": 0})
    asyncio.create_task(log_audit_event(
        db, actor_email=user.get("email"), actor_role=user.get("role"),
        action="workflow_rule_updated", resource_type="workflow_rule", resource_id=rule_id,
        details={k: v for k, v in updates.items() if k != "conditions"},
    ))
    return updated


@router.delete("/{rule_id}")
async def delete_rule(rule_id: str, user: dict = Depends(require_admin)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    result = await db.workflow_rules.delete_one({"rule_id": rule_id})
    if result.deleted_count == 0:
        raise HTTPException(404, "Workflow rule not found")
    asyncio.create_task(log_audit_event(
        db, actor_email=user.get("email"), actor_role=user.get("role"),
        action="workflow_rule_deleted", resource_type="workflow_rule", resource_id=rule_id,
        details={},
    ))
    return {"deleted": True, "rule_id": rule_id}


@router.post("/{rule_id}/test")
async def test_rule(rule_id: str, body: TestRuleRequest, _: dict = Depends(require_admin)):
    """Dry-run: evaluates the rule's conditions against a supplied sample
    context. Never applies the action — purely diagnostic."""
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    rule = await db.workflow_rules.find_one({"rule_id": rule_id}, {"_id": 0})
    if not rule:
        raise HTTPException(404, "Workflow rule not found")

    matched = evaluate_conditions(rule.get("conditions") or [], body.context)
    return {"matched": matched}


@router.post("/run-reminders")
async def run_reminders(body: RunRemindersRequest = RunRemindersRequest(), _: dict = Depends(require_admin)):
    kwargs = {}
    if body.reminder_after_hours is not None:
        kwargs["reminder_after_hours"] = body.reminder_after_hours
    sent = await send_pending_reminders(**kwargs)
    return {"sent": sent}
