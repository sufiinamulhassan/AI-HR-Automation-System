import asyncio
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from config.database import get_db
from shared.auth import require_admin, require_permission
from services.hr_module.plan_service import require_feature
from services.hr_module.audit_service import log_audit_event
from services.hr_module.webhook_service import (
    EVENT_TYPES,
    is_url_ssrf_safe,
    list_deliveries,
    send_test_ping,
    unknown_event_types,
)

router = APIRouter(dependencies=[Depends(require_permission("webhooks:manage"))])

_VALID_WEBHOOK_FORMATS = {"raw", "slack", "teams"}


class CreateWebhookRequest(BaseModel):
    url: str
    event_types: list[str] = Field(default_factory=list)
    secret: str | None = None
    is_active: bool = True
    format: str = "raw"


class UpdateWebhookRequest(BaseModel):
    url: str | None = None
    event_types: list[str] | None = None
    secret: str | None = None
    is_active: bool | None = None
    format: str | None = None


def _check_event_types(event_types: list[str] | None) -> None:
    unknown = unknown_event_types(event_types)
    if unknown:
        raise HTTPException(422, f"Unknown event type(s): {', '.join(unknown)}")


def _public(subscription: dict | None) -> dict | None:
    if subscription is None:
        return None
    shown = {k: v for k, v in subscription.items() if k != "secret"}
    shown["has_secret"] = bool(subscription.get("secret"))
    return shown


@router.post("")
async def create_webhook(body: CreateWebhookRequest, user: dict = Depends(require_admin), _plan: None = Depends(require_feature("webhooks"))):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    if not is_url_ssrf_safe(body.url):
        raise HTTPException(400, "Webhook URL must be a public http(s) address: loopback/private/link-local targets are not allowed")
    fmt = (body.format or "raw").lower()
    if fmt not in _VALID_WEBHOOK_FORMATS:
        raise HTTPException(400, f"format must be one of {sorted(_VALID_WEBHOOK_FORMATS)}")
    _check_event_types(body.event_types)

    doc = {
        "webhook_id": str(uuid.uuid4()),
        "url": body.url,
        "event_types": body.event_types,
        "secret": body.secret,
        "is_active": body.is_active,
        "format": fmt,
        "created_by": user.get("email"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.webhook_subscriptions.insert_one(doc)
    doc.pop("_id", None)
    asyncio.create_task(log_audit_event(
        db, actor_email=user.get("email"), actor_role=user.get("role"),
        action="webhook_created", resource_type="webhook_subscription", resource_id=doc["webhook_id"],
        details={"url": doc["url"], "event_types": doc["event_types"], "format": doc["format"]},
    ))
    return _public(doc)


@router.get("")
async def list_webhooks(_: dict = Depends(require_admin), _plan: None = Depends(require_feature("webhooks"))):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    cursor = db.webhook_subscriptions.find({}, {"_id": 0}).sort("created_at", -1)
    subscriptions = await cursor.to_list(length=None)
    return {"webhooks": [_public(s) for s in subscriptions]}


@router.get("/event-types")
async def list_event_types(_: dict = Depends(require_admin), _plan: None = Depends(require_feature("webhooks"))):
    return {"event_types": [dict(e) for e in EVENT_TYPES]}


@router.get("/{webhook_id}")
async def get_webhook(webhook_id: str, _: dict = Depends(require_admin), _plan: None = Depends(require_feature("webhooks"))):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    sub = await db.webhook_subscriptions.find_one({"webhook_id": webhook_id}, {"_id": 0})
    if not sub:
        raise HTTPException(404, "Webhook subscription not found")
    return _public(sub)


@router.patch("/{webhook_id}")
async def update_webhook(webhook_id: str, body: UpdateWebhookRequest, user: dict = Depends(require_admin), _plan: None = Depends(require_feature("webhooks"))):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    existing = await db.webhook_subscriptions.find_one({"webhook_id": webhook_id})
    if not existing:
        raise HTTPException(404, "Webhook subscription not found")

    updates = body.model_dump(exclude_unset=True)
    if updates.get("url") and not is_url_ssrf_safe(updates["url"]):
        raise HTTPException(400, "Webhook URL must be a public http(s) address: loopback/private/link-local targets are not allowed")
    if "format" in updates:
        fmt = (updates.get("format") or "raw").lower()
        if fmt not in _VALID_WEBHOOK_FORMATS:
            raise HTTPException(400, f"format must be one of {sorted(_VALID_WEBHOOK_FORMATS)}")
        updates["format"] = fmt
    if "event_types" in updates:
        if updates["event_types"] is None:
            updates.pop("event_types")
        else:
            _check_event_types(updates["event_types"])
    if updates:
        await db.webhook_subscriptions.update_one({"webhook_id": webhook_id}, {"$set": updates})
    updated = await db.webhook_subscriptions.find_one({"webhook_id": webhook_id}, {"_id": 0})
    asyncio.create_task(log_audit_event(
        db, actor_email=user.get("email"), actor_role=user.get("role"),
        action="webhook_updated", resource_type="webhook_subscription", resource_id=webhook_id,
        details={k: v for k, v in updates.items() if k != "secret"},
    ))
    return _public(updated)


@router.delete("/{webhook_id}")
async def delete_webhook(webhook_id: str, user: dict = Depends(require_admin), _plan: None = Depends(require_feature("webhooks"))):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    result = await db.webhook_subscriptions.delete_one({"webhook_id": webhook_id})
    if result.deleted_count == 0:
        raise HTTPException(404, "Webhook subscription not found")
    asyncio.create_task(log_audit_event(
        db, actor_email=user.get("email"), actor_role=user.get("role"),
        action="webhook_deleted", resource_type="webhook_subscription", resource_id=webhook_id,
        details={},
    ))
    return {"deleted": True, "webhook_id": webhook_id}


@router.get("/{webhook_id}/deliveries")
async def get_deliveries(
    webhook_id: str,
    limit: int = 50,
    _: dict = Depends(require_admin),
    _plan: None = Depends(require_feature("webhooks")),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    if not await db.webhook_subscriptions.find_one({"webhook_id": webhook_id}, {"_id": 1}):
        raise HTTPException(404, "Webhook subscription not found")
    return {"deliveries": await list_deliveries(db, webhook_id, limit)}


@router.post("/{webhook_id}/test")
async def test_webhook(webhook_id: str, user: dict = Depends(require_admin), _plan: None = Depends(require_feature("webhooks"))):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    sub = await db.webhook_subscriptions.find_one({"webhook_id": webhook_id})
    if not sub:
        raise HTTPException(404, "Webhook subscription not found")

    result = await send_test_ping(sub)
    await log_audit_event(
        db, actor_email=user.get("email"), actor_role=user.get("role"),
        action="webhook_tested", resource_type="webhook_subscription", resource_id=webhook_id,
        details={"delivered": result["delivered"], "http_status": result["http_status"]},
    )
    legacy = {"success": result["delivered"], "status_code": result["http_status"]}
    if not result["delivered"]:
        legacy["error"] = result["detail"]
    return {**result, **legacy}
