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
    "company_id",
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
    out = {k: v for k, v in doc.items() if k in CANDIDATE_VISIBLE_SUBMISSION_KEYS}

    out["results"] = redact_hidden_results(doc.get("results", []))

    if "quality" in doc:
        quality = doc.get("quality")
        if isinstance(quality, dict):
            out["quality"] = {k: quality[k] for k in CANDIDATE_SAFE_QUALITY_KEYS if k in quality}
        else:
            out["quality"] = quality

    return out
