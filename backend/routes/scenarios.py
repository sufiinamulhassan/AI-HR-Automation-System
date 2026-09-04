"""Scenario route — hr_module Scenario-Based Interview management (MVP2 §2.9)."""
import asyncio

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from shared.auth import get_current_user, require_admin
from config.database import get_db
from services.hr_module.audit_service import log_audit_event
from services.hr_module.scenario_service import (
    create_scenario,
    list_scenarios,
    get_scenario,
    update_scenario,
    delete_scenario,
    DEFAULT_EVALUATION_DIMENSIONS,
)

router = APIRouter()


class ScenarioCreate(BaseModel):
    name: str
    prompt: str
    evaluation_dimensions: list[str] = list(DEFAULT_EVALUATION_DIMENSIONS)
    job_domain: str | None = None


class ScenarioUpdate(BaseModel):
    name: str | None = None
    prompt: str | None = None
    evaluation_dimensions: list[str] | None = None
    job_domain: str | None = None
    is_active: bool | None = None


@router.post("")
async def create_scenario_route(body: ScenarioCreate, user: dict = Depends(require_admin)):
    scenario = await create_scenario(body.model_dump(), created_by=user.get("email", ""))
    asyncio.create_task(log_audit_event(
        get_db(), actor_email=user.get("email"), actor_role=user.get("role"),
        action="scenario_create", resource_type="scenario", resource_id=scenario["scenario_id"],
        details={"name": body.name},
    ))
    return scenario


@router.get("")
async def list_scenarios_route(
    is_active: bool | None = None,
    job_domain: str | None = None,
    _: dict = Depends(get_current_user),
):
    return {"scenarios": await list_scenarios(is_active=is_active, job_domain=job_domain)}


@router.get("/{scenario_id}")
async def get_scenario_route(scenario_id: str, _: dict = Depends(get_current_user)):
    scenario = await get_scenario(scenario_id)
    if not scenario:
        raise HTTPException(404, "Scenario not found")
    return scenario


@router.patch("/{scenario_id}")
async def update_scenario_route(
    scenario_id: str,
    body: ScenarioUpdate,
    user: dict = Depends(require_admin),
):
    updates = body.model_dump(exclude_unset=True)
    matched = await update_scenario(scenario_id, updates)
    if not matched:
        raise HTTPException(404, "Scenario not found")

    asyncio.create_task(log_audit_event(
        get_db(), actor_email=user.get("email"), actor_role=user.get("role"),
        action="scenario_update", resource_type="scenario", resource_id=scenario_id,
        details=updates,
    ))
    return {"message": "Updated"}


@router.delete("/{scenario_id}")
async def delete_scenario_route(scenario_id: str, user: dict = Depends(require_admin)):
    await delete_scenario(scenario_id)

    asyncio.create_task(log_audit_event(
        get_db(), actor_email=user.get("email"), actor_role=user.get("role"),
        action="scenario_delete", resource_type="scenario", resource_id=scenario_id,
        details={},
    ))
    return {"message": "Deleted"}
