"""
Generic outbound webhooks — hr_module Integrations (MVP2 §2.19).

`fire_webhook_event()` is the single entry point: looks up active
`webhook_subscriptions` matching an event_type and POSTs a signed payload to
each one, concurrently, fully isolated from the caller — a webhook target
being slow, down, or 4xx/5xx must never raise back into whoever fired the
event (workflow rules, future pipeline hooks, etc).

Per-subscription `format` field (MVP2 §2.19 — Slack/Teams-formatted
webhooks): each `webhook_subscriptions` document may optionally carry a
`format` string:
  - "raw" (default, and the behavior for any existing subscription that
    predates this field / has it unset or None) — sends the event payload
    dict as-is, exactly like before this change.
  - "slack" — wraps the payload as a Slack incoming-webhook-compatible body:
    `{"text": "<short human-readable summary>"}`, where the summary line is
    built from event_type plus a handful of common payload fields (see
    `_summarize_event`).
  - "teams" — same `{"text": "..."}` shape. Classic Microsoft Teams
    "Connectors" (incoming webhooks configured directly on a channel) accept
    this simple shape identically to Slack, so it reasonably shares the same
    code path. Note the shape difference for anyone wiring a *newer* Teams
    "Workflows" webhook (Power Automate-backed): those expect an Adaptive
    Card payload, not `{"text": ...}` — that variant is NOT supported here
    and would silently be ignored/rejected by such an endpoint. Classic
    channel connector webhooks are the supported target for "teams".
"""
import asyncio
import hashlib
import hmac
import ipaddress
import json
import logging
import socket
from urllib.parse import urlparse

import httpx

from config.database import get_db
from config.settings import settings

logger = logging.getLogger(__name__)

_TIMEOUT = 5.0


def _sign(payload_bytes: bytes, secret: str) -> str:
    return hmac.new(secret.encode("utf-8"), payload_bytes, hashlib.sha256).hexdigest()


_SUMMARY_FIELDS = (
    "candidate_name",
    "job_title",
    "status",
    "pipeline_stage",
    "score",
    "candidate_id",
    "job_id",
)


def _summarize_event(event_type: str, payload: dict) -> str:
    """Builds a short, human-readable one-line summary for chat-style webhook
    formats (Slack/Teams) out of the raw event payload. Pure/no I/O. Always
    returns a non-empty string, even for an event_type with no recognised
    fields in its payload."""
    parts = [f"Hirely.ai event: {event_type}"]
    for field in _SUMMARY_FIELDS:
        value = payload.get(field) if isinstance(payload, dict) else None
        if value not in (None, ""):
            parts.append(f"{field}={value}")
    return " | ".join(parts)


def _build_delivery_body(fmt: str, event_type: str, payload: dict) -> dict:
    """Returns the JSON-serializable body to actually POST, based on a
    subscription's `format` field. Unknown/missing/None format values fall
    back to "raw" — the exact pre-existing behavior — by design, so this
    never breaks a subscription that predates the format field."""
    if fmt in ("slack", "teams"):
        return {"text": _summarize_event(event_type, payload)}
    return payload


def is_url_ssrf_safe(url: str) -> bool:
    """Blind-SSRF guard for admin-supplied webhook URLs — rejects loopback,
    private, link-local (incl. the 169.254.169.254 cloud metadata address),
    and multicast/reserved ranges. Admin-only feature, so this is defense in
    depth against a compromised admin account probing internal infra, not a
    substitute for the admin-only auth gate itself."""
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            return False
        for family, _, _, _, sockaddr in socket.getaddrinfo(parsed.hostname, None):
            ip = ipaddress.ip_address(sockaddr[0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved or ip.is_unspecified:
                return False
        return True
    except Exception:
        return False


async def _send_to_subscription(subscription: dict, event_type: str, payload: dict) -> None:
    fmt = (subscription.get("format") or "raw").lower()
    body = _build_delivery_body(fmt, event_type, payload)
    payload_bytes = json.dumps(body, default=str).encode("utf-8")

    secret = subscription.get("secret") or settings.WEBHOOK_SIGNING_SECRET
    signature = _sign(payload_bytes, secret) if secret else ""
    headers = {
        "Content-Type": "application/json",
        "X-Webhook-Signature": signature,
        "X-Webhook-Event": event_type,
    }
    url = subscription.get("url")
    if not is_url_ssrf_safe(url):
        logger.warning("Webhook delivery blocked — unsafe target URL | webhook_id=%s url=%s", subscription.get("webhook_id"), url)
        return
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            response = await client.post(url, content=payload_bytes, headers=headers)
            if response.status_code >= 300:
                logger.warning(
                    "Webhook delivery non-2xx | webhook_id=%s url=%s status=%s",
                    subscription.get("webhook_id"), url, response.status_code,
                )
    except Exception as exc:
        logger.warning(
            "Webhook delivery failed | webhook_id=%s url=%s error=%s",
            subscription.get("webhook_id"), url, exc,
        )


async def fire_webhook_event(event_type: str, payload: dict) -> None:
    """Fires `event_type` at every active subscription that lists it.

    NEVER raises — every failure path (missing DB, bad subscription, network
    error, non-2xx response) is caught and logged so a caller firing this via
    `asyncio.create_task(...)` can never be broken by a webhook target being
    down.
    """
    try:
        db = get_db()
        if db is None:
            logger.warning("fire_webhook_event skipped — database unavailable")
            return

        cursor = db.webhook_subscriptions.find({
            "is_active": True,
            "event_types": event_type,
        })
        subscriptions = await cursor.to_list(length=None)
        if not subscriptions:
            return

        await asyncio.gather(
            *[_send_to_subscription(sub, event_type, payload) for sub in subscriptions],
            return_exceptions=True,
        )
    except Exception as exc:
        logger.warning("fire_webhook_event failed unexpectedly (swallowed): %s", exc)
