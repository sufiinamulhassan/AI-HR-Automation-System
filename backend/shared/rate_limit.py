import hashlib
import logging
import os
from datetime import datetime, timezone

from fastapi import HTTPException

logger = logging.getLogger(__name__)


async def enforce_rate_limit(db, *, key: str, limit: int, window_seconds: int) -> None:
    if db is None:
        return
    now_ts = datetime.now(timezone.utc).timestamp()
    window_start = int(now_ts // window_seconds) * window_seconds
    doc_id = f"{key}:{window_start}"

    result = await db.rate_limits.find_one_and_update(
        {"_id": doc_id},
        {
            "$inc": {"count": 1},
            "$setOnInsert": {
                "expires_at": datetime.fromtimestamp(window_start + window_seconds, tz=timezone.utc),
            },
        },
        upsert=True,
        return_document=True,
    )
    count = (result or {}).get("count", 1)
    if count > limit:
        logger.warning("Rate limit exceeded | key=%s count=%s limit=%s", key, count, limit)
        raise HTTPException(429, "Too many attempts: please try again later")


PUBLIC_WINDOW_SECONDS = 60


def _trusted_ip_header() -> str:
    from config.settings import settings

    configured = (settings.CLIENT_IP_HEADER or "").strip().lower()
    if configured:
        return configured
    return "x-vercel-forwarded-for" if os.environ.get("VERCEL") else ""


def client_ip(request) -> str:
    header = _trusted_ip_header()
    if header:
        value = ((getattr(request, "headers", None) or {}).get(header) or "").split(",")[0].strip()
        if value:
            return value
    return request.client.host if request.client else "unknown"


def public_token_throttle(
    scope: str, *, ip_limit: int, token_limit: int | None = None,
    param: str | None = "secure_token", window_seconds: int = PUBLIC_WINDOW_SECONDS,
    tenant: str | None = None,
):
    from fastapi import Request

    async def _throttle(request: Request) -> None:
        from config.database import get_platform_db

        db = get_platform_db()
        await enforce_rate_limit(
            db, key=f"public:{scope}:ip:{client_ip(request)}", limit=ip_limit, window_seconds=window_seconds,
        )
        token = request.path_params.get(param) if param else None
        if token and token_limit:
            digest = hashlib.sha256(str(token).encode("utf-8")).hexdigest()[:24]
            await enforce_rate_limit(
                db, key=f"public:{scope}:token:{digest}", limit=token_limit, window_seconds=window_seconds,
            )
        if tenant:
            from shared.tenant_deps import bind_company_for_token

            await bind_company_for_token(tenant, str(token) if token else None)

    _throttle.tenant_kind = tenant
    return _throttle
