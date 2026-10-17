from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from config.database import get_db
from shared.auth import require_admin
from shared.quotas import ai_action
from services.hr_module import model_task_service as svc

router = APIRouter()


class TaskModelUpdate(BaseModel):
    model: str | None = Field(None, max_length=100)


@router.get("")
async def list_tasks(_: dict = Depends(require_admin)):
    return svc.list_tasks()


@router.get("/embedding/status")
async def embedding_status(_: dict = Depends(require_admin)):
    return await svc.embedding_status(get_db())


@router.post("/embedding/reindex")
async def reindex_embeddings(
    cursor: str | None = Query(None, max_length=200),
    limit: int = Query(svc.REINDEX_DEFAULT_BATCH, ge=1, le=svc.REINDEX_MAX_BATCH),
    _: dict = Depends(require_admin),
    __: None = Depends(ai_action("embedding_reindex", per_hour=600)),
):
    return await svc.reindex_batch(get_db(), cursor=cursor, limit=limit)


@router.put("/{task}")
async def set_task_model(task: str, body: TaskModelUpdate, user: dict = Depends(require_admin)):
    return await svc.set_task_model(get_db(), user, task, body.model)
