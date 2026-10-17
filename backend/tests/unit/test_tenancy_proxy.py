import pytest

from config import tenancy
from config.tenancy import (
    NO_MATCH,
    TenantCollection,
    TenantContextMissing,
    TenantDB,
    TenantScopeMiddleware,
    TenantViolation,
    bind_company,
    bind_db,
    company_context,
    current_company_id,
    namespaced_id,
)

pytestmark = pytest.mark.anyio

CID = "cmp_a"


class FakeCollection:
    def __init__(self, name, calls):
        self.name = name
        self.calls = calls

    def _record(self, method, *args, **kwargs):
        self.calls.append((self.name, method, args, kwargs))

    def find(self, *args, **kwargs):
        self._record("find", *args, **kwargs)
        return "cursor"

    def aggregate(self, *args, **kwargs):
        self._record("aggregate", *args, **kwargs)
        return "cursor"

    def __getattr__(self, method):
        async def call(*args, **kwargs):
            self._record(method, *args, **kwargs)
            return "result"
        return call


class FakeRaw:
    def __init__(self):
        self.calls = []

    def __getitem__(self, name):
        return FakeCollection(name, self.calls)

    __getattr__ = __getitem__

    async def command(self, *args, **kwargs):
        self.calls.append(("<db>", "command", args, kwargs))
        return {"ok": 1}


@pytest.fixture
def raw():
    return FakeRaw()


@pytest.fixture
def db(raw):
    return TenantDB(raw, CID)


@pytest.fixture(autouse=True)
def no_fallback():
    previous = tenancy._fallback_company_id
    tenancy.use_fallback_company(None)
    yield
    tenancy.use_fallback_company(previous)


def last(raw):
    return raw.calls[-1]


async def test_find_adds_the_company(db, raw):
    db.jobs.find({"status": "open"}, {"_id": 0})
    name, method, args, _ = last(raw)
    assert (name, method) == ("jobs", "find")
    assert args[0] == {"status": "open", "company_id": CID}
    assert args[1] == {"_id": 0}


async def test_a_caller_cannot_ask_for_another_company(db, raw):
    await db.jobs.find_one({"job_id": "j1", "company_id": "cmp_other"})
    assert last(raw)[2][0] == {"job_id": "j1", "company_id": CID}


async def test_no_filter_still_scoped(db, raw):
    db.jobs.find()
    assert last(raw)[2][0] == {"company_id": CID}
    await db.jobs.count_documents({})
    assert last(raw)[2][0] == {"company_id": CID}
    await db.jobs.count_documents(None)
    assert last(raw)[2][0] == {"company_id": CID}


async def test_or_filter_cannot_widen_the_scope(db, raw):
    await db.jobs.find_one({"$or": [{"a": 1}, {"company_id": "cmp_other"}]})
    sent = last(raw)[2][0]
    assert sent["company_id"] == CID and "$or" in sent


async def test_a_bare_id_is_a_filter_on_id(db, raw):
    await db.jobs.find_one("abc")
    assert last(raw)[2][0] == {"_id": "abc", "company_id": CID}


async def test_distinct_is_scoped(db, raw):
    await db.candidates.distinct("resume_id", {"x": 1})
    assert last(raw)[2] == ("resume_id", {"x": 1, "company_id": CID})


async def test_aggregate_starts_with_the_company_match(db, raw):
    db.jobs.aggregate([{"$group": {"_id": "$status", "n": {"$sum": 1}}}])
    pipeline = last(raw)[2][0]
    assert pipeline[0] == {"$match": {"company_id": CID}}
    assert pipeline[1] == {"$group": {"_id": "$status", "n": {"$sum": 1}}}


@pytest.mark.parametrize("stage", ["$lookup", "$unionWith", "$graphLookup", "$merge", "$out"])
async def test_aggregate_refuses_stages_that_read_other_collections(db, stage):
    with pytest.raises(TenantViolation):
        db.jobs.aggregate([{stage: {"from": "users"}}])


async def test_insert_stamps_the_company_in_place(db, raw):
    doc = {"job_id": "j1"}
    await db.jobs.insert_one(doc)
    assert doc["company_id"] == CID
    assert last(raw)[2][0] is doc


async def test_insert_overrides_a_forged_company(db, raw):
    await db.jobs.insert_one({"job_id": "j1", "company_id": "cmp_other"})
    assert last(raw)[2][0]["company_id"] == CID


async def test_insert_many_stamps_every_document(db, raw):
    docs = [{"a": 1}, {"a": 2}, {"a": 3, "company_id": "cmp_other"}]
    await db.jobs.insert_many(docs)
    assert {d["company_id"] for d in last(raw)[2][0]} == {CID}


async def test_update_filter_is_scoped(db, raw):
    await db.jobs.update_one({"job_id": "j1"}, {"$set": {"title": "x"}}, upsert=True)
    name, method, args, kwargs = last(raw)
    assert args[0] == {"job_id": "j1", "company_id": CID}
    assert kwargs == {"upsert": True}
    await db.jobs.update_many({}, {"$set": {"title": "x"}})
    assert last(raw)[2][0] == {"company_id": CID}


async def test_an_update_may_not_touch_the_company(db):
    with pytest.raises(TenantViolation):
        await db.jobs.update_one({"job_id": "j1"}, {"$set": {"company_id": "cmp_other"}})
    with pytest.raises(TenantViolation):
        await db.jobs.update_many({}, [{"$set": {"company_id": "cmp_other"}}])
    with pytest.raises(TenantViolation):
        await db.jobs.find_one_and_update({}, {"$unset": {"company_id": ""}})


async def test_a_document_read_back_and_saved_may_carry_its_own_company(db, raw):
    await db.user_guides.update_one(
        {"_id": "admin"}, {"$set": {"label": "x", "company_id": CID}, "$inc": {"version": 1}}, upsert=True,
    )
    update = last(raw)[2][1]
    assert update == {"$set": {"label": "x"}, "$inc": {"version": 1}}
    await db.jobs.update_one({"job_id": "j1"}, {"$setOnInsert": {"company_id": CID, "a": 1}})
    assert last(raw)[2][1] == {"$setOnInsert": {"a": 1}}


async def test_isolation_errors_are_never_a_runtime_error():
    assert not issubclass(TenantViolation, RuntimeError)
    assert not issubclass(TenantContextMissing, RuntimeError)


async def test_text_that_mentions_company_id_is_just_data(db, raw):
    await db.candidates.update_one(
        {"candidate_id": "c1"},
        {"$set": {"transcript": [{"answer": "I would add company_id to the query"}], "notes": "SELECT company_id"},
         "$push": {"events": {"company_id": "cmp_other", "text": "company_id"}}},
    )
    assert "company_id" in str(last(raw)[2][1])
    await db.coding_session_state.update_one({"candidate_id": "c1"}, {"$set": {"details.company_id": "x"}})
    assert last(raw)[2][1] == {"$set": {"details.company_id": "x"}}


async def test_the_field_itself_is_still_protected_in_every_shape(db):
    for update in (
        {"$set": {"company_id": "cmp_other"}},
        {"$setOnInsert": {"company_id": "cmp_other"}},
        {"$unset": {"company_id": ""}},
        {"$rename": {"company_id": "old"}},
        {"$rename": {"old": "company_id"}},
        {"$set": {"company_id.x": 1}},
        [{"$set": {"company_id": "cmp_other"}}],
        [{"$unset": "company_id"}, {"$set": {"company_id": "x"}}],
    ):
        with pytest.raises(TenantViolation):
            await db.jobs.update_one({"job_id": "j1"}, update)


@pytest.mark.parametrize("stage", ["$lookup", "$unionWith", "$graphLookup", "$merge", "$out", "$function", "$accumulator"])
async def test_aggregate_refuses_these_stages_at_any_depth(db, stage):
    with pytest.raises(TenantViolation):
        db.jobs.aggregate([{"$facet": {"a": [{"$match": {}}, {stage: {"from": "users"}}]}}])
    with pytest.raises(TenantViolation):
        db.jobs.aggregate([{"$group": {"_id": "$x", "n": {stage: {}}}}])


async def test_a_filter_cannot_run_code(db):
    with pytest.raises(TenantViolation):
        db.jobs.find({"$where": "this.company_id != 1"})
    with pytest.raises(TenantViolation):
        await db.jobs.find_one({"$and": [{"a": 1}, {"$where": "true"}]})


async def test_only_ping_gets_through_the_command_door(db, raw):
    await db.command("ping")
    await db.command({"ping": 1})
    for command in ("dropDatabase", {"listCollections": 1}, {"aggregate": "users"}):
        with pytest.raises(TenantViolation):
            await db.command(command)


async def test_a_request_cannot_be_bound_to_two_companies():
    from config.tenancy import TenantScopeMiddleware

    seen = {}

    async def app(scope, receive, send):
        bind_company("cmp_a")
        bind_company("cmp_a")
        bind_company(NO_MATCH)
        seen["after_no_match"] = current_company_id()
        with pytest.raises(TenantViolation):
            bind_company("cmp_b")

    await TenantScopeMiddleware(app)({"type": "http"}, None, None)
    assert seen["after_no_match"] == "cmp_a"

    async def reverse(scope, receive, send):
        bind_company(NO_MATCH)
        bind_company("cmp_a")
        seen["now"] = current_company_id()

    await TenantScopeMiddleware(reverse)({"type": "http"}, None, None)
    assert seen["now"] == "cmp_a"


async def test_delete_is_scoped(db, raw):
    await db.jobs.delete_many({})
    assert last(raw)[2][0] == {"company_id": CID}
    await db.jobs.delete_one({"job_id": "j1"})
    assert last(raw)[2][0] == {"job_id": "j1", "company_id": CID}


async def test_replace_and_find_and_modify_are_scoped(db, raw):
    await db.jobs.replace_one({"job_id": "j1"}, {"job_id": "j1", "title": "t"})
    _, _, args, _ = last(raw)
    assert args[0]["company_id"] == CID and args[1]["company_id"] == CID
    await db.jobs.find_one_and_delete({"job_id": "j1"})
    assert last(raw)[2][0] == {"job_id": "j1", "company_id": CID}


async def test_unlisted_operations_are_refused(db):
    for name in ("bulk_write", "create_index", "drop", "watch", "list_indexes"):
        with pytest.raises(AttributeError):
            getattr(db.jobs, name)


async def test_no_match_reads_nothing_and_refuses_writes(raw):
    db = TenantDB(raw, NO_MATCH)
    await db.candidates.find_one({"secure_token": "x"})
    assert last(raw)[2][0]["company_id"] == NO_MATCH
    for write in (
        lambda: db.candidates.insert_one({"a": 1}),
        lambda: db.candidates.update_one({"a": 1}, {"$set": {"b": 2}}),
        lambda: db.candidates.delete_many({}),
    ):
        with pytest.raises(TenantContextMissing):
            await write()


async def test_get_db_with_nothing_bound_fails_closed(raw):
    with pytest.raises(TenantContextMissing):
        bind_db(raw)


async def test_company_context_binds_and_restores(raw):
    assert current_company_id() is None
    with company_context("cmp_x") as ctx:
        assert current_company_id() == "cmp_x"
        assert bind_db(raw).company_id == "cmp_x"
        with company_context("cmp_y"):
            assert current_company_id() == "cmp_y"
        assert current_company_id() == "cmp_x"
        assert ctx.company_id == "cmp_x"
    assert current_company_id() is None


async def test_platform_collections_are_unreachable(db):
    for name in ("clients", "companies", "settings"):
        with pytest.raises(TenantViolation):
            getattr(db, name)
        with pytest.raises(TenantViolation):
            db[name]


async def test_shared_infrastructure_is_not_scoped(db, raw):
    collection = db.rate_limits
    assert not isinstance(collection, TenantCollection)
    await collection.find_one({"_id": "login:email:a@b.c:1"})
    assert last(raw)[2][0] == {"_id": "login:email:a@b.c:1"}


def test_namespaced_id_is_prefixed_once():
    once = namespaced_id(CID, "singleton")
    assert once == f"{CID}:singleton"
    assert namespaced_id(CID, once) == once
    assert namespaced_id(CID, 5) == 5


async def test_fixed_ids_cannot_collide_across_companies(raw):
    a, b = TenantDB(raw, "cmp_a"), TenantDB(raw, "cmp_b")
    await a.branding_settings.find_one({"_id": "singleton"})
    first = last(raw)[2][0]
    await b.branding_settings.find_one({"_id": "singleton"})
    second = last(raw)[2][0]
    assert first["_id"] == "cmp_a:singleton" and second["_id"] == "cmp_b:singleton"
    assert first["company_id"] == "cmp_a" and second["company_id"] == "cmp_b"


async def test_namespaced_insert_and_in_queries(db, raw):
    original = {"_id": "singleton", "x": 1}
    await db.security_policies.insert_one(original)
    sent = last(raw)[2][0]
    assert sent["_id"] == f"{CID}:singleton" and sent["company_id"] == CID
    assert original["_id"] == "singleton"
    await db.user_guides.find_one({"_id": {"$in": ["admin", "standard"]}})
    assert last(raw)[2][0]["_id"] == {"$in": [f"{CID}:admin", f"{CID}:standard"]}


async def test_ordinary_collections_keep_their_ids(db, raw):
    await db.jobs.find_one({"_id": "abc"})
    assert last(raw)[2][0]["_id"] == "abc"


async def test_a_binding_does_not_outlive_its_request():
    seen = {}

    async def app(scope, receive, send):
        bind_company("cmp_request", {"name": "Req"})
        seen["inside"] = current_company_id()

    await TenantScopeMiddleware(app)({"type": "http"}, None, None)
    assert seen["inside"] == "cmp_request"
    assert current_company_id() is None


async def test_concurrent_requests_do_not_share_a_binding():
    import asyncio

    seen = {}

    def make(name):
        async def app(scope, receive, send):
            bind_company(name)
            await asyncio.sleep(0.01)
            seen[name] = current_company_id()
        return TenantScopeMiddleware(app)

    await asyncio.gather(
        make("cmp_1")({"type": "http"}, None, None),
        make("cmp_2")({"type": "http"}, None, None),
    )
    assert seen == {"cmp_1": "cmp_1", "cmp_2": "cmp_2"}
