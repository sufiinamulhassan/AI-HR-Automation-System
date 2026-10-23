import uuid

import pytest

from config.database import get_db
from services.hr_module.permissions import DEFAULT_ROLE_PERMISSIONS, PERMISSION_CATALOG
from support_routes import MUTATING, all_routes

pytestmark = pytest.mark.anyio

API = "/api/v1"

EXEMPT: dict[str, str] = {
    "POST /api/v1/auth/users": "users:manage is not held by HR Admin; account_protection_service gates it",
    "PATCH /api/v1/auth/users/{email}": "users:manage is not held by HR Admin; account_protection_service gates it",
    "POST /api/v1/auth/admin/reset-password": "users:manage is not held by HR Admin; account_protection_service gates it",
    "POST /api/v1/auth/users/{email}/invite": "users:manage is not held by HR Admin; account_protection_service gates it",
    "POST /api/v1/auth/users/{email}/totp/reset": "users:manage is not held by HR Admin; account_protection_service gates it",
    "PATCH /api/v1/auth/models/default": "no catalog permission for platform AI settings",
    "PATCH /api/v1/company-settings": "no catalog permission for organisation settings",
    "POST /api/v1/company-settings/onboarding/dismiss": "no catalog permission for organisation settings",
    "PUT /api/v1/company-settings/mail": "Super Admin only (require_superadmin) and plan feature custom_smtp; no catalog permission for company mail",
    "POST /api/v1/company-settings/mail/verify": "Super Admin only and plan feature custom_smtp; no catalog permission for company mail; rate limited and audited",
    "POST /api/v1/company-settings/mail/test-send": "Super Admin only and plan feature custom_smtp; no catalog permission for company mail; rate limited and audited",
    "PUT /api/v1/company-settings/integrations/{name}": "Super Admin only and plan feature integrations; no catalog permission for company integrations",
    "PATCH /api/v1/branding": "no catalog permission for branding",
    "POST /api/v1/branding/logo": "no catalog permission for branding; size and type checked on upload",
    "DELETE /api/v1/branding/logo": "no catalog permission for branding",
    "PUT /api/v1/model-tasks/{task}": "no catalog permission for the AI model per task settings",
    "POST /api/v1/model-tasks/embedding/reindex": "no catalog permission for the AI model per task settings; batched and capped",
    "PATCH /api/v1/notification-settings": "no catalog permission for notification settings",
    "POST /api/v1/notification-settings/test": "no catalog permission for notification settings",
    "PUT /api/v1/email-templates/{key}": "no catalog permission for email templates",
    "DELETE /api/v1/email-templates/{key}": "no catalog permission for email templates",
    "PATCH /api/v1/prompt-config/{key}": "no catalog permission for AI prompts",
    "DELETE /api/v1/prompt-config/{key}": "no catalog permission for AI prompts",
    "POST /api/v1/integrations/hrms/push/{candidate_id}": "no catalog permission for the HRMS connector",
    "POST /api/v1/system/live-check": "no catalog permission for platform checks; limited to 6 per admin per 10 minutes and audited",
    "PUT /api/v1/user-guide/{role}": "superadmin-only content, no catalog permission",
    "DELETE /api/v1/user-guide/{role}": "superadmin-only content, no catalog permission",
    "PATCH /api/v1/candidates/{candidate_id}/notes": "no catalog permission for recruiter notes",
    "PATCH /api/v1/candidates/profile/{profile_id}/notes": "no catalog permission for recruiter notes",
    "PATCH /api/v1/resumes/{resume_id}/salary-expectation": "no catalog permission for resume edits",
    "POST /api/v1/intel/resumes/upload-bulk": "intel.py not editable in this change (intel:bulk_upload pending)",
    "DELETE /api/v1/intel/resumes/batch/{batch_id}": "intel.py not editable in this change (intel:purge pending)",
    "POST /api/v1/intel/resumes/batches/clear": "intel.py not editable in this change (intel:purge pending)",
    "POST /api/v1/intel/resumes/purge": "intel.py not editable in this change (intel:purge pending)",
}


def _label(info) -> str:
    return f"{sorted(info.methods)[0]} {info.path}"


async def test_every_admin_mutating_route_names_a_permission():
    unguarded = [
        _label(r) for r in all_routes()
        if r.methods & MUTATING and r.admin_gated and not r.permissions and _label(r) not in EXEMPT
    ]
    assert not unguarded, "admin routes with no permission (name one, or exempt it with a reason):\n" + "\n".join(unguarded)


async def test_the_exemptions_are_still_true():
    by_label = {_label(r): r for r in all_routes()}
    for label, reason in EXEMPT.items():
        assert reason.strip()
        assert label in by_label, f"{label} no longer exists: remove it from EXEMPT"
        assert by_label[label].admin_gated and not by_label[label].permissions, f"{label} now names a permission: remove it from EXEMPT"


PLATFORM_ROUTES = {
    "GET /api/v1/platform/overview",
    "GET /api/v1/platform/usage",
    "GET /api/v1/platform/health",
    "GET /api/v1/platform/audit",
    "GET /api/v1/platform/clients",
    "POST /api/v1/platform/clients",
    "GET /api/v1/platform/clients/{client_id}",
    "PATCH /api/v1/platform/clients/{client_id}",
    "DELETE /api/v1/platform/clients/{client_id}",
    "POST /api/v1/platform/clients/{client_id}/suspend",
    "POST /api/v1/platform/clients/{client_id}/activate",
    "POST /api/v1/platform/clients/{client_id}/companies",
    "GET /api/v1/platform/companies",
    "GET /api/v1/platform/companies/{company_id}",
    "PATCH /api/v1/platform/companies/{company_id}",
    "DELETE /api/v1/platform/companies/{company_id}",
    "POST /api/v1/platform/companies/{company_id}/suspend",
    "POST /api/v1/platform/companies/{company_id}/activate",
    "POST /api/v1/platform/companies/{company_id}/admins",
    "POST /api/v1/platform/companies/{company_id}/admins/{email}/reset-password",
    "GET /api/v1/platform/companies/{company_id}/domains",
    "PUT /api/v1/platform/companies/{company_id}/domains",
    "GET /api/v1/platform/owners",
    "POST /api/v1/platform/owners",
    "PATCH /api/v1/platform/owners/{email}",
    "GET /api/v1/platform/plans",
    "GET /api/v1/platform/billing/statement",
    "PATCH /api/v1/platform/clients/{client_id}/subscription",
    "POST /api/v1/platform/clients/{client_id}/billing/checkout",
    "POST /api/v1/platform/clients/{client_id}/billing/portal",
    "GET /api/v1/platform/ai",
    "GET /api/v1/platform/mail",
    "PUT /api/v1/platform/mail",
    "POST /api/v1/platform/mail/verify",
    "POST /api/v1/platform/mail/test-send",
    "GET /api/v1/platform/contact-requests",
    "PATCH /api/v1/platform/contact-requests/{request_id}",
    "DELETE /api/v1/platform/contact-requests/{request_id}",
}


async def test_every_platform_route_is_platform_owner_only():
    routes = {_label(r): r for r in all_routes() if r.path.startswith("/api/v1/platform")}
    assert set(routes) == PLATFORM_ROUTES, (
        f"new: {sorted(set(routes) - PLATFORM_ROUTES)}; gone: {sorted(PLATFORM_ROUTES - set(routes))}"
    )
    for label, route in routes.items():
        assert route.platform_gated, f"{label} is not behind require_platform_admin"
        assert route.authenticated
        assert not route.tenant_guarded, f"{label} also carries a company guard: a platform owner has no company"
        assert not route.admin_gated and not route.permissions


async def test_the_platform_guard_is_used_nowhere_else():
    stray = [_label(r) for r in all_routes() if r.platform_gated and not r.path.startswith("/api/v1/platform")]
    assert not stray, stray


async def test_every_permission_a_route_names_exists_in_the_catalog():
    named = {p for r in all_routes() for p in r.permissions}
    assert named, "no route names a permission"
    assert named <= set(PERMISSION_CATALOG), sorted(named - set(PERMISSION_CATALOG))


SUPERADMIN_ONLY_BY_PERMISSION: dict[str, str] = {
    "PATCH /api/v1/security-policies": "security:manage is excluded from admin; the write was already Super Admin only",
    "POST /api/v1/candidates/{candidate_id}/erase": "candidates:erase is excluded from admin; new, Super Admin only by default",
    "POST /api/v1/candidates/erase-by-email": "candidates:erase is excluded from admin; new, Super Admin only by default",
    "GET /api/v1/company-settings/retention": "candidates:erase is excluded from admin; new, Super Admin only by default",
    "PATCH /api/v1/company-settings/retention": "candidates:erase is excluded from admin; new, Super Admin only by default",
}


async def test_a_route_hr_admins_use_never_names_a_permission_the_admin_role_lacks():
    admin_has = set(DEFAULT_ROLE_PERMISSIONS["admin"])
    offenders = []
    for r in all_routes():
        if "require_admin" in r.roles and "require_superadmin" not in r.roles:
            lacking = r.permissions - admin_has
            if lacking and _label(r) not in SUPERADMIN_ONLY_BY_PERMISSION:
                offenders.append(f"{_label(r)} names {sorted(lacking)}")
    assert not offenders, "\n".join(offenders)
    by_label = {_label(r): r for r in all_routes()}
    for label in SUPERADMIN_ONLY_BY_PERMISSION:
        assert label in by_label and by_label[label].permissions - admin_has


async def test_the_catalog_permissions_that_were_never_checked_are_now_named_by_a_route():
    named = {p for r in all_routes() for p in r.permissions}
    must_be_checked = {
        "workflows:manage", "webhooks:manage", "scenarios:manage", "coding:manage", "coding:read_submissions",
        "jobs:create", "jobs:update", "jobs:delete", "jobs:import", "jobs:manage_settings",
        "resumes:upload", "resumes:delete",
        "candidates:invite", "candidates:decide", "candidates:resend_invite", "candidates:send_email",
        "offers:create", "offers:approve", "offers:send", "offers:withdraw",
        "departments:manage", "designations:manage", "job_grades:manage",
        "interview:schedule", "interview:read_report", "users:manage",
    }
    assert must_be_checked <= named, sorted(must_be_checked - named)


_BODIES = {
    "job": {"title": "T", "description": "D"},
    "candidate": {"job_id": "x", "name": "N", "email": "n@example.com"},
    "offer": {"candidate_id": "x", "salary": "1"},
}

_CASES: list[tuple[str, list[tuple[str, str, dict | None]]]] = [
    ("jobs:create", [("POST", "/jobs", _BODIES["job"])]),
    ("jobs:update", [
        ("PATCH", "/jobs/nope", {"location": "x"}),
        ("POST", "/jobs/rematch-all", None),
        ("PATCH", "/jobs/nope/pipeline/nope?stage=matched", None),
    ]),
    ("jobs:delete", [("DELETE", "/jobs/nope", None)]),
    ("jobs:import", [("POST", "/jobs/import", {"source": "nope"}), ("POST", "/jobs/scheduled-sync", None)]),
    ("resumes:upload", [("POST", "/resumes/upload", "multipart")]),
    ("resumes:delete", [("POST", "/resumes/bulk-delete", {"resume_ids": ["nope"]}), ("DELETE", "/resumes/nope", None)]),
    ("candidates:invite", [("POST", "/candidates", _BODIES["candidate"])]),
    ("candidates:resend_invite", [
        ("POST", "/candidates/nope/resend-invite", None),
        ("POST", "/candidates/nope/regenerate-token", {"resend": False}),
    ]),
    ("candidates:decide", [("POST", "/candidates/nope/decision", {"decision": "hold"})]),
    ("candidates:send_email", [("POST", "/candidates/nope/send-email", {"template": "reminder"})]),
    ("offers:create", [("POST", "/offers", _BODIES["offer"])]),
    ("offers:approve", [("POST", "/offers/nope/approve", None)]),
    ("offers:send", [("POST", "/offers/nope/send", None)]),
    ("offers:withdraw", [("POST", "/offers/nope/withdraw", None)]),
    ("departments:manage", [
        ("POST", "/admin/departments", {"name": "x"}),
        ("PATCH", "/admin/departments/nope", {"name": "y"}),
        ("DELETE", "/admin/departments/nope", None),
    ]),
    ("designations:manage", [
        ("POST", "/admin/designations", {"name": "x"}),
        ("PATCH", "/admin/designations/nope", {"name": "y"}),
        ("DELETE", "/admin/designations/nope", None),
    ]),
    ("job_grades:manage", [
        ("POST", "/admin/job-grades", {"name": "x"}),
        ("PATCH", "/admin/job-grades/nope", {"name": "y"}),
        ("DELETE", "/admin/job-grades/nope", None),
    ]),
    ("scenarios:manage", [
        ("POST", "/scenarios", {"name": "n", "prompt": "p"}),
        ("PATCH", "/scenarios/nope", {"name": "y"}),
        ("DELETE", "/scenarios/nope", None),
    ]),
    ("workflows:manage", [
        ("POST", "/workflows", {"name": "n", "trigger_type": "candidate_invited", "actions": []}),
        ("PATCH", "/workflows/nope", {"name": "y"}),
        ("DELETE", "/workflows/nope", None),
        ("POST", "/workflows/nope/test", {"context": {}}),
        ("POST", "/workflows/run-reminders", None),
    ]),
    ("webhooks:manage", [
        ("GET", "/webhooks", None),
        ("POST", "/webhooks", {"url": "https://example.com/h", "event_types": ["candidate_invited"]}),
        ("PATCH", "/webhooks/nope", {"is_active": False}),
        ("DELETE", "/webhooks/nope", None),
        ("POST", "/webhooks/nope/test", None),
    ]),
    ("coding:manage", [
        ("POST", "/coding/questions", {"title": "t", "description": "d"}),
        ("POST", "/coding/questions/generate", {"job_domain": "software_engineering"}),
        ("PATCH", "/coding/questions/nope", {"title": "y"}),
        ("DELETE", "/coding/questions/nope", None),
        ("PATCH", "/coding/assign/nope", {"question_id": "q"}),
    ]),
    ("coding:read", [("GET", "/coding/questions", None), ("GET", "/coding/questions/nope", None)]),
    ("coding:read_submissions", [("GET", "/coding/submissions", None), ("GET", "/coding/submissions/nope", None)]),
    ("interview:schedule", [
        ("PATCH", "/interview/nope/schedule", {"scheduled_start_at": None}),
        ("GET", "/interview/nope/schedule.ics", None),
    ]),
    ("interview:read_report", [("GET", "/interview/report/nope", None), ("GET", "/interview/report/nope/pdf", None)]),
]


def _send(client, headers, method, path, body):
    if body == "multipart":
        return client.request(method, API + path, headers=headers, files={"file": ("a.txt", b"x", "text/plain")})
    return client.request(method, API + path, headers=headers, json=body)


@pytest.mark.parametrize("permission,requests", _CASES, ids=[c[0] for c in _CASES])
async def test_an_admin_whose_role_lacks_the_permission_is_refused(client, admin_headers, permission, requests):
    db = get_db()
    await db.roles.insert_one({
        "role_name": "admin",
        "permissions": [p for p in DEFAULT_ROLE_PERMISSIONS["admin"] if p != permission],
    })
    try:
        for method, path, body in requests:
            resp = await _send(client, admin_headers, method, path, body)
            assert resp.status_code == 403, f"{method} {path}: {resp.status_code} {resp.text[:160]}"
            assert permission in resp.json()["detail"], f"{method} {path}: {resp.json()['detail']}"
    finally:
        await db.roles.delete_one({"role_name": "admin"})


async def test_the_default_admin_role_holds_every_permission_the_routes_name(client, admin_headers):
    for permission, requests in _CASES:
        assert permission in DEFAULT_ROLE_PERMISSIONS["admin"], permission
    for path in ("/webhooks", "/coding/questions", "/coding/submissions", "/interview/report/nope"):
        resp = await client.get(API + path, headers=admin_headers)
        assert resp.status_code != 403, f"{path}: {resp.text[:160]}"


async def test_deleting_a_user_needs_users_manage_even_for_a_superadmin_role(client, superadmin_headers):
    db = get_db()
    victim = f"victim-{uuid.uuid4().hex[:8]}@example.com"
    await db.users.insert_one({"name": "V", "email": victim, "role": "standard", "is_active": True})
    await db.roles.insert_one({
        "role_name": "superadmin",
        "permissions": [p for p in DEFAULT_ROLE_PERMISSIONS["superadmin"] if p != "users:manage"],
    })
    try:
        blocked = await client.delete(f"{API}/auth/users/{victim}", headers=superadmin_headers)
        assert blocked.status_code == 403 and "users:manage" in blocked.json()["detail"]
        assert await db.users.find_one({"email": victim}) is not None
    finally:
        await db.roles.delete_one({"role_name": "superadmin"})
    ok = await client.delete(f"{API}/auth/users/{victim}", headers=superadmin_headers)
    assert ok.status_code == 200
    assert await db.users.find_one({"email": victim}) is None


async def test_the_coding_submission_reads_need_the_submissions_permission_like_live_does(client, admin_headers, standard_headers):
    for path in ("/coding/submissions", "/coding/submissions/nope", "/coding/live/nope"):
        assert (await client.get(API + path, headers=standard_headers)).status_code == 403
    db = get_db()
    await db.roles.insert_one({
        "role_name": "admin",
        "permissions": [p for p in DEFAULT_ROLE_PERMISSIONS["admin"] if p != "coding:read_submissions"],
    })
    try:
        for path in ("/coding/submissions", "/coding/submissions/nope", "/coding/live/nope"):
            assert (await client.get(API + path, headers=admin_headers)).status_code == 403, path
    finally:
        await db.roles.delete_one({"role_name": "admin"})
