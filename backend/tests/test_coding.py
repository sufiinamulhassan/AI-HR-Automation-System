"""Tests for the AI Coding Assessment feature (MVP2 §2.10).

Neither sandbox engine (Judge0, Piston) is configured or reachable in this test
environment, so these tests are structured around:
  - the "not configured" (503) path for the candidate submit flow,
  - the 400 (no question assigned) path for the candidate session flow,
  - pure functions (LANGUAGE_IDS mapping, score computation) tested directly,
  - evaluate_submission's scoring math with the sandbox call monkeypatched
    (never a real network call),
  - the Piston adapter's translation into Judge0's response shape, driven off
    canned Piston payloads.
No test calls out to a live Judge0 or Piston instance.
"""
import uuid

import pytest

import main as _main_module
from routes import coding as _coding_routes
from config.database import get_db
from config.settings import settings

if not any(getattr(route, "path", "").startswith("/api/v1/coding") for route in _main_module.app.routes):
    _main_module.app.include_router(
        _coding_routes.router, prefix="/api/v1/coding", tags=["hr_module · Coding Assessment"]
    )

pytestmark = pytest.mark.anyio


QUESTION_PAYLOAD = {
    "title": "Sum two numbers",
    "description": "Read two integers from stdin, print their sum.",
    "language_templates": {
        "python": "a, b = map(int, input().split())\nprint(a + b)\n",
        "javascript": "// read stdin, print sum\n",
    },
    "test_cases": [
        {"input": "2 3", "expected_output": "5", "is_hidden": False},
        {"input": "10 20", "expected_output": "30", "is_hidden": True},
    ],
    "job_domain": "software_engineering",
    "difficulty": "easy",
}


async def _create_question(client, headers):
    resp = await client.post("/api/v1/coding/questions", json=QUESTION_PAYLOAD, headers=headers)
    assert resp.status_code == 200
    return resp.json()["question_id"]


async def _create_candidate_doc(job_id: str | None = None) -> dict:
    db = get_db()
    token = f"tok_{uuid.uuid4().hex[:12]}"
    doc = {
        "doc_type": "candidate",
        "candidate_id": str(uuid.uuid4()),
        "job_id": job_id,
        "secure_token": token,
        "name": "Coding Test Candidate",
        "email": f"coding.test.{uuid.uuid4().hex[:6]}@example.com",
        "status": "invited",
    }
    await db.candidates.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def test_create_question_requires_admin(client, standard_headers):
    response = await client.post("/api/v1/coding/questions", json=QUESTION_PAYLOAD, headers=standard_headers)
    assert response.status_code == 403


async def test_update_question_requires_admin(client, standard_headers):
    response = await client.patch(
        "/api/v1/coding/questions/does-not-exist", json={"title": "x"}, headers=standard_headers
    )
    assert response.status_code == 403


async def test_delete_question_requires_admin(client, standard_headers):
    response = await client.delete("/api/v1/coding/questions/does-not-exist", headers=standard_headers)
    assert response.status_code == 403


async def test_assign_question_requires_admin(client, standard_headers):
    response = await client.patch(
        "/api/v1/coding/assign/some-candidate-id",
        json={"question_id": "some-question-id"},
        headers=standard_headers,
    )
    assert response.status_code == 403


async def test_question_crud_roundtrip(client, admin_headers, standard_headers):
    question_id = await _create_question(client, admin_headers)

    forbidden_get = await client.get(f"/api/v1/coding/questions/{question_id}", headers=standard_headers)
    assert forbidden_get.status_code == 403
    forbidden_list = await client.get("/api/v1/coding/questions", headers=standard_headers)
    assert forbidden_list.status_code == 403

    get_resp = await client.get(f"/api/v1/coding/questions/{question_id}", headers=admin_headers)
    assert get_resp.status_code == 200
    assert get_resp.json()["title"] == QUESTION_PAYLOAD["title"]
    assert len(get_resp.json()["test_cases"]) == 2

    list_resp = await client.get("/api/v1/coding/questions", headers=admin_headers)
    assert list_resp.status_code == 200
    assert any(q["question_id"] == question_id for q in list_resp.json()["questions"])

    patch_resp = await client.patch(
        f"/api/v1/coding/questions/{question_id}", json={"difficulty": "hard"}, headers=admin_headers
    )
    assert patch_resp.status_code == 200

    get_after_patch = await client.get(f"/api/v1/coding/questions/{question_id}", headers=admin_headers)
    assert get_after_patch.json()["difficulty"] == "hard"

    delete_resp = await client.delete(f"/api/v1/coding/questions/{question_id}", headers=admin_headers)
    assert delete_resp.status_code == 200

    get_after_delete = await client.get(f"/api/v1/coding/questions/{question_id}", headers=admin_headers)
    assert get_after_delete.status_code == 404


async def test_get_unknown_question_404(client, admin_headers):
    response = await client.get("/api/v1/coding/questions/does-not-exist", headers=admin_headers)
    assert response.status_code == 404


async def test_assign_question_not_found(client, admin_headers):
    response = await client.patch(
        "/api/v1/coding/assign/some-candidate-id",
        json={"question_id": "does-not-exist"},
        headers=admin_headers,
    )
    assert response.status_code == 404


async def test_assign_question_candidate_not_found(client, admin_headers):
    question_id = await _create_question(client, admin_headers)
    response = await client.patch(
        "/api/v1/coding/assign/does-not-exist-candidate",
        json={"question_id": question_id},
        headers=admin_headers,
    )
    assert response.status_code == 404
    await client.delete(f"/api/v1/coding/questions/{question_id}", headers=admin_headers)


async def test_session_invalid_token_404(client):
    response = await client.get("/api/v1/coding/session/tok_nonexistent")
    assert response.status_code == 404


async def test_session_no_question_assigned_400(client):
    cand = await _create_candidate_doc()
    response = await client.get(f"/api/v1/coding/session/{cand['secure_token']}")
    assert response.status_code == 400


async def test_session_returns_question_with_hidden_tests_filtered(client, admin_headers):
    question_id = await _create_question(client, admin_headers)
    cand = await _create_candidate_doc()

    assign_resp = await client.patch(
        f"/api/v1/coding/assign/{cand['candidate_id']}",
        json={"question_id": question_id},
        headers=admin_headers,
    )
    assert assign_resp.status_code == 200

    session_resp = await client.get(f"/api/v1/coding/session/{cand['secure_token']}")
    assert session_resp.status_code == 200
    body = session_resp.json()
    assert body["question_id"] == question_id
    assert "language_templates" in body
    assert "python" in body["language_templates"]
    assert len(body["test_cases"]) == 1
    assert body["test_cases"][0]["is_hidden"] is False
    for tc in body["test_cases"]:
        assert "is_hidden" in tc

    await client.delete(f"/api/v1/coding/questions/{question_id}", headers=admin_headers)


async def test_submit_without_assigned_question_400(client):
    cand = await _create_candidate_doc()
    response = await client.post(
        f"/api/v1/coding/session/{cand['secure_token']}/submit",
        json={"language": "python", "code": "print('hi')"},
    )
    assert response.status_code == 400


async def test_submit_judge0_not_configured_returns_503(client, admin_headers, monkeypatch):
    monkeypatch.setattr(settings, "CODE_SANDBOX_PROVIDER", "judge0")
    monkeypatch.setattr(settings, "JUDGE0_API_URL", "")

    question_id = await _create_question(client, admin_headers)
    cand = await _create_candidate_doc()
    await client.patch(
        f"/api/v1/coding/assign/{cand['candidate_id']}",
        json={"question_id": question_id},
        headers=admin_headers,
    )

    response = await client.post(
        f"/api/v1/coding/session/{cand['secure_token']}/submit",
        json={"language": "python", "code": "print('hi')"},
    )
    assert response.status_code == 503
    assert "not configured" in response.json()["detail"].lower()

    await client.delete(f"/api/v1/coding/questions/{question_id}", headers=admin_headers)


async def test_submit_invalid_token_404(client):
    response = await client.post(
        "/api/v1/coding/session/tok_nonexistent/submit",
        json={"language": "python", "code": "print('hi')"},
    )
    assert response.status_code == 404


async def test_list_submissions_empty(client, admin_headers):
    response = await client.get("/api/v1/coding/submissions/no-such-candidate", headers=admin_headers)
    assert response.status_code == 200
    assert response.json()["submissions"] == []


async def test_list_all_submissions_requires_admin(client, standard_headers):
    response = await client.get("/api/v1/coding/submissions", headers=standard_headers)
    assert response.status_code == 403


async def _insert_submission(candidate_id: str, question_id: str, **overrides) -> str:
    db = get_db()
    submission_id = str(uuid.uuid4())
    doc = {
        "submission_id": submission_id,
        "candidate_id": candidate_id,
        "question_id": question_id,
        "language": "python",
        "code": "print(1)",
        "status": "completed",
        "results": [],
        "score": 100.0,
        "submitted_at": "2026-01-01T00:00:00+00:00",
        "evaluated_at": "2026-01-01T00:00:00+00:00",
    }
    doc.update(overrides)
    await db.coding_submissions.insert_one(doc)
    return submission_id


async def test_list_all_submissions_filters_and_enriches(client, admin_headers):
    """The cross-candidate list: filters narrow it, and each row carries the
    candidate/question labels the ids alone don't give."""
    question_id = await _create_question(client, admin_headers)
    cand_a = await _create_candidate_doc()
    cand_b = await _create_candidate_doc()

    sub_a = await _insert_submission(cand_a["candidate_id"], question_id)
    sub_b = await _insert_submission(
        cand_b["candidate_id"], question_id, plagiarism_flagged=True,
    )

    try:
        response = await client.get(
            f"/api/v1/coding/submissions?question_id={question_id}", headers=admin_headers
        )
        assert response.status_code == 200
        body = response.json()
        assert body["total"] >= 2
        rows = {s["submission_id"]: s for s in body["submissions"]}
        assert sub_a in rows and sub_b in rows
        assert rows[sub_a]["candidate_name"] == "Coding Test Candidate"
        assert rows[sub_a]["candidate_email"] == cand_a["email"]
        assert rows[sub_a]["question_title"] == QUESTION_PAYLOAD["title"]

        response = await client.get(
            f"/api/v1/coding/submissions?candidate_id={cand_a['candidate_id']}", headers=admin_headers
        )
        assert [s["submission_id"] for s in response.json()["submissions"]] == [sub_a]

        response = await client.get("/api/v1/coding/submissions?flagged=true", headers=admin_headers)
        flagged_ids = [s["submission_id"] for s in response.json()["submissions"]]
        assert sub_b in flagged_ids and sub_a not in flagged_ids

        response = await client.get(
            f"/api/v1/coding/submissions?flagged=false&candidate_id={cand_a['candidate_id']}",
            headers=admin_headers,
        )
        assert [s["submission_id"] for s in response.json()["submissions"]] == [sub_a]
    finally:
        db = get_db()
        await db.coding_submissions.delete_many({"submission_id": {"$in": [sub_a, sub_b]}})
        await client.delete(f"/api/v1/coding/questions/{question_id}", headers=admin_headers)


def test_language_ids_contains_required_minimum():
    from services.hr_module.coding_service import LANGUAGE_IDS
    assert LANGUAGE_IDS["python"] == 71
    assert LANGUAGE_IDS["javascript"] == 63
    assert LANGUAGE_IDS["java"] == 62


def test_language_maps_cover_the_same_languages():
    """Switching CODE_SANDBOX_PROVIDER must never silently drop a language a
    stored question already has a starter template for."""
    from services.hr_module.coding_service import LANGUAGE_IDS, PISTON_LANGUAGES
    assert set(LANGUAGE_IDS) == set(PISTON_LANGUAGES)


async def test_run_on_judge0_raises_when_not_configured(monkeypatch):
    from services.hr_module.coding_service import run_on_judge0
    monkeypatch.setattr(settings, "JUDGE0_API_URL", "")
    with pytest.raises(RuntimeError, match="not configured"):
        await run_on_judge0("print(1)", 71, "")


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


def _stub_piston(monkeypatch, payload):
    """Point the service at Piston and replay `payload` for the one HTTP call
    the adapter makes. Returns the dict the request is captured into."""
    from services.hr_module import coding_service

    captured: dict = {}

    class _Client:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, json=None, headers=None):
            captured.update(url=url, json=json, headers=headers)
            return _FakeResponse(payload)

    monkeypatch.setattr(coding_service.httpx, "AsyncClient", _Client)
    monkeypatch.setattr(coding_service.settings, "CODE_SANDBOX_PROVIDER", "piston")
    monkeypatch.setattr(coding_service.settings, "PISTON_API_URL", "https://fake-piston.invalid/api/v2")
    return captured


async def test_run_on_piston_raises_when_not_configured(monkeypatch):
    from services.hr_module import coding_service

    monkeypatch.setattr(coding_service.settings, "PISTON_API_URL", "")
    with pytest.raises(RuntimeError, match="not configured"):
        await coding_service.run_on_piston("print(1)", "python", "")


async def test_run_on_piston_maps_successful_run(monkeypatch):
    from services.hr_module import coding_service

    captured = _stub_piston(monkeypatch, {
        "language": "python", "version": "3.10.0",
        "run": {"stdout": "5\n", "stderr": "", "code": 0, "signal": None},
    })

    result = await coding_service.run_on_piston("print(5)", "python", "2 3")

    assert captured["url"] == "https://fake-piston.invalid/api/v2/execute"
    assert captured["json"]["language"] == "python"
    assert captured["json"]["stdin"] == "2 3"
    assert captured["json"]["files"] == [{"content": "print(5)"}]
    assert result["stdout"] == "5\n"
    assert result["status"]["id"] == 3
    assert result["compile_output"] == ""
    assert result["time"] is None and result["memory"] is None


async def test_run_on_piston_maps_compile_failure_to_status_6(monkeypatch):
    """Status id 6 is what makes _run_test_cases skip the remaining cases
    instead of paying for N identical failures."""
    from services.hr_module import coding_service

    _stub_piston(monkeypatch, {
        "compile": {"stdout": "", "stderr": "Main.java:3: error: ';' expected", "code": 1},
        "run": {"stdout": "", "stderr": "", "code": None, "signal": None},
    })

    result = await coding_service.run_on_piston("class Main {}", "java", "")

    assert result["status"]["id"] == 6
    assert "';' expected" in result["compile_output"]


async def test_run_on_piston_maps_kill_signal_to_time_limit_exceeded(monkeypatch):
    from services.hr_module import coding_service

    _stub_piston(monkeypatch, {
        "run": {"stdout": "", "stderr": "", "code": None, "signal": "SIGKILL"},
    })

    result = await coding_service.run_on_piston("while True: pass", "python", "")
    assert result["status"]["id"] == 5


async def test_run_on_piston_successful_compile_is_not_a_failure(monkeypatch):
    """A compiled language that built cleanly reports compile.code == 0 — that
    must not be read as a compile error."""
    from services.hr_module import coding_service

    _stub_piston(monkeypatch, {
        "compile": {"stdout": "", "stderr": "", "code": 0},
        "run": {"stdout": "30\n", "stderr": "", "code": 0, "signal": None},
    })

    result = await coding_service.run_on_piston("class Main {}", "java", "")
    assert result["status"]["id"] == 3
    assert result["compile_output"] == ""


async def test_run_on_piston_rejects_unsupported_language(monkeypatch):
    from services.hr_module import coding_service

    _stub_piston(monkeypatch, {"run": {"stdout": "", "code": 0}})
    with pytest.raises(ValueError, match="Unsupported language"):
        await coding_service.run_on_piston("print(1)", "not-a-real-language", "")


async def test_run_in_sandbox_routes_by_provider(monkeypatch):
    """The dispatcher, not the caller, decides which engine runs — and the
    Judge0 branch must stay monkeypatchable through the module global."""
    from services.hr_module import coding_service

    _stub_piston(monkeypatch, {"run": {"stdout": "piston\n", "code": 0, "signal": None}})
    assert (await coding_service.run_in_sandbox("x", "python", ""))["stdout"] == "piston\n"

    async def _fake_judge0(source_code, language_id, stdin):
        assert language_id == 71
        return {"stdout": "judge0\n", "status": {"id": 3, "description": "Accepted"}}

    monkeypatch.setattr(coding_service, "run_on_judge0", _fake_judge0)
    monkeypatch.setattr(coding_service.settings, "CODE_SANDBOX_PROVIDER", "judge0")
    monkeypatch.setattr(coding_service.settings, "JUDGE0_API_URL", "https://fake-judge0.invalid")
    assert (await coding_service.run_in_sandbox("x", "python", ""))["stdout"] == "judge0\n"


async def test_evaluate_submission_scores_the_same_on_piston(
    client, admin_headers, monkeypatch,
):
    """The whole point of normalising to Judge0's shape: identical scoring math
    on either engine. Mirrors the stubbed-Judge0 scoring test above — one
    visible case passes, the hidden case does not."""
    from services.hr_module import coding_service

    question_id = await _create_question(client, admin_headers)
    cand = await _create_candidate_doc()

    def _payload(stdin):
        return {"run": {"stdout": "5\n" if stdin.strip() == "2 3" else "999\n",
                        "stderr": "", "code": 0, "signal": None}}

    class _Client:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, json=None, headers=None):
            return _FakeResponse(_payload(json.get("stdin", "")))

    monkeypatch.setattr(coding_service.httpx, "AsyncClient", _Client)
    monkeypatch.setattr(coding_service.settings, "CODE_SANDBOX_PROVIDER", "piston")
    monkeypatch.setattr(coding_service.settings, "PISTON_API_URL", "https://fake-piston.invalid/api/v2")

    submission = await coding_service.evaluate_submission(
        question_id=question_id, candidate_id=cand["candidate_id"],
        language="python", code="a,b=map(int,input().split());print(a+b)",
    )

    assert submission["status"] == "completed"
    assert submission["score"] == 50.0
    assert len(submission["results"]) == 2

    await client.delete(f"/api/v1/coding/questions/{question_id}", headers=admin_headers)


async def test_submit_returns_503_when_piston_selected_but_unset(client, admin_headers, monkeypatch):
    """Selecting an engine you haven't configured must report itself, not fall
    through to the other engine's URL."""
    from services.hr_module import coding_service

    question_id = await _create_question(client, admin_headers)
    cand = await _create_candidate_doc()
    await client.patch(
        f"/api/v1/coding/assign/{cand['candidate_id']}",
        json={"question_id": question_id}, headers=admin_headers,
    )
    monkeypatch.setattr(coding_service.settings, "CODE_SANDBOX_PROVIDER", "piston")
    monkeypatch.setattr(coding_service.settings, "PISTON_API_URL", "")
    monkeypatch.setattr(coding_service.settings, "JUDGE0_API_URL", "https://fake-judge0.invalid")

    response = await client.post(
        f"/api/v1/coding/session/{cand['secure_token']}/submit",
        json={"language": "python", "code": "print('hi')"},
    )
    assert response.status_code == 503
    assert "PISTON_API_URL" in response.json()["detail"]

    await client.delete(f"/api/v1/coding/questions/{question_id}", headers=admin_headers)


async def test_evaluate_submission_scoring_with_stubbed_judge0(client, admin_headers, monkeypatch):
    """Monkeypatch run_on_judge0 (an async function) so no network call is made,
    and verify evaluate_submission computes score/results correctly, including
    hidden-test detail being present in the STORED doc (redaction happens at
    the route layer, not in evaluate_submission itself)."""
    from services.hr_module import coding_service

    question_id = await _create_question(client, admin_headers)
    cand = await _create_candidate_doc()

    async def _fake_run_on_judge0(source_code, language_id, stdin):
        if stdin.strip() == "2 3":
            return {"stdout": "5\n", "stderr": None, "status": {"id": 3, "description": "Accepted"}}
        return {"stdout": "999\n", "stderr": None, "status": {"id": 3, "description": "Accepted"}}

    monkeypatch.setattr(coding_service, "run_on_judge0", _fake_run_on_judge0)
    monkeypatch.setattr(coding_service.settings, "CODE_SANDBOX_PROVIDER", "judge0")
    monkeypatch.setattr(coding_service.settings, "JUDGE0_API_URL", "https://fake-judge0.invalid")

    submission = await coding_service.evaluate_submission(
        question_id=question_id, candidate_id=cand["candidate_id"],
        language="python", code="a,b=map(int,input().split());print(a+b)",
    )

    assert submission["status"] == "completed"
    assert submission["score"] == 50.0
    assert len(submission["results"]) == 2
    hidden_result = next(r for r in submission["results"] if r["is_hidden"])
    assert hidden_result["passed"] is False
    assert hidden_result["actual_output"].strip() == "999"
    assert hidden_result["expected_output"] == "30"

    visible_result = next(r for r in submission["results"] if not r["is_hidden"])
    assert visible_result["passed"] is True

    stored = await get_db().coding_submissions.find_one({"submission_id": submission["submission_id"]})
    assert stored is not None
    assert stored["candidate_id"] == cand["candidate_id"]

    await client.delete(f"/api/v1/coding/questions/{question_id}", headers=admin_headers)


async def test_compile_error_short_circuits_and_is_reported(client, admin_headers, monkeypatch):
    """A submission that does not compile must say so — and must not spend one
    sandbox call per test case re-discovering the same failure."""
    from services.hr_module import coding_service

    question_id = await _create_question(client, admin_headers)
    cand = await _create_candidate_doc()
    calls = []

    async def _fake_run_on_judge0(source_code, language_id, stdin):
        calls.append(stdin)
        return {
            "stdout": None, "stderr": None, "time": None, "memory": None,
            "compile_output": "Main.java:3: error: cannot find symbol",
            "status": {"id": 6, "description": "Compilation Error"},
        }

    monkeypatch.setattr(coding_service, "run_on_judge0", _fake_run_on_judge0)
    monkeypatch.setattr(coding_service.settings, "CODE_SANDBOX_PROVIDER", "judge0")
    monkeypatch.setattr(coding_service.settings, "JUDGE0_API_URL", "https://fake-judge0.invalid")
    monkeypatch.setattr(coding_service.settings, "OPENAI_API_KEY", "")

    submission = await coding_service.evaluate_submission(
        question_id=question_id, candidate_id=cand["candidate_id"],
        language="java", code="class Main { oops }",
    )

    assert len(calls) == 1
    assert submission["execution"]["compile_error"] is True
    assert "cannot find symbol" in submission["execution"]["compile_message"]
    assert submission["execution"]["skipped_cases"] == len(submission["results"]) - 1
    assert submission["status"] == "completed"
    assert submission["score"] == 0.0

    await client.delete(f"/api/v1/coding/questions/{question_id}", headers=admin_headers)


async def test_execution_telemetry_is_captured(client, admin_headers, monkeypatch):
    """Time and memory were already on the wire and were being discarded."""
    from services.hr_module import coding_service

    question_id = await _create_question(client, admin_headers)
    cand = await _create_candidate_doc()

    async def _fake_run_on_judge0(source_code, language_id, stdin):
        return {
            "stdout": "5\n", "stderr": None, "time": "0.042", "memory": 3456,
            "exit_code": 0, "status": {"id": 3, "description": "Accepted"},
        }

    monkeypatch.setattr(coding_service, "run_on_judge0", _fake_run_on_judge0)
    monkeypatch.setattr(coding_service.settings, "CODE_SANDBOX_PROVIDER", "judge0")
    monkeypatch.setattr(coding_service.settings, "JUDGE0_API_URL", "https://fake-judge0.invalid")
    monkeypatch.setattr(coding_service.settings, "OPENAI_API_KEY", "")

    submission = await coding_service.evaluate_submission(
        question_id=question_id, candidate_id=cand["candidate_id"],
        language="python", code="a,b=map(int,input().split());print(a+b)",
    )

    row = submission["results"][0]
    assert row["time_ms"] == 42.0
    assert row["memory_kb"] == 3456
    assert row["status"] == "Accepted"
    assert row["exit_code"] == 0
    assert submission["execution"]["max_time_ms"] == 42.0
    assert submission["execution"]["max_memory_kb"] == 3456
    assert submission["execution"]["compile_error"] is False

    await client.delete(f"/api/v1/coding/questions/{question_id}", headers=admin_headers)


async def test_total_sandbox_failure_scores_none_not_zero(client, admin_headers, monkeypatch):
    """A sandbox outage must not be written onto a hiring report as 0/N."""
    from services.hr_module import coding_service

    question_id = await _create_question(client, admin_headers)
    cand = await _create_candidate_doc()

    async def _boom(source_code, language_id, stdin):
        raise RuntimeError("sandbox unreachable")

    monkeypatch.setattr(coding_service, "run_on_judge0", _boom)
    monkeypatch.setattr(coding_service.settings, "CODE_SANDBOX_PROVIDER", "judge0")
    monkeypatch.setattr(coding_service.settings, "JUDGE0_API_URL", "https://fake-judge0.invalid")
    monkeypatch.setattr(coding_service.settings, "OPENAI_API_KEY", "")

    submission = await coding_service.evaluate_submission(
        question_id=question_id, candidate_id=cand["candidate_id"],
        language="python", code="print(1)",
    )

    assert submission["score"] is None
    assert submission["status"] == "execution_error"
    assert submission["execution"]["errored_cases"] == len(submission["results"])
    assert all(r["execution_error"] for r in submission["results"])

    from services.hr_module.interview_engine import _attach_coding_scores
    report: dict = {}
    await _attach_coding_scores(report, {"candidate_id": cand["candidate_id"]})
    assert "coding_score" not in report

    await client.delete(f"/api/v1/coding/questions/{question_id}", headers=admin_headers)


async def test_evaluate_submission_unknown_question_raises(monkeypatch):
    from services.hr_module import coding_service
    monkeypatch.setattr(coding_service.settings, "JUDGE0_API_URL", "https://fake-judge0.invalid")
    with pytest.raises(ValueError, match="not found"):
        await coding_service.evaluate_submission(
            question_id="does-not-exist", candidate_id="some-candidate",
            language="python", code="print(1)",
        )


async def test_evaluate_submission_unsupported_language_raises(monkeypatch, client, admin_headers):
    from services.hr_module import coding_service
    question_id = await _create_question(client, admin_headers)
    monkeypatch.setattr(coding_service.settings, "JUDGE0_API_URL", "https://fake-judge0.invalid")

    with pytest.raises(ValueError, match="Unsupported language"):
        await coding_service.evaluate_submission(
            question_id=question_id, candidate_id="some-candidate",
            language="not-a-real-language", code="print(1)",
        )

    await client.delete(f"/api/v1/coding/questions/{question_id}", headers=admin_headers)


async def test_code_quality_review_skipped_without_anthropic_key(monkeypatch):
    """No key must skip the review, not fail the submission.

    CODE_EVAL_MODEL is pinned explicitly rather than left at its default: the
    default is an OpenAI model, so relying on it would silently test the
    OpenAI gate under a test named for the Anthropic one.
    """
    from config.settings import settings
    from services.hr_module.coding_service import evaluate_code_quality

    monkeypatch.setattr(settings, "CODE_EVAL_MODEL", "claude-opus-5")
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")
    result = await evaluate_code_quality(
        question={"title": "T", "description": "D"},
        language="python", code="print(1)", passed=1, total=1,
    )
    assert result is None


async def test_code_quality_review_skipped_without_openai_key(monkeypatch):
    """The mirror of the above for the default (OpenAI) model — the gate that
    actually runs in this deployment."""
    from config.settings import settings
    from services.hr_module.coding_service import evaluate_code_quality

    monkeypatch.setattr(settings, "CODE_EVAL_MODEL", "gpt-4o")
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "")
    result = await evaluate_code_quality(
        question={"title": "T", "description": "D"},
        language="python", code="print(1)", passed=1, total=1,
    )
    assert result is None


async def test_code_quality_review_parses_structured_output(monkeypatch):
    import json as _json
    from config.settings import settings
    import services.hr_module.coding_service as cs

    payload = {
        "readability_score": 80, "structure_score": 70, "efficiency_score": 60,
        "idiomatic_score": 75, "problem_solving_score": 65,
        "overall_quality_score": 72,
        "strengths": ["clear naming"], "concerns": ["no edge-case handling"],
        "approach_summary": "Single pass with a dict.",
        "feedback_for_recruiter": "Solid.", "feedback_for_candidate": "Add guards.",
    }

    async def fake_ask_llm(**kwargs):
        assert kwargs.get("json_schema") is not None
        assert kwargs.get("model") == settings.CODE_EVAL_MODEL
        return _json.dumps(payload)

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-ant-test")
    monkeypatch.setattr(cs, "ask_llm", fake_ask_llm)

    result = await cs.evaluate_code_quality(
        question={"title": "T", "description": "D"},
        language="python", code="print(1)", passed=1, total=2,
    )
    assert result["overall_quality_score"] == 72
    assert result["feedback_for_candidate"] == "Add guards."


async def test_code_quality_review_survives_unparseable_output(monkeypatch):
    from config.settings import settings
    import services.hr_module.coding_service as cs

    async def fake_ask_llm(**kwargs):
        return "not json at all"

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-ant-test")
    monkeypatch.setattr(cs, "ask_llm", fake_ask_llm)

    result = await cs.evaluate_code_quality(
        question={"title": "T", "description": "D"},
        language="python", code="print(1)", passed=0, total=1,
    )
    assert result is None


def test_anthropic_models_registered_and_priced():
    from config.llm import MODEL_REGISTRY, _LLM_PRICING, provider_for_model

    anthropic_models = [m for m in MODEL_REGISTRY if m["provider"] == "anthropic"]
    assert anthropic_models, "no Anthropic models registered"
    for m in anthropic_models:
        assert provider_for_model(m["id"]) == "anthropic"
        assert m["id"] in _LLM_PRICING, f"{m['id']} missing from pricing table"
    assert provider_for_model("ft:gpt-4o:acme:xyz") == "openai"


def test_code_evaluation_prompt_key_registered():
    from services.hr_module.prompt_config_service import (
        KNOWN_PROMPT_KEYS, _get_hardcoded_default,
    )

    assert "code_evaluation" in KNOWN_PROMPT_KEYS
    for key, meta in KNOWN_PROMPT_KEYS.items():
        system, template = _get_hardcoded_default(key)
        assert system and template, f"{key} has no hardcoded default"
        for placeholder in meta["placeholders"]:
            assert "{" + placeholder + "}" in template, f"{key} missing {{{placeholder}}}"


def test_anthropic_request_shape(monkeypatch):
    """The Anthropic path must not reuse OpenAI's request shape.

    Verified without a live key because these are exactly the mistakes that
    only surface as a 400 in production: `system` is a top-level parameter
    rather than a message, and current Claude models reject `temperature`
    outright.
    """
    import asyncio, types
    import config.llm as llm
    from config.settings import settings

    captured = {}

    class _Block:
        def __init__(self, text): self.type, self.text = "text", text

    class _Resp:
        content = [_Block("hello ")  , _Block("world")]
        usage = types.SimpleNamespace(input_tokens=10, output_tokens=5)
        stop_reason = "end_turn"

    class _Messages:
        async def create(self, **kwargs):
            captured.update(kwargs)
            return _Resp()

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-ant-test")
    monkeypatch.setattr(llm, "get_anthropic_client",
                        lambda: types.SimpleNamespace(messages=_Messages()))

    out = asyncio.get_event_loop_policy().new_event_loop().run_until_complete(
        llm.ask_llm(
            prompt="p", system="s", model="claude-opus-5",
            max_tokens=1000, temperature=0.7,
            json_mode=True, json_schema={"type": "object"},
        )
    )

    assert out == "hello world", "text blocks must be concatenated"
    assert captured["system"] == "s", "system is top-level, not a message role"
    assert captured["messages"] == [{"role": "user", "content": "p"}]
    assert "temperature" not in captured, "current Claude models reject temperature with a 400"
    assert captured["output_config"]["format"]["type"] == "json_schema"
    assert captured["max_tokens"] >= 4000, "thinking shares the max_tokens budget"


def test_anthropic_refusal_returns_empty_json(monkeypatch):
    """A safety refusal must not be parsed as if it were content."""
    import asyncio, types
    import config.llm as llm
    from config.settings import settings

    class _Resp:
        content = []
        usage = types.SimpleNamespace(input_tokens=1, output_tokens=0)
        stop_reason = "refusal"

    class _Messages:
        async def create(self, **kwargs): return _Resp()

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-ant-test")
    monkeypatch.setattr(llm, "get_anthropic_client",
                        lambda: types.SimpleNamespace(messages=_Messages()))

    out = asyncio.get_event_loop_policy().new_event_loop().run_until_complete(
        llm.ask_llm(prompt="p", system="s", model="claude-opus-5", json_mode=True)
    )
    assert out == "{}"


async def test_code_quality_review_works_via_openai_model(monkeypatch):
    """CODE_EVAL_MODEL=gpt-4o must run the review with no Anthropic key at all."""
    import json as _json
    from config.settings import settings
    import services.hr_module.coding_service as cs

    payload = {
        "readability_score": 70, "structure_score": 70, "efficiency_score": 70,
        "idiomatic_score": 70, "problem_solving_score": 70,
        "overall_quality_score": 70,
        "strengths": [], "concerns": [], "approach_summary": "s",
        "feedback_for_recruiter": "r", "feedback_for_candidate": "c",
    }

    async def fake_ask_llm(**kwargs):
        assert kwargs.get("model") == "gpt-4o"
        return _json.dumps(payload)

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "sk-test")
    monkeypatch.setattr(settings, "CODE_EVAL_MODEL", "gpt-4o")
    monkeypatch.setattr(cs, "ask_llm", fake_ask_llm)

    result = await cs.evaluate_code_quality(
        question={"title": "T", "description": "D"},
        language="python", code="print(1)", passed=1, total=1,
    )
    assert result["overall_quality_score"] == 70


async def test_output_correctness_skipped_without_openai_key(monkeypatch):
    from config.settings import settings
    from services.hr_module.coding_service import evaluate_output_correctness

    monkeypatch.setattr(settings, "OPENAI_API_KEY", "")
    result = await evaluate_output_correctness(
        question={"title": "T", "description": "D"},
        language="python", code="print(1)",
        results=[{"test_case_index": 0, "passed": True, "actual_output": "5", "expected_output": "5", "is_hidden": False}],
    )
    assert result is None


async def test_output_correctness_parses_structured_output(monkeypatch):
    import json as _json
    from config.settings import settings
    import services.hr_module.coding_service as cs

    payload = {"verdict": "correct", "confidence": 90, "notes": "Matches expected output."}

    async def fake_ask_llm(**kwargs):
        assert kwargs.get("model") == settings.CODE_CORRECTNESS_MODEL
        return _json.dumps(payload)

    monkeypatch.setattr(settings, "OPENAI_API_KEY", "sk-test")
    monkeypatch.setattr(cs, "ask_llm", fake_ask_llm)

    result = await cs.evaluate_output_correctness(
        question={"title": "T", "description": "D"},
        language="python", code="print(5)",
        results=[{"test_case_index": 0, "passed": True, "actual_output": "5", "expected_output": "5", "is_hidden": False}],
    )
    assert result["verdict"] == "correct"


async def test_output_correctness_rejects_unknown_verdict(monkeypatch):
    import json as _json
    from config.settings import settings
    import services.hr_module.coding_service as cs

    async def fake_ask_llm(**kwargs):
        return _json.dumps({"verdict": "maybe", "confidence": 50, "notes": "n/a"})

    monkeypatch.setattr(settings, "OPENAI_API_KEY", "sk-test")
    monkeypatch.setattr(cs, "ask_llm", fake_ask_llm)

    result = await cs.evaluate_output_correctness(
        question={"title": "T", "description": "D"},
        language="python", code="print(5)", results=[],
    )
    assert result is None


async def test_output_correctness_survives_unparseable_output(monkeypatch):
    from config.settings import settings
    import services.hr_module.coding_service as cs

    async def fake_ask_llm(**kwargs):
        return "not json"

    monkeypatch.setattr(settings, "OPENAI_API_KEY", "sk-test")
    monkeypatch.setattr(cs, "ask_llm", fake_ask_llm)

    result = await cs.evaluate_output_correctness(
        question={"title": "T", "description": "D"},
        language="python", code="print(5)", results=[],
    )
    assert result is None


async def test_evaluate_submission_flags_low_typing_ratio(client, admin_headers, monkeypatch):
    """Very few keystrokes relative to a large authored solution must push a
    low_typing_ratio flag onto the candidate's coding_integrity_flags and fold
    a reduced coding_integrity_score onto the stored submission."""
    from services.hr_module import coding_service

    question_id = await _create_question(client, admin_headers)
    cand = await _create_candidate_doc()

    async def _fake_run_on_judge0(source_code, language_id, stdin):
        return {"stdout": "5\n", "stderr": None, "status": {"id": 3, "description": "Accepted"}}

    monkeypatch.setattr(coding_service, "run_on_judge0", _fake_run_on_judge0)
    monkeypatch.setattr(coding_service.settings, "CODE_SANDBOX_PROVIDER", "judge0")
    monkeypatch.setattr(coding_service.settings, "JUDGE0_API_URL", "https://fake-judge0.invalid")
    monkeypatch.setattr(coding_service.settings, "OPENAI_API_KEY", "")

    long_solution = "a,b=map(int,input().split())\n" + "#padding\n" * 40 + "print(a+b)"
    submission = await coding_service.evaluate_submission(
        question_id=question_id, candidate_id=cand["candidate_id"],
        language="python", code=long_solution, keystrokes=5,
    )

    assert submission["typing_ratio"] is not None
    assert submission["typing_ratio"] < coding_service.settings.CODE_TYPING_RATIO_FLAG_THRESHOLD
    assert submission["coding_integrity_score"] < 100

    updated_cand = await get_db().candidates.find_one({"candidate_id": cand["candidate_id"]})
    assert any(f.startswith("low_typing_ratio@") for f in updated_cand.get("coding_integrity_flags", []))

    await get_db().coding_submissions.delete_one({"submission_id": submission["submission_id"]})
    await client.delete(f"/api/v1/coding/questions/{question_id}", headers=admin_headers)


async def test_evaluate_submission_without_keystrokes_skips_typing_check(client, admin_headers, monkeypatch):
    from services.hr_module import coding_service

    question_id = await _create_question(client, admin_headers)
    cand = await _create_candidate_doc()

    async def _fake_run_on_judge0(source_code, language_id, stdin):
        return {"stdout": "5\n", "stderr": None, "status": {"id": 3, "description": "Accepted"}}

    monkeypatch.setattr(coding_service, "run_on_judge0", _fake_run_on_judge0)
    monkeypatch.setattr(coding_service.settings, "CODE_SANDBOX_PROVIDER", "judge0")
    monkeypatch.setattr(coding_service.settings, "JUDGE0_API_URL", "https://fake-judge0.invalid")
    monkeypatch.setattr(coding_service.settings, "OPENAI_API_KEY", "")

    submission = await coding_service.evaluate_submission(
        question_id=question_id, candidate_id=cand["candidate_id"],
        language="python", code="a,b=map(int,input().split());print(a+b)",
    )
    assert submission["typing_ratio"] is None
    assert submission["coding_integrity_score"] == 100

    await get_db().coding_submissions.delete_one({"submission_id": submission["submission_id"]})
    await client.delete(f"/api/v1/coding/questions/{question_id}", headers=admin_headers)


async def test_coding_flag_invalid_token_404(client):
    response = await client.post(
        "/api/v1/coding/session/tok_nonexistent/flag", json={"event": "paste_blocked"},
    )
    assert response.status_code == 404


async def test_coding_flag_appends_to_separate_array(client):
    """coding_integrity_flags must be distinct from the interview's
    integrity_flags — recording one must never touch the other."""
    cand = await _create_candidate_doc()
    db = get_db()
    await db.candidates.update_one(
        {"candidate_id": cand["candidate_id"]},
        {"$set": {"integrity_flags": ["tab_switch@2026-01-01T00:00:00"]}},
    )

    response = await client.post(
        f"/api/v1/coding/session/{cand['secure_token']}/flag", json={"event": "paste_blocked"},
    )
    assert response.status_code == 200
    assert response.json() == {"recorded": True}

    updated = await db.candidates.find_one({"candidate_id": cand["candidate_id"]})
    assert len(updated["coding_integrity_flags"]) == 1
    assert updated["coding_integrity_flags"][0].startswith("paste_blocked@")
    assert updated["integrity_flags"] == ["tab_switch@2026-01-01T00:00:00"]


async def test_run_invalid_token_404(client):
    response = await client.post(
        "/api/v1/coding/session/tok_nonexistent/run", json={"language": "python", "code": "print(1)"},
    )
    assert response.status_code == 404


async def test_run_without_assigned_question_400(client):
    cand = await _create_candidate_doc()
    response = await client.post(
        f"/api/v1/coding/session/{cand['secure_token']}/run",
        json={"language": "python", "code": "print(1)"},
    )
    assert response.status_code == 400


async def test_run_judge0_not_configured_returns_503(client, admin_headers, monkeypatch):
    monkeypatch.setattr(settings, "CODE_SANDBOX_PROVIDER", "judge0")
    monkeypatch.setattr(settings, "JUDGE0_API_URL", "")

    question_id = await _create_question(client, admin_headers)
    cand = await _create_candidate_doc()
    await client.patch(
        f"/api/v1/coding/assign/{cand['candidate_id']}",
        json={"question_id": question_id}, headers=admin_headers,
    )

    response = await client.post(
        f"/api/v1/coding/session/{cand['secure_token']}/run",
        json={"language": "python", "code": "print(1)"},
    )
    assert response.status_code == 503

    await client.delete(f"/api/v1/coding/questions/{question_id}", headers=admin_headers)


async def test_run_unsupported_language_400(client, admin_headers, monkeypatch):
    from services.hr_module import coding_service

    question_id = await _create_question(client, admin_headers)
    cand = await _create_candidate_doc()
    await client.patch(
        f"/api/v1/coding/assign/{cand['candidate_id']}",
        json={"question_id": question_id}, headers=admin_headers,
    )
    monkeypatch.setattr(coding_service.settings, "JUDGE0_API_URL", "https://fake-judge0.invalid")

    response = await client.post(
        f"/api/v1/coding/session/{cand['secure_token']}/run",
        json={"language": "not-a-real-language", "code": "print(1)"},
    )
    assert response.status_code == 400

    await client.delete(f"/api/v1/coding/questions/{question_id}", headers=admin_headers)


async def test_run_stubbed_judge0_returns_raw_output(client, admin_headers, monkeypatch):
    """/run must hand back raw stdout without grading or persisting anything —
    no coding_submissions doc should be created by this endpoint."""
    from services.hr_module import coding_service

    question_id = await _create_question(client, admin_headers)
    cand = await _create_candidate_doc()
    await client.patch(
        f"/api/v1/coding/assign/{cand['candidate_id']}",
        json={"question_id": question_id}, headers=admin_headers,
    )

    async def _fake_run_on_judge0(source_code, language_id, stdin):
        assert stdin.strip() == "2 3"
        return {
            "stdout": "5\n", "stderr": None, "compile_output": None,
            "status": {"id": 3, "description": "Accepted"}, "time": "0.01", "memory": 3600,
        }

    monkeypatch.setattr(coding_service, "run_on_judge0", _fake_run_on_judge0)
    monkeypatch.setattr(coding_service.settings, "CODE_SANDBOX_PROVIDER", "judge0")
    monkeypatch.setattr(coding_service.settings, "JUDGE0_API_URL", "https://fake-judge0.invalid")

    before_count = await get_db().coding_submissions.count_documents({"candidate_id": cand["candidate_id"]})
    response = await client.post(
        f"/api/v1/coding/session/{cand['secure_token']}/run",
        json={"language": "python", "code": "a,b=map(int,input().split());print(a+b)"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["stdout"].strip() == "5"
    assert body["status"] == "Accepted"

    after_count = await get_db().coding_submissions.count_documents({"candidate_id": cand["candidate_id"]})
    assert after_count == before_count, "/run must never persist a submission"

    await client.delete(f"/api/v1/coding/questions/{question_id}", headers=admin_headers)


async def test_run_custom_stdin_overrides_sample_case(client, admin_headers, monkeypatch):
    from services.hr_module import coding_service

    question_id = await _create_question(client, admin_headers)
    cand = await _create_candidate_doc()
    await client.patch(
        f"/api/v1/coding/assign/{cand['candidate_id']}",
        json={"question_id": question_id}, headers=admin_headers,
    )

    async def _fake_run_on_judge0(source_code, language_id, stdin):
        assert stdin.strip() == "100 200"
        return {"stdout": "300\n", "status": {"id": 3, "description": "Accepted"}}

    monkeypatch.setattr(coding_service, "run_on_judge0", _fake_run_on_judge0)
    monkeypatch.setattr(coding_service.settings, "CODE_SANDBOX_PROVIDER", "judge0")
    monkeypatch.setattr(coding_service.settings, "JUDGE0_API_URL", "https://fake-judge0.invalid")

    response = await client.post(
        f"/api/v1/coding/session/{cand['secure_token']}/run",
        json={"language": "python", "code": "print(1)", "stdin": "100 200"},
    )
    assert response.status_code == 200
    assert response.json()["stdout"].strip() == "300"

    await client.delete(f"/api/v1/coding/questions/{question_id}", headers=admin_headers)


def test_sanitize_submission_strips_new_admin_only_fields():
    from routes.coding import _sanitize_submission_for_candidate

    doc = {
        "submission_id": "s1", "score": 80.0, "results": [],
        "ai_correctness": {"verdict": "correct", "confidence": 90, "notes": "n"},
        "typing_ratio": 0.9, "coding_integrity_score": 92,
        "code": "print(1)", "quality_score": 70,
    }
    out = _sanitize_submission_for_candidate(doc)
    for key in ("ai_correctness", "typing_ratio", "coding_integrity_score", "code", "quality_score"):
        assert key not in out
    assert out["score"] == 80.0
