import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { intelApi, jobsApi, analyticsApi } from '../../../lib/api'
import { useAuthStore } from '../../../store/auth.store'
import ImportJDModal from '../components/ImportJDModal'
import UploadResumesModal from '../components/UploadResumesModal'
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

interface CostTotal {
  total_cost_usd: number
  prompt_tokens: number
  completion_tokens: number
  embedding_tokens: number
  operations: number
  by_source?: Record<string, number>
  resumes: number
  avg_per_resume: number
  since?: string | null
}

interface DashboardAnalytics {
  jobs_active_vs_total: { active: number; total: number }
  source_wise_applications: Record<string, number>
  recruiter_performance: { recruiter_email: string; invited: number; hired: number; avg_time_to_hire_days: number | null }[]
  time_to_hire: { avg_days: number | null; median_days: number | null; sample_size: number }
  offer_acceptance_rate: { sent: number; accepted: number; declined: number; rate_pct: number | null }
  candidate_drop_off: { stage: string; count: number; drop_pct_from_prev: number | null }[]
  ai_recommendations: { type: string; message: string; count: number }[]
  diversity_metrics: { status: string; note: string; breakdown: unknown }
}

function fmtTokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(n)
}

function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

type IconProps = { s?: number }
const I = (s: number, children: ReactNode) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
)
const ResumeIcon = ({ s = 18 }: IconProps) => I(s, <><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></>)
const BriefcaseIcon = ({ s = 18 }: IconProps) => I(s, <><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></>)
const LayersIcon = ({ s = 18 }: IconProps) => I(s, <><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></>)
const TagIcon = ({ s = 18 }: IconProps) => I(s, <><path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></>)
const TiersIcon = ({ s = 18 }: IconProps) => I(s, <><line x1="4" y1="20" x2="4" y2="13" /><line x1="10" y1="20" x2="10" y2="9" /><line x1="16" y1="20" x2="16" y2="5" /><line x1="22" y1="20" x2="2" y2="20" /></>)
const TrophyIcon = ({ s = 18 }: IconProps) => I(s, <><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2z" /></>)
const MailIcon = ({ s = 16 }: IconProps) => I(s, <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></>)
const UserPlusIcon = ({ s = 16 }: IconProps) => I(s, <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" /></>)
const MicIcon = ({ s = 16 }: IconProps) => I(s, <><rect x="9" y="2" width="6" height="11" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><line x1="12" y1="19" x2="12" y2="22" /></>)
const CheckIcon = ({ s = 16 }: IconProps) => I(s, <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></>)
const PlusIcon = ({ s = 15 }: IconProps) => I(s, <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>)
const ImportIcon = ({ s = 15 }: IconProps) => I(s, <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>)
const SearchIcon = ({ s = 14 }: IconProps) => I(s, <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></>)
const ChevronIcon = ({ s = 20 }: IconProps) => I(s, <polyline points="9 18 15 12 9 6" />)
const DollarIcon = ({ s = 24 }: IconProps) => I(s, <><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></>)

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

function ChartCard({ title, sub, data, grad, empty }: {
  title: string; sub?: string; data: Record<string, number> | undefined; grad: string; empty?: string
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
          {sub && <p className="dv-card-sub">{sub}</p>}
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
  const canSeeCost = role === 'superadmin'
  const [stats, setStats] = useState<IntelStats>({})
  const [bySource, setBySource] = useState<Record<string, number>>({})
  const [openJDs, setOpenJDs] = useState(0)
  const [cost, setCost] = useState<CostTotal | null>(null)
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
      intelApi.costTotal().then(r => r.data as CostTotal).catch(() => null),
      analyticsApi.dashboard().then(r => r.data as DashboardAnalytics).catch(() => null),
    ]).then(([s, jd, c, an]) => {
      setStats(s)
      setOpenJDs(jd.total ?? 0)
      setBySource(jd.by_source || {})
      setCost(c)
      setAnalytics(an)
    }).finally(() => setLoading(false))
  }

  useEffect(() => { loadAll() }, [])

  const funnel = stats.invite_funnel ?? {}
  const totalDomains = stats.total_domains ?? Object.keys(stats.by_domain ?? {}).length

  const jobsActiveVsTotal = analytics?.jobs_active_vs_total
  const timeToHire = analytics?.time_to_hire ?? { avg_days: null, median_days: null, sample_size: 0 }
  const offerRate = analytics?.offer_acceptance_rate ?? { sent: 0, accepted: 0, declined: 0, rate_pct: null }
  const dropOff = analytics?.candidate_drop_off ?? []
  const recruiterPerf = analytics?.recruiter_performance ?? []
  const aiRecs = analytics?.ai_recommendations ?? []
  const diversityNote = analytics?.diversity_metrics?.note ?? "Diversity metrics aren't available yet."
  const sourceWiseApplications = analytics?.source_wise_applications ?? {}

  const kpis = [
    { label: 'Total Résumés',  val: stats.total ?? 0,                 icon: <ResumeIcon />,    tint: 'amber'  },
    {
      label: 'Open JDs', val: openJDs, icon: <BriefcaseIcon />, tint: 'navy',
      sub: jobsActiveVsTotal ? `${jobsActiveVsTotal.active} active` : undefined,
    },
    { label: 'Domains',        val: totalDomains,                     icon: <LayersIcon />,    tint: 'violet' },
    { label: 'Distinct Skills',val: stats.total_skills ?? 0,          icon: <TagIcon />,       tint: 'teal'   },
    { label: 'Seniority Levels', val: Object.keys(stats.by_seniority ?? {}).length, icon: <TiersIcon />, tint: 'green'  },
    { label: 'Hired',          val: funnel.hired ?? 0,                icon: <TrophyIcon />,    tint: 'rose'   },
  ]

  const funnelSteps = [
    { label: 'Total Résumés',    val: stats.total ?? 0,             icon: <ResumeIcon s={15} />,   grad: 'linear-gradient(90deg,#222022,#343234)', c: '#222022', cBg: '#e6edfe' },
    { label: 'Auto-Invited',     val: funnel.auto_invited ?? 0,     icon: <MailIcon s={15} />,     grad: 'linear-gradient(90deg,#385fc0,#4778f3)', c: '#385fc0', cBg: '#e6edfe' },
    { label: 'Manually Invited', val: funnel.manually_invited ?? 0, icon: <UserPlusIcon s={15} />, grad: 'linear-gradient(90deg,#7c3aed,#a78bfa)', c: '#6d28d9', cBg: '#f1ebfe' },
    { label: 'Interviewed',      val: funnel.interviewed ?? 0,      icon: <MicIcon s={15} />,      grad: 'linear-gradient(90deg,#0d9488,#2dd4bf)', c: '#0d9488', cBg: '#def5f1' },
    { label: 'Hired',            val: funnel.hired ?? 0,            icon: <CheckIcon s={15} />,    grad: 'linear-gradient(90deg,#15803d,#4ade80)', c: '#15803d', cBg: '#e6f6ec' },
  ]
  const funnelMax = Math.max(funnelSteps[0].val, 1)

  const spend = cost?.total_cost_usd ?? 0
  const spendStr = spend >= 1 ? spend.toFixed(2) : spend.toFixed(4)

  return (
    <div className="dv">
      <header className="dv-head">
        <div>
          <h1 className="dv-h1">Recruitment Overview</h1>
          <p className="dv-h1-sub">A live snapshot of your talent pool, hiring funnel and AI usage.</p>
        </div>
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
      </header>

      <section className="dv-kpis">
        {kpis.map(k => (
          <div key={k.label} className="dv-kpi">
            <span className={`dv-kpi-icon tint-${k.tint}`}>{k.icon}</span>
            <div className="dv-kpi-body">
              <span className="dv-kpi-val">{k.val.toLocaleString()}</span>
              <span className="dv-kpi-lbl">
                {k.label}
                {k.sub && <span className="dv-kpi-sub">{k.sub}</span>}
              </span>
            </div>
          </div>
        ))}
      </section>

      {canSeeCost && (
        <section className="dv-spend">
          <div className="dv-spend-glow" />
          <div className="dv-spend-glow dv-spend-glow2" />
          <div className="dv-spend-top">
            <div className="dv-spend-hero">
              <span className="dv-spend-badge"><DollarIcon s={24} /></span>
              <div>
                <span className="dv-spend-eyebrow">Total AI Spend · Lifetime</span>
                <div className="dv-spend-val"><span className="dv-spend-cur">$</span>{spendStr}<span className="dv-spend-usd">USD est.</span></div>
                <span className="dv-spend-meta">
                  {cost?.operations ?? 0} processing run{(cost?.operations ?? 0) === 1 ? '' : 's'}
                  {cost?.since ? ` · since ${new Date(cost.since).toLocaleDateString()}` : ''}
                </span>
              </div>
            </div>
            <div className="dv-spend-stats">
              <div className="dv-spend-stat dv-spend-stat-key"><b>${(cost?.avg_per_resume ?? 0).toFixed(4)}</b><span>Avg / Résumé</span></div>
              <div className="dv-spend-stat"><b>{(cost?.resumes ?? 0).toLocaleString()}</b><span>Résumés</span></div>
              <div className="dv-spend-stat"><b>{fmtTokens(cost?.prompt_tokens ?? 0)}</b><span>Prompt</span></div>
              <div className="dv-spend-stat"><b>{fmtTokens(cost?.completion_tokens ?? 0)}</b><span>Completion</span></div>
              <div className="dv-spend-stat"><b>{fmtTokens(cost?.embedding_tokens ?? 0)}</b><span>Embedding</span></div>
            </div>
          </div>
          <div className="dv-spend-bottom">
            <p className="dv-spend-note">Estimated OpenAI cost across résumé processing, JD parsing and re-matching · tracked independently of Activity, so clearing batch history never resets it.</p>
          </div>
        </section>
      )}

      <section className="dv-card dv-funnel-card">
        <div className="dv-card-head">
          <div>
            <h3 className="dv-card-title">Hiring Funnel</h3>
            <p className="dv-card-sub">Candidate progression from résumé pool to hire</p>
          </div>
        </div>
        {loading ? <div className="dv-loading">Loading…</div> : (
          <div className="dv-flow">
            {funnelSteps.map((s, i) => {
              const prev = funnelSteps[i - 1]?.val
              const conv = i > 0 && prev ? Math.round((s.val / prev) * 100) : null
              const pct = s.val > 0 ? Math.max((s.val / funnelMax) * 100, 5) : 0
              return (
                <Fragment key={s.label}>
                  <div className="dv-flow-card" style={{ background: `linear-gradient(180deg, ${s.cBg} 0%, #fff 58%)` }}>
                    <span className="dv-flow-top" style={{ background: s.grad }} />
                    <span className="dv-flow-icon" style={{ background: s.cBg, color: s.c }}>{s.icon}</span>
                    <span className="dv-flow-val">{s.val.toLocaleString()}</span>
                    <span className="dv-flow-name">{s.label}</span>
                    <span className="dv-flow-meter"><i style={{ width: `${pct}%`, background: s.grad }} /></span>
                    <span className="dv-flow-conv" style={{ color: s.c, background: s.cBg }}>
                      {i === 0 ? 'entry point' : conv !== null ? `${conv}% of prev` : 'no prior'}
                    </span>
                  </div>
                  {i < funnelSteps.length - 1 && <span className="dv-flow-arrow"><ChevronIcon /></span>}
                </Fragment>
              )
            })}
          </div>
        )}
      </section>

      {!loading && analytics && (
        <section className="dv-stat-row">
          <div className="dv-card dv-stat-card">
            <div className="dv-card-head">
              <div>
                <h3 className="dv-card-title">Time to Hire</h3>
                <p className="dv-card-sub">Average days from invite to hire decision</p>
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
                <p className="dv-card-sub">Share of sent offers accepted by candidates</p>
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

      {!loading && analytics && dropOff.length > 0 && (
        <section className="dv-card dv-funnel-card">
          <div className="dv-card-head">
            <div>
              <h3 className="dv-card-title">Candidate Drop-off</h3>
              <p className="dv-card-sub">Attrition across pipeline stages</p>
            </div>
          </div>
          <div className="dv-flow">
            {dropOff.map((s, i) => {
              const max = dropOff[0]?.count || 1
              const pct = s.count > 0 ? Math.max((s.count / max) * 100, 5) : 0
              return (
                <Fragment key={s.stage}>
                  <div className="dv-flow-card" style={{ background: 'linear-gradient(180deg, #e6edfe 0%, #fff 58%)' }}>
                    <span className="dv-flow-top" style={{ background: 'linear-gradient(90deg,#222022,#343234)' }} />
                    <span className="dv-flow-val">{s.count.toLocaleString()}</span>
                    <span className="dv-flow-name">{titleCase(s.stage)}</span>
                    <span className="dv-flow-meter"><i style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#222022,#343234)' }} /></span>
                    <span className="dv-flow-conv" style={{ color: '#222022', background: '#e6edfe' }}>
                      {i === 0 ? 'entry point' : s.drop_pct_from_prev !== null ? `-${s.drop_pct_from_prev.toFixed(0)}% drop` : 'no prior'}
                    </span>
                  </div>
                  {i < dropOff.length - 1 && <span className="dv-flow-arrow"><ChevronIcon /></span>}
                </Fragment>
              )
            })}
          </div>
        </section>
      )}

      {!loading && analytics && (
        <section className="dv-card">
          <div className="dv-card-head">
            <div>
              <h3 className="dv-card-title">Recruiter Performance</h3>
              <p className="dv-card-sub">Invites, hires and average time-to-hire by recruiter</p>
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
          <ChartCard title="By Domain"     sub="Candidate pool by job domain"        data={stats.by_domain}     grad="linear-gradient(90deg,#4778f3,#7297f6)" />
          <ChartCard title="By Seniority"  sub="Experience-level distribution"        data={stats.by_seniority}  grad="linear-gradient(90deg,#222022,#3b5b9a)" />
          <ChartCard title="By Experience" sub="Years of professional experience"     data={stats.by_experience} grad="linear-gradient(90deg,#6d28d9,#a78bfa)" />
          <ChartCard title="By Education"  sub="Highest education level"              data={stats.by_education}  grad="linear-gradient(90deg,#0d9488,#5eead4)" />
          <ChartCard title="Top Skills"    sub="Most common skills in the pool"       data={stats.top_skills}    grad="linear-gradient(90deg,#be123c,#fb7185)" />
          <ChartCard title="JDs by Source" sub="Where job descriptions came from"     data={bySource} grad="linear-gradient(90deg,#385fc0,#fbbf24)"
            empty="No job descriptions yet." />
          {analytics && (
            <ChartCard title="Applications by Source" sub="Where applications originated" data={sourceWiseApplications}
              grad="linear-gradient(90deg,#7c3aed,#c4b5fd)" empty="No application source data yet." />
          )}
        </section>
      )}

      {!loading && analytics && (
        <section className="dv-2col">
          <div className="dv-card">
            <div className="dv-card-head">
              <div>
                <h3 className="dv-card-title">AI Recommendations</h3>
                <p className="dv-card-sub">Suggested actions based on current pipeline data</p>
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

          <div className="dv-card">
            <div className="dv-card-head">
              <div>
                <h3 className="dv-card-title">Diversity Metrics</h3>
                <p className="dv-card-sub">Diversity metrics aren't available yet</p>
              </div>
            </div>
            <p className="dv-note">{diversityNote}</p>
          </div>
        </section>
      )}

      {showImport && <ImportJDModal onClose={() => setShowImport(false)} onImported={loadAll} />}
      {showUpload && <UploadResumesModal onClose={() => setShowUpload(false)} onUploaded={loadAll} />}
    </div>
  )
}
