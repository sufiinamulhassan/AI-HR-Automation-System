import argparse
import asyncio
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from config import tenancy
from config.database import close_db, get_db, init_db
from config.llm import model_for, price_for, record_cost, reset_usage_tracking, start_usage_tracking
from services.hr_module.classifier import classify_resume
from services.hr_module.resume_profile import has_profile_data, profile_fields, split_profile
from services.hr_module.workspace_service import load_company

SOURCE = "resume_profile_backfill"
TEXT_CHARS = 4500
PROMPT_OVERHEAD_TOKENS = 620
COMPLETION_TOKENS = 900
CONCURRENCY = 3

PENDING = {"processing_status": "processed", "profile_version": None, "text": {"$nin": [None, ""]}}


def estimate_cost(text_lengths: list[int], price: dict) -> dict:
    prompt_tokens = sum(int(min(length, TEXT_CHARS) / 4) + PROMPT_OVERHEAD_TOKENS for length in text_lengths)
    completion_tokens = COMPLETION_TOKENS * len(text_lengths)
    cost = prompt_tokens / 1e6 * price["in"] + completion_tokens / 1e6 * price["out"]
    return {
        "resumes": len(text_lengths),
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "cost_usd": cost,
    }


PLATFORM_REFUSAL = "refusing to run for the platform company"


def refusal(company_id: str, company: dict | None) -> str | None:
    if company_id == tenancy.PLATFORM_COMPANY_ID or (company or {}).get("kind") == "platform":
        return PLATFORM_REFUSAL
    if not company:
        return f"unknown company: {company_id}"
    return None


def database_reachable() -> bool:
    with tenancy.company_context(tenancy.DEFAULT_COMPANY_ID):
        return get_db() is not None


async def pending_ids(db, limit: int | None) -> list[str]:
    cursor = db.resumes.find(PENDING, {"_id": 0, "resume_id": 1})
    if limit:
        cursor = cursor.limit(limit)
    return [row["resume_id"] async for row in cursor if row.get("resume_id")]


async def pending_lengths(db, limit: int | None) -> list[int]:
    cursor = db.resumes.find(PENDING, {"_id": 0, "text": 1})
    if limit:
        cursor = cursor.limit(limit)
    return [len(row.get("text") or "") async for row in cursor]


async def process_one(db, resume_id: str, semaphore: asyncio.Semaphore) -> str:
    async with semaphore:
        try:
            doc = await db.resumes.find_one({"resume_id": resume_id}, {"_id": 0, "text": 1, "classification": 1})
            text = (doc or {}).get("text")
            if not isinstance(text, str) or not text.strip():
                return "skipped"
            _, profile = split_profile(await classify_resume(text))
            if not has_profile_data(profile):
                return "empty"
            stored = doc.get("classification")
            job_domain = stored.get("job_domain") if isinstance(stored, dict) else None
            await db.resumes.update_one(
                {"resume_id": resume_id, "profile_version": None},
                {"$set": profile_fields(profile, job_domain)},
            )
            return "updated"
        except Exception as exc:
            print(f"  failed {resume_id}: {type(exc).__name__}: {exc}")
            return "failed"


async def report_dry_run(db, company: dict, limit: int | None) -> int:
    total = await db.resumes.count_documents(PENDING)
    model = model_for("resume")
    estimate = estimate_cost(await pending_lengths(db, limit), price_for(model))
    print(f"company: {company.get('company_id')} ({company.get('name') or 'unnamed'})")
    print(f"resumes missing profile fields: {total}")
    print(f"resumes in this run: {estimate['resumes']}" + (f" (limit {limit})" if limit else ""))
    print(f"model: {model}")
    print(
        f"estimated tokens: {estimate['prompt_tokens']} prompt, up to {estimate['completion_tokens']} completion"
    )
    print(f"estimated cost: up to ${estimate['cost_usd']:.4f}")
    print("\ndry run: nothing changed. Re-run with --apply.")
    return 0


async def apply_backfill(db, company: dict, limit: int | None) -> int:
    ids = await pending_ids(db, limit)
    print(f"company: {company.get('company_id')} ({company.get('name') or 'unnamed'})")
    print(f"resumes to process: {len(ids)}")
    start_usage_tracking()
    try:
        semaphore = asyncio.Semaphore(CONCURRENCY)
        outcomes = await asyncio.gather(*(process_one(db, resume_id, semaphore) for resume_id in ids))
    except BaseException:
        reset_usage_tracking()
        raise
    await record_cost(SOURCE, None, items=outcomes.count("updated"))
    remaining = await db.resumes.count_documents(PENDING)
    print(
        f"updated: {outcomes.count('updated')}, no profile data found: {outcomes.count('empty')}, "
        f"without text: {outcomes.count('skipped')}, failed: {outcomes.count('failed')}"
    )
    print(f"still missing profile fields: {remaining}")
    return 1 if outcomes.count("failed") else 0


async def run(args: argparse.Namespace) -> int:
    if args.company == tenancy.PLATFORM_COMPANY_ID:
        print(PLATFORM_REFUSAL)
        return 1
    if not database_reachable():
        print("MongoDB is not reachable.")
        return 1
    company = await load_company(args.company)
    problem = refusal(args.company, company)
    if problem:
        print(problem)
        return 1
    with tenancy.company_context(args.company, company):
        db = get_db()
        if db is None:
            print("MongoDB is not reachable.")
            return 1
        if args.apply:
            return await apply_backfill(db, company, args.limit)
        return await report_dry_run(db, company, args.limit)


def positive_int(value: str) -> int:
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("must be at least 1")
    return number


def parse_args(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Give existing resumes the profile fields used by the Resumes filters.")
    parser.add_argument("--company", required=True, help="company_id whose resumes are backfilled")
    parser.add_argument("--limit", type=positive_int, default=None, help="process at most this many resumes")
    parser.add_argument("--apply", action="store_true", help="call the model and write the fields (default: dry run)")
    return parser.parse_args(argv)


async def main(argv=None) -> int:
    args = parse_args(argv)
    await init_db()
    try:
        return await run(args)
    finally:
        await close_db()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
