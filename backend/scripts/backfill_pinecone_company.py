import argparse
import asyncio
import sys
from dataclasses import dataclass, field
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

BATCH = 100

RESUME_NAMESPACE = ""
JOB_NAMESPACE = "jobs"


@dataclass
class Tally:
    kind: str
    namespace: str
    seen: int = 0
    already_tagged: int = 0
    missing: int = 0
    to_tag: list[str] = field(default_factory=list)
    tagged: int = 0
    failed: int = 0


def _metadata_of(vector) -> dict:
    if isinstance(vector, dict):
        return vector.get("metadata") or {}
    return getattr(vector, "metadata", None) or {}


def _vectors_of(fetched) -> dict:
    if isinstance(fetched, dict):
        return fetched.get("vectors") or {}
    return getattr(fetched, "vectors", None) or {}


async def _classify(index, ids: list[str], namespace: str, tally: Tally) -> None:
    for start in range(0, len(ids), BATCH):
        chunk = ids[start:start + BATCH]
        found = _vectors_of(await asyncio.to_thread(index.fetch, ids=chunk, namespace=namespace))
        for vector_id in chunk:
            tally.seen += 1
            vector = found.get(vector_id)
            if vector is None:
                tally.missing += 1
            elif _metadata_of(vector).get("company_id"):
                tally.already_tagged += 1
            else:
                tally.to_tag.append(vector_id)


async def _tag(index, company_id: str, tally: Tally) -> None:
    for vector_id in tally.to_tag:
        try:
            await asyncio.to_thread(
                index.update, id=vector_id, set_metadata={"company_id": company_id}, namespace=tally.namespace,
            )
            tally.tagged += 1
        except Exception as exc:
            tally.failed += 1
            print(f"  could not tag {tally.kind} {vector_id}: {type(exc).__name__}: {exc}")


async def backfill(index, resume_ids: list[str], job_ids: list[str], company_id: str, *, apply: bool) -> list[Tally]:
    tallies = [Tally("resume", RESUME_NAMESPACE), Tally("job", JOB_NAMESPACE)]
    for tally, ids in zip(tallies, (resume_ids, job_ids)):
        await _classify(index, list(dict.fromkeys(ids)), tally.namespace, tally)
        if apply:
            await _tag(index, company_id, tally)
    return tallies


def report(tallies: list[Tally], company_id: str, *, apply: bool) -> None:
    print(f"company: {company_id}")
    for t in tallies:
        done = f"tagged {t.tagged}, failed {t.failed}" if apply else f"would tag {len(t.to_tag)}"
        print(
            f"{t.kind}s: {t.seen} in MongoDB, {t.already_tagged} already tagged, "
            f"{t.missing} not in Pinecone, {done}"
        )
    if not apply:
        print("\ndry run: nothing changed. Re-run with --apply.")


def parse_args(argv=None) -> argparse.Namespace:
    from config.tenancy import DEFAULT_COMPANY_ID

    parser = argparse.ArgumentParser(description="Tag existing Pinecone vectors with a company_id.")
    parser.add_argument("--apply", action="store_true", help="write the tags (default: dry run)")
    parser.add_argument("--company", default=DEFAULT_COMPANY_ID, help="company that owns the ids (default: %(default)s)")
    return parser.parse_args(argv)


async def run(args: argparse.Namespace) -> int:
    from config.database import get_db, get_pinecone, init_db
    from config.tenancy import company_context

    await init_db()
    index = get_pinecone()
    if index is None:
        print("Pinecone is not configured (PINECONE_API_KEY): nothing to do.")
        return 1

    with company_context(args.company):
        db = get_db()
        if db is None:
            print("MongoDB is not reachable.")
            return 1
        resume_ids = [d["resume_id"] async for d in db.resumes.find({}, {"_id": 0, "resume_id": 1}) if d.get("resume_id")]
        job_ids = [d["job_id"] async for d in db.jobs.find({}, {"_id": 0, "job_id": 1}) if d.get("job_id")]

    tallies = await backfill(index, resume_ids, job_ids, args.company, apply=args.apply)
    report(tallies, args.company, apply=args.apply)
    return 1 if any(t.failed for t in tallies) else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(run(parse_args())))
