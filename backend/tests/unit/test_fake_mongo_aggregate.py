import pytest

from fake_mongo import FakeRaw, matches, run_pipeline

pytestmark = pytest.mark.anyio


def _people():
    return [
        {"name": "ada", "team": "core", "age": 36, "tags": ["Python", "python", "Go"], "meta": {"level": 3}},
        {"name": "bob", "team": "core", "age": 29, "tags": ["Go"], "meta": {"level": 1}},
        {"name": "cy", "team": "web", "age": 41, "tags": [], "meta": {"level": 2}},
        {"name": "di", "team": "web", "age": None, "tags": "single"},
        {"name": "ed", "tags": None},
    ]


def test_match_keeps_the_rows_the_filter_selects():
    assert [r["name"] for r in run_pipeline(_people(), [{"$match": {"team": "core"}}])] == ["ada", "bob"]
    assert run_pipeline(_people(), [{"$match": {"team": "nobody"}}]) == []


def test_unwind_gives_one_row_per_element_and_drops_empty_missing_or_null_arrays():
    rows = run_pipeline(_people(), [{"$unwind": "$tags"}])
    assert [(r["name"], r["tags"]) for r in rows] == [
        ("ada", "Python"), ("ada", "python"), ("ada", "Go"), ("bob", "Go"), ("di", "single"),
    ]


def test_unwind_reaches_a_nested_array_and_leaves_the_source_rows_alone():
    source = [{"id": 1, "classification": {"skills": ["a", "b"], "years": 4}}]
    rows = run_pipeline(source, [{"$unwind": "$classification.skills"}])
    assert [r["classification"] for r in rows] == [{"skills": "a", "years": 4}, {"skills": "b", "years": 4}]
    assert source[0]["classification"]["skills"] == ["a", "b"]


def test_unwind_accepts_the_document_form():
    rows = run_pipeline(_people(), [{"$unwind": {"path": "$tags"}}, {"$limit": 1}])
    assert rows[0]["tags"] == "Python"


def test_group_counts_by_a_field_and_a_missing_key_is_one_null_group():
    rows = run_pipeline(_people(), [{"$group": {"_id": "$team", "count": {"$sum": 1}}}])
    assert {r["_id"]: r["count"] for r in rows} == {"core": 2, "web": 2, None: 1}


def test_group_by_a_nested_field_and_by_a_composite_key():
    rows = run_pipeline(_people(), [{"$group": {"_id": "$meta.level", "count": {"$sum": 1}}}])
    assert {r["_id"]: r["count"] for r in rows} == {3: 1, 1: 1, 2: 1, None: 2}
    pairs = run_pipeline(_people(), [{"$group": {"_id": {"team": "$team", "age": "$age"}, "count": {"$sum": 1}}}])
    keys = [row["_id"] for row in pairs]
    assert len(keys) == 5
    assert {"team": "core", "age": 36} in keys
    assert {"team": "web", "age": None} in keys
    assert {} in keys


def test_group_sum_of_a_field_adds_the_numbers_and_ignores_the_rest():
    rows = run_pipeline(_people(), [{"$group": {"_id": "$team", "total": {"$sum": "$age"}}}])
    assert {r["_id"]: r["total"] for r in rows} == {"core": 65, "web": 41, None: 0}


def test_group_with_a_constant_key_collapses_everything():
    rows = run_pipeline(_people(), [{"$group": {"_id": None, "count": {"$sum": 1}}}])
    assert rows == [{"_id": None, "count": 5}]


def test_group_rejects_an_accumulator_it_does_not_implement():
    with pytest.raises(NotImplementedError):
        run_pipeline(_people(), [{"$group": {"_id": "$team", "first": {"$first": "$name"}}}])


def test_sort_orders_by_several_keys_and_puts_missing_values_lowest():
    rows = run_pipeline(_people(), [{"$sort": {"team": 1, "age": -1}}])
    assert [r["name"] for r in rows] == ["ed", "ada", "bob", "cy", "di"]
    rows = run_pipeline(_people(), [{"$sort": {"age": -1, "name": 1}}])
    assert [r["name"] for r in rows] == ["cy", "ada", "bob", "di", "ed"]


def test_sort_is_stable_and_mixes_types_without_raising():
    rows = [{"v": "b", "n": 1}, {"v": 2, "n": 2}, {"v": "a", "n": 3}, {"v": None, "n": 4}, {"v": True, "n": 5}]
    assert [r["n"] for r in run_pipeline(rows, [{"$sort": {"v": 1}}])] == [4, 2, 3, 1, 5]


def test_skip_and_limit_page_through_the_rows():
    rows = [{"i": i} for i in range(7)]
    assert [r["i"] for r in run_pipeline(rows, [{"$skip": 2}, {"$limit": 3}])] == [2, 3, 4]
    assert run_pipeline(rows, [{"$skip": 10}]) == []
    assert [r["i"] for r in run_pipeline(rows, [{"$skip": 0}, {"$limit": 2}])] == [0, 1]


def test_add_fields_computes_expressions_without_touching_the_source():
    source = [{"headline": "Senior Python Engineer", "n": 2}, {"headline": None, "n": 5}, {"n": 1}]
    expression = {"$add": [
        3,
        {"$cond": [{"$regexMatch": {
            "input": {"$convert": {"input": "$headline", "to": "string", "onError": "", "onNull": ""}},
            "regex": "(?<![A-Za-z0-9])python(?![A-Za-z0-9])", "options": "i",
        }}, 3, 0]},
    ]}
    rows = run_pipeline(source, [{"$addFields": {"score": expression}}])
    assert [r["score"] for r in rows] == [6, 3, 3]
    assert "score" not in source[0]


def test_expression_operators_ifnull_convert_and_add():
    row = [{"a": None, "b": 7, "c": ["x"], "d": "t"}]
    out = run_pipeline(row, [{"$addFields": {
        "x": {"$ifNull": ["$a", "fallback"]},
        "y": {"$ifNull": ["$b", 0]},
        "z": {"$convert": {"input": "$b", "to": "string", "onError": "bad", "onNull": "none"}},
        "w": {"$convert": {"input": "$c", "to": "string", "onError": "bad", "onNull": "none"}},
        "v": {"$convert": {"input": "$missing", "to": "string", "onError": "bad", "onNull": "none"}},
        "u": {"$add": [1, "$b", "$missing"]},
        "t": {"$regexMatch": {"input": "$b", "regex": "7"}},
    }}])[0]
    assert (out["x"], out["y"], out["z"], out["w"], out["v"], out["u"], out["t"]) == (
        "fallback", 7, "7", "bad", "none", 8, False,
    )


def test_unsupported_expression_operators_and_conversions_fail_loudly():
    with pytest.raises(NotImplementedError):
        run_pipeline([{"a": 1}], [{"$addFields": {"x": {"$multiply": [2, 3]}}}])
    with pytest.raises(NotImplementedError):
        run_pipeline([{"a": 1}], [{"$addFields": {"x": {"$convert": {"input": "$a", "to": "int"}}}}])


def test_project_removes_excluded_fields_and_refuses_inclusion_form():
    rows = run_pipeline([{"_id": "x", "a": 1, "b": {"c": 2, "d": 3}}], [{"$project": {"_id": 0, "a": 0, "b.c": 0}}])
    assert rows == [{"b": {"d": 3}}]
    with pytest.raises(NotImplementedError):
        run_pipeline([{"a": 1}], [{"$project": {"a": 1}}])


def test_an_unknown_stage_fails_loudly():
    with pytest.raises(NotImplementedError):
        run_pipeline([{"a": 1}], [{"$lookup": {}}])


def test_stages_run_in_order():
    rows = run_pipeline(
        _people(),
        [{"$unwind": "$tags"}, {"$group": {"_id": "$tags", "count": {"$sum": 1}}}, {"$sort": {"count": -1, "_id": 1}}, {"$limit": 2}],
    )
    assert rows == [{"_id": "Go", "count": 2}, {"_id": "Python", "count": 1}]


def test_elem_match_needs_one_element_to_satisfy_every_condition():
    doc = {"jobs": [{"id": "a", "score": 0.9}, {"id": "b", "score": 0.2}]}
    assert matches(doc, {"jobs": {"$elemMatch": {"score": {"$gte": 0.5}}}})
    assert matches(doc, {"jobs": {"$elemMatch": {"id": "a", "score": {"$gte": 0.5}}}})
    assert not matches(doc, {"jobs": {"$elemMatch": {"id": "b", "score": {"$gte": 0.5}}}})
    assert not matches({"jobs": []}, {"jobs": {"$elemMatch": {"id": "a"}}})
    assert not matches({}, {"jobs": {"$elemMatch": {"id": "a"}}})


def test_elem_match_on_scalar_arrays_uses_operator_conditions():
    assert matches({"n": [1, 5, 9]}, {"n": {"$elemMatch": {"$gt": 4, "$lt": 6}}})
    assert not matches({"n": [1, 9]}, {"n": {"$elemMatch": {"$gt": 4, "$lt": 6}}})


async def test_a_collection_aggregates_through_a_cursor_with_to_list_and_async_iteration():
    raw = FakeRaw()
    for person in _people():
        raw.add("people", person)
    cursor = raw.people.aggregate([{"$match": {"team": "core"}}, {"$group": {"_id": "$team", "count": {"$sum": 1}}}])
    assert await cursor.to_list(length=None) == [{"_id": "core", "count": 2}]
    seen = [row async for row in raw.people.aggregate([{"$match": {"team": "web"}}, {"$sort": {"name": 1}}])]
    assert [r["name"] for r in seen] == ["cy", "di"]
    assert len(await raw.people.aggregate([{"$sort": {"name": 1}}]).to_list(length=2)) == 2


async def test_aggregation_results_are_copies_of_the_stored_rows():
    raw = FakeRaw()
    raw.add("people", {"name": "ada", "tags": ["a"]})
    rows = await raw.people.aggregate([{"$match": {"name": "ada"}}]).to_list(length=None)
    rows[0]["tags"].append("mutated")
    assert raw.people.docs[0]["tags"] == ["a"]


async def test_the_tenant_handle_adds_the_company_match_in_front_of_the_pipeline():
    from config.tenancy import db_for_company

    raw = FakeRaw()
    raw.add("people", {"name": "mine", "team": "x"}, "cmp_a")
    raw.add("people", {"name": "theirs", "team": "x"}, "cmp_b")
    rows = await db_for_company(raw, "cmp_a").people.aggregate(
        [{"$group": {"_id": "$team", "count": {"$sum": 1}}}]
    ).to_list(length=None)
    assert rows == [{"_id": "x", "count": 1}]
