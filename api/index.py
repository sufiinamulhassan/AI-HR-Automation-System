import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND))

from config.database import init_db
from main import app


class EnsureDatabase:

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            await init_db()
        await self.app(scope, receive, send)


app.add_middleware(EnsureDatabase)
