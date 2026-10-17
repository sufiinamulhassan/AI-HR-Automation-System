import re
from datetime import datetime, timedelta, timezone

import pytest

from services.hr_module import account_protection_service as lockout

pytestmark = pytest.mark.anyio

T0 = datetime(2026, 10, 1, 12, 0, 0, tzinfo=timezone.utc)


class _Result:
    def __init__(self, matched=0, modified=0):
        self.matched_count, self.modified_count = matched, modified


class _Cursor:
    def __init__(self, docs):
        self._docs = docs

    async def to_list(self, length=None):
        return self._docs[:length] if length else self._docs


class FakeRateLimits:

    def __init__(self):
        self.docs: dict[str, dict] = {}

    @staticmethod
    def _matches(doc, flt):
        for key, want in flt.items():
            have = doc.get(key)
            if isinstance(want, dict):
                if "$in" in want and have not in want["$in"]:
                    return False
                if "$exists" in want and (key in doc) != want["$exists"]:
                    return False
                if "$regex" in want and not (isinstance(have, str) and re.search(want["$regex"], have)):
                    return False
            elif have != want:
                return False
        return True

    def find(self, flt):
        return _Cursor([dict(d) for d in self.docs.values() if self._matches(d, flt)])

    async def find_one_and_update(self, flt, update, upsert=False, return_document=False):
        doc = self.docs.get(flt["_id"])
        if doc is None:
            if not upsert:
                return None
            doc = {"_id": flt["_id"], **update.get("$setOnInsert", {})}
            self.docs[doc["_id"]] = doc
        for field, amount in update.get("$inc", {}).items():
            doc[field] = doc.get(field, 0) + amount
        return dict(doc)

    async def update_one(self, flt, update):
        doc = self.docs.get(flt.get("_id"))
        if doc is None or not self._matches(doc, flt):
            return _Result()
        before = dict(doc)
        doc.update(update.get("$set", {}))
        for field in update.get("$unset", {}):
            doc.pop(field, None)
        return _Result(1, int(doc != before))

    async def delete_one(self, flt):
        self.docs.pop(flt["_id"], None)

    async def delete_many(self, flt):
        for key in [k for k, d in self.docs.items() if self._matches(d, flt)]:
            del self.docs[key]


class FakeDb:
    def __init__(self):
        self.rate_limits = FakeRateLimits()


@pytest.fixture
def db():
    return FakeDb()


async def fail(db, email="ann@example.com", address="203.0.113.5", n=2, minutes=15, now=T0):
    return await lockout.record_failure(db, email, address, max_attempts=n, minutes=minutes, now=now)


@pytest.mark.parametrize("n,expected", [(1, 25), (3, 25), (5, 25), (6, 30), (10, 50), (40, 200)])
def test_the_account_threshold_is_five_times_the_policy_with_a_floor_of_twenty_five(n, expected):
    assert lockout.account_threshold(n) == expected


def test_the_locked_answer_is_one_sentence():
    assert lockout.LOCKED_MESSAGE == "Too many sign-in attempts. Try again later."


def test_keys_hold_neither_the_email_nor_the_address():
    pair = lockout.pair_key("Ann@Example.com", "203.0.113.5")
    account = lockout.account_key("ann@example.com")
    for key in (pair, account):
        assert "ann" not in key.lower().replace("pair", "") and "203.0.113.5" not in key and "example" not in key
        assert key.startswith("login:")
    assert pair == lockout.pair_key("ann@example.com", "203.0.113.5")
    assert pair != lockout.pair_key("ann@example.com", "203.0.113.6")
    assert pair != lockout.pair_key("bob@example.com", "203.0.113.5")
    assert len(pair) < 100 and len(lockout.pair_key("x" * 250 + "@example.com", "1" * 45)) < 100


async def test_n_failures_lock_that_pair_and_the_nth_answers_locked(db):
    assert not (await fail(db)).locked
    assert not (await lockout.lock_state(db, "ann@example.com", "203.0.113.5", now=T0)).locked
    outcome = await fail(db)
    assert outcome.locked and not outcome.account_locked_now
    assert (await lockout.lock_state(db, "ann@example.com", "203.0.113.5", now=T0)).locked


async def test_another_address_is_not_locked_by_the_first_ones_failures(db):
    await fail(db)
    await fail(db)
    assert (await lockout.lock_state(db, "ann@example.com", "203.0.113.5", now=T0)).locked
    other = await lockout.lock_state(db, "ann@example.com", "198.51.100.9", now=T0)
    assert not other.locked and not other.has_pair_record
    assert not (await lockout.lock_state(db, "bob@example.com", "203.0.113.5", now=T0)).locked


async def test_a_policy_of_zero_creates_and_counts_nothing(db):
    for _ in range(40):
        outcome = await fail(db, n=0)
        assert not outcome.locked and not outcome.account_locked_now
    assert db.rate_limits.docs == {}
    assert not (await lockout.lock_state(db, "ann@example.com", "203.0.113.5", now=T0)).locked


async def test_a_failure_creates_at_most_two_documents(db):
    await fail(db)
    assert len(db.rate_limits.docs) == 2
    await fail(db)
    assert len(db.rate_limits.docs) == 2
    await fail(db, address="198.51.100.9")
    assert len(db.rate_limits.docs) == 3


async def test_an_email_that_has_no_account_is_counted_exactly_like_one_that_has(db):
    outcomes = {}
    for email in ("real@example.com", "ghost-48213@example.com"):
        local = FakeDb()
        seq = []
        for _ in range(4):
            result = await lockout.record_failure(local, email, "203.0.113.5", max_attempts=3, minutes=15, now=T0)
            seq.append((result.locked, result.account_locked_now))
        outcomes[email] = (seq, sorted(re.sub(r"[0-9a-f]{24}", "H", k) for k in local.rate_limits.docs))
    assert outcomes["real@example.com"] == outcomes["ghost-48213@example.com"]
    assert outcomes["real@example.com"][0] == [(False, False), (False, False), (True, False), (True, False)]


async def test_a_correct_sign_in_clears_the_pair_and_only_the_pair(db):
    await fail(db, n=3)
    await fail(db, n=3, address="198.51.100.9")
    state = await lockout.lock_state(db, "ann@example.com", "203.0.113.5", now=T0)
    assert state.has_pair_record and not state.locked
    await lockout.clear_pair(db, "ann@example.com", "203.0.113.5")
    assert not (await lockout.lock_state(db, "ann@example.com", "203.0.113.5", now=T0)).has_pair_record
    assert (await lockout.lock_state(db, "ann@example.com", "198.51.100.9", now=T0)).has_pair_record


async def test_failures_after_a_clear_start_from_zero(db):
    await fail(db, n=2)
    await lockout.clear_pair(db, "ann@example.com", "203.0.113.5")
    assert not (await fail(db, n=2)).locked
    assert (await fail(db, n=2)).locked


async def test_the_lock_lasts_the_duration_and_then_lifts(db):
    await fail(db, n=2, minutes=10)
    await fail(db, n=2, minutes=10)
    for minutes, locked in ((1, True), (9, True), (11, False)):
        state = await lockout.lock_state(db, "ann@example.com", "203.0.113.5", now=T0 + timedelta(minutes=minutes))
        assert state.locked is locked, minutes


async def test_after_the_lock_lifts_the_next_failure_starts_a_new_window(db):
    await fail(db, n=2, minutes=10)
    await fail(db, n=2, minutes=10)
    later = T0 + timedelta(minutes=11)
    outcome = await fail(db, n=2, minutes=10, now=later)
    assert not outcome.locked
    assert (await fail(db, n=2, minutes=10, now=later + timedelta(seconds=1))).locked


async def test_failures_spread_over_more_than_the_window_do_not_add_up(db):
    await fail(db, n=3, minutes=10, now=T0)
    await fail(db, n=3, minutes=10, now=T0 + timedelta(minutes=4))
    assert not (await fail(db, n=3, minutes=10, now=T0 + timedelta(minutes=11))).locked


async def test_naive_datetimes_from_the_database_are_read_as_utc(db):
    await fail(db, n=2)
    await fail(db, n=2)
    for doc in db.rate_limits.docs.values():
        for field in ("expires_at", "locked_until"):
            if field in doc:
                doc[field] = doc[field].replace(tzinfo=None)
    assert (await lockout.lock_state(db, "ann@example.com", "203.0.113.5", now=T0 + timedelta(minutes=1))).locked
    assert not (await lockout.lock_state(db, "ann@example.com", "203.0.113.5", now=T0 + timedelta(minutes=16))).locked


async def test_failures_from_many_addresses_lock_the_account_and_say_so_once(db):
    n = 3
    threshold = lockout.account_threshold(n)
    assert threshold == 25
    locked_now = []
    for i in range(threshold):
        outcome = await fail(db, n=n, address=f"198.51.100.{i}")
        locked_now.append(outcome.account_locked_now)
        if i < threshold - 1:
            assert not outcome.locked, i
    assert locked_now[-1] is True and sum(locked_now) == 1
    assert (await lockout.lock_state(db, "ann@example.com", "192.0.2.77", now=T0)).locked
    again = await fail(db, n=n, address="192.0.2.99")
    assert again.locked and not again.account_locked_now


async def test_with_a_large_policy_the_threshold_scales(db):
    n = 10
    for i in range(49):
        assert not (await fail(db, n=n, address=f"198.51.{i // 200}.{i}")).locked
    assert (await fail(db, n=n, address="192.0.2.1")).account_locked_now


async def test_a_reset_forgets_every_address_of_that_email_and_no_other(db):
    for address in ("203.0.113.5", "198.51.100.9"):
        await fail(db, n=2, address=address)
        await fail(db, n=2, address=address)
    await fail(db, email="bob@example.com", n=2)
    await lockout.clear_email(db, "ann@example.com")
    for address in ("203.0.113.5", "198.51.100.9"):
        state = await lockout.lock_state(db, "ann@example.com", address, now=T0)
        assert not state.locked and not state.has_pair_record
    assert (await lockout.lock_state(db, "bob@example.com", "203.0.113.5", now=T0)).has_pair_record


async def test_the_owner_alert_is_sent_through_the_alert_service(monkeypatch):
    import sys
    import types

    calls = []

    async def alert_owners(key, subject, body, *, company_id=None, cooldown_hours=24):
        calls.append((key, subject, body, company_id))
        return True

    module = types.ModuleType("services.hr_module.alerts_service")
    module.alert_owners = alert_owners
    monkeypatch.setitem(sys.modules, "services.hr_module.alerts_service", module)
    await lockout.alert_account_locked(company_id="cmp_x", attempts=25)
    await lockout.alert_account_locked(company_id=None, attempts=25)
    assert [c[0] for c in calls] == ["login-lockout:cmp_x", "login-lockout:unknown"]
    assert calls[0][3] == "cmp_x" and "@" not in calls[0][2]
    assert "no account" in calls[1][2]


async def test_the_alert_never_raises_when_the_service_is_missing_or_broken(monkeypatch):
    import sys
    import types

    monkeypatch.setitem(sys.modules, "services.hr_module.alerts_service", None)
    await lockout.alert_account_locked(company_id="cmp_x")

    async def broken(*args, **kwargs):
        raise RuntimeError("mail is down")

    module = types.ModuleType("services.hr_module.alerts_service")
    module.alert_owners = broken
    monkeypatch.setitem(sys.modules, "services.hr_module.alerts_service", module)
    await lockout.alert_account_locked(company_id="cmp_x")
