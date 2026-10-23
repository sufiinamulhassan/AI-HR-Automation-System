import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

export const SERIES = ['var(--hr-series-1)', 'var(--hr-series-2)']

export interface LinePoint {
  label: string
  value: number | null
}

export interface BarGroup {
  label: string
  values: number[]
}

export interface BarRow {
  label: string
  value: number
  detail?: string
}

function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => { if (el.clientWidth > 0) setWidth(el.clientWidth) }
    read()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(read)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return { ref, width }
}

function niceMax(value: number): number {
  if (value <= 0) return 1
  const power = 10 ** Math.floor(Math.log10(value))
  const step = [1, 2, 2.5, 5, 10].find(s => s * power >= value) ?? 10
  return step * power
}

function ticks(max: number, whole = false): number[] {
  const count = whole ? ([4, 5, 3, 2, 1].find(c => Number.isInteger(max / c)) ?? 4) : 4
  return Array.from({ length: count + 1 }, (_, i) => (max / count) * i)
}

function fmt(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

interface CardProps {
  title: string
  subtitle?: string
  legend?: { label: string; color: string }[]
  table: { columns: string[]; rows: (string | number)[][] }
  empty?: string
  children: ReactNode
}

export function ChartCard({ title, subtitle, legend, table, empty, children }: CardProps) {
  const [showTable, setShowTable] = useState(false)
  const titleId = useId()
  return (
    <section className="card hr-card hr-chart-card" aria-labelledby={titleId}>
      <div className="hr-chart-head">
        <div>
          <h3 className="hr-card-title hr-chart-title" id={titleId}>{title}</h3>
          {subtitle && <p className="hr-muted">{subtitle}</p>}
        </div>
        {!empty && (
          <button type="button" className="hr-link-btn" aria-pressed={showTable} onClick={() => setShowTable(v => !v)}>
            {showTable ? 'Show chart' : 'Show table'}
          </button>
        )}
      </div>
      {legend && legend.length > 1 && !empty && (
        <ul className="hr-legend" aria-label={`${title} legend`}>
          {legend.map(l => (
            <li key={l.label}><span className="hr-legend-swatch" style={{ background: l.color }} aria-hidden="true" />{l.label}</li>
          ))}
        </ul>
      )}
      {empty ? <p className="hr-muted hr-chart-empty">{empty}</p> : showTable ? (
        <div className="hr-table-wrap">
          <table className="hr-table">
            <thead><tr>{table.columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j}>{typeof v === 'number' ? fmt(v) : v}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : children}
    </section>
  )
}

interface Tip { x: number; y: number; lines: [string, string][]; heading: string }

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null
  return (
    <div className="hr-tip" role="status" style={{ left: tip.x, top: tip.y }}>
      <div className="hr-tip-head">{tip.heading}</div>
      {tip.lines.map(([label, value]) => (
        <div key={label} className="hr-tip-row"><strong>{value}</strong><span>{label}</span></div>
      ))}
    </div>
  )
}

const PAD = { top: 12, right: 12, bottom: 28, left: 40 }

export function LineChart({ points, height = 200, unit = '', seriesLabel, maxValue }: {
  points: LinePoint[]
  height?: number
  unit?: string
  seriesLabel: string
  maxValue?: number
}) {
  const { ref, width } = useWidth<HTMLDivElement>(560)
  const [active, setActive] = useState<number | null>(null)
  const values = points.map(p => p.value).filter((v): v is number => v !== null)
  const max = maxValue ?? niceMax(Math.max(0, ...values))
  const whole = values.every(v => Number.isInteger(v))
  const inner = { w: Math.max(10, width - PAD.left - PAD.right), h: height - PAD.top - PAD.bottom }
  const x = (i: number) => PAD.left + (points.length <= 1 ? inner.w / 2 : (i / (points.length - 1)) * inner.w)
  const y = (v: number) => PAD.top + inner.h - (v / max) * inner.h
  let path = ''
  points.forEach((p, i) => {
    if (p.value === null) return
    const prev = points[i - 1]
    path += `${!prev || prev.value === null ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`
  })
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(inner.w / 70))))

  function move(clientX: number) {
    const box = ref.current?.getBoundingClientRect()
    if (!box || !points.length) return
    const rel = clientX - box.left - PAD.left
    const i = Math.round((rel / inner.w) * (points.length - 1))
    setActive(Math.max(0, Math.min(points.length - 1, i)))
  }

  const point = active !== null ? points[active] : null
  const tip: Tip | null = point && active !== null ? {
    x: Math.min(x(active) + 12, width - 150),
    y: point.value === null ? PAD.top : Math.max(0, y(point.value) - 30),
    heading: point.label,
    lines: [[seriesLabel, point.value === null ? 'No data' : `${fmt(point.value)}${unit}`]],
  } : null

  return (
    <div ref={ref} className="hr-chart" onPointerLeave={() => setActive(null)}>
      <svg width={width} height={height} role="img" aria-label={`${seriesLabel} line chart`}
        onPointerMove={e => move(e.clientX)}>
        {ticks(max, whole).map(t => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} className="hr-gridline" />
            <text x={PAD.left - 8} y={y(t)} className="hr-axis" textAnchor="end" dominantBaseline="middle">{fmt(t)}{unit}</text>
          </g>
        ))}
        {points.map((p, i) => i % labelEvery === 0 || i === points.length - 1 ? (
          <text key={p.label} x={x(i)} y={height - 8} className="hr-axis" textAnchor="middle">{p.label}</text>
        ) : null)}
        {active !== null && <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + inner.h} className="hr-crosshair" />}
        <path d={path} className="hr-line" style={{ stroke: SERIES[0] }} />
        {points.map((p, i) => p.value === null ? null : (
          <circle key={p.label} cx={x(i)} cy={y(p.value)} r={active === i ? 5 : points.length > 20 ? 0 : 3.5}
            className="hr-dot" style={{ fill: SERIES[0] }} />
        ))}
        <rect x={PAD.left} y={PAD.top} width={inner.w} height={inner.h} fill="transparent"
          tabIndex={0} aria-label={`${seriesLabel}, use the arrow keys to read each point`}
          onKeyDown={e => {
            if (e.key === 'ArrowRight') setActive(a => Math.min(points.length - 1, (a ?? -1) + 1))
            if (e.key === 'ArrowLeft') setActive(a => Math.max(0, (a ?? points.length) - 1))
          }}
          onBlur={() => setActive(null)} />
      </svg>
      <Tooltip tip={tip} />
    </div>
  )
}

export function GroupedBarChart({ groups, series, height = 200 }: {
  groups: BarGroup[]
  series: string[]
  height?: number
}) {
  const { ref, width } = useWidth<HTMLDivElement>(560)
  const [tip, setTip] = useState<Tip | null>(null)
  const max = Math.max(1, Math.ceil(niceMax(Math.max(0, ...groups.flatMap(g => g.values)))))
  const whole = groups.every(g => g.values.every(v => Number.isInteger(v)))
  const inner = { w: Math.max(10, width - PAD.left - PAD.right), h: height - PAD.top - PAD.bottom }
  const slot = inner.w / Math.max(1, groups.length)
  const barW = Math.max(3, Math.min(18, (slot - 8) / series.length - 2))
  const y = (v: number) => PAD.top + inner.h - (v / max) * inner.h
  const labelEvery = Math.max(1, Math.ceil(groups.length / Math.max(2, Math.floor(inner.w / 56))))

  return (
    <div ref={ref} className="hr-chart" onPointerLeave={() => setTip(null)}>
      <svg width={width} height={height} role="img" aria-label={`${series.join(' and ')} bar chart`}>
        {ticks(max, whole).map(t => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} className="hr-gridline" />
            <text x={PAD.left - 8} y={y(t)} className="hr-axis" textAnchor="end" dominantBaseline="middle">{fmt(t)}</text>
          </g>
        ))}
        {groups.map((g, gi) => {
          const left = PAD.left + gi * slot + (slot - (barW + 2) * series.length) / 2
          const show = () => setTip({
            x: Math.min(PAD.left + gi * slot + slot, width - 150),
            y: PAD.top,
            heading: g.label,
            lines: series.map((name, k) => [name, fmt(g.values[k])]),
          })
          return (
            <g key={g.label}>
              <rect x={PAD.left + gi * slot} y={PAD.top} width={slot} height={inner.h} fill="transparent"
                className="hr-bar-hit" onPointerEnter={show} onPointerMove={show} />
              {g.values.map((v, si) => {
                const h = Math.max(v > 0 ? 2 : 0, (v / max) * inner.h)
                const bx = left + si * (barW + 2)
                return (
                  <rect key={series[si]} x={bx} y={PAD.top + inner.h - h} width={barW} height={h} rx={Math.min(4, barW / 2)}
                    className="hr-bar" style={{ fill: SERIES[si % SERIES.length] }} tabIndex={0}
                    aria-label={`${g.label}, ${series[si]} ${v}`}
                    onPointerEnter={() => setTip({ x: Math.min(bx + barW + 8, width - 150), y: Math.max(0, PAD.top + inner.h - h - 40), heading: g.label, lines: series.map((s, k) => [s, fmt(g.values[k])]) })}
                    onFocus={() => setTip({ x: Math.min(bx + barW + 8, width - 150), y: Math.max(0, PAD.top + inner.h - h - 40), heading: g.label, lines: series.map((s, k) => [s, fmt(g.values[k])]) })}
                    onBlur={() => setTip(null)} />
                )
              })}
              {(gi % labelEvery === 0 || gi === groups.length - 1) && (
                <text x={PAD.left + gi * slot + slot / 2} y={height - 8} className="hr-axis" textAnchor="middle">{g.label}</text>
              )}
            </g>
          )
        })}
        <line x1={PAD.left} x2={width - PAD.right} y1={PAD.top + inner.h} y2={PAD.top + inner.h} className="hr-baseline" />
      </svg>
      <Tooltip tip={tip} />
    </div>
  )
}

export function HBarChart({ rows, unit = '', seriesLabel }: { rows: BarRow[]; unit?: string; seriesLabel: string }) {
  const max = niceMax(Math.max(0, ...rows.map(r => r.value)))
  return (
    <ul className="hr-hbars" aria-label={seriesLabel}>
      {rows.map(r => (
        <li key={r.label} className="hr-hbar-row" title={r.detail ? `${r.label}: ${r.detail}` : undefined}>
          <span className="hr-hbar-label">{r.label}</span>
          <span className="hr-hbar-track">
            <span className="hr-hbar-fill" style={{ width: `${max ? (r.value / max) * 100 : 0}%`, background: SERIES[0] }} />
          </span>
          <span className="hr-hbar-value">{fmt(r.value)}{unit}</span>
        </li>
      ))}
    </ul>
  )
}
