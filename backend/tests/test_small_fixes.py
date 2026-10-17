import uuid
from datetime import datetime, timedelta, timezone

import pytest

from config.database import get_db
from services.hr_module import email_delivery_service, email_service
from services.hr_module.email_template_service import TEMPLATE_KEYS

pytestmark = pytest.mark.anyio


def _iso(minutes_ago: float = 0.0) -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat()


@pytest.fixture
async def scenario_ids():
    ids: list[str] = []
    yield ids
    await get_db().scenarios.delete_many({"scenario_id": {"$in": ids}})
    await get_db().audit_log.delete_many({"resource_id": {"$in": ids}})


async def _make_scenario(client, headers, ids, domain="software_engineering") -> str:
    response = await client.post(
        "/api/v1/scenarios", json={"name": f"Clear test {uuid.uuid4().hex[:6]}", "prompt": "A production outage.", "job_domain": domain},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    ids.append(response.json()["scenario_id"])
    return response.json()["scenario_id"]


async def _domain(db_name, key, value):
    doc = await getattr(get_db(), db_name).find_one({key: value}, {"_id": 0})
    return doc.get("job_domain", "<absent>")


@pytest.mark.parametrize("cleared_with", [None, "", "   "])
async def test_a_scenario_domain_is_cleared_by_null_or_blank(client, admin_headers, scenario_ids, cleared_with):
    sid = await _make_scenario(client, admin_headers, scenario_ids)
    response = await client.patch(f"/api/v1/scenarios/{sid}", json={"job_domain": cleared_with}, headers=admin_headers)
    assert response.status_code == 200
    assert await _domain("scenarios", "scenario_id", sid) is None
    fetched = (await client.get(f"/api/v1/scenarios/{sid}", headers=admin_headers)).json()
    assert fetched["job_domain"] is None


async def test_an_omitted_scenario_domain_is_kept_and_a_new_one_replaces_it(client, admin_headers, scenario_ids):
    sid = await _make_scenario(client, admin_headers, scenario_ids)
    await client.patch(f"/api/v1/scenarios/{sid}", json={"name": "Renamed only"}, headers=admin_headers)
    assert await _domain("scenarios", "scenario_id", sid) == "software_engineering"
    await client.patch(f"/api/v1/scenarios/{sid}", json={"is_active": False}, headers=admin_headers)
    assert await _domain("scenarios", "scenario_id", sid) == "software_engineering"
    await client.patch(f"/api/v1/scenarios/{sid}", json={"job_domain": "marketing"}, headers=admin_headers)
    assert await _domain("scenarios", "scenario_id", sid) == "marketing"


async def test_other_null_fields_of_a_scenario_are_still_ignored(client, admin_headers, scenario_ids):
    sid = await _make_scenario(client, admin_headers, scenario_ids)
    await client.patch(f"/api/v1/scenarios/{sid}", json={"name": None, "prompt": None, "job_domain": None}, headers=admin_headers)
    stored = await get_db().scenarios.find_one({"scenario_id": sid})
    assert stored["name"].startswith("Clear test") and stored["prompt"] == "A production outage."
    assert stored["job_domain"] is None


async def test_a_cleared_scenario_becomes_a_generic_one():
    from services.hr_module import scenario_service

    db = get_db()
    sid = f"scn-clear-{uuid.uuid4().hex[:6]}"
    await db.scenarios.insert_one({
        "doc_type": "scenario", "scenario_id": sid, "name": "n", "prompt": "p", "job_domain": "devops", "is_active": True,
    })
    try:
        assert await scenario_service.update_scenario(sid, {"job_domain": None})
        generic = [s["scenario_id"] for s in await scenario_service.list_scenarios(is_active=True) if not s.get("job_domain")]
        assert sid in generic
    finally:
        await db.scenarios.delete_one({"scenario_id": sid})


@pytest.fixture
async def question_ids():
    ids: list[str] = []
    yield ids
    await get_db().coding_questions.delete_many({"question_id": {"$in": ids}})
    await get_db().audit_log.delete_many({"resource_id": {"$in": ids}})


async def _make_question(client, headers, ids, domain, title="Fixture question") -> str:
    response = await client.post(
        "/api/v1/coding/questions",
        json={"title": title, "description": "Add two numbers.", "job_domain": domain, "difficulty": "easy",
              "test_cases": [{"input": "1 2", "expected_output": "3"}]},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    ids.append(response.json()["question_id"])
    return response.json()["question_id"]


@pytest.mark.parametrize("cleared_with", [None, ""])
async def test_a_question_domain_is_cleared_by_null_or_blank(client, admin_headers, question_ids, cleared_with):
    qid = await _make_question(client, admin_headers, question_ids, "devops")
    response = await client.patch(f"/api/v1/coding/questions/{qid}", json={"job_domain": cleared_with}, headers=admin_headers)
    assert response.status_code == 200, response.text
    assert await _domain("coding_questions", "question_id", qid) is None
    assert (await client.get(f"/api/v1/coding/questions/{qid}", headers=admin_headers)).json()["job_domain"] is None


async def test_an_omitted_question_domain_is_kept(client, admin_headers, question_ids):
    qid = await _make_question(client, admin_headers, question_ids, "devops")
    response = await client.patch(f"/api/v1/coding/questions/{qid}", json={"title": "New title", "difficulty": None}, headers=admin_headers)
    assert response.status_code == 200
    stored = await get_db().coding_questions.find_one({"question_id": qid})
    assert stored["job_domain"] == "devops" and stored["title"] == "New title" and stored["difficulty"] == "easy"
    assert (await client.patch(f"/api/v1/coding/questions/{qid}", json={}, headers=admin_headers)).status_code == 400


async def test_the_question_list_pages_up_to_100_and_reports_a_total(client, admin_headers, question_ids):
    domain = f"paging-{uuid.uuid4().hex[:8]}"
    for i in range(3):
        await _make_question(client, admin_headers, question_ids, domain, title=f"Paged {i}")

    first = (await client.get(f"/api/v1/coding/questions?job_domain={domain}&limit=2", headers=admin_headers)).json()
    assert set(first) >= {"questions", "total"}
    assert first["total"] == 3 and len(first["questions"]) == 2

    second = (await client.get(f"/api/v1/coding/questions?job_domain={domain}&limit=2&page=2", headers=admin_headers)).json()
    assert second["total"] == 3 and len(second["questions"]) == 1

    for limit, ceiling in ((100, 100), (1000, 100), (0, 1), (-5, 1)):
        response = await client.get(f"/api/v1/coding/questions?job_domain={domain}&limit={limit}", headers=admin_headers)
        assert response.status_code == 200, limit
        assert len(response.json()["questions"]) <= ceiling and response.json()["total"] == 3
    everything = (await client.get(f"/api/v1/coding/questions?job_domain={domain}&limit=100", headers=admin_headers)).json()
    assert len(everything["questions"]) == 3


@pytest.fixture
async def live():
    db = get_db()
    made = {"candidates": [], "questions": []}

    async def session(*, minutes_ago, language="python", submitted=False, name="Live Person", title="Live question"):
        cid, qid = f"c-live-{uuid.uuid4().hex[:8]}", f"q-live-{uuid.uuid4().hex[:8]}"
        await db.candidates.insert_one({"doc_type": "candidate", "candidate_id": cid, "name": name, "coding_question_id": qid})
        await db.coding_questions.insert_one({"question_id": qid, "title": title})
        await db.coding_session_state.insert_one({
            "candidate_id": cid, "question_id": qid, "language": language, "code": "print(1)", "updated_at": _iso(minutes_ago),
        })
        if submitted:
            await db.coding_submissions.insert_one({"submission_id": f"s-{cid}", "candidate_id": cid, "question_id": qid})
        made["candidates"].append(cid)
        made["questions"].append(qid)
        return cid

    yield session
    await db.candidates.delete_many({"candidate_id": {"$in": made["candidates"]}})
    await db.coding_questions.delete_many({"question_id": {"$in": made["questions"]}})
    await db.coding_session_state.delete_many({"candidate_id": {"$in": made["candidates"]}})
    await db.coding_submissions.delete_many({"candidate_id": {"$in": made["candidates"]}})


async def test_live_sessions_lists_only_sessions_saved_in_the_last_half_hour(client, admin_headers, live):
    fresh = await live(minutes_ago=2, name="Fresh Person", title="Fresh question", language="javascript")
    recent = await live(minutes_ago=29)
    stale = await live(minutes_ago=31)
    done = await live(minutes_ago=1, submitted=True)

    response = await client.get("/api/v1/coding/live/sessions", headers=admin_headers)
    assert response.status_code == 200
    sessions = {s["candidate_id"]: s for s in response.json()["sessions"]}
    assert fresh in sessions and recent in sessions
    assert stale not in sessions and done not in sessions
    assert set(sessions[fresh]) == {"candidate_id", "candidate_name", "question_title", "language", "last_saved_at"}
    assert sessions[fresh]["candidate_name"] == "Fresh Person" and sessions[fresh]["question_title"] == "Fresh question"
    assert sessions[fresh]["language"] == "javascript"
    ordered = [s["candidate_id"] for s in response.json()["sessions"] if s["candidate_id"] in (fresh, recent)]
    assert ordered == [fresh, recent]


async def test_live_sessions_is_gated_like_the_single_session_view(client, admin_headers, standard_headers):
    assert (await client.get("/api/v1/coding/live/sessions", headers=standard_headers)).status_code == 403
    assert (await client.get("/api/v1/coding/live/sessions")).status_code == 401
    body = (await client.get("/api/v1/coding/live/sessions", headers=admin_headers)).json()
    assert isinstance(body["sessions"], list)


@pytest.fixture
async def waiting(monkeypatch):
    db = get_db()
    marker = uuid.uuid4().hex[:8]
    original = email_delivery_service._waiting_filter

    def patched():
        query = original()
        query["job_id"] = {"$regex": f"^job-wait-{marker}-"}
        return query

    monkeypatch.setattr(email_delivery_service, "_waiting_filter", patched)
    ids: list[str] = []

    async def candidate(i: int, **fields):
        cid = f"cand-wait-{marker}-{i}"
        doc = {
            "doc_type": "candidate", "candidate_id": cid, "job_id": f"job-wait-{marker}-{i}", "name": "Waiting Person",
            "email": f"{cid}@example.com", "secure_token": f"tok_{uuid.uuid4().hex[:12]}", "token_status": "active",
            "pipeline_stage": "invited", "status": "invited", "invite_sent_at": _iso(60), "invite_expires_at": _iso(-60 * 24 * 5),
            "invite_resent_count": 0, "created_at": _iso(60),
        }
        doc.update(fields)
        await db.candidates.insert_one(doc)
        ids.append(cid)
        return doc

    async def log(candidate_doc, *, status="sent", template="interview_invitation"):
        await db.email_log.insert_one({
            "to": candidate_doc["email"], "subject": "Interview Invitation", "template": template,
            "candidate_id": candidate_doc["candidate_id"], "status": status, "created_at": _iso(30),
        })

    yield type("W", (), {"candidate": staticmethod(candidate), "log": staticmethod(log), "ids": ids})
    await db.candidates.delete_many({"candidate_id": {"$in": ids}})
    await db.email_log.delete_many({"candidate_id": {"$in": ids}})


async def test_a_candidate_with_a_sent_invite_row_is_not_waiting_even_without_the_flag(waiting):
    db = get_db()
    legacy = await waiting.candidate(1)
    await waiting.log(legacy)
    unsent = await waiting.candidate(2)
    failed_only = await waiting.candidate(3)
    await waiting.log(failed_only, status="failed")
    other_mail = await waiting.candidate(4)
    await waiting.log(other_mail, template="reminder")
    not_sent = await waiting.candidate(5)
    await waiting.log(not_sent, status="not_sent")

    ids = {c["candidate_id"] for c in await email_delivery_service.list_waiting_invites(db)}
    assert legacy["candidate_id"] not in ids
    assert {unsent["candidate_id"], failed_only["candidate_id"], other_mail["candidate_id"], not_sent["candidate_id"]} <= ids
    assert await email_delivery_service.count_waiting_invites(db) == 4


async def test_resend_waiting_skips_a_candidate_whose_invite_was_sent(waiting, monkeypatch):
    sent: list[str] = []

    async def fake_send_email(**kwargs):
        sent.append(kwargs["to"])
        return True

    monkeypatch.setattr(email_service, "send_email", fake_send_email)
    monkeypatch.setattr(email_delivery_service, "current_provider", lambda: "smtp")
    db = get_db()
    legacy = await waiting.candidate(1)
    await waiting.log(legacy)
    needs = await waiting.candidate(2)

    result = await email_delivery_service.resend_waiting_invites(db, admin_email="admin@example.com", limit=25)
    assert result["attempted"] == 1 and result["sent"] == 1 and result["remaining"] == 0
    assert sent == [needs["email"]]


async def test_the_health_count_leaves_out_legacy_sent_invites(client, admin_headers, waiting):
    before = (await client.get("/api/v1/email-delivery/health", headers=admin_headers)).json()["waiting_invites"]
    unsent = await waiting.candidate(1)
    legacy = await waiting.candidate(2)
    await waiting.log(legacy)
    after = (await client.get("/api/v1/email-delivery/health", headers=admin_headers)).json()["waiting_invites"]
    assert after - before == 1 and unsent


@pytest.fixture
def outbox(monkeypatch):
    sent: list[dict] = []

    async def fake_send_email(**kwargs):
        sent.append(kwargs)
        return True

    monkeypatch.setattr(email_service, "send_email", fake_send_email)
    return sent


@pytest.fixture
async def no_override():
    await get_db().email_templates.delete_many({"key": "send_external_interview_email"})
    yield
    await get_db().email_templates.delete_many({"key": "send_external_interview_email"})


async def _external_email(**overrides):
    kwargs = dict(
        to_email="c@example.com", candidate_name="Asha Rao", job_title="Backend Engineer", company_name="Acme",
        platform_label="Google Meet", join_url="https://meet.google.com/abc-defg-hij?a=1&b=2",
        scheduled_start_at="2026-12-01T10:00:00+00:00", duration_minutes=45, notes="Bring a laptop", display_timezone="Asia/Kolkata",
    )
    kwargs.update(overrides)
    return await email_service.send_external_interview_email(**kwargs)


async def test_the_template_is_registered_with_documented_variables():
    meta = TEMPLATE_KEYS["send_external_interview_email"]
    assert meta["candidate_facing"] is True
    assert set(meta["placeholders"]) == {
        "candidate_name", "job_title", "company_name", "platform", "when", "duration_minutes",
        "join_url", "notes", "lead", "email_from_name",
        "brand_color", "brand_on_color", "brand_logo_html",
    }
    assert "NO scores" in meta["description"]


async def test_the_admin_template_api_lists_and_stores_it(client, admin_headers, no_override):
    listed = (await client.get("/api/v1/email-templates", headers=admin_headers)).json()["templates"]
    entry = next(t for t in listed if t["key"] == "send_external_interview_email")
    assert entry["is_customized"] is False and entry["placeholders"] == TEMPLATE_KEYS["send_external_interview_email"]["placeholders"]

    saved = await client.put(
        "/api/v1/email-templates/send_external_interview_email",
        json={"subject_template": "Interview: {{job_title}}"}, headers=admin_headers,
    )
    assert saved.status_code == 200 and saved.json()["is_customized"] is True
    reset = await client.delete("/api/v1/email-templates/send_external_interview_email", headers=admin_headers)
    assert reset.status_code == 200
    assert (await client.get("/api/v1/email-templates/send_external_interview_email", headers=admin_headers)).json()["is_customized"] is False


async def test_without_an_override_the_built_in_message_is_sent_unchanged(outbox, no_override):
    assert await _external_email() is True
    mail = outbox[0]
    assert mail["subject"] == "Your interview for Backend Engineer"
    assert "We would like to invite you to an interview." in mail["text_body"]
    assert "Join the interview" in mail["html_body"] and mail["template"] == "external_interview"


async def test_an_override_replaces_the_subject_and_bodies_with_its_variables(outbox, no_override):
    await get_db().email_templates.insert_one({
        "key": "send_external_interview_email",
        "subject_template": "{{job_title}} interview on {{platform}}\nfor {{candidate_name}}",
        "text_body_template": "Hi {{candidate_name}}. {{lead}} {{when}}, {{duration_minutes}} min. Join {{join_url}}. Note: {{notes}}. {{email_from_name}}",
        "html_body_template": "<p>{{candidate_name}}: {{notes}}</p><a href=\"{{join_url}}\">go</a>",
    })
    await _external_email(candidate_name="Asha <b>Rao</b>", notes="<script>x</script>")
    mail = outbox[0]
    assert mail["subject"] == "Backend Engineer interview on Google Meet for Asha <b>Rao</b>"
    assert "\n" not in mail["subject"]
    text = mail["text_body"]
    assert "Hi Asha <b>Rao</b>. We would like to invite you to an interview." in text
    assert "(" in text and "Asia/Kolkata" in text and "UTC" in text and "45 min" in text
    assert "https://meet.google.com/abc-defg-hij?a=1&b=2" in text and "Note: <script>x</script>." in text
    html = mail["html_body"]
    assert "<script>" not in html and "&lt;script&gt;" in html and "&lt;b&gt;" in html
    assert 'href="https://meet.google.com/abc-defg-hij?a=1&amp;b=2"' in html


async def test_the_update_wording_reaches_the_lead_variable(outbox, no_override):
    await get_db().email_templates.insert_one({"key": "send_external_interview_email", "text_body_template": "{{lead}}"})
    await _external_email(updated=True)
    assert outbox[0]["text_body"] == "The details of your interview have changed. Please use the new details below."
    assert outbox[0]["subject"] == "Updated interview details for Backend Engineer"


async def test_empty_override_fields_fall_back_to_the_built_in_message(outbox, no_override):
    await get_db().email_templates.insert_one({
        "key": "send_external_interview_email", "subject_template": None, "html_body_template": None, "text_body_template": None,
    })
    await _external_email()
    assert outbox[0]["subject"] == "Your interview for Backend Engineer"
    assert "Join the interview" in outbox[0]["html_body"]


async def test_a_failing_override_falls_back_to_the_built_in_message(outbox, no_override, monkeypatch):
    async def broken(key):
        raise RuntimeError("template store is down")

    monkeypatch.setattr(email_service, "get_template_override", broken)
    assert await _external_email() is True
    assert outbox[0]["subject"] == "Your interview for Backend Engineer"
