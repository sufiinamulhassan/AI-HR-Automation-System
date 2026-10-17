from __future__ import annotations

import asyncio
import ipaddress
import logging
import re
import socket
from datetime import datetime, timezone

from config.database import get_db
from shared import secrets
from shared.safe_http import UnsafeTarget, resolve_public
from shared.utils import strip_em_dashes

logger = logging.getLogger(__name__)

SINGLETON_ID = "singleton"
MODES = ("platform", "smtp")
ALLOWED_PORTS = (25, 465, 587, 2525)
DEFAULT_PORT = 587
IMPLICIT_TLS_PORT = 465
CONNECT_TIMEOUT_SECONDS = 15.0
VERIFY_TIMEOUT_SECONDS = 20.0

MAX_HOST_CHARS = 253
MAX_NAME_CHARS = 100
MAX_USERNAME_CHARS = 254
MAX_PASSWORD_CHARS = 256

_LABEL = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")

_DEFAULTS: dict = {
    "mode": "platform",
    "from_name": "",
    "from_address": "",
    "reply_to": "",
    "host": "",
    "port": DEFAULT_PORT,
    "username": "",
    "password": "",
    "use_tls": True,
}

FIELDS = ("mode", "from_name", "from_address", "reply_to", "host", "port", "username", "use_tls")


class MailSettingsError(ValueError):
    pass


class MailConfigUnusable(Exception):
    pass


def _single_line(value, label: str, max_chars: int) -> str:
    text = "" if value is None else str(value)
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in text):
        raise MailSettingsError(f"{label} must be a single line of text.")
    text = text.strip()
    if len(text) > max_chars:
        raise MailSettingsError(f"{label} must be at most {max_chars} characters.")
    return text


def clean_host(value) -> str:
    text = _single_line(value, "The mail server host", MAX_HOST_CHARS).lower()
    if not text:
        return ""
    try:
        ipaddress.IPv4Address(text)
        return text
    except ValueError:
        pass
    labels = text.split(".")
    if not all(_LABEL.match(label) for label in labels):
        raise MailSettingsError("Enter the mail server's host name only, for example smtp.example.com.")
    return text


def clean_port(value) -> int:
    if isinstance(value, bool):
        raise MailSettingsError("The port must be 25, 465, 587 or 2525.")
    try:
        port = int(value)
    except (TypeError, ValueError):
        raise MailSettingsError("The port must be 25, 465, 587 or 2525.")
    if port not in ALLOWED_PORTS:
        raise MailSettingsError("The port must be 25, 465, 587 or 2525.")
    return port


def clean_mailbox(value, label: str) -> str:
    from services.hr_module.email_service import valid_email_address

    text = _single_line(value, label, 254)
    if not text:
        return ""
    address = valid_email_address(text)
    if address is None:
        raise MailSettingsError(f"{label} must be a single email address, for example jobs@example.com.")
    return address


def _clean_password(value) -> str:
    text = "" if value is None else str(value)
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in text):
        raise MailSettingsError("The password cannot contain line breaks or control characters.")
    if len(text) > MAX_PASSWORD_CHARS:
        raise MailSettingsError(f"The password must be at most {MAX_PASSWORD_CHARS} characters.")
    return text


def _public_reason(exc: UnsafeTarget) -> str:
    if "could not be found" in str(exc):
        return "The mail server host name could not be found."
    return "The mail server must be reachable on the public internet."


async def assert_public_host(host: str, port: int) -> None:
    try:
        await resolve_public(host, port)
    except UnsafeTarget as exc:
        raise MailSettingsError(_public_reason(exc))


def _with_defaults(mail: dict | None) -> dict:
    out = dict(_DEFAULTS)
    out.update({k: v for k, v in (mail or {}).items() if v is not None})
    return out


def has_password(mail: dict | None) -> bool:
    return secrets.decrypt((mail or {}).get("password")) is not None


def is_complete(mail: dict | None) -> bool:
    m = _with_defaults(mail)
    if not (m["host"] and m["from_address"] and m["port"] in ALLOWED_PORTS):
        return False
    return not m["username"] or has_password(m)


def view(mail: dict | None) -> dict:
    m = _with_defaults(mail)
    return {
        "mode": m["mode"] if m["mode"] in MODES else "platform",
        "from_name": m["from_name"],
        "from_address": m["from_address"],
        "reply_to": m["reply_to"],
        "host": m["host"],
        "port": m["port"],
        "username": m["username"],
        "use_tls": bool(m["use_tls"]),
        "has_password": has_password(m),
        "complete": is_complete(m),
        "updated_at": (mail or {}).get("updated_at"),
        "updated_by": (mail or {}).get("updated_by"),
    }


def merge_changes(existing: dict | None, changes: dict) -> dict:
    m = _with_defaults(existing)
    if "mode" in changes and changes["mode"] is not None:
        mode = str(changes["mode"]).strip().lower()
        if mode not in MODES:
            raise MailSettingsError("The mode must be platform or smtp.")
        m["mode"] = mode
    if "from_name" in changes and changes["from_name"] is not None:
        m["from_name"] = strip_em_dashes(_single_line(changes["from_name"], "The sender name", MAX_NAME_CHARS))
    if "from_address" in changes and changes["from_address"] is not None:
        m["from_address"] = clean_mailbox(changes["from_address"], "The sender address")
    if "reply_to" in changes and changes["reply_to"] is not None:
        m["reply_to"] = clean_mailbox(changes["reply_to"], "The reply-to address")
    if "host" in changes and changes["host"] is not None:
        m["host"] = clean_host(changes["host"])
    if "port" in changes and changes["port"] is not None:
        m["port"] = clean_port(changes["port"])
    if "username" in changes and changes["username"] is not None:
        m["username"] = _single_line(changes["username"], "The user name", MAX_USERNAME_CHARS)
    if "use_tls" in changes and changes["use_tls"] is not None:
        m["use_tls"] = bool(changes["use_tls"])
    if changes.get("clear_password"):
        m["password"] = ""
    password = _clean_password(changes.get("password")) if changes.get("password") else ""
    if password:
        m["password"] = secrets.encrypt(password)
    return m


def check_ready_for_smtp(m: dict) -> None:
    if not m["host"]:
        raise MailSettingsError("Enter the mail server host.")
    if m["port"] not in ALLOWED_PORTS:
        raise MailSettingsError("The port must be 25, 465, 587 or 2525.")
    if not m["from_address"]:
        raise MailSettingsError("Enter the sender address.")
    has_pw = has_password(m)
    if m["username"] and not has_pw:
        raise MailSettingsError("Enter the password that goes with the user name.")
    if has_pw and not m["username"]:
        raise MailSettingsError("Enter the user name that goes with the password.")
    if (m["username"] or has_pw) and not m["use_tls"]:
        raise MailSettingsError("Turn on TLS to sign in with a user name and password.")


async def load_mail() -> dict | None:
    db = get_db()
    if db is None:
        return None
    row = await db.company_settings.find_one({"_id": SINGLETON_ID}, {"mail": 1})
    return (row or {}).get("mail") or None


async def get_view() -> dict:
    return view(await load_mail())


async def save_mail(changes: dict, *, updated_by: str | None = None) -> tuple[dict, dict]:
    db = get_db()
    if db is None:
        raise MailSettingsError("The database is unavailable. Try again shortly.")
    existing = await load_mail()
    merged = merge_changes(existing, changes)
    if merged["mode"] == "smtp":
        check_ready_for_smtp(merged)
        await assert_public_host(merged["host"], merged["port"])
    merged["updated_at"] = datetime.now(timezone.utc).isoformat()
    if updated_by:
        merged["updated_by"] = updated_by

    from services.hr_module.company_settings_service import get_company_settings

    await get_company_settings()
    await db.company_settings.update_one({"_id": SINGLETON_ID}, {"$set": {"mail": merged}}, upsert=True)
    summary = {
        "mode": merged["mode"], "host": merged["host"], "port": merged["port"],
        "from_address": merged["from_address"], "username_set": bool(merged["username"]),
        "use_tls": bool(merged["use_tls"]),
        "password_changed": bool(changes.get("password")) or bool(changes.get("clear_password")),
    }
    return view(merged), summary


def smtp_settings(mail: dict | None) -> dict | None:
    if not mail or mail.get("mode") != "smtp":
        return None
    from services.hr_module.email_service import valid_email_address

    m = _with_defaults(mail)
    if not (m["host"] and m["from_address"] and m["port"] in ALLOWED_PORTS):
        raise MailConfigUnusable("The company's mail server settings are incomplete.")
    if valid_email_address(m["from_address"]) is None:
        raise MailConfigUnusable("The company's sender address is not a valid email address.")
    password = secrets.decrypt(m["password"]) or ""
    if m["username"] and not password:
        raise MailConfigUnusable("The saved mail server password cannot be read. Enter it again in the mail settings.")
    return {
        "host": m["host"], "port": int(m["port"]), "username": m["username"] or "", "password": password,
        "use_tls": bool(m["use_tls"]), "from_name": m["from_name"], "from_address": m["from_address"],
        "reply_to": m["reply_to"],
    }


def tls_options(port: int, use_tls: bool) -> dict:
    if not use_tls:
        return {"use_tls": False, "start_tls": False}
    if port == IMPLICIT_TLS_PORT:
        return {"use_tls": True, "start_tls": False}
    return {"use_tls": False, "start_tls": True}


def client_options(smtp: dict, *, timeout: float = CONNECT_TIMEOUT_SECONDS, credentials: bool = True) -> dict:
    options = {
        "hostname": smtp["host"],
        "timeout": timeout,
        **tls_options(smtp["port"], smtp["use_tls"]),
    }
    if credentials:
        options["username"] = smtp["username"] or None
        options["password"] = smtp["password"] or None
    return options


async def connect_pinned(host: str, port: int, *, timeout: float = CONNECT_TIMEOUT_SECONDS) -> socket.socket:
    addresses = await resolve_public(host, port)
    loop = asyncio.get_running_loop()
    last: BaseException | None = None
    for address in addresses:
        sock = socket.socket(socket.AF_INET6 if ":" in address else socket.AF_INET, socket.SOCK_STREAM)
        sock.setblocking(False)
        try:
            await asyncio.wait_for(loop.sock_connect(sock, (address, port)), timeout=timeout)
            return sock
        except asyncio.CancelledError:
            sock.close()
            raise
        except Exception as exc:
            sock.close()
            last = exc
    raise last or OSError("The mail server did not accept the connection.")


def describe_failure(exc: BaseException) -> str:
    name = type(exc).__name__
    if isinstance(exc, UnsafeTarget):
        return _public_reason(exc)
    if isinstance(exc, (asyncio.TimeoutError, TimeoutError)) or "Timeout" in name:
        return "The mail server did not answer in time. Check the host and port."
    if "Authentication" in name or "SMTPAuth" in name:
        return "The mail server rejected the user name or password."
    if "SSL" in name or "Certificate" in name or "TLS" in name or "TLS" in str(exc).upper():
        return "The secure connection to the mail server failed. Check the port and the TLS setting."
    if "Recipient" in name or "SMTPRecipients" in name:
        return "The mail server refused the recipient address."
    if "Sender" in name:
        return "The mail server refused the sender address."
    if isinstance(exc, OSError) or "Connect" in name or "Disconnected" in name:
        return "Could not connect to the mail server. Check the host and port."
    return "The mail server did not accept the message."


async def verify_connection(smtp: dict) -> dict:
    import aiosmtplib

    sock = None
    client = None

    async def _probe() -> None:
        nonlocal sock, client
        sock = await connect_pinned(smtp["host"], smtp["port"])
        client = aiosmtplib.SMTP(sock=sock, **client_options(smtp, timeout=VERIFY_TIMEOUT_SECONDS, credentials=False))
        await client.connect()
        if smtp["username"]:
            await client.login(smtp["username"], smtp["password"])
        await client.quit()

    try:
        await asyncio.wait_for(_probe(), timeout=VERIFY_TIMEOUT_SECONDS + 5)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.info("Company mail check failed | %s", type(exc).__name__)
        return {"ok": False, "detail": describe_failure(exc)}
    finally:
        for closer in (getattr(client, "close", None), getattr(sock, "close", None)):
            try:
                if closer is not None:
                    closer()
            except Exception:
                pass
    detail = "Connected to the mail server"
    detail += " and signed in. No message was sent." if smtp["username"] else ". No user name is set, so signing in was not checked. No message was sent."
    return {"ok": True, "detail": detail}
