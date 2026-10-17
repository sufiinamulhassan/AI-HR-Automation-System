import uuid

import pytest

from config.database import get_db

pytestmark = pytest.mark.anyio


class _FakeSpeechResponse:
    def __init__(self, content: bytes):
        self.content = content


class _FakeAudioSpeech:
    def __init__(self, content: bytes):
        self._content = content

    async def create(self, **kwargs):
        return _FakeSpeechResponse(self._content)


class _FakeTranscription:
    def __init__(self, text: str, duration: float | None = None):
        self.text = text
        if duration is not None:
            self.duration = duration


class _FakeAudioTranscriptions:
    def __init__(self, response):
        self._response = response

    async def create(self, **kwargs):
        return self._response


class _FakeOpenAIClient:
    def __init__(self, *, speech=None, transcriptions=None):
        class _Audio:
            pass
        audio = _Audio()
        if speech is not None:
            audio.speech = speech
        if transcriptions is not None:
            audio.transcriptions = transcriptions
        self.audio = audio


def _tts_client(content: bytes = b"ID3fake-mp3-bytes") -> _FakeOpenAIClient:
    return _FakeOpenAIClient(speech=_FakeAudioSpeech(content))


def _stt_client(text: str, duration: float | None = None) -> _FakeOpenAIClient:
    return _FakeOpenAIClient(transcriptions=_FakeAudioTranscriptions(_FakeTranscription(text, duration)))


async def test_synthesize_question_logs_a_plausible_tts_cost_entry(monkeypatch):
    import services.hr_module.voice_service as voice_service
    from config.settings import settings

    db = get_db()
    marker = uuid.uuid4().hex[:10]
    text = f"Tell me about a time you resolved a conflict on your team. [{marker}]"

    monkeypatch.setattr(voice_service, "get_openai_client", lambda: _tts_client())

    audio = await voice_service.synthesize_question(text)
    assert audio == b"ID3fake-mp3-bytes"

    try:
        doc = await db.cost_ledger.find_one(
            {"source": "interview_tts", "characters": len(text)},
            sort=[("_id", -1)],
        )
        assert doc is not None
        assert doc["cost_type"] == "tts"
        assert doc["model"] == settings.TTS_MODEL
        assert doc["characters"] == len(text)
        assert 0.0 < doc["cost_usd"] < 0.01
    finally:
        await db.cost_ledger.delete_many({"source": "interview_tts", "characters": len(text)})


async def test_tts_cost_logging_failure_does_not_break_speech_synthesis(monkeypatch):
    import services.hr_module.voice_service as voice_service

    monkeypatch.setattr(voice_service, "get_openai_client", lambda: _tts_client())

    async def boom(*args, **kwargs):
        raise RuntimeError("cost_ledger is unreachable")

    monkeypatch.setattr(voice_service, "record_voice_cost", boom)

    audio = await voice_service.synthesize_question("Still works despite a cost-logging failure.")
    assert audio == b"ID3fake-mp3-bytes"


async def test_transcribe_answer_logs_real_duration_when_api_provides_one(monkeypatch):
    import services.hr_module.voice_service as voice_service
    from config.settings import settings

    db = get_db()
    audio_bytes = uuid.uuid4().bytes * 500
    monkeypatch.setattr(voice_service, "get_openai_client", lambda: _stt_client("I led the migration.", duration=12.5))

    text = await voice_service.transcribe_answer(audio_bytes, filename="answer.webm")
    assert text == "I led the migration."

    try:
        doc = await db.cost_ledger.find_one(
            {"source": "interview_stt", "audio_bytes": len(audio_bytes)},
            sort=[("_id", -1)],
        )
        assert doc is not None
        assert doc["cost_type"] == "stt"
        assert doc["model"] == settings.STT_MODEL
        assert doc["duration_source"] == "api"
        assert abs(doc["duration_seconds"] - 12.5) < 1e-6
        expected_cost = (12.5 / 60.0) * 0.006
        assert abs(doc["cost_usd"] - expected_cost) < 1e-9
    finally:
        await db.cost_ledger.delete_many({"source": "interview_stt", "audio_bytes": len(audio_bytes)})


async def test_transcribe_answer_estimates_duration_when_api_gives_none(monkeypatch):
    import services.hr_module.voice_service as voice_service
    from config.settings import settings

    db = get_db()
    audio_bytes = uuid.uuid4().bytes * 1000
    monkeypatch.setattr(voice_service, "get_openai_client", lambda: _stt_client("No duration here."))

    text = await voice_service.transcribe_answer(audio_bytes, filename="answer.webm")
    assert text == "No duration here."

    try:
        doc = await db.cost_ledger.find_one(
            {"source": "interview_stt", "audio_bytes": len(audio_bytes)},
            sort=[("_id", -1)],
        )
        assert doc is not None
        assert doc["cost_type"] == "stt"
        assert doc["model"] == settings.STT_MODEL
        assert doc["duration_source"] == "estimated_from_file_size"
        assert doc["duration_seconds"] > 0
        assert 0.0 < doc["cost_usd"] < 0.01
    finally:
        await db.cost_ledger.delete_many({"source": "interview_stt", "audio_bytes": len(audio_bytes)})


async def test_stt_cost_logging_failure_does_not_break_transcription(monkeypatch):
    import services.hr_module.voice_service as voice_service

    monkeypatch.setattr(voice_service, "get_openai_client", lambda: _stt_client("Still transcribed."))

    async def boom(*args, **kwargs):
        raise RuntimeError("cost_ledger is unreachable")

    monkeypatch.setattr(voice_service, "record_voice_cost", boom)

    text = await voice_service.transcribe_answer(b"some-audio-bytes", filename="answer.webm")
    assert text == "Still transcribed."


async def test_record_voice_cost_swallows_a_db_failure(monkeypatch):
    import config.llm as llm_module

    def boom():
        raise RuntimeError("db unreachable")

    monkeypatch.setattr("config.database.get_db", boom)

    await llm_module.record_voice_cost("tts", "test_voice_db_failure", "tts-1", characters=100)
