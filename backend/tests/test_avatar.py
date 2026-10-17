import io
import uuid

import pytest
from passlib.context import CryptContext

from config.database import get_db
from routes.auth import _make_token

pytestmark = pytest.mark.anyio

pwd_ctx = CryptContext(schemes=["bcrypt"])


def _fake_png_bytes() -> bytes:
    from PIL import Image as PILImage

    buf = io.BytesIO()
    PILImage.new("RGB", (40, 20), color="blue").save(buf, format="PNG")
    return buf.getvalue()


async def _insert_real_user(db, *, role: str = "standard", password: str | None = None) -> str:
    email = f"avatar-{uuid.uuid4().hex[:10]}@example.com"
    await db.users.insert_one({
        "name": "Avatar Probe", "email": email,
        "password_hash": pwd_ctx.hash(password) if password else "x",
        "role": role, "is_active": True,
    })
    return email


async def _bearer_for(email: str) -> dict:
    token = await _make_token(email)
    return {"Authorization": f"Bearer {token}"}


async def test_upload_avatar_requires_authentication(client):
    resp = await client.post(
        "/api/v1/auth/me/avatar", files={"file": ("a.png", _fake_png_bytes(), "image/png")},
    )
    assert resp.status_code == 401


async def test_get_avatar_requires_authentication(client):
    resp = await client.get("/api/v1/auth/me/avatar")
    assert resp.status_code == 401


async def test_delete_avatar_requires_authentication(client):
    resp = await client.delete("/api/v1/auth/me/avatar")
    assert resp.status_code == 401


async def test_upload_avatar_rejects_non_image_content_type(client):
    db = get_db()
    email = await _insert_real_user(db)
    try:
        headers = await _bearer_for(email)
        resp = await client.post(
            "/api/v1/auth/me/avatar",
            files={"file": ("a.txt", b"not an image", "text/plain")},
            headers=headers,
        )
        assert resp.status_code == 400
    finally:
        await db.users.delete_one({"email": email})


async def test_upload_avatar_rejects_oversized_file(client, monkeypatch):
    import routes.auth as auth_route

    monkeypatch.setattr(auth_route, "_MAX_AVATAR_IMAGE_BYTES", 4)
    db = get_db()
    email = await _insert_real_user(db)
    try:
        headers = await _bearer_for(email)
        resp = await client.post(
            "/api/v1/auth/me/avatar",
            files={"file": ("a.png", _fake_png_bytes(), "image/png")},
            headers=headers,
        )
        assert resp.status_code == 413
        assert isinstance(resp.json()["detail"], str) and "2 MB" in resp.json()["detail"]
    finally:
        await db.users.delete_one({"email": email})


async def test_upload_and_fetch_my_avatar_roundtrip(client):
    db = get_db()
    email = await _insert_real_user(db)
    try:
        headers = await _bearer_for(email)
        png = _fake_png_bytes()

        upload_resp = await client.post(
            "/api/v1/auth/me/avatar",
            files={"file": ("a.png", png, "image/png")},
            headers=headers,
        )
        assert upload_resp.status_code == 200, upload_resp.text
        assert upload_resp.json()["content_type"] == "image/png"
        assert "uploaded_at" in upload_resp.json()

        get_resp = await client.get("/api/v1/auth/me/avatar", headers=headers)
        assert get_resp.status_code == 200
        body = get_resp.json()
        assert body["configured"] is True
        assert body["content_type"] == "image/png"
        assert body["image_base64"]

        import base64
        assert base64.b64decode(body["image_base64"]) == png

        me_resp = await client.get("/api/v1/auth/me", headers=headers)
        assert me_resp.status_code == 200
        assert me_resp.json()["has_avatar"] is True
        assert "avatar_base64" not in me_resp.json()
    finally:
        await db.users.delete_one({"email": email})


async def test_get_my_avatar_when_none_uploaded(client):
    db = get_db()
    email = await _insert_real_user(db)
    try:
        headers = await _bearer_for(email)
        resp = await client.get("/api/v1/auth/me/avatar", headers=headers)
        assert resp.status_code == 200
        assert resp.json() == {"configured": False}

        me_resp = await client.get("/api/v1/auth/me", headers=headers)
        assert me_resp.json()["has_avatar"] is False
    finally:
        await db.users.delete_one({"email": email})


async def test_delete_my_avatar(client):
    db = get_db()
    email = await _insert_real_user(db)
    try:
        headers = await _bearer_for(email)
        await client.post(
            "/api/v1/auth/me/avatar",
            files={"file": ("a.png", _fake_png_bytes(), "image/png")},
            headers=headers,
        )
        delete_resp = await client.delete("/api/v1/auth/me/avatar", headers=headers)
        assert delete_resp.status_code == 200

        get_resp = await client.get("/api/v1/auth/me/avatar", headers=headers)
        assert get_resp.json() == {"configured": False}

        me_resp = await client.get("/api/v1/auth/me", headers=headers)
        assert me_resp.json()["has_avatar"] is False
    finally:
        await db.users.delete_one({"email": email})


async def test_delete_my_avatar_is_idempotent_when_none_uploaded(client):
    db = get_db()
    email = await _insert_real_user(db)
    try:
        headers = await _bearer_for(email)
        resp = await client.delete("/api/v1/auth/me/avatar", headers=headers)
        assert resp.status_code == 200
    finally:
        await db.users.delete_one({"email": email})


async def test_avatar_endpoints_are_scoped_to_the_callers_own_account(client):
    db = get_db()
    email_a = await _insert_real_user(db)
    email_b = await _insert_real_user(db)
    try:
        headers_a = await _bearer_for(email_a)
        headers_b = await _bearer_for(email_b)

        png_a = _fake_png_bytes()
        await client.post(
            "/api/v1/auth/me/avatar", files={"file": ("a.png", png_a, "image/png")}, headers=headers_a,
        )

        get_b = await client.get("/api/v1/auth/me/avatar", headers=headers_b)
        assert get_b.json() == {"configured": False}

        await client.delete("/api/v1/auth/me/avatar", headers=headers_b)
        get_a_after = await client.get("/api/v1/auth/me/avatar", headers=headers_a)
        assert get_a_after.json()["configured"] is True

        import base64
        assert base64.b64decode(get_a_after.json()["image_base64"]) == png_a

        doc_b = await db.users.find_one({"email": email_b})
        assert not doc_b.get("avatar_base64")
    finally:
        await db.users.delete_one({"email": email_a})
        await db.users.delete_one({"email": email_b})


async def test_list_users_never_includes_avatar_base64(client, admin_headers):
    db = get_db()
    email = await _insert_real_user(db)
    try:
        headers = await _bearer_for(email)
        await client.post(
            "/api/v1/auth/me/avatar",
            files={"file": ("a.png", _fake_png_bytes(), "image/png")},
            headers=headers,
        )
        list_resp = await client.get("/api/v1/auth/users", headers=admin_headers)
        assert list_resp.status_code == 200
        assert all("avatar_base64" not in u for u in list_resp.json())
    finally:
        await db.users.delete_one({"email": email})


async def test_login_response_includes_has_avatar_flag(client):
    db = get_db()
    password = "AvatarLogin@123"
    email = await _insert_real_user(db, password=password)
    try:
        headers = await _bearer_for(email)
        await client.post(
            "/api/v1/auth/me/avatar",
            files={"file": ("a.png", _fake_png_bytes(), "image/png")},
            headers=headers,
        )

        login_resp = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
        assert login_resp.status_code == 200
        assert login_resp.json()["user"]["has_avatar"] is True
        assert "avatar_base64" not in login_resp.json()["user"]
    finally:
        await db.users.delete_one({"email": email})
