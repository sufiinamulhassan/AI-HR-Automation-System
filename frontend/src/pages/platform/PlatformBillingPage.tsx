import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { platformApi } from '../../lib/api'
import type { BillingStatement } from '../../lib/platformTypes'
import { StatusChip } from './BillingPanel'
import { EmptyState, ErrorState, LoadingState, PeriodRange } from './PlatformUi'
import { currentMonth, errorDetail, fmtInt, fmtMb, fmtPeriodEdge, fmtUsd } from './format'
import { useLoaded } from './usePlatformData'
import './PlatformBillingPage.css'

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export default function PlatformBillingPage() {
  const [params, setParams] = useSearchParams()
  const rawMonth = params.get('month') ?? ''
  const month = MONTH_RE.test(rawMonth) ? rawMonth : currentMonth()
  const clientId = params.get('client') ?? ''
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')

  const clients = useLoaded(
    () => platformApi.listClients().then(r => r.data.clients),
    [],
    'Could not load the clients.',
  )
  const { data, loading, error, reload } = useLoaded(
    () => platformApi.billingStatement({ month, ...(clientId ? { client_id: clientId } : {}) }).then(r => r.data),
    [month, clientId],
    'Could not load the statement.',
  )

  function pick(next: { month?: string; client?: string }) {
    const m = next.month ?? month
    const c = next.client ?? clientId
    setParams({ ...(m !== currentMonth() ? { month: m } : {}), ...(c ? { client: c } : {}) }, { replace: true })
  }

  async function download() {
    setDownloading(true)
    setDownloadError('')
    try {
      const r = await platformApi.billingStatementCsv({ month, ...(clientId ? { client_id: clientId } : {}) })
      saveBlob(r.data, `statement-${month}.csv`)
    } catch (e) {
      setDownloadError(errorDetail(e, 'Could not download the statement.'))
    }
    setDownloading(false)
  }

  return (
    <div className="pco-page" aria-busy={loading}>
      <div className="pco-header">
        <h1 className="pco-title">Billing statement</h1>
        <div className="pco-header-actions">
          <button type="button" className="btn btn-primary" onClick={() => void download()} disabled={downloading || !data}>
            {downloading ? 'Preparing…' : 'Download CSV'}
          </button>
        </div>
      </div>

      <section className="pco-card">
        <div className="pco-filters">
          <label className="pco-month">
            <span className="pco-month-label">Client</span>
            <select className="form-input pco-select" value={clientId} onChange={e => pick({ client: e.target.value })}>
              <option value="">All clients</option>
              {(clients.data ?? []).map(c => <option key={c.client_id} value={c.client_id}>{c.name}</option>)}
            </select>
          </label>
          <label className="pco-month">
            <span className="pco-month-label">Month</span>
            <input
              type="month"
              className="form-input pco-month-input"
              value={month}
              max={currentMonth()}
              onChange={e => { if (MONTH_RE.test(e.target.value)) pick({ month: e.target.value }) }}
            />
          </label>
          {data && <PeriodRange period={data.period} />}
          {data?.generated_at && <span className="pco-range">Generated {fmtPeriodEdge(data.generated_at)}</span>}
        </div>
        {downloadError && <div className="pco-form-error" role="alert">{downloadError}</div>}
      </section>

      {!data && loading && <LoadingState label="Loading the statement…" />}
      {!data && !loading && error && <ErrorState message={error} onRetry={reload} />}
      {data && error && <ErrorState message={error} onRetry={reload} />}

      {data && <Statement data={data} />}
    </div>
  )
}

function Statement({ data }: { data: BillingStatement }) {
  if (data.clients.length === 0) return <EmptyState>There is nothing to bill for this month.</EmptyState>
  const t = data.totals
  return (
    <>
      {data.clients.map(c => (
        <section key={c.client_id} className="pco-card" aria-labelledby={`pco-bill-${c.client_id}`}>
          <div className="pco-card-head">
            <h2 className="pco-card-title" id={`pco-bill-${c.client_id}`}>
              <Link to={`/platform/clients/${encodeURIComponent(c.client_id)}`} className="pco-name">{c.client_name}</Link>
            </h2>
            <div className="pco-header-actions">
              {c.plan?.name && <span className="pco-chip">{c.plan.name}</span>}
              {typeof c.plan?.price_monthly_usd === 'number' && <span className="pco-range">{fmtUsd(c.plan.price_monthly_usd)} a month</span>}
              <StatusChip status={c.subscription_status} />
            </div>
          </div>
          <div className="pco-table-wrap">
            <table className="pco-table">
              <thead>
                <tr>
                  <th scope="col">Company</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="pco-num">Seats</th>
                  <th scope="col" className="pco-num">AI cost</th>
                  <th scope="col" className="pco-num">AI calls</th>
                  <th scope="col" className="pco-num">Emails</th>
                  <th scope="col" className="pco-num">Storage</th>
                </tr>
              </thead>
              <tbody>
                {c.lines.map(l => (
                  <tr key={l.company_id}>
                    <th scope="row">
                      <Link to={`/platform/companies/${encodeURIComponent(l.company_id)}`} className="pco-name">{l.company_name}</Link>
                    </th>
                    <td>{l.status === 'active' ? 'Active' : l.status === 'suspended' ? 'Suspended' : l.status}</td>
                    <td className="pco-num">{fmtInt(l.seats)}</td>
                    <td className="pco-num">{fmtUsd(l.ai_cost_usd)}</td>
                    <td className="pco-num">{fmtInt(l.ai_calls)}</td>
                    <td className="pco-num">{fmtInt(l.emails_sent)}</td>
                    <td className="pco-num">{fmtMb(l.storage_mb)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="pco-total-row">
                  <th scope="row">Total</th>
                  <td>{fmtInt(c.totals.companies)} {c.totals.companies === 1 ? 'company' : 'companies'}</td>
                  <td className="pco-num">{fmtInt(c.totals.seats)}</td>
                  <td className="pco-num">{fmtUsd(c.totals.ai_cost_usd)}</td>
                  <td className="pco-num">{fmtInt(c.totals.ai_calls)}</td>
                  <td className="pco-num">{fmtInt(c.totals.emails_sent)}</td>
                  <td className="pco-num">{fmtMb(c.totals.storage_mb)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      ))}

      <section className="pco-card" aria-labelledby="pco-bill-grand">
        <div className="pco-card-head"><h2 className="pco-card-title" id="pco-bill-grand">Grand total</h2></div>
        <div className="pco-table-wrap">
          <table className="pco-table">
            <thead>
              <tr>
                <th scope="col">All clients</th>
                <th scope="col" className="pco-num">Companies</th>
                <th scope="col" className="pco-num">Seats</th>
                <th scope="col" className="pco-num">AI cost</th>
                <th scope="col" className="pco-num">AI calls</th>
                <th scope="col" className="pco-num">Emails</th>
                <th scope="col" className="pco-num">Storage</th>
                <th scope="col" className="pco-num">Monthly price</th>
              </tr>
            </thead>
            <tbody>
              <tr className="pco-total-row">
                <th scope="row">Grand total</th>
                <td className="pco-num">{fmtInt(t.companies)}</td>
                <td className="pco-num">{fmtInt(t.seats)}</td>
                <td className="pco-num">{fmtUsd(t.ai_cost_usd)}</td>
                <td className="pco-num">{fmtInt(t.ai_calls)}</td>
                <td className="pco-num">{fmtInt(t.emails_sent)}</td>
                <td className="pco-num">{fmtMb(t.storage_mb)}</td>
                <td className="pco-num">{fmtUsd(t.price_monthly_usd)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
