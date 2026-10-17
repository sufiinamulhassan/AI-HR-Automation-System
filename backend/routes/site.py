from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field

from services.hr_module import site_service
from shared.rate_limit import public_token_throttle

router = APIRouter()

_read_throttle = public_token_throttle("site_read", ip_limit=120, param=None)
_contact_throttle = public_token_throttle("site_contact", ip_limit=5, window_seconds=3600, param=None)

CACHE_HEADER = "public, max-age=300, stale-while-revalidate=600"


class ContactBody(BaseModel):
    name: str = Field(default="", max_length=400)
    email: str = Field(default="", max_length=400)
    company: str = Field(default="", max_length=600)
    topic: str = Field(default="other", max_length=40)
    message: str = Field(default="", max_length=20000)
    consent: bool = False
    website: str = Field(default="", max_length=400)


@router.get("/plans", dependencies=[Depends(_read_throttle)])
async def plans(response: Response):
    response.headers["Cache-Control"] = CACHE_HEADER
    return {"plans": site_service.public_plans()}


@router.post("/contact", dependencies=[Depends(_contact_throttle)])
async def contact(body: ContactBody):
    if body.website.strip():
        return {"status": "received", "reference": ""}
    form = site_service.validate_contact(
        name=body.name, email=body.email, company=body.company, topic=body.topic,
        message=body.message, consent=body.consent,
    )
    return await site_service.submit_contact(form)
