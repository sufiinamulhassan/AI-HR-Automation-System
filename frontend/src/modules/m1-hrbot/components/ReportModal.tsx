import { useEffect, useState } from 'react'
import { interviewApi } from '../../../lib/api'
import { toTurns, type TranscriptEntry } from '../lib/transcript'
import './ReportModal.css'

interface Props { token: string; onClose: () => void }

interface Report {
  overall_score?: number
  technical_score?: number
  communication_score?: number
  problem_solving_score?: number
  cultural_fit_score?: number
  confidence_score?: number
  integrity_score?: number
  recommendation?: string
  summary?: string
  strengths?: string[]
  areas_for_improvement?: string[]
  integrity_assessment?: string
  scenario_scores?: Record<string, number>
  evaluation_status?: string
  coding_score?: number
  coding_quality_score?: number
}

interface ReportData {
  candidate_id?: string
  name?: string
  email?: string
  job_id?: string
  eval_score?: number
  status?: string
  invite_type?: string
  match_score?: number
  transcript?: TranscriptEntry[]
  integrity_flags?: string[]
  report?: Report
}

export default function ReportModal({ token, onClose }: Props) {
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [pdfLoading, setPdfLoading] = useState(false)

  useEffect(() => {
    interviewApi.report(token)
      .then(r => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [token])

  async function downloadPdf() {
    setPdfLoading(true)
    try {
      const r = await interviewApi.reportPdf(token)
      const url = URL.createObjectURL(r.data as Blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `report_${token.slice(0, 8)}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {}
    finally { setPdfLoading(false) }
  }

  function formatDate(iso?: string) {
    if (!iso) return ''
    return new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
  }

  const report = data?.report
  const turns = toTurns(data?.transcript ?? [])
  const unscored = report?.evaluation_status === 'insufficient_transcript'

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card wide" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Interview Report{data?.name ? ` - ${data.name}` : ''}</h2>
          <div className="modal-header-actions">
            <button
              className="btn-ghost"
              onClick={downloadPdf}
              disabled={pdfLoading || loading || !data}
            >
              {pdfLoading ? 'Downloading…' : '⬇ PDF'}
            </button>
            <button className="modal-close" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="report-body">
          {loading && <p className="report-loading">Loading report…</p>}
          {!loading && !data && (
            <p className="report-empty">
              Report not available yet. The evaluation may still be processing.
            </p>
          )}

          {data && (
            <>
              <div className="report-meta-grid">
                {data.name && (
                  <div className="report-meta-item">
                    <span className="report-meta-label">Candidate</span>
                    <span className="report-meta-val">{data.name}</span>
                  </div>
                )}
                {data.email && (
                  <div className="report-meta-item">
                    <span className="report-meta-label">Email</span>
                    <span className="report-meta-val">{data.email}</span>
                  </div>
                )}
                {data.status && (
                  <div className="report-meta-item">
                    <span className="report-meta-label">Status</span>
                    <span className={`report-stage report-stage-${data.status}`}>{data.status}</span>
                  </div>
                )}
                {data.invite_type && (
                  <div className="report-meta-item">
                    <span className="report-meta-label">Invite Type</span>
                    <span className="report-meta-val">{data.invite_type}</span>
                  </div>
                )}
                {data.eval_score != null && !unscored && (
                  <div className="report-meta-item">
                    <span className="report-meta-label">Eval Score</span>
                    <span className="report-meta-score">{data.eval_score}</span>
                  </div>
                )}
                {data.match_score != null && (
                  <div className="report-meta-item">
                    <span className="report-meta-label">Match Score</span>
                    <span className="report-meta-score">{(data.match_score * 100).toFixed(0)}%</span>
                  </div>
                )}
              </div>

              {report && (
                <>
                  {report.evaluation_status === 'insufficient_transcript' && (
                    <div className="report-warning">
                      ⚠ No answer content was captured for this session, so the
                      general score dimensions could not be derived. Integrity
                      scoring is computed separately and remains valid.
                    </div>
                  )}

                  <div className="score-grid">
                    {([
                      ['Overall',         report.overall_score],
                      ['Technical',       report.technical_score],
                      ['Communication',   report.communication_score],
                      ['Problem Solving', report.problem_solving_score],
                      ['Cultural Fit',    report.cultural_fit_score],
                      ['Confidence',      report.confidence_score],
                      ['Integrity',       report.integrity_score],
                      ...(report.coding_score != null
                        ? [['Coding (tests)', report.coding_score]] as [string, number][] : []),
                      ...(report.coding_quality_score != null
                        ? [['Coding (quality)', report.coding_quality_score]] as [string, number][] : []),
                    ] as [string, number | undefined][]).map(([label, val]) => (
                      <div key={label} className="score-tile">
                        <div className="score-num">{val ?? '-'}</div>
                        <div className="score-label">{label}</div>
                      </div>
                    ))}
                    {report.recommendation && (
                      <div className={`rec-tile rec-${report.recommendation}`}>
                        <div className="rec-val">{report.recommendation.toUpperCase()}</div>
                        <div className="rec-label">Recommendation</div>
                      </div>
                    )}
                  </div>

                  {!!(report.scenario_scores && Object.keys(report.scenario_scores).length) && (
                    <div className="score-grid">
                      {Object.entries(report.scenario_scores!).map(([dim, val]) => (
                        <div key={dim} className="score-tile">
                          <div className="score-num">{val ?? '-'}</div>
                          <div className="score-label">{dim.replace(/_/g, ' ')}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {report.summary && (
                    <p className="report-summary">{report.summary}</p>
                  )}

                  {(!!(report.strengths?.length) || !!(report.areas_for_improvement?.length)) && (
                    <div className="report-lists">
                      {!!(report.strengths?.length) && (
                        <div>
                          <h4>Strengths</h4>
                          <ul>
                            {report.strengths!.map((s, i) => <li key={i}>{s}</li>)}
                          </ul>
                        </div>
                      )}
                      {!!(report.areas_for_improvement?.length) && (
                        <div>
                          <h4>Areas for Improvement</h4>
                          <ul>
                            {report.areas_for_improvement!.map((s, i) => <li key={i}>{s}</li>)}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  {report.integrity_assessment && (
                    <div className="integrity-assessment">
                      <h4>Integrity Assessment</h4>
                      <p>{report.integrity_assessment}</p>
                    </div>
                  )}
                </>
              )}

              {!!(data.integrity_flags?.length) && (
                <div className="integrity-section">
                  <h4>⚠ Integrity Flags</h4>
                  {data.integrity_flags!.map((f, i) => (
                    <div key={i} className="flag-item">{f}</div>
                  ))}
                </div>
              )}

              {!!turns.length && (
                <div className="report-transcript">
                  <h4>Transcript <span className="tr-count">({turns.length} messages)</span></h4>
                  <div className="transcript-scroll">
                    {turns.map((msg, i) => (
                      <div key={i} className={`tr-msg tr-msg-${msg.role}`}>
                        <div className="tr-msg-meta">
                          <span className="tr-msg-role">{msg.role}</span>
                          {msg.timestamp && (
                            <span className="tr-msg-time">{formatDate(msg.timestamp)}</span>
                          )}
                        </div>
                        <div className="tr-msg-content">{msg.content}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
