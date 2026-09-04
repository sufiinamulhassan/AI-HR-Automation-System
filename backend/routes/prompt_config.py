"""AI Prompt Configuration route — hr_module (MVP2 §2.20 slice).

Admin-only CRUD over LLM prompt overrides for the two highest-value, most-
cited prompts in this codebase: JD parsing (`jd_parse`) and interview
question generation / evaluation (`interview_questions` / `interview_eval`).
See services/hr_module/prompt_config_service.py for the storage model,
fallback contract, and the exact placeholder names each key's
`user_prompt_template` must use.

Every endpoint here — including the list/get reads — requires admin, unlike
the read-open pattern used by routes/scenarios.py and routes/admin_config.py,
because prompt overrides directly control LLM behavior platform-wide.
"""
import asyncio

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from shared.auth import require_admin
from config.database import get_db
from services.hr_module.audit_service import log_audit_event
from services.hr_module.prompt_config_service import (
    KNOWN_PROMPT_KEYS,
    list_prompt_templates,
    get_prompt_template_detail,
    upsert_prompt_template,
    reset_prompt_template,
)

router = APIRouter()


class PromptTemplateUpdate(BaseModel):
    system_prompt: str
    user_prompt_template: str
    description: str | None = None


@router.get("")
async def list_prompt_templates_route(_: dict = Depends(require_admin)):
    return {"prompts": await list_prompt_templates()}


@router.get("/{key}")
async def get_prompt_template_route(key: str, _: dict = Depends(require_admin)):
    if key not in KNOWN_PROMPT_KEYS:
        raise HTTPException(404, "Unknown prompt key")
    item = await get_prompt_template_detail(key)
    if item is None:
        raise HTTPException(404, "Unknown prompt key")
    return item


@router.patch("/{key}")
async def update_prompt_template_route(
    key: str,
    body: PromptTemplateUpdate,
    user: dict = Depends(require_admin),
):
    if key not in KNOWN_PROMPT_KEYS:
        raise HTTPException(404, "Unknown prompt key")
    if not body.system_prompt.strip() or not body.user_prompt_template.strip():
        raise HTTPException(400, "system_prompt and user_prompt_template are required")

    try:
        doc = await upsert_prompt_template(
            key=key,
            system_prompt=body.system_prompt,
            user_prompt_template=body.user_prompt_template,
            description=body.description,
            updated_by=user.get("email", ""),
        )
    except RuntimeError:
        raise HTTPException(503, "Database unavailable")

    asyncio.create_task(log_audit_event(
        get_db(), actor_email=user["email"], actor_role=user.get("role"),
        action="prompt_template_update", resource_type="prompt_template", resource_id=key,
        details={"description": body.description},
    ))
    return doc


@router.delete("/{key}")
async def reset_prompt_template_route(key: str, user: dict = Depends(require_admin)):
    if key not in KNOWN_PROMPT_KEYS:
        raise HTTPException(404, "Unknown prompt key")
    await reset_prompt_template(key)

    asyncio.create_task(log_audit_event(
        get_db(), actor_email=user["email"], actor_role=user.get("role"),
        action="prompt_template_reset", resource_type="prompt_template", resource_id=key,
        details={},
    ))
    return {"message": "Reset to default"}
