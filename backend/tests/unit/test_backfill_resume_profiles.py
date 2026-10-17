import asyncio
import copy
import importlib.util
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

import config.database as database
from config import llm, tenancy
from config.settings import settings
from config.tenancy import DEFAULT_COMPANY_ID, PLATFORM_COMPANY_ID
from fake_mongo import FakeRaw

pytestmark = pytest.mark.anyio

BACKEND = Path(__file__).resolve().parents[2]
A = "cmp_bf_a"
B = "cmp_bf_b"
ALLOWED = {
    "headline", "location", "experience",
    "department", "profile_version",
}


def load_script():
    path = BACKEND / "scripts" / "backfill_resume_profiles.py"
    spec = importlib.util.spec_from_file_location("backfill_resume_profiles_under_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


script = load_script()


def model_result(text, **over):
    result = {
        "job_domain": "marketing",
        "seniority_level": "junior",
        "skills": ["Excel"],
        "confidence": 0.4,
        "years_experience": 1,
        "education_level": "bachelor",
        "industry": "other",
        "headline": f"Data Engineer {text[:1]}",
        "location": "Lahore",
        "notice_period": "30 days",
        "experience": [{"title": "Data Engineer", "company": "Acme"}],
    }
    result.update(over)
    return result


class FakeClassifier:
    def __init__(self):
        self.calls = []
        self.companies = []
        self.failing = set()
        self.overrides = {}
        self.active = 0
        self.peak = 0
        self.delay = 0.0

    async def __call__(self, text, model=None):
        self.calls.append(text)
        self.companies.append(tenancy.current_company_id())
        self.active += 1
        self.peak = max(self.peak, self.active)
        try:
            if self.delay:
                await asyncio.sleep(self.delay)
            if text in self.failing:
                raise RuntimeError("the model is down")
            return model_result(text, **self.overrides.get(text, {}))
        finally:
            self.active -= 1


def seed(raw, resume_id, company, text, **over):
    doc = {
        "resume_id": resume_id,
        "processing_status": "processed",
        "text": text,
        "candidate_name": f"Name {resume_id}",
        "classification": {
            "job_domain": "data_engineering", "seniority_level": "senior", "skills": ["Spark"],
            "confidence": 0.9, "years_experience": 8, "education_level": "master", "industry": "fintech",
        },
        "embedding": [0.1, 0.2, 0.3],
        "embedding_model": "text-embedding-3-small",
    }
    doc.update(over)
    return raw.add("resumes", doc, company)


@pytest.fixture
def world(monkeypatch):
    raw = FakeRaw()
    raw.add("companies", {"company_id": PLATFORM_COMPANY_ID, "name": "Platform", "kind": "platform", "settings": {}}, PLATFORM_COMPANY_ID)
    raw.add("companies", {"company_id": A, "name": "Acme", "status": "active", "settings": {}}, A)
    raw.add("companies", {"company_id": B, "name": "Beta", "status": "active", "settings": {}}, B)
    seed(raw, "a1", A, "a" * 400)
    seed(raw, "a2", A, "b" * 4000)
    seed(raw, "a3", A, "c" * 20000)
    seed(raw, "a_done", A, "d" * 100, profile_version=1, headline="Kept Headline", department="Kept Department")
    seed(raw, "a_failed", A, "e" * 100, processing_status="failed")
    seed(raw, "a_blank", A, "")
    seed(raw, "a_notext", A, "unused")
    del raw["resumes"].docs[-1]["text"]
    seed(raw, "b1", B, "f" * 300)
    seed(raw, "b2", B, "g" * 300)
    monkeypatch.setattr(database, "_db", raw)
    monkeypatch.setattr(settings, "RESUME_CLASSIFICATION_MODEL", "claude-haiku-5-5")
    classifier = FakeClassifier()
    monkeypatch.setattr(script, "classify_resume", classifier)

    async def find_company(company_id):
        row = await raw.companies.find_one({"company_id": company_id}, {"_id": 0})
        if row is not None:
            row.setdefault("settings", {})
        return row

    monkeypatch.setattr(script, "load_company", find_company)
    tenancy.use_fallback_company(None)
    yield SimpleNamespace(raw=raw, classifier=classifier)
    tenancy.use_fallback_company(DEFAULT_COMPANY_ID)
    llm.reset_usage_tracking()


def args(company, *extra):
    return script.parse_args(["--company", company, *extra])


def resume(world, resume_id, company=A):
    (doc,) = world.raw.rows("resumes", company_id=company, resume_id=resume_id)
    return doc


def snapshot(world, company):
    return copy.deepcopy({d["resume_id"]: d for d in world.raw.rows("resumes", company_id=company)})


def changed_keys(before, after):
    keys = set()
    for resume_id, doc in after.items():
        for key in set(doc) | set(before[resume_id]):
            if doc.get(key, "<absent>") != before[resume_id].get(key, "<absent>"):
                keys.add(key)
    return keys


def test_cost_estimate_uses_a_quarter_token_per_character_plus_the_prompt_overhead():
    estimate = script.estimate_cost([400, 4000, 20000], {"in": 1.0, "out": 2.0})
    assert estimate["resumes"] == 3
    assert estimate["prompt_tokens"] == (100 + 620) + (1000 + 620) + (1125 + 620)
    assert estimate["completion_tokens"] == 3 * 900
    assert estimate["cost_usd"] == pytest.approx(4085 / 1e6 * 1.0 + 2700 / 1e6 * 2.0)


def test_cost_estimate_of_nothing_is_zero():
    assert script.estimate_cost([], {"in": 5.0, "out": 25.0}) == {
        "resumes": 0, "prompt_tokens": 0, "completion_tokens": 0, "cost_usd": 0.0,
    }


def test_arguments_default_to_a_dry_run_and_require_a_company():
    parsed = script.parse_args(["--company", A])
    assert parsed.company == A and parsed.apply is False and parsed.limit is None
    assert script.parse_args(["--company", A, "--apply", "--limit", "5"]).apply is True
    with pytest.raises(SystemExit):
        script.parse_args([])
    with pytest.raises(SystemExit):
        script.parse_args(["--company", A, "--limit", "0"])
    with pytest.raises(SystemExit):
        script.parse_args(["--company", A, "--limit", "many"])


async def test_a_dry_run_counts_only_processed_resumes_with_text_and_no_profile(world, capsys):
    assert await script.run(args(A)) == 0
    out = capsys.readouterr().out
    assert "resumes missing profile fields: 3" in out
    assert "resumes in this run: 3" in out
    assert "dry run: nothing changed" in out


async def test_a_dry_run_prints_the_estimated_tokens_and_cost(world, capsys):
    await script.run(args(A))
    out = capsys.readouterr().out
    assert "model: claude-haiku-5-5" in out
    assert "estimated tokens: 4085 prompt, up to 2700 completion" in out
    assert "estimated cost: up to $0.0018" in out


async def test_a_dry_run_prices_with_the_model_the_company_has_chosen_for_resumes(world, capsys):
    company = world.raw["companies"].docs[1]
    assert company["company_id"] == A
    company["settings"] = {"task_models": {"resume": "claude-opus-5"}}
    await script.run(args(A))
    out = capsys.readouterr().out
    assert "model: claude-opus-5" in out
    expected = 4085 / 1e6 * 5.0 + 2700 / 1e6 * 25.0
    assert f"estimated cost: up to ${expected:.4f}" in out


async def test_a_dry_run_makes_no_model_call_and_no_write(world):
    writes = world.raw.writes
    before = {c: snapshot(world, c) for c in (A, B)}
    assert await script.run(args(A)) == 0
    assert world.classifier.calls == []
    assert world.raw.writes == writes
    assert {c: snapshot(world, c) for c in (A, B)} == before
    assert world.raw.rows("cost_ledger", company_id=A) == []


async def test_a_dry_run_leaves_no_usage_tracking_behind(world):
    await script.run(args(A))
    assert llm._usage_ctx.get() is None


async def test_a_dry_run_limit_narrows_the_estimate_but_not_the_missing_count(world, capsys):
    await script.run(args(A, "--limit", "2"))
    out = capsys.readouterr().out
    assert "resumes missing profile fields: 3" in out
    assert "resumes in this run: 2 (limit 2)" in out
    assert world.classifier.calls == []


async def test_a_dry_run_with_nothing_missing_reports_zero(world, capsys):
    world.raw["resumes"].docs[:] = [d for d in world.raw["resumes"].docs if d["company_id"] != A]
    assert await script.run(args(A)) == 0
    out = capsys.readouterr().out
    assert "resumes missing profile fields: 0" in out and "estimated cost: up to $0.0000" in out


async def test_apply_updates_the_profile_fields_of_every_missing_resume(world):
    assert await script.run(args(A, "--apply")) == 0
    for resume_id, letter in [("a1", "a"), ("a2", "b"), ("a3", "c")]:
        doc = resume(world, resume_id)
        assert doc["headline"] == f"Data Engineer {letter}"
        assert doc["location"] == "Lahore"
        assert doc["experience"] == [{"title": "Data Engineer", "company": "Acme"}]
        assert doc["department"] == "Data Engineer"
        assert doc["profile_version"] == 1


async def test_apply_does_not_write_or_touch_certifications(world):
    seed(world.raw, "a_certs", A, "k" * 120, certifications=["Existing Cert"])
    world.classifier.overrides["k" * 120] = {"certifications": ["Model Cert"]}
    world.classifier.overrides["a" * 400] = {"certifications": ["Model Cert"]}
    await script.run(args(A, "--apply"))
    assert resume(world, "a_certs")["certifications"] == ["Existing Cert"]
    assert resume(world, "a_certs")["profile_version"] == 1
    assert "certifications" not in resume(world, "a1")


async def test_a_resume_with_only_ignored_fields_counts_as_empty(world, capsys):
    world.classifier.overrides["a" * 400] = {
        "headline": None, "location": None, "notice_period": "30 days", "experience": [], "certifications": ["Cert"],
    }
    await script.run(args(A, "--apply"))
    assert "no profile data found: 1" in capsys.readouterr().out
    assert "profile_version" not in resume(world, "a1")


async def test_apply_changes_only_the_allowed_fields(world):
    before = snapshot(world, A)
    await script.run(args(A, "--apply"))
    after = snapshot(world, A)
    assert changed_keys(before, after) == ALLOWED
    for resume_id in ("a1", "a2", "a3"):
        for key in ("classification", "embedding", "embedding_model", "text", "candidate_name", "processing_status", "resume_id"):
            assert after[resume_id][key] == before[resume_id][key]


async def test_apply_never_rewrites_the_stored_classification_even_if_the_model_now_disagrees(world):
    await script.run(args(A, "--apply"))
    assert resume(world, "a1")["classification"]["job_domain"] == "data_engineering"
    assert resume(world, "a1")["classification"]["skills"] == ["Spark"]


async def test_apply_calls_the_model_with_each_stored_text_once(world):
    await script.run(args(A, "--apply"))
    assert sorted(world.classifier.calls) == sorted(["a" * 400, "b" * 4000, "c" * 20000])


async def test_apply_leaves_resumes_that_are_done_failed_blank_or_without_text_alone(world):
    before = snapshot(world, A)
    await script.run(args(A, "--apply"))
    after = snapshot(world, A)
    for resume_id in ("a_done", "a_failed", "a_blank", "a_notext"):
        assert after[resume_id] == before[resume_id]
    assert after["a_done"]["headline"] == "Kept Headline"
    assert "profile_version" not in after["a_failed"]


async def test_apply_falls_back_to_the_stored_family_for_the_department(world):
    world.classifier.overrides["a" * 400] = {"headline": None, "experience": []}
    await script.run(args(A, "--apply"))
    doc = resume(world, "a1")
    assert doc["headline"] is None and doc["department"] == "Data Engineering"
    assert doc["profile_version"] == 1


async def test_apply_does_not_write_or_touch_notice_period_or_availability(world):
    seed(world.raw, "a_notice", A, "n" * 120, notice_period="45 days", availability_status="over_30_days")
    world.classifier.overrides["n" * 120] = {"notice_period": "Immediate"}
    await script.run(args(A, "--apply"))
    kept = resume(world, "a_notice")
    assert kept["notice_period"] == "45 days" and kept["availability_status"] == "over_30_days"
    assert kept["profile_version"] == 1
    fresh = resume(world, "a1")
    assert "notice_period" not in fresh and "availability_status" not in fresh


async def test_a_failed_resume_is_reported_and_skipped_and_the_others_still_finish(world, capsys):
    world.classifier.failing.add("b" * 4000)
    assert await script.run(args(A, "--apply")) == 1
    out = capsys.readouterr().out
    assert "failed a2: RuntimeError: the model is down" in out
    assert "updated: 2" in out and "failed: 1" in out
    assert resume(world, "a1")["profile_version"] == 1
    assert resume(world, "a3")["profile_version"] == 1
    assert "profile_version" not in resume(world, "a2") and "department" not in resume(world, "a2")


async def test_a_second_run_only_handles_what_is_still_missing(world):
    world.classifier.failing.add("b" * 4000)
    await script.run(args(A, "--apply"))
    assert len(world.classifier.calls) == 3

    world.classifier.calls.clear()
    world.classifier.failing.clear()
    assert await script.run(args(A, "--apply")) == 0
    assert world.classifier.calls == ["b" * 4000]
    assert resume(world, "a2")["profile_version"] == 1

    world.classifier.calls.clear()
    assert await script.run(args(A, "--apply")) == 0
    assert world.classifier.calls == []


async def test_a_resume_the_model_found_nothing_in_stays_pending(world, capsys):
    world.classifier.overrides["a" * 400] = {
        "headline": None, "location": None, "notice_period": "30 days", "experience": [],
    }
    assert await script.run(args(A, "--apply")) == 0
    out = capsys.readouterr().out
    assert "no profile data found: 1" in out and "still missing profile fields: 1" in out
    assert "profile_version" not in resume(world, "a1")
    assert resume(world, "a2")["profile_version"] == 1


async def test_a_resume_filled_in_while_the_model_was_thinking_is_not_overwritten(world, monkeypatch):
    async def racing(text, model=None):
        if text == "a" * 400:
            doc = next(d for d in world.raw["resumes"].docs if d["resume_id"] == "a1")
            doc.update({"profile_version": 1, "headline": "Written Elsewhere", "department": "Elsewhere"})
        return model_result(text)

    monkeypatch.setattr(script, "classify_resume", racing)
    await script.run(args(A, "--apply"))
    doc = resume(world, "a1")
    assert doc["headline"] == "Written Elsewhere" and doc["department"] == "Elsewhere"
    assert resume(world, "a2")["profile_version"] == 1


async def test_a_whitespace_only_text_is_skipped_without_a_model_call(world, capsys):
    seed(world.raw, "a_spaces", A, "   \n  ")
    await script.run(args(A, "--apply"))
    out = capsys.readouterr().out
    assert "without text: 1" in out
    assert "   \n  " not in world.classifier.calls
    assert "profile_version" not in resume(world, "a_spaces")


async def test_apply_limit_processes_at_most_that_many(world):
    await script.run(args(A, "--apply", "--limit", "2"))
    assert len(world.classifier.calls) == 2
    done = [d for d in world.raw.rows("resumes", company_id=A) if d.get("profile_version") == 1]
    assert len(done) == 3
    assert await script.run(args(A, "--apply", "--limit", "2")) == 0
    assert len(world.classifier.calls) == 3
    assert len([d for d in world.raw.rows("resumes", company_id=A) if d.get("profile_version") == 1]) == 4


async def test_apply_runs_at_most_three_resumes_at_a_time(world):
    for index in range(10):
        seed(world.raw, f"many{index}", A, f"many text {index}")
    world.classifier.delay = 0.01
    await script.run(args(A, "--apply"))
    assert world.classifier.peak == 3
    assert len(world.classifier.calls) == 13


async def test_apply_runs_every_call_inside_the_company_context(world):
    await script.run(args(A, "--apply"))
    assert set(world.classifier.companies) == {A}
    assert tenancy.current_company_id() is None


async def test_apply_never_touches_another_company(world):
    before_b = snapshot(world, B)
    await script.run(args(A, "--apply"))
    assert snapshot(world, B) == before_b
    assert all("profile_version" not in d for d in world.raw.rows("resumes", company_id=B))
    assert not any(text in world.classifier.calls for text in ("f" * 300, "g" * 300))


async def test_each_company_is_backfilled_only_by_its_own_run(world):
    await script.run(args(B, "--apply"))
    assert all(d.get("profile_version") == 1 for d in world.raw.rows("resumes", company_id=B))
    assert all("profile_version" not in d for d in world.raw.rows("resumes", company_id=A) if d["resume_id"] in ("a1", "a2", "a3"))
    assert set(world.classifier.companies) == {B}


async def test_a_resume_id_shared_by_two_companies_is_only_updated_for_the_chosen_one(world):
    seed(world.raw, "shared", A, "h" * 200)
    seed(world.raw, "shared", B, "i" * 200)
    await script.run(args(B, "--apply"))
    assert resume(world, "shared", B)["profile_version"] == 1
    assert "profile_version" not in resume(world, "shared", A)


async def test_the_platform_company_is_refused_for_dry_runs_and_applies(world, capsys):
    writes = world.raw.writes
    seed(world.raw, "p1", PLATFORM_COMPANY_ID, "p" * 100)
    for extra in ([], ["--apply"]):
        assert await script.run(args(PLATFORM_COMPANY_ID, *extra)) == 1
        assert "refusing to run for the platform company" in capsys.readouterr().out
    assert world.classifier.calls == []
    assert world.raw.writes == writes
    assert "profile_version" not in resume(world, "p1", PLATFORM_COMPANY_ID)


async def test_a_company_marked_as_platform_by_its_kind_is_refused(world, capsys):
    world.raw.add("companies", {"company_id": "cmp_ops", "name": "Ops", "kind": "platform", "settings": {}}, "cmp_ops")
    seed(world.raw, "o1", "cmp_ops", "o" * 100)
    assert await script.run(args("cmp_ops", "--apply")) == 1
    assert "refusing" in capsys.readouterr().out
    assert world.classifier.calls == []


async def test_an_unknown_company_is_refused_without_any_write(world, capsys):
    writes = world.raw.writes
    for extra in ([], ["--apply"]):
        assert await script.run(args("cmp_does_not_exist", *extra)) == 1
        assert "unknown company: cmp_does_not_exist" in capsys.readouterr().out
    assert world.classifier.calls == []
    assert world.raw.writes == writes


async def test_an_unreachable_database_is_reported(world, monkeypatch, capsys):
    monkeypatch.setattr(database, "_db", None)
    assert await script.run(args(A)) == 1
    assert "MongoDB is not reachable" in capsys.readouterr().out


async def test_apply_records_the_cost_under_its_own_source_for_the_chosen_company(world, monkeypatch):
    async def costly(text, model=None):
        llm._record_llm("claude-haiku-5-5", SimpleNamespace(prompt_tokens=2000, completion_tokens=500))
        return model_result(text)

    monkeypatch.setattr(script, "classify_resume", costly)
    await script.run(args(A, "--apply"))
    (entry,) = world.raw.rows("cost_ledger", company_id=A)
    assert entry["source"] == "resume_profile_backfill"
    assert entry["items"] == 3 and entry["llm_calls"] == 3
    assert entry["prompt_tokens"] == 6000 and entry["completion_tokens"] == 1500
    assert entry["cost_usd"] == pytest.approx(6000 / 1e6 * 0.10 + 1500 / 1e6 * 0.50)
    assert world.raw.rows("cost_ledger", company_id=B) == []
    assert llm._usage_ctx.get() is None


async def test_apply_with_no_model_usage_writes_no_ledger_row(world):
    await script.run(args(A, "--apply"))
    assert world.raw.rows("cost_ledger", company_id=A) == []
    assert llm._usage_ctx.get() is None


async def test_the_ledger_counts_only_the_resumes_that_were_updated(world, monkeypatch):
    async def costly(text, model=None):
        llm._record_llm("claude-haiku-5-5", SimpleNamespace(prompt_tokens=100, completion_tokens=10))
        if text == "b" * 4000:
            raise RuntimeError("the model is down")
        return model_result(text)

    monkeypatch.setattr(script, "classify_resume", costly)
    await script.run(args(A, "--apply"))
    (entry,) = world.raw.rows("cost_ledger", company_id=A)
    assert entry["items"] == 2


async def test_main_runs_a_dry_run_by_default_and_closes_the_database(world, monkeypatch, capsys):
    init = AsyncMock()
    close = AsyncMock()
    monkeypatch.setattr(script, "init_db", init)
    monkeypatch.setattr(script, "close_db", close)
    assert await script.main(["--company", A]) == 0
    init.assert_awaited_once()
    close.assert_awaited_once()
    assert world.classifier.calls == []
    assert "dry run: nothing changed" in capsys.readouterr().out


async def test_main_applies_only_when_asked(world, monkeypatch):
    monkeypatch.setattr(script, "init_db", AsyncMock())
    monkeypatch.setattr(script, "close_db", AsyncMock())
    assert await script.main(["--company", A, "--apply"]) == 0
    assert len(world.classifier.calls) == 3


def test_the_script_has_no_comments_docstrings_or_em_dashes():
    source = (BACKEND / "scripts" / "backfill_resume_profiles.py").read_text(encoding="utf-8")
    assert chr(0x2014) not in source
    assert chr(34) * 3 not in source
    assert not any(line.lstrip().startswith("#") for line in source.splitlines())
