import { Link } from 'react-router-dom'
import { platformApi } from '../../lib/api'
import type { HealthCronJob, PlatformHealth } from '../../lib/platformTypes'
import { EmptyState, ErrorState, LoadingState } from './PlatformUi'
import { actionLabel, fmtInt, fmtWhen } from './format'
import { useLoaded } from './usePlatformData'
import './PlatformHealthPage.css'

type Tone = 'good' | 'bad' | 'plain'

const TONE_BADGE: Record<Tone, string> = { good: 'badge-green', bad: 'badge-red', plain: 'badge-gray' }

function Pill({ tone, children }: { tone: Tone; children: string }) {
  return (
    <span className={`badge pco-status ${TONE_BADGE[tone]}`}>
      <span className="pco-status-dot" aria-hidden>{tone === 'good' ? '●' : tone === 'bad' ? '▲' : '○'}</span>
      {children}
    </span>
  )
}

function cronTone(status: string | null): Tone {
  const s = (status ?? '').toLowerCase()
  if (['ok', 'success', 'succeeded', 'complete', 'completed', 'done'].includes(s)) return 'good'
  if (['error', 'failed', 'failure', 'partial'].includes(s)) return 'bad'
  return 'plain'
}

function HealthTile({ label, children, meta }: { label: string; children: React.ReactNode; meta?: string }) {
  return (
    <div className="pco-kpi">
      <span className="pco-kpi-label">{label}</span>
      <div className="pco-kpi-row">{children}</div>
      {meta && <span className="pco-cell-meta">{meta}</span>}
    </div>
  )
}

function served(job: HealthCronJob): string {
  if (job.companies_served === null || job.companies_total === null) return '-'
  return `${fmtInt(job.companies_served)} of ${fmtInt(job.companies_total)}`
}

export default function PlatformHealthPage() {
  const { data, loading, error, reload } = useLoaded(
    () => platformApi.health().then(r => r.data),
    [],
    'Could not load the platform health.',
  )

  return (
    <div className="pco-page" aria-busy={loading}>
      <div className="pco-header">
        <h1 className="pco-title">Platform health</h1>
        <button type="button" className="btn btn-ghost btn-sm" onClick={reload} disabled={loading}>
          {loading && data ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {!data && loading && <LoadingState label="Loading the health checks…" />}
      {!data && !loading && error && <ErrorState message={error} onRetry={reload} />}
      {data && error && <ErrorState message={error} onRetry={reload} />}

      {data && <HealthBody data={data} />}
    </div>
  )
}

function HealthBody({ data }: { data: PlatformHealth }) {
  const { mongo, email, pinecone, cron, failed_emails_24h: failed } = data

  return (
    <>
      <section className="pco-hl-tiles" aria-label="Services">
        <HealthTile label="MongoDB" meta={mongo.ok && mongo.latency_ms !== null ? `${fmtInt(Math.round(mongo.latency_ms))} ms` : undefined}>
          <Pill tone={mongo.ok ? 'good' : 'bad'}>{mongo.ok ? 'Connected' : 'Unreachable'}</Pill>
        </HealthTile>
        <HealthTile label="Email" meta={email.configured && email.provider ? email.provider : undefined}>
          <Pill tone={email.configured ? 'good' : 'bad'}>{email.configured ? 'Configured' : 'Not configured'}</Pill>
        </HealthTile>
        <HealthTile label="Pinecone">
          <Pill tone={pinecone.configured ? 'good' : 'bad'}>{pinecone.configured ? 'Configured' : 'Not configured'}</Pill>
        </HealthTile>
      </section>

      <section className="pco-card" aria-labelledby="pco-hl-cron">
        <div className="pco-card-head"><h2 className="pco-card-title" id="pco-hl-cron">Scheduled jobs</h2></div>
        {cron.length === 0 ? (
          <EmptyState>No scheduled job has run yet.</EmptyState>
        ) : (
          <div className="pco-table-wrap">
            <table className="pco-table">
              <thead>
                <tr>
                  <th scope="col">Job</th>
                  <th scope="col">Last run</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="pco-num">Companies served</th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {cron.map(job => (
                  <tr key={job.key}>
                    <th scope="row"><span className="pco-name">{actionLabel(job.key)}</span></th>
                    <td>
                      {job.last_run_at
                        ? <time dateTime={job.last_run_at} title={job.last_run_at}>{fmtWhen(job.last_run_at)}</time>
                        : 'Never'}
                    </td>
                    <td>{job.status ? <Pill tone={cronTone(job.status)}>{actionLabel(job.status)}</Pill> : '-'}</td>
                    <td className="pco-num">
                      {served(job)}
                      {!!job.companies_failed && <span className="pco-cell-meta pco-reason">{fmtInt(job.companies_failed)} failed</span>}
                    </td>
                    <td className="pco-hl-detail">{job.detail || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="pco-card" aria-labelledby="pco-hl-failed">
        <div className="pco-card-head"><h2 className="pco-card-title" id="pco-hl-failed">Failed emails, last 24 hours</h2></div>
        {failed.length === 0 ? (
          <EmptyState>No email failed in the last 24 hours.</EmptyState>
        ) : (
          <div className="pco-table-wrap">
            <table className="pco-table">
              <thead>
                <tr>
                  <th scope="col">Company</th>
                  <th scope="col">Client</th>
                  <th scope="col" className="pco-num">Failed</th>
                </tr>
              </thead>
              <tbody>
                {failed.map(row => (
                  <tr key={row.company_id}>
                    <th scope="row">
                      <Link to={`/platform/companies/${encodeURIComponent(row.company_id)}`} className="pco-name">{row.company_name}</Link>
                    </th>
                    <td>{row.client_name}</td>
                    <td className="pco-num">{fmtInt(row.failed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
