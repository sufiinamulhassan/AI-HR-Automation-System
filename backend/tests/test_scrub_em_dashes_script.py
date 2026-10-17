import copy
import importlib.util
from pathlib import Path

import pytest

from shared.utils import EM_DASH, strip_em_dashes

pytestmark = pytest.mark.anyio

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "scrub_em_dashes.py"
_spec = importlib.util.spec_from_file_location("scrub_em_dashes", SCRIPT)
script = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(script)

DASHED = f"Strong delivery {EM_DASH} clear thinking"
CLEAN = strip_em_dashes(DASHED)


class _Cursor:
    def __init__(self, docs):
        self._docs = docs

    def __aiter__(self):
        async def gen():
            for doc in self._docs:
                yield copy.deepcopy(doc)
        return gen()


class _Collection:
    def __init__(self):
        self.docs: list[dict] = []

    @staticmethod
    def _match(doc, query):
        for key, cond in (query or {}).items():
            value = doc.get(key)
            if isinstance(cond, dict) and "$in" in cond:
                if value not in cond["$in"]:
                    return False
            elif value != cond:
                return False
        return True

    def find(self, query=None, projection=None):
        return _Cursor([d for d in self.docs if self._match(d, query)])

    async def find_one(self, query=None):
        return next((copy.deepcopy(d) for d in self.docs if self._match(d, query)), None)

    async def insert_many(self, docs):
        for doc in docs:
            self.docs.append({"_id": len(self.docs) + 1, **doc})

    async def update_one(self, query, update):
        for doc in self.docs:
            if self._match(doc, query):
                for path, value in update["$set"].items():
                    script.set_path(doc, path, value)
                return

    async def delete_one(self, query):
        for index, doc in enumerate(self.docs):
            if self._match(doc, query):
                del self.docs[index]
                return


class _Db:
    def __init__(self):
        self.cols: dict[str, _Collection] = {}

    def __getitem__(self, name):
        return self.cols.setdefault(name, _Collection())


def _db_with(**collections) -> _Db:
    db = _Db()
    for name, docs in collections.items():
        db[name].docs = [{"_id": i, **copy.deepcopy(d)} for i, d in enumerate(docs)]
    return db


def _candidate(**fields) -> dict:
    return {"candidate_id": f"c{len(fields)}", **fields}


async def test_find_changes_walks_dicts_and_lists_and_reports_dotted_paths():
    value = {"summary": DASHED, "strengths": ["fine", DASHED], "nested": {"a": [{"b": DASHED}]}, "score": 7, "none": None}
    found = script.find_changes(value, "report")
    assert [(path, original, scrubbed) for path, original, scrubbed in found] == [
        ("report.summary", DASHED, CLEAN),
        ("report.strengths.1", DASHED, CLEAN),
        ("report.nested.a.0.b", DASHED, CLEAN),
    ]


async def test_find_changes_ignores_clean_text_and_other_types():
    assert script.find_changes({"a": "no dash here", "b": 3, "c": [1, 2.5, None, True]}, "x") == []
    assert script.find_changes(None, "x") == [] and script.find_changes(12, "x") == []


async def test_find_changes_uses_the_runtime_scrubber():
    assert script.strip_em_dashes is strip_em_dashes
    found = script.find_changes("a, b", "t")
    assert found == [("t", "a, b", "a, b")]


async def test_get_and_set_path_round_trip_through_lists():
    doc = {"report": {"strengths": ["a", "b"], "summary": "s"}}
    assert script.get_path(doc, "report.strengths.1") == "b"
    script.set_path(doc, "report.strengths.1", "z")
    assert doc["report"]["strengths"] == ["a", "z"]
    assert script.get_path(doc, "report.missing.0") is None and script.get_path(doc, "report.strengths.9") is None


async def test_normalise_path_groups_list_positions():
    assert script.normalise_path("report.strengths.3") == "report.strengths.[]"
    assert script.normalise_path("interview_guide.questions.12.text") == "interview_guide.questions.[].text"


async def test_an_ai_report_is_scrubbed_with_its_breakdown_and_generated_questions():
    doc = _candidate(
        report={"summary": DASHED, "strengths": [DASHED], "technical_score": 80},
        score_breakdown={"technical": {"rationale": DASHED}},
        _questions=[DASHED, "plain"],
    )
    paths = [c.path for c in script.plan_document("candidates", doc)]
    assert paths == ["report.summary", "report.strengths.0", "score_breakdown.technical.rationale", "_questions.0"]


async def test_a_report_built_from_human_scorecards_is_left_alone():
    doc = _candidate(
        report={"source": "interviewer_scorecard", "summary": DASHED},
        score_breakdown={"technical": {"rationale": DASHED}},
        external_review={"summary": DASHED},
        interview_scorecards=[{"summary": DASHED}],
        recruiter_notes=DASHED,
        transcript=[{"answer": DASHED}],
    )
    assert script.plan_document("candidates", doc) == []


async def test_only_the_models_guide_questions_are_scrubbed():
    doc = _candidate(interview_guide={"questions": [
        {"id": "q1", "text": DASHED, "listen_for": DASHED, "source": "ai"},
        {"id": "q2", "text": DASHED, "listen_for": DASHED},
        {"id": "q3", "text": DASHED, "listen_for": DASHED, "source": "custom"},
    ]})
    paths = [c.path for c in script.plan_document("candidates", doc)]
    assert paths == [
        "interview_guide.questions.0.text", "interview_guide.questions.0.listen_for",
        "interview_guide.questions.1.text", "interview_guide.questions.1.listen_for",
    ]


async def test_an_offer_letter_is_scrubbed_only_when_the_model_wrote_it():
    ai = {"offer_id": "o1", "ai_letter_body": DASHED, "ai_letter_source": "ai", "benefits": DASHED}
    template = {"offer_id": "o2", "ai_letter_body": DASHED, "ai_letter_source": "template_fallback"}
    typed = {"offer_id": "o3", "ai_letter_body": DASHED}
    assert [c.path for c in script.plan_document("offers", ai)] == ["ai_letter_body"]
    assert script.plan_document("offers", template) == [] and script.plan_document("offers", typed) == []


async def test_coding_submissions_scrub_the_ai_review_and_not_the_code():
    doc = {
        "submission_id": "s1", "code": f"print('a {EM_DASH} b')",
        "quality": {"feedback_for_recruiter": DASHED, "feedback_for_candidate": DASHED, "overall_quality_score": 70},
        "ai_correctness": {"verdict": "correct", "explanation": DASHED},
        "complexity": {"note": DASHED},
    }
    assert [c.path for c in script.plan_document("coding_submissions", doc)] == [
        "quality.feedback_for_recruiter", "quality.feedback_for_candidate", "ai_correctness.explanation",
    ]


async def test_a_document_without_its_key_is_skipped():
    assert script.plan_document("candidates", {"report": {"summary": DASHED}}) == []


async def test_change_records_carry_everything_a_restore_needs():
    change = script.plan_document("offers", {"offer_id": "o9", "ai_letter_body": DASHED, "ai_letter_source": "ai"})[0]
    assert (change.collection, change.doc_key, change.path, change.original, change.scrubbed) == (
        "offers", "o9", "ai_letter_body", DASHED, CLEAN,
    )


async def test_the_summary_counts_strings_and_documents_per_field():
    changes = []
    for i in range(3):
        changes += script.plan_document("candidates", {"candidate_id": f"c{i}", "report": {"strengths": [DASHED, DASHED]}})
    changes += script.plan_document("offers", {"offer_id": "o", "ai_letter_body": DASHED, "ai_letter_source": "ai"})
    summary = script.summarise(changes)
    assert summary[("candidates", "report.strengths.[]")] == {"strings": 6, "documents": 3}
    assert summary[("offers", "ai_letter_body")] == {"strings": 1, "documents": 1}
    text = script.format_summary(summary)
    assert "candidates.report.strengths.[]" in text and "6 string(s) in     3 document(s)" in text
    assert script.format_summary({}) == "  nothing to change"


def _world() -> _Db:
    return _db_with(
        candidates=[
            {"candidate_id": "c1", "report": {"summary": DASHED, "strengths": ["ok", DASHED]}},
            {"candidate_id": "c2", "report": {"summary": "clean"}},
            {"candidate_id": "c3", "report": {"source": "interviewer_scorecard", "summary": DASHED}},
        ],
        offers=[{"offer_id": "o1", "ai_letter_body": DASHED, "ai_letter_source": "ai"}],
    )


async def test_scan_is_read_only():
    db = _world()
    before = {name: copy.deepcopy(col.docs) for name, col in db.cols.items()}
    changes = await script.scan(db, sorted(script.TARGETS))
    assert len(changes) == 3
    assert {name: db.cols[name].docs for name in before} == before
    assert script.BACKUP_COLLECTION not in db.cols or db[script.BACKUP_COLLECTION].docs == []


async def test_apply_backs_up_every_original_then_writes_the_clean_text():
    db = _world()
    written = await script.apply_changes(db, await script.scan(db, sorted(script.TARGETS)))
    assert written == 2

    c1 = await db["candidates"].find_one({"candidate_id": "c1"})
    assert c1["report"] == {"summary": CLEAN, "strengths": ["ok", CLEAN]}
    assert (await db["candidates"].find_one({"candidate_id": "c3"}))["report"]["summary"] == DASHED
    assert (await db["offers"].find_one({"offer_id": "o1"}))["ai_letter_body"] == CLEAN

    backups = db[script.BACKUP_COLLECTION].docs
    assert len(backups) == 3
    assert {(b["collection"], b["doc_key"], b["path"], b["original"]) for b in backups} == {
        ("candidates", "c1", "report.summary", DASHED), ("candidates", "c1", "report.strengths.1", DASHED),
        ("offers", "o1", "ai_letter_body", DASHED),
    }
    assert all(b["scrubbed_at"] and b["scrubbed"] == CLEAN for b in backups)


async def test_running_apply_twice_changes_and_backs_up_nothing_more():
    db = _world()
    await script.apply_changes(db, await script.scan(db, sorted(script.TARGETS)))
    again = await script.scan(db, sorted(script.TARGETS))
    assert again == []
    assert await script.apply_changes(db, again) == 0
    assert len(db[script.BACKUP_COLLECTION].docs) == 3


async def test_a_document_whose_backup_fails_is_left_unchanged():
    db = _world()

    async def broken(docs):
        raise RuntimeError("backup store is full")

    db[script.BACKUP_COLLECTION].insert_many = broken
    written = await script.apply_changes(db, await script.scan(db, sorted(script.TARGETS)))
    assert written == 0
    assert (await db["candidates"].find_one({"candidate_id": "c1"}))["report"]["summary"] == DASHED


async def test_restore_is_a_dry_run_unless_applied():
    db = _world()
    await script.apply_changes(db, await script.scan(db, sorted(script.TARGETS)))

    preview = await script.restore_changes(db, sorted(script.TARGETS), apply=False)
    assert preview == {"found": 3, "restored": 3, "skipped": 0}
    assert (await db["offers"].find_one({"offer_id": "o1"}))["ai_letter_body"] == CLEAN
    assert len(db[script.BACKUP_COLLECTION].docs) == 3


async def test_restore_puts_the_originals_back_and_clears_the_backup():
    db = _world()
    original = {name: copy.deepcopy(col.docs) for name, col in db.cols.items()}
    await script.apply_changes(db, await script.scan(db, sorted(script.TARGETS)))

    result = await script.restore_changes(db, sorted(script.TARGETS), apply=True)
    assert result == {"found": 3, "restored": 3, "skipped": 0}
    assert db[script.BACKUP_COLLECTION].docs == []
    assert {name: db.cols[name].docs for name in original} == original


async def test_restore_never_overwrites_text_edited_since():
    db = _world()
    await script.apply_changes(db, await script.scan(db, sorted(script.TARGETS)))
    edited = "A recruiter rewrote this sentence by hand."
    await db["offers"].update_one({"offer_id": "o1"}, {"$set": {"ai_letter_body": edited}})

    result = await script.restore_changes(db, sorted(script.TARGETS), apply=True)
    assert result == {"found": 3, "restored": 2, "skipped": 1}
    assert (await db["offers"].find_one({"offer_id": "o1"}))["ai_letter_body"] == edited
    assert len(db[script.BACKUP_COLLECTION].docs) == 1


async def test_restore_can_be_limited_to_one_collection():
    db = _world()
    await script.apply_changes(db, await script.scan(db, sorted(script.TARGETS)))
    result = await script.restore_changes(db, ["offers"], apply=True)
    assert result == {"found": 1, "restored": 1, "skipped": 0}
    assert (await db["offers"].find_one({"offer_id": "o1"}))["ai_letter_body"] == DASHED
    assert (await db["candidates"].find_one({"candidate_id": "c1"}))["report"]["summary"] == CLEAN


async def test_the_default_is_a_dry_run_over_every_collection():
    args = script.parse_args([])
    assert args.apply is False and args.restore is False and args.collection is None
    assert script.parse_args(["--apply"]).apply is True
    assert script.parse_args(["--restore"]).restore is True
    assert script.parse_args(["--collection", "offers", "--collection", "candidates"]).collection == ["offers", "candidates"]


async def test_an_unknown_collection_is_refused():
    with pytest.raises(SystemExit):
        script.parse_args(["--collection", "users"])


async def test_the_script_scope_is_the_documented_collections_only():
    assert sorted(script.TARGETS) == ["candidates", "coding_submissions", "offers"]
