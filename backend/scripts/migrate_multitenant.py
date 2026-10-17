import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from motor.motor_asyncio import AsyncIOMotorClient

from config.settings import settings
from config.tenancy_migration import (
    SCHEMA_KEY,
    _has_unstamped_data,
    _tenant_collections,
    migrate,
)


async def main(apply: bool) -> int:
    client = AsyncIOMotorClient(settings.MONGODB_URI, serverSelectionTimeoutMS=8000)
    raw = client[settings.MONGODB_DB]
    try:
        marker = await raw.settings.find_one({"key": SCHEMA_KEY})
        print(f"database: {settings.MONGODB_DB}")
        print(f"migration marker: {marker.get('version') if marker else 'not set'}")

        unstamped: dict[str, int] = {}
        for name in await _tenant_collections(raw):
            count = await raw[name].count_documents({"company_id": {"$exists": False}})
            if count:
                unstamped[name] = count
        print("rows without a company:")
        for name, count in sorted(unstamped.items()):
            print(f"  {name}: {count}")
        if not unstamped:
            print("  none")

        if not apply:
            print("\ndry run: nothing changed. Re-run with --apply.")
            return 0

        report = await migrate(raw, owner_email=settings.DEFAULT_SUPERADMIN_EMAIL)
        print(f"\napplied: {report}")
        still = await _has_unstamped_data(raw)
        print("rows still without a company:", "yes" if still else "none")
        return 1 if still else 0
    finally:
        client.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="make the changes (default: report only)")
    sys.exit(asyncio.run(main(parser.parse_args().apply)))
