import asyncio

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from config.database import get_db
from shared.auth import require_admin
from services.hr_module.audit_service import log_audit_event
from services.hr_module.email_template_service import (
    TEMPLATE_KEYS,
    list_templates,
    get_template_detail,
    upsert_template,
    reset_template,
)

router = APIRouter()


class EmailTemplateUpsert(BaseModel):
    subject_template: str | None = None
    html_body_template: str | None = None
    text_body_template: str | None = None
    description: str | None = None


@router.get("")
async def list_email_templates_route(_: dict = Depends(require_admin)):
    return {"templates": await list_templates()}


@router.get("/{key}")
async def get_email_template_route(key: str, _: dict = Depends(require_admin)):
    if key not in TEMPLATE_KEYS:
        raise HTTPException(404, "Unknown email template key")
    item = await get_template_detail(key)
    if item is None:
        raise HTTPException(404, "Unknown email template key")
    return item


@router.put("/{key}")
async def upsert_email_template_route(
    key: str,
    body: EmailTemplateUpsert,
    user: dict = Depends(require_admin),
):
    if key not in TEMPLATE_KEYS:
        raise HTTPException(404, "Unknown email template key")

    try:
        doc = await upsert_template(
            key,
            subject_template=body.subject_template,
            html_body_template=body.html_body_template,
            text_body_template=body.text_body_template,
            description=body.description,
            updated_by=user.get("email", ""),
        )
    except RuntimeError:
        raise HTTPException(503, "Database unavailable")

    asyncio.create_task(log_audit_event(
        get_db(), actor_email=user["email"], actor_role=user.get("role"),
        action="email_template_upsert", resource_type="email_template", resource_id=key,
        details={"description": body.description},
    ))
    return doc


@router.delete("/{key}")
async def reset_email_template_route(key: str, user: dict = Depends(require_admin)):
    if key not in TEMPLATE_KEYS:
        raise HTTPException(404, "Unknown email template key")
    was_customized = await reset_template(key)

    asyncio.create_task(log_audit_event(
        get_db(), actor_email=user["email"], actor_role=user.get("role"),
        action="email_template_reset", resource_type="email_template", resource_id=key,
        details={"was_customized": was_customized},
    ))
    return {"message": "Reset to default"}
