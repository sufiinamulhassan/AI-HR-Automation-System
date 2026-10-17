import asyncio
import hashlib
import hmac
import ipaddress
import json
import logging
import socket
import time
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

from config.database import get_db
from config.settings import settings
from shared.safe_http import UnsafeTarget, safe_request
from shared.scrub import scrub_secrets

logger = logging.getLogger(__name__)

_TIMEOUT = 5.0

_ALLOW_HTTP = True
_MAX_RESPONSE_BYTES = 64_000
UNSAFE_TARGET_ERROR = "The target URL is not a permitted public address"

_TRANSPORT = None

EVENT_TYPES: list[dict] = [
    {"key": "candidate.invited", "label": "Candidate invited"},
    {"key": "candidate.status_changed", "label": "Candidate status changed"},
    {"key": "candidate.hired", "label": "Candidate hired"},
    {"key": "candidate.rejected", "label": "Candidate rejected"},
    {"key": "interview.completed", "label": "Interview completed"},
    {"key": "interview.external_scheduled", "label": "Interview scheduled on another platform"},
    {"key": "scorecard.submitted", "label": "Scorecard submitted"},
    {"key": "offer.created", "label": "Offer created"},
    {"key": "offer.sent", "label": "Offer sent"},
    {"key": "offer.accepted", "label": "Offer accepted"},
    {"key": "offer.declined", "label": "Offer declined"},
    {"key": "job.created", "label": "Job created"},
    {"key": "application.received", "label": "Application received"},
]
EVENT_TYPE_KEYS = frozenset(e["key"] for e in EVENT_TYPES)
WILDCARD_EVENT = "*"
PING_EVENT = "ping"

EMIT_BUDGET_SECONDS = 4.0
_EMIT_DELIVERY_DEADLINE_SECONDS = 3.4
_ATTEMPT_TIMEOUT_SECONDS = 2.5
_RETRY_PAUSE_SECONDS = 0.25
_MIN_RETRY_WINDOW_SECONDS = 0.5

DELIVERY_LOG_DAYS = 30
MAX_DELIVERIES_PER_PAGE = 100


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
    parts = [f"Hirely.ai event: {event_type}"]
    for field in _SUMMARY_FIELDS:
        value = payload.get(field) if isinstance(payload, dict) else None
        if value not in (None, ""):
            parts.append(f"{field}={value}")
    return " | ".join(parts)


def _build_delivery_body(fmt: str, event_type: str, payload: dict) -> dict:
    if fmt in ("slack", "teams"):
        return {"text": _summarize_event(event_type, payload)}
    return payload


def is_url_ssrf_safe(url: str) -> bool:
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            return False
        for family, _, _, _, sockaddr in socket.getaddrinfo(parsed.hostname, None):
            ip = ipaddress.ip_address(sockaddr[0])
            ip = getattr(ip, "ipv4_mapped", None) or ip
            if not ip.is_global or ip.is_multicast or ip.is_unspecified:
                return False
        return True
    except Exception:
        return False


def unknown_event_types(event_types) -> list[str]:
    unknown: list[str] = []
    for name in event_types or []:
        if name != WILDCARD_EVENT and name not in EVENT_TYPE_KEYS and name not in unknown:
            unknown.append(name)
    return unknown


def _host_of(url: str | None) -> str | None:
    try:
        return urlparse(url or "").hostname
    except ValueError:
        return None


def _is_timeout(exc: BaseException) -> bool:
    return isinstance(exc, (asyncio.TimeoutError, TimeoutError)) or "Timeout" in type(exc).__name__


async def _post_once(url: str, payload_bytes: bytes, headers: dict, timeout: float) -> tuple[int | None, str | None]:
    try:
        response = await asyncio.wait_for(
            safe_request(
                "POST", url, content=payload_bytes, headers=headers, timeout=timeout,
                max_bytes=_MAX_RESPONSE_BYTES, allow_http=_ALLOW_HTTP, transport=_TRANSPORT,
            ),
            timeout=timeout,
        )
        return response.status_code, None
    except UnsafeTarget as exc:
        if "larger than allowed" in str(exc):
            return None, "The endpoint answered with more data than allowed"
        return None, UNSAFE_TARGET_ERROR
    except Exception as exc:
        if _is_timeout(exc):
            return None, "The endpoint did not answer in time"
        return None, f"{type(exc).__name__}: {exc}"


async def _record_delivery(row: dict) -> None:
    try:
        db = get_db()
        if db is not None:
            await db.webhook_deliveries.insert_one(row)
    except Exception as exc:
        logger.warning("Webhook delivery log write failed | delivery_id=%s error=%s", row.get("delivery_id"), type(exc).__name__)


async def _deliver(
    subscription: dict,
    event_type: str,
    payload: dict,
    *,
    max_attempts: int = 2,
    attempt_timeout: float = _TIMEOUT,
    deadline: float | None = None,
    failures: list | None = None,
) -> dict:
    started = time.monotonic()
    delivery_id = str(uuid.uuid4())
    webhook_id = subscription.get("webhook_id")
    url = subscription.get("url")
    secret = subscription.get("secret") or settings.WEBHOOK_SIGNING_SECRET

    http_status: int | None = None
    error: str | None = None
    attempts = 0
    try:
        fmt = (subscription.get("format") or "raw").lower()
        body = _build_delivery_body(fmt, event_type, payload)
        payload_bytes = json.dumps(body, default=str).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "X-Webhook-Signature": _sign(payload_bytes, secret) if secret else "",
            "X-Webhook-Event": event_type,
            "X-Webhook-Delivery": delivery_id,
        }
        for attempt in range(1, max_attempts + 1):
            timeout = attempt_timeout
            if deadline is not None:
                remaining = deadline - time.monotonic()
                if remaining <= 0.05:
                    error = error or "No time was left to deliver"
                    break
                timeout = min(attempt_timeout, remaining)
            attempts = attempt
            http_status, error = await _post_once(url, payload_bytes, headers, timeout)
            if error == UNSAFE_TARGET_ERROR:
                attempts = 0
                logger.warning(
                    "Webhook delivery blocked: unsafe target URL | webhook_id=%s host=%s", webhook_id, _host_of(url),
                )
                break
            if error is None and http_status is not None and 200 <= http_status < 300:
                break
            if error is None:
                error = f"HTTP {http_status}"
            retryable = http_status is None or http_status >= 500
            if not retryable or attempt >= max_attempts:
                break
            await asyncio.sleep(_RETRY_PAUSE_SECONDS)
            if deadline is not None and deadline - time.monotonic() < _MIN_RETRY_WINDOW_SECONDS:
                break
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"

    delivered = error is None
    if not delivered:
        logger.warning(
            "Webhook delivery failed | webhook_id=%s host=%s event=%s status=%s attempts=%d",
            webhook_id, _host_of(url), event_type, http_status, attempts,
        )
    now = datetime.now(timezone.utc)
    duration_ms = int((time.monotonic() - started) * 1000)
    clean_error = scrub_secrets(error, extra=(secret,) if secret else ()) if error else None
    await _record_delivery({
        "delivery_id": delivery_id,
        "webhook_id": webhook_id,
        "event": event_type,
        "status": "sent" if delivered else "failed",
        "http_status": http_status,
        "duration_ms": duration_ms,
        "error": clean_error,
        "attempts": attempts,
        "created_at": now.isoformat(),
        "expires_at": now + timedelta(days=DELIVERY_LOG_DAYS),
    })
    if not delivered and failures is not None:
        failures.append({
            "webhook_id": webhook_id, "webhook_host": _host_of(url), "event": event_type,
            "http_status": http_status, "error": clean_error,
        })
    return {
        "delivery_id": delivery_id, "delivered": delivered, "http_status": http_status,
        "error": clean_error, "duration_ms": duration_ms,
    }


async def _alert_failures(failures: list[dict]) -> None:
    if not failures:
        return
    from services.hr_module.notification_settings_service import notify

    seen: set = set()
    for failure in failures:
        if failure["webhook_id"] in seen:
            continue
        seen.add(failure["webhook_id"])
        reason = f"HTTP {failure['http_status']}" if failure.get("http_status") else (failure.get("error") or "No answer")
        await notify("webhook_delivery_failed", {
            "webhook_id": failure["webhook_id"],
            "webhook_host": failure.get("webhook_host"),
            "webhook_event": failure.get("event"),
            "detail": reason,
        })


async def _active_subscriptions(db, event_type: str) -> list[dict]:
    cursor = db.webhook_subscriptions.find({
        "is_active": True,
        "event_types": {"$in": [event_type, WILDCARD_EVENT]},
    })
    return await cursor.to_list(length=None)


async def fire_webhook_event(event_type: str, payload: dict) -> None:
    failures: list[dict] = []
    try:
        db = get_db()
        if db is None:
            logger.warning("fire_webhook_event skipped: database unavailable")
            return

        subscriptions = await _active_subscriptions(db, event_type)
        if not subscriptions:
            return

        await asyncio.gather(
            *[_deliver(sub, event_type, payload, failures=failures) for sub in subscriptions],
            return_exceptions=True,
        )
    except Exception as exc:
        logger.warning("fire_webhook_event failed unexpectedly (swallowed): %s", exc)
    await _alert_failures(failures)


async def _emit(event: str, data: dict, failures: list[dict]) -> None:
    db = get_db()
    if db is None:
        return
    subscriptions = await _active_subscriptions(db, event)
    if not subscriptions:
        return
    deadline = time.monotonic() + _EMIT_DELIVERY_DEADLINE_SECONDS
    await asyncio.gather(
        *[
            _deliver(
                sub, event, data, attempt_timeout=_ATTEMPT_TIMEOUT_SECONDS,
                deadline=deadline, failures=failures,
            )
            for sub in subscriptions
        ],
        return_exceptions=True,
    )


async def emit_event(event: str, payload: dict | None = None) -> None:
    failures: list[dict] = []
    try:
        data = dict(payload or {})
        data.setdefault("event", event)
        data.setdefault("occurred_at", datetime.now(timezone.utc).isoformat())
        await asyncio.wait_for(_emit(event, data, failures), timeout=EMIT_BUDGET_SECONDS)
    except asyncio.TimeoutError:
        logger.warning("emit_event ran out of its time budget | event=%s", event)
    except Exception as exc:
        logger.warning("emit_event failed unexpectedly (swallowed) | event=%s error=%s", event, type(exc).__name__)
    await _alert_failures(failures)


async def send_test_ping(subscription: dict) -> dict:
    payload = {
        "event": PING_EVENT,
        "occurred_at": datetime.now(timezone.utc).isoformat(),
        "webhook_id": subscription.get("webhook_id"),
        "test": True,
    }
    result = await _deliver(subscription, PING_EVENT, payload, max_attempts=1)
    status = result["http_status"]
    if result["delivered"]:
        detail = f"The endpoint answered with HTTP {status}."
    elif status is not None:
        detail = f"The endpoint answered with HTTP {status}, so the ping was not accepted."
    else:
        detail = f"The ping could not be delivered: {result['error'] or 'no answer'}."
    return {"delivered": result["delivered"], "http_status": status, "detail": detail}


async def list_deliveries(db, webhook_id: str, limit: int = 50) -> list[dict]:
    limit = max(1, min(50 if limit is None else int(limit), MAX_DELIVERIES_PER_PAGE))
    cursor = (
        db.webhook_deliveries.find({"webhook_id": webhook_id}, {"_id": 0, "expires_at": 0})
        .sort("created_at", -1)
        .limit(limit)
    )
    return await cursor.to_list(length=limit)
