from __future__ import annotations

import copy
import json
import re
from types import SimpleNamespace

_MISSING = object()


def _resolve(node, parts):
    if not parts:
        yield node
        return
    head, rest = parts[0], parts[1:]
    if isinstance(node, dict):
        if head in node:
            yield from _resolve(node[head], rest)
    elif isinstance(node, list):
        if head.isdigit() and int(head) < len(node):
            yield from _resolve(node[int(head)], rest)
        for item in node:
            if isinstance(item, dict):
                yield from _resolve(item, parts)


def _values(doc, path):
    found = list(_resolve(doc, path.split(".")))
    expanded = []
    for value in found:
        expanded.append(value)
        if isinstance(value, list):
            expanded.extend(value)
    return found, expanded


def _field_matches(doc, path, cond) -> bool:
    found, values = _values(doc, path)
    present = bool(found)
    is_ops = isinstance(cond, dict) and cond and all(str(k).startswith("$") for k in cond)
    if not is_ops:
        if cond is None:
            return not present or any(v is None for v in values)
        return any(v == cond for v in values)
    flags = re.IGNORECASE if "i" in str(cond.get("$options", "")) else 0
    for op, arg in cond.items():
        if op == "$options":
            continue
        if op == "$exists":
            if present != bool(arg):
                return False
        elif op == "$eq":
            if not any(v == arg for v in values) and not (arg is None and not present):
                return False
        elif op == "$ne":
            if any(v == arg for v in values) or (arg is None and not present):
                return False
        elif op == "$in":
            hit = any(v in arg for v in values if not isinstance(v, (dict, list))) or (None in arg and not present)
            if not hit:
                return False
        elif op == "$nin":
            if any(v in arg for v in values if not isinstance(v, (dict, list))) or (None in arg and not present):
                return False
        elif op == "$regex":
            if not any(isinstance(v, str) and re.search(arg, v, flags) for v in values):
                return False
        elif op == "$elemMatch":
            if not any(_element_matches(item, arg) for node in found if isinstance(node, list) for item in node):
                return False
        elif op in ("$lt", "$lte", "$gt", "$gte"):
            def ok(v):
                try:
                    return {"$lt": v < arg, "$lte": v <= arg, "$gt": v > arg, "$gte": v >= arg}[op]
                except TypeError:
                    return False
            if not any(v is not None and ok(v) for v in values):
                return False
        else:
            raise NotImplementedError(f"filter operator {op} is not supported by the test stand-in")
    return True


def matches(doc, flt) -> bool:
    for key, cond in (flt or {}).items():
        if key == "$or":
            if not any(matches(doc, sub) for sub in cond):
                return False
        elif key == "$and":
            if not all(matches(doc, sub) for sub in cond):
                return False
        elif not _field_matches(doc, key, cond):
            return False
    return True


def _element_matches(item, cond) -> bool:
    if isinstance(item, dict):
        return matches(item, cond)
    return _field_matches({"v": item}, "v", cond)


def _set_path(doc, path, value) -> None:
    parts = path.split(".")
    node = doc
    for part in parts[:-1]:
        if not isinstance(node.get(part), dict):
            node[part] = {}
        node = node[part]
    node[parts[-1]] = value


def _unset_path(doc, path) -> None:
    parts = path.split(".")
    node = doc
    for part in parts[:-1]:
        node = node.get(part) if isinstance(node, dict) else None
        if node is None:
            return
    if isinstance(node, dict):
        node.pop(parts[-1], None)


def _pull(doc, path, cond) -> None:
    holders = list(_resolve_parent(doc, path.split(".")))
    for node, key in holders:
        items = node.get(key)
        if not isinstance(items, list):
            continue
        keep = []
        for item in items:
            if isinstance(item, dict) and isinstance(cond, dict):
                drop = matches(item, cond)
            elif isinstance(cond, dict) and "$in" in cond:
                drop = item in cond["$in"]
            else:
                drop = item == cond
            if not drop:
                keep.append(item)
        node[key] = keep


def _resolve_parent(node, parts):
    if len(parts) == 1:
        if isinstance(node, dict) and parts[0] in node:
            yield node, parts[0]
        return
    child = node.get(parts[0]) if isinstance(node, dict) else None
    if isinstance(child, dict):
        yield from _resolve_parent(child, parts[1:])


def _set_positional(doc, path, value, flt) -> None:
    array_path, rest = path.split(".$.", 1)
    items = next(iter(_resolve(doc, array_path.split("."))), None) or []
    for key, cond in (flt or {}).items():
        if key.startswith(array_path + "."):
            sub = key[len(array_path) + 1:]
            for item in items:
                if isinstance(item, dict) and _field_matches(item, sub, cond):
                    _set_path(item, rest, copy.deepcopy(value))
                    return


def apply_update(doc, update, flt=None) -> None:
    for path, value in (update.get("$set") or {}).items():
        if ".$." in path:
            _set_positional(doc, path, value, flt)
        else:
            _set_path(doc, path, copy.deepcopy(value))
    for path in update.get("$unset") or {}:
        _unset_path(doc, path)
    for path, by in (update.get("$inc") or {}).items():
        _set_path(doc, path, (next(iter(_resolve(doc, path.split("."))), 0) or 0) + by)
    for path, cond in (update.get("$pull") or {}).items():
        _pull(doc, path, cond)
    for path, item in (update.get("$push") or {}).items():
        current = next(iter(_resolve(doc, path.split("."))), None)
        items = item["$each"] if isinstance(item, dict) and "$each" in item else [item]
        _set_path(doc, path, [*(current or []), *copy.deepcopy(items)])
    unknown = set(update) - {"$set", "$unset", "$inc", "$pull", "$push", "$setOnInsert"}
    if unknown:
        raise NotImplementedError(f"update operator {sorted(unknown)} is not supported by the test stand-in")


def _project(doc, projection):
    if not projection:
        return copy.deepcopy(doc)
    include = [k for k, v in projection.items() if v and k != "_id"]
    exclude = [k for k, v in projection.items() if not v]
    if include:
        out: dict = {}
        for path in include:
            found = list(_resolve(doc, path.split(".")))
            if found:
                _set_path(out, path, copy.deepcopy(found[0]))
        if "_id" not in exclude and "_id" in doc:
            out["_id"] = doc["_id"]
        return out
    out = copy.deepcopy(doc)
    for path in exclude:
        _unset_path(out, path)
    return out


_ABSENT = object()


def _value(doc, path):
    found = list(_resolve(doc, path.split(".")))
    return found[0] if found else _ABSENT


def _present(value):
    return None if value is _ABSENT else value


def _evaluate(doc, expr):
    if isinstance(expr, str) and expr.startswith("$"):
        return _value(doc, expr[1:])
    if isinstance(expr, list):
        return [_evaluate(doc, item) for item in expr]
    if isinstance(expr, dict):
        if len(expr) == 1 and next(iter(expr)).startswith("$"):
            op, arg = next(iter(expr.items()))
            return _operator(doc, op, arg)
        out = {}
        for key, sub in expr.items():
            value = _evaluate(doc, sub)
            if value is not _ABSENT:
                out[key] = value
        return out
    return expr


def _operator(doc, op, arg):
    if op == "$ifNull":
        value = _present(_evaluate(doc, arg[0]))
        return _evaluate(doc, arg[1]) if value is None else value
    if op == "$cond":
        test, then, other = arg
        return _evaluate(doc, then if _present(_evaluate(doc, test)) else other)
    if op == "$add":
        return sum(_present(_evaluate(doc, part)) or 0 for part in arg)
    if op == "$regexMatch":
        text = _present(_evaluate(doc, arg["input"]))
        flags = re.IGNORECASE if "i" in str(arg.get("options", "")) else 0
        return isinstance(text, str) and re.search(arg["regex"], text, flags) is not None
    if op == "$convert":
        if arg.get("to") != "string":
            raise NotImplementedError("the test stand-in converts to string only")
        value = _present(_evaluate(doc, arg["input"]))
        if value is None:
            return arg.get("onNull")
        if isinstance(value, str):
            return value
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return str(value)
        return arg.get("onError")
    raise NotImplementedError(f"expression operator {op} is not supported by the test stand-in")


def _order_key(value):
    if value is None:
        return (0, 0)
    if isinstance(value, bool):
        return (3, value)
    if isinstance(value, (int, float)):
        return (1, value)
    if isinstance(value, str):
        return (2, value)
    return (4, json.dumps(value, sort_keys=True, default=str))


def _stage_match(rows, spec):
    return [row for row in rows if matches(row, spec)]


def _stage_unwind(rows, spec):
    path = spec["path"] if isinstance(spec, dict) else spec
    out = []
    for row in rows:
        value = _value(row, path[1:])
        if isinstance(value, list):
            for item in value:
                clone = copy.deepcopy(row)
                _set_path(clone, path[1:], item)
                out.append(clone)
        elif value is not _ABSENT and value is not None:
            out.append(row)
    return out


def _stage_group(rows, spec):
    accumulators = {name: acc for name, acc in spec.items() if name != "_id"}
    groups: dict[str, dict] = {}
    for row in rows:
        key = _present(_evaluate(row, spec["_id"]))
        token = json.dumps(key, sort_keys=True, default=str)
        if token not in groups:
            groups[token] = {"_id": copy.deepcopy(key), **{name: 0 for name in accumulators}}
        for name, acc in accumulators.items():
            (op, arg), = acc.items()
            if op != "$sum":
                raise NotImplementedError(f"group accumulator {op} is not supported by the test stand-in")
            amount = _evaluate(row, arg)
            if isinstance(amount, (int, float)) and not isinstance(amount, bool):
                groups[token][name] += amount
    return list(groups.values())


def _stage_sort(rows, spec):
    out = list(rows)
    for field, way in reversed(list(spec.items())):
        out.sort(key=lambda row: _order_key(_present(_value(row, field))), reverse=way < 0)
    return out


def _stage_add_fields(rows, spec):
    out = []
    for row in rows:
        clone = copy.deepcopy(row)
        for path, expr in spec.items():
            value = _evaluate(row, expr)
            if value is not _ABSENT:
                _set_path(clone, path, value)
        out.append(clone)
    return out


def _stage_project(rows, spec):
    if any(spec.values()):
        raise NotImplementedError("the test stand-in supports exclusion projections only")
    out = []
    for row in rows:
        clone = copy.deepcopy(row)
        for path in spec:
            _unset_path(clone, path)
        out.append(clone)
    return out


_STAGES = {
    "$match": _stage_match,
    "$unwind": _stage_unwind,
    "$group": _stage_group,
    "$sort": _stage_sort,
    "$addFields": _stage_add_fields,
    "$skip": lambda rows, spec: rows[spec:],
    "$limit": lambda rows, spec: rows[:spec],
    "$project": _stage_project,
}


def run_pipeline(docs, pipeline):
    rows = list(docs)
    for stage in pipeline:
        (name, spec), = stage.items()
        if name not in _STAGES:
            raise NotImplementedError(f"pipeline stage {name} is not supported by the test stand-in")
        rows = _STAGES[name](rows, spec)
    return rows


class FakeAggregateCursor:
    def __init__(self, rows):
        self._rows = rows

    async def to_list(self, length=None):
        rows = self._rows if length is None else self._rows[:length]
        return copy.deepcopy(rows)

    def __aiter__(self):
        async def gen():
            for row in copy.deepcopy(self._rows):
                yield row
        return gen()


class FakeCursor:
    def __init__(self, docs, projection):
        self._docs = docs
        self._projection = projection

    def sort(self, key, direction=1):
        pairs = key if isinstance(key, list) else [(key, direction)]
        for field, way in reversed(pairs):
            self._docs.sort(
                key=lambda d: (next(iter(_resolve(d, field.split("."))), None) is None,
                               next(iter(_resolve(d, field.split("."))), None)),
                reverse=way < 0,
            )
        return self

    def limit(self, n):
        if n:
            self._docs = self._docs[:n]
        return self

    def skip(self, n):
        self._docs = self._docs[n:]
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
    def __init__(self, raw, name):
        self._raw = raw
        self.name = name
        self.docs: list[dict] = []

    def _count_write(self):
        self._raw.writes += 1

    def find(self, flt=None, projection=None, *args, **kwargs):
        return FakeCursor([d for d in self.docs if matches(d, flt)], projection)

    async def find_one(self, flt=None, projection=None, sort=None, **kwargs):
        cursor = self.find(flt, projection)
        if sort:
            cursor.sort(sort)
        rows = await cursor.to_list(1)
        return rows[0] if rows else None

    def aggregate(self, pipeline, *args, **kwargs):
        return FakeAggregateCursor(run_pipeline(self.docs, pipeline))

    async def count_documents(self, flt=None, *args, **kwargs):
        return sum(1 for d in self.docs if matches(d, flt))

    async def distinct(self, key, flt=None, *args, **kwargs):
        out: list = []
        for doc in self.docs:
            if not matches(doc, flt):
                continue
            for value in _resolve(doc, key.split(".")):
                for item in (value if isinstance(value, list) else [value]):
                    if item not in out:
                        out.append(item)
        return out

    async def insert_one(self, doc):
        self._count_write()
        stored = copy.deepcopy(doc)
        stored.setdefault("_id", f"oid{len(self.docs)}_{id(stored)}")
        self.docs.append(stored)
        return SimpleNamespace(inserted_id=stored["_id"])

    async def insert_many(self, docs):
        for doc in docs:
            await self.insert_one(doc)

    async def _update(self, flt, update, many, upsert=False):
        self._count_write()
        matched = modified = 0
        for doc in self.docs:
            if not matches(doc, flt):
                continue
            before = copy.deepcopy(doc)
            apply_update(doc, update, flt)
            matched += 1
            modified += doc != before
            if not many:
                break
        if not matched and upsert:
            fresh = {k: v for k, v in (flt or {}).items() if not k.startswith("$") and not isinstance(v, dict)}
            apply_update(fresh, {**update, "$set": {**(update.get("$set") or {}), **(update.get("$setOnInsert") or {})}})
            inserted = await self.insert_one(fresh)
            return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=inserted.inserted_id)
        return SimpleNamespace(matched_count=matched, modified_count=modified, upserted_id=None)

    async def update_one(self, flt, update, upsert=False, **kwargs):
        return await self._update(flt, update, False, upsert)

    async def update_many(self, flt, update, upsert=False, **kwargs):
        return await self._update(flt, update, True, upsert)

    async def delete_one(self, flt, **kwargs):
        self._count_write()
        for index, doc in enumerate(self.docs):
            if matches(doc, flt):
                del self.docs[index]
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    async def delete_many(self, flt=None, **kwargs):
        self._count_write()
        keep = [d for d in self.docs if not matches(d, flt)]
        removed = len(self.docs) - len(keep)
        self.docs[:] = keep
        return SimpleNamespace(deleted_count=removed)


class FakeRaw:

    def __init__(self):
        self._collections: dict[str, FakeCollection] = {}
        self.writes = 0

    def __getitem__(self, name):
        if name not in self._collections:
            self._collections[name] = FakeCollection(self, name)
        return self._collections[name]

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return self[name]

    def add(self, name, doc, company_id="cmp_a"):
        stored = copy.deepcopy(doc)
        stored.setdefault("company_id", company_id)
        stored.setdefault("_id", f"seed_{name}_{len(self[name].docs)}")
        self[name].docs.append(stored)
        return stored

    def rows(self, name, company_id="cmp_a", **match):
        return [d for d in self[name].docs if d.get("company_id") == company_id and matches(d, match)]

    def dump(self, company_id="cmp_a", *, skip=()) -> str:
        import json

        return json.dumps(
            {
                name: [d for d in col.docs if d.get("company_id") == company_id]
                for name, col in self._collections.items() if name not in skip
            },
            default=str, sort_keys=True,
        )

    def snapshot(self, company_id):
        rows = {
            name: [d for d in col.docs if d.get("company_id") == company_id]
            for name, col in self._collections.items()
        }
        return copy.deepcopy({name: docs for name, docs in rows.items() if docs})
