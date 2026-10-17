import re
import sys
import types
from unittest.mock import AsyncMock

import pytest
from passlib.context import CryptContext

from services.hr_module import platform_service as svc

pytestmark = pytest.mark.anyio

_pwd = CryptContext(schemes=["bcrypt"])
GOOD = "Password-123!"


class Users:
    def __init__(self, rows=None):
        self.rows = rows or []
        self.inserted = []

    async def find_one(self, flt, projection=None):
        pattern = flt["email"]
        for row in self.rows:
            if re.match(pattern["$regex"], row["email"], re.IGNORECASE):
                return row
        return None

    async def count_documents(self, flt):
        assert flt["is_active"] == {"$ne": False}, "only active accounts are seats"
        return sum(1 for r in self.rows if r["company_id"] == flt["company_id"] and r.get("is_active") is not False)

    async def insert_one(self, doc):
        self.inserted.append(doc)
        self.rows.append(doc)


class Raw:
    def __init__(self, rows=None):
        self.users = Users(rows)


def _autouse_free_domains(monkeypatch):
    monkeypatch.setattr(svc.workspace_service, "domain_claimed_by_other", AsyncMock(return_value=False))


@pytest.fixture(autouse=True)
def _free_domains(monkeypatch):
    _autouse_free_domains(monkeypatch)


async def test_a_platform_owner_is_created_with_one_time_codes_required():
    raw = Raw()
    made = await svc._create_account(
        raw, company_id=svc.PLATFORM_COMPANY_ID, name="Olive Owner", email="Olive@Example.com", password=GOOD, owner=True,
    )
    doc = raw.users.inserted[0]
    assert (doc["otp_required"], doc["otp_enforced"], doc["is_platform_admin"]) == (True, True, True)
    assert doc["role"] == "superadmin" and doc["company_id"] == svc.PLATFORM_COMPANY_ID and doc["email"] == "olive@example.com"
    assert _pwd.verify(GOOD, doc["password_hash"])
    assert made == {"email": "olive@example.com", "name": "Olive Owner", "invite": False}


@pytest.mark.parametrize("missing", [None, "", "    "])
async def test_a_platform_owner_always_needs_a_password(missing):
    raw = Raw()
    with pytest.raises(svc.PlatformError) as refused:
        await svc._create_account(raw, company_id=svc.PLATFORM_COMPANY_ID, name="O", email="o@example.com", password=missing, owner=True)
    assert refused.value.status == 422 and not raw.users.inserted


async def test_a_company_administrator_does_not_need_a_code_and_is_not_an_owner():
    raw = Raw()
    await svc._create_account(raw, company_id="cmp_a", name="Ada", email="ada@a.test", password=GOOD)
    doc = raw.users.inserted[0]
    assert (doc["otp_required"], doc["otp_enforced"]) == (False, False) and "is_platform_admin" not in doc
    assert doc["role"] == "superadmin" and doc["is_active"] is True and doc["company_id"] == "cmp_a"


@pytest.mark.parametrize("none", [None, "", "   \t"])
async def test_without_a_password_the_account_is_invited_and_nobody_knows_its_password(none):
    raw = Raw()
    made = await svc._create_account(raw, company_id="cmp_a", name="Ada", email="ada@a.test", password=none)
    other = await svc._create_account(raw, company_id="cmp_a", name="Bob", email="bob@a.test", password=none)
    assert made["invite"] is True and other["invite"] is True
    first, second = raw.users.inserted
    assert first["password_hash"].startswith("$2") and first["password_hash"] != second["password_hash"]
    for guess in (GOOD, "", "password", none or "x"):
        assert not _pwd.verify(guess, first["password_hash"])


@pytest.mark.parametrize("bad", ["short", "1234567", "x" * 73, "é" * 40])
async def test_a_password_that_is_given_must_be_acceptable(bad):
    raw = Raw()
    with pytest.raises(svc.PlatformError) as refused:
        await svc._create_account(raw, company_id="cmp_a", name="Ada", email="ada@a.test", password=bad)
    assert refused.value.status == 422 and not raw.users.inserted


async def test_a_blank_name_or_a_bad_address_is_a_422():
    raw = Raw()
    for kwargs in ({"name": " "}, {"email": "nope"}, {"email": ""}):
        args = {"name": "Ada", "email": "ada@a.test", **kwargs}
        with pytest.raises(svc.PlatformError) as refused:
            await svc._create_account(raw, company_id="cmp_a", password=GOOD, **args)
        assert refused.value.status == 422
    assert not raw.users.inserted


async def test_an_address_registered_anywhere_on_the_platform_is_refused_without_saying_where():
    raw = Raw([{"email": "ada@a.test", "company_id": "cmp_other", "is_active": True}])
    with pytest.raises(svc.PlatformError) as refused:
        await svc._create_account(raw, company_id="cmp_a", name="Ada", email="ADA@a.test", password=GOOD)
    assert refused.value.status == 409 and refused.value.message == svc.EMAIL_TAKEN
    assert "cmp_other" not in refused.value.message


async def test_an_address_on_a_domain_another_company_has_claimed_is_refused(monkeypatch):
    claimed = AsyncMock(return_value=True)
    monkeypatch.setattr(svc.workspace_service, "domain_claimed_by_other", claimed)
    raw = Raw()
    with pytest.raises(svc.PlatformError) as refused:
        await svc._create_account(raw, company_id="cmp_a", name="Ada", email="Ada@Claimed.test", password=GOOD)
    assert refused.value.status == 409
    assert refused.value.message == "That email domain is reserved by another company."
    claimed.assert_awaited_once_with("ada@claimed.test", "cmp_a")
    assert not raw.users.inserted


async def test_a_taken_address_is_reported_before_a_reserved_domain(monkeypatch):
    monkeypatch.setattr(svc.workspace_service, "domain_claimed_by_other", AsyncMock(return_value=True))
    raw = Raw([{"email": "ada@claimed.test", "company_id": "cmp_other"}])
    with pytest.raises(svc.PlatformError) as refused:
        await svc._create_account(raw, company_id="cmp_a", name="Ada", email="ada@claimed.test", password=GOOD)
    assert refused.value.message == svc.EMAIL_TAKEN


async def test_an_owner_cannot_be_created_on_a_domain_a_company_has_claimed(monkeypatch):
    monkeypatch.setattr(svc.workspace_service, "domain_claimed_by_other", AsyncMock(return_value=True))
    with pytest.raises(svc.PlatformError) as refused:
        await svc._create_account(
            Raw(), company_id=svc.PLATFORM_COMPANY_ID, name="O", email="o@claimed.test", password=GOOD, owner=True,
        )
    assert refused.value.status == 409 and refused.value.message == svc.DOMAIN_RESERVED


async def test_the_first_administrator_of_a_new_company_is_checked_before_the_company_is_written(monkeypatch):
    written = []

    async def insert(raw, collection, doc, **kwargs):
        written.append(collection)

    monkeypatch.setattr(svc, "_insert_with_slug", insert)
    monkeypatch.setattr(svc.workspace_service, "domain_claimed_by_other", AsyncMock(return_value=True))
    client = {"client_id": "cli_a", "plan": {}}
    with pytest.raises(svc.PlatformError) as refused:
        await svc._create_company(Raw(), client, name="Co", slug=None, admin={"name": "A", "email": "a@claimed.test", "password": GOOD})
    assert refused.value.status == 409 and written == []

    taken = Raw([{"email": "a@free.test", "company_id": "cmp_other"}])
    monkeypatch.setattr(svc.workspace_service, "domain_claimed_by_other", AsyncMock(return_value=False))
    with pytest.raises(svc.PlatformError) as duplicate:
        await svc._create_company(taken, client, name="Co", slug=None, admin={"name": "A", "email": "a@free.test", "password": GOOD})
    assert duplicate.value.message == svc.EMAIL_TAKEN and written == []


def _staff(n, *, inactive=0, company="cmp_a"):
    return (
        [{"email": f"u{i}@a.test", "company_id": company, "is_active": True} for i in range(n)]
        + [{"email": f"x{i}@a.test", "company_id": company, "is_active": False} for i in range(inactive)]
        + [{"email": f"o{i}@b.test", "company_id": "cmp_b", "is_active": True} for i in range(20)]
    )


async def test_an_account_past_the_plans_user_limit_is_refused_with_the_plan_message():
    raw = Raw(_staff(2))
    with pytest.raises(svc.PlatformError) as refused:
        await svc._create_account(
            raw, company_id="cmp_a", name="Ada", email="new@a.test", password=GOOD, plan={"max_users_per_company": 2},
        )
    assert refused.value.status == 409
    assert refused.value.message == "Your plan allows at most 2 users. Ask your administrator to raise the limit."
    assert refused.value.message == svc.plan_service.SEAT_LIMIT_MESSAGE.format(limit=2)


async def test_deactivated_accounts_and_other_companies_do_not_use_a_seat():
    raw = Raw(_staff(1, inactive=5))
    await svc._create_account(
        raw, company_id="cmp_a", name="Ada", email="new@a.test", password=GOOD, plan={"max_users_per_company": 2},
    )
    assert raw.users.inserted[0]["email"] == "new@a.test"


@pytest.mark.parametrize("plan", [None, {}, {"max_users_per_company": None}, {"max_users_per_company": 0}])
async def test_no_limit_means_no_seat_check(plan):
    raw = Raw(_staff(50))
    await svc._create_account(raw, company_id="cmp_a", name="Ada", email="new@a.test", password=GOOD, plan=plan)
    assert len(raw.users.inserted) == 1


def _install_credentials(monkeypatch, send):
    fake = types.ModuleType("services.hr_module.credentials_service")
    fake.send_invite = send
    import services.hr_module as package

    monkeypatch.setitem(sys.modules, "services.hr_module.credentials_service", fake)
    monkeypatch.setattr(package, "credentials_service", fake, raising=False)


async def test_the_invitation_goes_through_the_credentials_service_as_that_company(monkeypatch):
    send = AsyncMock(return_value=True)
    _install_credentials(monkeypatch, send)
    account = {"email": "ada@a.test", "name": "Ada", "invite": True}
    assert await svc._invite_admin({"email": "owner@platform.test"}, account, "cmp_a") is True
    send.assert_awaited_once_with(email="ada@a.test", name="Ada", company_id="cmp_a", invited_by="owner@platform.test")


async def test_an_invitation_that_did_not_leave_is_reported_not_claimed(monkeypatch):
    _install_credentials(monkeypatch, AsyncMock(return_value=False))
    account = {"email": "ada@a.test", "name": "Ada", "invite": True}
    assert await svc._invite_admin({"email": "o@x.test"}, account, "cmp_a") is False

    _install_credentials(monkeypatch, AsyncMock(side_effect=RuntimeError("smtp down")))
    assert await svc._invite_admin({"email": "o@x.test"}, account, "cmp_a") is False


async def test_this_module_works_before_the_credentials_service_exists(monkeypatch):
    import services.hr_module as package

    monkeypatch.setitem(sys.modules, "services.hr_module.credentials_service", None)
    monkeypatch.delattr(package, "credentials_service", raising=False)
    account = {"email": "ada@a.test", "name": "Ada", "invite": True}
    assert await svc._invite_admin({"email": "o@x.test"}, account, "cmp_a") is False


async def test_only_an_account_without_a_password_is_invited(monkeypatch):
    send = AsyncMock(return_value=True)
    _install_credentials(monkeypatch, send)
    actor = {"email": "o@x.test"}
    assert await svc._invite_if_needed(actor, {"email": "a@a.test", "name": "A", "invite": False}, "cmp_a") is None
    send.assert_not_awaited()
    assert await svc._invite_if_needed(actor, {"email": "a@a.test", "name": "A", "invite": True}, "cmp_a") is True
    send.assert_awaited_once()


def test_email_sent_is_in_an_answer_only_when_an_invitation_was_attempted():
    assert svc._email_sent(None) == {}
    assert svc._email_sent(True) == {"email_sent": True}
    assert svc._email_sent(False) == {"email_sent": False}


def test_the_audit_details_name_the_address_and_how_they_were_told_and_never_a_password():
    assert svc._admin_audit({"email": "a@a.test", "name": "A", "invite": False}, None) == {"email": "a@a.test"}
    assert svc._admin_audit({"email": "a@a.test", "name": "A", "invite": True}, False) == {
        "email": "a@a.test", "invited": True, "email_sent": False,
    }
    assert svc._public_admin({"email": "a@a.test", "name": "A", "invite": True}) == {"email": "a@a.test", "name": "A"}
