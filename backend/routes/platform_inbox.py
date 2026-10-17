from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from services.hr_module import site_service
from shared.auth import require_platform_admin

router = APIRouter()


class RequestUpdate(BaseModel):
    status: Literal["new", "in_progress", "done", "spam"] | None = None
    note: str | None = Field(default=None, max_length=5000)


@router.get("/contact-requests")
async def list_contact_requests(
    status: str | None = None,
    topic: str | None = None,
    q: str | None = None,
    page: int = Query(default=1, ge=1, le=10000),
    limit: int = Query(default=site_service.DEFAULT_PAGE_SIZE, ge=1, le=site_service.MAX_PAGE_SIZE),
    _owner: dict = Depends(require_platform_admin),
):
    return await site_service.list_requests(status=status, topic=topic, q=q, page=page, limit=limit)


@router.patch("/contact-requests/{request_id}")
async def update_contact_request(request_id: str, body: RequestUpdate, owner: dict = Depends(require_platform_admin)):
    return await site_service.update_request(request_id, status=body.status, note=body.note, actor=owner)


@router.delete("/contact-requests/{request_id}")
async def delete_contact_request(request_id: str, owner: dict = Depends(require_platform_admin)):
    await site_service.delete_request(request_id, actor=owner)
    return {"status": "deleted"}
