from types import SimpleNamespace

import pytest

from routes import analytics

pytestmark = pytest.mark.anyio


def _value(expr, doc):
    if isinstance(expr, str) and expr.startswith("$"):
        return doc.get(expr[1:])
    if isinstance(expr, dict):
        (op, args), = expr.items()
        if op == "$ifNull":
            first = _value(args[0], doc)
            return _value(args[1], doc) if first is None else first
        if op == "$add":
            return sum(_value(a, doc) or 0 for a in args)
        raise NotImplementedError(op)
    return expr


def _matches(doc, match):
    for field, cond in match.items():
        got = doc.get(field)
        if isinstance(cond, dict):
            (op, arg), = cond.items()
            if op == "$nin" and got in arg:
                return False
            if op == "$in" and got not in arg:
                return False
        elif got != cond:
            return False
    return True


def _group(docs, spec):
    buckets: dict = {}
    for doc in docs:
        key = _value(spec["_id"], doc) if spec["_id"] is not None else None
        buckets.setdefault(key, []).append(doc)
    rows = []
    for key, members in buckets.items():
        row = {"_id": key}
        for name, acc in spec.items():
            if name == "_id":
                continue
            (op, expr), = acc.items()
            values = [_value(expr, m) for m in members]
            numbers = [v for v in values if isinstance(v, (int, float)) and not isinstance(v, bool)]
            if op == "$sum":
                row[name] = sum(numbers)
            elif op == "$min":
                row[name] = min((v for v in values if v is not None), default=None)
            else:
                raise NotImplementedError(op)
        rows.append(row)
    return rows


class _Result:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, length=None):
        return self.rows


class _Ledger:
    def __init__(self, docs):
        self.docs = docs

    def aggregate(self, pipeline):
        docs = self.docs
        for stage in pipeline:
            if "$match" in stage:
                docs = [d for d in docs if _matches(d, stage["$match"])]
            elif "$group" in stage:
                docs = _group(docs, stage["$group"])
        return _Result(docs)

    async def count_documents(self, flt):
        return len([d for d in self.docs if _matches(d, flt)])


class _Emails:
    async def count_documents(self, flt):
        return 0


def _db(*rows):
    return SimpleNamespace(cost_ledger=_Ledger(list(rows)), email_log=_Emails())


def _embedding_row(ref, tokens=400):
    cost = round(tokens / 1e6 * 0.02, 6)
    return {
        "source": "jd_parse", "ref_id": ref, "cost_usd": cost, "prompt_tokens": 0, "completion_tokens": 0,
        "embedding_tokens": tokens, "llm_calls": 0, "embedding_calls": 1,
    }


def _category(summary, key):
    return next(c for c in summary["categories"] if c["key"] == key)


async def test_embedding_only_rows_count_as_ai_calls_on_their_tile_and_in_the_header():
    summary = await analytics._cost_summary(_db(*(_embedding_row(f"job-{i}") for i in range(50))))
    tile = _category(summary, "job_descriptions")
    assert tile["calls"] == 50
    assert tile["cost_usd"] == pytest.approx(0.0004)
    assert summary["llm"]["total_calls"] == 50
    assert summary["llm"]["chat_calls"] == 0
    assert summary["llm"]["embedding_calls"] == 50
    assert summary["llm"]["embedding_tokens"] == 20000
    assert summary["total_cost_usd"] == pytest.approx(0.0004)


async def test_chat_and_embedding_calls_are_added_together_for_the_same_feature():
    resume = {
        "source": "resume_bulk", "ref_id": "batch-1", "cost_usd": 0.05, "prompt_tokens": 900, "completion_tokens": 300,
        "embedding_tokens": 200, "llm_calls": 2, "embedding_calls": 1, "items": 3,
    }
    summary = await analytics._cost_summary(_db(resume, _embedding_row("job-1")))
    assert _category(summary, "resume_parsing")["calls"] == 3
    assert _category(summary, "job_descriptions")["calls"] == 1
    assert summary["llm"]["total_calls"] == 4
    assert summary["llm"]["chat_calls"] == 2 and summary["llm"]["embedding_calls"] == 2


async def test_older_rows_without_embedding_or_chat_counts_still_work():
    old = {"source": "offer_letter_drafting", "ref_id": "o-1", "cost_usd": 0.01, "llm_calls": 1}
    bare = {"source": "interview_evaluation", "ref_id": "i-1", "cost_usd": 0.02}
    summary = await analytics._cost_summary(_db(old, bare))
    assert _category(summary, "offers")["calls"] == 1
    assert _category(summary, "reports")["calls"] == 0
    assert summary["llm"]["total_calls"] == 1 and summary["llm"]["embedding_calls"] == 0


async def test_voice_rows_are_not_counted_as_ai_calls():
    voice = {"source": "interview_tts", "cost_type": "tts", "cost_usd": 0.01, "characters": 100}
    summary = await analytics._cost_summary(_db(voice, _embedding_row("job-1")))
    assert summary["llm"]["total_calls"] == 1
    assert _category(summary, "voice")["calls"] == 1


async def test_with_no_usage_everything_is_zero():
    summary = await analytics._cost_summary(_db())
    assert summary["llm"]["total_calls"] == 0 and summary["llm"]["embedding_calls"] == 0
    assert all(c["calls"] == 0 for c in summary["categories"])
    assert analytics._empty_cost_summary()["llm"]["embedding_calls"] == 0
