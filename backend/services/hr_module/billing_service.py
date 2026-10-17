from __future__ import annotations

import asyncio
import csv
import hashlib
import hmac
import io
import json
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import httpx
from pymongo.errors import DuplicateKeyError

from config.database import get_platform_db
from config.settings import settings
from services.hr_module import alerts_service, plan_service, platform_service, workspace_service
from services.hr_module.platform_service import PlatformError

logger = logging.getLogger(__name__)

STRIPE_API = "https://api.stripe.com"
TOLERANCE_SECONDS = 300
NOT_CONFIGURED = "Stripe is not configured."
EVENT_PREFIX = "stripe_event:"
STRIPE_TIMEOUT_SECONDS = 20.0
WEBHOOK_ACTOR = {"email": "stripe-webhook"}


def _round_money(value: float) -> float:
    return round(float(value or 0), 6)


def _mb(bytes_: Any) -> float:
    return round(max(0, int(bytes_ or 0)) / plan_service.BYTES_PER_MB, 2)


def build_statement(
    month: str, period: platform_service.Period, clients: list[dict], companies: list[dict],
    seats: dict[str, int], costs: dict[str, dict], mails: dict[str, int], generated_at: str,
) -> dict:
    by_client: dict[str, list[dict]] = {}
    for company in companies:
        by_client.setdefault(company["client_id"], []).append(company)

    entries = []
    grand = {"companies": 0, "seats": 0, "ai_cost_usd": 0.0, "ai_calls": 0, "emails_sent": 0, "storage_bytes": 0}
    grand_price = 0.0
    for client in clients:
        plan = plan_service.resolve_plan(client.get("plan"))
        subscription = plan_service.resolve_subscription(client.get("subscription"))
        lines = []
        total = {"companies": 0, "seats": 0, "ai_cost_usd": 0.0, "ai_calls": 0, "emails_sent": 0, "storage_bytes": 0}
        for company in sorted(by_client.get(client["client_id"], []), key=lambda c: (c.get("name") or "").lower()):
            cid = company["company_id"]
            stored = int(((company.get("usage") or {}).get("storage_bytes")) or 0)
            cost = costs.get(cid) or {}
            line_seats = int(seats.get(cid) or 0)
            line_cost = float(cost.get("cost") or 0)
            line_calls = int(cost.get("calls") or 0)
            line_mails = int(mails.get(cid) or 0)
            lines.append({
                "company_id": cid, "company_name": company.get("name") or "",
                "status": company.get("status") or "active",
                "seats": line_seats, "ai_cost_usd": _round_money(line_cost), "ai_calls": line_calls,
                "emails_sent": line_mails, "storage_mb": _mb(stored),
            })
            total["companies"] += 1
            total["seats"] += line_seats
            total["ai_cost_usd"] += line_cost
            total["ai_calls"] += line_calls
            total["emails_sent"] += line_mails
            total["storage_bytes"] += stored
        price = plan["price_monthly_usd"]
        entries.append({
            "client_id": client["client_id"], "client_name": client.get("name") or "",
            "plan": {"name": plan["name"], "price_monthly_usd": price},
            "subscription_status": subscription["status"],
            "lines": lines,
            "totals": _public_totals(total),
        })
        for key, value in total.items():
            grand[key] += value
        grand_price += float(price or 0)

    return {
        "month": month,
        "period": period.payload(),
        "generated_at": generated_at,
        "clients": entries,
        "totals": {**_public_totals(grand), "price_monthly_usd": round(grand_price, 2)},
    }


def _public_totals(total: dict) -> dict:
    return {
        "companies": total["companies"], "seats": total["seats"],
        "ai_cost_usd": _round_money(total["ai_cost_usd"]), "ai_calls": total["ai_calls"],
        "emails_sent": total["emails_sent"], "storage_mb": _mb(total["storage_bytes"]),
    }


CSV_COLUMNS = (
    "month", "client_id", "client", "company_id", "company", "company_status", "plan",
    "plan_price_monthly_usd", "seats", "ai_cost_usd", "ai_calls", "emails_sent", "storage_mb",
)


def _csv_cell(value: Any) -> Any:
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


def statement_csv(statement: dict) -> str:
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\r\n")
    writer.writerow(CSV_COLUMNS)
    month = statement["month"]
    for client in statement["clients"]:
        plan = client["plan"]
        price = plan["price_monthly_usd"]
        base = [month, client["client_id"], client["client_name"]]
        rows = client["lines"] or [None]
        for line in rows:
            if line is None:
                tail = ["", "", "", plan["name"], "" if price is None else price, 0, 0, 0, 0, 0]
            else:
                tail = [
                    line["company_id"], line["company_name"], line["status"], plan["name"],
                    "" if price is None else price, line["seats"], line["ai_cost_usd"], line["ai_calls"],
                    line["emails_sent"], line["storage_mb"],
                ]
            writer.writerow([_csv_cell(v) for v in [*base, *tail]])
    t = statement["totals"]
    writer.writerow([
        month, "", "TOTAL", "", "", "", "", t["price_monthly_usd"], t["seats"], t["ai_cost_usd"],
        t["ai_calls"], t["emails_sent"], t["storage_mb"],
    ])
    return out.getvalue()


async def statement(client_id: str | None = None, month: str | None = None) -> dict:
    raw = platform_service.raw_db()
    label = (month or "").strip() or plan_service.month_label()
    period = platform_service.month_period(label)
    clients, companies = await platform_service.directory(raw, client_id)
    if client_id and not clients:
        raise PlatformError(404, "Client not found.")
    ids = [c["company_id"] for c in companies]
    seats: dict[str, int] = {}
    costs: dict[str, dict] = {}
    mails: dict[str, int] = {}
    if ids:
        end_iso = period.until
        end_dt = period.end
        in_month = {"$gte": period.since, "$lt": end_iso}
        users_task = raw.users.aggregate([
            {"$match": {
                "company_id": {"$in": ids}, "is_active": {"$ne": False},
                "$or": [
                    {"created_at": {"$exists": False}}, {"created_at": {"$lt": end_iso}}, {"created_at": {"$lt": end_dt}},
                ],
            }},
            {"$group": {"_id": "$company_id", "seats": {"$sum": 1}}},
        ]).to_list(None)
        cost_task = raw.cost_ledger.aggregate([
            {"$match": {"company_id": {"$in": ids}, "created_at": in_month}},
            {"$group": {
                "_id": "$company_id",
                "cost": {"$sum": {"$ifNull": ["$cost_usd", 0]}}, "calls": {"$sum": {"$ifNull": ["$llm_calls", 0]}},
            }},
        ]).to_list(None)
        mail_task = raw.email_log.aggregate([
            {"$match": {"company_id": {"$in": ids}, "status": "sent", "created_at": in_month}},
            {"$group": {"_id": "$company_id", "sent": {"$sum": 1}}},
        ]).to_list(None)
        user_rows, cost_rows, mail_rows = await asyncio.gather(users_task, cost_task, mail_task)
        seats = {r["_id"]: int(r.get("seats") or 0) for r in user_rows}
        costs = {r["_id"]: {"cost": float(r.get("cost") or 0), "calls": int(r.get("calls") or 0)} for r in cost_rows}
        mails = {r["_id"]: int(r.get("sent") or 0) for r in mail_rows}
    return build_statement(
        label, period, clients, companies, seats, costs, mails, datetime.now(timezone.utc).isoformat(),
    )


async def set_subscription(actor: dict, client_id: str, changes: dict) -> dict:
    raw = platform_service.raw_db()
    client = await platform_service.require_client(raw, client_id)
    status = changes.get("status")
    if status not in plan_service.SUBSCRIPTION_STATUSES:
        raise PlatformError(422, "The status must be none, trialing, active, past_due or canceled.")
    provider = changes.get("provider")
    if provider is not None and provider not in plan_service.SUBSCRIPTION_PROVIDERS:
        raise PlatformError(422, "The provider must be manual or stripe.")

    update: dict[str, Any] = {"subscription.status": status}
    if provider:
        update["subscription.provider"] = provider
    elif not (client.get("subscription") or {}).get("provider"):
        update["subscription.provider"] = "manual"
    if "trial_ends_at" in changes:
        try:
            update["plan.trial_ends_at"] = plan_service.normalize_instant(changes["trial_ends_at"], "The trial end")
        except plan_service.PlanError as exc:
            raise PlatformError(422, str(exc))
    if status == "active":
        update["plan.trial_ends_at"] = None

    await raw.clients.update_one({"client_id": client_id}, {"$set": update})
    await workspace_service.platform_audit(
        actor, "client_subscription_update", "client", client_id,
        {
            "status": status, "provider": provider,
            **({"trial_ends_at": update["plan.trial_ends_at"]} if "plan.trial_ends_at" in update else {}),
        },
    )
    await platform_service.invalidate_console_cache(raw)
    fresh = await platform_service.require_client(raw, client_id)
    return {"client": await platform_service.client_row_for(raw, fresh)}


def stripe_configured() -> bool:
    return bool((settings.STRIPE_SECRET_KEY or "").strip())


def price_ids() -> dict[str, str]:
    try:
        data = json.loads(settings.STRIPE_PRICE_IDS or "{}")
    except ValueError:
        return {}
    if not isinstance(data, dict):
        return {}
    return {str(k): v for k, v in data.items() if isinstance(v, str) and v.strip()}


def _require_stripe() -> None:
    if not stripe_configured():
        raise PlatformError(503, NOT_CONFIGURED)


def _http_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=STRIPE_API, timeout=httpx.Timeout(STRIPE_TIMEOUT_SECONDS),
        headers={"Authorization": f"Bearer {settings.STRIPE_SECRET_KEY.strip()}"},
    )


async def _stripe_post(path: str, data: dict[str, str]) -> dict:
    try:
        async with _http_client() as http:
            response = await http.post(path, data=data)
    except httpx.HTTPError as exc:
        logger.warning("Stripe unreachable | path=%s error=%s", path, type(exc).__name__)
        raise PlatformError(502, "Stripe could not be reached. Try again shortly.")
    if response.status_code >= 400:
        logger.warning("Stripe refused a request | path=%s status=%s", path, response.status_code)
        raise PlatformError(502, "Stripe did not accept the request.")
    try:
        body = response.json()
    except ValueError:
        raise PlatformError(502, "Stripe sent an answer that could not be read.")
    return body if isinstance(body, dict) else {}


def _return_url(client_id: str, outcome: str) -> str:
    return f"{settings.FRONTEND_URL.rstrip('/')}/platform/clients/{client_id}?billing={outcome}"


async def create_checkout(actor: dict, client_id: str, tier: str | None = None) -> dict:
    _require_stripe()
    raw = platform_service.raw_db()
    client = await platform_service.require_client(raw, client_id)
    name = (tier or "").strip() or plan_service.resolve_plan(client.get("plan"))["name"]
    price = price_ids().get(name)
    if not price:
        raise PlatformError(422, f"No Stripe price is set for the {name} plan.")
    subscription = plan_service.resolve_subscription(client.get("subscription"))
    form = {
        "mode": "subscription",
        "client_reference_id": client_id,
        "line_items[0][price]": price,
        "line_items[0][quantity]": "1",
        "success_url": _return_url(client_id, "success"),
        "cancel_url": _return_url(client_id, "canceled"),
        "metadata[client_id]": client_id,
        "subscription_data[metadata][client_id]": client_id,
    }
    if subscription["customer_id"]:
        form["customer"] = subscription["customer_id"]
    elif client.get("contact_email"):
        form["customer_email"] = client["contact_email"]
    session = await _stripe_post("/v1/checkout/sessions", form)
    url = session.get("url")
    if not isinstance(url, str) or not url:
        raise PlatformError(502, "Stripe did not return a checkout address.")
    await workspace_service.platform_audit(actor, "client_billing_checkout", "client", client_id, {"plan": name})
    return {"url": url}


async def create_portal(actor: dict, client_id: str) -> dict:
    _require_stripe()
    raw = platform_service.raw_db()
    client = await platform_service.require_client(raw, client_id)
    customer = plan_service.resolve_subscription(client.get("subscription"))["customer_id"]
    if not customer:
        raise PlatformError(409, "This client has no Stripe customer yet. Start a checkout first.")
    session = await _stripe_post(
        "/v1/billing_portal/sessions", {"customer": customer, "return_url": _return_url(client_id, "portal")},
    )
    url = session.get("url")
    if not isinstance(url, str) or not url:
        raise PlatformError(502, "Stripe did not return a portal address.")
    await workspace_service.platform_audit(actor, "client_billing_portal", "client", client_id, {})
    return {"url": url}


class WebhookError(Exception):

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def parse_signature_header(header: str | None) -> tuple[int | None, list[str]]:
    timestamp: int | None = None
    signatures: list[str] = []
    for part in (header or "").split(","):
        name, _, value = part.strip().partition("=")
        if name == "t":
            try:
                timestamp = int(value)
            except ValueError:
                timestamp = None
        elif name == "v1" and value:
            signatures.append(value.strip().lower())
    return timestamp, signatures


def compute_signature(secret: str, timestamp: int, payload: bytes) -> str:
    signed = str(int(timestamp)).encode("ascii") + b"." + payload
    return hmac.new(secret.encode("utf-8"), signed, hashlib.sha256).hexdigest()


def verify_signature(
    payload: bytes, header: str | None, secret: str, *, now: float | None = None,
    tolerance: int = TOLERANCE_SECONDS,
) -> int:
    timestamp, candidates = parse_signature_header(header)
    if timestamp is None or not candidates:
        raise WebhookError(400, "The signature is missing or malformed.")
    expected = compute_signature(secret, timestamp, payload)
    matched = False
    for candidate in candidates:
        matched = hmac.compare_digest(candidate.encode("utf-8"), expected.encode("utf-8")) or matched
    if not matched:
        raise WebhookError(400, "The signature could not be verified.")
    if abs((now if now is not None else time.time()) - timestamp) > tolerance:
        raise WebhookError(400, "The request is too old.")
    return timestamp


STRIPE_STATUS = {
    "trialing": "trialing", "active": "active", "past_due": "past_due", "unpaid": "past_due",
    "paused": "past_due", "canceled": "canceled", "incomplete_expired": "canceled",
}
_LIVE = ("none", "trialing", "past_due", "active")


@dataclass
class Change:
    event: str
    client_id: str | None = None
    subscription_id: str | None = None
    customer_id: str | None = None
    fields: dict = field(default_factory=dict)
    status: str | None = None
    status_only_from: tuple[str, ...] | None = None
    payment_failed: dict | None = None


def _id_of(value: Any) -> str | None:
    if isinstance(value, str) and value:
        return value
    if isinstance(value, dict) and isinstance(value.get("id"), str):
        return value["id"]
    return None


def _epoch_iso(value: Any) -> str | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
        return None
    return datetime.fromtimestamp(value, tz=timezone.utc).isoformat()


def _invoice_subscription(invoice: dict) -> str | None:
    direct = _id_of(invoice.get("subscription"))
    if direct:
        return direct
    parent = invoice.get("parent") or {}
    return _id_of((parent.get("subscription_details") or {}).get("subscription")) if isinstance(parent, dict) else None


def _period_end(obj: dict) -> str | None:
    direct = _epoch_iso(obj.get("current_period_end"))
    if direct:
        return direct
    items = ((obj.get("items") or {}).get("data") or []) if isinstance(obj.get("items"), dict) else []
    if items and isinstance(items[0], dict):
        return _epoch_iso(items[0].get("current_period_end"))
    return None


def interpret_event(event: dict) -> Change | None:
    kind = str(event.get("type") or "")
    obj = ((event.get("data") or {}).get("object")) if isinstance(event.get("data"), dict) else None
    if not isinstance(obj, dict):
        return None
    metadata = obj.get("metadata") if isinstance(obj.get("metadata"), dict) else {}

    if kind == "checkout.session.completed":
        if obj.get("mode") not in (None, "subscription"):
            return None
        change = Change(
            event=kind,
            client_id=obj.get("client_reference_id") or metadata.get("client_id"),
            customer_id=_id_of(obj.get("customer")), subscription_id=_id_of(obj.get("subscription")),
        )
        change.fields = {"provider": "stripe"}
        if obj.get("payment_status") in ("paid", "no_payment_required"):
            change.status = "active"
        return change

    if kind in ("customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"):
        change = Change(
            event=kind, client_id=metadata.get("client_id"),
            customer_id=_id_of(obj.get("customer")), subscription_id=_id_of(obj.get("id")),
        )
        change.fields = {"provider": "stripe", "cancel_at_period_end": bool(obj.get("cancel_at_period_end"))}
        ends = _period_end(obj)
        if ends:
            change.fields["current_period_end"] = ends
        if kind == "customer.subscription.deleted":
            change.status = "canceled"
            change.fields["cancel_at_period_end"] = False
        else:
            change.status = STRIPE_STATUS.get(str(obj.get("status") or ""))
        return change

    if kind == "invoice.paid":
        change = Change(
            event=kind, customer_id=_id_of(obj.get("customer")), subscription_id=_invoice_subscription(obj),
            status="active", status_only_from=_LIVE,
        )
        change.fields = {"provider": "stripe"}
        lines = ((obj.get("lines") or {}).get("data") or []) if isinstance(obj.get("lines"), dict) else []
        if lines and isinstance(lines[0], dict):
            ends = _epoch_iso(((lines[0].get("period") or {}).get("end")))
            if ends:
                change.fields["current_period_end"] = ends
        return change

    if kind == "invoice.payment_failed":
        change = Change(
            event=kind, customer_id=_id_of(obj.get("customer")), subscription_id=_invoice_subscription(obj),
            status="past_due", status_only_from=_LIVE,
        )
        change.fields = {"provider": "stripe"}
        change.payment_failed = {
            "amount_due": obj.get("amount_due"), "currency": str(obj.get("currency") or "").upper(),
            "attempt_count": obj.get("attempt_count"),
        }
        return change

    return None


async def _find_client(raw, change: Change) -> dict | None:
    wanted: list[tuple[str, dict]] = []
    if change.client_id:
        wanted.append(("client_id", {"client_id": change.client_id}))
    if change.subscription_id:
        wanted.append(("subscription", {"subscription.subscription_id": change.subscription_id}))
    if change.customer_id:
        wanted.append(("customer", {"subscription.customer_id": change.customer_id}))
    for _, clause in wanted:
        row = await raw.clients.find_one({**clause, "kind": {"$ne": "platform"}}, {"_id": 0})
        if row:
            return row
    return None


def _money(amount: Any, currency: str) -> str:
    if isinstance(amount, (int, float)) and not isinstance(amount, bool):
        return f"{amount / 100:.2f} {currency}".strip()
    return "an unknown amount"


async def apply_change(raw, event: dict, change: Change) -> dict:
    client = await _find_client(raw, change)
    if client is None:
        logger.info("Stripe event for no known client | type=%s", change.event)
        return {"handled": False, "reason": "no matching client"}
    client_id = client["client_id"]
    current = plan_service.resolve_subscription(client.get("subscription"))

    update: dict[str, Any] = {}
    for key, value in change.fields.items():
        update[f"subscription.{key}"] = value
    if change.customer_id:
        update["subscription.customer_id"] = change.customer_id
    if change.subscription_id:
        update["subscription.subscription_id"] = change.subscription_id
    applied_status = None
    if change.status and (change.status_only_from is None or current["status"] in change.status_only_from):
        update["subscription.status"] = change.status
        applied_status = change.status
        if change.status == "active":
            update["plan.trial_ends_at"] = None
    if update:
        await raw.clients.update_one({"client_id": client_id}, {"$set": update})

    await workspace_service.platform_audit(
        WEBHOOK_ACTOR, "client_subscription_stripe", "client", client_id,
        {"event": change.event, "event_id": event.get("id"), "status": applied_status or current["status"]},
        actor_role="system",
    )
    await platform_service.invalidate_console_cache(raw)

    if change.payment_failed is not None:
        info = change.payment_failed
        await alerts_service.alert_owners(
            f"payment_failed:{client_id}", f"Payment failed for {client.get('name') or client_id}",
            f"A payment for {client.get('name') or client_id} failed: {_money(info.get('amount_due'), info['currency'])}, "
            f"attempt {info.get('attempt_count') or 1}. The subscription is past due. "
            "Stripe retries on its own schedule; follow up with the client.",
            cooldown_hours=24,
        )
    return {"handled": True, "client_id": client_id, "status": applied_status or current["status"]}


async def _claim_event(raw, event_id: str, kind: str) -> bool:
    try:
        await raw.settings.insert_one({
            "_id": f"{EVENT_PREFIX}{event_id}", "key": f"{EVENT_PREFIX}{event_id}", "type": kind,
            "created_at": datetime.now(timezone.utc),
        })
    except DuplicateKeyError:
        return False
    return True


async def handle_webhook(payload: bytes, signature_header: str | None, *, now: float | None = None) -> dict:
    secret = (settings.STRIPE_WEBHOOK_SECRET or "").strip()
    if not secret:
        raise WebhookError(503, NOT_CONFIGURED)
    verify_signature(payload, signature_header, secret, now=now)
    try:
        event = json.loads(payload)
    except ValueError:
        raise WebhookError(400, "The event could not be read.")
    if not isinstance(event, dict) or not isinstance(event.get("id"), str) or not isinstance(event.get("type"), str):
        raise WebhookError(400, "The event could not be read.")
    raw = get_platform_db()
    if raw is None:
        raise WebhookError(503, "The database is unavailable. Try again shortly.")

    if not await _claim_event(raw, event["id"], event["type"]):
        return {"received": True, "duplicate": True}
    try:
        change = interpret_event(event)
        outcome = await apply_change(raw, event, change) if change is not None else {"handled": False}
    except Exception as exc:
        logger.error("Stripe event failed | type=%s error=%s", event.get("type"), type(exc).__name__)
        try:
            await raw.settings.delete_one({"_id": f"{EVENT_PREFIX}{event['id']}"})
        except Exception:
            pass
        raise WebhookError(500, "The event could not be processed.")
    return {"received": True, **outcome}
