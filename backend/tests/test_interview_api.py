import pytest

from services.hr_module.interview_engine import compute_integrity_score

pytestmark = pytest.mark.anyio


async def test_report_requires_admin(client, standard_headers):
    response = await client.get(
        "/api/v1/interview/report/tok_test123",
        headers=standard_headers,
    )
    assert response.status_code == 403


async def test_report_not_found(client, admin_headers):
    response = await client.get(
        "/api/v1/interview/report/tok_nonexistent",
        headers=admin_headers,
    )
    assert response.status_code == 404


async def test_report_pdf_not_ready(client, admin_headers):
    from config.database import get_db
    import uuid

    db = get_db()
    token = f"tok_{uuid.uuid4().hex[:12]}"
    await db.candidates.insert_one({
        "doc_type": "candidate",
        "candidate_id": str(uuid.uuid4()),
        "secure_token": token,
        "name": "PDF Test",
        "email": "pdf.test@example.com",
        "status": "invited",
        "report": None,
    })

    response = await client.get(
        f"/api/v1/interview/report/{token}/pdf",
        headers=admin_headers,
    )
    assert response.status_code == 404
    assert "not ready" in response.json()["detail"].lower()


async def _insert_session_candidate(**extra) -> str:
    from config.database import get_db
    import uuid

    db = get_db()
    token = f"tok_{uuid.uuid4().hex[:12]}"
    await db.candidates.insert_one({
        "doc_type": "candidate",
        "candidate_id": str(uuid.uuid4()),
        "secure_token": token,
        "name": "Session Test",
        "email": f"session.{uuid.uuid4().hex[:6]}@example.com",
        "status": "invited",
        "_questions": ["Tell me about a project you are proud of."],
        **extra,
    })
    return token


async def test_session_reports_no_coding_assigned(client):
    token = await _insert_session_candidate()

    response = await client.get(f"/api/v1/interview/session/{token}")

    assert response.status_code == 200
    assert response.json()["coding_assigned"] is False


async def test_session_reports_coding_assigned(client):
    token = await _insert_session_candidate(coding_question_id="q_abc123")

    response = await client.get(f"/api/v1/interview/session/{token}")

    assert response.status_code == 200
    assert response.json()["coding_assigned"] is True


async def test_session_still_returns_original_fields(client):
    token = await _insert_session_candidate()

    body = (await client.get(f"/api/v1/interview/session/{token}")).json()

    assert body["candidate_name"] == "Session Test"
    assert isinstance(body["duration_minutes"], int)
    assert body["questions"] == ["Tell me about a project you are proud of."]


async def test_followup_not_found(client):
    response = await client.post(
        "/api/v1/interview/session/tok_nonexistent/followup",
        json={"question": "Tell me about a project.", "answer": "It was fine."},
    )
    assert response.status_code == 404


async def test_schedule_requires_admin(client, standard_headers):
    response = await client.patch(
        "/api/v1/interview/some-candidate-id/schedule",
        headers=standard_headers,
        json={"scheduled_start_at": None},
    )
    assert response.status_code == 403


async def test_schedule_not_found(client, admin_headers):
    response = await client.patch(
        "/api/v1/interview/nonexistent-candidate-id/schedule",
        headers=admin_headers,
        json={"scheduled_start_at": None},
    )
    assert response.status_code == 404


def test_compute_integrity_score_no_flags():
    assert compute_integrity_score([]) == 100


def test_compute_integrity_score_tab_switches():
    flags = ["tab_switch@2026-01-01T00:00:00", "tab_switch@2026-01-01T00:01:00"]
    assert compute_integrity_score(flags) == 80


def test_compute_integrity_score_mixed_events():
    flags = [
        "window_blur@t1",
        "page_unload_attempt@t2",
        "connection_lost@t3",
        "connection_restored@t4",
    ]
    assert compute_integrity_score(flags) == 67


def test_compute_integrity_score_unknown_event():
    assert compute_integrity_score(["mystery_event@t1"]) == 97


def test_compute_integrity_score_clamped_at_zero():
    flags = ["page_unload_attempt@t{}".format(i) for i in range(10)]
    assert compute_integrity_score(flags) == 0


def test_compute_integrity_score_screen_lockdown_events():
    assert compute_integrity_score(["fullscreen_exit@t1"]) == 88
    assert compute_integrity_score(["fullscreen_restored@t1"]) == 100
    assert compute_integrity_score(["multiple_displays_detected@t1"]) == 98
    assert compute_integrity_score(["screen_share_detected@t1"]) == 75


def test_compute_integrity_score_coding_events():
    assert compute_integrity_score(["paste_blocked@t1"]) == 92
    assert compute_integrity_score(["paste_burst@t1"]) == 85
    assert compute_integrity_score(["low_typing_ratio@t1"]) == 80


def test_compute_typing_ratio_subtracts_template():
    from services.hr_module.integrity import compute_typing_ratio

    assert compute_typing_ratio(200, "x" * 300, template_length=100) == 1.0
    assert compute_typing_ratio(10, "x" * 300, template_length=100) == 0.05
    assert compute_typing_ratio(300, "x" * 200, template_length=0) == 1.5
    assert compute_typing_ratio(0, "x" * 100, template_length=100) == 1.0


def test_compute_integrity_score_gaze_and_termination():
    assert compute_integrity_score(["gaze_off_screen@t1"]) == 94
    assert compute_integrity_score(["gaze_on_screen@t1"]) == 100
    assert compute_integrity_score(["terminated_tab_switches@t1"]) == 60


def test_compute_integrity_score_phone_detected():
    assert compute_integrity_score(["phone_detected@t1"]) == 85


def test_compute_integrity_score_identity_mismatch():
    assert compute_integrity_score(["identity_mismatch@t1"]) == 80


async def _insert_candidate(**overrides) -> str:
    from config.database import get_db
    import uuid

    token = f"tok_{uuid.uuid4().hex[:12]}"
    doc = {
        "doc_type": "candidate",
        "candidate_id": str(uuid.uuid4()),
        "secure_token": token,
        "name": "Voice Test",
        "email": "voice.test@example.com",
        "status": "invited",
        "integrity_flags": [],
    }
    doc.update(overrides)
    await get_db().candidates.insert_one(doc)
    return token


async def test_speak_not_found(client):
    response = await client.post(
        "/api/v1/interview/session/tok_nonexistent/speak",
        json={"text": "Tell me about yourself."},
    )
    assert response.status_code == 404


async def test_speak_rejects_consumed_token(client):
    token = await _insert_candidate(token_status="consumed")
    response = await client.post(
        f"/api/v1/interview/session/{token}/speak",
        json={"text": "Tell me about yourself."},
    )
    assert response.status_code == 410


async def test_speak_rejects_oversized_text(client):
    from config.settings import settings

    token = await _insert_candidate()
    response = await client.post(
        f"/api/v1/interview/session/{token}/speak",
        json={"text": "x" * (settings.MAX_TTS_INPUT_CHARS + 1)},
    )
    assert response.status_code == 413


async def test_speak_returns_audio(client, monkeypatch):
    import services.hr_module.voice_service as voice_service

    async def fake_synthesize(text, voice=None):
        return b"ID3fake-mp3-bytes"

    monkeypatch.setattr(voice_service, "synthesize_question", fake_synthesize)

    token = await _insert_candidate()
    response = await client.post(
        f"/api/v1/interview/session/{token}/speak",
        json={"text": "Tell me about yourself."},
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/mpeg"
    assert response.content == b"ID3fake-mp3-bytes"


async def test_speak_maps_provider_failure_to_502(client, monkeypatch):
    import services.hr_module.voice_service as voice_service

    async def boom(text, voice=None):
        raise voice_service.VoiceServiceError("provider down")

    monkeypatch.setattr(voice_service, "synthesize_question", boom)

    token = await _insert_candidate()
    response = await client.post(
        f"/api/v1/interview/session/{token}/speak",
        json={"text": "Tell me about yourself."},
    )
    assert response.status_code == 502


async def test_transcribe_not_found(client):
    response = await client.post(
        "/api/v1/interview/session/tok_nonexistent/transcribe",
        files={"file": ("answer.webm", b"fake-audio", "audio/webm")},
    )
    assert response.status_code == 404


async def test_transcribe_rejects_oversized_upload(client):
    from config.settings import settings

    token = await _insert_candidate()
    oversized = b"0" * (settings.MAX_ANSWER_AUDIO_MB * 1024 * 1024 + 1)
    response = await client.post(
        f"/api/v1/interview/session/{token}/transcribe",
        files={"file": ("answer.webm", oversized, "audio/webm")},
    )
    assert response.status_code == 413


async def test_transcribe_returns_text(client, monkeypatch):
    import services.hr_module.voice_service as voice_service

    async def fake_transcribe(audio, filename=None):
        return "I led a team of four engineers."

    monkeypatch.setattr(voice_service, "transcribe_answer", fake_transcribe)

    token = await _insert_candidate()
    response = await client.post(
        f"/api/v1/interview/session/{token}/transcribe",
        files={"file": ("answer.webm", b"fake-audio", "audio/webm")},
    )
    assert response.status_code == 200
    assert response.json()["text"] == "I led a team of four engineers."


def test_safe_audio_filename_rejects_unknown_extensions():
    from services.hr_module.voice_service import safe_audio_filename

    assert safe_audio_filename("answer.webm") == "answer.webm"
    assert safe_audio_filename("recording.mp4") == "answer.mp4"
    assert safe_audio_filename("../../etc/passwd") == "answer.webm"
    assert safe_audio_filename(None) == "answer.webm"


async def test_submit_preserves_flags_recorded_during_session(client):
    from config.database import get_db

    token = await _insert_candidate()

    for event in ("tab_switch", "no_face_detected"):
        flag_res = await client.post(
            f"/api/v1/interview/session/{token}/flag",
            json={"event": event},
        )
        assert flag_res.status_code == 200

    submit_res = await client.post(
        f"/api/v1/interview/session/{token}/submit",
        json={"transcript": [], "flags": ["terminated_tab_switches@t9"],
              "termination_reason": "max_tab_switches"},
    )
    assert submit_res.status_code == 200

    cand = await get_db().candidates.find_one({"secure_token": token})
    events = [f.split("@", 1)[0] for f in cand["integrity_flags"]]
    assert "tab_switch" in events
    assert "no_face_detected" in events
    assert "terminated_tab_switches" in events
    assert cand["termination_reason"] == "max_tab_switches"


async def test_submit_awaits_evaluation_before_responding(client, monkeypatch):
    import json
    from config.database import get_db
    import services.hr_module.interview_engine as interview_engine

    token = await _insert_candidate()

    eval_response = json.dumps({
        "overall_score": 88,
        "technical_score": 80, "communication_score": 85,
        "problem_solving_score": 82, "cultural_fit_score": 90, "confidence_score": 75,
        "strengths": ["Clear communicator"], "areas_for_improvement": [],
        "recommendation": "hire", "summary": "Solid candidate.",
        "integrity_assessment": "No flags.",
    })

    async def fake_ask_llm(*args, **kwargs):
        return eval_response

    monkeypatch.setattr(interview_engine, "ask_llm", fake_ask_llm)

    response = await client.post(
        f"/api/v1/interview/session/{token}/submit",
        json={
            "transcript": [
                {"question": "Tell me about yourself.",
                 "answer": "I'm a backend engineer with five years of experience."},
            ],
            "flags": [],
        },
    )
    assert response.status_code == 200
    assert response.json()["status"] == "submitted"

    cand = await get_db().candidates.find_one({"secure_token": token})
    assert cand["report_status"] == "ready"
    assert cand["report_error"] is None
    assert cand["report"]["overall_score"] == 88
    assert cand["final_score"] is not None
    assert cand["report"]["score_breakdown"]["final_score"] == cand["final_score"]


async def test_submit_stays_ready_when_eval_llm_call_times_out(client, monkeypatch):
    import httpx
    import openai
    from config.database import get_db
    import config.llm as llm_module

    token = await _insert_candidate()

    class _RaisingCompletions:
        async def create(self, **kwargs):
            request = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
            raise openai.APITimeoutError(request=request)

    class _RaisingChat:
        completions = _RaisingCompletions()

    class _RaisingOpenAIClient:
        chat = _RaisingChat()

    import anthropic

    class _RaisingMessages:
        async def create(self, **kwargs):
            request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
            raise anthropic.APITimeoutError(request=request)

    class _RaisingAnthropicClient:
        messages = _RaisingMessages()

    monkeypatch.setattr(llm_module, "get_openai_client", lambda: _RaisingOpenAIClient())
    monkeypatch.setattr(llm_module, "get_anthropic_client", lambda: _RaisingAnthropicClient())

    response = await client.post(
        f"/api/v1/interview/session/{token}/submit",
        json={
            "transcript": [
                {"question": "Tell me about yourself.",
                 "answer": "I'm a backend engineer with five years of experience."},
            ],
            "flags": [],
        },
    )
    assert response.status_code == 200
    assert response.json()["status"] == "submitted"

    cand = await get_db().candidates.find_one({"secure_token": token})
    assert cand["report_status"] == "ready"
    assert cand["report_error"] is None
    assert cand["report"]["overall_score"] == 50
    assert cand["report"]["technical_rationale"] == ""
    assert cand["final_score"] is not None


async def test_submit_responds_200_even_if_evaluation_raises(client, monkeypatch):
    import routes.interview as interview_route

    token = await _insert_candidate()

    async def boom(secure_token):
        raise RuntimeError("simulated total evaluation crash")

    monkeypatch.setattr(interview_route, "_evaluate", boom)

    response = await client.post(
        f"/api/v1/interview/session/{token}/submit",
        json={"transcript": [{"question": "Q", "answer": "A"}], "flags": []},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "submitted"


async def _insert_demo_candidate(**overrides) -> tuple[str, str]:
    import uuid as _uuid

    candidate_id = overrides.pop("candidate_id", None) or str(_uuid.uuid4())
    token = await _insert_candidate(candidate_id=candidate_id, **overrides)
    return token, candidate_id


async def test_demographics_not_found(client):
    response = await client.post(
        "/api/v1/interview/tok_nonexistent/demographics",
        json={"gender": "woman", "location": "Lagos"},
    )
    assert response.status_code == 404


async def test_demographics_valid_submit_is_recorded_separately_from_candidate(client):
    from config.database import get_db

    token, candidate_id = await _insert_demo_candidate()

    response = await client.post(
        f"/api/v1/interview/{token}/demographics",
        json={"gender": "woman", "location": "Lagos, Nigeria"},
    )
    assert response.status_code == 200
    assert response.json() == {"recorded": True}

    db = get_db()
    record = await db.candidate_demographics.find_one({"candidate_id": candidate_id}, {"_id": 0})
    assert record["gender"] == "woman"
    assert record["location"] == "Lagos, Nigeria"
    assert "submitted_at" in record

    cand = await db.candidates.find_one({"candidate_id": candidate_id})
    assert "gender" not in cand
    assert "location" not in cand

    await db.candidate_demographics.delete_one({"candidate_id": candidate_id})


async def test_demographics_partial_submit_leaves_the_other_field_null(client):
    from config.database import get_db

    token, candidate_id = await _insert_demo_candidate()

    response = await client.post(
        f"/api/v1/interview/{token}/demographics",
        json={"gender": "man"},
    )
    assert response.status_code == 200

    record = await get_db().candidate_demographics.find_one({"candidate_id": candidate_id}, {"_id": 0})
    assert record["gender"] == "man"
    assert record["location"] is None

    await get_db().candidate_demographics.delete_one({"candidate_id": candidate_id})


async def test_demographics_all_null_payload_still_records_that_it_was_submitted(client):
    from config.database import get_db

    token, candidate_id = await _insert_demo_candidate()

    response = await client.post(f"/api/v1/interview/{token}/demographics", json={})
    assert response.status_code == 200

    record = await get_db().candidate_demographics.find_one({"candidate_id": candidate_id}, {"_id": 0})
    assert record is not None
    assert record["gender"] is None
    assert record["location"] is None

    await get_db().candidate_demographics.delete_one({"candidate_id": candidate_id})


async def test_demographics_skip_leaves_no_record_at_all(client):
    from config.database import get_db

    _, candidate_id = await _insert_demo_candidate()

    record = await get_db().candidate_demographics.find_one({"candidate_id": candidate_id})
    assert record is None


async def test_demographics_resubmission_overwrites_the_previous_record(client):
    from config.database import get_db

    token, candidate_id = await _insert_demo_candidate()

    first = await client.post(
        f"/api/v1/interview/{token}/demographics", json={"gender": "woman", "location": "Lagos"},
    )
    assert first.status_code == 200
    second = await client.post(
        f"/api/v1/interview/{token}/demographics", json={"gender": "non-binary", "location": "Nairobi"},
    )
    assert second.status_code == 200

    db = get_db()
    matching = await db.candidate_demographics.find({"candidate_id": candidate_id}).to_list(10)
    assert len(matching) == 1
    assert matching[0]["gender"] == "non-binary"
    assert matching[0]["location"] == "Nairobi"

    await db.candidate_demographics.delete_one({"candidate_id": candidate_id})


async def test_demographics_still_reachable_after_interview_is_completed(client):
    from config.database import get_db

    token, candidate_id = await _insert_demo_candidate(token_status="consumed", status="completed")

    response = await client.post(
        f"/api/v1/interview/{token}/demographics",
        json={"gender": "man", "location": "Remote"},
    )
    assert response.status_code == 200

    record = await get_db().candidate_demographics.find_one({"candidate_id": candidate_id})
    assert record["gender"] == "man"

    await get_db().candidate_demographics.delete_one({"candidate_id": candidate_id})


async def test_demographics_rejects_an_expired_link(client):
    from datetime import datetime, timedelta, timezone

    expired_at = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    token, _ = await _insert_demo_candidate(invite_expires_at=expired_at)

    response = await client.post(
        f"/api/v1/interview/{token}/demographics",
        json={"gender": "woman"},
    )
    assert response.status_code == 410
