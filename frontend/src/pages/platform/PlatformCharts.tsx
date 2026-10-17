import { Link } from 'react-router-dom'
import type { ActivityDay, CostBySource, GrowthPoint } from '../../lib/platformTypes'
import { dayLabel, fmtInt, fmtUsd, monthLabel, monthShort } from './format'
import './PlatformCharts.css'

export interface FeatureBarRow {
  key: string
  label: string
  total: number
  window: number
  top_client?: { client_id: string; name: string; count: number } | null
}

export function FeatureBars({ rows, windowDays, showTopClient }: {
  rows: FeatureBarRow[]
  windowDays?: number
  showTopClient?: boolean
}) {
  const max = Math.max(1, ...rows.map(r => Math.max(r.total, r.window)))
  const pct = (v: number) => (v <= 0 ? 0 : Math.max((v / max) * 100, 1.5))
  const windowName = windowDays ? `Last ${windowDays} days` : 'Recent'

  return (
    <div className="pco-fbars">
      <div className="pco-legend" aria-hidden>
        <span className="pco-legend-item"><i className="pco-swatch pco-swatch-window" />{windowName}</span>
        <span className="pco-legend-item"><i className="pco-swatch pco-swatch-total" />All time</span>
      </div>
      <ul className="pco-fbar-list">
        {rows.map(r => (
          <li key={r.key} className={`pco-fbar${showTopClient ? ' pco-fbar-top-col' : ''}`}>
            <span className="pco-fbar-label">{r.label}</span>
            <div
              className="pco-fbar-bars"
              role="img"
              aria-label={`${r.label}: ${fmtInt(r.window)} ${windowDays ? `in the last ${windowDays} days` : 'recently'}, ${fmtInt(r.total)} in total`}
            >
              <div className="pco-fbar-total" style={{ width: `${pct(r.total)}%` }} />
              <div className="pco-fbar-window" style={{ width: `${pct(r.window)}%` }} />
            </div>
            <span className="pco-fbar-nums"><b>{fmtInt(r.window)}</b> / {fmtInt(r.total)}</span>
            {showTopClient && (
              <span className="pco-fbar-client">
                {r.top_client
                  ? (
                    <>
                      <Link to={`/platform/clients/${encodeURIComponent(r.top_client.client_id)}`} className="pco-name">{r.top_client.name}</Link>
                      <span className="pco-fbar-client-count">{fmtInt(r.top_client.count)}</span>
                    </>
                  )
                  : '-'}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function niceMax(v: number): number {
  if (v <= 4) return 4
  const pow = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 2, 4, 8, 10]) if (v <= m * pow) return m * pow
  return 10 * pow
}

export function GrowthChart({ points }: { points: GrowthPoint[] }) {
  const W = 640
  const H = 240
  const L = 40
  const R = 16
  const T = 14
  const B = 30
  const top = niceMax(Math.max(1, ...points.flatMap(p => [p.clients, p.companies])))
  const x = (i: number) => (points.length === 1 ? (L + W - R) / 2 : L + (i / (points.length - 1)) * (W - L - R))
  const y = (v: number) => T + (1 - v / top) * (H - T - B)
  const line = (pick: (p: GrowthPoint) => number) => points.map((p, i) => `${x(i).toFixed(1)},${y(pick(p)).toFixed(1)}`).join(' ')
  const step = Math.max(1, Math.ceil(points.length / 6))
  const first = points[0]
  const last = points[points.length - 1]

  return (
    <figure className="pco-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="pco-chart-svg"
        role="img"
        aria-label={`Clients and companies per month, ${monthLabel(first.month)} to ${monthLabel(last.month)}. Clients went from ${first.clients} to ${last.clients}, companies from ${first.companies} to ${last.companies}.`}
      >
        {[0, top / 2, top].map(v => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="pco-grid-line" />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" className="pco-axis-text">{fmtInt(v)}</text>
          </g>
        ))}
        {points.map((p, i) => (i % step === 0 || i === points.length - 1) && (
          <text key={p.month} x={x(i)} y={H - 10} textAnchor="middle" className="pco-axis-text">{monthShort(p.month)}</text>
        ))}
        <polyline points={line(p => p.companies)} className="pco-line pco-line-companies" fill="none" />
        <polyline points={line(p => p.clients)} className="pco-line pco-line-clients" fill="none" />
        {points.map((p, i) => (
          <g key={p.month}>
            <circle cx={x(i)} cy={y(p.companies)} r="3.5" className="pco-dot-companies">
              <title>{`${monthLabel(p.month)}: ${p.companies} companies`}</title>
            </circle>
            <rect x={x(i) - 3.5} y={y(p.clients) - 3.5} width="7" height="7" className="pco-dot-clients">
              <title>{`${monthLabel(p.month)}: ${p.clients} clients`}</title>
            </rect>
          </g>
        ))}
      </svg>
      <div className="pco-legend" aria-hidden>
        <span className="pco-legend-item"><i className="pco-swatch pco-swatch-line-clients" />Clients</span>
        <span className="pco-legend-item"><i className="pco-swatch pco-swatch-line-companies" />Companies</span>
      </div>
      <div className="pco-sr">
        <table>
          <caption>Clients and companies per month</caption>
          <thead><tr><th scope="col">Month</th><th scope="col">Clients</th><th scope="col">Companies</th></tr></thead>
          <tbody>
            {points.map(p => (
              <tr key={p.month}><th scope="row">{monthLabel(p.month)}</th><td>{p.clients}</td><td>{p.companies}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  )
}

export function DailyBars({ days }: { days: ActivityDay[] }) {
  const W = 640
  const H = 170
  const L = 40
  const R = 8
  const T = 12
  const B = 26
  const peak = days.reduce((best, d) => (d.count > best.count ? d : best), days[0])
  const total = days.reduce((sum, d) => sum + d.count, 0)
  const top = niceMax(Math.max(1, peak.count))
  const slot = (W - L - R) / days.length
  const barW = Math.max(1.5, slot * 0.7)
  const y = (v: number) => T + (1 - v / top) * (H - T - B)
  const labelAt = new Set([0, Math.floor((days.length - 1) / 2), days.length - 1])

  return (
    <figure className="pco-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="pco-chart-svg"
        role="img"
        aria-label={`Daily activity over ${days.length} days: ${fmtInt(total)} events in all. The busiest day was ${dayLabel(peak.date)} with ${fmtInt(peak.count)}.`}
      >
        {[0, top / 2, top].map(v => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="pco-grid-line" />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" className="pco-axis-text">{fmtInt(v)}</text>
          </g>
        ))}
        {days.map((d, i) => {
          const h = Math.max(d.count > 0 ? 1.5 : 0, y(0) - y(d.count))
          return (
            <rect key={d.date} x={L + i * slot + (slot - barW) / 2} y={y(0) - h} width={barW} height={h} rx="1.5" className="pco-day-bar">
              <title>{`${dayLabel(d.date)}: ${fmtInt(d.count)}`}</title>
            </rect>
          )
        })}
        {days.map((d, i) => labelAt.has(i) && (
          <text key={`l-${d.date}`} x={L + i * slot + slot / 2} y={H - 8} textAnchor="middle" className="pco-axis-text">{dayLabel(d.date)}</text>
        ))}
      </svg>
    </figure>
  )
}

const callsLabel = (n: number, unit?: 'emails') => {
  const [one, many] = unit === 'emails' ? ['email', 'emails'] : ['call', 'calls']
  return `${fmtInt(n)} ${n === 1 ? one : many}`
}

const sourceLabel = (source: string) => (source === 'email_estimated' ? 'email (estimated)' : source.replace(/_/g, ' '))

export function CostBars({ rows }: { rows: CostBySource[] }) {
  const max = Math.max(...rows.map(r => r.cost_usd), 0)
  return (
    <ul className="pco-cost-list">
      {rows.map(r => (
        <li key={r.source} className="pco-cost-row">
          <span className="pco-cost-source">{sourceLabel(r.source)}</span>
          <div
            className="pco-cost-track"
            role="img"
            aria-label={`${sourceLabel(r.source)}: ${fmtUsd(r.cost_usd)} over ${callsLabel(r.calls, r.unit)}`}
          >
            <div className="pco-cost-fill" style={{ width: `${max > 0 ? Math.max((r.cost_usd / max) * 100, 2) : 0}%` }} />
          </div>
          <span className="pco-cost-nums"><b>{fmtUsd(r.cost_usd)}</b><span className="pco-cost-calls">{callsLabel(r.calls, r.unit)}</span></span>
        </li>
      ))}
    </ul>
  )
}
