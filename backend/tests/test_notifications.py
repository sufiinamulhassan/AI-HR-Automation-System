import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest

import ops_store
from config.database import get_db
from config.settings import settings
from services.hr_module import email_service, notification_settings_service as ns

pytestmark = pytest.mark.anyio

ADDRESS = "alerts@example.com"


@pytest.fixture
async def configured(monkeypatch):
    ops_store.install(monkeypatch)
    db = get_db()

    async def _set(notify_email=ADDRESS, **events):
        enabled = {name: False for name in ns._EVENT_COPY}
        enabled.update(events)
        await db.notification_settings.replace_one(
            {"_id": ns.SINGLETON_ID},
            {"_id": ns.SINGLETON_ID, "notify_email": notify_email, "events": enabled},
            upsert=True,
        )

    await _set()
    return _set


@pytest.fixture
def mail(monkeypatch):
    state = {"sent": [], "result": True, "raise": None, "delay": 0}

    async def fake_send_email(**kwargs):
        if state["delay"]:
            await asyncio.sleep(state["delay"])
        if state["raise"]:
            raise state["raise"]
        state["sent"].append(kwargs)
        return state["result"]

    monkeypatch.setattr(email_service, "send_email", fake_send_email)
    return state


async def test_an_event_that_is_switched_off_sends_nothing(configured, mail):
    assert await ns.notify("offer_declined", {"offer_id": "o1"}) is False
    assert mail["sent"] == []


async def test_an_enabled_event_emails_the_configured_address(configured, mail):
    await configured(offer_declined=True)
    sent = await ns.notify("offer_declined", {
        "offer_id": "o1", "candidate_id": "c1", "candidate_name": "Asha Rao",
        "job_id": "j1", "job_title": "Backend Engineer",
    })
    assert sent is True
    assert len(mail["sent"]) == 1
    message = mail["sent"][0]
    assert message["to"] == ADDRESS
    assert message["template"] == ns.NOTIFICATION_TEMPLATE
    body = message["text_body"]
    for expected in ("offer_declined", "Asha Rao (c1)", "Backend Engineer (j1)", "o1"):
        assert expected in body
    assert "declined" in message["subject"].lower()


async def test_no_address_or_unknown_event_sends_nothing(configured, mail):
    await configured(notify_email="", offer_declined=True)
    assert await ns.notify("offer_declined", {"offer_id": "o1"}) is False
    await configured(offer_declined=True)
    assert await ns.notify("not_an_event", {}) is False
    assert mail["sent"] == []


async def test_a_comma_separated_address_list_reaches_everyone(configured, mail):
    await configured(notify_email="a@example.com, b@example.com", job_import_failed=True)
    assert await ns.notify("job_import_failed", {"source": "remotive"}) is True
    assert sorted(m["to"] for m in mail["sent"]) == ["a@example.com", "b@example.com"]


async def test_the_same_event_and_reference_is_sent_once_an_hour(configured, mail):
    await configured(offer_declined=True)
    assert await ns.notify("offer_declined", {"offer_id": "same"}) is True
    assert await ns.notify("offer_declined", {"offer_id": "same"}) is False
    assert len(mail["sent"]) == 1
    assert await ns.notify("offer_declined", {"offer_id": "other"}) is True
    assert len(mail["sent"]) == 2


async def test_the_throttle_lapses_after_an_hour(configured, mail):
    db = get_db()
    await configured(offer_declined=True)
    assert await ns.notify("offer_declined", {"offer_id": "aged"}) is True
    stale = datetime.now(timezone.utc) - timedelta(seconds=ns.THROTTLE_SECONDS + 5)
    await db.notification_log.update_one({"_id": "offer_declined:aged"}, {"$set": {"sent_at": stale}})
    assert await ns.notify("offer_declined", {"offer_id": "aged"}) is True
    assert len(mail["sent"]) == 2


async def test_the_reference_override_keys_the_throttle(configured, mail):
    await configured(coding_submission_execution_failed=True)
    first = {"candidate_id": "c1", "reference": "c1:q1"}
    assert await ns.notify("coding_submission_execution_failed", first) is True
    assert await ns.notify("coding_submission_execution_failed", {**first, "reference": "c1:q2"}) is True
    assert await ns.notify("coding_submission_execution_failed", first) is False


async def test_concurrent_calls_for_one_alert_send_one_email(configured, mail):
    await configured(offer_declined=True)
    results = await asyncio.gather(*(ns.notify("offer_declined", {"offer_id": "race"}) for _ in range(5)))
    assert results.count(True) == 1
    assert len(mail["sent"]) == 1


async def test_a_failing_mail_transport_never_raises_and_gives_the_alert_another_chance(configured, mail):
    await configured(offer_declined=True)
    mail["raise"] = RuntimeError("smtp is down")
    assert await ns.notify("offer_declined", {"offer_id": "retry"}) is False
    mail["raise"] = None
    mail["result"] = False
    assert await ns.notify("offer_declined", {"offer_id": "retry"}) is False
    mail["result"] = True
    assert await ns.notify("offer_declined", {"offer_id": "retry"}) is True


async def test_a_slow_mail_host_is_cut_off_by_the_timeout(configured, mail, monkeypatch):
    await configured(offer_declined=True)
    monkeypatch.setattr(ns, "NOTIFY_TIMEOUT_SECONDS", 0.2)
    mail["delay"] = 5
    started = asyncio.get_event_loop().time()
    assert await ns.notify("offer_declined", {"offer_id": "slow"}) is False
    assert asyncio.get_event_loop().time() - started < 2
    assert mail["sent"] == []


async def test_the_message_names_things_and_never_carries_a_score(configured, mail):
    await configured(candidate_flagged_for_integrity=True)
    await ns.notify("candidate_flagged_for_integrity", {
        "candidate_id": "c9", "candidate_name": "Dev Patel", "job_id": "j9",
        "reasons": ["low_integrity_score", "phone_detected"],
        "score": 8731, "integrity_score": 8731, "report": "Strong on systems, weak on testing",
        "email": "dev@example.com", "detail": "ok",
    })
    message = mail["sent"][0]
    for part in (message["text_body"], message["html_body"], message["subject"]):
        assert "8731" not in part
        assert "Strong on systems" not in part
        assert "dev@example.com" not in part
    assert "low integrity score, phone detected" in message["text_body"]
    assert "Dev Patel (c9)" in message["text_body"]


async def test_a_detail_never_echoes_a_secret_or_a_url_query(configured, mail, monkeypatch):
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-ant-secret-value-123456")
    await configured(job_import_failed=True)
    await ns.notify("job_import_failed", {
        "source": "linkedin",
        "detail": "Request to https://api.example.com/jobs?api_key=abc123 failed with key sk-ant-secret-value-123456",
    })
    text = mail["sent"][0]["text_body"]
    assert "sk-ant-secret-value-123456" not in text
    assert "api_key" not in text and "abc123" not in text


async def test_names_are_looked_up_only_when_an_alert_goes_out(configured, mail):
    db = get_db()
    cid, jid = f"c-ns-{uuid.uuid4().hex[:6]}", f"j-ns-{uuid.uuid4().hex[:6]}"
    await db.candidates.insert_one({"candidate_id": cid, "name": "Looked Up", "job_id": jid})
    await db.jobs.insert_one({"job_id": jid, "title": "Platform Engineer"})
    try:
        await configured(offer_declined=True)
        await ns.notify("offer_declined", {"offer_id": "o-enrich", "candidate_id": cid})
        text = mail["sent"][0]["text_body"]
        assert f"Looked Up ({cid})" in text and f"Platform Engineer ({jid})" in text
    finally:
        await db.candidates.delete_one({"candidate_id": cid})
        await db.jobs.delete_one({"job_id": jid})


async def test_notify_survives_a_missing_database(monkeypatch, mail):
    monkeypatch.setattr(ns, "get_db", lambda: None)
    assert await ns.notify("offer_declined", {"offer_id": "x"}) is False


async def test_integrity_reasons():
    assert ns.integrity_alert_reasons([]) == []
    assert ns.integrity_alert_reasons(["tab_switch@t", "tab_switch@t"]) == []
    assert ns.integrity_alert_reasons(["tab_switch@t"] * 4) == ["low_integrity_score"]
    assert ns.integrity_alert_reasons(["phone_detected@t"]) == ["phone_detected"]
    assert ns.integrity_alert_reasons(["identity_mismatch@t"]) == ["identity_mismatch"]
    assert ns.integrity_alert_reasons(["identity_mismatch@t", "phone_detected@t", "tab_switch@t"]) == [
        "low_integrity_score", "identity_mismatch", "phone_detected",
    ]


@pytest.fixture
async def fresh_limit():
    db = get_db()
    await db.rate_limits.delete_many({"_id": {"$regex": "^notification_test:"}})
    yield
    await db.rate_limits.delete_many({"_id": {"$regex": "^notification_test:"}})


async def test_test_notification_needs_an_admin(client, standard_headers):
    response = await client.post("/api/v1/notification-settings/test", headers=standard_headers)
    assert response.status_code == 403


async def test_test_notification_without_an_address(client, admin_headers, configured, fresh_limit, mail):
    await configured(notify_email="")
    response = await client.post("/api/v1/notification-settings/test", headers=admin_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["sent"] is False and body["to"] is None
    assert isinstance(body["detail"], str) and body["detail"]
    assert mail["sent"] == []


async def test_test_notification_without_a_mail_provider_sends_nothing(
    client, admin_headers, configured, fresh_limit, mail, monkeypatch,
):
    from services.hr_module import email_delivery_service
    monkeypatch.setattr(email_delivery_service, "current_provider", lambda: None)
    response = await client.post("/api/v1/notification-settings/test", headers=admin_headers)
    body = response.json()
    assert body["sent"] is False and body["to"] == ADDRESS
    assert "Nothing was sent" in body["detail"]
    assert mail["sent"] == []


async def test_test_notification_sends_whatever_events_are_on(
    client, admin_headers, configured, fresh_limit, mail, monkeypatch,
):
    from services.hr_module import email_delivery_service
    monkeypatch.setattr(email_delivery_service, "current_provider", lambda: "smtp")
    response = await client.post("/api/v1/notification-settings/test", headers=admin_headers)
    assert response.status_code == 200
    body = response.json()
    assert body == {"sent": True, "to": ADDRESS, "detail": body["detail"]}
    assert [m["to"] for m in mail["sent"]] == [ADDRESS]

    mail["result"] = False
    failed = (await client.post("/api/v1/notification-settings/test", headers=admin_headers)).json()
    assert failed["sent"] is False and failed["to"] == ADDRESS


async def test_test_notification_is_rate_limited_and_audited(
    client, admin_headers, configured, fresh_limit, mail, monkeypatch,
):
    from services.hr_module import email_delivery_service
    monkeypatch.setattr(email_delivery_service, "current_provider", lambda: "smtp")
    db = get_db()
    started = datetime.now(timezone.utc).isoformat()
    for _ in range(5):
        assert (await client.post("/api/v1/notification-settings/test", headers=admin_headers)).status_code == 200
    limited = await client.post("/api/v1/notification-settings/test", headers=admin_headers)
    assert limited.status_code == 429
    assert isinstance(limited.json()["detail"], str)
    rows = await db.audit_log.count_documents({"action": "notification_test_send", "created_at": {"$gte": started}})
    assert rows == 5


@pytest.fixture
def alerts(monkeypatch):
    calls: list[tuple[str, dict]] = []

    async def fake_notify(event, context=None):
        calls.append((event, dict(context or {})))
        return True

    monkeypatch.setattr(ns, "notify", fake_notify)
    import routes.interview as interview_routes
    monkeypatch.setattr(interview_routes, "notify", fake_notify)
    return calls


async def test_declining_an_offer_raises_the_offer_declined_alert(alerts):
    from services.hr_module import offer_service

    db = get_db()
    token = f"tok_{uuid.uuid4().hex[:12]}"
    offer_id = f"offer-ns-{uuid.uuid4().hex[:6]}"
    await db.offers.insert_one({
        "doc_type": "offer", "offer_id": offer_id, "candidate_id": "cand-ns", "job_id": "job-ns",
        "status": "sent", "secure_token": token, "salary": "100", "created_at": "2026-01-01T00:00:00+00:00",
    })
    try:
        await offer_service.respond_to_offer(token, False, "found another role")
        assert alerts == [("offer_declined", {"offer_id": offer_id, "candidate_id": "cand-ns", "job_id": "job-ns"})]
        assert "found another role" not in str(alerts)
    finally:
        await db.offers.delete_one({"offer_id": offer_id})


async def test_accepting_an_offer_raises_no_alert(alerts):
    from services.hr_module import offer_service

    db = get_db()
    token = f"tok_{uuid.uuid4().hex[:12]}"
    offer_id = f"offer-ns-{uuid.uuid4().hex[:6]}"
    await db.offers.insert_one({
        "doc_type": "offer", "offer_id": offer_id, "candidate_id": "cand-ns2", "job_id": "job-ns",
        "status": "sent", "secure_token": token, "salary": "100", "created_at": "2026-01-01T00:00:00+00:00",
    })
    try:
        await offer_service.respond_to_offer(token, True, None, typed_name="A Person", consent=True)
        assert alerts == []
    finally:
        await db.offers.delete_one({"offer_id": offer_id})
        await db.employees.delete_many({"offer_id": offer_id})


async def _interview_candidate(**fields) -> dict:
    db = get_db()
    doc = {
        "doc_type": "candidate", "candidate_id": f"cand-int-{uuid.uuid4().hex[:8]}",
        "job_id": "job-int", "name": "Interview Person", "email": "int@example.com",
        "secure_token": f"tok_{uuid.uuid4().hex[:12]}", "token_status": "active",
        "status": "interviewing", "invite_sent_at": datetime.now(timezone.utc).isoformat(),
        "integrity_flags": [],
    }
    doc.update(fields)
    await db.candidates.insert_one(doc)
    return doc


async def test_submitting_an_interview_with_a_risky_flag_raises_the_integrity_alert(client, alerts):
    cand = await _interview_candidate()
    try:
        response = await client.post(
            f"/api/v1/interview/session/{cand['secure_token']}/submit",
            json={"transcript": [], "flags": ["identity_mismatch@2026-01-01T00:00:00"]},
        )
        assert response.status_code == 200
        assert len(alerts) == 1
        event, context = alerts[0]
        assert event == "candidate_flagged_for_integrity"
        assert context["candidate_id"] == cand["candidate_id"]
        assert context["candidate_name"] == "Interview Person"
        assert context["reasons"] == ["identity_mismatch"]
        assert "score" not in context
    finally:
        await get_db().candidates.delete_one({"candidate_id": cand["candidate_id"]})


async def test_flags_pushed_during_the_session_count_at_submit(client, alerts):
    cand = await _interview_candidate(integrity_flags=["tab_switch@t"] * 4)
    try:
        response = await client.post(
            f"/api/v1/interview/session/{cand['secure_token']}/submit", json={"transcript": [], "flags": []},
        )
        assert response.status_code == 200
        assert [a[0] for a in alerts] == ["candidate_flagged_for_integrity"]
        assert alerts[0][1]["reasons"] == ["low_integrity_score"]
    finally:
        await get_db().candidates.delete_one({"candidate_id": cand["candidate_id"]})


async def test_a_clean_interview_raises_no_alert(client, alerts):
    cand = await _interview_candidate()
    try:
        response = await client.post(
            f"/api/v1/interview/session/{cand['secure_token']}/submit",
            json={"transcript": [], "flags": ["tab_switch@t"]},
        )
        assert response.status_code == 200
        assert alerts == []
    finally:
        await get_db().candidates.delete_one({"candidate_id": cand["candidate_id"]})


async def test_a_failed_job_import_raises_the_alert_for_a_real_source(client, admin_headers, alerts, monkeypatch):
    from services.hr_module import job_sources

    async def boom(*args, **kwargs):
        raise job_sources.JobSourceError("Remotive request failed: connection reset")

    monkeypatch.setattr(job_sources, "fetch_jobs", boom)
    response = await client.post("/api/v1/jobs/import", json={"source": "remotive"}, headers=admin_headers)
    assert response.status_code == 400
    assert alerts == [("job_import_failed", {"source": "remotive", "detail": "Remotive request failed: connection reset"})]


async def test_an_unknown_job_source_is_a_typo_not_an_alert(client, admin_headers, alerts):
    response = await client.post("/api/v1/jobs/import", json={"source": "no-such-board"}, headers=admin_headers)
    assert response.status_code == 400
    assert alerts == []


async def test_the_scheduled_sync_raises_one_alert_per_failing_source(alerts, monkeypatch):
    from services.hr_module import scheduler

    monkeypatch.setattr(scheduler, "list_sources", lambda: [
        {"id": "remotive", "configured": True}, {"id": "jobicy", "configured": True},
    ])

    async def fetch(source_id, *args, **kwargs):
        if source_id == "remotive":
            raise scheduler.JobSourceError("Remotive request failed: timeout")
        return []

    monkeypatch.setattr(scheduler, "fetch_jobs", fetch)
    summary = await scheduler.sync_all_sources()
    assert [s["error"] is not None for s in summary["sources"]] == [True, False]
    assert alerts == [("job_import_failed", {"source": "remotive", "detail": "Remotive request failed: timeout"})]


async def test_a_submission_where_nothing_could_run_raises_the_coding_alert(alerts, monkeypatch):
    from services.hr_module import coding_service as cs

    db = get_db()
    qid, cid = f"q-ns-{uuid.uuid4().hex[:6]}", f"c-ns-{uuid.uuid4().hex[:6]}"
    await db.coding_questions.insert_one({
        "question_id": qid, "title": "Sum two numbers", "description": "d",
        "language_templates": {"python": "pass"},
        "test_cases": [{"input": "1 2", "expected_output": "3", "is_hidden": False}],
    })

    async def sandbox_down(*args, **kwargs):
        raise RuntimeError("sandbox unreachable")

    async def nothing(*args, **kwargs):
        return None

    monkeypatch.setattr(settings, "JUDGE0_API_URL", "http://judge0.test")
    monkeypatch.setattr(settings, "CODE_SANDBOX_PROVIDER", "judge0")
    monkeypatch.setattr(cs, "run_in_sandbox", sandbox_down)
    monkeypatch.setattr(cs, "evaluate_code_quality", nothing)
    monkeypatch.setattr(cs, "evaluate_output_correctness", nothing)
    try:
        submission = await cs.evaluate_submission(qid, cid, "python", "print(3)")
        assert submission["status"] == "execution_error"
        assert alerts == [(
            "coding_submission_execution_failed",
            {
                "candidate_id": cid, "question_id": qid, "question_title": "Sum two numbers",
                "detail": "No test case could be run in the code sandbox.", "reference": f"{cid}:{qid}",
            },
        )]
    finally:
        await db.coding_questions.delete_one({"question_id": qid})
        await db.coding_submissions.delete_many({"question_id": qid})
        await db.candidates.delete_many({"candidate_id": cid})
