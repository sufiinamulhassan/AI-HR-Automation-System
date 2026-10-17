from __future__ import annotations

from dataclasses import dataclass


def _exclude(query: dict | None, field: str, values: tuple[str, ...]) -> dict:
    query = query or {}
    if not values:
        return query
    clause = {field: {"$nin": list(values)}}
    return {"$and": [query, clause]} if query else clause


@dataclass(frozen=True)
class ResumeScope:
    orphan_resume_ids: tuple[str, ...] = ()
    orphan_candidate_ids: tuple[str, ...] = ()

    @classmethod
    async def load(cls, db) -> "ResumeScope":
        referenced = [r for r in await db.candidates.distinct("resume_id") if r]
        if not referenced:
            return cls()
        live = set(await db.resumes.distinct("resume_id", {"resume_id": {"$in": referenced}}))
        orphans = [r for r in referenced if r not in live]
        if not orphans:
            return cls()
        candidate_ids = await db.candidates.distinct("candidate_id", {"resume_id": {"$in": orphans}})
        return cls(tuple(orphans), tuple(c for c in candidate_ids if c))

    def candidates(self, query: dict | None = None) -> dict:
        return _exclude(query, "resume_id", self.orphan_resume_ids)

    def by_candidate_id(self, query: dict | None = None) -> dict:
        return _exclude(query, "candidate_id", self.orphan_candidate_ids)
