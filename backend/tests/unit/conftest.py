"""Minimal conftest for unit tests — no DB or network required.

Overrides the autouse session fixtures from tests/conftest.py so these
tests run without MongoDB or Pinecone.
"""
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
