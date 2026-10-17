import argparse
import asyncio
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from config.database import close_db, get_db, get_platform_db, init_db
from config.tenancy import DEFAULT_COMPANY_ID, company_context
from config.tenancy_migration import ensure_default_workspace
from services.hr_module.user_guide_service import (
    GUIDE_ROLES,
    RoleGuidePayload,
    publish_user_guide,
)

DEFAULT_PAYLOAD_FILE = BACKEND_DIR / "scripts" / "user_guides.json"
DEFAULT_FRONTEND_DIR = BACKEND_DIR.parent / "frontend"
GUIDE_CONTENT_SUBPATH = Path("src") / "pages" / "guide" / "content"

DEFAULT_UPDATED_BY = "seed:seed_user_guides.py"

_GUIDE_MARKERS = ("role", "label", "chapters")

_ENTRY_TEMPLATE = """\
{imports}

const modules: Record<string, unknown>[] = [{module_list}]
const guides: Record<string, unknown>[] = []
const seen = new Set<string>()

function collect(value: unknown): void {{
  if (Array.isArray(value)) {{
    value.forEach(collect)
    return
  }}
  if (!value || typeof value !== 'object') return
  const candidate = value as Record<string, unknown>
  if ({marker_check}) return
  const role = String(candidate.role)
  if (seen.has(role)) return
  seen.add(role)
  guides.push(candidate)
}}

for (const mod of modules) Object.values(mod).forEach(collect)
process.stdout.write(JSON.stringify(guides))
"""


def _normalize_payload(raw) -> list[dict]:
    if isinstance(raw, list):
        items = raw
    elif isinstance(raw, dict) and isinstance(raw.get("guides"), list):
        items = raw["guides"]
    elif isinstance(raw, dict):
        items = [
            {**value, "role": value.get("role") or key}
            for key, value in raw.items()
            if isinstance(value, dict)
        ]
    else:
        raise ValueError("Payload must be a list of guides, {\"guides\": [...]}, or an object keyed by role")

    if not items:
        raise ValueError("Payload contained no guides")
    for item in items:
        if not isinstance(item, dict):
            raise ValueError(f"Each guide must be an object, got {type(item).__name__}")
    return items


def load_payload_file(path: Path) -> list[dict]:
    if not path.exists():
        raise FileNotFoundError(
            f"Guide payload not found: {path}\n"
            "Either pass --file with a JSON payload, or use --from-frontend to "
            "extract the bundled content straight out of the frontend repo."
        )
    return _normalize_payload(json.loads(path.read_text(encoding="utf-8")))


def extract_from_frontend(frontend_dir: Path) -> list[dict]:
    content_dir = frontend_dir / GUIDE_CONTENT_SUBPATH
    if not content_dir.is_dir():
        raise FileNotFoundError(
            f"Guide content directory not found: {content_dir}\n"
            "Point --frontend-dir (or $SEED_USER_GUIDE_FRONTEND) at the frontend directory."
        )

    modules = sorted(
        path for path in content_dir.glob("*.ts")
        if not path.name.endswith(".d.ts")
    )
    if not modules:
        raise FileNotFoundError(f"No .ts content modules in {content_dir}")

    node = shutil.which("node")
    if node is None:
        raise RuntimeError("`node` is not on PATH: use --file with a JSON payload instead.")

    esbuild = frontend_dir / "node_modules" / "esbuild" / "bin" / "esbuild"
    if not esbuild.exists():
        raise FileNotFoundError(
            f"esbuild not found at {esbuild}: run `npm install` in the frontend, "
            "or use --file with a JSON payload instead."
        )

    imports = "\n".join(
        f"import * as m{index} from {json.dumps(path.as_posix())}"
        for index, path in enumerate(modules)
    )
    marker_check = " || ".join(f"!({json.dumps(key)} in candidate)" for key in _GUIDE_MARKERS)
    entry_source = _ENTRY_TEMPLATE.format(
        imports=imports,
        module_list=", ".join(f"m{index}" for index in range(len(modules))),
        marker_check=marker_check,
    )

    with tempfile.TemporaryDirectory(prefix="user-guide-seed-") as tmp:
        entry = Path(tmp) / "extract.ts"
        bundle = Path(tmp) / "extract.mjs"
        entry.write_text(entry_source, encoding="utf-8")

        _run(
            [node, str(esbuild), str(entry), "--bundle", "--platform=node",
             "--format=esm", "--alias:@=./src", f"--outfile={bundle}"],
            cwd=frontend_dir,
            what="esbuild bundle of the guide content",
        )
        stdout = _run([node, str(bundle)], cwd=frontend_dir, what="guide content extraction")

    return _normalize_payload(json.loads(stdout or "[]"))


def _run(command: list[str], *, cwd: Path, what: str) -> str:
    result = subprocess.run(command, cwd=str(cwd), capture_output=True)
    if result.returncode != 0:
        message = (result.stderr or result.stdout).decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"{what} failed:\n{message}")
    return result.stdout.decode("utf-8")


def validate_guides(items: list[dict]) -> list[tuple[str, dict]]:
    validated: list[tuple[str, dict]] = []
    for index, item in enumerate(items):
        role = item.get("role")
        if role not in GUIDE_ROLES:
            raise ValueError(
                f"Guide #{index} has role {role!r}; expected one of {', '.join(GUIDE_ROLES)}"
            )
        payload = RoleGuidePayload.model_validate(item)
        validated.append((role, payload.model_dump(exclude_unset=True)))

    roles = [role for role, _ in validated]
    duplicates = {role for role in roles if roles.count(role) > 1}
    if duplicates:
        raise ValueError(f"Payload contains more than one guide for: {', '.join(sorted(duplicates))}")
    return validated


async def seed_user_guides(
    items: list[dict],
    *,
    updated_by: str = DEFAULT_UPDATED_BY,
    dry_run: bool = False,
) -> None:
    validated = validate_guides(items)

    if dry_run:
        for role, payload in validated:
            print(
                f"[dry-run] {role}: {payload.get('label')!r} - "
                f"{len(payload.get('chapters') or [])} chapter(s), "
                f"{len(payload.get('intro') or [])} intro paragraph(s)"
            )
        print(f"[dry-run] {len(validated)} guide(s) validated, nothing written")
        return

    await init_db()
    company_id = os.getenv("SEED_COMPANY_ID", DEFAULT_COMPANY_ID)
    if company_id == DEFAULT_COMPANY_ID:
        await ensure_default_workspace(get_platform_db())
    with company_context(company_id):
        if get_db() is None:
            raise RuntimeError("Database connection is not available")

    try:
        for role, payload in validated:
            with company_context(company_id):
                doc = await publish_user_guide(role, payload, updated_by=updated_by)
            print(f"Seeded user guide: {role} (version {doc.get('version')})")
        print(f"Seed completed successfully - {len(validated)} guide(s)")
    finally:
        await close_db()


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--file", type=Path, default=None,
        help=f"JSON payload to seed from (default: {DEFAULT_PAYLOAD_FILE})",
    )
    parser.add_argument(
        "--from-frontend", action="store_true",
        help="Extract the bundled guide content from the frontend instead of a JSON file",
    )
    parser.add_argument(
        "--frontend-dir", type=Path,
        default=Path(os.getenv("SEED_USER_GUIDE_FRONTEND") or DEFAULT_FRONTEND_DIR),
        help="Path to the frontend directory (default: ../frontend; used with --from-frontend)",
    )
    parser.add_argument(
        "--out", type=Path, default=None,
        help="Also write the resolved payload to this JSON file",
    )
    parser.add_argument(
        "--updated-by", default=os.getenv("SEED_USER_GUIDE_AUTHOR", DEFAULT_UPDATED_BY),
        help=f"Value recorded in each document's updated_by (default: {DEFAULT_UPDATED_BY})",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Validate and report, but write nothing to the database",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    try:
        if args.from_frontend:
            items = extract_from_frontend(args.frontend_dir.resolve())
        else:
            items = load_payload_file((args.file or DEFAULT_PAYLOAD_FILE).resolve())

        if args.out:
            args.out.parent.mkdir(parents=True, exist_ok=True)
            args.out.write_text(json.dumps(items, indent=2, ensure_ascii=False), encoding="utf-8")
            print(f"Wrote resolved payload to {args.out}")

        asyncio.run(seed_user_guides(items, updated_by=args.updated_by, dry_run=args.dry_run))
    except Exception as exc:
        print(f"Seed failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
