import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { jobsApi, type ComparisonRow, type JobComparison } from '../../../lib/api'
import { candidateLabel } from '../../../lib/erased'
import {
  RECOMMENDATION_BADGE, SCORE_COLUMNS, SOURCE_LABEL, bestRecommendation, bestScore, comparisonToCsv,
  csvFileName, defaultDirection, offerLabel, scoreOf, scoreText, sortRows, type SortKey, type SortState,
} from './comparison'
import { errorDetail } from './externalInterview'
import ReportModal from './ReportModal'
import { useDialog } from './useDialog'
import './CompareCandidatesModal.css'

interface Props {
  jobId: string
  jobTitle: string
  onClose: () => void
}

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)
const SortIcon = ({ dir }: { dir: 'asc' | 'desc' | null }) => (
  <svg width="9" height="12" viewBox="0 0 9 12" fill="currentColor" aria-hidden="true" className="cmp-sort-icon">
    <path d="M4.5 0 8 4.5H1z" opacity={dir === 'asc' ? 1 : 0.25} />
    <path d="M4.5 12 1 7.5h7z" opacity={dir === 'desc' ? 1 : 0.25} />
  </svg>
)

const STAGE_FILTERS = [
  { value: '', label: 'All stages' },
  { value: 'invited', label: 'Invited' },
  { value: 'interviewing', label: 'Interviewing' },
  { value: 'completed', label: 'Completed' },
  { value: 'hired', label: 'Hired' },
]

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'rank', label: 'Rank' },
  { key: 'name', label: 'Candidate' },
  { key: 'stage', label: 'Stage' },
  { key: 'source', label: 'Source' },
  ...SCORE_COLUMNS,
  { key: 'recommendation', label: 'Recommendation' },
  { key: 'offer_status', label: 'Offer' },
]

type LoadState = { status: 'loading' } | { status: 'error'; detail: string } | { status: 'ready'; data: JobComparison }

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

export default function CompareCandidatesModal({ jobId, jobTitle, onClose }: Props) {
  const titleId = useId()
  const [stage, setStage] = useState('')
  const [includeRejected, setIncludeRejected] = useState(false)
  const [sort, setSort] = useState<SortState>({ key: 'rank', dir: 'asc' })
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [reportToken, setReportToken] = useState<string | null>(null)
  const [exportProblem, setExportProblem] = useState('')

  const requestClose = useCallback(() => {
    if (reportToken) setReportToken(null)
    else onClose()
  }, [reportToken, onClose])
  const { boxRef, trapTab, onBackdropMouseDown, onBackdropClick } = useDialog(requestClose)

  useEffect(() => {
    let current = true
    setState({ status: 'loading' })
    jobsApi.comparison(jobId, { stage: stage || undefined, include_rejected: includeRejected })
      .then(r => { if (current) setState({ status: 'ready', data: r.data }) })
      .catch(e => { if (current) setState({ status: 'error', detail: errorDetail(e) }) })
    return () => { current = false }
  }, [jobId, stage, includeRejected, attempt])

  const rows = useMemo(() => (state.status === 'ready' ? sortRows(state.data.rows ?? [], sort) : []), [state, sort])

  const best = useMemo(() => {
    const scores: Partial<Record<SortKey, number | null>> = {}
    for (const col of SCORE_COLUMNS) scores[col.key] = bestScore(rows.map(r => scoreOf(r, col.key)))
    return { scores, recommendation: bestRecommendation(rows.map(r => r.recommendation)) }
  }, [rows])

  function toggleSort(key: SortKey) {
    setSort(s => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: defaultDirection(key) }))
  }

  function open(row: ComparisonRow) {
    if (row.secure_token) setReportToken(row.secure_token)
  }

  function exportCsv() {
    setExportProblem('')
    try {
      const blob = new Blob([comparisonToCsv(rows)], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = csvFileName(jobTitle)
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      setExportProblem('Could not export the CSV')
    }
  }

  const stats = state.status === 'ready' ? state.data.stats : null

  return (
    <>
      <div className="modal-overlay cmp-overlay" data-testid="compare-backdrop" onMouseDown={onBackdropMouseDown} onClick={onBackdropClick}>
        <div
          ref={boxRef}
          className="modal-box cmp-box"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          onKeyDown={trapTab}
        >
          <div className="modal-header cmp-header">
            <h2 id={titleId}>Compare candidates, {jobTitle}</h2>
            <button type="button" className="modal-close" aria-label="Close comparison" onClick={onClose}>
              <CloseIcon />
            </button>
          </div>

          <div className="cmp-toolbar">
            <label className="cmp-filter">
              <span className="form-label">Stage</span>
              <select className="form-input" value={stage} onChange={e => setStage(e.target.value)}>
                {STAGE_FILTERS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </label>
            <label className="cmp-check">
              <input type="checkbox" checked={includeRejected} onChange={e => setIncludeRejected(e.target.checked)} />
              <span>Include rejected</span>
            </label>
            {stats && stats.count > 0 && (
              <dl className="cmp-stats">
                <div><dt>Candidates</dt><dd>{stats.count}</dd></div>
                <div><dt>Average</dt><dd>{scoreText(stats.average)}</dd></div>
                <div><dt>Highest</dt><dd>{scoreText(stats.highest)}</dd></div>
              </dl>
            )}
            <button type="button" className="btn btn-ghost btn-sm cmp-export" disabled={rows.length === 0} onClick={exportCsv}>
              Export CSV
            </button>
          </div>

          <div className="cmp-body">
            {state.status === 'loading' && <div className="cmp-status" role="status">Loading comparison…</div>}

            {state.status === 'error' && (
              <div className="cmp-error" role="alert">
                <span>{state.detail || 'Could not load the comparison.'}</span>
                <button type="button" className="cmp-link-btn" onClick={() => setAttempt(a => a + 1)}>Retry</button>
              </div>
            )}

            {state.status === 'ready' && rows.length === 0 && (
              <p className="cmp-empty">{stage || includeRejected ? 'No candidates match these filters' : 'No interviewed candidates yet'}</p>
            )}

            {state.status === 'ready' && rows.length > 0 && (
              <div className="cmp-table-wrap">
                <table className="cmp-table">
                  <thead>
                    <tr>
                      {COLUMNS.map(col => {
                        const active = sort.key === col.key
                        return (
                          <th key={col.key} scope="col" aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                            <button type="button" className="cmp-sort" onClick={() => toggleSort(col.key)}>
                              {col.label}
                              <SortIcon dir={active ? sort.dir : null} />
                            </button>
                          </th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(row => {
                      const rec = row.recommendation ? RECOMMENDATION_BADGE[row.recommendation] : undefined
                      const recBest = row.recommendation !== null && row.recommendation === best.recommendation
                      return (
                        <tr key={row.candidate_id} className={`cmp-row${row.secure_token ? ' clickable' : ''}`} onClick={() => open(row)}>
                          <td className="cmp-rank">{row.rank}</td>
                          <td>
                            <button type="button" className={`cmp-name${row.erased ? ' cmp-name-erased' : ''}`} disabled={!row.secure_token}>
                              {candidateLabel(row)}
                            </button>
                          </td>
                          <td><span className="badge badge-gray">{row.stage ? capitalise(row.stage) : '-'}</span></td>
                          <td>
                            <span className={`badge ${row.source === 'ai' ? 'badge-blue' : 'badge-gray'}`}>
                              {SOURCE_LABEL[row.source] ?? row.source}
                            </span>
                          </td>
                          {SCORE_COLUMNS.map(col => {
                            const value = scoreOf(row, col.key)
                            const isBest = value !== null && value === best.scores[col.key]
                            return (
                              <td key={col.key} className={`cmp-score${isBest ? ' cmp-best' : ''}`} title={isBest ? 'Highest in this column' : undefined}>
                                {scoreText(value)}
                              </td>
                            )
                          })}
                          <td className={recBest ? 'cmp-best' : undefined} title={recBest ? 'Best in this column' : undefined}>
                            {rec ? <span className={`badge ${rec.tone}`}>{rec.label}</span> : '-'}
                          </td>
                          <td>{offerLabel(row.offer_status)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {exportProblem && <div className="cmp-error" role="alert">{exportProblem}</div>}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-primary" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>

      {reportToken && <ReportModal token={reportToken} onClose={() => setReportToken(null)} />}
    </>
  )
}
