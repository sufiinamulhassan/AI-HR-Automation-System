import copy
import csv
import io
import json
from datetime import datetime, timezone
from unittest.mock import AsyncMock

import httpx
import pytest
from pymongo.errors import DuplicateKeyError

from services.hr_module import alerts_service, billing_service as billing, plan_service, platform_service

pytestmark = pytest.mark.anyio

SECRET = "whsec_unit_test_secret"
NOW = 1_800_000_000.0


def sign(payload: bytes, *, secret: str = SECRET, at: float = NOW, extra: str = "") -> str:
    return f"t={int(at)},v1={billing.compute_signature(secret, int(at), payload)}{extra}"


def body(event: dict) -> bytes:
    return json.dumps(event, separators=(",", ":")).encode()


def test_a_header_is_read_into_its_timestamp_and_every_v1_signature():
    timestamp, signatures = billing.parse_signature_header("t=1492774577,v1=AbC123,v0=old,v1=def456")
    assert timestamp == 1492774577 and signatures == ["abc123", "def456"]
    assert billing.parse_signature_header(None) == (None, [])
    assert billing.parse_signature_header("t=soon,v1=aa") == (None, ["aa"])
    assert billing.parse_signature_header("v1=aa") == (None, ["aa"])
    assert billing.parse_signature_header("garbage") == (None, [])


def test_the_signature_is_hmac_sha256_of_timestamp_dot_body():
    import hashlib
    import hmac

    payload = b'{"id":"evt_1"}'
    expected = hmac.new(SECRET.encode(), b"1700000000." + payload, hashlib.sha256).hexdigest()
    assert billing.compute_signature(SECRET, 1700000000, payload) == expected


def test_a_correctly_signed_fresh_payload_is_accepted():
    payload = b'{"id":"evt_1","type":"invoice.paid"}'
    assert billing.verify_signature(payload, sign(payload), SECRET, now=NOW) == int(NOW)
    assert billing.verify_signature(payload, sign(payload), SECRET, now=NOW + 299) == int(NOW)
    assert billing.verify_signature(payload, sign(payload), SECRET, now=NOW - 299) == int(NOW)
    rolled = sign(payload, extra=",v1=" + "0" * 64)
    assert billing.verify_signature(payload, rolled, SECRET, now=NOW) == int(NOW)
    assert billing.verify_signature(payload, f"t={int(NOW)},v1={'0' * 64},v1={billing.compute_signature(SECRET, int(NOW), payload)}", SECRET, now=NOW)


@pytest.mark.parametrize("tamper", [
    lambda p: p.replace(b"evt_1", b"evt_2"),
    lambda p: p + b" ",
    lambda p: p[:-1],
    lambda p: b"",
])
def test_a_tampered_body_is_refused(tamper):
    payload = b'{"id":"evt_1","type":"invoice.paid"}'
    with pytest.raises(billing.WebhookError) as refused:
        billing.verify_signature(tamper(payload), sign(payload), SECRET, now=NOW)
    assert refused.value.status == 400 and "could not be verified" in refused.value.message


def test_a_signature_made_with_another_secret_or_another_time_is_refused():
    payload = b'{"id":"evt_1"}'
    with pytest.raises(billing.WebhookError):
        billing.verify_signature(payload, sign(payload, secret="whsec_other"), SECRET, now=NOW)
    forged = f"t={int(NOW) + 5},v1={billing.compute_signature(SECRET, int(NOW), payload)}"
    with pytest.raises(billing.WebhookError):
        billing.verify_signature(payload, forged, SECRET, now=NOW)


def test_a_stale_or_future_timestamp_is_refused_even_when_the_signature_is_genuine():
    payload = b'{"id":"evt_1"}'
    for now in (NOW + 301, NOW - 301, NOW + 86400):
        with pytest.raises(billing.WebhookError) as stale:
            billing.verify_signature(payload, sign(payload), SECRET, now=now)
        assert stale.value.status == 400 and "too old" in stale.value.message
    assert billing.verify_signature(payload, sign(payload), SECRET, now=NOW + 300)


@pytest.mark.parametrize("header", [None, "", "t=1", "v1=abc", "t=abc,v1=abc", f"t={int(NOW)}", "nonsense"])
def test_a_missing_or_malformed_header_is_refused(header):
    with pytest.raises(billing.WebhookError) as refused:
        billing.verify_signature(b"{}", header, SECRET, now=NOW)
    assert refused.value.status == 400


def test_the_comparison_is_constant_time(monkeypatch):
    seen = []
    real = billing.hmac.compare_digest
    monkeypatch.setattr(billing.hmac, "compare_digest", lambda a, b: seen.append((a, b)) or real(a, b))
    payload = b"{}"
    with pytest.raises(billing.WebhookError):
        billing.verify_signature(payload, f"t={int(NOW)},v1={'a' * 64},v1={'b' * 64}", SECRET, now=NOW)
    assert len(seen) == 2


def event(kind: str, obj: dict, event_id: str = "evt_1") -> dict:
    return {"id": event_id, "type": kind, "data": {"object": obj}}


def test_a_completed_checkout_names_the_client_and_activates_a_paid_subscription():
    change = billing.interpret_event(event("checkout.session.completed", {
        "mode": "subscription", "client_reference_id": "cli_1", "customer": "cus_1", "subscription": "sub_1",
        "payment_status": "paid",
    }))
    assert (change.client_id, change.customer_id, change.subscription_id) == ("cli_1", "cus_1", "sub_1")
    assert change.status == "active" and change.fields["provider"] == "stripe" and change.status_only_from is None
    unpaid = billing.interpret_event(event("checkout.session.completed", {
        "mode": "subscription", "client_reference_id": "cli_1", "customer": "cus_1", "payment_status": "unpaid",
    }))
    assert unpaid.status is None
    assert billing.interpret_event(event("checkout.session.completed", {"mode": "payment", "client_reference_id": "cli_1"})) is None
    expanded = billing.interpret_event(event("checkout.session.completed", {
        "client_reference_id": "cli_1", "customer": {"id": "cus_2"}, "subscription": {"id": "sub_2"}, "payment_status": "paid",
    }))
    assert (expanded.customer_id, expanded.subscription_id) == ("cus_2", "sub_2")


@pytest.mark.parametrize("stripe_status,ours", [
    ("trialing", "trialing"), ("active", "active"), ("past_due", "past_due"), ("unpaid", "past_due"),
    ("paused", "past_due"), ("canceled", "canceled"), ("incomplete_expired", "canceled"), ("incomplete", None), ("odd", None),
])
def test_a_subscription_status_is_mapped_to_ours(stripe_status, ours):
    change = billing.interpret_event(event("customer.subscription.updated", {
        "id": "sub_1", "customer": "cus_1", "status": stripe_status, "metadata": {"client_id": "cli_1"},
    }))
    assert change.status == ours and change.client_id == "cli_1"


def test_a_subscription_carries_its_period_end_and_cancel_flag_from_either_api_shape():
    epoch = 1_900_000_000
    iso = datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat()
    old = billing.interpret_event(event("customer.subscription.created", {
        "id": "sub_1", "customer": "cus_1", "status": "active", "current_period_end": epoch, "cancel_at_period_end": True,
    }))
    assert old.fields["current_period_end"] == iso and old.fields["cancel_at_period_end"] is True
    new = billing.interpret_event(event("customer.subscription.updated", {
        "id": "sub_1", "customer": "cus_1", "status": "active", "items": {"data": [{"current_period_end": epoch}]},
    }))
    assert new.fields["current_period_end"] == iso and new.fields["cancel_at_period_end"] is False
    gone = billing.interpret_event(event("customer.subscription.deleted", {
        "id": "sub_1", "customer": "cus_1", "status": "canceled", "cancel_at_period_end": True,
    }))
    assert gone.status == "canceled" and gone.fields["cancel_at_period_end"] is False


def test_invoices_find_their_subscription_in_either_api_shape_and_guard_the_status_they_set():
    paid = billing.interpret_event(event("invoice.paid", {
        "customer": "cus_1", "subscription": "sub_1", "lines": {"data": [{"period": {"end": 1_900_000_000}}]},
    }))
    assert paid.subscription_id == "sub_1" and paid.status == "active"
    assert "canceled" not in paid.status_only_from
    assert paid.fields["current_period_end"].startswith("2030-")
    nested = billing.interpret_event(event("invoice.payment_failed", {
        "customer": "cus_1", "parent": {"subscription_details": {"subscription": "sub_9"}},
        "amount_due": 4900, "currency": "usd", "attempt_count": 2,
    }))
    assert nested.subscription_id == "sub_9" and nested.status == "past_due"
    assert nested.payment_failed == {"amount_due": 4900, "currency": "USD", "attempt_count": 2}


def test_events_we_do_not_act_on_mean_nothing():
    assert billing.interpret_event(event("customer.created", {"id": "cus_1"})) is None
    assert billing.interpret_event({"id": "evt_1", "type": "invoice.paid"}) is None
    assert billing.interpret_event({"id": "evt_1", "type": "invoice.paid", "data": {"object": "nope"}}) is None


def _match(doc: dict, flt: dict) -> bool:
    for key, want in flt.items():
        have = doc
        for part in key.split("."):
            have = have.get(part) if isinstance(have, dict) else None
        if isinstance(want, dict) and "$ne" in want:
            if have == want["$ne"]:
                return False
        elif have != want:
            return False
    return True


class Coll:
    def __init__(self):
        self.docs: list[dict] = []
        self.updates: list[tuple[dict, dict]] = []

    async def insert_one(self, doc):
        if any(d.get("_id") == doc.get("_id") for d in self.docs):
            raise DuplicateKeyError("duplicate _id")
        self.docs.append(copy.deepcopy(doc))

    async def delete_one(self, flt):
        for d in self.docs:
            if _match(d, flt):
                self.docs.remove(d)
                return

    async def find_one(self, flt, projection=None):
        for d in self.docs:
            if _match(d, flt):
                return copy.deepcopy(d)
        return None

    async def update_one(self, flt, update, upsert=False):
        self.updates.append((flt, update))
        for d in self.docs:
            if _match(d, flt):
                for path, value in update.get("$set", {}).items():
                    target = d
                    *parents, last = path.split(".")
                    for part in parents:
                        target = target.setdefault(part, {})
                    target[last] = value
                return


class Raw:
    def __init__(self, clients=None):
        self.settings = Coll()
        self.clients = Coll()
        self.clients.docs = clients or []


def client_row(**extra):
    return {"client_id": "cli_1", "name": "Acme", "kind": "workspace", "plan": {"name": "growth", "trial_ends_at": "2026-09-01T00:00:00+00:00"},
            "subscription": {"status": "trialing", "provider": "manual"}, **extra}


@pytest.fixture
def world(monkeypatch):
    raw = Raw([client_row()])
    audit = AsyncMock()
    alert = AsyncMock(return_value=True)
    invalidate = AsyncMock()
    monkeypatch.setattr(billing, "get_platform_db", lambda: raw)
    monkeypatch.setattr(billing.workspace_service, "platform_audit", audit)
    monkeypatch.setattr(billing.platform_service, "invalidate_console_cache", invalidate)
    monkeypatch.setattr(alerts_service, "alert_owners", alert)
    monkeypatch.setattr(billing.settings, "STRIPE_WEBHOOK_SECRET", SECRET)
    return raw, audit, alert


def stored(raw, field="subscription"):
    return next(c for c in raw.clients.docs if c["client_id"] == "cli_1")[field] if field else None


async def deliver(payload: dict, *, header: str | None = None, at: float = NOW, now: float = NOW):
    raw_body = body(payload)
    return await billing.handle_webhook(raw_body, header if header is not None else sign(raw_body, at=at), now=now)


async def test_a_signed_checkout_activates_the_client_ends_its_trial_and_is_audited_by_the_system(world):
    raw, audit, _ = world
    out = await deliver(event("checkout.session.completed", {
        "mode": "subscription", "client_reference_id": "cli_1", "customer": "cus_1", "subscription": "sub_1", "payment_status": "paid",
    }))
    assert out == {"received": True, "handled": True, "client_id": "cli_1", "status": "active"}
    subscription = stored(raw)
    assert subscription["status"] == "active" and subscription["provider"] == "stripe"
    assert (subscription["customer_id"], subscription["subscription_id"]) == ("cus_1", "sub_1")
    assert stored(raw, "plan")["trial_ends_at"] is None
    audit.assert_awaited_once()
    assert audit.await_args.args[1] == "client_subscription_stripe" and audit.await_args.kwargs["actor_role"] == "system"
    assert audit.await_args.args[3] == "cli_1" and audit.await_args.args[4]["event_id"] == "evt_1"
    billing.platform_service.invalidate_console_cache.assert_awaited()


async def test_a_replayed_event_is_acknowledged_and_changes_nothing(world):
    raw, audit, _ = world
    first = event("customer.subscription.updated", {"id": "sub_1", "customer": "cus_1", "status": "active", "metadata": {"client_id": "cli_1"}})
    assert (await deliver(first))["handled"] is True
    changes = len(raw.clients.updates)
    stored(raw)["status"] = "past_due"
    again = await deliver(first)
    assert again == {"received": True, "duplicate": True}
    assert len(raw.clients.updates) == changes and audit.await_count == 1 and stored(raw)["status"] == "past_due"
    assert [d["_id"] for d in raw.settings.docs] == ["stripe_event:evt_1"]


async def test_a_new_event_id_is_a_new_event(world):
    raw, audit, _ = world
    for n in (1, 2):
        out = await deliver(event("customer.subscription.updated", {"id": "sub_1", "customer": "cus_1", "status": "active", "metadata": {"client_id": "cli_1"}}, f"evt_{n}"))
        assert out["handled"] is True
    assert audit.await_count == 2 and len(raw.settings.docs) == 2


async def test_a_tampered_unsigned_or_stale_request_changes_nothing(world):
    raw, audit, alert = world
    real = event("customer.subscription.deleted", {"id": "sub_1", "customer": "cus_1", "status": "canceled", "metadata": {"client_id": "cli_1"}})
    good = body(real)
    attempts = [
        (good.replace(b"canceled", b"active  "), sign(good)),
        (good, None),
        (good, sign(good, secret="whsec_wrong")),
        (good, sign(good, at=NOW - 3600)),
    ]
    for payload, header in attempts:
        with pytest.raises(billing.WebhookError) as refused:
            await billing.handle_webhook(payload, header, now=NOW)
        assert refused.value.status == 400
    assert raw.clients.updates == [] and raw.settings.docs == [] and audit.await_count == 0
    assert stored(raw)["status"] == "trialing"


async def test_without_a_configured_secret_nothing_is_accepted(world, monkeypatch):
    monkeypatch.setattr(billing.settings, "STRIPE_WEBHOOK_SECRET", "")
    payload = body(event("invoice.paid", {"customer": "cus_1"}))
    with pytest.raises(billing.WebhookError) as off:
        await billing.handle_webhook(payload, sign(payload), now=NOW)
    assert off.value.status == 503 and off.value.message == "Stripe is not configured."


async def test_a_signed_body_that_is_not_an_event_is_a_400(world):
    for junk in (b"not json", b"[]", b'{"type":"x"}', b'{"id":1,"type":"x"}'):
        with pytest.raises(billing.WebhookError) as refused:
            await billing.handle_webhook(junk, sign(junk), now=NOW)
        assert refused.value.status == 400


async def test_a_deleted_subscription_cancels_and_a_paid_old_invoice_does_not_revive_it(world):
    raw, _, _ = world
    await deliver(event("customer.subscription.deleted", {"id": "sub_1", "customer": "cus_1", "status": "canceled", "metadata": {"client_id": "cli_1"}}, "evt_a"))
    assert stored(raw)["status"] == "canceled"
    out = await deliver(event("invoice.paid", {"customer": "cus_1", "subscription": "sub_1"}, "evt_b"))
    assert out["handled"] is True and stored(raw)["status"] == "canceled"
    await deliver(event("checkout.session.completed", {"mode": "subscription", "client_reference_id": "cli_1", "customer": "cus_1", "subscription": "sub_2", "payment_status": "paid"}, "evt_c"))
    assert stored(raw)["status"] == "active" and stored(raw)["subscription_id"] == "sub_2"


async def test_a_paid_invoice_ends_past_due_and_records_the_period(world):
    raw, _, _ = world
    stored(raw)["status"] = "past_due"
    stored(raw)["customer_id"] = "cus_1"
    await deliver(event("invoice.paid", {"customer": "cus_1", "subscription": "sub_1", "lines": {"data": [{"period": {"end": 1_900_000_000}}]}}))
    assert stored(raw)["status"] == "active" and stored(raw)["current_period_end"].startswith("2030-")


async def test_a_failed_payment_marks_the_client_past_due_and_alerts_the_owners_without_blocking_it(world):
    raw, _, alert = world
    stored(raw)["customer_id"] = "cus_1"
    out = await deliver(event("invoice.payment_failed", {
        "customer": "cus_1", "subscription": "sub_1", "amount_due": 4900, "currency": "usd", "attempt_count": 1,
    }))
    assert out["status"] == "past_due" and stored(raw)["status"] == "past_due"
    alert.assert_awaited_once()
    key, subject, text = alert.await_args.args
    assert key == "payment_failed:cli_1" and "Acme" in subject and "49.00 USD" in text
    assert alert.await_args.kwargs["cooldown_hours"] == 24
    assert chr(0x2014) not in subject + text
    from services.hr_module import workspace_service
    assert workspace_service.blocked_reason({"client_plan": {}, "client_subscription": stored(raw)}) is None


async def test_an_event_for_a_client_we_do_not_have_is_acknowledged_and_ignored(world):
    raw, audit, _ = world
    out = await deliver(event("customer.subscription.updated", {"id": "sub_x", "customer": "cus_unknown", "status": "active"}))
    assert out == {"received": True, "handled": False, "reason": "no matching client"}
    assert raw.clients.updates == [] and audit.await_count == 0


async def test_a_client_is_found_by_its_subscription_or_customer_when_the_event_names_no_client(world):
    raw, _, _ = world
    stored(raw)["subscription_id"] = "sub_known"
    out = await deliver(event("customer.subscription.updated", {"id": "sub_known", "customer": "cus_other", "status": "past_due"}, "evt_s"))
    assert out["client_id"] == "cli_1"
    stored(raw)["customer_id"] = "cus_known"
    out = await deliver(event("invoice.paid", {"customer": "cus_known"}, "evt_c"))
    assert out["client_id"] == "cli_1"


async def test_an_event_type_we_ignore_is_still_remembered(world):
    raw, audit, _ = world
    out = await deliver(event("customer.created", {"id": "cus_1"}, "evt_ignored"))
    assert out == {"received": True, "handled": False}
    assert [d["_id"] for d in raw.settings.docs] == ["stripe_event:evt_ignored"] and audit.await_count == 0


async def test_a_failure_while_applying_gives_the_event_id_back_so_stripe_can_retry(world, monkeypatch):
    raw, _, _ = world
    payload = event("customer.subscription.updated", {"id": "sub_1", "customer": "cus_1", "status": "active", "metadata": {"client_id": "cli_1"}})
    monkeypatch.setattr(billing, "apply_change", AsyncMock(side_effect=RuntimeError("database hiccup")))
    with pytest.raises(billing.WebhookError) as failed:
        await deliver(payload)
    assert failed.value.status == 500 and "hiccup" not in failed.value.message
    assert raw.settings.docs == []
    monkeypatch.undo()
    monkeypatch.setattr(billing, "get_platform_db", lambda: raw)
    monkeypatch.setattr(billing.settings, "STRIPE_WEBHOOK_SECRET", SECRET)
    monkeypatch.setattr(billing.workspace_service, "platform_audit", AsyncMock())
    monkeypatch.setattr(billing.platform_service, "invalidate_console_cache", AsyncMock())
    assert (await deliver(payload))["handled"] is True


class Recorder:

    def __init__(self, answer=None, status=200):
        self.requests: list[httpx.Request] = []
        self.answer = answer if answer is not None else {"url": "https://checkout.stripe.com/c/pay/cs_test_1"}
        self.status = status

    def client(self):
        def handler(request: httpx.Request) -> httpx.Response:
            self.requests.append(request)
            return httpx.Response(self.status, json=self.answer)

        return httpx.AsyncClient(
            transport=httpx.MockTransport(handler), base_url=billing.STRIPE_API,
            headers={"Authorization": f"Bearer {billing.settings.STRIPE_SECRET_KEY}"},
        )


def form(request: httpx.Request) -> dict:
    from urllib.parse import parse_qsl

    return dict(parse_qsl(request.content.decode()))


@pytest.fixture
def stripe(monkeypatch):
    recorder = Recorder()
    raw = Raw([client_row(contact_email="billing@acme.test")])
    monkeypatch.setattr(billing.settings, "STRIPE_SECRET_KEY", "sk_test_unit")
    monkeypatch.setattr(billing.settings, "STRIPE_PRICE_IDS", json.dumps({"growth": "price_growth", "starter": "price_starter"}))
    monkeypatch.setattr(billing.settings, "FRONTEND_URL", "https://app.example.test/")
    monkeypatch.setattr(billing, "_http_client", recorder.client)
    monkeypatch.setattr(billing.platform_service, "raw_db", lambda: raw)

    async def require_client(_raw, client_id):
        doc = next((c for c in raw.clients.docs if c["client_id"] == client_id), None)
        if doc is None:
            raise platform_service.PlatformError(404, "Client not found.")
        return copy.deepcopy(doc)

    monkeypatch.setattr(billing.platform_service, "require_client", require_client)
    audit = AsyncMock()
    monkeypatch.setattr(billing.workspace_service, "platform_audit", audit)
    recorder.raw, recorder.audit = raw, audit
    return recorder


OWNER = {"email": "owner@platform.test"}


async def test_stripe_endpoints_say_so_when_there_are_no_keys(monkeypatch):
    monkeypatch.setattr(billing.settings, "STRIPE_SECRET_KEY", "")
    for call in (billing.create_checkout(OWNER, "cli_1"), billing.create_portal(OWNER, "cli_1")):
        with pytest.raises(platform_service.PlatformError) as off:
            await call
        assert off.value.status == 503 and off.value.message == "Stripe is not configured."


async def test_a_checkout_session_is_a_subscription_for_the_clients_price_tagged_with_its_id(stripe):
    out = await billing.create_checkout(OWNER, "cli_1")
    assert out == {"url": "https://checkout.stripe.com/c/pay/cs_test_1"}
    (request,) = stripe.requests
    assert request.method == "POST" and str(request.url) == "https://api.stripe.com/v1/checkout/sessions"
    assert request.headers["authorization"] == "Bearer sk_test_unit"
    fields = form(request)
    assert fields["mode"] == "subscription" and fields["client_reference_id"] == "cli_1"
    assert fields["line_items[0][price]"] == "price_growth" and fields["line_items[0][quantity]"] == "1"
    assert fields["customer_email"] == "billing@acme.test" and "customer" not in fields
    assert fields["subscription_data[metadata][client_id]"] == "cli_1"
    assert fields["success_url"] == "https://app.example.test/platform/clients/cli_1?billing=success"
    assert fields["cancel_url"].endswith("?billing=canceled")
    assert stripe.audit.await_args.args[1] == "client_billing_checkout"


async def test_checkout_uses_the_chosen_tier_and_the_existing_customer(stripe):
    stripe.raw.clients.docs[0]["subscription"] = {"status": "trialing", "customer_id": "cus_9"}
    await billing.create_checkout(OWNER, "cli_1", "starter")
    fields = form(stripe.requests[0])
    assert fields["line_items[0][price]"] == "price_starter" and fields["customer"] == "cus_9" and "customer_email" not in fields


async def test_checkout_needs_a_price_for_the_plan_and_reports_stripes_refusals_without_its_text(stripe, monkeypatch):
    with pytest.raises(platform_service.PlatformError) as unpriced:
        await billing.create_checkout(OWNER, "cli_1", "enterprise")
    assert unpriced.value.status == 422 and "enterprise" in unpriced.value.message and not stripe.requests
    monkeypatch.setattr(billing.settings, "STRIPE_PRICE_IDS", "not json")
    with pytest.raises(platform_service.PlatformError):
        await billing.create_checkout(OWNER, "cli_1")
    monkeypatch.setattr(billing.settings, "STRIPE_PRICE_IDS", json.dumps({"growth": "price_growth"}))
    stripe.status, stripe.answer = 400, {"error": {"message": "No such price: 'price_growth' sk_live_leak"}}
    with pytest.raises(platform_service.PlatformError) as refused:
        await billing.create_checkout(OWNER, "cli_1")
    assert refused.value.status == 502 and "sk_live_leak" not in refused.value.message and "No such price" not in refused.value.message
    stripe.status, stripe.answer = 200, {"id": "cs_1"}
    with pytest.raises(platform_service.PlatformError) as no_url:
        await billing.create_checkout(OWNER, "cli_1")
    assert no_url.value.status == 502


async def test_the_portal_needs_a_stripe_customer(stripe):
    with pytest.raises(platform_service.PlatformError) as none_yet:
        await billing.create_portal(OWNER, "cli_1")
    assert none_yet.value.status == 409 and not stripe.requests
    stripe.raw.clients.docs[0]["subscription"] = {"status": "active", "customer_id": "cus_9"}
    stripe.answer = {"url": "https://billing.stripe.com/p/session/x"}
    assert await billing.create_portal(OWNER, "cli_1") == {"url": "https://billing.stripe.com/p/session/x"}
    request = stripe.requests[0]
    assert str(request.url) == "https://api.stripe.com/v1/billing_portal/sessions"
    assert form(request)["customer"] == "cus_9" and form(request)["return_url"].startswith("https://app.example.test/")


async def test_an_unreachable_stripe_is_a_502_and_an_unknown_client_a_404(stripe, monkeypatch):
    def broken():
        def handler(request):
            raise httpx.ConnectError("no route", request=request)
        return httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url=billing.STRIPE_API)

    monkeypatch.setattr(billing, "_http_client", broken)
    with pytest.raises(platform_service.PlatformError) as down:
        await billing.create_checkout(OWNER, "cli_1")
    assert down.value.status == 502
    with pytest.raises(platform_service.PlatformError) as missing:
        await billing.create_checkout(OWNER, "cli_nope")
    assert missing.value.status == 404


def test_the_price_list_is_read_as_json_and_junk_is_empty(monkeypatch):
    monkeypatch.setattr(billing.settings, "STRIPE_PRICE_IDS", '{"a": "price_a", "b": 5, "c": ""}')
    assert billing.price_ids() == {"a": "price_a"}
    for junk in ("", "[]", "{", "null"):
        monkeypatch.setattr(billing.settings, "STRIPE_PRICE_IDS", junk)
        assert billing.price_ids() == {}


def _clients():
    return [
        {"client_id": "cli_a", "name": "Acme", "plan": {"name": "growth", "price_monthly_usd": 199}, "subscription": {"status": "active"}},
        {"client_id": "cli_b", "name": "Beta", "plan": {"name": "starter", "price_monthly_usd": 49.5}, "subscription": {}},
        {"client_id": "cli_c", "name": "Empty Co", "plan": {}, "subscription": {}},
    ]


def _companies():
    mb = 1024 * 1024
    return [
        {"company_id": "cmp_a2", "client_id": "cli_a", "name": "Zed Unit", "status": "suspended", "usage": {"storage_bytes": mb // 2}},
        {"company_id": "cmp_a1", "client_id": "cli_a", "name": "Alpha Unit", "status": "active", "usage": {"storage_bytes": 3 * mb}},
        {"company_id": "cmp_b1", "client_id": "cli_b", "name": "=SUM(A1)", "status": "active"},
    ]


def _statement():
    period = platform_service.month_period("2026-09")
    return billing.build_statement(
        "2026-09", period, _clients(), _companies(),
        seats={"cmp_a1": 12, "cmp_a2": 3, "cmp_b1": 2},
        costs={"cmp_a1": {"cost": 10.25, "calls": 100}, "cmp_a2": {"cost": 0.125, "calls": 4}},
        mails={"cmp_a1": 40, "cmp_b1": 1}, generated_at="2026-10-01T00:00:00+00:00",
    )


def test_the_statement_has_a_line_per_company_with_client_totals_and_grand_totals():
    s = _statement()
    assert s["month"] == "2026-09" and s["period"]["kind"] == "month" and s["generated_at"]
    acme, beta, empty = s["clients"]
    assert (acme["client_id"], beta["client_id"], empty["client_id"]) == ("cli_a", "cli_b", "cli_c")
    assert [l["company_name"] for l in acme["lines"]] == ["Alpha Unit", "Zed Unit"]
    assert acme["lines"][0] == {
        "company_id": "cmp_a1", "company_name": "Alpha Unit", "status": "active", "seats": 12,
        "ai_cost_usd": 10.25, "ai_calls": 100, "emails_sent": 40, "storage_mb": 3.0,
    }
    assert acme["lines"][1]["storage_mb"] == 0.5 and acme["lines"][1]["status"] == "suspended"
    assert acme["totals"] == {"companies": 2, "seats": 15, "ai_cost_usd": 10.375, "ai_calls": 104, "emails_sent": 40, "storage_mb": 3.5}
    assert acme["plan"] == {"name": "growth", "price_monthly_usd": 199} and acme["subscription_status"] == "active"
    assert beta["lines"][0]["seats"] == 2 and beta["lines"][0]["ai_cost_usd"] == 0 and beta["subscription_status"] == "none"
    assert empty["lines"] == [] and empty["totals"]["companies"] == 0 and empty["plan"]["price_monthly_usd"] is None
    assert s["totals"] == {
        "companies": 3, "seats": 17, "ai_cost_usd": 10.375, "ai_calls": 104, "emails_sent": 41, "storage_mb": 3.5,
        "price_monthly_usd": 248.5,
    }


def test_a_company_with_no_activity_is_a_line_of_zeros_not_missing():
    period = platform_service.month_period("2026-09")
    s = billing.build_statement("2026-09", period, _clients()[:1], _companies()[:2], {}, {}, {}, "t")
    assert all(l["seats"] == 0 and l["ai_cost_usd"] == 0 and l["emails_sent"] == 0 for l in s["clients"][0]["lines"])


def test_the_csv_has_a_header_a_row_per_company_a_row_for_a_client_without_one_and_a_total():
    rows = list(csv.reader(io.StringIO(billing.statement_csv(_statement()))))
    assert tuple(rows[0]) == billing.CSV_COLUMNS
    body_rows = rows[1:-1]
    assert [r[4] for r in body_rows] == ["Alpha Unit", "Zed Unit", "'=SUM(A1)", ""]
    first = dict(zip(billing.CSV_COLUMNS, body_rows[0]))
    assert first["month"] == "2026-09" and first["client"] == "Acme" and first["plan"] == "growth"
    assert first["plan_price_monthly_usd"] == "199" and first["seats"] == "12" and first["ai_cost_usd"] == "10.25"
    assert first["emails_sent"] == "40" and first["storage_mb"] == "3.0"
    last = dict(zip(billing.CSV_COLUMNS, rows[-1]))
    assert last["client"] == "TOTAL" and last["seats"] == "17" and last["plan_price_monthly_usd"] == "248.5"
    assert last["ai_cost_usd"] == "10.375" and last["emails_sent"] == "41"
    assert "\r\n" in billing.statement_csv(_statement())


def test_a_cell_that_a_spreadsheet_could_read_as_a_formula_is_defanged():
    for text in ("=1+1", "+cmd", "-2", "@SUM(A1)"):
        assert billing._csv_cell(text) == "'" + text
    assert billing._csv_cell("Plain") == "Plain" and billing._csv_cell(12) == 12


class Cursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, length=None):
        return self.rows


async def test_the_statement_reads_three_grouped_aggregates_bounded_to_the_month(monkeypatch):
    calls = {}

    class Agg:
        def __init__(self, name, rows):
            self.name, self.rows = name, rows

        def aggregate(self, pipeline):
            calls[self.name] = pipeline
            return Cursor(self.rows)

    class FakeRaw:
        users = Agg("users", [{"_id": "cmp_a1", "seats": 4}])
        cost_ledger = Agg("cost_ledger", [{"_id": "cmp_a1", "cost": 1.5, "calls": 9}])
        email_log = Agg("email_log", [{"_id": "cmp_a1", "sent": 6}])

    async def directory(raw, client_id=None):
        return _clients()[:1], _companies()[:2]

    monkeypatch.setattr(billing.platform_service, "raw_db", lambda: FakeRaw())
    monkeypatch.setattr(billing.platform_service, "directory", directory)
    s = await billing.statement("cli_a", "2026-09")
    assert s["clients"][0]["lines"][0]["seats"] == 4 and s["clients"][0]["lines"][0]["emails_sent"] == 6
    assert s["clients"][0]["lines"][0]["ai_cost_usd"] == 1.5 and s["clients"][0]["lines"][0]["ai_calls"] == 9
    window = {"$gte": "2026-09-01T00:00:00+00:00", "$lt": "2026-10-01T00:00:00+00:00"}
    assert calls["cost_ledger"][0]["$match"]["created_at"] == window
    assert calls["email_log"][0]["$match"] == {"company_id": {"$in": ["cmp_a2", "cmp_a1"]}, "status": "sent", "created_at": window}
    users = calls["users"][0]["$match"]
    assert users["is_active"] == {"$ne": False} and {"created_at": {"$lt": "2026-10-01T00:00:00+00:00"}} in users["$or"]
    assert {"created_at": {"$exists": False}} in users["$or"]
    for name in ("users", "cost_ledger", "email_log"):
        assert calls[name][1]["$group"]["_id"] == "$company_id"


async def test_a_bad_month_is_a_422_and_an_unknown_client_a_404(monkeypatch):
    async def none(raw, client_id=None):
        return [], []

    monkeypatch.setattr(billing.platform_service, "raw_db", lambda: object())
    monkeypatch.setattr(billing.platform_service, "directory", none)
    with pytest.raises(platform_service.PlatformError) as bad:
        await billing.statement(None, "2026-13")
    assert bad.value.status == 422
    with pytest.raises(platform_service.PlatformError) as missing:
        await billing.statement("cli_nope", "2026-09")
    assert missing.value.status == 404
    empty = await billing.statement(None, "2026-09")
    assert empty["clients"] == [] and empty["totals"]["companies"] == 0


@pytest.fixture
def manual(monkeypatch):
    raw = Raw([client_row()])
    audit = AsyncMock()

    async def require_client(_raw, client_id):
        doc = next((c for c in raw.clients.docs if c["client_id"] == client_id), None)
        if doc is None:
            raise platform_service.PlatformError(404, "Client not found.")
        return copy.deepcopy(doc)

    monkeypatch.setattr(billing.platform_service, "raw_db", lambda: raw)
    monkeypatch.setattr(billing.platform_service, "require_client", require_client)
    monkeypatch.setattr(billing.platform_service, "client_row_for", AsyncMock(side_effect=lambda r, c: {"client_id": c["client_id"], "subscription": c.get("subscription"), "plan": c.get("plan")}))
    monkeypatch.setattr(billing.platform_service, "invalidate_console_cache", AsyncMock())
    monkeypatch.setattr(billing.workspace_service, "platform_audit", audit)
    return raw, audit


async def test_marking_a_client_active_by_hand_ends_its_trial_and_is_audited(manual):
    raw, audit = manual
    out = await billing.set_subscription(OWNER, "cli_1", {"status": "active"})
    assert out["client"]["subscription"]["status"] == "active" and out["client"]["plan"]["trial_ends_at"] is None
    assert audit.await_args.args[1] == "client_subscription_update" and audit.await_args.args[4]["status"] == "active"


async def test_a_trial_date_can_be_set_kept_or_cleared(manual):
    raw, _ = manual
    out = await billing.set_subscription(OWNER, "cli_1", {"status": "trialing", "trial_ends_at": "2026-12-31"})
    assert out["client"]["plan"]["trial_ends_at"] == "2026-12-31T23:59:59+00:00"
    kept = await billing.set_subscription(OWNER, "cli_1", {"status": "trialing"})
    assert kept["client"]["plan"]["trial_ends_at"] == "2026-12-31T23:59:59+00:00"
    cleared = await billing.set_subscription(OWNER, "cli_1", {"status": "none", "trial_ends_at": None})
    assert cleared["client"]["plan"]["trial_ends_at"] is None


async def test_a_bad_status_provider_or_date_is_a_422_and_changes_nothing(manual):
    raw, audit = manual
    for changes in ({"status": "paused"}, {"status": "active", "provider": "paypal"}, {"status": "trialing", "trial_ends_at": "soon"}, {}):
        with pytest.raises(platform_service.PlatformError) as bad:
            await billing.set_subscription(OWNER, "cli_1", changes)
        assert bad.value.status == 422
    assert raw.clients.updates == [] and audit.await_count == 0
    with pytest.raises(platform_service.PlatformError) as missing:
        await billing.set_subscription(OWNER, "cli_nope", {"status": "active"})
    assert missing.value.status == 404


async def test_a_hand_made_subscription_defaults_to_the_manual_provider(manual):
    raw, _ = manual
    await billing.set_subscription(OWNER, "cli_1", {"status": "past_due"})
    assert raw.clients.docs[0]["subscription"]["provider"] == "manual"
    await billing.set_subscription(OWNER, "cli_1", {"status": "active", "provider": "stripe"})
    assert raw.clients.docs[0]["subscription"]["provider"] == "stripe"
