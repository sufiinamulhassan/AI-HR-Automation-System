"""Shared Pydantic schemas for hr_module — the only module this repo ships."""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, EmailStr, Field


class PaginatedResponse(BaseModel):
    total: int
    page: int
    limit: int
    data: list[Any]


class MessageResponse(BaseModel):
    message: str


class InviteType(str, Enum):
    auto = "auto"
    manual = "manual"


class InviteStatus(BaseModel):
    candidate_id: str
    invite_type: InviteType
    sent_to: str
    sent_at: str
    sent_by: str


class ResendInviteResponse(BaseModel):
    message: str
    sent_to: str
    sent_by: str
    resent_count: int


class BatchStatusResponse(BaseModel):
    batch_id: str
    total_files: int
    processed: int
    skipped_duplicates: int
    failed: int
    auto_invited: int
    status: str
    uploaded_by: str
    created_at: str
    updated_at: str


class InviteFunnel(BaseModel):
    auto_invited: int
    manually_invited: int
    interviewed: int
    hired: int


class ResumeStatsResponse(BaseModel):
    total: int
    by_domain: dict[str, int]
    by_seniority: dict[str, int]
    invite_funnel: InviteFunnel


class HRJobCreate(BaseModel):
    title: str
    description: str
    difficulty: str = "medium"
    employment_type: str = "full-time"
    location: str | None = None
    salary_min: int | None = None
    salary_max: int | None = None
    is_remote: bool = False
    company_name: str | None = None
    model_override: str | None = None
    deadline_days: int | None = None


class HRJobUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    difficulty: str | None = None
    location: str | None = None
    salary_min: int | None = None
    salary_max: int | None = None
    is_remote: bool | None = None
    company_name: str | None = None
    deadline_days: int | None = None


class HRCandidateCreate(BaseModel):
    job_id: str
    name: str
    email: EmailStr
    resume_id: str | None = None
    scenario_id: str | None = None
    application_source: str | None = None


class HRCandidateDecision(BaseModel):
    decision: str
    notes: str | None = None


class DepartmentCreate(BaseModel):
    name: str
    description: str | None = None


class DepartmentUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class DesignationCreate(BaseModel):
    name: str
    department: str | None = None
    description: str | None = None


class DesignationUpdate(BaseModel):
    name: str | None = None
    department: str | None = None
    description: str | None = None
