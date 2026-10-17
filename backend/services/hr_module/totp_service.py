from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote

STEP_SECONDS = 30
DIGITS = 6
WINDOW_STEPS = 1
SECRET_BYTES = 20
RECOVERY_CODE_COUNT = 8
_RECOVERY_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567"
_RECOVERY_GROUP = 5


def new_secret() -> str:
    return base64.b32encode(secrets.token_bytes(SECRET_BYTES)).decode("ascii")


def _decode_secret(secret_b32: str) -> bytes:
    cleaned = "".join(str(secret_b32 or "").split()).upper()
    cleaned += "=" * (-len(cleaned) % 8)
    try:
        return base64.b32decode(cleaned)
    except (binascii.Error, ValueError):
        raise ValueError("The secret is not valid base32.")


def hotp(key: bytes, counter: int, digits: int = DIGITS) -> str:
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(value % (10 ** digits)).zfill(digits)


def step_for(timestamp: float | None = None) -> int:
    return int((time.time() if timestamp is None else timestamp) // STEP_SECONDS)


def totp_at(secret_b32: str, timestamp: float | None = None, digits: int = DIGITS) -> str:
    return hotp(_decode_secret(secret_b32), step_for(timestamp), digits)


def normalize_code(code) -> str | None:
    text = "".join(str(code or "").split())
    return text if len(text) == DIGITS and text.isascii() and text.isdigit() else None


def match_step(
    secret_b32: str, code, *, now: float | None = None, last_step: int | None = None,
) -> int | None:
    candidate = normalize_code(code)
    if candidate is None:
        return None
    try:
        key = _decode_secret(secret_b32)
    except ValueError:
        return None
    current = step_for(now)
    matched: int | None = None
    for step in range(current - WINDOW_STEPS, current + WINDOW_STEPS + 1):
        if step < 0:
            continue
        expected = hotp(key, step)
        if hmac.compare_digest(expected.encode("ascii"), candidate.encode("ascii")):
            if last_step is None or step > last_step:
                matched = step if matched is None else max(matched, step)
    return matched


def provisioning_uri(secret_b32: str, account: str, issuer: str) -> str:
    label = f"{quote(issuer, safe='')}:{quote(account, safe='')}"
    return (
        f"otpauth://totp/{label}?secret={secret_b32}&issuer={quote(issuer, safe='')}"
        f"&algorithm=SHA1&digits={DIGITS}&period={STEP_SECONDS}"
    )


def new_recovery_code() -> str:
    chars = "".join(secrets.choice(_RECOVERY_ALPHABET) for _ in range(_RECOVERY_GROUP * 2))
    return f"{chars[:_RECOVERY_GROUP]}-{chars[_RECOVERY_GROUP:]}"


def generate_recovery_codes(count: int = RECOVERY_CODE_COUNT) -> list[str]:
    codes: list[str] = []
    while len(codes) < count:
        code = new_recovery_code()
        if code not in codes:
            codes.append(code)
    return codes


def normalize_recovery_code(code) -> str | None:
    text = "".join(str(code or "").split()).lower().replace("-", "")
    if len(text) != _RECOVERY_GROUP * 2 or not all(c in _RECOVERY_ALPHABET for c in text):
        return None
    return f"{text[:_RECOVERY_GROUP]}-{text[_RECOVERY_GROUP:]}"


def hash_recovery_code(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def hash_recovery_codes(codes: list[str]) -> list[str]:
    return [hash_recovery_code(c) for c in codes]


def find_recovery_hash(stored_hashes: list[str] | None, code) -> str | None:
    normalized = normalize_recovery_code(code)
    if normalized is None:
        return None
    wanted = hash_recovery_code(normalized)
    found: str | None = None
    for stored in stored_hashes or []:
        if isinstance(stored, str) and hmac.compare_digest(stored.encode("ascii", "ignore"), wanted.encode("ascii")):
            found = stored
    return found


def spend_recovery_code(stored_hashes: list[str] | None, code) -> list[str] | None:
    match = find_recovery_hash(stored_hashes, code)
    if match is None:
        return None
    remaining = list(stored_hashes or [])
    remaining.remove(match)
    return remaining


async def claim_step(db, email: str, step: int) -> bool:
    result = await db.users.update_one(
        {"email": email, "$or": [{"totp_last_step": {"$exists": False}}, {"totp_last_step": {"$lt": step}}]},
        {"$set": {"totp_last_step": step}},
    )
    return result.matched_count == 1


async def spend_stored_recovery_hash(db, email: str, stored_hash: str) -> bool:
    result = await db.users.update_one(
        {"email": email, "totp_recovery_hashes": stored_hash},
        {"$pull": {"totp_recovery_hashes": stored_hash}},
    )
    return result.modified_count == 1
