import asyncio
import logging
import time
from datetime import datetime, timezone

import httpx

from config.database import get_db, get_pinecone
from config.settings import sandbox_provider, sandbox_url, settings
from shared.scrub import scrub_secrets

logger = logging.getLogger(__name__)

CHECK_TIMEOUT_SECONDS = 8.0
NOT_CONFIGURED = "Not configured"
_DETAIL_MAX = 200

_ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models"
_OPENAI_MODELS_URL = "https://api.openai.com/v1/models"
_ANTHROPIC_VERSION = "2023-06-01"


async def _http_get(url: str, *, headers: dict | None = None, params: dict | None = None, timeout: float = CHECK_TIMEOUT_SECONDS):
    async with httpx.AsyncClient(timeout=timeout) as client:
        return await client.get(url, headers=headers or {}, params=params or {})


def _verdict(status_code: int, ok_text: str) -> tuple[bool, str]:
    if 200 <= status_code < 300:
        return True, ok_text
    if status_code in (401, 403):
        return False, f"The credentials were rejected (HTTP {status_code})"
    return False, f"The service answered HTTP {status_code}"


async def _check_mongodb() -> tuple[bool, str]:
    db = get_db()
    if db is None:
        return False, "The database is not connected"
    await db.command("ping")
    return True, "Connected"


async def _check_anthropic() -> tuple[bool, str]:
    key = settings.ANTHROPIC_API_KEY
    if not key:
        return False, NOT_CONFIGURED
    resp = await _http_get(
        _ANTHROPIC_MODELS_URL,
        headers={"x-api-key": key, "anthropic-version": _ANTHROPIC_VERSION},
        params={"limit": 1},
    )
    return _verdict(resp.status_code, "Key accepted")


async def _check_openai() -> tuple[bool, str]:
    key = settings.OPENAI_API_KEY
    if not key:
        return False, NOT_CONFIGURED
    resp = await _http_get(_OPENAI_MODELS_URL, headers={"Authorization": f"Bearer {key}"})
    return _verdict(resp.status_code, "Key accepted")


async def _check_pinecone() -> tuple[bool, str]:
    if not settings.PINECONE_API_KEY:
        return False, NOT_CONFIGURED
    index = get_pinecone()
    if index is None:
        return False, "The index could not be opened"
    await asyncio.to_thread(index.describe_index_stats)
    return True, "Vector index reachable"


async def _check_code_sandbox() -> tuple[bool, str]:
    base = (sandbox_url() or "").rstrip("/")
    if not base:
        return False, NOT_CONFIGURED
    if sandbox_provider() == "piston":
        headers = {"Authorization": f"Bearer {settings.PISTON_API_KEY}"} if settings.PISTON_API_KEY else {}
        resp = await _http_get(f"{base}/runtimes", headers=headers)
        return _verdict(resp.status_code, "Piston reachable")
    headers = {}
    if settings.JUDGE0_API_HOST:
        headers["X-RapidAPI-Host"] = settings.JUDGE0_API_HOST
        if settings.JUDGE0_API_KEY:
            headers["X-RapidAPI-Key"] = settings.JUDGE0_API_KEY
    resp = await _http_get(f"{base}/about", headers=headers)
    return _verdict(resp.status_code, "Judge0 reachable")


def _sandbox_label() -> str:
    return "Code sandbox (Piston)" if sandbox_provider() == "piston" else "Code sandbox (Judge0)"


async def _run_one(key: str, label: str, check) -> dict:
    started = time.monotonic()
    try:
        ok, detail = await asyncio.wait_for(check(), timeout=CHECK_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        ok, detail = False, f"No answer within {CHECK_TIMEOUT_SECONDS:g} seconds"
    except Exception as exc:
        ok, detail = False, f"{type(exc).__name__}: {exc}"
    latency_ms = 0 if detail == NOT_CONFIGURED else int((time.monotonic() - started) * 1000)
    return {
        "key": key,
        "label": label,
        "ok": bool(ok),
        "detail": scrub_secrets(detail, limit=_DETAIL_MAX) or "",
        "latency_ms": latency_ms,
    }


async def run_live_check() -> dict:
    checks = [
        ("mongodb", "MongoDB", _check_mongodb),
        ("anthropic", "Anthropic", _check_anthropic),
        ("openai", "OpenAI", _check_openai),
        ("pinecone", "Pinecone", _check_pinecone),
        ("code_sandbox", _sandbox_label(), _check_code_sandbox),
    ]
    results = await asyncio.gather(*(_run_one(key, label, check) for key, label, check in checks))
    return {"checked_at": datetime.now(timezone.utc).isoformat(), "results": list(results)}
