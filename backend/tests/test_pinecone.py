"""Pinecone connectivity — skipped unless a test index is configured."""
import pytest

pytestmark = pytest.mark.anyio


async def test_real_pinecone_connection_if_configured():
    from config.database import get_pinecone
    from config.settings import settings

    if not settings.PINECONE_API_KEY:
        pytest.skip("Pinecone API key for tests is not configured.")

    pinecone = get_pinecone()
    assert pinecone is not None, "Pinecone index should be initialized if API key is provided"

    stats = pinecone.describe_index_stats()
    assert stats is not None
    assert stats.dimension == 1536
