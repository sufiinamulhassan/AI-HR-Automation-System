from __future__ import annotations

import asyncio
import logging
from urllib.parse import urljoin, urlparse

from shared.safe_http import UnsafeTarget, safe_request

logger = logging.getLogger(__name__)

MAX_URL_CHARS = 2048
MAX_IMAGE_BYTES = 1_000_000
FETCH_TIMEOUT_SECONDS = 5.0
MAX_REDIRECTS = 3

NOT_PUBLIC_MESSAGE = "That address is not a public website. Use a public https link."

_REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})


class UnsafeUrlError(ValueError):
    pass


def _check_shape(url: str) -> str:
    value = (url or "").strip()
    if not value or len(value) > MAX_URL_CHARS or any(ch.isspace() or ord(ch) < 32 for ch in value):
        raise UnsafeUrlError("Enter a valid web address.")
    parsed = urlparse(value)
    if parsed.scheme != "https":
        raise UnsafeUrlError("The address must start with https://")
    if not parsed.hostname:
        raise UnsafeUrlError("Enter a valid web address.")
    if parsed.username or parsed.password:
        raise UnsafeUrlError("The address cannot contain a user name or password.")
    try:
        port = parsed.port
    except ValueError:
        raise UnsafeUrlError("Enter a valid web address.")
    if port not in (None, 443):
        raise UnsafeUrlError("The address must use the standard https port.")
    return value


async def assert_public_https_url(url: str) -> str:
    from services.hr_module.webhook_service import is_url_ssrf_safe

    value = _check_shape(url)
    if not await asyncio.to_thread(is_url_ssrf_safe, value):
        raise UnsafeUrlError(NOT_PUBLIC_MESSAGE)
    return value


async def fetch_public_image(
    url: str, *, max_bytes: int = MAX_IMAGE_BYTES, timeout: float = FETCH_TIMEOUT_SECONDS,
) -> bytes:
    current = _check_shape(url)
    for _hop in range(MAX_REDIRECTS + 1):
        try:
            response = await safe_request(
                "GET", current, timeout=timeout, max_bytes=max_bytes, allowed_ports=(443,),
            )
        except UnsafeTarget as exc:
            if "larger than allowed" in str(exc):
                raise ValueError("The image is too large.")
            raise UnsafeUrlError(NOT_PUBLIC_MESSAGE)
        if response.status_code in _REDIRECT_STATUSES:
            location = response.headers.get("location")
            if not location:
                raise ValueError("The image address redirects nowhere.")
            current = _check_shape(urljoin(current, location))
            continue
        if response.status_code >= 400:
            raise ValueError(f"The image address answered HTTP {response.status_code}.")
        if not (response.headers.get("content-type") or "").lower().startswith("image/"):
            raise ValueError("The address does not serve an image.")
        if len(response.content) > max_bytes:
            raise ValueError("The image is too large.")
        return response.content
    raise ValueError("The image address redirects too many times.")
