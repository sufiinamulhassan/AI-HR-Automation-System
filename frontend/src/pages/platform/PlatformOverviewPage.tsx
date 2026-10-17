import { Link } from 'react-router-dom'
import { platformApi } from '../../lib/api'
import type { PlatformOverview } from '../../lib/platformTypes'
import { FeatureBars, GrowthChart } from './PlatformCharts'
import { AsOf, EmptyState, ErrorState, LoadingState, PeriodRange, PeriodSelect } from './PlatformUi'
import { actionLabel, costBreakdownTiles, fmtInt, fmtUsd, fmtWhen } from './format'
import { useForceRefresh, useLoaded, usePlatformPeriod } from './usePlatformData'
import './PlatformOverviewPage.css'

const MORE_TILES: { key: keyof PlatformOverview['totals']; label: string }[] = [
  { key: 'users', label: 'Users' },
  { key: 'jobs', label: 'Jobs' },
  { key: 'resumes', label: 'Resumes' },
  { key: 'candidates', label: 'Candidates' },
  { key: 'interviews', label: 'Interviews' },
  { key: 'coding', label: 'Coding assessments' },
  { key: 'offers', label: 'Offers' },
  { key: 'performance', label: 'Performance reviews' },
  { key: 'emails', label: 'Emails' },
  { key: 'ai_calls', label: 'AI calls' },
]

function detailLine(row: PlatformOverview['recent'][number]): string {
  const target = [row.resource_type, row.resource_id].filter(Boolean).join(' ')
  const name = typeof row.details?.name === 'string' ? row.details.name : ''
  return [name, target].filter(Boolean).join(' · ')
}

export default function PlatformOverviewPage() {
  const [period, setPeriod] = usePlatformPeriod()
  const { take, mark } = useForceRefresh()
  const { data, loading, error, reload } = useLoaded(
    () => {
      const fresh = take()
      return (fresh ? platformApi.overview(period, fresh) : platformApi.overview(period)).then(r => r.data)
    },
    [period],
    'Could not load the platform overview.',
  )

  return (
    <div className="pco-page" aria-busy={loading}>
      <div className="pco-header">
        <h1 className="pco-title">Platform overview</h1>
        <div className="pco-header-actions">
          <PeriodSelect value={period} onChange={setPeriod} />
          <AsOf at={data?.computed_at} loading={loading} onRefresh={() => { mark(); reload() }} />
        </div>
      </div>
      {data && <PeriodRange period={data.period} />}

      {!data && loading && <LoadingState label="Loading the overview…" />}
      {!data && !loading && error && <ErrorState message={error} onRetry={reload} />}
      {data && error && <ErrorState message={error} onRetry={reload} />}

      {data && <OverviewBody data={data} />}
    </div>
  )
}

function OverviewBody({ data }: { data: PlatformOverview }) {
  const t = data.totals
  const maxActivity = Math.max(1, ...data.top_clients.map(c => c.activity))
  const hasFeatureUsage = data.features.some(f => f.total > 0)
  const windowDays = data.period?.kind === 'month' ? undefined : data.window_days

  return (
    <>
      <section className="pco-kpis-main" aria-label="Headline numbers">
        <div className="pco-kpi">
          <span className="pco-kpi-label">Clients</span>
          <div className="pco-kpi-row"><span className="pco-kpi-value">{fmtInt(t.clients)}</span></div>
        </div>
        <div className="pco-kpi">
          <span className="pco-kpi-label">Companies</span>
          <div className="pco-kpi-row">
            <span className="pco-kpi-value">{fmtInt(t.companies)}</span>
            <span className="pco-kpi-badge">{fmtInt(t.active_companies)} active</span>
            {t.suspended_companies > 0 && (
              <span className="pco-kpi-badge pco-kpi-badge-warn">{fmtInt(t.suspended_companies)} suspended</span>
            )}
          </div>
        </div>
        <div className="pco-kpi">
          <span className="pco-kpi-label">Active users</span>
          <div className="pco-kpi-row">
            <span className="pco-kpi-value">{fmtInt(t.active_users)}</span>
            <span className="pco-kpi-badge">of {fmtInt(t.users)} users</span>
          </div>
        </div>
        <div className="pco-kpi">
          <span className="pco-kpi-label">Total cost</span>
          <div className="pco-kpi-row"><span className="pco-kpi-value">{fmtUsd(t.total_cost_usd)}</span></div>
        </div>
      </section>

      <section className="pco-kpis-more" aria-label="Totals">
        {MORE_TILES.map(tile => (
          <div key={tile.key} className="pco-kpi pco-kpi-small">
            <span className="pco-kpi-label">{tile.label}</span>
            <div className="pco-kpi-row"><span className="pco-kpi-value">{fmtInt(t[tile.key])}</span></div>
          </div>
        ))}
        {costBreakdownTiles(t).map(([label, value]) => (
          <div key={label} className="pco-kpi pco-kpi-small">
            <span className="pco-kpi-label">{label}</span>
            <div className="pco-kpi-row"><span className="pco-kpi-value">{value}</span></div>
          </div>
        ))}
      </section>

      <div className="pco-grid-wide">
        <section className="pco-card" aria-labelledby="pco-ov-features">
          <div className="pco-card-head"><h2 className="pco-card-title" id="pco-ov-features">Feature usage</h2></div>
          {hasFeatureUsage
            ? <FeatureBars rows={data.features} windowDays={windowDays} showTopClient />
            : <EmptyState>No feature has been used yet.</EmptyState>}
        </section>

        <section className="pco-card" aria-labelledby="pco-ov-top">
          <div className="pco-card-head"><h2 className="pco-card-title" id="pco-ov-top">Top clients</h2></div>
          {data.top_clients.length === 0 ? (
            <EmptyState>No client activity in this window.</EmptyState>
          ) : (
            <ol className="pco-top-list">
              {data.top_clients.map((c, i) => (
                <li key={c.client_id} className="pco-top-row">
                  <span className="pco-top-rank" aria-hidden>{i + 1}</span>
                  <div className="pco-top-main">
                    <Link to={`/platform/clients/${encodeURIComponent(c.client_id)}`} className="pco-name">{c.name}</Link>
                    <span className="pco-cell-meta">
                      {fmtInt(c.companies)} {c.companies === 1 ? 'company' : 'companies'} · {fmtInt(c.active_users)} of {fmtInt(c.users)} users active · {fmtUsd(c.total_cost_usd)}
                    </span>
                    <div
                      className="pco-top-track"
                      role="img"
                      aria-label={`${c.name}: ${fmtInt(c.activity)} events ${windowDays ? `in the last ${windowDays} days` : 'in this period'}`}
                    >
                      <div className="pco-top-fill" style={{ width: `${Math.max((c.activity / maxActivity) * 100, c.activity > 0 ? 2 : 0)}%` }} />
                    </div>
                  </div>
                  <span className="pco-top-activity">{fmtInt(c.activity)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <div className="pco-grid-2">
        <section className="pco-card" aria-labelledby="pco-ov-growth">
          <div className="pco-card-head"><h2 className="pco-card-title" id="pco-ov-growth">Growth</h2></div>
          {data.growth.length === 0 ? <EmptyState>No growth data yet.</EmptyState> : <GrowthChart points={data.growth} />}
        </section>

        <section className="pco-card" aria-labelledby="pco-ov-recent">
          <div className="pco-card-head"><h2 className="pco-card-title" id="pco-ov-recent">Recent platform activity</h2></div>
          {data.recent.length === 0 ? (
            <EmptyState>No platform activity yet.</EmptyState>
          ) : (
            <ul className="pco-recent-list">
              {data.recent.map((row, i) => (
                <li key={`${row.at}-${i}`} className="pco-recent-row">
                  <div className="pco-recent-main">
                    <span className="pco-recent-action">{actionLabel(row.action)}</span>
                    {detailLine(row) && <span className="pco-cell-meta">{detailLine(row)}</span>}
                  </div>
                  <div className="pco-recent-who">
                    <span>{row.actor_email || '-'}</span>
                    <time dateTime={row.at} className="pco-cell-meta">{fmtWhen(row.at)}</time>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  )
}
