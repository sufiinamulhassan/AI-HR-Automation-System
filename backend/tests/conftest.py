import os
import sys
import pytest
from pathlib import Path
from httpx import AsyncClient, ASGITransport
from dotenv import load_dotenv

backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

load_dotenv(backend_dir / ".env")

from config.settings import settings

settings.DEBUG = True
if settings.SECRET_KEY == "change-me-in-production-32-chars-min":
    settings.SECRET_KEY = "test-secret-key-not-used-in-production-32chars"
if settings.DEFAULT_SUPERADMIN_PASSWORD == "qwerty@54321":
    settings.DEFAULT_SUPERADMIN_PASSWORD = "test-superadmin-password"

from config.database import get_db, init_db, close_db
from main import app
from passlib.context import CryptContext


def apply_test_database_settings() -> None:
    """Point tests at the dedicated test cluster/database from .env."""
    settings.MONGODB_URI = settings.MONGODB_TEST_URI or settings.MONGODB_URI
    settings.MONGODB_DB = settings.MONGODB_TEST
    settings.PINECONE_API_KEY = settings.PINECONE_API_KEY_TEST
    settings.PINECONE_INDEX_NAME = settings.PINECONE_INDEX_NAME_TEST
    settings.PINECONE_ENV = settings.PINECONE_ENV_TEST
    settings.ALLOW_DEMO_AUTH = True


apply_test_database_settings()

pwd_ctx = CryptContext(schemes=["bcrypt"])


@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"


@pytest.fixture(scope="session")
async def client():
    apply_test_database_settings()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test", follow_redirects=True) as ac:
        yield ac


@pytest.fixture(scope="session", autouse=True)
async def setup_test_db(client):
    apply_test_database_settings()

    try:
        await init_db()
    except Exception as e:
        print(f"Error during init_db in conftest: {e}")
        raise e

    db = get_db()
    if db is None:
        print(
            f"Database settings: URI={settings.MONGODB_URI}, DB={settings.MONGODB_DB}"
        )
        raise RuntimeError("Database connection not initialized by conftest init_db")

    await db.users.delete_many({})
    await db.jobs.delete_many({})
    await db.resumes.delete_many({})
    await db.candidates.delete_many({})
    await db.upload_batches.delete_many({})
    await db[settings.MARKETPLACE_COLLECTION].delete_many({})

    users = [
        {
            "name": "Super Admin",
            "email": "superadmin@hirely.ai",
            "password_hash": pwd_ctx.hash("change-me-in-production"),
            "role": "superadmin",
            "otp_required": False,
            "is_active": True,
        },
        {
            "name": "HR Admin",
            "email": "hradmin@hirely.ai",
            "password_hash": pwd_ctx.hash("Admin@123"),
            "role": "admin",
            "otp_required": False,
            "is_active": True,
        },
        {
            "name": "Standard User",
            "email": "user@hirely.ai",
            "password_hash": pwd_ctx.hash("User@123"),
            "role": "standard",
            "otp_required": False,
            "is_active": True,
        }
    ]
    await db.users.insert_many(users)

    yield db

    await db.users.delete_many({})
    await db.jobs.delete_many({})
    await db.resumes.delete_many({})
    await db.candidates.delete_many({})
    await db.upload_batches.delete_many({})
    await db[settings.MARKETPLACE_COLLECTION].delete_many({})
    await close_db()


@pytest.fixture
def admin_headers():
    return {"Authorization": "Bearer demo-admin-token"}


@pytest.fixture
def standard_headers():
    return {"Authorization": "Bearer demo-standard-token"}


@pytest.fixture
def superadmin_headers():
    return {"Authorization": "Bearer demo-superadmin-token"}
