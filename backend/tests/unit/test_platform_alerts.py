import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from pymongo.errors import DuplicateKeyError

from config.tenancy import current_company, current_company_id
from services.hr_module import alerts_service as alerts, email_service

pytestmark = pytest.mark.anyio


class Settings:

    def __init__(self):
        self.docs: dict[str, dict] = {}

    async def find_one_and_update(self, flt, update, upsert=False, return_document=None):
        doc_id = flt["_id"]
        existing = self.docs.get(doc_id)
        matches = existing is not None and any(
            ("last_sent_at" not in existing) if "$exists" in clause.get("last_sent_at", {}) else (
                "last_sent_at" in existing and existing["last_sent_at"] < clause["last_sent_at"]["$lt"]
            )
            for clause in flt["$or"]
        )
        if existing is not None and not matches:
            raise DuplicateKeyError("E11000 duplicate key")
        before = dict(existing) if existing else None
        doc = existing if existing is not None else {"_id": doc_id, **update.get("$setOnInsert", {})}
        doc.update(update["$set"])
        self.docs[doc_id] = doc
        return before

    async def delete_one(self, flt):
        doc = self.docs.get(flt["_id"])
        if doc and all(doc.get(k) == v for k, v in flt.items()):
            del self.docs[flt["_id"]]

    async def update_one(self, flt, update):
        doc = self.docs.get(flt["_id"])
        if doc and all(doc.get(k) == v for k, v in flt.items()):
            doc.update(update["$set"])


class Cursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, *a, **k):
        return self

    async def to_list(self, length=None):
        return self.rows


class Users:
    def __init__(self, rows):
        self.rows = rows

    def find(self, flt, projection=None):
        return Cursor(self.rows)


class Companies:
    def __init__(self):
        self.updates = []

    async def find_one(self, flt, projection=None):
        return {"name": "Acme Hiring", "client_id": "cli_a"} if flt.get("company_id") == "cmp_a" else None

    async def update_one(self, flt, update):
        self.updates.append((flt, update))


class Clients:
    async def find_one(self, flt, projection=None):
        return {"name": "Acme Group"} if flt.get("client_id") == "cli_a" else None


class Raw:
    def __init__(self, owners=("owner@platform.test",)):
        self.settings = Settings()
        self.users = Users([{"email": e} for e in owners])
        self.companies = Companies()
        self.clients = Clients()


class Mailbox:

    def __init__(self, result=True):
        self.sent: list[dict] = []
        self.result = result

    async def __call__(self, *, to, subject, html_body, text_body, db=None, **kw):
        self.sent.append({
            "to": to, "subject": subject, "text": text_body, "html": html_body, "db": db,
            "company_id": current_company_id(), "kind": (current_company() or {}).get("kind"),
        })
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


@pytest.fixture
def world(monkeypatch):
    raw = Raw()
    mailbox = Mailbox()
    monkeypatch.setattr(alerts, "get_platform_db", lambda: raw)
    monkeypatch.setattr(email_service, "send_email", mailbox)
    monkeypatch.setattr(alerts.settings, "PLATFORM_ALERT_EMAILS", "")
    return raw, mailbox


def test_recipients_are_the_owners_then_the_configured_extras_without_duplicates_or_junk():
    out = alerts.merge_recipients(
        ["Owner@Platform.test", "second@platform.test", None, "not an address"],
        "ops@x.test, OWNER@platform.test ; bad, ops@x.test\nlate@x.test",
    )
    assert out == ["owner@platform.test", "second@platform.test", "ops@x.test", "late@x.test"]
    assert alerts.merge_recipients([], "") == [] and alerts.merge_recipients([], None) == []


def test_a_runaway_list_is_capped():
    many = [f"u{i}@x.test" for i in range(100)]
    assert len(alerts.merge_recipients(many, "")) == alerts.MAX_RECIPIENTS


def test_the_throttle_document_is_alert_colon_key_and_per_company_when_the_alert_is_about_one():
    assert alerts.throttle_id("cron_failed") == "alert:cron_failed"
    assert alerts.throttle_id("cron_failed", "cmp_a") == "alert:cron_failed:cmp_a"
    assert alerts.throttle_id("storage_90:cmp_a", "cmp_a") == "alert:storage_90:cmp_a"


def test_the_body_is_escaped_into_paragraphs():
    html = alerts.render("Line one\n\n<b>Acme</b> & co")
    assert html == "<p>Line one</p><p>&lt;b&gt;Acme&lt;/b&gt; &amp; co</p>"


async def test_an_alert_goes_to_every_owner_and_extra_address_one_message_each(world, monkeypatch):
    raw, mailbox = world
    raw.users = Users([{"email": "a@platform.test"}, {"email": "b@platform.test"}])
    monkeypatch.setattr(alerts.settings, "PLATFORM_ALERT_EMAILS", "ops@x.test")
    assert await alerts.alert_owners("k1", "Subject", "Body line") is True
    assert sorted(m["to"] for m in mailbox.sent) == ["a@platform.test", "b@platform.test", "ops@x.test"]
    assert all(m["subject"] == "Subject" and m["text"] == "Body line" for m in mailbox.sent)
    assert "alert:k1" in raw.settings.docs and raw.settings.docs["alert:k1"]["key"] == "alert:k1"


async def test_the_message_is_sent_as_the_platform_workspace_and_is_not_logged_on_a_company(world):
    raw, mailbox = world
    await alerts.alert_owners("k1", "S", "B")
    assert mailbox.sent[0]["kind"] == "platform" and mailbox.sent[0]["company_id"] == "cmp_platform"
    assert mailbox.sent[0]["db"] is None


async def test_a_second_alert_inside_the_cooldown_sends_nothing(world):
    raw, mailbox = world
    assert await alerts.alert_owners("k1", "S", "B", cooldown_hours=24) is True
    assert await alerts.alert_owners("k1", "S", "B", cooldown_hours=24) is False
    assert len(mailbox.sent) == 1
    assert await alerts.alert_owners("other", "S", "B") is True
    assert len(mailbox.sent) == 2


async def test_the_alert_is_sent_again_once_the_cooldown_has_passed(world):
    raw, mailbox = world
    await alerts.alert_owners("k1", "S", "B", cooldown_hours=24)
    raw.settings.docs["alert:k1"]["last_sent_at"] = datetime.now(timezone.utc) - timedelta(hours=25)
    assert await alerts.alert_owners("k1", "S", "B", cooldown_hours=24) is True
    assert len(mailbox.sent) == 2
    assert await alerts.alert_owners("k1", "S", "B", cooldown_hours=24 * 7) is False


async def test_two_alerts_at_the_same_instant_send_one_message(world):
    raw, mailbox = world
    results = await asyncio.gather(*(alerts.alert_owners("race", "S", "B") for _ in range(5)))
    assert sorted(results) == [False, False, False, False, True]
    assert len(mailbox.sent) == 1


async def test_an_alert_about_a_company_is_throttled_per_company_and_names_it(world):
    raw, mailbox = world
    assert await alerts.alert_owners("ai_budget", "S", "Body", company_id="cmp_a") is True
    assert await alerts.alert_owners("ai_budget", "S", "Body", company_id="cmp_b") is True
    assert await alerts.alert_owners("ai_budget", "S", "Body", company_id="cmp_a") is False
    assert {"alert:ai_budget:cmp_a", "alert:ai_budget:cmp_b"} <= set(raw.settings.docs)
    assert "Company: Acme Hiring (client: Acme Group)" in mailbox.sent[0]["text"]


async def test_a_send_that_did_not_leave_gives_the_slot_back_so_the_next_try_sends(world):
    raw, mailbox = world
    mailbox.result = False
    assert await alerts.alert_owners("k1", "S", "B") is False
    assert "alert:k1" not in raw.settings.docs
    mailbox.result = True
    assert await alerts.alert_owners("k1", "S", "B") is True
    assert len(mailbox.sent) == 2


async def test_giving_the_slot_back_restores_the_time_of_the_last_real_send(world):
    raw, mailbox = world
    await alerts.alert_owners("k1", "S", "B", cooldown_hours=1)
    earlier = datetime.now(timezone.utc) - timedelta(hours=3)
    raw.settings.docs["alert:k1"]["last_sent_at"] = earlier
    mailbox.result = False
    assert await alerts.alert_owners("k1", "S", "B", cooldown_hours=1) is False
    assert raw.settings.docs["alert:k1"]["last_sent_at"] == earlier


async def test_it_never_raises(world, monkeypatch):
    raw, mailbox = world
    mailbox.result = RuntimeError("smtp exploded")
    assert await alerts.alert_owners("k1", "S", "B") is False
    assert "alert:k1" not in raw.settings.docs
    mailbox.result = True

    async def boom(*a, **k):
        raise RuntimeError("database gone")

    monkeypatch.setattr(raw.settings, "find_one_and_update", boom)
    assert await alerts.alert_owners("k2", "S", "B") is False
    monkeypatch.setattr(alerts, "get_platform_db", lambda: None)
    assert await alerts.alert_owners("k3", "S", "B") is False


async def test_with_nobody_to_tell_nothing_is_claimed_or_sent(world):
    raw, mailbox = world
    raw.users = Users([])
    assert await alerts.alert_owners("k1", "S", "B") is False
    assert mailbox.sent == [] and raw.settings.docs == {}


@pytest.fixture
def company_world(world, monkeypatch):
    raw, mailbox = world
    from services.hr_module import workspace_service

    async def load_company(company_id):
        return {"company_id": company_id, "name": "Acme Hiring", "kind": "workspace", "settings": {}} if company_id == "cmp_a" else None

    class Db:
        users = Users([{"email": "admin1@acme.test"}, {"email": "admin2@acme.test"}])

    monkeypatch.setattr(workspace_service, "load_company", load_company)
    monkeypatch.setattr(alerts, "get_db", lambda: Db())
    return raw, mailbox


async def test_company_administrators_are_mailed_as_that_company_and_the_mail_is_logged_on_it(company_world):
    raw, mailbox = company_world
    assert await alerts.alert_company_admins("cmp_a", "ai_budget_80:2026-10", "Subject", "Body") is True
    assert sorted(m["to"] for m in mailbox.sent) == ["admin1@acme.test", "admin2@acme.test"]
    assert all(m["company_id"] == "cmp_a" and m["kind"] == "workspace" and m["db"] is not None for m in mailbox.sent)
    assert "alert:company:ai_budget_80:2026-10:cmp_a" in raw.settings.docs
    assert await alerts.alert_company_admins("cmp_a", "ai_budget_80:2026-10", "Subject", "Body") is False
    assert len(mailbox.sent) == 2


async def test_a_company_notice_that_cannot_be_sent_is_not_marked_sent(company_world):
    raw, mailbox = company_world
    mailbox.result = False
    assert await alerts.alert_company_admins("cmp_a", "k", "S", "B") is False
    assert raw.settings.docs == {}
    assert await alerts.alert_company_admins("cmp_gone", "k", "S", "B") is False
    assert await alerts.alert_company_admins("", "k", "S", "B") is False


def test_budget_texts_carry_the_figures_and_say_what_happens_next_without_an_em_dash():
    for band in (80, 100):
        texts = alerts.budget_texts("Acme Hiring", band, 8.5, 10.0)
        assert all(chr(0x2014) not in t for t in texts)
        owner_subject, owner_body, company_subject, company_body = texts
        assert "Acme Hiring" in owner_subject and "$8.50 of its $10.00" in owner_body
        assert "$8.50 of its $10.00" in company_body and "Interviews already sent" in company_body
    assert "80%" in alerts.budget_texts("A", 80, 8, 10)[0] and "used its monthly AI budget" in alerts.budget_texts("A", 100, 10, 10)[0]
    assert "paused" in alerts.budget_texts("A", 100, 10, 10)[3]


async def test_a_crossing_tells_owners_and_the_company_once_and_leaves_a_marker(monkeypatch):
    raw = Raw()
    owners, admins = AsyncMock(return_value=True), AsyncMock(return_value=True)
    monkeypatch.setattr(alerts, "get_platform_db", lambda: raw)
    monkeypatch.setattr(alerts, "alert_owners", owners)
    monkeypatch.setattr(alerts, "alert_company_admins", admins)
    await alerts.budget_threshold("cmp_a", 80, 8.5, 10.0, "2026-10")
    owners.assert_awaited_once()
    assert owners.await_args.args[0] == "ai_budget_80:2026-10" and owners.await_args.kwargs["company_id"] == "cmp_a"
    assert owners.await_args.kwargs["cooldown_hours"] >= 24 * 31
    admins.assert_awaited_once()
    assert admins.await_args.args[:2] == ("cmp_a", "ai_budget_80:2026-10")
    assert raw.companies.updates == [({"company_id": "cmp_a"}, {"$set": {"usage.ai_alert": {"month": "2026-10", "band": 80}}})]


async def test_the_eighty_and_the_hundred_percent_notices_are_separate_alerts(monkeypatch):
    raw = Raw()
    keys = []
    monkeypatch.setattr(alerts, "get_platform_db", lambda: raw)
    monkeypatch.setattr(alerts, "alert_owners", AsyncMock(side_effect=lambda key, *a, **k: keys.append(key)))
    monkeypatch.setattr(alerts, "alert_company_admins", AsyncMock())
    await alerts.budget_threshold("cmp_a", 80, 8.5, 10.0, "2026-10")
    await alerts.budget_threshold("cmp_a", 100, 10.5, 10.0, "2026-10")
    await alerts.budget_threshold("cmp_a", 80, 8.5, 10.0, "2026-11")
    assert keys == ["ai_budget_80:2026-10", "ai_budget_100:2026-10", "ai_budget_80:2026-11"]


async def test_a_budget_notice_never_raises(monkeypatch):
    monkeypatch.setattr(alerts, "get_platform_db", lambda: Raw())
    monkeypatch.setattr(alerts, "alert_owners", AsyncMock(side_effect=RuntimeError("boom")))
    monkeypatch.setattr(alerts, "alert_company_admins", AsyncMock())
    await alerts.budget_threshold("cmp_a", 100, 12.0, 10.0, "2026-10")
    monkeypatch.setattr(alerts, "get_platform_db", lambda: None)
    await alerts.budget_threshold("cmp_a", 100, 12.0, 10.0, "2026-10")
