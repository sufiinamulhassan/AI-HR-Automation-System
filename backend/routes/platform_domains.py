from fastapi import APIRouter, Depends
from pydantic import BaseModel

from services.hr_module import domains_service, workspace_service
from shared.auth import require_platform_admin

router = APIRouter()


class DomainsUpdate(BaseModel):
    domains: list[str]


@router.get("/companies/{company_id}/domains")
async def get_company_domains(company_id: str, _owner: dict = Depends(require_platform_admin)):
    return await domains_service.get_domains(company_id)


@router.put("/companies/{company_id}/domains")
async def put_company_domains(
    company_id: str, body: DomainsUpdate, owner: dict = Depends(require_platform_admin),
):
    domains = await domains_service.set_domains(company_id, body.domains)
    await workspace_service.platform_audit(
        owner, "company_domains_update", "company", company_id, {"domains": domains}, also_company=company_id,
    )
    return {"company_id": company_id, "domains": domains}
