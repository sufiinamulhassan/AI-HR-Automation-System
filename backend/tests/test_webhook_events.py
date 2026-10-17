import asyncio
import hashlib
import hmac
import json
import time
import types
import uuid

import pytest

from config.tenancy import DEFAULT_COMPANY_ID

import ops_store
from config.database import get_db
from config.settings import settings
from services.hr_module import notification_settings_service as ns
from services.hr_module import webhook_service

pytestmark = pytest.mark.anyio

URL = "https://hooks.example.test/in"


class FakeHttp:

    def __init__(self, script=None):
        self.script = list(script or [])
        self.by_url: dict[str, list] = {}
        self.posts: list[dict] = []

    async def request(self, method, url, *, content=None, headers=None, **kwargs):
        self.posts.append({"url": url, "content": content, "headers": headers or {}})
        queue = self.by_url.get(url) or self.script
        step = queue.pop(0) if queue else 200
        if step == "hang":
            await asyncio.sleep(30)
        if isinstance(step, Exception):
            raise step
        return types.SimpleNamespace(status_code=step)


@pytest.fixture
def http(monkeypatch):
    fake = FakeHttp()
    monkeypatch.setattr(webhook_service, "safe_request", fake.request)
    monkeypatch.setattr(webhook_service, "is_url_ssrf_safe", lambda url: True)
    from routes import webhooks as webhook_routes
    monkeypatch.setattr(webhook_routes, "is_url_ssrf_safe", lambda url: True)
    return fake


@pytest.fixture
def ops(monkeypatch):
    return ops_store.install(monkeypatch)


@pytest.fixture
async def subs():
    ids: list[str] = []

    async def _make(events, **fields):
        doc = {
            "webhook_id": f"wh-ev-{uuid.uuid4().hex[:8]}", "url": URL, "event_types": list(events),
            "secret": None, "is_active": True, "format": "raw",
            "created_by": "tester@hirely.ai", "created_at": "2026-01-01T00:00:00+00:00",
        }
        doc.update(fields)
        await get_db().webhook_subscriptions.insert_one(dict(doc))
        ids.append(doc["webhook_id"])
        return doc

    yield _make
    await get_db().webhook_subscriptions.delete_many({"webhook_id": {"$in": ids}})


@pytest.fixture
def alerts(monkeypatch):
    calls: list[tuple[str, dict]] = []

    async def fake_notify(event, context=None):
        calls.append((event, dict(context or {})))
        return True

    monkeypatch.setattr(ns, "notify", fake_notify)
    return calls


def _rows(ops, webhook_id):
    return [d for d in ops.webhook_deliveries.docs if d["webhook_id"] == webhook_id]


async def test_event_types_lists_the_catalog(client, admin_headers):
    response = await client.get("/api/v1/webhooks/event-types", headers=admin_headers)
    assert response.status_code == 200
    listed = response.json()["event_types"]
    assert all(set(e) == {"key", "label"} and e["label"] for e in listed)
    keys = {e["key"] for e in listed}
    assert {
        "candidate.invited", "candidate.status_changed", "candidate.hired", "candidate.rejected",
        "interview.completed", "interview.external_scheduled", "scorecard.submitted",
        "offer.created", "offer.sent", "offer.accepted", "offer.declined", "job.created",
    } <= keys
    assert "*" not in keys


async def test_event_types_needs_an_admin_and_is_not_read_as_an_id(client, standard_headers, admin_headers):
    assert (await client.get("/api/v1/webhooks/event-types", headers=standard_headers)).status_code == 403
    assert (await client.get("/api/v1/webhooks/event-types", headers=admin_headers)).status_code == 200


async def test_an_unknown_event_type_is_a_422_with_a_string_detail(client, admin_headers, http):
    response = await client.post(
        "/api/v1/webhooks",
        json={"url": URL, "event_types": ["candidate.invited", "made.up", "also.fake", "made.up"]},
        headers=admin_headers,
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "Unknown event type(s): made.up, also.fake"
    assert await get_db().webhook_subscriptions.count_documents({"event_types": "made.up"}) == 0


async def test_catalog_names_and_the_wildcard_are_accepted(client, admin_headers, http):
    created = []
    try:
        for events in (["candidate.invited"], ["*"], ["offer.sent", "job.created", "*"], []):
            response = await client.post(
                "/api/v1/webhooks", json={"url": URL, "event_types": events}, headers=admin_headers,
            )
            assert response.status_code == 200, (events, response.text)
            created.append(response.json()["webhook_id"])
    finally:
        await get_db().webhook_subscriptions.delete_many({"webhook_id": {"$in": created}})


async def test_updating_validates_event_types_but_leaves_other_edits_alone(client, admin_headers, subs, http):
    legacy = await subs(["resume_processed", "candidate.invited"])
    ok = await client.patch(f"/api/v1/webhooks/{legacy['webhook_id']}", json={"is_active": False}, headers=admin_headers)
    assert ok.status_code == 200
    assert ok.json()["event_types"] == ["resume_processed", "candidate.invited"]

    bad = await client.patch(
        f"/api/v1/webhooks/{legacy['webhook_id']}",
        json={"event_types": ["resume_processed", "candidate.invited"]}, headers=admin_headers,
    )
    assert bad.status_code == 422
    assert bad.json()["detail"] == "Unknown event type(s): resume_processed"

    fixed = await client.patch(
        f"/api/v1/webhooks/{legacy['webhook_id']}", json={"event_types": ["candidate.invited"]}, headers=admin_headers,
    )
    assert fixed.status_code == 200 and fixed.json()["event_types"] == ["candidate.invited"]


async def test_a_legacy_free_text_name_keeps_delivering(ops, http, subs):
    name = f"legacy.event.{uuid.uuid4().hex[:6]}"
    sub = await subs([name])
    await webhook_service.fire_webhook_event(name, {"candidate_id": "abc"})
    assert len(http.posts) == 1 and http.posts[0]["url"] == URL
    assert [r["status"] for r in _rows(ops, sub["webhook_id"])] == ["sent"]


async def test_emit_event_reaches_matching_and_wildcard_subscribers_only(ops, http, subs):
    hired = await subs(["candidate.hired"])
    wildcard = await subs(["*"])
    other = await subs(["candidate.invited"])
    inactive = await subs(["candidate.hired"], is_active=False)

    await webhook_service.emit_event("candidate.hired", {"candidate_id": "c1", "candidate_name": "Asha", "stage": "hired"})

    assert len(http.posts) == 2
    assert len(_rows(ops, hired["webhook_id"])) == 1 and len(_rows(ops, wildcard["webhook_id"])) == 1
    assert _rows(ops, other["webhook_id"]) == [] and _rows(ops, inactive["webhook_id"]) == []
    body = json.loads(http.posts[0]["content"])
    assert body["event"] == "candidate.hired" and body["occurred_at"]
    assert body["candidate_id"] == "c1" and body["stage"] == "hired"
    assert http.posts[0]["headers"]["X-Webhook-Event"] == "candidate.hired"
    assert http.posts[0]["headers"]["X-Webhook-Delivery"]


async def test_emit_event_signs_with_the_subscription_secret_and_never_logs_it(ops, http, subs):
    secret = f"whsec-{uuid.uuid4().hex}"
    sub = await subs(["offer.sent"], secret=secret)
    await webhook_service.emit_event("offer.sent", {"offer_id": "o1"})
    post = http.posts[0]
    assert post["headers"]["X-Webhook-Signature"] == hmac.new(secret.encode(), post["content"], hashlib.sha256).hexdigest()
    assert secret not in json.dumps(_rows(ops, sub["webhook_id"]), default=str)


async def test_emit_event_with_no_subscribers_does_nothing(ops, http):
    await webhook_service.emit_event("job.created", {"job_id": "j1"})
    assert http.posts == [] and ops.webhook_deliveries.docs == []


async def test_emit_event_swallows_every_failure(monkeypatch, http):
    def boom():
        raise RuntimeError("database exploded")

    monkeypatch.setattr(webhook_service, "get_db", boom)
    await webhook_service.emit_event("job.created", {"job_id": "j1"})


async def test_slack_format_subscriptions_get_a_text_summary(ops, http, subs):
    await subs(["candidate.hired"], format="slack")
    await webhook_service.emit_event("candidate.hired", {"candidate_name": "Asha", "job_id": "j7"})
    body = json.loads(http.posts[0]["content"])
    assert set(body) == {"text"} and "candidate.hired" in body["text"] and "Asha" in body["text"]


async def test_a_delivery_row_records_what_happened(ops, http, subs):
    sub = await subs(["job.created"])
    http.script = [200]
    await webhook_service.emit_event("job.created", {"job_id": "j1"})
    row = _rows(ops, sub["webhook_id"])[0]
    assert row["status"] == "sent" and row["http_status"] == 200 and row["error"] is None
    assert row["event"] == "job.created" and row["attempts"] == 1
    assert isinstance(row["duration_ms"], int) and row["delivery_id"] and row["created_at"]
    assert http.posts[0]["headers"]["X-Webhook-Delivery"] == row["delivery_id"]


async def test_a_5xx_is_retried_once_and_a_later_success_is_a_sent_row(ops, http, subs):
    sub = await subs(["job.created"])
    http.script = [503, 200]
    await webhook_service.emit_event("job.created", {"job_id": "j1"})
    row = _rows(ops, sub["webhook_id"])[0]
    assert len(http.posts) == 2
    assert row["status"] == "sent" and row["http_status"] == 200 and row["attempts"] == 2


async def test_two_5xx_answers_are_a_failed_row_after_exactly_one_retry(ops, http, subs):
    sub = await subs(["job.created"])
    http.script = [503, 502, 200]
    await webhook_service.emit_event("job.created", {"job_id": "j1"})
    row = _rows(ops, sub["webhook_id"])[0]
    assert len(http.posts) == 2
    assert row["status"] == "failed" and row["http_status"] == 502 and row["error"] == "HTTP 502"


async def test_a_timeout_is_retried_once(ops, http, subs):
    sub = await subs(["job.created"])
    http.script = [asyncio.TimeoutError(), 200]
    await webhook_service.emit_event("job.created", {"job_id": "j1"})
    row = _rows(ops, sub["webhook_id"])[0]
    assert len(http.posts) == 2 and row["status"] == "sent" and row["attempts"] == 2


async def test_a_4xx_is_not_retried(ops, http, subs):
    sub = await subs(["job.created"])
    http.script = [404, 200]
    await webhook_service.emit_event("job.created", {"job_id": "j1"})
    row = _rows(ops, sub["webhook_id"])[0]
    assert len(http.posts) == 1
    assert row["status"] == "failed" and row["http_status"] == 404 and row["attempts"] == 1


async def test_a_target_that_never_answers_ends_inside_the_budget(ops, http, subs, monkeypatch):
    monkeypatch.setattr(webhook_service, "EMIT_BUDGET_SECONDS", 0.8)
    monkeypatch.setattr(webhook_service, "_EMIT_DELIVERY_DEADLINE_SECONDS", 0.4)
    monkeypatch.setattr(webhook_service, "_ATTEMPT_TIMEOUT_SECONDS", 0.2)
    sub = await subs(["job.created"])
    http.script = ["hang", "hang"]
    started = time.monotonic()
    await webhook_service.emit_event("job.created", {"job_id": "j1"})
    assert time.monotonic() - started < 1.5
    row = _rows(ops, sub["webhook_id"])[0]
    assert row["status"] == "failed" and row["http_status"] is None
    assert "in time" in row["error"]


async def test_the_real_budget_is_four_seconds():
    assert webhook_service.EMIT_BUDGET_SECONDS == 4.0


async def test_a_failure_raises_the_webhook_alert_once_per_webhook(ops, http, subs, alerts):
    first = await subs(["job.created"], url="https://hooks.example.test/a/path?token=abc123")
    second = await subs(["*"], url="https://hooks.example.test/b")
    third = await subs(["job.created"], url="https://hooks.example.test/c")
    http.by_url = {first["url"]: [404], second["url"]: [404], third["url"]: [200]}
    await webhook_service.emit_event("job.created", {"job_id": "j1"})
    assert [a[0] for a in alerts] == ["webhook_delivery_failed"] * 2
    contexts = {c["webhook_id"]: c for _, c in alerts}
    assert set(contexts) == {first["webhook_id"], second["webhook_id"]}
    for context in contexts.values():
        assert context["webhook_host"] == "hooks.example.test"
        assert context["webhook_event"] == "job.created" and context["detail"] == "HTTP 404"
        assert "abc123" not in json.dumps(context)
    assert third["webhook_id"] not in contexts


async def test_a_successful_delivery_raises_no_alert(ops, http, subs, alerts):
    await subs(["job.created"])
    await webhook_service.emit_event("job.created", {"job_id": "j1"})
    assert alerts == []


async def test_the_logged_error_is_scrubbed(ops, http, subs, monkeypatch):
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-ant-leaky-key-987654")
    secret = "whsec-should-not-leak-123456"
    sub = await subs(["job.created"], secret=secret)
    leaky = RuntimeError(f"connect failed to https://user:pw@hooks.example.test/in?key=zzz using {secret} and sk-ant-leaky-key-987654")
    http.script = [leaky, leaky]
    await webhook_service.emit_event("job.created", {"job_id": "j1"})
    row = _rows(ops, sub["webhook_id"])[0]
    assert row["status"] == "failed"
    for leak in (secret, "sk-ant-leaky-key-987654", "user:pw", "key=zzz"):
        assert leak not in row["error"]


async def test_a_target_that_is_not_a_public_address_is_refused_and_not_retried(ops, http, subs):
    from shared.safe_http import UnsafeTarget

    sub = await subs(["job.created"], url="http://169.254.169.254/latest")
    http.script = [UnsafeTarget("The address points to a private or reserved network."), 200]
    await webhook_service.emit_event("job.created", {"job_id": "j1"})
    assert len(http.posts) == 1, "a refused target is not tried again"
    row = _rows(ops, sub["webhook_id"])[0]
    assert row["status"] == "failed" and "public address" in row["error"] and row["attempts"] == 0


async def test_deliveries_are_listed_newest_first_with_a_hard_cap(client, admin_headers, ops, subs):
    sub = await subs(["job.created"])
    for i in range(120):
        await ops.webhook_deliveries.insert_one({
            "delivery_id": f"d{i:03d}", "webhook_id": sub["webhook_id"], "event": "job.created",
            "company_id": DEFAULT_COMPANY_ID, "status": "sent", "http_status": 200, "duration_ms": 5, "error": None,
            "created_at": f"2026-01-01T00:{i // 60:02d}:{i % 60:02d}+00:00",
        })
    default = await client.get(f"/api/v1/webhooks/{sub['webhook_id']}/deliveries", headers=admin_headers)
    assert default.status_code == 200
    rows = default.json()["deliveries"]
    assert len(rows) == 50 and rows[0]["delivery_id"] == "d119" and rows[1]["delivery_id"] == "d118"
    assert set(rows[0]) >= {"delivery_id", "webhook_id", "event", "status", "http_status", "duration_ms", "error", "created_at"}
    assert "expires_at" not in rows[0] and "_id" not in rows[0] and "secret" not in rows[0]

    assert len((await client.get(f"/api/v1/webhooks/{sub['webhook_id']}/deliveries?limit=3", headers=admin_headers)).json()["deliveries"]) == 3
    assert len((await client.get(f"/api/v1/webhooks/{sub['webhook_id']}/deliveries?limit=500", headers=admin_headers)).json()["deliveries"]) == 100
    assert len((await client.get(f"/api/v1/webhooks/{sub['webhook_id']}/deliveries?limit=0", headers=admin_headers)).json()["deliveries"]) == 1


async def test_deliveries_need_an_admin_and_a_real_webhook(client, admin_headers, standard_headers, ops, subs):
    sub = await subs(["job.created"])
    assert (await client.get(f"/api/v1/webhooks/{sub['webhook_id']}/deliveries", headers=standard_headers)).status_code == 403
    assert (await client.get("/api/v1/webhooks/nope/deliveries", headers=admin_headers)).status_code == 404


async def test_the_ping_reports_delivered_status_and_detail(client, admin_headers, ops, http, subs, alerts):
    sub = await subs(["job.created"])
    http.script = [204]
    response = await client.post(f"/api/v1/webhooks/{sub['webhook_id']}/test", headers=admin_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["delivered"] is True and body["http_status"] == 204 and "204" in body["detail"]
    assert body["success"] is True and body["status_code"] == 204
    row = _rows(ops, sub["webhook_id"])[0]
    assert row["event"] == "ping" and row["status"] == "sent"
    assert json.loads(http.posts[0]["content"])["event"] == "ping"
    assert http.posts[0]["headers"]["X-Webhook-Event"] == "ping"


async def test_a_failing_ping_is_reported_once_with_no_retry_and_no_alert(client, admin_headers, ops, http, subs, alerts):
    sub = await subs(["job.created"])
    http.script = [500, 200]
    body = (await client.post(f"/api/v1/webhooks/{sub['webhook_id']}/test", headers=admin_headers)).json()
    assert body["delivered"] is False and body["http_status"] == 500 and "500" in body["detail"]
    assert body["success"] is False and body["error"]
    assert len(http.posts) == 1
    assert alerts == []

    http.script = [ConnectionError("refused")]
    unreachable = (await client.post(f"/api/v1/webhooks/{sub['webhook_id']}/test", headers=admin_headers)).json()
    assert unreachable["delivered"] is False and unreachable["http_status"] is None
    assert isinstance(unreachable["detail"], str) and unreachable["detail"]


async def test_ping_needs_an_admin_and_a_real_webhook(client, admin_headers, standard_headers, ops, http, subs):
    sub = await subs(["job.created"])
    assert (await client.post(f"/api/v1/webhooks/{sub['webhook_id']}/test", headers=standard_headers)).status_code == 403
    assert (await client.post("/api/v1/webhooks/nope/test", headers=admin_headers)).status_code == 404
    assert http.posts == []


async def test_the_ping_is_audited(client, admin_headers, ops, http, subs):
    sub = await subs(["job.created"])
    await client.post(f"/api/v1/webhooks/{sub['webhook_id']}/test", headers=admin_headers)
    entry = await get_db().audit_log.find_one({"action": "webhook_tested", "resource_id": sub["webhook_id"]})
    assert entry is not None and entry["details"]["delivered"] is True
    await get_db().audit_log.delete_many({"resource_id": sub["webhook_id"]})
