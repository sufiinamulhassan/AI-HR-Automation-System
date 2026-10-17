import io
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from jose import jwt
from passlib.context import CryptContext

from config.database import get_db
from config.settings import settings

pytestmark = pytest.mark.anyio

API = "/api/v1/auth"
pwd_ctx = CryptContext(schemes=["bcrypt"])


def _bearer(email: str) -> dict:
    token = jwt.encode(
        {"sub": email, "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
        settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM,
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def make_user():
    db = get_db()
    created: list[str] = []

    async def _make(role: str = "standard", **extra) -> tuple[str, dict]:
        email = f"self.{uuid.uuid4().hex[:10]}@example.com"
        doc = {"name": "Self Service", "email": email, "role": role, "is_active": True, "otp_required": False}
        if "password_hash" not in extra and extra.pop("with_password", True):
            doc["password_hash"] = pwd_ctx.hash("Start@12345")
        doc.update({k: v for k, v in extra.items() if k != "with_password"})
        await db.users.insert_one(doc)
        created.append(email)
        return email, _bearer(email)

    yield _make
    await db.users.delete_many({"email": {"$in": created}})
    await db.audit_log.delete_many({"resource_id": {"$in": created}})


def _png() -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (8, 8), color="green").save(buf, format="PNG")
    return buf.getvalue()


def _jpeg() -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (8, 8), color="green").save(buf, format="JPEG")
    return buf.getvalue()


def _webp() -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (8, 8), color="green").save(buf, format="WEBP")
    return buf.getvalue()


async def test_me_reports_the_account_facts_the_profile_page_needs(client, make_user):
    email, h = await make_user(
        otp_required=True, otp_enforced=True, job_title="Recruiter", timezone="Europe/Berlin", department_id="dept-x",
    )
    body = (await client.get(f"{API}/me", headers=h)).json()
    assert body["has_password"] is True
    assert body["otp_enabled"] is True and body["otp_enforced"] is True
    assert body["job_title"] == "Recruiter" and body["timezone"] == "Europe/Berlin"
    assert body["department_id"] == "dept-x"
    assert body["email"] == email and body["role"] == "standard"
    assert "password_hash" not in body and "avatar_base64" not in body


async def test_me_for_a_single_sign_on_account_has_no_password(client, make_user):
    _, h = await make_user(with_password=False)
    body = (await client.get(f"{API}/me", headers=h)).json()
    assert body["has_password"] is False
    assert body["otp_enabled"] is False and body["otp_enforced"] is False
    assert body["job_title"] is None and body["timezone"] is None and body["department_id"] is None


async def test_me_still_works_for_the_demo_bypass_user(client, standard_headers):
    body = (await client.get(f"{API}/me", headers=standard_headers)).json()
    assert body["role"] == "standard" and body["has_password"] is False and body["otp_enforced"] is False


async def test_patch_me_trims_and_saves_the_three_fields(client, make_user):
    email, h = await make_user()
    resp = await client.patch(
        f"{API}/me", headers=h,
        json={"name": "  New Name  ", "job_title": "  Talent Lead ", "timezone": " Asia/Karachi "},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["name"] == "New Name" and body["job_title"] == "Talent Lead" and body["timezone"] == "Asia/Karachi"
    doc = await get_db().users.find_one({"email": email})
    assert (doc["name"], doc["job_title"], doc["timezone"]) == ("New Name", "Talent Lead", "Asia/Karachi")


async def test_a_blank_name_is_a_422_with_a_sentence(client, make_user):
    email, h = await make_user()
    for blank in ("", "   ", "\t"):
        resp = await client.patch(f"{API}/me", headers=h, json={"name": blank})
        assert resp.status_code == 422
        assert isinstance(resp.json()["detail"], str) and "name" in resp.json()["detail"].lower()
    assert (await get_db().users.find_one({"email": email}))["name"] == "Self Service"


async def test_patch_me_can_never_reach_role_active_or_email(client, make_user):
    email, h = await make_user()
    resp = await client.patch(
        f"{API}/me", headers=h,
        json={"name": "Still Me", "role": "superadmin", "is_active": False, "email": "other@example.com",
              "otp_required": True, "password_hash": "x", "department_id": "dept-z"},
    )
    assert resp.status_code == 200
    doc = await get_db().users.find_one({"email": email})
    assert doc["role"] == "standard" and doc["is_active"] is True and doc["email"] == email
    assert doc["otp_required"] is False and doc.get("department_id") in (None, "") and doc["password_hash"] != "x"
    assert doc["name"] == "Still Me"
    only = await client.patch(f"{API}/me", headers=h, json={"role": "superadmin"})
    assert only.status_code == 422 and isinstance(only.json()["detail"], str)
    assert (await get_db().users.find_one({"email": email}))["role"] == "standard"


async def test_patch_me_clears_job_title_and_rejects_a_bad_timezone(client, make_user):
    _, h = await make_user(job_title="Old", timezone="UTC")
    cleared = await client.patch(f"{API}/me", headers=h, json={"job_title": "  "})
    assert cleared.status_code == 200 and cleared.json()["job_title"] is None
    assert cleared.json()["timezone"] == "UTC"
    bad = await client.patch(f"{API}/me", headers=h, json={"timezone": "Not A Zone!"})
    assert bad.status_code == 422 and isinstance(bad.json()["detail"], str)
    long_name = await client.patch(f"{API}/me", headers=h, json={"name": "x" * 500})
    assert long_name.status_code == 422


async def test_patch_me_needs_a_signed_in_account(client):
    assert (await client.patch(f"{API}/me", json={"name": "x"})).status_code == 401


async def test_patch_me_is_audited_immediately(client, make_user):
    email, h = await make_user()
    await client.patch(f"{API}/me", headers=h, json={"job_title": "Analyst"})
    entry = await get_db().audit_log.find_one({"action": "profile_update", "resource_id": email})
    assert entry and entry["details"]["fields"] == ["job_title"]


async def test_a_user_can_turn_one_time_codes_on_and_back_off(client, make_user):
    email, h = await make_user()
    on = await client.patch(f"{API}/me/otp", headers=h, json={"enabled": True})
    assert on.status_code == 200 and on.json() == {"otp_enabled": True, "otp_enforced": False}
    assert (await get_db().users.find_one({"email": email}))["otp_required"] is True
    assert (await client.get(f"{API}/me", headers=h)).json()["otp_enabled"] is True
    off = await client.patch(f"{API}/me/otp", headers=h, json={"enabled": False})
    assert off.status_code == 200 and off.json() == {"otp_enabled": False, "otp_enforced": False}
    assert (await get_db().users.find_one({"email": email}))["otp_required"] is False


async def test_a_user_cannot_turn_off_codes_an_admin_required(client, make_user, admin_headers):
    email, h = await make_user()
    required = await client.patch(f"/api/v1/auth/users/{email}", headers=admin_headers, json={"otp_required": True})
    assert required.status_code == 200
    doc = await get_db().users.find_one({"email": email})
    assert doc["otp_required"] is True and doc["otp_enforced"] is True
    assert (await client.get(f"{API}/me", headers=h)).json()["otp_enforced"] is True

    refused = await client.patch(f"{API}/me/otp", headers=h, json={"enabled": False})
    assert refused.status_code == 403
    assert isinstance(refused.json()["detail"], str) and "administrator" in refused.json()["detail"]
    assert (await get_db().users.find_one({"email": email}))["otp_required"] is True
    again = await client.patch(f"{API}/me/otp", headers=h, json={"enabled": True})
    assert again.status_code == 200 and again.json() == {"otp_enabled": True, "otp_enforced": True}

    released = await client.patch(f"/api/v1/auth/users/{email}", headers=admin_headers, json={"otp_required": False})
    assert released.status_code == 200
    assert (await get_db().users.find_one({"email": email}))["otp_enforced"] is False
    now_off = await client.patch(f"{API}/me/otp", headers=h, json={"enabled": False})
    assert now_off.status_code == 200 and now_off.json()["otp_enabled"] is False


async def test_codes_an_admin_sets_when_creating_the_account_are_required_too(client, admin_headers):
    db = get_db()
    email = f"made.{uuid.uuid4().hex[:8]}@example.com"
    try:
        created = await client.post(
            f"{API}/users", headers=admin_headers,
            json={"name": "Made", "email": email, "password": "Start@12345", "otp_required": True},
        )
        assert created.status_code == 200
        doc = await db.users.find_one({"email": email})
        assert doc["otp_required"] is True and doc["otp_enforced"] is True
        h = _bearer(email)
        assert (await client.patch(f"{API}/me/otp", headers=h, json={"enabled": False})).status_code == 403
    finally:
        await db.users.delete_one({"email": email})


async def test_an_account_whose_flag_was_set_before_the_marker_existed_can_still_turn_it_off(client, make_user):
    _, h = await make_user(otp_required=True)
    resp = await client.patch(f"{API}/me/otp", headers=h, json={"enabled": False})
    assert resp.status_code == 200 and resp.json()["otp_enforced"] is False


async def test_otp_toggle_is_audited_and_needs_an_account(client, make_user):
    assert (await client.patch(f"{API}/me/otp", json={"enabled": True})).status_code == 401
    email, h = await make_user()
    await client.patch(f"{API}/me/otp", headers=h, json={"enabled": True})
    entry = await get_db().audit_log.find_one({"action": "otp_self_update", "resource_id": email})
    assert entry and entry["details"] == {"enabled": True}


async def test_the_password_policy_is_readable_by_any_signed_in_user(client, standard_headers, admin_headers):
    assert (await client.get(f"{API}/password-policy")).status_code == 401
    for headers in (standard_headers, admin_headers):
        body = (await client.get(f"{API}/password-policy", headers=headers)).json()
        assert body["min_length"] >= 1
        for field in ("password_min_length", "password_require_number", "password_require_symbol",
                      "max_login_attempts_before_lockout", "account_lockout_duration_minutes", "session_timeout_minutes"):
            assert field in body
        assert body["min_length"] == body["password_min_length"]
        assert "updated_by" not in body and "id" not in body and "created_at" not in body


async def test_the_password_policy_reflects_what_an_admin_saved(client, standard_headers, superadmin_headers):
    db = get_db()
    await db.security_policies.delete_many({})
    try:
        saved = await client.patch(
            "/api/v1/security-policies", headers=superadmin_headers,
            json={"password_min_length": 12, "password_require_number": True, "password_require_symbol": True},
        )
        assert saved.status_code == 200
        body = (await client.get(f"{API}/password-policy", headers=standard_headers)).json()
        assert body["min_length"] == 12
        assert body["password_require_number"] is True and body["password_require_symbol"] is True
    finally:
        await db.security_policies.delete_many({})


async def _upload(client, headers, data: bytes, declared: str = "image/png", name: str = "a.png"):
    return await client.post(f"{API}/me/avatar", headers=headers, files={"file": (name, data, declared)})


async def test_avatar_accepts_png_jpeg_and_webp_by_their_bytes(client, make_user):
    email, h = await make_user()
    for data, expected in ((_png(), "image/png"), (_jpeg(), "image/jpeg"), (_webp(), "image/webp")):
        resp = await _upload(client, h, data, declared="application/octet-stream", name="photo.bin")
        assert resp.status_code == 200, resp.text
        assert resp.json()["content_type"] == expected
        assert (await get_db().users.find_one({"email": email}))["avatar_content_type"] == expected


async def test_the_stored_type_is_the_sniffed_one_not_the_declared_one(client, make_user):
    email, h = await make_user()
    assert (await _upload(client, h, _png(), declared="image/jpeg", name="x.jpg")).json()["content_type"] == "image/png"


async def test_avatar_rejects_a_file_that_only_claims_to_be_an_image(client, make_user):
    email, h = await make_user()
    for data, declared in (
        (b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>", "image/png"),
        (b"just text pretending", "image/jpeg"),
        (b"GIF89a....", "image/png"),
        (b"%PDF-1.4 ...", "image/png"),
        (b"RIFFxxxxWAVEfmt ", "image/webp"),
    ):
        resp = await _upload(client, h, data, declared=declared)
        assert resp.status_code == 400, data
        assert isinstance(resp.json()["detail"], str) and "image" in resp.json()["detail"].lower()
    assert not (await get_db().users.find_one({"email": email})).get("avatar_base64")


async def test_avatar_rejects_an_empty_upload_with_a_sentence(client, make_user):
    _, h = await make_user()
    resp = await _upload(client, h, b"")
    assert resp.status_code == 400 and "empty" in resp.json()["detail"].lower()


async def test_avatar_over_the_limit_is_413(client, make_user, monkeypatch):
    import routes.auth as auth_route

    _, h = await make_user()
    png = _png()
    monkeypatch.setattr(auth_route, "_MAX_AVATAR_IMAGE_BYTES", len(png))
    assert (await _upload(client, h, png)).status_code == 200
    over = await _upload(client, h, png + b"\x00")
    assert over.status_code == 413 and isinstance(over.json()["detail"], str)
    assert "2 MB" in over.json()["detail"]


@pytest.fixture
async def department(client, admin_headers):
    resp = await client.post(
        "/api/v1/admin/departments", headers=admin_headers, json={"name": f"Dept {uuid.uuid4().hex[:8]}"},
    )
    assert resp.status_code == 200
    dept_id = resp.json()["department_id"]
    yield dept_id
    await get_db().departments.delete_one({"department_id": dept_id})


async def test_create_user_with_a_department(client, admin_headers, department):
    db = get_db()
    email = f"dept.{uuid.uuid4().hex[:8]}@example.com"
    try:
        resp = await client.post(
            f"{API}/users", headers=admin_headers,
            json={"name": "D", "email": email, "password": "Start@12345", "department_id": department},
        )
        assert resp.status_code == 200, resp.text
        assert (await db.users.find_one({"email": email}))["department_id"] == department
        rows = (await client.get(f"{API}/users", headers=admin_headers)).json()
        mine = next(r for r in rows if r["email"] == email)
        assert mine["department_id"] == department
        assert all("department_id" in r for r in rows)
    finally:
        await db.users.delete_one({"email": email})


async def test_an_unknown_department_is_refused(client, admin_headers):
    email = f"nodept.{uuid.uuid4().hex[:8]}@example.com"
    resp = await client.post(
        f"{API}/users", headers=admin_headers,
        json={"name": "D", "email": email, "password": "Start@12345", "department_id": "no-such-department"},
    )
    assert resp.status_code == 400 and isinstance(resp.json()["detail"], str)
    assert await get_db().users.find_one({"email": email}) is None


async def test_update_user_sets_and_clears_the_department(client, admin_headers, make_user, department):
    email, _ = await make_user()
    setit = await client.patch(f"{API}/users/{email}", headers=admin_headers, json={"department_id": department})
    assert setit.status_code == 200
    assert (await get_db().users.find_one({"email": email}))["department_id"] == department
    clear = await client.patch(f"{API}/users/{email}", headers=admin_headers, json={"department_id": None})
    assert clear.status_code == 200
    assert (await get_db().users.find_one({"email": email}))["department_id"] is None
    await client.patch(f"{API}/users/{email}", headers=admin_headers, json={"department_id": department})
    await client.patch(f"{API}/users/{email}", headers=admin_headers, json={"name": "Renamed"})
    assert (await get_db().users.find_one({"email": email}))["department_id"] == department
    bad = await client.patch(f"{API}/users/{email}", headers=admin_headers, json={"department_id": "no-such"})
    assert bad.status_code == 400


async def test_an_hr_admin_may_only_set_a_department_on_standard_users(client, admin_headers, superadmin_headers, make_user, department):
    other_admin, _ = await make_user("admin")
    refused = await client.patch(f"{API}/users/{other_admin}", headers=admin_headers, json={"department_id": department})
    assert refused.status_code == 403
    assert (await get_db().users.find_one({"email": other_admin})).get("department_id") in (None, "")
    allowed = await client.patch(f"{API}/users/{other_admin}", headers=superadmin_headers, json={"department_id": department})
    assert allowed.status_code == 200
    assert (await get_db().users.find_one({"email": other_admin}))["department_id"] == department
    made = await client.post(
        f"{API}/users", headers=admin_headers,
        json={"name": "A", "email": f"adm.{uuid.uuid4().hex[:6]}@example.com", "password": "Start@12345",
              "role": "admin", "department_id": department},
    )
    assert made.status_code == 403


@pytest.fixture
async def custom_role(client, superadmin_headers):
    name = f"role-{uuid.uuid4().hex[:8]}"
    resp = await client.post(
        "/api/v1/rbac/roles", headers=superadmin_headers, json={"role_name": name, "permissions": ["jobs:read"]},
    )
    assert resp.status_code == 200
    yield name
    await get_db().roles.delete_one({"role_name": name})


async def test_roles_list_carries_a_user_count(client, superadmin_headers, custom_role, make_user):
    await make_user(role=custom_role)
    await make_user(role=custom_role)
    body = (await client.get("/api/v1/rbac/roles", headers=superadmin_headers)).json()
    row = next(r for r in body["custom_roles"] if r["role_name"] == custom_role)
    assert row["user_count"] == 2
    assert body["user_counts"][custom_role] == 2 and "standard" in body["user_counts"]


async def test_deleting_a_role_users_hold_is_a_409_with_the_count(client, superadmin_headers, custom_role, make_user):
    email, _ = await make_user(role=custom_role)
    resp = await client.delete(f"/api/v1/rbac/roles/{custom_role}", headers=superadmin_headers)
    assert resp.status_code == 409
    body = resp.json()
    assert body["users_holding"] == 1 and isinstance(body["detail"], str) and "1 user" in body["detail"]
    assert await get_db().roles.find_one({"role_name": custom_role}) is not None
    assert (await get_db().users.find_one({"email": email}))["role"] == custom_role


async def test_deleting_a_role_with_reassign_moves_the_users_first(client, superadmin_headers, custom_role, make_user):
    a, _ = await make_user(role=custom_role)
    b, _ = await make_user(role=custom_role)
    resp = await client.delete(
        f"/api/v1/rbac/roles/{custom_role}", params={"reassign_to": "standard"}, headers=superadmin_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"deleted": True, "reassigned": 2}
    db = get_db()
    assert await db.roles.find_one({"role_name": custom_role}) is None
    assert (await db.users.find_one({"email": a}))["role"] == "standard"
    assert (await db.users.find_one({"email": b}))["role"] == "standard"


async def test_reassigning_to_another_custom_role_works_and_to_a_bad_one_does_not(client, superadmin_headers, custom_role, make_user):
    db = get_db()
    target = f"role-target-{uuid.uuid4().hex[:6]}"
    await db.roles.insert_one({"role_name": target, "permissions": ["jobs:read"]})
    holder, _ = await make_user(role=custom_role)
    try:
        for bad in ("no-such-role", custom_role):
            resp = await client.delete(
                f"/api/v1/rbac/roles/{custom_role}", params={"reassign_to": bad}, headers=superadmin_headers,
            )
            assert resp.status_code == 400 and isinstance(resp.json()["detail"], str)
        assert await db.roles.find_one({"role_name": custom_role}) is not None
        assert (await db.users.find_one({"email": holder}))["role"] == custom_role
        ok = await client.delete(
            f"/api/v1/rbac/roles/{custom_role}", params={"reassign_to": target}, headers=superadmin_headers,
        )
        assert ok.json() == {"deleted": True, "reassigned": 1}
        assert (await db.users.find_one({"email": holder}))["role"] == target
    finally:
        await db.roles.delete_one({"role_name": target})


async def test_deleting_an_unused_role_reassigns_nobody(client, superadmin_headers, custom_role):
    resp = await client.delete(f"/api/v1/rbac/roles/{custom_role}", headers=superadmin_headers)
    assert resp.status_code == 200 and resp.json() == {"deleted": True, "reassigned": 0}
    again = await client.delete(f"/api/v1/rbac/roles/{custom_role}", headers=superadmin_headers)
    assert again.status_code == 404


async def test_deleting_a_role_still_needs_rbac_manage(client, admin_headers, custom_role):
    assert (await client.delete(f"/api/v1/rbac/roles/{custom_role}", headers=admin_headers)).status_code == 403
