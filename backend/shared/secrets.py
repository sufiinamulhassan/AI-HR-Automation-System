from __future__ import annotations

import base64
import hashlib
import logging

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from config.settings import settings

logger = logging.getLogger(__name__)

PREFIX = "enc:v1:"


def _fernet_key(raw: str) -> bytes:
    raw = raw.strip()
    try:
        decoded = base64.urlsafe_b64decode(raw.encode("ascii"))
        if len(decoded) == 32:
            return raw.encode("ascii")
    except Exception:
        pass
    return base64.urlsafe_b64encode(hashlib.sha256(raw.encode("utf-8")).digest())


def _keys() -> list[bytes]:
    current = (settings.SECRETS_ENCRYPTION_KEY or "").strip()
    keys = [current] if current else [f"hr_bot/secrets/v1:{settings.SECRET_KEY}"]
    keys += [k for k in (settings.SECRETS_ENCRYPTION_KEY_PREVIOUS or "").split(",") if k.strip()]
    return [_fernet_key(k) for k in keys]


def _cipher() -> MultiFernet:
    return MultiFernet([Fernet(k) for k in _keys()])


def is_encrypted(value) -> bool:
    return isinstance(value, str) and value.startswith(PREFIX)


def encrypt(plain: str) -> str:
    if not plain:
        return ""
    return PREFIX + _cipher().encrypt(plain.encode("utf-8")).decode("ascii")


def decrypt(stored: str | None) -> str | None:
    if not stored or not is_encrypted(stored):
        return None
    try:
        return _cipher().decrypt(stored[len(PREFIX):].encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError):
        logger.error("A stored secret could not be decrypted: the encryption key has changed")
        return None


def mask(stored_or_plain: str | None, *, show: int = 4) -> str:
    if not stored_or_plain:
        return ""
    if is_encrypted(stored_or_plain):
        return "********"
    tail = stored_or_plain[-show:] if len(stored_or_plain) > show * 2 else ""
    return "********" + tail
