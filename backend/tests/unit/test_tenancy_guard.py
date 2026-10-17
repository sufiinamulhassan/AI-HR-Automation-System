import ast
import re
from pathlib import Path

from fastapi.routing import APIRoute

from main import app

BACKEND = Path(__file__).resolve().parents[2]
SKIP_DIRS = {"venv", "tests", "__pycache__", "node_modules", "seed", "docs"}

PLATFORM_DB_USERS = {
    "config/database.py",
    "config/tenancy_migration.py",
    "shared/auth.py",
    "shared/rate_limit.py",
    "shared/tenant_deps.py",
    "routes/auth.py",
    "routes/sso.py",
    "routes/oidc.py",
    "routes/platform.py",
    "services/hr_module/workspace_service.py",
    "services/hr_module/domains_service.py",
    "services/hr_module/platform_service.py",
    "services/hr_module/billing_service.py",
    "services/hr_module/alerts_service.py",
    "services/hr_module/platform_jobs.py",
    "services/hr_module/careers_service.py",
    "services/hr_module/site_service.py",
    "scripts/seed_production_data.py",
    "scripts/seed_user_guides.py",
}

PUBLIC_WITHOUT_COMPANY = {
    "/health",
    "/health/ready",
    "/api/v1/auth/login",
    "/api/v1/auth/verify-otp",
    "/api/v1/auth/token",
    "/api/v1/auth/forgot-password",
    "/api/v1/auth/reset-password",
    "/api/v1/sso/google/login",
    "/api/v1/sso/google/callback",
    "/api/v1/sso/oidc/config",
    "/api/v1/sso/oidc/login",
    "/api/v1/sso/oidc/callback",
    "/api/v1/cron/daily",
    "/api/v1/cron/reminders",
    "/api/v1/cron/external-reminders",
    "/api/v1/cron/job-sync",
    "/api/v1/cron/retention",
    "/api/v1/branding/public",
    "/api/v1/branding/logo/{company_id}",
    "/api/v1/performance/rating-config",
    "/api/v1/billing/webhook/stripe",
    "/api/v1/careers/jobs",
    "/api/v1/careers/filters",
    "/api/v1/careers/jobs/{job_id}",
    "/api/v1/site/plans",
    "/api/v1/site/contact",
}

AUTH_GUARDS = {
    "get_current_user", "require_admin", "require_superadmin", "require_platform_admin",
    "_check_permission", "_check_any_permission",
}


def _source_files():
    for path in BACKEND.rglob("*.py"):
        rel = path.relative_to(BACKEND)
        if rel.parts[0] in SKIP_DIRS or "venv" in rel.parts:
            continue
        yield rel.as_posix(), path


def _uses_name(path: Path, name: str) -> bool:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and node.id == name:
            return True
        if isinstance(node, ast.Attribute) and node.attr == name:
            return True
        if isinstance(node, ast.ImportFrom) and any(a.name == name for a in node.names):
            return True
    return False


def test_the_raw_database_is_confined_to_platform_code():
    users = {rel for rel, path in _source_files() if _uses_name(path, "get_platform_db")}
    stray = sorted(users - PLATFORM_DB_USERS - {"scripts/migrate_multitenant.py"})
    assert not stray, (
        "get_platform_db() bypasses company isolation. Use get_db() or, if this really is "
        f"platform work, add the file to PLATFORM_DB_USERS with a reason: {stray}"
    )


def test_no_code_builds_its_own_mongo_client():
    pattern = re.compile(r"\b(AsyncIOMotorClient|MongoClient)\s*\(")
    offenders = [
        rel for rel, path in _source_files()
        if rel != "config/database.py" and not rel.startswith("scripts/") and pattern.search(path.read_text(encoding="utf-8"))
    ]
    assert not offenders, f"Only config/database.py may construct a Mongo client: {offenders}"


def test_nothing_reads_the_raw_connection_directly():
    pattern = re.compile(r"\bdatabase\._db\b|\bconfig\.database\._db\b|\._raw\b")
    allowed = {"config/database.py", "config/tenancy.py"}
    offenders = []
    for rel, path in _source_files():
        if rel in allowed:
            continue
        if pattern.search(path.read_text(encoding="utf-8")):
            offenders.append(rel)
    assert not offenders, f"Use get_db() / get_platform_db(), not the private connection: {offenders}"


def test_tenant_collections_are_never_listed_as_platform_only():
    from config.tenancy import NAMESPACED_ID, PLATFORM_ONLY, SHARED_INFRA

    assert not (NAMESPACED_ID & (PLATFORM_ONLY | SHARED_INFRA))
    assert PLATFORM_ONLY == {"clients", "companies", "settings"}
    assert SHARED_INFRA == {"rate_limits", "sso_states", "otp_logs", "password_tokens"}


def _routes():
    for route in app.routes:
        if isinstance(route, APIRoute):
            yield route.path, route
        elif hasattr(route, "original_router"):
            prefix = route.include_context.prefix
            for inner in route.original_router.routes:
                if isinstance(inner, APIRoute):
                    yield prefix + inner.path, inner


def _dependency_calls(dependant):
    for sub in dependant.dependencies:
        yield sub.call
        yield from _dependency_calls(sub)


def test_every_public_route_names_its_company():
    offenders = []
    for path, route in _routes():
        calls = list(_dependency_calls(route.dependant))
        if any(getattr(c, "__name__", "") in AUTH_GUARDS for c in calls):
            continue
        binds = any(getattr(c, "tenant_kind", None) for c in calls)
        if not binds and path not in PUBLIC_WITHOUT_COMPANY:
            offenders.append(f"{sorted(route.methods - {'HEAD', 'OPTIONS'})} {path}")
    docs = {"/api/docs", "/api/redoc", "/api/openapi.json", "/api/docs/oauth2-redirect"}
    offenders = [o for o in offenders if not any(d in o for d in docs)]
    assert not offenders, (
        "These routes have no signed-in user and bind no company. Give their public_token_throttle "
        f"a tenant= kind (shared/tenant_deps.py), or list them in PUBLIC_WITHOUT_COMPANY: {offenders}"
    )


def test_tenant_kinds_are_known():
    from shared.tenant_deps import TOKEN_KINDS

    for path, route in _routes():
        for call in _dependency_calls(route.dependant):
            kind = getattr(call, "tenant_kind", None)
            assert kind is None or kind in TOKEN_KINDS, f"{path}: unknown tenant kind {kind!r}"


def test_unique_indexes_on_human_keys_are_per_company():
    tree = ast.parse((BACKEND / "config/database.py").read_text(encoding="utf-8"))
    text = ast.unparse(tree)
    globally_unique_ok = {
        "email", "job_id", "resume_id", "candidate_id", "secure_token", "profile_id", "link_id",
        "token_hash", "scenario_id", "offer_id", "state", "question_id", "submission_id",
        "rule_id", "request_id", "webhook_id", "template_id", "employee_id", "offer_id", "cycle_id",
        "review_id", "goal_id", "client_id", "company_id", "slug", "application_id",
        "sso_domains",
        "custom_domains",
    }
    for match in re.finditer(r"create_index\(\[\(\s*'(\w+)',\s*ASCENDING\)\],\s*unique=True", text):
        assert match.group(1) in globally_unique_ok, (
            f"unique index on {match.group(1)!r} is global: use _unique(collection, field) so it is per company"
        )


def test_no_route_both_signs_a_user_in_and_binds_a_company_from_a_token():
    both = []
    for path, route in _routes():
        calls = list(_dependency_calls(route.dependant))
        signs_in = any(getattr(c, "__name__", "") in AUTH_GUARDS for c in calls)
        binds_from_token = any(getattr(c, "tenant_kind", None) for c in calls)
        if signs_in and binds_from_token:
            both.append(path)
    assert not both, both
