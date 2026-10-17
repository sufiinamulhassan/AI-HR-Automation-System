import re
from types import SimpleNamespace

import config.database as database
from bson import ObjectId
from pymongo.errors import DuplicateKeyError

OPS_COLLECTIONS = ("notification_settings", "notification_log", "webhook_deliveries", "cron_runs")


def _matches(doc: dict, query: dict | None) -> bool:
    for key, cond in (query or {}).items():
        if key == "$or":
            if not any(_matches(doc, sub) for sub in cond):
                return False
        elif key == "$and":
            if not all(_matches(doc, sub) for sub in cond):
                return False
        elif not _field_matches(doc, key, cond):
            return False
    return True


def _field_matches(doc: dict, key: str, cond) -> bool:
    present = key in doc
    value = doc.get(key)
    if not isinstance(cond, dict) or not any(k.startswith("$") for k in cond):
        return value == cond if present else cond is None
    for op, arg in cond.items():
        if op == "$exists":
            if present != bool(arg):
                return False
        elif op == "$in":
            if value not in arg:
                return False
        elif op == "$ne":
            if value == arg:
                return False
        elif op == "$regex":
            if not isinstance(value, str) or not re.search(arg, value):
                return False
        elif op in ("$lt", "$lte", "$gt", "$gte"):
            if value is None:
                return False
            ok = {"$lt": value < arg, "$lte": value <= arg, "$gt": value > arg, "$gte": value >= arg}[op]
            if not ok:
                return False
        else:
            raise NotImplementedError(f"operator {op} is not supported by the test stand-in")
    return True


def _project(doc: dict, projection: dict | None) -> dict:
    out = dict(doc)
    if not projection:
        return out
    excluded = {k for k, v in projection.items() if not v}
    included = {k for k, v in projection.items() if v}
    if included:
        out = {k: v for k, v in out.items() if k in included or (k == "_id" and "_id" not in excluded)}
    for key in excluded:
        out.pop(key, None)
    return out


class FakeCursor:
    def __init__(self, docs: list[dict], projection):
        self._docs = docs
        self._projection = projection

    def sort(self, key, direction=1):
        self._docs.sort(key=lambda d: (d.get(key) is None, d.get(key)), reverse=direction == -1)
        return self

    def limit(self, n):
        if n:
            self._docs = self._docs[:n]
        return self

    async def to_list(self, length=None):
        docs = self._docs if length is None else self._docs[:length]
        return [_project(d, self._projection) for d in docs]

    def __aiter__(self):
        async def gen():
            for doc in list(self._docs):
                yield _project(doc, self._projection)
        return gen()


class FakeCollection:
    def __init__(self):
        self.docs: list[dict] = []

    async def find_one(self, query=None, projection=None, sort=None):
        found = [d for d in self.docs if _matches(d, query)]
        if sort:
            for key, direction in reversed(sort):
                found.sort(key=lambda d: (d.get(key) is None, d.get(key)), reverse=direction == -1)
        return _project(found[0], projection) if found else None

    def find(self, query=None, projection=None):
        return FakeCursor([d for d in self.docs if _matches(d, query)], projection)

    async def count_documents(self, query=None):
        return sum(1 for d in self.docs if _matches(d, query))

    async def insert_one(self, doc):
        stored = dict(doc)
        stored.setdefault("_id", ObjectId())
        if any(d["_id"] == stored["_id"] for d in self.docs):
            raise DuplicateKeyError("E11000 duplicate key error")
        self.docs.append(stored)
        return SimpleNamespace(inserted_id=stored["_id"])

    async def insert_many(self, docs):
        for doc in docs:
            await self.insert_one(doc)

    async def update_one(self, query, update, upsert=False):
        for doc in self.docs:
            if _matches(doc, query):
                self._apply(doc, update)
                return SimpleNamespace(matched_count=1, modified_count=1, upserted_id=None)
        if upsert:
            fresh = {k: v for k, v in (query or {}).items() if not k.startswith("$") and not isinstance(v, dict)}
            self._apply(fresh, update)
            await self.insert_one(fresh)
            return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=fresh["_id"])
        return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=None)

    async def replace_one(self, query, replacement, upsert=False):
        for index, doc in enumerate(self.docs):
            if _matches(doc, query):
                self.docs[index] = {"_id": doc["_id"], **{k: v for k, v in replacement.items() if k != "_id"}}
                return SimpleNamespace(matched_count=1, modified_count=1)
        if upsert:
            await self.insert_one(dict(replacement))
        return SimpleNamespace(matched_count=0, modified_count=0)

    async def delete_one(self, query):
        for index, doc in enumerate(self.docs):
            if _matches(doc, query):
                del self.docs[index]
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    async def delete_many(self, query=None):
        keep = [d for d in self.docs if not _matches(d, query)]
        removed = len(self.docs) - len(keep)
        self.docs = keep
        return SimpleNamespace(deleted_count=removed)

    async def create_index(self, *args, **kwargs):
        return None

    @staticmethod
    def _apply(doc: dict, update: dict) -> None:
        for key, value in (update.get("$set") or {}).items():
            doc[key] = value
        for key, value in (update.get("$inc") or {}).items():
            doc[key] = doc.get(key, 0) + value
        for key in (update.get("$unset") or {}):
            doc.pop(key, None)


class OpsDb:

    def __init__(self, real):
        self._real = real
        self._fakes = {name: FakeCollection() for name in OPS_COLLECTIONS}

    def __getattr__(self, name):
        if name in self._fakes:
            return self._fakes[name]
        return getattr(self._real, name)

    def __getitem__(self, name):
        return self._fakes[name] if name in self._fakes else self._real[name]


def install(monkeypatch) -> OpsDb:
    ops = OpsDb(database.get_platform_db())
    monkeypatch.setattr(database, "_db", ops)
    return ops
