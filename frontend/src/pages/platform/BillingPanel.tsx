import { useState } from 'react'
import { platformApi } from '../../lib/api'
import type { ClientRow, SubscriptionProvider, SubscriptionStatus } from '../../lib/platformTypes'
import { Field, Modal, type ToastTone } from './PlatformUi'
import { errorDetail, errorStatus, fmtDate } from './format'

export const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  none: 'No subscription',
  trialing: 'Trial',
  active: 'Active',
  past_due: 'Past due',
  canceled: 'Canceled',
}

export const STATUS_BADGE: Record<SubscriptionStatus, string> = {
  none: 'badge-gray',
  trialing: 'badge-blue',
  active: 'badge-green',
  past_due: 'badge-yellow',
  canceled: 'badge-red',
}

const PROVIDER_LABEL: Record<SubscriptionProvider, string> = { manual: 'Manual', stripe: 'Stripe' }
const STATUSES: SubscriptionStatus[] = ['none', 'trialing', 'active', 'past_due', 'canceled']

const STRIPE_OFF = 'Stripe is not configured.'

const isHttps = (url: unknown): url is string => typeof url === 'string' && /^https:\/\//i.test(url)

export function StatusChip({ status }: { status: SubscriptionStatus | string | undefined }) {
  const known = (status && status in STATUS_LABEL ? status : 'none') as SubscriptionStatus
  return <span className={`badge ${STATUS_BADGE[known]}`}>{STATUS_LABEL[known]}</span>
}

function SubscriptionDialog({ client, onClose, onDone }: {
  client: ClientRow
  onClose: () => void
  onDone: (message: string, tone?: ToastTone) => void
}) {
  const current = client.subscription
  const [status, setStatus] = useState<SubscriptionStatus>(current?.status ?? 'none')
  const [provider, setProvider] = useState<SubscriptionProvider>(current?.provider ?? 'manual')
  const [trialEnds, setTrialEnds] = useState((client.plan?.trial_ends_at ?? '').slice(0, 10))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')

  async function submit() {
    const day = trialEnds.trim()
    if (status === 'trialing' && day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      setError('Use a date such as 2026-11-30.')
      return
    }
    setError('')
    setFailure('')
    setBusy(true)
    try {
      await platformApi.setSubscription(client.client_id, {
        status,
        provider,
        ...(status === 'trialing' && day ? { trial_ends_at: day } : {}),
      })
      onDone(`Subscription of ${client.name} is now ${STATUS_LABEL[status].toLowerCase()}`)
    } catch (e) {
      setFailure(errorDetail(e, 'Could not change the subscription.'))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Change status of ${client.name}`}
      onClose={busy ? () => {} : onClose}
      onSubmit={e => { e.preventDefault(); if (!busy) void submit() }}
      footer={
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Saving…' : 'Save status'}</button>
        </>
      }
    >
      <Field label="Status">
        <select className="form-input" value={status} onChange={e => setStatus(e.target.value as SubscriptionStatus)}>
          {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </Field>
      <Field label="Billing">
        <select className="form-input" value={provider} onChange={e => setProvider(e.target.value as SubscriptionProvider)}>
          <option value="manual">Manual</option>
          <option value="stripe">Stripe</option>
        </select>
      </Field>
      {status === 'trialing' && (
        <Field label="Trial ends" error={error} hint="The last day of the trial. Blank keeps the date it has.">
          <input className="form-input" type="date" value={trialEnds} onChange={e => setTrialEnds(e.target.value)} />
        </Field>
      )}
      {failure && <div className="pco-form-error" role="alert">{failure}</div>}
    </Modal>
  )
}

export default function BillingPanel({ client, onChanged }: {
  client: ClientRow
  onChanged: (message: string, tone?: ToastTone) => void
}) {
  const sub = client.subscription
  const [dialog, setDialog] = useState(false)
  const [busy, setBusy] = useState<'checkout' | 'portal' | null>(null)
  const [stripeOff, setStripeOff] = useState('')
  const [error, setError] = useState('')

  async function open(kind: 'checkout' | 'portal') {
    setBusy(kind)
    setError('')
    try {
      const r = kind === 'checkout'
        ? await platformApi.startCheckout(client.client_id)
        : await platformApi.openBillingPortal(client.client_id)
      const url = r.data?.url
      if (isHttps(url)) window.location.assign(url)
      else setError('Stripe sent an address that cannot be opened.')
    } catch (e) {
      if (errorStatus(e) === 503) setStripeOff(errorDetail(e, STRIPE_OFF))
      else setError(errorDetail(e, kind === 'checkout' ? 'Could not start the checkout.' : 'Could not open the billing portal.'))
    }
    setBusy(null)
  }

  const trialEnds = client.plan?.trial_ends_at

  return (
    <section className="pco-card" aria-labelledby="pco-cd-billing">
      <div className="pco-card-head">
        <h2 className="pco-card-title" id="pco-cd-billing">Billing</h2>
        <div className="pco-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog(true)}>Change status</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void open('checkout')} disabled={!!stripeOff || busy !== null}>
            {busy === 'checkout' ? 'Opening…' : 'Start Stripe checkout'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void open('portal')} disabled={!!stripeOff || busy !== null}>
            {busy === 'portal' ? 'Opening…' : 'Open billing portal'}
          </button>
        </div>
      </div>

      <dl className="pco-billing-grid">
        <div>
          <dt>Status</dt>
          <dd>
            <StatusChip status={sub?.status} />
            {sub?.cancel_at_period_end && <span className="pco-cell-meta">Cancels at the end of the period</span>}
          </dd>
        </div>
        <div><dt>Provider</dt><dd>{sub ? PROVIDER_LABEL[sub.provider] ?? sub.provider : '-'}</dd></div>
        <div><dt>Trial ends</dt><dd>{fmtDate(trialEnds)}</dd></div>
        <div><dt>Current period ends</dt><dd>{fmtDate(sub?.current_period_end)}</dd></div>
      </dl>

      {stripeOff && <div className="pco-hint" role="status">{stripeOff}</div>}
      {error && <div className="pco-form-error" role="alert">{error}</div>}

      {dialog && (
        <SubscriptionDialog
          client={client}
          onClose={() => setDialog(false)}
          onDone={(message, tone) => { setDialog(false); onChanged(message, tone) }}
        />
      )}
    </section>
  )
}
