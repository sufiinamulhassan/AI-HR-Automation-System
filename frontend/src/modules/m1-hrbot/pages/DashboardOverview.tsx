import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { intelApi, jobsApi, analyticsApi } from '../../../lib/api'
import { useAuthStore } from '../../../store/auth.store'
import OnboardingCard from '../components/OnboardingCard'
import ImportJDModal from '../components/ImportJDModal'
import UploadResumesModal from '../components/UploadResumesModal'
import CostOverview, { type CostSummary } from '../components/CostOverview'
import './DashboardOverview.css'

interface IntelStats {
  total?: number
  total_domains?: number
  total_skills?: number
  by_domain?: Record<string, number>
  by_seniority?: Record<string, number>
  by_education?: Record<string, number>
  by_experience?: Record<string, number>
  top_skills?: Record<string, number>
  invite_funnel?: {
    auto_invited?: number
    manually_invited?: number
    interviewed?: number
    hired?: number
  }
}

interface DiversityBreakdown {
  by_gender: Record<string, number>
  by_location: Record<string, number>
  by_grade: Record<string, number>
  response_rate: number | null
}

interface DiversityMetrics {
  status: 'ready' | 'insufficient_data' | string
  note?: string
  breakdown: DiversityBreakdown | null
}

interface CodingAssessmentSummary {
  candidates_assigned: number
  candidates_completed: number
  completion_rate_pct: number | null
  total_submissions: number
  graded_submissions: number
  avg_score: number | null
  score_distribution: Record<string, number>
}

interface DashboardAnalytics {
  jobs_active_vs_total: { active: number; total: number }
  source_wise_applications: Record<string, number>
  recruiter_performance: { recruiter_email: string; invited: number; hired: number; avg_time_to_hire_days: number | null }[]
  time_to_hire: { avg_days: number | null; median_days: number | null; sample_size: number }
  offer_acceptance_rate: { sent: number; accepted: number; declined: number; rate_pct: number | null }
  candidate_drop_off: { stage: string; count: number; drop_pct_from_prev: number | null }[]
  ai_recommendations: { type: string; message: string; count: number }[]
  coding_assessment?: CodingAssessmentSummary
  diversity_metrics?: DiversityMetrics
  cost_summary?: CostSummary
}

function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

type IconProps = { s?: number }
const I = (s: number, children: ReactNode) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
)
const ID = (s: number, children: ReactNode) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" fillOpacity="0.16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
)
const ResumeIcon = ({ s = 16 }: IconProps) => ID(s, <><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" fill="none" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></>)
const BriefcaseIcon = ({ s = 16 }: IconProps) => ID(s, <><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" fill="none" /></>)
const LayersIcon = ({ s = 16 }: IconProps) => ID(s, <><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" fill="none" /><polyline points="2 12 12 17 22 12" fill="none" /></>)
const TagIcon = ({ s = 16 }: IconProps) => ID(s, <><path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></>)
const TiersIcon = ({ s = 16 }: IconProps) => I(s, <><line x1="4" y1="20" x2="4" y2="13" /><line x1="10" y1="20" x2="10" y2="9" /><line x1="16" y1="20" x2="16" y2="5" /><line x1="22" y1="20" x2="2" y2="20" /></>)
const TrophyIcon = ({ s = 16 }: IconProps) => ID(s, <><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" fill="none" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" fill="none" /><path d="M4 22h16" fill="none" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" fill="none" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" fill="none" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2z" /></>)
const MailIcon = ({ s = 16 }: IconProps) => I(s, <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></>)
const UserPlusIcon = ({ s = 16 }: IconProps) => I(s, <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" /></>)
const MicIcon = ({ s = 16 }: IconProps) => I(s, <><rect x="9" y="2" width="6" height="11" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><line x1="12" y1="19" x2="12" y2="22" /></>)
const CheckIcon = ({ s = 16 }: IconProps) => I(s, <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></>)
const PlusIcon = ({ s = 15 }: IconProps) => I(s, <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>)
const ImportIcon = ({ s = 15 }: IconProps) => I(s, <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>)
const SearchIcon = ({ s = 14 }: IconProps) => I(s, <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></>)
const ChevronIcon = ({ s = 16 }: IconProps) => I(s, <polyline points="9 18 15 12 9 6" />)

function BreakdownBars({ data, grad }: { data: Record<string, number>; grad: string }) {
  const sorted = Object.entries(data).sort((a, b) => b[1] - a[1])
  const max = sorted[0]?.[1] || 1
  return (
    <div className="dv-bars">
      {sorted.map(([label, val]) => (
        <div key={label} className="dv-bar">
          <span className="dv-bar-lbl" title={label}>{label.replace(/_/g, ' ')}</span>
          <div className="dv-bar-track">
            <div className="dv-bar-fill" style={{ width: `${Math.max((val / max) * 100, 5)}%`, background: grad }} />
          </div>
          <span className="dv-bar-val">{val}</span>
        </div>
      ))}
    </div>
  )
}

function RingCluster({ total, rings }: { total: number; rings: { label: string; value: number; color: string }[] }) {
  const size = 132
  const c = size / 2
  const radii = [56, 43, 30]
  const stroke = 11
  return (
    <div className="dv-ring-cluster">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="dv-ring-svg">
        {rings.map((r, i) => {
          const radius = radii[i]
          const circumference = 2 * Math.PI * radius
          const pct = total > 0 ? Math.min(r.value / total, 1) : 0
          const offset = circumference * (1 - pct)
          return (
            <Fragment key={r.label}>
              <circle cx={c} cy={c} r={radius} fill="none" stroke="var(--gray-100)" strokeWidth={stroke} />
              <circle
                cx={c} cy={c} r={radius} fill="none" stroke={r.color} strokeWidth={stroke}
                strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset}
                transform={`rotate(-90 ${c} ${c})`}
              />
            </Fragment>
          )
        })}
        <text x={c} y={c - 6} textAnchor="middle" className="dv-ring-center-val">{total.toLocaleString()}</text>
        <text x={c} y={c + 14} textAnchor="middle" className="dv-ring-center-lbl">résumés</text>
      </svg>
      <ul className="dv-ring-legend">
        {rings.map(r => (
          <li key={r.label}>
            <span className="dv-ring-dot" style={{ background: r.color }} />
            <span className="dv-ring-legend-lbl">{r.label}</span>
            <span className="dv-ring-legend-val">
              {r.value.toLocaleString()}
              <span className="dv-ring-legend-pct">{total > 0 ? `${Math.round((r.value / total) * 100)}%` : '0%'}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function StageBars({ steps }: { steps: { label: string; val: number; color: string; lit?: boolean }[] }) {
  const max = Math.max(...steps.map(s => s.val), 1)
  return (
    <div className="dv-stagebars">
      {steps.map(s => {
        const pct = Math.max((s.val / max) * 100, 3)
        return (
          <div className="dv-stagebar-col" key={s.label}>
            <span className="dv-stagebar-val">{s.lit && s.val > 0 ? '↑ ' : ''}{s.val.toLocaleString()}</span>
            <div className="dv-stagebar-track">
              <div className={`dv-stagebar-fill${s.lit ? ' dv-stagebar-fill-lit' : ''}`} style={{ height: `${pct}%`, background: s.color }} />
            </div>
            <span className="dv-stagebar-lbl">{s.label}</span>
          </div>
        )
      })}
    </div>
  )
}

interface FlowStage {
  key: string
  label: string
  value: number
  icon: ReactNode
  tint: string
  color: string
  badge: string
  badgeTone: 'start' | 'up' | 'down'
}

function FlowRow({ stages }: { stages: FlowStage[] }) {
  const max = Math.max(...stages.map(s => s.value), 1)
  return (
    <div className="dv-flow">
      {stages.map((s, i) => {
        const pct = s.value > 0 ? Math.max((s.value / max) * 100, 5) : 0
        return (
          <Fragment key={s.key}>
            <div className="dv-flow-card">
              <span className={`dv-flow-icon tint-${s.tint}`}>{s.icon}</span>
              <span className="dv-flow-val">{s.value.toLocaleString()}</span>
              <span className="dv-flow-name">{s.label}</span>
              <span className="dv-flow-meter"><i style={{ width: `${pct}%`, background: s.color }} /></span>
              <span className={`dv-flow-badge dv-flow-badge-${s.badgeTone}`}>{s.badge}</span>
            </div>
            {i < stages.length - 1 && <span className="dv-flow-arrow"><ChevronIcon s={16} /></span>}
          </Fragment>
        )
      })}
    </div>
  )
}

const DROP_OFF_META: Record<string, { label: string; icon: ReactNode; tint: string; color: string }> = {
  invited: { label: 'Invited', icon: <MailIcon s={14} />, tint: 'navy', color: 'var(--secondary)' },
  interviewing: { label: 'Interviewing', icon: <MicIcon s={14} />, tint: 'violet', color: 'var(--primary)' },
  completed: { label: 'Completed', icon: <CheckIcon s={14} />, tint: 'teal', color: 'var(--primary-dark)' },
  hired: { label: 'Hired', icon: <TrophyIcon s={14} />, tint: 'lime', color: 'var(--primary)' },
}

function ChartCard({ title, data, grad, empty }: {
  title: string; data: Record<string, number> | undefined; grad: string; empty?: string
}) {
  const [q, setQ] = useState('')
  const entries = Object.entries(data || {})
  const has = entries.length > 0
  const filtered = q ? entries.filter(([l]) => l.toLowerCase().includes(q.trim().toLowerCase())) : entries

  return (
    <div className="dv-card dv-chart">
      <div className="dv-card-head">
        <div>
          <h3 className="dv-card-title">{title}</h3>
        </div>
        {has && <span className="dv-pill">{entries.length}</span>}
      </div>

      {!has ? (
        <p className="dv-empty">{empty || 'No data yet.'}</p>
      ) : (
        <>
          {entries.length > 7 && (
            <div className="dv-search">
              <SearchIcon />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder={`Search ${title.toLowerCase()}…`} />
              {q && <button className="dv-search-x" onClick={() => setQ('')} aria-label="Clear">✕</button>}
            </div>
          )}
          <div className="dv-bars-scroll">
            {filtered.length > 0
              ? <BreakdownBars data={Object.fromEntries(filtered)} grad={grad} />
              : <p className="dv-empty">No matches for “{q}”.</p>}
          </div>
        </>
      )}
    </div>
  )
}

export default function DashboardOverview() {
  const navigate = useNavigate()
  const user = useAuthStore(s => s.user) as Record<string, string> | null
  const role = user?.role || 'standard'
  const isAdmin = role === 'admin' || role === 'superadmin'
  const [stats, setStats] = useState<IntelStats>({})
  const [bySource, setBySource] = useState<Record<string, number>>({})
  const [openJDs, setOpenJDs] = useState(0)
  const [analytics, setAnalytics] = useState<DashboardAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [showImport, setShowImport] = useState(false)
  const [showUpload, setShowUpload] = useState(false)

  function loadAll() {
    setLoading(true)
    Promise.all([
      intelApi.stats().then(r => r.data as IntelStats).catch(() => ({} as IntelStats)),
      jobsApi.stats()
        .then(r => r.data as { total?: number; by_source?: Record<string, number> })
        .catch(() => ({} as { total?: number; by_source?: Record<string, number> })),
      analyticsApi.dashboard().then(r => r.data as DashboardAnalytics).catch(() => null),
    ]).then(([s, jd, an]) => {
      setStats(s)
      setOpenJDs(jd.total ?? 0)
      setBySource(jd.by_source || {})
      setAnalytics(an)
    }).finally(() => setLoading(false))
  }

  useEffect(() => { loadAll() }, [])

  const funnel = stats.invite_funnel ?? {}
  const totalDomains = stats.total_domains ?? Object.keys(stats.by_domain ?? {}).length

  const jobsActiveVsTotal = analytics?.jobs_active_vs_total
  const timeToHire = analytics?.time_to_hire ?? { avg_days: null, median_days: null, sample_size: 0 }
  const offerRate = analytics?.offer_acceptance_rate ?? { sent: 0, accepted: 0, declined: 0, rate_pct: null }
  const recruiterPerf = analytics?.recruiter_performance ?? []
  const aiRecs = analytics?.ai_recommendations ?? []
  const dropOff = analytics?.candidate_drop_off ?? []
  const dropOffStages: FlowStage[] = dropOff.map((s, i) => {
    const meta = DROP_OFF_META[s.stage] ?? { label: titleCase(s.stage), icon: <TiersIcon s={14} />, tint: 'navy', color: 'var(--secondary)' }
    let badge: string
    let badgeTone: FlowStage['badgeTone']
    if (i === 0) {
      badge = 'entry point'
      badgeTone = 'start'
    } else if (s.drop_pct_from_prev === null) {
      badge = 'no prior data'
      badgeTone = 'start'
    } else if (s.drop_pct_from_prev > 0) {
      badge = `-${s.drop_pct_from_prev.toFixed(0)}% drop`
      badgeTone = 'down'
    } else {
      badge = `+${Math.abs(s.drop_pct_from_prev).toFixed(0)}% increase`
      badgeTone = 'up'
    }
    return { key: s.stage, label: meta.label, value: s.count, icon: meta.icon, tint: meta.tint, color: meta.color, badge, badgeTone }
  })
  const codingAssessment = analytics?.coding_assessment
  const diversity = analytics?.diversity_metrics
  const diversityBreakdown = diversity?.status === 'ready' ? diversity.breakdown : null
  const diversityNote = diversity?.note ?? "Diversity metrics aren't available yet."
  const sourceWiseApplications = analytics?.source_wise_applications ?? {}
  const costSummary = analytics?.cost_summary

  const kpis: { label: string; val: number; icon: ReactNode; tint: string; sub?: string; to?: string; hint?: string }[] = [
    { label: 'Total Résumés',  val: stats.total ?? 0,                 icon: <ResumeIcon />,    tint: 'lime',   to: '/dashboard/resumes?status=processed' },
    {
      label: 'Open JDs', val: openJDs, icon: <BriefcaseIcon />, tint: 'navy',
      sub: jobsActiveVsTotal ? `${jobsActiveVsTotal.active} active` : undefined,
      to: '/dashboard/hrbot', hint: 'Open Recruiting',
    },
    { label: 'Domains',        val: totalDomains,                     icon: <LayersIcon />,    tint: 'violet' },
    { label: 'Distinct Skills',val: stats.total_skills ?? 0,          icon: <TagIcon />,       tint: 'teal'   },
    { label: 'Seniority Levels', val: Object.keys(stats.by_seniority ?? {}).length, icon: <TiersIcon />, tint: 'green'  },
    { label: 'Hired',          val: funnel.hired ?? 0,                icon: <TrophyIcon />,    tint: 'rose'   },
  ]

  const funnelSteps = [
    { label: 'Total Résumés',    val: stats.total ?? 0,             icon: <ResumeIcon s={14} />,   grad: 'linear-gradient(90deg,var(--secondary),#33507f)', c: 'var(--secondary)', cBg: '#e8edf6' },
    { label: 'Auto-Invited',     val: funnel.auto_invited ?? 0,     icon: <MailIcon s={14} />,     grad: 'linear-gradient(90deg,var(--primary-dark),var(--primary))', c: 'var(--secondary)', cBg: 'var(--primary-light)' },
    { label: 'Manually Invited', val: funnel.manually_invited ?? 0, icon: <UserPlusIcon s={14} />, grad: 'linear-gradient(90deg,#7c3aed,var(--primary))', c: '#6d28d9', cBg: '#e6edfe' },
    { label: 'Interviewed',      val: funnel.interviewed ?? 0,      icon: <MicIcon s={14} />,      grad: 'linear-gradient(90deg,#0d9488,var(--primary-dark))', c: '#0d9488', cBg: '#e6edfe' },
    { label: 'Hired',            val: funnel.hired ?? 0,            icon: <CheckIcon s={14} />,    grad: 'linear-gradient(90deg,#15803d,#4ade80)', c: '#15803d', cBg: '#e6f6ec' },
  ]

  return (
    <div className="dv">
      <header className="dv-head">
        <div>
          <h1 className="dv-h1">Recruitment Overview</h1>
        </div>
        {isAdmin && (
          <div className="dv-head-actions">
            <button className="dv-btn dv-btn-primary" onClick={() => navigate('/dashboard/hrbot?new=1')}>
              <PlusIcon /> Create JD
            </button>
            <button className="dv-btn dv-btn-ghost" onClick={() => setShowImport(true)}>
              <ImportIcon /> Import JDs
            </button>
            <button className="dv-btn dv-btn-ghost" onClick={() => setShowUpload(true)}>
              <ResumeIcon s={15} /> Upload Résumés
            </button>
          </div>
        )}
      </header>

      {isAdmin && <OnboardingCard />}

      <section className="dv-kpis">
        {kpis.map(k => {
          const body = (
            <>
              <div className="dv-kpi-top">
                <span className={`dv-kpi-icon tint-${k.tint}`}>{k.icon}</span>
                <span className="dv-kpi-lbl">{k.label}</span>
                {k.to && <span className="dv-kpi-go" aria-hidden>→</span>}
              </div>
              <div className="dv-kpi-val-row">
                <span className="dv-kpi-val">{k.val.toLocaleString()}</span>
                {k.sub && <span className="dv-kpi-badge">{k.sub}</span>}
              </div>
            </>
          )
          return k.to
            ? <Link key={k.label} to={k.to} className="dv-kpi dv-kpi-link" title={k.hint ?? `View all ${k.label.toLowerCase()}`}>{body}</Link>
            : <div key={k.label} className="dv-kpi">{body}</div>
        })}
      </section>

      <section className="dv-insights-row">
        <div className="dv-card dv-rings-card">
          <div className="dv-card-head">
            <div>
              <h3 className="dv-card-title">Pipeline Composition</h3>
            </div>
          </div>
          <RingCluster
            total={funnelSteps[0].val}
            rings={[
              { label: 'Auto-Invited', value: funnel.auto_invited ?? 0, color: 'var(--primary)' },
              { label: 'Manually Invited', value: funnel.manually_invited ?? 0, color: 'var(--secondary)' },
              { label: 'Interviewed', value: funnel.interviewed ?? 0, color: 'var(--primary)' },
            ]}
          />
        </div>

        <div className="dv-card dv-dark-card">
          <div className="dv-card-head">
            <div>
              <h3 className="dv-card-title dv-card-title-dark">Hiring Funnel</h3>
            </div>
          </div>
          {loading ? <div className="dv-loading dv-loading-dark">Loading…</div> : (
            <StageBars steps={funnelSteps.slice(1).map((s, i) => ({
              label: s.label, val: s.val,
              color: [ 'var(--primary)', 'var(--primary-dark)', 'rgba(71, 120, 243,.55)', 'var(--primary)' ][i],
              lit: i === funnelSteps.length - 2,
            }))} />
          )}
        </div>
      </section>

      {!loading && analytics && costSummary && <CostOverview summary={costSummary} />}

      {!loading && analytics && (
        <section className="dv-stat-row">
          <div className="dv-card dv-stat-card">
            <div className="dv-card-head">
              <div>
                <h3 className="dv-card-title">Time to Hire</h3>
              </div>
            </div>
            {timeToHire.avg_days === null ? (
              <p className="dv-empty">No data yet.</p>
            ) : (
              <>
                <div className="dv-stat-val">{timeToHire.avg_days.toFixed(1)} <span>days avg</span></div>
                <p className="dv-stat-cap">
                  {timeToHire.sample_size} hire{timeToHire.sample_size === 1 ? '' : 's'} sampled
                  {timeToHire.median_days !== null ? ` · median ${timeToHire.median_days.toFixed(1)} days` : ''}
                </p>
              </>
            )}
          </div>

          <div className="dv-card dv-stat-card">
            <div className="dv-card-head">
              <div>
                <h3 className="dv-card-title">Offer Acceptance Rate</h3>
              </div>
            </div>
            {offerRate.sent === 0 ? (
              <p className="dv-empty">No offers sent yet.</p>
            ) : (
              <>
                <div className="dv-stat-val">
                  {offerRate.rate_pct !== null ? `${offerRate.rate_pct.toFixed(0)}%` : '-'}
                </div>
                <p className="dv-stat-cap">
                  {offerRate.sent} sent · {offerRate.accepted} accepted · {offerRate.declined} declined
                </p>
              </>
            )}
          </div>
        </section>
      )}

      {!loading && analytics && (
        <section className="dv-card">
          <div className="dv-card-head">
            <div>
              <h3 className="dv-card-title">Candidate Drop-off</h3>
            </div>
          </div>
          {dropOffStages.length === 0 ? (
            <p className="dv-empty">No pipeline activity yet.</p>
          ) : (
            <FlowRow stages={dropOffStages} />
          )}
        </section>
      )}

      {!loading && codingAssessment && (
        <section className="dv-stat-row">
          <div className="dv-card dv-stat-card">
            <div className="dv-card-head">
              <div>
                <h3 className="dv-card-title">Coding Assessment Completion</h3>
              </div>
            </div>
            {codingAssessment.candidates_assigned === 0 ? (
              <p className="dv-empty">No coding questions assigned yet.</p>
            ) : (
              <>
                <div className="dv-stat-val">
                  {codingAssessment.completion_rate_pct !== null ? `${codingAssessment.completion_rate_pct.toFixed(0)}%` : '-'}
                </div>
                <p className="dv-stat-cap">
                  {`${codingAssessment.candidates_completed} of ${codingAssessment.candidates_assigned} candidate${codingAssessment.candidates_assigned === 1 ? '' : 's'} completed · ${codingAssessment.total_submissions} submission${codingAssessment.total_submissions === 1 ? '' : 's'}`}
                </p>
              </>
            )}
          </div>

          <div className="dv-card dv-stat-card">
            <div className="dv-card-head">
              <div>
                <h3 className="dv-card-title">Coding Assessment Avg Score</h3>
              </div>
            </div>
            {codingAssessment.graded_submissions === 0 ? (
              <p className="dv-empty">No graded submissions yet.</p>
            ) : (
              <>
                <div className="dv-stat-val">
                  {codingAssessment.avg_score !== null ? `${codingAssessment.avg_score.toFixed(1)} / 100` : '-'}
                </div>
                <p className="dv-stat-cap">
                  {`${codingAssessment.graded_submissions} submission${codingAssessment.graded_submissions === 1 ? '' : 's'} graded`}
                </p>
              </>
            )}
          </div>
        </section>
      )}

      {!loading && analytics && (
        <section className="dv-card">
          <div className="dv-card-head">
            <div>
              <h3 className="dv-card-title">Recruiter Performance</h3>
            </div>
          </div>
          {recruiterPerf.length === 0 ? (
            <p className="dv-empty">No recruiter activity yet.</p>
          ) : (
            <div className="dv-table-wrap">
              <table className="dv-table">
                <thead>
                  <tr><th>Recruiter</th><th>Invited</th><th>Hired</th><th>Avg. Time to Hire</th></tr>
                </thead>
                <tbody>
                  {recruiterPerf.map(r => (
                    <tr key={r.recruiter_email}>
                      <td>{r.recruiter_email}</td>
                      <td>{r.invited}</td>
                      <td>{r.hired}</td>
                      <td>{r.avg_time_to_hire_days !== null ? `${r.avg_time_to_hire_days.toFixed(1)} days` : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {loading ? (
        <div className="dv-card"><div className="dv-loading">Loading statistics…</div></div>
      ) : (
        <section className="dv-grid">
          <ChartCard title="By Domain"        data={stats.by_domain}     grad="linear-gradient(90deg,var(--primary),var(--primary-dark))" />
          <ChartCard title="By Seniority"        data={stats.by_seniority}  grad="linear-gradient(90deg,var(--secondary),#3b5b9a)" />
          <ChartCard title="By Experience"     data={stats.by_experience} grad="linear-gradient(90deg,#6d28d9,#a78bfa)" />
          <ChartCard title="By Education"              data={stats.by_education}  grad="linear-gradient(90deg,#0d9488,#5eead4)" />
          <ChartCard title="Top Skills"       data={stats.top_skills}    grad="linear-gradient(90deg,#be123c,#fb7185)" />
          <ChartCard title="JDs by Source"     data={bySource} grad="linear-gradient(90deg,var(--secondary),var(--primary))"
            empty="No job descriptions yet." />
          {analytics && (
            <ChartCard title="Applications by Source" data={sourceWiseApplications}
              grad="linear-gradient(90deg,#7c3aed,#c4b5fd)" empty="No application source data yet." />
          )}
          {codingAssessment && (
            <ChartCard title="Coding Score Distribution"
              data={codingAssessment.graded_submissions > 0 ? codingAssessment.score_distribution : {}}
              grad="linear-gradient(90deg,#b45309,#fbbf24)" empty="No graded coding submissions yet." />
          )}
        </section>
      )}

      {!loading && analytics && (
        <section className={diversity ? 'dv-2col' : undefined}>
          <div className="dv-card">
            <div className="dv-card-head">
              <div>
                <h3 className="dv-card-title">AI Recommendations</h3>
              </div>
            </div>
            {aiRecs.length === 0 ? (
              <p className="dv-empty">No recommendations right now.</p>
            ) : (
              <div className="dv-reco-list">
                {aiRecs.map((r, i) => (
                  <div key={`${r.type}-${i}`} className="dv-reco-row">
                    <span className="dv-reco-msg">{r.message}</span>
                    <span className="dv-reco-count">{r.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {diversity && (
            <div className="dv-card">
              <div className="dv-card-head">
                <div>
                  <h3 className="dv-card-title">Diversity Metrics</h3>
                </div>
                {diversityBreakdown && diversityBreakdown.response_rate !== null && (
                  <span className="dv-pill">{Math.round(diversityBreakdown.response_rate * 100)}% response rate</span>
                )}
              </div>

              {diversityBreakdown ? (
                <div className="dv-diversity-groups">
                  <div>
                    <h4 className="dv-subhead">By Gender</h4>
                    {Object.keys(diversityBreakdown.by_gender).length > 0 ? (
                      <BreakdownBars data={diversityBreakdown.by_gender} grad="linear-gradient(90deg,var(--primary),var(--primary-dark))" />
                    ) : (
                      <p className="dv-empty">No data yet.</p>
                    )}
                  </div>
                  <div>
                    <h4 className="dv-subhead">By Location</h4>
                    {Object.keys(diversityBreakdown.by_location).length > 0 ? (
                      <BreakdownBars data={diversityBreakdown.by_location} grad="linear-gradient(90deg,var(--secondary),#3b5b9a)" />
                    ) : (
                      <p className="dv-empty">No data yet.</p>
                    )}
                  </div>
                  <div>
                    <h4 className="dv-subhead">By Grade</h4>
                    {Object.keys(diversityBreakdown.by_grade).length > 0 ? (
                      <BreakdownBars data={diversityBreakdown.by_grade} grad="linear-gradient(90deg,#6d28d9,#a78bfa)" />
                    ) : (
                      <p className="dv-empty">No data yet.</p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="dv-note">{diversityNote}</p>
              )}
            </div>
          )}
        </section>
      )}

      {isAdmin && showImport && <ImportJDModal onClose={() => setShowImport(false)} onImported={loadAll} />}
      {isAdmin && showUpload && <UploadResumesModal onClose={() => setShowUpload(false)} onUploaded={loadAll} />}
    </div>
  )
}
