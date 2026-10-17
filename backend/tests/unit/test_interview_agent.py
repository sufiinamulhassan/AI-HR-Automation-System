import pytest

pytestmark = pytest.mark.anyio


class _FakeUpdateResult:
    def __init__(self, matched_count: int = 1, modified_count: int = 1):
        self.matched_count = matched_count
        self.modified_count = modified_count


class _FakeCandidatesCollection:

    def __init__(self, *, find_one_result=None, fail_update_calls: set[int] = frozenset({1})):
        self._find_one_result = find_one_result
        self._fail_update_calls = fail_update_calls
        self.update_calls: list[tuple[dict, dict]] = []
        self._update_call_count = 0

    async def find_one(self, *args, **kwargs):
        return self._find_one_result

    async def update_one(self, filter_, update, *args, **kwargs):
        self._update_call_count += 1
        self.update_calls.append((filter_, update))
        if self._update_call_count in self._fail_update_calls:
            raise RuntimeError("simulated mongo write failure")
        return _FakeUpdateResult()


class _FakeDB:
    def __init__(self, candidates: _FakeCandidatesCollection):
        self.candidates = candidates


def _base_state(**overrides) -> dict:
    state = {
        "secure_token": "tok_test_persist",
        "report": {"overall_score": 70, "score_breakdown": {"final_score": 66}, "final_score": 66},
        "eval_score": 70.0,
    }
    state.update(overrides)
    return state


async def test_persist_report_node_marks_failed_on_db_write_error(monkeypatch):
    import config.database as database_module
    from agents.interview_agent import persist_report_node

    fake_candidates = _FakeCandidatesCollection(
        find_one_result={"candidate_id": "c1", "job_id": "j1", "email": "a@b.com", "name": "A"},
        fail_update_calls={1},
    )
    monkeypatch.setattr(database_module, "get_db", lambda: _FakeDB(fake_candidates))

    result = await persist_report_node(_base_state())

    assert result.get("error") == "simulated mongo write failure"
    assert fake_candidates._update_call_count == 2, "expected the real write AND the fallback marker write"

    fallback_filter, fallback_update = fake_candidates.update_calls[1]
    assert fallback_filter == {"secure_token": "tok_test_persist"}
    assert fallback_update["$set"]["report_status"] == "failed"
    assert fallback_update["$set"]["report_error"] == "simulated mongo write failure"


async def test_persist_report_node_survives_fallback_write_also_failing(monkeypatch):
    import config.database as database_module
    from agents.interview_agent import persist_report_node

    fake_candidates = _FakeCandidatesCollection(
        find_one_result={"candidate_id": "c1"},
        fail_update_calls={1, 2},
    )
    monkeypatch.setattr(database_module, "get_db", lambda: _FakeDB(fake_candidates))

    result = await persist_report_node(_base_state())

    assert result.get("error") == "simulated mongo write failure"
    assert fake_candidates._update_call_count == 2


async def test_persist_report_node_success_sets_ready_status_and_score_fields(monkeypatch):
    import config.database as database_module
    from agents.interview_agent import persist_report_node

    fake_candidates = _FakeCandidatesCollection(
        find_one_result={"candidate_id": "c1", "job_id": "j1", "email": "a@b.com", "name": "A"},
        fail_update_calls=set(),
    )
    monkeypatch.setattr(database_module, "get_db", lambda: _FakeDB(fake_candidates))

    result = await persist_report_node(_base_state())

    assert "error" not in result
    assert fake_candidates._update_call_count == 1
    _, update = fake_candidates.update_calls[0]
    assert update["$set"]["report_status"] == "ready"
    assert update["$set"]["report_error"] is None
    assert update["$set"]["score_breakdown"] == {"final_score": 66}
    assert update["$set"]["final_score"] == 66
    assert update["$set"]["status"] == "completed"


async def test_persist_report_node_returns_error_when_db_unavailable(monkeypatch):
    import config.database as database_module
    from agents.interview_agent import persist_report_node

    monkeypatch.setattr(database_module, "get_db", lambda: None)

    result = await persist_report_node(_base_state())

    assert result == {"error": "db_unavailable"}
