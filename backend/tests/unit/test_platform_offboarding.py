import copy

import pytest

from services.hr_module import platform_service as svc

pytestmark = pytest.mark.anyio

X, Y = "cmp_gone", "cmp_stays"
OWNER = {"email": "owner@platform.test"}


class Result:
    def __init__(self, deleted_count=0):
        self.deleted_count = deleted_count


class Cursor:
    def __init__(self, docs):
        self.docs = docs

    def sort(self, key, direction=1):
        self.docs = sorted(self.docs, key=lambda d: d[key], reverse=direction < 0)
        return self

    def limit(self, n):
        self.docs = self.docs[:n]
        return self

    async def to_list(self, length=None):
        return [dict(d) for d in self.docs]


class Coll:
    def __init__(self, db, name):
        self.db = db
        self.name = name

    @property
    def docs(self):
        return self.db.data.setdefault(self.name, [])

    async def delete_many(self, flt):
        self.db.events.append(("delete_many", self.name, dict(flt)))
        assert set(flt) == {"company_id"}, f"{self.name}: a sweep may use the company id and nothing else: {flt}"
        keep = [d for d in self.docs if d.get("company_id") != flt["company_id"]]
        removed = len(self.docs) - len(keep)
        self.db.data[self.name] = keep
        return Result(removed)

    async def count_documents(self, flt):
        return sum(1 for d in self.docs if all(d.get(k) == v for k, v in flt.items()))

    def find(self, query, projection=None):
        rows = [d for d in self.docs if d.get("company_id") == query.get("company_id")]
        if "_id" in query:
            rows = [d for d in rows if d["_id"] > query["_id"]["$gt"]]
        return Cursor(rows)

    async def find_one(self, flt, projection=None):
        for d in self.docs:
            if all(d.get(k) == v for k, v in flt.items()):
                return dict(d)
        return None

    async def update_one(self, flt, update):
        for d in self.docs:
            if all(d.get(k) == v for k, v in flt.items()):
                for op, body in update.items():
                    for path, value in body.items():
                        *parents, last = path.split(".")
                        target = d
                        for part in parents:
                            target = target.setdefault(part, {})
                        target[last] = value if op == "$set" else target.get(last, 0) + value
                return

    async def delete_one(self, flt):
        self.db.events.append(("delete_one", self.name, dict(flt)))
        for d in self.docs:
            if all(d.get(k) == v for k, v in flt.items()):
                self.docs.remove(d)
                return Result(1)
        return Result(0)


class FakeDB:
    def __init__(self, data):
        self.data = data
        self.events = []

    def __getitem__(self, name):
        return Coll(self, name)

    __getattr__ = __getitem__

    async def list_collection_names(self):
        return list(self.data)

    def rows(self, name, company_id):
        return [d for d in self.data.get(name, []) if d.get("company_id") == company_id]


class FakeIndex:
    def __init__(self, db, fail=False):
        self.db = db
        self.fail = fail
        self.calls = []

    def delete(self, ids, namespace=None):
        if self.fail:
            raise RuntimeError("pinecone is down")
        self.calls.append((list(ids), namespace))
        self.db.events.append(("vectors", len(ids), namespace, len(self.db.rows("resumes", X))))


def _seed(resumes=2500):
    data = {
        "companies": [{"company_id": X, "client_id": "cli_x", "name": "Gone Co", "slug": "gone-co", "status": "suspended"}],
        "clients": [{"client_id": "cli_x", "name": "Client X", "slug": "client-x"}],
        "users": [
            {"_id": 1, "company_id": X, "email": "a@gone.test", "role": "superadmin"},
            {"_id": 2, "company_id": X, "email": "b@gone.test", "role": "standard"},
            {"_id": 3, "company_id": Y, "email": "c@stays.test", "role": "superadmin"},
        ],
        "jobs": [{"_id": i, "company_id": X, "job_id": f"job-x-{i}"} for i in range(1, 4)]
        + [{"_id": 10, "company_id": Y, "job_id": "job-y"}],
        "resumes": [{"_id": i, "company_id": X, "resume_id": f"res-x-{i}"} for i in range(1, resumes + 1)]
        + [{"_id": 100000, "company_id": Y, "resume_id": "res-y"}],
        "cost_ledger": [{"_id": i, "company_id": X} for i in range(4)] + [{"_id": 9, "company_id": Y}],
        "audit_log": [{"_id": 1, "company_id": X}, {"_id": 2, "company_id": "cmp_platform"}],
        "email_log": [],
        "rate_limits": [{"_id": "r", "company_id": X}],
        "password_tokens": [{"_id": "p", "company_id": X}],
        "otp_logs": [{"_id": "o", "company_id": X}],
        "sso_states": [{"_id": "s", "company_id": X}],
        "settings": [{"_id": "t", "company_id": X}],
        "system.profile": [{"_id": "q", "company_id": X}],
    }
    return FakeDB(data)


def _world(monkeypatch):

    def build(*, resumes=2500, pinecone=True, fail=False, budget=40.0):
        db = _seed(resumes)
        index = FakeIndex(db, fail=fail) if pinecone else None

        async def audit(actor, action, resource_type, resource_id=None, details=None, **kwargs):
            db.events.append(("audit", action, resource_id, kwargs))

        async def require_company(raw, company_id):
            doc = next((copy.deepcopy(d) for d in db.data["companies"] if d["company_id"] == company_id), None)
            if doc is None:
                raise svc.PlatformError(404, "Company not found.")
            return doc, {"client_id": doc["client_id"], "name": "Client X"}

        async def require_client(raw, client_id):
            doc = next((copy.deepcopy(d) for d in db.data["clients"] if d["client_id"] == client_id), None)
            if doc is None:
                raise svc.PlatformError(404, "Client not found.")
            return doc

        monkeypatch.setattr(svc, "get_platform_db", lambda: db)
        monkeypatch.setattr(svc, "get_pinecone", lambda: index)
        monkeypatch.setattr(svc.workspace_service, "platform_audit", audit)
        monkeypatch.setattr(svc, "_require_company", require_company)
        monkeypatch.setattr(svc, "_require_client", require_client)
        monkeypatch.setattr(svc, "OFFBOARD_BUDGET_SECONDS", budget)
        return db, index

    return build


@pytest.fixture
def world(monkeypatch):
    return _world(monkeypatch)


def _events(db, kind):
    return [e for e in db.events if e[0] == kind]


async def test_the_internal_workspaces_can_never_be_deleted(world):
    db, _ = world()
    for company_id in ("cmp_platform", "cmp_default"):
        with pytest.raises(svc.PlatformError) as refused:
            await svc.delete_company(OWNER, company_id, "anything")
        assert refused.value.status == 409
    for client_id in ("cli_platform", "cli_default"):
        with pytest.raises(svc.PlatformError) as refused:
            await svc.delete_client(OWNER, client_id, "anything")
        assert refused.value.status == 409
    assert db.events == []


async def test_a_company_that_is_not_suspended_or_a_slug_that_does_not_match_is_refused_untouched(world):
    db, _ = world()
    db.data["companies"][0]["status"] = "active"
    with pytest.raises(svc.PlatformError) as active:
        await svc.delete_company(OWNER, X, "gone-co")
    assert active.value.status == 409 and "Suspend" in active.value.message

    db.data["companies"][0]["status"] = "suspended"
    for wrong in ("other", "", None, "gone"):
        with pytest.raises(svc.PlatformError) as mismatch:
            await svc.delete_company(OWNER, X, wrong)
        assert mismatch.value.status == 422
    with pytest.raises(svc.PlatformError) as unknown:
        await svc.delete_company(OWNER, "cmp_nobody", "gone-co")
    assert unknown.value.status == 404
    assert db.events == []
    assert len(db.rows("resumes", X)) == 2500


async def test_the_slug_may_be_typed_with_spaces_or_capitals(world):
    db, _ = world(resumes=3)
    out = await svc.delete_company(OWNER, X, "  Gone-Co ")
    assert out["complete"] is True


async def test_a_platform_owner_account_inside_the_company_blocks_the_deletion(world):
    db, _ = world()
    db.data["users"][0]["is_platform_admin"] = True
    with pytest.raises(svc.PlatformError) as refused:
        await svc.delete_company(OWNER, X, "gone-co")
    assert refused.value.status == 409 and "platform owner" in refused.value.message
    assert db.events == []


async def test_audit_first_then_vectors_then_rows_then_the_directory_entry(world):
    db, index = world()
    out = await svc.delete_company(OWNER, X, "gone-co")
    assert out["complete"] is True

    kinds = [e[0] for e in db.events]
    assert kinds[0] == "audit" and db.events[0][1] == "company_delete" and db.events[0][2] == X
    first_sweep = kinds.index("delete_many")
    assert all(k == "vectors" for k in kinds[1:first_sweep]) and kinds[1:first_sweep]
    last_sweep = len(kinds) - 1 - kinds[::-1].index("delete_many")
    assert kinds[last_sweep + 1:] == ["delete_one", "audit"]
    assert db.events[-1][1] == "company_delete_complete"
    assert db.events[last_sweep + 1][1:] == ("companies", {"company_id": X})
    assert all(c["company_id"] != X for c in db.data["companies"])


async def test_vectors_are_deleted_in_batches_of_a_thousand_before_their_rows_and_only_this_companys(world):
    db, index = world(resumes=2500)
    await svc.delete_company(OWNER, X, "gone-co")

    resume_batches = [(len(ids), ns) for ids, ns in index.calls if ns is None]
    assert resume_batches == [(1000, None), (1000, None), (500, None)]
    job_batches = [(ids, ns) for ids, ns in index.calls if ns == "jobs"]
    assert job_batches == [(["job-x-1", "job-x-2", "job-x-3"], "jobs")]
    sent = [i for ids, ns in index.calls if ns is None for i in ids]
    assert len(sent) == len(set(sent)) == 2500 and all(i.startswith("res-x-") for i in sent)
    assert {e[3] for e in _events(db, "vectors")} == {2500}


async def test_every_sweep_uses_the_company_id_and_nothing_else_and_skips_shared_data(world):
    db, _ = world(resumes=5)
    await svc.delete_company(OWNER, X, "gone-co")

    swept = {name for _, name, flt in _events(db, "delete_many")}
    assert all(flt == {"company_id": X} for _, _, flt in _events(db, "delete_many"))
    assert swept == {"users", "jobs", "resumes", "cost_ledger", "audit_log", "email_log"}
    for name in ("rate_limits", "password_tokens", "otp_logs", "sso_states", "settings", "system.profile"):
        assert len(db.rows(name, X)) == 1, name


async def test_another_companys_rows_are_never_touched_and_the_totals_are_per_collection(world):
    db, _ = world(resumes=5)
    out = await svc.delete_company(OWNER, X, "gone-co")
    assert out == {"complete": True, "deleted": {"audit_log": 1, "cost_ledger": 4, "jobs": 3, "resumes": 5, "users": 2}}
    assert len(db.rows("users", Y)) == len(db.rows("jobs", Y)) == len(db.rows("resumes", Y)) == len(db.rows("cost_ledger", Y)) == 1
    assert db.rows("audit_log", "cmp_platform") == [{"_id": 2, "company_id": "cmp_platform"}]


async def test_without_pinecone_the_rows_still_go(world):
    db, index = world(resumes=5, pinecone=False)
    assert index is None
    assert (await svc.delete_company(OWNER, X, "gone-co"))["complete"] is True
    assert not db.rows("resumes", X) and not _events(db, "vectors")


async def test_a_vector_store_failure_stops_everything_before_any_row_is_removed(world):
    db, _ = world(fail=True)
    with pytest.raises(svc.PlatformError) as refused:
        await svc.delete_company(OWNER, X, "gone-co")
    assert refused.value.status == 502
    assert not _events(db, "delete_many") and len(db.rows("resumes", X)) == 2500
    assert any(c["company_id"] == X for c in db.data["companies"])


async def test_with_no_time_left_every_call_still_makes_progress_and_the_calls_add_up(world):
    db, index = world(resumes=2500, budget=0)
    answers = []
    for _ in range(40):
        answers.append(await svc.delete_company(OWNER, X, "gone-co"))
        if answers[-1]["complete"]:
            break
    assert answers[-1]["complete"] is True and len(answers) >= 5

    unfinished = answers[:-1]
    assert all(a["complete"] is False and a["remaining"] > 0 for a in unfinished)
    left = [a["remaining"] for a in unfinished]
    assert left == sorted(left, reverse=True) and len(set(left)) > 1
    for before, after in zip(answers, answers[1:]):
        assert all(after["deleted"].get(k, 0) >= v for k, v in before["deleted"].items())
    assert answers[-1]["deleted"] == {"audit_log": 1, "cost_ledger": 4, "jobs": 3, "resumes": 2500, "users": 2}

    assert [a for a in _events(db, "audit") if a[1] == "company_delete"] == [("audit", "company_delete", X, {})]
    assert len(_events(db, "audit")) == 2
    sent = [i for ids, ns in index.calls if ns is None for i in ids]
    assert len(sent) == len(set(sent)) == 2500


async def test_the_company_is_still_listed_until_the_last_call(world):
    db, _ = world(resumes=2, budget=0)
    first = await svc.delete_company(OWNER, X, "gone-co")
    assert first["complete"] is False
    assert any(c["company_id"] == X for c in db.data["companies"])
    assert db.data["companies"][0]["offboarding"]["started_by"] == OWNER["email"]


async def test_a_repeated_call_after_completion_is_a_plain_404(world):
    db, _ = world(resumes=2)
    assert (await svc.delete_company(OWNER, X, "gone-co"))["complete"] is True
    with pytest.raises(svc.PlatformError) as gone:
        await svc.delete_company(OWNER, X, "gone-co")
    assert gone.value.status == 404


async def test_a_client_is_deleted_only_when_it_has_no_companies_and_the_slug_matches(world):
    db, _ = world()
    with pytest.raises(svc.PlatformError) as busy:
        await svc.delete_client(OWNER, "cli_x", "client-x")
    assert busy.value.status == 409 and "companies" in busy.value.message
    assert not db.events

    db.data["companies"] = []
    for wrong in ("nope", "", None):
        with pytest.raises(svc.PlatformError) as mismatch:
            await svc.delete_client(OWNER, "cli_x", wrong)
        assert mismatch.value.status == 422
    assert not db.events

    out = await svc.delete_client(OWNER, "cli_x", "client-x")
    assert out == {"complete": True, "deleted": {"clients": 1}}
    assert [e[0] for e in db.events] == ["audit", "delete_one"] and db.events[0][1] == "client_delete"
    assert db.data["clients"] == []

    with pytest.raises(svc.PlatformError) as gone:
        await svc.delete_client(OWNER, "cli_x", "client-x")
    assert gone.value.status == 404
