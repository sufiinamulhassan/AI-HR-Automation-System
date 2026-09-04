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
    """The flag is additive — nothing the existing client reads may move."""
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


async def _insert_candidate(**overrides) -> str:
    """Insert a bare candidate doc and return its interview token."""
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
    """/submit must append to integrity_flags, never overwrite them.

    A $set here would discard every flag POSTed to /flag during the interview
    and hand the recruiter a clean 100/100 integrity score for a candidate who
    tab-switched throughout.
    """
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
