"""Candidate-facing projection of a coding submission.

WHY THIS IS AN ALLOW-LIST, NOT A DENY-LIST
------------------------------------------
This started life as a tuple of keys to strip. That is fail-OPEN: every field
added to the submission document ships to the candidate until someone
remembers to add it to the strip list. That failure has already happened once —
the entire `quality` dict, including the explicitly recruiter-addressed
`feedback_for_recruiter`, was returned verbatim to the candidate whose hiring
prospects it was describing (see tests/test_coding_privacy.py).

With several workstreams about to add fields to this document (execution
telemetry, edge-case coverage, variant ids), a deny-list would leak by default.
So the projection is inverted: a key reaches the candidate only if it is named
here. An unclassified field is silently dropped at runtime and turns
`test_every_submission_key_is_classified` red in CI, which is the whole point —
the safe outcome happens automatically, and the loud one happens in CI rather
than in production.

WHY THREE SETS AND NOT TWO
--------------------------
A plain visible/hidden split is wrong. `quality` and `results` are BOTH —
`quality.feedback_for_candidate` is written for the candidate by design while
`quality.feedback_for_recruiter` must never reach them, and a test result's
pass/fail is candidate-facing while a hidden case's input/output is not. Those
two keys need a filter, not a verdict.
"""

CANDIDATE_VISIBLE_SUBMISSION_KEYS = frozenset({
    "submission_id",
    "question_id",
    "candidate_id",
    "language",
    "status",
    "score",
    "submitted_at",
    "evaluated_at",
})

CANDIDATE_PARTIAL_SUBMISSION_KEYS = frozenset({
    "quality",
    "results",
})

ADMIN_ONLY_SUBMISSION_KEYS = frozenset({
    "_id",
    "code",
    "plagiarism",
    "plagiarism_flagged",
    "complexity",
    "quality_score",
    "ai_correctness",
    "typing_ratio",
    "coding_integrity_score",
    "execution",
})

CANDIDATE_SAFE_QUALITY_KEYS = ("feedback_for_candidate",)

ALL_CLASSIFIED_SUBMISSION_KEYS = (
    CANDIDATE_VISIBLE_SUBMISSION_KEYS
    | CANDIDATE_PARTIAL_SUBMISSION_KEYS
    | ADMIN_ONLY_SUBMISSION_KEYS
)


def redact_hidden_results(results: list[dict]) -> list[dict]:
    """Candidate-facing: hidden test results show pass/fail only, never content.

    Hidden rows are REBUILT from a fixed 3-key shape rather than having keys
    removed, so a new per-result field cannot leak through this path either.
    """
    redacted = []
    for r in results or []:
        if r.get("is_hidden"):
            redacted.append({
                "test_case_index": r.get("test_case_index"),
                "passed": r.get("passed"),
                "is_hidden": True,
            })
        else:
            redacted.append(r)
    return redacted


def project_submission_for_candidate(doc: dict) -> dict:
    """Return only what the candidate may see. Unknown keys are dropped."""
    out = {k: v for k, v in doc.items() if k in CANDIDATE_VISIBLE_SUBMISSION_KEYS}

    out["results"] = redact_hidden_results(doc.get("results", []))

    if "quality" in doc:
        quality = doc.get("quality")
        if isinstance(quality, dict):
            out["quality"] = {k: quality[k] for k in CANDIDATE_SAFE_QUALITY_KEYS if k in quality}
        else:
            out["quality"] = quality

    return out
