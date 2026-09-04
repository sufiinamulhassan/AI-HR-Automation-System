"""Vercel Serverless Function entry point for the FastAPI backend.

Vercel turns every file under `api/` into a function. This one exposes the
existing app unchanged — `backend/main.py` stays the single source of truth for
routing, middleware and settings, and nothing in it knows this file exists.

Routing: `vercel.json` rewrites every `/api/*` and `/health` request here, and
the function receives the *original* request path — so `/api/v1/jobs` arrives at
FastAPI as `/api/v1/jobs`, matching the prefixes `main.py` mounts. If you ever
see a 404 for a path that works locally, that assumption is the first thing to
check: log `request.url.path` and compare.
"""
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND))

from config.database import init_db  # noqa: E402
from main import app  # noqa: E402


class EnsureDatabase:
    """Open the MongoDB connection on the first request of a cold start.

    `main.py` opens it from the lifespan handler, which is correct under
    uvicorn. A serverless host may never emit lifespan events at all, and if it
    does not, `get_db()` returns None for the whole process and every endpoint
    answers 503 "Database unavailable" — with nothing in the logs to say why.

    This is plain ASGI middleware rather than `@app.middleware("http")` on
    purpose: BaseHTTPMiddleware buffers responses, which would break the
    streaming endpoints (report PDFs, interview audio).

    `init_db()` is idempotent — it returns immediately once a previous call has
    connected — so on a warm invocation this costs one boolean check. A failed
    connect deliberately does not latch, so the next request retries.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            await init_db()
        await self.app(scope, receive, send)


app.add_middleware(EnsureDatabase)
