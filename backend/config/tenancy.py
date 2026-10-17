from __future__ import annotations

import contextlib
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, Iterator, Mapping

DEFAULT_CLIENT_ID = "cli_default"
DEFAULT_COMPANY_ID = "cmp_default"
PLATFORM_CLIENT_ID = "cli_platform"
PLATFORM_COMPANY_ID = "cmp_platform"

NO_MATCH = "cmp_none"

PLATFORM_ONLY: frozenset[str] = frozenset({"clients", "companies", "settings"})

SHARED_INFRA: frozenset[str] = frozenset({"rate_limits", "sso_states", "otp_logs", "password_tokens"})

NAMESPACED_ID: frozenset[str] = frozenset({
    "company_settings", "branding_settings", "security_policies", "notification_settings",
    "notification_log", "user_guides",
})

_FORBIDDEN_STAGES = frozenset({
    "$lookup", "$unionWith", "$graphLookup", "$merge", "$out", "$function", "$accumulator", "$where",
})


def _assert_no_forbidden(obj) -> None:
    if isinstance(obj, Mapping):
        for key, value in obj.items():
            if key in _FORBIDDEN_STAGES:
                raise TenantViolation(f"{key} is not allowed on a tenant-bound collection")
            _assert_no_forbidden(value)
    elif isinstance(obj, (list, tuple)):
        for item in obj:
            _assert_no_forbidden(item)


def _is_company_id_path(name) -> bool:
    return isinstance(name, str) and (name == "company_id" or name.startswith("company_id."))


class TenantContextMissing(Exception):
    pass


class TenantViolation(Exception):
    pass


@dataclass
class TenantContext:
    company_id: str | None = None
    company: dict = field(default_factory=dict)


_current: ContextVar[TenantContext | None] = ContextVar("tenant_context", default=None)

_fallback_company_id: str | None = None


def use_fallback_company(company_id: str | None) -> None:
    global _fallback_company_id
    _fallback_company_id = company_id


def begin_scope():
    return _current.set(TenantContext())


def end_scope(token) -> None:
    _current.reset(token)


def bind_company(company_id: str | None, company: dict | None = None) -> None:
    ctx = _current.get()
    if ctx is None:
        ctx = TenantContext()
        _current.set(ctx)
    current = ctx.company_id
    if current and company_id and current != company_id and current != NO_MATCH:
        if company_id == NO_MATCH:
            return
        raise TenantViolation("a request may not be bound to two different companies")
    ctx.company_id = company_id
    ctx.company = company or {}


@contextlib.contextmanager
def company_context(company_id: str, company: dict | None = None) -> Iterator[TenantContext]:
    ctx = TenantContext(company_id=company_id, company=company or {})
    token = _current.set(ctx)
    try:
        yield ctx
    finally:
        _current.reset(token)


def current_company_id() -> str | None:
    ctx = _current.get()
    if ctx is not None and ctx.company_id:
        return ctx.company_id
    return _fallback_company_id


def current_company() -> dict:
    ctx = _current.get()
    return ctx.company if ctx is not None else {}


def company_setting(key: str, default: Any = None) -> Any:
    value = (current_company().get("settings") or {}).get(key)
    return default if value in (None, "") else value


def namespaced_id(company_id: str, value: Any) -> Any:
    if isinstance(value, str) and not value.startswith(f"{company_id}:"):
        return f"{company_id}:{value}"
    return value


class TenantScopeMiddleware:

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        token = begin_scope()
        try:
            await self.app(scope, receive, send)
        finally:
            end_scope(token)


class TenantCollection:

    def __init__(self, raw, company_id: str, name: str):
        self._raw = raw
        self._cid = company_id
        self._name = name
        self._ns = name in NAMESPACED_ID

    @property
    def name(self) -> str:
        return self._name


    def _write_cid(self) -> str:
        if not self._cid or self._cid == NO_MATCH:
            raise TenantContextMissing(f"write to {self._name} with no company bound")
        return self._cid

    def _ns_value(self, value):
        if isinstance(value, Mapping):
            out = dict(value)
            for op in ("$in", "$nin"):
                if op in out and isinstance(out[op], (list, tuple, set)):
                    out[op] = [namespaced_id(self._cid, v) for v in out[op]]
            for op in ("$eq", "$ne"):
                if op in out:
                    out[op] = namespaced_id(self._cid, out[op])
            return out
        return namespaced_id(self._cid, value)

    def _scope(self, flt) -> dict:
        if flt is None:
            flt = {}
        elif not isinstance(flt, Mapping):
            flt = {"_id": flt}
        _assert_no_forbidden(flt)
        out = dict(flt)
        if self._ns and "_id" in out:
            out["_id"] = self._ns_value(out["_id"])
        out["company_id"] = self._cid
        return out

    def _scope_write(self, flt) -> dict:
        self._write_cid()
        return self._scope(flt)

    def _check_update(self, update):
        if isinstance(update, Mapping):
            cleaned = {}
            for op, body in update.items():
                if op in ("$set", "$setOnInsert") and isinstance(body, Mapping) and "company_id" in body:
                    if body["company_id"] != self._cid:
                        raise TenantViolation("an update may not move a document to another company")
                    body = {k: v for k, v in body.items() if k != "company_id"}
                cleaned[op] = body
            update = cleaned
            stages = [update]
        elif isinstance(update, (list, tuple)):
            stages = [stage for stage in update if isinstance(stage, Mapping)]
        else:
            stages = []
        for stage in stages:
            for op, body in stage.items():
                if not isinstance(body, Mapping):
                    continue
                if any(_is_company_id_path(path) for path in body):
                    raise TenantViolation("an update may not touch company_id")
                if op == "$rename" and any(_is_company_id_path(target) for target in body.values()):
                    raise TenantViolation("an update may not touch company_id")
        _assert_no_forbidden(update)
        return update

    def _stamp(self, doc):
        cid = self._write_cid()
        if self._ns and isinstance(doc.get("_id"), str):
            doc = {**doc, "_id": namespaced_id(cid, doc["_id"])}
        doc["company_id"] = cid
        return doc


    def find(self, filter=None, *args, **kwargs):
        return self._raw.find(self._scope(filter), *args, **kwargs)

    async def find_one(self, filter=None, *args, **kwargs):
        return await self._raw.find_one(self._scope(filter), *args, **kwargs)

    async def count_documents(self, filter=None, *args, **kwargs):
        return await self._raw.count_documents(self._scope(filter), *args, **kwargs)

    async def estimated_document_count(self, *args, **kwargs):
        return await self._raw.count_documents(self._scope({}))

    async def distinct(self, key, filter=None, *args, **kwargs):
        return await self._raw.distinct(key, self._scope(filter), *args, **kwargs)

    def aggregate(self, pipeline, *args, **kwargs):
        stages = list(pipeline)
        _assert_no_forbidden(stages)
        return self._raw.aggregate([{"$match": {"company_id": self._cid}}, *stages], *args, **kwargs)


    async def insert_one(self, document, *args, **kwargs):
        return await self._raw.insert_one(self._stamp(document), *args, **kwargs)

    async def insert_many(self, documents, *args, **kwargs):
        return await self._raw.insert_many([self._stamp(d) for d in documents], *args, **kwargs)

    async def update_one(self, filter, update, *args, **kwargs):
        update = self._check_update(update)
        return await self._raw.update_one(self._scope_write(filter), update, *args, **kwargs)

    async def update_many(self, filter, update, *args, **kwargs):
        update = self._check_update(update)
        return await self._raw.update_many(self._scope_write(filter), update, *args, **kwargs)

    async def replace_one(self, filter, replacement, *args, **kwargs):
        return await self._raw.replace_one(
            self._scope_write(filter), self._stamp(dict(replacement)), *args, **kwargs,
        )

    async def delete_one(self, filter, *args, **kwargs):
        return await self._raw.delete_one(self._scope_write(filter), *args, **kwargs)

    async def delete_many(self, filter=None, *args, **kwargs):
        return await self._raw.delete_many(self._scope_write(filter), *args, **kwargs)

    async def find_one_and_update(self, filter, update, *args, **kwargs):
        update = self._check_update(update)
        return await self._raw.find_one_and_update(self._scope_write(filter), update, *args, **kwargs)

    async def find_one_and_replace(self, filter, replacement, *args, **kwargs):
        return await self._raw.find_one_and_replace(
            self._scope_write(filter), self._stamp(dict(replacement)), *args, **kwargs,
        )

    async def find_one_and_delete(self, filter, *args, **kwargs):
        return await self._raw.find_one_and_delete(self._scope_write(filter), *args, **kwargs)

    def __getattr__(self, name):
        raise AttributeError(
            f"{name!r} is not available on a tenant-bound collection ({self._name}); "
            "index and bulk operations belong to config.database setup code"
        )


class TenantDB:

    def __init__(self, raw, company_id: str):
        self._raw = raw
        self._cid = company_id

    @property
    def company_id(self) -> str:
        return self._cid

    def __getitem__(self, name: str):
        if name in SHARED_INFRA:
            return self._raw[name]
        if name in PLATFORM_ONLY:
            raise TenantViolation(f"{name} is platform data: use get_platform_db() from platform code")
        return TenantCollection(self._raw[name], self._cid, name)

    def __getattr__(self, name: str):
        if name.startswith("_"):
            raise AttributeError(name)
        return self[name]

    async def command(self, command, *args, **kwargs):
        name = command if isinstance(command, str) else next(iter(command), None) if isinstance(command, Mapping) else None
        if name != "ping":
            raise TenantViolation("only the ping command is available on a tenant-bound handle")
        return await self._raw.command(command, *args, **kwargs)


def bind_db(raw):
    cid = current_company_id()
    if not cid:
        raise TenantContextMissing(
            "get_db() was called with no company bound: authenticate the request, resolve the "
            "public token, or wrap the work in company_context()"
        )
    return TenantDB(raw, cid)


def db_for_company(raw, company_id: str) -> TenantDB:
    return TenantDB(raw, company_id)
