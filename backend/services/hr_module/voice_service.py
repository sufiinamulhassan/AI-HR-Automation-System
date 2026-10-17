import logging

from config.llm import get_openai_client, model_for, record_voice_cost
from config.settings import settings

logger = logging.getLogger(__name__)

_ALLOWED_AUDIO_EXTENSIONS = {"webm", "mp4", "m4a", "mp3", "mpga", "wav", "ogg", "oga", "flac"}
_DEFAULT_AUDIO_FILENAME = "answer.webm"


class VoiceServiceError(RuntimeError):
    pass


def safe_audio_filename(filename: str | None) -> str:
    ext = (filename or "").rsplit(".", 1)[-1].lower().strip()
    if ext not in _ALLOWED_AUDIO_EXTENSIONS:
        return _DEFAULT_AUDIO_FILENAME
    return f"answer.{ext}"


async def synthesize_question(text: str, voice: str | None = None) -> bytes:
    clipped = (text or "").strip()[: settings.MAX_TTS_INPUT_CHARS]
    if not clipped:
        raise VoiceServiceError("No text to synthesize")

    tts_model = model_for("speech")
    try:
        client = get_openai_client()
        resp = await client.audio.speech.create(
            model=tts_model,
            voice=voice or settings.TTS_VOICE,
            input=clipped,
            response_format="mp3",
        )
        audio = getattr(resp, "content", None)
        if audio is None:
            audio = await resp.aread()
    except Exception as exc:
        logger.warning("TTS synthesis failed model=%s: %s", tts_model, exc)
        raise VoiceServiceError(str(exc)) from exc

    try:
        await record_voice_cost("tts", "interview_tts", tts_model, characters=len(clipped))
    except Exception as exc:
        logger.warning("voice cost logging failed (tts): %s", exc)
    return audio


async def transcribe_answer(audio: bytes, filename: str | None = None) -> str:
    if not audio:
        raise VoiceServiceError("Empty audio upload")

    stt_model = model_for("transcription")
    try:
        client = get_openai_client()
        resp = await client.audio.transcriptions.create(
            model=stt_model,
            file=(safe_audio_filename(filename), audio),
        )
        text = (getattr(resp, "text", "") or "").strip()
    except Exception as exc:
        logger.warning("STT transcription failed model=%s: %s", stt_model, exc)
        raise VoiceServiceError(str(exc)) from exc

    try:
        real_duration = getattr(resp, "duration", None)
        await record_voice_cost(
            "stt", "interview_stt", stt_model,
            duration_seconds=float(real_duration) if real_duration is not None else None,
            audio_bytes=len(audio),
        )
    except Exception as exc:
        logger.warning("voice cost logging failed (stt): %s", exc)
    return text
