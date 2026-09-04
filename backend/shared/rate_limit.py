"""Mongo-backed fixed-window rate limiter.

No Redis and no in-memory counters — this backend runs serverless, where
in-process state doesn't survive across concurrent or cold-started
instances. Mongo is the one datastore guaranteed available everywhere, so a
fixed-window counter document (with a TTL index cleaning up old windows) is
the lowest-new-infra way to rate-limit endpoints like /login and
/verify-otp.
"""
import logging
from datetime import datetime, timezone

from fastapi import HTTPException

logger = logging.getLogger(__name__)


async def enforce_rate_limit(db, *, key: str, limit: int, window_seconds: int) -> None:
    """Raise 429 once more than `limit` calls land for `key` within the
    current `window_seconds`-wide fixed window. Fails open (no-op) if the
    database is unavailable — callers already 503 on that condition
    separately, so this never becomes the sole point of failure."""
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
        raise HTTPException(429, "Too many attempts — please try again later")
