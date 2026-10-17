import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { platformApi } from '../../lib/api'
import type { CompanyDetail, PlatformPeriod } from '../../lib/platformTypes'
import CompanyAiCard from './CompanyAiCard'
import { AddAdminDialog, RenameCompanyDialog, ResetPasswordDialog, SsoDomainsDialog } from './CompanyDialogs'
import CustomDomainsCard from './CustomDomainsCard'
import { DeleteCompanyDialog } from './DeleteDialogs'
import { CostBars, DailyBars, FeatureBars } from './PlatformCharts'
import {
  AsOf, EmptyState, ErrorState, LoadingState, PeriodRange, PeriodSelect, StatusBadge, useToast, type ToastTone,
} from './PlatformUi'
import { CompanyStatusDialog } from './StatusDialogs'
import { costBreakdownTiles, fmtDate, fmtInt, fmtStorage, fmtUsd, fmtWhen } from './format'
import { useForceRefresh, useLoaded, usePlatformPeriod } from './usePlatformData'
import './PlatformClientDetailPage.css'
import './PlatformCompanyDetailPage.css'

type Dialog = 'rename' | 'status' | 'add-admin' | 'reset-password' | 'sso' | 'delete'

export default function PlatformCompanyDetailPage() {
  const { companyId = '' } = useParams<{ companyId: string }>()
  const navigate = useNavigate()
  const [period, setPeriod] = usePlatformPeriod()
  const { toast, showToast } = useToast()
  const { take, mark } = useForceRefresh()
  const { data, loading, error, status, reload } = useLoaded(
    () => {
      const fresh = take()
      return (fresh ? platformApi.getCompany(companyId, period, fresh) : platformApi.getCompany(companyId, period)).then(r => r.data)
    },
    [companyId, period],
    'Could not load this company.',
  )
  const [dialog, setDialog] = useState<Dialog | null>(null)

  async function copySignInLink(slug: string, name: string) {
    const url = `${window.location.origin}/login?company=${encodeURIComponent(slug)}`
    try {
      await navigator.clipboard.writeText(url)
      showToast(`Sign-in link for ${name} copied`)
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
      {data
        ? <Link to={`/platform/clients/${encodeURIComponent(data.company.client_id)}`} className="pco-back">{data.company.client_name}</Link>
        : <Link to="/platform/clients" className="pco-back">All clients</Link>}

      {!data && loading && <LoadingState label="Loading the company…" />}
      {!data && !loading && status === 404 && <EmptyState>This company does not exist.</EmptyState>}
      {!data && !loading && error && status !== 404 && <ErrorState message={error} onRetry={reload} />}
      {data && error && <ErrorState message={error} onRetry={reload} />}

      {data && (
        <CompanyBody
          data={data}
          period={period}
          onPeriod={setPeriod}
          open={setDialog}
          onCopyLink={() => void copySignInLink(data.company.slug, data.company.name)}
          loading={loading}
          onRefresh={() => { mark(); reload() }}
          onDomains={message => showToast(message)}
        />
      )}

      {data && dialog === 'rename' && (
        <RenameCompanyDialog company={data.company} onClose={() => setDialog(null)} onDone={finished} />
      )}
      {data && dialog === 'status' && (
        <CompanyStatusDialog company={data.company} onClose={() => setDialog(null)} onDone={finished} />
      )}
      {data && dialog === 'add-admin' && (
        <AddAdminDialog company={data.company} onClose={() => setDialog(null)} onDone={finished} />
      )}
      {data && dialog === 'reset-password' && (
        <ResetPasswordDialog company={data.company} onClose={() => setDialog(null)} onDone={finished} />
      )}
      {data && dialog === 'sso' && (
        <SsoDomainsDialog company={data.company} onClose={() => setDialog(null)} onDone={finished} />
      )}
      {data && dialog === 'delete' && (
        <DeleteCompanyDialog
          company={data.company}
          onClose={() => setDialog(null)}
          onDone={() => navigate(`/platform/clients/${encodeURIComponent(data.company.client_id)}`, {
            replace: true,
            state: { notice: `${data.company.name} deleted` },
          })}
        />
      )}
    </div>
  )
}

function CompanyBody({ data, period, onPeriod, open, onCopyLink, loading, onRefresh, onDomains }: {
  data: CompanyDetail
  period: PlatformPeriod
  onPeriod: (p: PlatformPeriod) => void
  open: (d: Dialog) => void
  onCopyLink: () => void
  loading: boolean
  onRefresh: () => void
  onDomains: (message: string) => void
}) {
  const { company } = data
  const suspended = company.status !== 'active'
  const activityTotal = data.activity.reduce((sum, d) => sum + d.count, 0)
  const hasFeatureUsage = data.features.some(f => f.total > 0)

  return (
    <>
      <div className="pco-header">
        <div className="pco-detail-id">
          <h1 className="pco-title">{company.name}</h1>
          <StatusBadge status={company.status} />
          <span className="pco-chip">/{company.slug}</span>
        </div>
        <div className="pco-header-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => open('rename')}>Rename</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCopyLink}>Copy sign-in link</button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={!suspended}
            title={suspended ? undefined : 'Suspend the company first.'}
            onClick={() => open('delete')}
          >
            Delete company
          </button>
          <button
            type="button"
            className={`btn btn-sm ${suspended ? 'btn-primary' : 'btn-danger'}`}
            onClick={() => open('status')}
          >
            {suspended ? 'Activate company' : 'Suspend company'}
          </button>
        </div>
      </div>

      {suspended && company.suspended_reason && (
        <div className="pco-suspended-reason">Suspended: {company.suspended_reason}</div>
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
          ['Users', fmtInt(company.users)],
          ['Active users', fmtInt(company.active_users)],
          ['Total cost', fmtUsd(company.total_cost_usd)],
          ...costBreakdownTiles(company),
          ['AI calls', fmtInt(company.ai_calls)],
          ['Storage', fmtStorage(company.storage_mb, company.storage_limit_mb)],
          ['Last active', fmtWhen(company.last_active_at)],
          ['Created', fmtDate(company.created_at)],
        ].map(([label, value]) => (
          <div key={label} className="pco-kpi pco-kpi-small">
            <span className="pco-kpi-label">{label}</span>
            <div className="pco-kpi-row"><span className="pco-kpi-value">{value}</span></div>
          </div>
        ))}
      </section>

      <div className="pco-grid-2">
        <section className="pco-card" aria-labelledby="pco-co-admins">
          <div className="pco-card-head">
            <h2 className="pco-card-title" id="pco-co-admins">Administrators</h2>
            <div className="pco-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => open('reset-password')}>Reset password</button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => open('add-admin')}>Add admin</button>
            </div>
          </div>
          {company.admins.length === 0 ? (
            <EmptyState>This company has no administrators.</EmptyState>
          ) : (
            <ul className="pco-people">
              {company.admins.map(a => (
                <li key={a.email} className="pco-person">
                  <span className="pco-name">{a.name || a.email}</span>
                  {a.name && <span className="pco-cell-meta">{a.email}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="pco-card" aria-labelledby="pco-co-sso">
          <div className="pco-card-head">
            <h2 className="pco-card-title" id="pco-co-sso">SSO domains</h2>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => open('sso')}>Edit domains</button>
          </div>
          {company.sso_domains.length === 0 ? (
            <EmptyState>No domain is set.</EmptyState>
          ) : (
            <ul className="pco-domains">
              {company.sso_domains.map(d => <li key={d} className="pco-chip">{d}</li>)}
            </ul>
          )}
        </section>
      </div>

      <CustomDomainsCard companyId={company.company_id} companyName={company.name} onSaved={onDomains} />

      <div className="pco-grid-2">
        <section className="pco-card" aria-labelledby="pco-co-features">
          <div className="pco-card-head"><h2 className="pco-card-title" id="pco-co-features">Usage by feature</h2></div>
          {hasFeatureUsage ? <FeatureBars rows={data.features} /> : <EmptyState>No feature has been used yet.</EmptyState>}
        </section>

        <section className="pco-card" aria-labelledby="pco-co-cost">
          <div className="pco-card-head"><h2 className="pco-card-title" id="pco-co-cost">Cost by source</h2></div>
          {data.cost_by_source.length === 0 ? <EmptyState>No AI spend yet.</EmptyState> : <CostBars rows={data.cost_by_source} />}
        </section>
      </div>

      {data.ai && <CompanyAiCard ai={data.ai} />}

      <section className="pco-card" aria-labelledby="pco-co-activity">
        <div className="pco-card-head"><h2 className="pco-card-title" id="pco-co-activity">Daily activity</h2></div>
        {data.activity.length === 0 || activityTotal === 0
          ? <EmptyState>No activity in this period.</EmptyState>
          : <DailyBars days={data.activity} />}
      </section>
    </>
  )
}
