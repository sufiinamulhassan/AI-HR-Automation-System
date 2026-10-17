import sys
from pathlib import Path
from unittest.mock import MagicMock, AsyncMock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))


@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"


@pytest.fixture(scope="session")
def client():
    return MagicMock()


@pytest.fixture(scope="session", autouse=True)
def setup_test_db(client):
    yield MagicMock()


@pytest.fixture(autouse=True)
def careers_cache_off(monkeypatch):
    from config.settings import settings

    monkeypatch.setattr(settings, "CAREERS_CACHE_SECONDS", 0)


@pytest.fixture(autouse=True)
def demo_company_unset(monkeypatch):
    from config.settings import settings

    monkeypatch.setattr(settings, "DEMO_COMPANY_ID", "")
