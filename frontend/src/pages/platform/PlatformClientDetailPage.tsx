import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { platformApi } from '../../lib/api'
import type { ClientDetail, CompanyRow, PlatformPeriod } from '../../lib/platformTypes'
import BillingPanel from './BillingPanel'
import ClientEditDialog from './ClientEditDialog'
import { AddAdminDialog, AddCompanyDialog, ResetPasswordDialog, SsoDomainsDialog } from './CompanyDialogs'
import { DeleteClientDialog } from './DeleteDialogs'
import { CostBars, DailyBars, FeatureBars } from './PlatformCharts'
import {
  AsOf, EmptyState, ErrorState, LoadingState, PeriodRange, PeriodSelect, StatusBadge, useToast, type ToastTone,
} from './PlatformUi'
import { ClientStatusDialog, CompanyStatusDialog } from './StatusDialogs'
import { costBreakdownTiles, fmtDate, fmtInt, fmtMb, fmtStorage, fmtUsd, fmtWhen } from './format'
import { useArrivalNotice, useForceRefresh, useLoaded, usePlatformPeriod } from './usePlatformData'
import './PlatformClientDetailPage.css'

type Dialog =
  | { kind: 'client-status' }
  | { kind: 'client-edit' }
  | { kind: 'client-delete' }
  | { kind: 'add-company' }
  | { kind: 'company-status'; company: CompanyRow }
  | { kind: 'add-admin'; company: CompanyRow }
  | { kind: 'reset-password'; company: CompanyRow }
  | { kind: 'sso'; company: CompanyRow }

export default function PlatformClientDetailPage() {
  const { clientId = '' } = useParams<{ clientId: string }>()
  const navigate = useNavigate()
  const [period, setPeriod] = usePlatformPeriod()
  const { toast, showToast } = useToast()
  const { take, mark } = useForceRefresh()
  const { data, loading, error, status, reload } = useLoaded(
    () => {
      const fresh = take()
      return (fresh ? platformApi.getClient(clientId, period, fresh) : platformApi.getClient(clientId, period)).then(r => r.data)
    },
    [clientId, period],
    'Could not load this client.',
  )
  const [dialog, setDialog] = useState<Dialog | null>(null)

  useArrivalNotice(showToast)

  async function copySignInLink(company: CompanyRow) {
    const url = `${window.location.origin}/login?company=${encodeURIComponent(company.slug)}`
    try {
      await navigator.clipboard.writeText(url)
      showToast(`Sign-in link for ${company.name} copied`)
    } catch {
      showToast(`Could not copy. The link is ${url}`)
    }
  }

  function finished(message: string, tone?: ToastTone) {
    setDialog(null)
    showToast(message, tone)
    reload()
  }

  return (
    <div className="pco-page" aria-busy={loading}>
      {toast}
      <Link to="/platform/clients" className="pco-back">All clients</Link>

      {!data && loading && <LoadingState label="Loading the client…" />}
      {!data && !loading && status === 404 && <EmptyState>This client does not exist.</EmptyState>}
      {!data && !loading && error && status !== 404 && <ErrorState message={error} onRetry={reload} />}
      {data && error && <ErrorState message={error} onRetry={reload} />}

      {data && (
        <DetailBody
          data={data}
          period={period}
          onPeriod={setPeriod}
          open={setDialog}
          onCopyLink={copySignInLink}
          loading={loading}
          onRefresh={() => { mark(); reload() }}
          onBilling={finished}
        />
      )}

      {dialog?.kind === 'client-status' && data && (
        <ClientStatusDialog client={data.client} onClose={() => setDialog(null)} onDone={finished} />
      )}
      {dialog?.kind === 'client-edit' && data && (
        <ClientEditDialog client={data.client} onClose={() => setDialog(null)} onDone={finished} />
      )}
      {dialog?.kind === 'client-delete' && data && (
        <DeleteClientDialog
          client={data.client}
          onClose={() => setDialog(null)}
          onDone={() => navigate('/platform/clients', { replace: true, state: { notice: `${data.client.name} deleted` } })}
        />
      )}
      {dialog?.kind === 'add-company' && data && (
        <AddCompanyDialog clientId={data.client.client_id} onClose={() => setDialog(null)} onDone={finished} />
      )}
      {dialog?.kind === 'company-status' && (
        <CompanyStatusDialog company={dialog.company} onClose={() => setDialog(null)} onDone={finished} />
      )}
      {dialog?.kind === 'add-admin' && (
        <AddAdminDialog company={dialog.company} onClose={() => setDialog(null)} onDone={finished} />
      )}
      {dialog?.kind === 'reset-password' && (
        <ResetPasswordDialog company={dialog.company} onClose={() => setDialog(null)} onDone={finished} />
      )}
      {dialog?.kind === 'sso' && (
        <SsoDomainsDialog company={dialog.company} onClose={() => setDialog(null)} onDone={finished} />
      )}
    </div>
  )
}

function DetailBody({ data, period, onPeriod, open, onCopyLink, loading, onRefresh, onBilling }: {
  data: ClientDetail
  period: PlatformPeriod
  onPeriod: (p: PlatformPeriod) => void
  open: (d: Dialog) => void
  onCopyLink: (company: CompanyRow) => void
  loading: boolean
  onRefresh: () => void
  onBilling: (message: string, tone?: ToastTone) => void
}) {
  const { client, companies } = data
  const suspended = client.status !== 'active'
  const activityTotal = data.activity.reduce((sum, d) => sum + d.count, 0)
  const hasFeatureUsage = data.features.some(f => f.total > 0)
  const hasCompanies = companies.length > 0

  return (
    <>
      <div className="pco-header">
        <div className="pco-detail-id">
          <h1 className="pco-title">{client.name}</h1>
          <StatusBadge status={client.status} />
          {client.plan?.name && <span className="pco-chip">{client.plan.name}</span>}
        </div>
        <div className="pco-header-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => open({ kind: 'client-edit' })}>Edit client</button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={hasCompanies}
            title={hasCompanies ? 'Delete its companies first.' : undefined}
            onClick={() => open({ kind: 'client-delete' })}
          >
            Delete client
          </button>
          <button
            type="button"
            className={`btn btn-sm ${suspended ? 'btn-primary' : 'btn-danger'}`}
            onClick={() => open({ kind: 'client-status' })}
          >
            {suspended ? 'Activate client' : 'Suspend client'}
          </button>
        </div>
      </div>

      {suspended && client.suspended_reason && (
        <div className="pco-suspended-reason">Suspended: {client.suspended_reason}</div>
      )}

      {(client.contact_name || client.contact_email) && (
        <div className="pco-contact">
          {client.contact_name && <span>{client.contact_name}</span>}
          {client.contact_email && <a href={`mailto:${client.contact_email}`}>{client.contact_email}</a>}
        </div>
      )}

      <div className="pco-period-row">
        <PeriodSelect value={period} onChange={onPeriod} />
        <div className="pco-header-actions">
          <PeriodRange period={data.period} />
          <AsOf at={data.computed_at} loading={loading} onRefresh={onRefresh} />
        </div>
      </div>

      <section className="pco-kpis-more" aria-label="Totals">
        {[
          ['Companies', fmtInt(client.companies)],
          ['Users', fmtInt(client.users)],
          ['Active users', fmtInt(client.active_users)],
          ['Total cost', fmtUsd(client.total_cost_usd)],
          ...costBreakdownTiles(client),
          ['AI calls', fmtInt(client.ai_calls)],
          ['Storage', fmtMb(client.storage_mb)],
          ['Last active', fmtWhen(client.last_active_at)],
          ['Created', fmtDate(client.created_at)],
        ].map(([label, value]) => (
          <div key={label} className="pco-kpi pco-kpi-small">
            <span className="pco-kpi-label">{label}</span>
            <div className="pco-kpi-row"><span className="pco-kpi-value">{value}</span></div>
          </div>
        ))}
      </section>

      <BillingPanel client={client} onChanged={onBilling} />

      <section className="pco-card" aria-labelledby="pco-cd-companies">
        <div className="pco-card-head">
          <h2 className="pco-card-title" id="pco-cd-companies">Companies</h2>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => open({ kind: 'add-company' })}>Add company</button>
        </div>
        {companies.length === 0 ? (
          <EmptyState>This client has no companies yet.</EmptyState>
        ) : (
          <div className="pco-table-wrap">
            <table className="pco-table">
              <thead>
                <tr>
                  <th scope="col">Company</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="pco-num">Users</th>
                  <th scope="col" className="pco-num">Last active</th>
                  <th scope="col" className="pco-num">Total cost</th>
                  <th scope="col" className="pco-num">Storage</th>
                  <th scope="col">Administrators</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {companies.map(c => (
                  <tr key={c.company_id}>
                    <th scope="row">
                      <Link to={`/platform/companies/${encodeURIComponent(c.company_id)}`} className="pco-name">{c.name}</Link>
                      <span className="pco-cell-meta">/{c.slug}</span>
                      {c.sso_domains.length > 0 && <span className="pco-cell-meta">SSO: {c.sso_domains.join(', ')}</span>}
                    </th>
                    <td>
                      <StatusBadge status={c.status} />
                      {c.status !== 'active' && c.suspended_reason && (
                        <span className="pco-cell-meta pco-reason">{c.suspended_reason}</span>
                      )}
                    </td>
                    <td className="pco-num">{fmtInt(c.active_users)} / {fmtInt(c.users)}</td>
                    <td className="pco-num">{fmtWhen(c.last_active_at)}</td>
                    <td className="pco-num">{fmtUsd(c.total_cost_usd)}</td>
                    <td className="pco-num">{fmtStorage(c.storage_mb, c.storage_limit_mb)}</td>
                    <td>
                      {c.admins.length === 0
                        ? '-'
                        : c.admins.map(a => <span key={a.email} className="pco-cell-meta pco-admin">{a.email}</span>)}
                    </td>
                    <td>
                      <div className="pco-actions">
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onCopyLink(c)}>Copy sign-in link</button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => open({ kind: 'add-admin', company: c })}>Add admin</button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => open({ kind: 'reset-password', company: c })}>Reset password</button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => open({ kind: 'sso', company: c })}>SSO domains</button>
                        <button
                          type="button"
                          className={`btn btn-sm ${c.status === 'active' ? 'btn-danger' : 'btn-primary'}`}
                          onClick={() => open({ kind: 'company-status', company: c })}
                        >
                          {c.status === 'active' ? 'Suspend' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="pco-grid-2">
        <section className="pco-card" aria-labelledby="pco-cd-features">
          <div className="pco-card-head"><h2 className="pco-card-title" id="pco-cd-features">Feature usage</h2></div>
          {hasFeatureUsage ? <FeatureBars rows={data.features} /> : <EmptyState>No feature has been used yet.</EmptyState>}
        </section>

        <section className="pco-card" aria-labelledby="pco-cd-cost">
          <div className="pco-card-head"><h2 className="pco-card-title" id="pco-cd-cost">Cost by source</h2></div>
          {data.cost_by_source.length === 0 ? <EmptyState>No AI spend yet.</EmptyState> : <CostBars rows={data.cost_by_source} />}
        </section>
      </div>

      <section className="pco-card" aria-labelledby="pco-cd-activity">
        <div className="pco-card-head"><h2 className="pco-card-title" id="pco-cd-activity">Daily activity</h2></div>
        {data.activity.length === 0 || activityTotal === 0
          ? <EmptyState>No activity in this period.</EmptyState>
          : <DailyBars days={data.activity} />}
      </section>
    </>
  )
}
