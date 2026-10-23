import { useEffect, useState } from 'react'
import { hrmsApi } from '../../lib/api'
import Pagination, { usePaged } from './Pagination'
import { errorText, type HireQuality, type RiskRadar, type RiskRow } from './hrmsTypes'

const VERDICT_BADGE: Record<string, string> = {
  'Strong hire': 'badge-green',
  'On track': 'badge-blue',
  'Below expectations': 'badge-red',
  'No review yet': 'badge-gray',
  'Too early to tell': 'badge-gray',
}

const LEVEL_LABEL: Record<RiskRow['level'], string> = { high: 'High risk', medium: 'Watch', low: 'Low risk' }
const LEVEL_BADGE: Record<RiskRow['level'], string> = { high: 'badge-red', medium: 'badge-yellow', low: 'badge-green' }

function score(value: number | null, suffix = '') {
  return value === null ? <span className="hr-muted">-</span> : `${Math.round(value)}${suffix}`
}

function HireQualityPanel() {
  const [data, setData] = useState<HireQuality | null>(null)
  const [error, setError] = useState('')
  const paged = usePaged(data?.rows ?? [], 10)

  useEffect(() => {
    let live = true
    hrmsApi.hireQuality()
      .then(r => { if (live) setData(r.data) })
      .catch(err => { if (live) setError(errorText(err, 'Could not load hire quality.')) })
    return () => { live = false }
  }, [])

  return (
    <section className="card hr-card" aria-labelledby="hr-hq">
      <h3 className="hr-card-title" id="hr-hq">Hire quality: did good interviews become good employees?</h3>
      <p className="hr-muted hr-lead">
        Everyone hired through Hirely, with the résumé match and AI interview score they had when hired, next to their performance
        reviews and attendance since joining.
      </p>
      {error && <p className="hr-error" role="alert">{error}</p>}
      {!data && !error && <p className="hr-muted" role="status">Loading hire quality...</p>}
      {data && (
        <>
          <div className="hr-tiles hr-tiles-sm">
            <div className="hr-stat"><span className="hr-tile-label">Hired through Hirely</span><span className="hr-tile-value">{data.hired_through_hirely}</span></div>
            <div className="hr-stat"><span className="hr-tile-label">Strong interview, avg performance</span><span className="hr-tile-value">{score(data.strong_interview_performance)}</span><span className="hr-tile-hint">Interview score 70 or more</span></div>
            <div className="hr-stat"><span className="hr-tile-label">Other hires, avg performance</span><span className="hr-tile-value">{score(data.other_interview_performance)}</span><span className="hr-tile-hint">Interview score under 70</span></div>
            <div className="hr-stat"><span className="hr-tile-label">Left within 6 months</span><span className="hr-tile-value">{data.early_exits}</span></div>
          </div>
          <p className={`hr-verdict${data.correlation !== null && data.correlation < 0.2 ? ' hr-verdict-warn' : ''}`} role="note">
            {data.correlation_label}
            {data.correlation !== null && <span className="hr-muted"> Correlation {data.correlation.toFixed(2)} across {data.paired} hires.</span>}
          </p>
          {data.rows.length === 0 ? (
            <p className="hr-empty">Nobody has been hired through Hirely yet. Accepted offers show up here once they join.</p>
          ) : (
            <div className="hr-table-wrap">
              <table className="hr-table">
                <thead><tr><th>Employee</th><th>Résumé match</th><th>AI interview</th><th>Performance</th><th>Attendance</th><th>Verdict</th></tr></thead>
                <tbody>
                  {paged.slice.map(r => (
                    <tr key={r.employee_id}>
                      <td><div className="hr-strong">{r.full_name}</div><div className="hr-muted">{[r.designation, r.department_name].filter(Boolean).join(', ') || '-'}</div></td>
                      <td>{score(r.match_score, '%')}</td>
                      <td>{score(r.interview_score)}</td>
                      <td className="hr-strong">{score(r.performance_score)}</td>
                      <td>{score(r.attendance_rate, '%')}</td>
                      <td><span className={`badge ${VERDICT_BADGE[r.verdict] ?? 'badge-gray'}`}>{r.verdict}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination label="hires" page={paged.page} pages={paged.pages} total={paged.total} size={paged.size} onPage={paged.setPage} onSize={paged.setSize} />
            </div>
          )}
        </>
      )}
    </section>
  )
}

function RiskPanel() {
  const [data, setData] = useState<RiskRadar | null>(null)
  const [error, setError] = useState('')
  const [only, setOnly] = useState<'all' | 'risk' | 'burnout'>('risk')

  useEffect(() => {
    let live = true
    hrmsApi.riskRadar()
      .then(r => { if (live) setData(r.data) })
      .catch(err => { if (live) setError(errorText(err, 'Could not load the risk radar.')) })
    return () => { live = false }
  }, [])

  const rows = (data?.rows ?? []).filter(r => only === 'all' || (only === 'burnout' ? r.burnout : r.level !== 'low'))
  const paged = usePaged(rows, 10, only)

  return (
    <section className="card hr-card" aria-labelledby="hr-risk">
      <h3 className="hr-card-title" id="hr-risk">Flight risk and burnout radar</h3>
      <p className="hr-muted hr-lead">
        Built from leave patterns, attendance trends, working hours, reviews and reporting lines. Every score lists the reasons behind it,
        so you can start a conversation before someone resigns.
      </p>
      {error && <p className="hr-error" role="alert">{error}</p>}
      {!data && !error && <p className="hr-muted" role="status">Loading risk radar...</p>}
      {data && (
        <>
          <div className="hr-toolbar">
            <div className="hr-seg" role="group" aria-label="Show">
              <button type="button" className={`hr-seg-btn${only === 'risk' ? ' hr-seg-on' : ''}`} aria-pressed={only === 'risk'} onClick={() => setOnly('risk')}>
                At risk ({data.counts.high + data.counts.medium})
              </button>
              <button type="button" className={`hr-seg-btn${only === 'burnout' ? ' hr-seg-on' : ''}`} aria-pressed={only === 'burnout'} onClick={() => setOnly('burnout')}>
                Burnout ({data.burnout})
              </button>
              <button type="button" className={`hr-seg-btn${only === 'all' ? ' hr-seg-on' : ''}`} aria-pressed={only === 'all'} onClick={() => setOnly('all')}>
                Everyone ({data.rows.length})
              </button>
            </div>
          </div>
          {rows.length === 0 ? (
            <p className="hr-empty">{only === 'all' ? 'No current employees yet.' : 'Nobody shows these signals right now.'}</p>
          ) : (
            <ul className="hr-risk-list" aria-label="Employees by risk">
              {paged.slice.map(r => (
                <li key={r.employee_id} className={`hr-risk hr-risk-${r.level}`}>
                  <div className="hr-risk-head">
                    <div>
                      <div className="hr-strong">{r.full_name}</div>
                      <div className="hr-muted">{[r.designation, r.department_name].filter(Boolean).join(', ') || '-'}</div>
                    </div>
                    <div className="hr-risk-score">
                      {r.burnout && <span className="badge badge-yellow">Burnout signs</span>}
                      <span className={`badge ${LEVEL_BADGE[r.level]}`}>{LEVEL_LABEL[r.level]}</span>
                      <span className="hr-risk-num" aria-label={`Risk score ${r.score} out of 100`}>{r.score}</span>
                    </div>
                  </div>
                  {r.signals.length > 0 ? (
                    <ul className="hr-signals">
                      {r.signals.map(s => <li key={s.text}><span className={`hr-dot hr-dot-${s.kind}`} aria-hidden="true" />{s.text}</li>)}
                    </ul>
                  ) : <p className="hr-muted">No warning signs.</p>}
                </li>
              ))}
            </ul>
          )}
          <Pagination label="people" page={paged.page} pages={paged.pages} total={paged.total} size={paged.size} onPage={paged.setPage} onSize={paged.setSize} />
        </>
      )}
    </section>
  )
}

export default function InsightsTab() {
  return (
    <div className="hr-stack">
      <HireQualityPanel />
      <RiskPanel />
    </div>
  )
}
