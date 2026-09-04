"""
Live voice interview helpers — hr_module.

Turn-by-turn voice over plain HTTP: the AI's question is synthesised to MP3 and
played in the candidate's browser, the candidate's spoken answer is uploaded as
a recorded audio blob and transcribed back to text. The transcribed text then
enters the normal transcript that `interview_engine.evaluate_interview` grades,
so the evaluation pipeline is unchanged by the switch from typing to speaking.

WebSockets/streaming are deliberately not used — the backend runs on a serverless
Function URL, which is HTTP request/response only (see routes/interview.py).
"""
import logging

from config.llm import get_openai_client
from config.settings import settings

logger = logging.getLogger(__name__)

_ALLOWED_AUDIO_EXTENSIONS = {"webm", "mp4", "m4a", "mp3", "mpga", "wav", "ogg", "oga", "flac"}
_DEFAULT_AUDIO_FILENAME = "answer.webm"


class VoiceServiceError(RuntimeError):
    """Raised when TTS or STT fails — callers map this to an HTTP 502."""


def safe_audio_filename(filename: str | None) -> str:
    """Reduce an uploaded filename to a bare `answer.<ext>` Whisper will accept.

    The client controls this value, so it is never passed through as-is: only
    the extension is honoured, and only from a known-good set.
    """
    ext = (filename or "").rsplit(".", 1)[-1].lower().strip()
    if ext not in _ALLOWED_AUDIO_EXTENSIONS:
        return _DEFAULT_AUDIO_FILENAME
    return f"answer.{ext}"


async def synthesize_question(text: str, voice: str | None = None) -> bytes:
    """Render question text to MP3 bytes via the configured TTS model.

    Raises VoiceServiceError on any provider failure — unlike `ask_llm`, this
    must not degrade silently: a candidate who hears nothing has no way to
    answer, so the route needs to surface the failure and let the client retry.
    """
    clipped = (text or "").strip()[: settings.MAX_TTS_INPUT_CHARS]
    if not clipped:
        raise VoiceServiceError("No text to synthesize")

    try:
        client = get_openai_client()
        resp = await client.audio.speech.create(
            model=settings.TTS_MODEL,
            voice=voice or settings.TTS_VOICE,
            input=clipped,
            response_format="mp3",
        )
        audio = getattr(resp, "content", None)
        if audio is None:
            audio = await resp.aread()
        return audio
    except Exception as exc:
        logger.warning("TTS synthesis failed model=%s: %s", settings.TTS_MODEL, exc)
        raise VoiceServiceError(str(exc)) from exc


async def transcribe_answer(audio: bytes, filename: str | None = None) -> str:
    """Transcribe a recorded answer to text via the configured STT model."""
    if not audio:
        raise VoiceServiceError("Empty audio upload")

    try:
        client = get_openai_client()
        resp = await client.audio.transcriptions.create(
            model=settings.STT_MODEL,
            file=(safe_audio_filename(filename), audio),
        )
        return (getattr(resp, "text", "") or "").strip()
    except Exception as exc:
        logger.warning("STT transcription failed model=%s: %s", settings.STT_MODEL, exc)
        raise VoiceServiceError(str(exc)) from exc
