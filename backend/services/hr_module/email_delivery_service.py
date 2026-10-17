import asyncio
import inspect
import ipaddress
import logging
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

from bson import ObjectId
from bson.errors import InvalidId

from config.settings import settings
from services.hr_module import email_service
from services.hr_module.email_service import scrub_error_text
from shared.utils import is_invite_expired

logger = logging.getLogger(__name__)

HEALTH_WINDOW_DAYS = 7
RECENT_FAILURE_LIMIT = 20
MAX_RESEND_PER_CALL = 25

_RESEND_CONCURRENCY = 5
_RESEND_TIMEOUT_SECONDS = 10

VERIFY_TIMEOUT_SECONDS = 10

_WAITING_SCAN_LIMIT = 5000

INVITE_TEMPLATE = "interview_invitation"
TEST_TEMPLATE = "test_send"

_KIND_BY_TEMPLATE = {
    INVITE_TEMPLATE: "invite",
    "interview_status": "status",
    "rejection": "status",
    "offer_letter": "offer",
}


def current_provider() -> str | None:
    if settings.AWS_SES_ENABLED:
        return "ses"
    if settings.EMAIL_HOST:
        return "smtp"
    return None


def hostname_only(raw: str | None) -> str | None:
    value = (raw or "").strip()
    if not value:
        return None
    if "://" not in value:
        value = "//" + value
    try:
        return urlsplit(value).hostname or None
    except ValueError:
        return None


def kind_for(template: str | None) -> str:
    return _KIND_BY_TEMPLATE.get(template or "", "other")


_HINT_AUTH = (
    "Wrong username or password: check EMAIL_USERNAME and EMAIL_PASSWORD, and note that "
    "Gmail needs an App Password, not the normal account password."
)
_HINT_TLS = (
    "The TLS setting does not match the port: use EMAIL_USE_TLS=true for port 465 and "
    "EMAIL_USE_TLS=false for port 587."
)
_HINT_UNREACHABLE = (
    "The mail host or port is unreachable or blocked: check EMAIL_HOST and EMAIL_PORT, "
    "and that this server may connect out to that port."
)

_HINT_RULES: tuple[tuple[re.Pattern, str], ...] = (
    (re.compile(
        r"authentication (failed|unsuccessful|required)|smtpauthenticationerror|\b535\b|\b534\b"
        r"|username and password not accepted|invalid credentials|bad credentials"
        r"|application-specific password|app password",
        re.IGNORECASE,
    ), _HINT_AUTH),
    (re.compile(
        r"\bssl\b|\btls\b|starttls|certificate|wrong version number|handshake",
        re.IGNORECASE,
    ), _HINT_TLS),
    (re.compile(
        r"connection refused|connect call failed|timed out|timeout|name not known"
        r"|name or service not known|nodename nor servname|getaddrinfo|name resolution"
        r"|network is unreachable|no route to host|all connection attempts failed"
        r"|smtpconnecterror|errno (110|111|113)|winerror (10051|10060|10061)",
        re.IGNORECASE,
    ), _HINT_UNREACHABLE),
)


def hint_for_error(text: str | None) -> str | None:
    if not text:
        return None
    for pattern, hint in _HINT_RULES:
        if pattern.search(str(text)):
            return hint
    return None


def _scrub(text: str | None) -> str | None:
    cleaned = scrub_error_text(text)
    username = settings.EMAIL_USERNAME
    if cleaned and username and len(username) >= 3:
        cleaned = cleaned.replace(username, "***")
    return cleaned


_LOCAL_HOSTNAMES = {"localhost", "0.0.0.0", "::1"}
_PLACEHOLDER_SENDER_NAMES = {"", "hr platform", "your company", "your company name", "company name", "company"}
_PLACEHOLDER_SENDER_DOMAINS = {
    "company.com", "example.com", "example.org", "example.net",
    "yourcompany.com", "yourdomain.com", "domain.com",
}


def _is_local_url(url: str | None) -> bool:
    value = (url or "").strip()
    if not value:
        return False
    if "://" not in value:
        value = "//" + value
    try:
        host = urlsplit(value).hostname
    except ValueError:
        return False
    if not host:
        return False
    if host in _LOCAL_HOSTNAMES or host.endswith(".localhost"):
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _is_google_host(host: str | None) -> bool:
    host = (host or "").lower()
    return host in ("gmail.com", "googlemail.com") or host.endswith(
        (".gmail.com", ".googlemail.com", ".google.com")
    )


def boto3_available() -> bool:
    try:
        import boto3
    except ImportError:
        return False
    return True


def build_warnings(provider: str | None) -> list[dict]:
    warnings: list[dict] = []

    if not settings.DEBUG and _is_local_url(settings.FRONTEND_URL):
        warnings.append({
            "code": "frontend_url_local",
            "message": (
                f"FRONTEND_URL is {settings.FRONTEND_URL}, which points at this machine. "
                "Every link in an emailed invite would be dead for candidates. "
                "Set FRONTEND_URL to your public site address."
            ),
        })

    if (settings.EMAIL_FROM_NAME or "").strip().lower() in _PLACEHOLDER_SENDER_NAMES:
        warnings.append({
            "code": "from_name_placeholder",
            "message": (
                "EMAIL_FROM_NAME is still the placeholder, so candidates see a generic "
                "sender name. Set it to your company name."
            ),
        })

    sender = (settings.EMAIL_FROM or "").strip().lower()
    sender_domain = sender.rsplit("@", 1)[-1] if "@" in sender else ""
    if not sender or sender_domain in _PLACEHOLDER_SENDER_DOMAINS:
        warnings.append({
            "code": "from_address_placeholder",
            "message": (
                "EMAIL_FROM is still a placeholder address. Mail from an address your "
                "provider does not own is usually rejected or sent to spam. "
                "Set it to a real address on your domain."
            ),
        })

    if settings.AWS_SES_ENABLED and not boto3_available():
        warnings.append({
            "code": "ses_boto3_missing",
            "message": (
                "AWS SES is enabled but the boto3 library is not installed on this server, "
                "so no email can be sent. Use SMTP instead, or add boto3 to the deployment."
            ),
        })

    if provider == "smtp" and _is_google_host(hostname_only(settings.EMAIL_HOST)):
        warnings.append({
            "code": "google_app_password",
            "message": (
                "This server sends through Gmail or Google. Google requires an App Password "
                "(with 2-step verification turned on), not the account password."
            ),
        })

    return warnings


def _utc_iso(delta: timedelta = timedelta()) -> str:
    return (datetime.now(timezone.utc) + delta).isoformat()


async def get_delivery_health(db) -> dict:
    provider = current_provider()

    since = _utc_iso(-timedelta(days=HEALTH_WINDOW_DAYS))
    grouped = await db.email_log.aggregate([
        {"$match": {"created_at": {"$gte": since}}},
        {"$group": {"_id": "$status", "n": {"$sum": 1}}},
    ]).to_list(length=None)
    by_status = {row["_id"]: row["n"] for row in grouped}

    failed_rows = await (
        db.email_log.find({"status": "failed"})
        .sort("created_at", -1)
        .limit(RECENT_FAILURE_LIMIT)
        .to_list(length=RECENT_FAILURE_LIMIT)
    )

    return {
        "configured": provider is not None,
        "provider": provider,
        "from_address": settings.EMAIL_FROM if provider else None,
        "from_name": (settings.EMAIL_FROM_NAME or None) if provider else None,
        "host": hostname_only(settings.EMAIL_HOST) if provider == "smtp" else None,
        "frontend_url": settings.FRONTEND_URL or None,
        "warnings": build_warnings(provider),
        "waiting_invites": await count_waiting_invites(db),
        "last_7d": {
            "sent": by_status.get("sent", 0),
            "failed": by_status.get("failed", 0),
            "console_only": by_status.get("not_sent", 0),
        },
        "recent_failures": [
            {
                "log_id": str(row["_id"]),
                "to": row.get("to"),
                "subject": row.get("subject"),
                "kind": kind_for(row.get("template")),
                "candidate_id": row.get("candidate_id"),
                "created_at": row.get("created_at"),
                "error": scrub_error_text(row.get("error")),
                "hint": hint_for_error(row.get("error")),
            }
            for row in failed_rows
        ],
    }


async def send_test_email(db, *, to: str) -> dict:
    provider = current_provider()
    if provider is None:
        return {
            "delivered": False,
            "status": "not_configured",
            "detail": (
                "No email provider is configured: set EMAIL_HOST for SMTP or "
                "enable AWS SES. Nothing was sent."
            ),
        }

    started = _utc_iso()
    subject = f"{settings.APP_NAME} email delivery test"
    text_body = (
        f"This is a test message from {settings.APP_NAME}.\n\n"
        f"Transport: {provider.upper()}\n"
        f"Sent at: {started}\n\n"
        "If you received it, outbound email is working. No action is needed."
    )
    html_body = (
        f"<p>This is a test message from {settings.APP_NAME}.</p>"
        f"<p>Transport: {provider.upper()}<br>Sent at: {started}</p>"
        "<p>If you received it, outbound email is working. No action is needed.</p>"
    )

    try:
        ok = await email_service.send_email(
            to=to, subject=subject, html_body=html_body, text_body=text_body,
            db=db, template=TEST_TEMPLATE,
        )
    except Exception as exc:
        logger.error("Test email raised | to=%s error=%s", to, exc)
        return {
            "delivered": False,
            "status": "failed",
            "detail": f"Sending raised an error: {scrub_error_text(f'{type(exc).__name__}: {exc}')}",
        }

    if ok:
        return {
            "delivered": True,
            "status": "sent",
            "detail": f"The {provider.upper()} provider accepted the message for {to}.",
        }

    reason = None
    row = await db.email_log.find_one(
        {"to": to, "template": TEST_TEMPLATE, "status": "failed", "created_at": {"$gte": started}},
        sort=[("created_at", -1)],
    )
    if row:
        reason = scrub_error_text(row.get("error"))
    return {
        "delivered": False,
        "status": "failed",
        "detail": (
            f"The {provider.upper()} provider did not accept the message"
            + (f": {reason}" if reason else ". Check the server log for the error.")
        ),
    }


async def _close_quietly(client) -> None:
    if client is None:
        return
    try:
        result = client.close()
        if inspect.isawaitable(result):
            await result
    except Exception:
        pass


def _failure(provider: str, where: str, exc: BaseException) -> dict:
    raw = (_scrub(f"{type(exc).__name__}: {exc}") or "")[:200]
    hint = hint_for_error(raw)
    detail = f"The check against {where} failed."
    if hint:
        detail += f" {hint}"
    if raw:
        detail += f" Details: {raw}"
    return {"ok": False, "provider": provider, "detail": detail}


def _timed_out(provider: str, where: str) -> dict:
    return {
        "ok": False,
        "provider": provider,
        "detail": (
            f"{where} did not answer within {VERIFY_TIMEOUT_SECONDS} seconds. "
            "Nothing was sent. Check the host and port, and that outbound connections are allowed."
        ),
    }


async def _verify_smtp() -> dict:
    import aiosmtplib

    where = hostname_only(settings.EMAIL_HOST) or "the mail server"
    client = None

    async def _probe() -> None:
        nonlocal client
        client = aiosmtplib.SMTP(
            hostname=settings.EMAIL_HOST,
            port=settings.EMAIL_PORT,
            use_tls=settings.EMAIL_USE_TLS,
            timeout=VERIFY_TIMEOUT_SECONDS,
        )
        await client.connect()
        if settings.EMAIL_USERNAME:
            await client.login(settings.EMAIL_USERNAME, settings.EMAIL_PASSWORD or "")
        await client.quit()

    try:
        await asyncio.wait_for(_probe(), timeout=VERIFY_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        await _close_quietly(client)
        return _timed_out("smtp", where)
    except Exception as exc:
        await _close_quietly(client)
        return _failure("smtp", where, exc)

    if settings.EMAIL_USERNAME:
        detail = f"Connected to {where} and signed in with the configured account. No message was sent."
    else:
        detail = (
            f"Connected to {where}. No username is configured, so signing in was not checked. "
            "No message was sent."
        )
    return {"ok": True, "provider": "smtp", "detail": detail}


async def _verify_ses() -> dict:
    try:
        import boto3
    except ImportError:
        return {
            "ok": False,
            "provider": "ses",
            "detail": (
                "AWS SES is enabled but the boto3 library is not installed on this server, so "
                "email cannot be checked or sent. Use SMTP instead, or add boto3 to the deployment."
            ),
        }

    def _quota() -> dict:
        client = boto3.client("ses", region_name=settings.AWS_SES_REGION or None)
        return client.get_send_quota()

    try:
        quota = await asyncio.wait_for(
            asyncio.get_running_loop().run_in_executor(None, _quota),
            timeout=VERIFY_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        return _timed_out("ses", "AWS SES")
    except Exception as exc:
        failure = _failure("ses", "AWS SES", exc)
        if re.search(r"credentials|security token|signature|access ?denied|not authorized", failure["detail"], re.IGNORECASE):
            failure["detail"] += " Check the AWS credentials or IAM role this server runs with."
        return failure

    detail = "AWS SES accepted the credentials and answered a quota check."
    try:
        used, cap = int(quota["SentLast24Hours"]), int(quota["Max24HourSend"])
        if cap > 0:
            detail = (
                "AWS SES accepted the credentials and answered a quota check "
                f"({used} of {cap} messages used in the last 24 hours)."
            )
    except (KeyError, TypeError, ValueError):
        pass
    return {"ok": True, "provider": "ses", "detail": f"{detail} No message was sent."}


async def verify_email_transport() -> dict:
    provider = current_provider()
    if provider is None:
        return {
            "ok": False,
            "provider": None,
            "detail": (
                "No email provider is configured: set EMAIL_HOST for SMTP or enable AWS SES. "
                "Nothing was checked."
            ),
        }
    try:
        return await (_verify_ses() if provider == "ses" else _verify_smtp())
    except Exception as exc:
        logger.error("Email transport check raised | provider=%s error=%s", provider, type(exc).__name__)
        return _failure(provider, "the mail transport", exc)


def _skip(log_id: str, reason: str) -> dict:
    return {"log_id": log_id, "outcome": "skipped", "reason": reason}


async def _select_recent_failed_invites(db, limit: int) -> list[str]:
    chosen: list[str] = []
    seen: set[str] = set()
    cursor = (
        db.email_log.find({
            "status": "failed",
            "template": INVITE_TEMPLATE,
            "candidate_id": {"$nin": [None, ""]},
        })
        .sort("created_at", -1)
        .limit(limit * 20)
    )
    async for row in cursor:
        cid = row["candidate_id"]
        if cid in seen:
            continue
        seen.add(cid)
        chosen.append(str(row["_id"]))
        if len(chosen) >= limit:
            break
    return chosen


async def _check_resendable(db, log_id: str, seen_candidates: set[str]) -> tuple[dict | None, str | None]:
    try:
        oid = ObjectId(log_id)
    except (InvalidId, TypeError):
        return None, "invalid_log_id"

    row = await db.email_log.find_one({"_id": oid})
    if row is None:
        return None, "log_not_found"
    if row.get("status") != "failed":
        return None, "not_failed"
    if row.get("template") != INVITE_TEMPLATE:
        return None, "not_an_invite"

    candidate_id = row.get("candidate_id")
    if not candidate_id:
        return None, "no_candidate"
    if candidate_id in seen_candidates:
        return None, "duplicate_candidate"

    superseded = await db.email_log.find_one({
        "candidate_id": candidate_id,
        "template": INVITE_TEMPLATE,
        "status": "sent",
        "created_at": {"$gt": row.get("created_at") or ""},
    }, {"_id": 1})
    if superseded:
        return None, "already_delivered_since"

    candidate = await db.candidates.find_one({"candidate_id": candidate_id})
    if candidate is None:
        return None, "candidate_not_found"
    if not candidate.get("email"):
        return None, "no_email"
    if candidate.get("interview_mode") == "external":
        return None, "interviewed_on_another_platform"
    if candidate.get("token_status") == "consumed":
        return None, "interview_already_completed"
    if is_invite_expired(candidate, days=settings.INVITE_LINK_EXPIRY_DAYS):
        return None, "invite_expired"

    seen_candidates.add(candidate_id)
    return candidate, None


async def _resend_one(db, candidate: dict, admin_email: str) -> bool:
    from services.hr_module.invite_service import send_manual_invite

    try:
        ok = await asyncio.wait_for(
            send_manual_invite(candidate=candidate, admin_email=admin_email),
            timeout=_RESEND_TIMEOUT_SECONDS,
        )
    except Exception as exc:
        logger.error(
            "Invite resend raised | candidate_id=%s error=%s",
            candidate.get("candidate_id"), type(exc).__name__,
        )
        return False
    if not ok:
        return False

    await db.candidates.update_one(
        {"candidate_id": candidate["candidate_id"]},
        {
            "$set": {
                "last_resent_at": _utc_iso(),
                "last_resent_by": admin_email,
                "invite_email_delivered": True,
            },
            "$inc": {"invite_resent_count": 1},
        },
    )
    return True


async def resend_failed_invites(
    db, *, admin_email: str, log_ids: list[str] | None, limit: int,
) -> dict:
    ids = await _select_recent_failed_invites(db, limit) if log_ids is None else list(log_ids)

    provider = current_provider()
    results: list[dict] = []
    to_send: list[tuple[str, dict]] = []
    seen_candidates: set[str] = set()

    for log_id in ids:
        if provider is None:
            results.append(_skip(log_id, "no_email_provider_configured"))
            continue
        candidate, reason = await _check_resendable(db, log_id, seen_candidates)
        if reason:
            results.append(_skip(log_id, reason))
        else:
            to_send.append((log_id, candidate))

    gate = asyncio.Semaphore(_RESEND_CONCURRENCY)

    async def _run(candidate: dict) -> bool:
        async with gate:
            return await _resend_one(db, candidate, admin_email)

    outcomes = await asyncio.gather(*(_run(c) for _, c in to_send))
    delivered = failed = 0
    for (log_id, _candidate), ok in zip(to_send, outcomes):
        if ok:
            delivered += 1
            results.append({"log_id": log_id, "outcome": "delivered", "reason": None})
        else:
            failed += 1
            results.append({"log_id": log_id, "outcome": "failed", "reason": "send_failed"})

    order = {log_id: i for i, log_id in enumerate(ids)}
    results.sort(key=lambda r: order.get(r["log_id"], len(order)))
    return {
        "attempted": delivered + failed,
        "delivered": delivered,
        "failed": failed,
        "skipped": len(results) - delivered - failed,
        "results": results,
    }


_WAITING_PROJECTION = {
    "_id": 0, "candidate_id": 1, "job_id": 1, "name": 1, "email": 1, "secure_token": 1,
    "interview_mode": 1, "invite_expires_at": 1, "invite_sent_at": 1, "created_at": 1,
    "token_regenerated_at": 1,
}


def _waiting_filter() -> dict:
    return {
        "doc_type": "candidate",
        "interview_mode": {"$ne": "external"},
        "pipeline_stage": "invited",
        "token_status": "active",
        "invite_email_delivered": {"$ne": True},
        "email": {"$nin": [None, ""]},
        "secure_token": {"$nin": [None, ""]},
    }


async def list_waiting_invites(db) -> list[dict]:
    cursor = (
        db.candidates.find(_waiting_filter(), _WAITING_PROJECTION)
        .sort("created_at", 1)
        .limit(_WAITING_SCAN_LIMIT)
    )
    waiting: list[dict] = []
    async for candidate in cursor:
        if candidate.get("interview_mode") == "external":
            continue
        if is_invite_expired(candidate, days=settings.INVITE_LINK_EXPIRY_DAYS):
            continue
        waiting.append(candidate)

    if waiting:
        delivered = set(await db.email_log.distinct("candidate_id", {
            "template": INVITE_TEMPLATE,
            "status": "sent",
            "candidate_id": {"$in": [c["candidate_id"] for c in waiting]},
        }))
        waiting = [c for c in waiting if c["candidate_id"] not in delivered]
    return waiting


async def count_waiting_invites(db) -> int:
    return len(await list_waiting_invites(db))


async def resend_waiting_invites(db, *, admin_email: str, limit: int) -> dict:
    waiting = await list_waiting_invites(db)
    batch = waiting[:limit]

    if current_provider() is None:
        return {"attempted": 0, "sent": 0, "failed": 0, "skipped": len(batch), "remaining": len(waiting)}

    to_send: list[dict] = []
    skipped = 0
    for candidate in batch:
        if candidate.get("interview_mode") == "external" or not candidate.get("email") or not candidate.get("secure_token"):
            skipped += 1
        else:
            to_send.append(candidate)

    gate = asyncio.Semaphore(_RESEND_CONCURRENCY)

    async def _run(candidate: dict) -> bool:
        async with gate:
            return await _resend_one(db, candidate, admin_email)

    outcomes = await asyncio.gather(*(_run(c) for c in to_send))
    sent = sum(1 for ok in outcomes if ok)
    return {
        "attempted": len(outcomes),
        "sent": sent,
        "failed": len(outcomes) - sent,
        "skipped": skipped,
        "remaining": await count_waiting_invites(db),
    }
