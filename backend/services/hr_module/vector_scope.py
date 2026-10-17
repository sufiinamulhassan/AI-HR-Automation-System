from __future__ import annotations

from config.tenancy import DEFAULT_COMPANY_ID, NO_MATCH, TenantContextMissing, current_company_id

MATCH_UNTAGGED_FOR_DEFAULT = True


def _company() -> str:
    company_id = current_company_id()
    if not company_id:
        raise TenantContextMissing(
            "a Pinecone query or upsert needs a company: authenticate the request, resolve the "
            "public token, or wrap the work in company_context()"
        )
    return company_id


def _embedding_clause() -> dict:
    from config.llm import embedding_model
    from config.settings import settings

    model = embedding_model()
    if model == settings.RESUME_EMBEDDING_MODEL:
        return {"$or": [{"embedding_model": model}, {"embedding_model": {"$exists": False}}]}
    return {"embedding_model": model}


def query_filter(doc_type: str) -> dict:
    company_id = _company()
    if company_id == DEFAULT_COMPANY_ID and MATCH_UNTAGGED_FOR_DEFAULT:
        owner = {"$or": [{"company_id": company_id}, {"company_id": {"$exists": False}}]}
    else:
        owner = {"company_id": company_id}
    return {"$and": [{"doc_type": doc_type}, owner, _embedding_clause()]}


def vector_metadata(metadata: dict) -> dict:
    from config.llm import embedding_model

    company_id = _company()
    if company_id == NO_MATCH:
        raise TenantContextMissing("a vector may not be written with no company bound")
    return {**metadata, "company_id": company_id, "embedding_model": embedding_model()}


def owns(metadata: dict | None) -> bool:
    company_id = _company()
    if company_id == NO_MATCH:
        return False
    tagged = (metadata or {}).get("company_id")
    if tagged:
        return tagged == company_id
    return company_id == DEFAULT_COMPANY_ID and MATCH_UNTAGGED_FOR_DEFAULT


def owned_ids(index, ids: list[str]) -> list[str]:
    if not ids:
        return []
    try:
        vectors = getattr(index.fetch(ids=ids), "vectors", None) or {}
    except Exception:
        return []
    return [i for i, v in vectors.items() if owns(getattr(v, "metadata", None) or {})]
