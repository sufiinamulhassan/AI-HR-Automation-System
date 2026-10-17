import { useState } from 'react'
import './CostOverview.css'

export interface CostCategory {
  key: string
  label: string
  cost_usd: number
  calls: number
  items?: number
  avg_item_usd?: number
}

export interface CostSummary {
  status: 'ready' | 'insufficient_data' | string
  note?: string
  total_cost_usd: number
  categories?: CostCategory[]
  llm: {
    total_cost_usd: number
    total_calls: number
    prompt_tokens: number
    completion_tokens: number
    embedding_tokens?: number
    by_feature: Record<string, number>
  }
  email: {
    estimated_cost_usd: number
    sent_count: number
    cost_per_email_usd: number
    note: string
  }
  voice?: {
    estimated_cost_usd: number
    tts: { cost_usd: number; calls: number; characters: number }
    stt: { cost_usd: number; calls: number; duration_minutes: number; estimated_calls: number }
    note: string
  }
  code_execution: {
    trackable: boolean
    note: string
  }
}

function fmtTokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(n)
}

function fmtCost(n: number): string {
  return n >= 1 ? n.toFixed(2) : n.toFixed(4)
}

function fmtUnitCost(n: number): string {
  if (n >= 0.001 || n <= 0) return n.toFixed(4)
  const places = Math.min(8, 2 - Math.floor(Math.log10(n)))
  return n.toFixed(places).replace(/0+$/, '').replace(/\.$/, '')
}

function perItem(category: CostCategory | undefined): number {
  const items = category?.items ?? 0
  return category && items > 0 ? category.cost_usd / items : 0
}

const plural = (n: number, noun: string) => `${n.toLocaleString()} ${noun}${n === 1 ? '' : 's'}`

function share(cost: number, total: number): { text: string; width: number } {
  const pct = total > 0 ? (cost / total) * 100 : 0
  if (pct <= 0) return { text: '0%', width: 0 }
  if (pct < 1) return { text: '<1%', width: Math.max(pct, 1) }
  return { text: `${Math.round(pct)}%`, width: Math.min(pct, 100) }
}

function detail(category: CostCategory, summary: CostSummary): string {
  const calls = plural(category.calls, 'AI call')
  switch (category.key) {
    case 'resume_parsing':
      return category.items
        ? `${plural(category.items, 'résumé')} · $${fmtUnitCost(perItem(category))} each`
        : calls
    case 'reports':
      return category.items
        ? `${plural(category.items, 'report')} · $${fmtUnitCost(perItem(category))} each`
        : calls
    case 'voice': {
      const v = summary.voice
      return v
        ? `${v.tts.calls} TTS · ${v.stt.calls} STT (${v.stt.duration_minutes.toFixed(1)} min)`
        : plural(category.calls, 'voice call')
    }
    case 'email':
      return `${plural(category.calls, 'email')} sent · $${fmtCost(summary.email.cost_per_email_usd)} / email`
    default:
      return calls
  }
}

const DollarIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="12" y1="1" x2="12" y2="23" />
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
)

export default function CostOverview({ summary }: { summary: CostSummary }) {
  const [showAll, setShowAll] = useState(false)

  if (summary.status !== 'ready') {
    return (
      <section className="dv-card cst-empty" aria-label="Cost">
        <div className="dv-card-head">
          <h3 className="dv-card-title">Cost</h3>
        </div>
        <p className="dv-empty">{summary.note || "Cost data isn't available yet."}</p>
      </section>
    )
  }

  const total = summary.total_cost_usd
  const areas = (summary.categories ?? []).filter(c => c.key !== 'other' || c.cost_usd > 0 || c.calls > 0)
  const parsing = (summary.categories ?? []).find(c => c.key === 'resume_parsing')
  const active = areas.filter(c => c.cost_usd > 0 || c.calls > 0)
  const visible = showAll ? areas : active
  const hidden = areas.length - active.length

  return (
    <section className="cst" aria-label="Cost">
      <div className="dv-spend cst-total" aria-label="Total cost">
        <div className="dv-spend-glow" />
        <div className="dv-spend-glow dv-spend-glow2" />
        <div className="dv-spend-top">
          <div className="dv-spend-hero">
            <span className="dv-spend-badge"><DollarIcon /></span>
            <div>
              <span className="dv-spend-eyebrow">Total cost</span>
              <div className="dv-spend-val"><span className="dv-spend-cur">$</span>{fmtCost(total)}<span className="dv-spend-usd">USD est.</span></div>
            </div>
          </div>
          <div className="dv-spend-stats">
            <div className="dv-spend-stat dv-spend-stat-key"><b>${fmtUnitCost(perItem(parsing))}</b><span>Avg / Résumé</span></div>
            <div className="dv-spend-stat"><b>{(parsing?.items ?? 0).toLocaleString()}</b><span>Résumés</span></div>
            <div className="dv-spend-stat"><b>{summary.llm.total_calls.toLocaleString()}</b><span>AI calls</span></div>
            <div className="dv-spend-stat"><b>{fmtTokens(summary.llm.prompt_tokens)}</b><span>Prompt</span></div>
            <div className="dv-spend-stat"><b>{fmtTokens(summary.llm.completion_tokens)}</b><span>Completion</span></div>
            <div className="dv-spend-stat"><b>{fmtTokens(summary.llm.embedding_tokens ?? 0)}</b><span>Embedding</span></div>
          </div>
        </div>
      </div>

      {visible.length > 0 ? (
        <div className="cst-grid">
          {visible.map(area => {
            const part = share(area.cost_usd, total)
            return (
              <div className="cst-card" key={area.key} data-area={area.key}>
                <div className="cst-card-head">
                  <h3 className="cst-card-title">{area.label}</h3>
                  <span className="cst-share">{part.text}</span>
                </div>
                <div className="cst-price">${fmtCost(area.cost_usd)}</div>
                <p className="cst-detail">{detail(area, summary)}</p>
                <div className="cst-bar" aria-hidden="true"><span style={{ width: `${part.width}%` }} /></div>
              </div>
            )
          })}
        </div>
      ) : areas.length > 0 ? (
        <p className="cst-none">No AI spend recorded yet.</p>
      ) : null}
      {hidden > 0 && (
        <button type="button" className="cst-toggle" aria-expanded={showAll} onClick={() => setShowAll(v => !v)}>
          {showAll ? 'Show active areas only' : `Show all ${areas.length} areas`}
        </button>
      )}
    </section>
  )
}
