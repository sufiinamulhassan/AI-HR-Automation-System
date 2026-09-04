"""
Generic outbound webhook subscription routes — hr_module Integrations
(MVP2 §2.19). Pure admin config: no reads for non-admins, no exceptions.

    POST   /                    create a webhook subscription  (admin)
    GET    /                    list webhook subscriptions     (admin)
    GET    /{webhook_id}        get a single subscription      (admin)
    PATCH  /{webhook_id}        update a subscription          (admin)
    DELETE /{webhook_id}        delete a subscription          (admin)
    POST   /{webhook_id}/test   fire a diagnostic test payload at one subscription (admin)
"""
import asyncio
import hashlib
import hmac
import json
import uuid
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from config.database import get_db
from config.settings import settings
from shared.auth import require_admin
from services.hr_module.audit_service import log_audit_event
from services.hr_module.webhook_service import is_url_ssrf_safe, _build_delivery_body

router = APIRouter()

_TEST_TIMEOUT = 5.0

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


@router.post("")
async def create_webhook(body: CreateWebhookRequest, user: dict = Depends(require_admin)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    if not is_url_ssrf_safe(body.url):
        raise HTTPException(400, "Webhook URL must be a public http(s) address — loopback/private/link-local targets are not allowed")
    fmt = (body.format or "raw").lower()
    if fmt not in _VALID_WEBHOOK_FORMATS:
        raise HTTPException(400, f"format must be one of {sorted(_VALID_WEBHOOK_FORMATS)}")

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
    return doc


@router.get("")
async def list_webhooks(_: dict = Depends(require_admin)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    cursor = db.webhook_subscriptions.find({}, {"_id": 0}).sort("created_at", -1)
    subscriptions = await cursor.to_list(length=None)
    return {"webhooks": subscriptions}


@router.get("/{webhook_id}")
async def get_webhook(webhook_id: str, _: dict = Depends(require_admin)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    sub = await db.webhook_subscriptions.find_one({"webhook_id": webhook_id}, {"_id": 0})
    if not sub:
        raise HTTPException(404, "Webhook subscription not found")
    return sub


@router.patch("/{webhook_id}")
async def update_webhook(webhook_id: str, body: UpdateWebhookRequest, user: dict = Depends(require_admin)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    existing = await db.webhook_subscriptions.find_one({"webhook_id": webhook_id})
    if not existing:
        raise HTTPException(404, "Webhook subscription not found")

    updates = body.model_dump(exclude_unset=True)
    if updates.get("url") and not is_url_ssrf_safe(updates["url"]):
        raise HTTPException(400, "Webhook URL must be a public http(s) address — loopback/private/link-local targets are not allowed")
    if "format" in updates:
        fmt = (updates.get("format") or "raw").lower()
        if fmt not in _VALID_WEBHOOK_FORMATS:
            raise HTTPException(400, f"format must be one of {sorted(_VALID_WEBHOOK_FORMATS)}")
        updates["format"] = fmt
    if updates:
        await db.webhook_subscriptions.update_one({"webhook_id": webhook_id}, {"$set": updates})
    updated = await db.webhook_subscriptions.find_one({"webhook_id": webhook_id}, {"_id": 0})
    asyncio.create_task(log_audit_event(
        db, actor_email=user.get("email"), actor_role=user.get("role"),
        action="webhook_updated", resource_type="webhook_subscription", resource_id=webhook_id,
        details={k: v for k, v in updates.items() if k != "secret"},
    ))
    return updated


@router.delete("/{webhook_id}")
async def delete_webhook(webhook_id: str, user: dict = Depends(require_admin)):
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


@router.post("/{webhook_id}/test")
async def test_webhook(webhook_id: str, _: dict = Depends(require_admin)):
    """Fires a small diagnostic payload at this one subscription immediately
    and reports whether the HTTP call itself succeeded (2xx response) — this
    is NOT a real event, just a connectivity/signature check.

    Respects the subscription's `format` field (raw/slack/teams) so testing a
    Slack/Teams-formatted subscription actually exercises the same body shape
    it will receive for real events, not the raw shape."""
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    sub = await db.webhook_subscriptions.find_one({"webhook_id": webhook_id})
    if not sub:
        raise HTTPException(404, "Webhook subscription not found")
    if not is_url_ssrf_safe(sub["url"]):
        return {"success": False, "error": "Webhook URL is not a permitted public address"}

    raw_payload = {"test": True, "timestamp": datetime.now(timezone.utc).isoformat()}
    fmt = (sub.get("format") or "raw").lower()
    payload = _build_delivery_body(fmt, "test", raw_payload)
    payload_bytes = json.dumps(payload, default=str).encode("utf-8")
    secret = sub.get("secret") or settings.WEBHOOK_SIGNING_SECRET
    signature = hmac.new(secret.encode("utf-8"), payload_bytes, hashlib.sha256).hexdigest() if secret else ""

    try:
        async with httpx.AsyncClient(timeout=_TEST_TIMEOUT) as client:
            response = await client.post(
                sub["url"],
                content=payload_bytes,
                headers={
                    "Content-Type": "application/json",
                    "X-Webhook-Signature": signature,
                    "X-Webhook-Event": "test",
                },
            )
        return {"success": 200 <= response.status_code < 300, "status_code": response.status_code}
    except Exception as exc:
        return {"success": False, "error": str(exc)}
