import argparse
import asyncio
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from shared.utils import strip_em_dashes

BACKUP_COLLECTION = "scrub_backup"


@dataclass(frozen=True)
class Change:
    collection: str
    doc_key: str
    path: str
    original: str
    scrubbed: str


def find_changes(value, path: str) -> list[tuple[str, str, str]]:
    found: list[tuple[str, str, str]] = []
    if isinstance(value, str):
        cleaned = strip_em_dashes(value)
        if cleaned != value:
            found.append((path, value, cleaned))
    elif isinstance(value, dict):
        for key, item in value.items():
            found.extend(find_changes(item, f"{path}.{key}" if path else str(key)))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            found.extend(find_changes(item, f"{path}.{index}" if path else str(index)))
    return found


def normalise_path(path: str) -> str:
    return ".".join("[]" if part.isdigit() else part for part in path.split("."))


def _candidate_roots(doc: dict) -> list[tuple[str, object]]:
    roots: list[tuple[str, object]] = []
    report = doc.get("report")
    human_report = isinstance(report, dict) and report.get("source") == "interviewer_scorecard"
    if not human_report:
        roots.append(("report", report))
        roots.append(("score_breakdown", doc.get("score_breakdown")))
    roots.append(("_questions", doc.get("_questions")))
    guide = doc.get("interview_guide")
    if isinstance(guide, dict):
        for index, question in enumerate(guide.get("questions") or []):
            if isinstance(question, dict) and (question.get("source") or "ai") == "ai":
                for field in ("text", "listen_for"):
                    roots.append((f"interview_guide.questions.{index}.{field}", question.get(field)))
    return roots


def _offer_roots(doc: dict) -> list[tuple[str, object]]:
    if doc.get("ai_letter_source") == "ai":
        return [("ai_letter_body", doc.get("ai_letter_body"))]
    return []


def _submission_roots(doc: dict) -> list[tuple[str, object]]:
    return [("quality", doc.get("quality")), ("ai_correctness", doc.get("ai_correctness"))]


TARGETS = {
    "candidates": (
        "candidate_id",
        ("report", "score_breakdown", "_questions", "interview_guide"),
        _candidate_roots,
    ),
    "offers": ("offer_id", ("ai_letter_body", "ai_letter_source"), _offer_roots),
    "coding_submissions": ("submission_id", ("quality", "ai_correctness"), _submission_roots),
}


def plan_document(collection: str, doc: dict) -> list[Change]:
    key_field, _fields, roots_of = TARGETS[collection]
    doc_key = doc.get(key_field)
    if not doc_key:
        return []
    changes: list[Change] = []
    for root_path, value in roots_of(doc):
        for path, original, scrubbed in find_changes(value, root_path):
            changes.append(Change(collection, str(doc_key), path, original, scrubbed))
    return changes


def get_path(doc, path: str):
    node = doc
    for part in path.split("."):
        if isinstance(node, dict):
            node = node.get(part)
        elif isinstance(node, list) and part.isdigit() and int(part) < len(node):
            node = node[int(part)]
        else:
            return None
    return node


def set_path(doc, path: str, value) -> None:
    parts = path.split(".")
    node = doc
    for part in parts[:-1]:
        node = node[int(part)] if isinstance(node, list) else node[part]
    last = parts[-1]
    if isinstance(node, list):
        node[int(last)] = value
    else:
        node[last] = value


def summarise(changes: list[Change]) -> dict[tuple[str, str], dict]:
    grouped: dict[tuple[str, str], dict] = {}
    docs: dict[tuple[str, str], set] = {}
    for change in changes:
        key = (change.collection, normalise_path(change.path))
        grouped.setdefault(key, {"strings": 0, "documents": 0})["strings"] += 1
        docs.setdefault(key, set()).add(change.doc_key)
    for key, ids in docs.items():
        grouped[key]["documents"] = len(ids)
    return grouped


def format_summary(summary: dict[tuple[str, str], dict]) -> str:
    if not summary:
        return "  nothing to change"
    width = max(len(f"{c}.{p}") for c, p in summary)
    lines = [f"  {(c + '.' + p).ljust(width)}  {v['strings']:>6} string(s) in {v['documents']:>5} document(s)"
             for (c, p), v in sorted(summary.items())]
    return "\n".join(lines)


async def scan(db, collections) -> list[Change]:
    changes: list[Change] = []
    for name in collections:
        key_field, fields, _roots = TARGETS[name]
        projection = {"_id": 0, key_field: 1, **{f: 1 for f in fields}}
        async for doc in db[name].find({}, projection):
            changes.extend(plan_document(name, doc))
    return changes


async def apply_changes(db, changes: list[Change]) -> int:
    by_doc: dict[tuple[str, str], list[Change]] = {}
    for change in changes:
        by_doc.setdefault((change.collection, change.doc_key), []).append(change)

    written = 0
    for (collection, doc_key), items in by_doc.items():
        key_field = TARGETS[collection][0]
        now = datetime.now(timezone.utc).isoformat()
        try:
            await db[BACKUP_COLLECTION].insert_many([
                {
                    "collection": c.collection, "doc_key": c.doc_key, "path": c.path,
                    "original": c.original, "scrubbed": c.scrubbed, "scrubbed_at": now,
                }
                for c in items
            ])
        except Exception as exc:
            print(f"  skipped {collection} {doc_key}: backup failed ({type(exc).__name__})")
            continue
        await db[collection].update_one(
            {key_field: doc_key}, {"$set": {c.path: c.scrubbed for c in items}},
        )
        written += 1
    return written


async def restore_changes(db, collections, *, apply: bool) -> dict:
    found = restored = skipped = 0
    async for row in db[BACKUP_COLLECTION].find({"collection": {"$in": list(collections)}}):
        found += 1
        collection, path = row["collection"], row["path"]
        if collection not in TARGETS:
            skipped += 1
            continue
        key_field = TARGETS[collection][0]
        doc = await db[collection].find_one({key_field: row["doc_key"]})
        current = get_path(doc, path) if doc else None
        if current != row.get("scrubbed"):
            skipped += 1
            continue
        if apply:
            await db[collection].update_one({key_field: row["doc_key"]}, {"$set": {path: row["original"]}})
            await db[BACKUP_COLLECTION].delete_one({"_id": row["_id"]})
        restored += 1
    return {"found": found, "restored": restored, "skipped": skipped}


def parse_args(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Remove em dashes from AI-written text already stored. Dry run unless --apply.",
    )
    parser.add_argument("--apply", action="store_true", help="write the changes (default is a dry run)")
    parser.add_argument("--restore", action="store_true", help="put the backed-up originals back (dry run unless --apply)")
    parser.add_argument(
        "--collection", action="append", choices=sorted(TARGETS),
        help="limit to one collection; repeat for several (default: all)",
    )
    return parser.parse_args(argv)


async def run(args: argparse.Namespace) -> int:
    from config.database import get_db, init_db

    await init_db()
    db = get_db()
    if db is None:
        print("The database is not reachable. Check MONGODB_URI.")
        return 1
    collections = args.collection or sorted(TARGETS)

    if args.restore:
        result = await restore_changes(db, collections, apply=args.apply)
        verb = "Restored" if args.apply else "Would restore"
        print(f"{verb} {result['restored']} of {result['found']} backed-up string(s); "
              f"{result['skipped']} skipped because the text changed since.")
    else:
        changes = await scan(db, collections)
        print("Strings with an em dash, by field:")
        print(format_summary(summarise(changes)))
        if args.apply and changes:
            written = await apply_changes(db, changes)
            print(f"Wrote {written} document(s). Originals are in `{BACKUP_COLLECTION}`.")

    if not args.apply:
        print("Dry run: nothing was written. Add --apply to write.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(run(parse_args())))
