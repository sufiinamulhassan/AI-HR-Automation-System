from fastapi import APIRouter, Depends, Header, HTTPException, Request

from services.hr_module import billing_service
from shared.rate_limit import public_token_throttle

router = APIRouter()


@router.post(
    "/webhook/stripe",
    dependencies=[Depends(public_token_throttle("billing_webhook", ip_limit=240, param=None))],
)
async def stripe_webhook(request: Request, stripe_signature: str | None = Header(None, alias="Stripe-Signature")):
    payload = await request.body()
    try:
        return await billing_service.handle_webhook(payload, stripe_signature)
    except billing_service.WebhookError as exc:
        raise HTTPException(exc.status, exc.message)
