import { useEffect, useState } from 'react'
import { resumesApi, type ResumeJobScore } from '../../../lib/api'
import './ResumeJobsModal.css'

interface Props {
  resumeId: string
  candidateName: string
  onClose: () => void
}

type Load =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; jobs: ResumeJobScore[] }

const STAGE_LABELS: Record<string, string> = {
  matched: 'Matched',
  shortlisted: 'Shortlisted',
  invited: 'Invited',
  interviewing: 'Interviewing',
  completed: 'Interview done',
  hired: 'Hired',
  rejected: 'Rejected',
}

export function scorePercent(score: number | null | undefined): number | null {
  if (typeof score !== 'number' || Number.isNaN(score)) return null
  return Math.round(Math.max(0, Math.min(1, score)) * 100)
}

function scoreTone(percent: number): string {
  if (percent >= 70) return 'rjm-high'
  if (percent >= 50) return 'rjm-mid'
  return 'rjm-low'
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

export default function ResumeJobsModal({ resumeId, candidateName, onClose }: Props) {
  const [load, setLoad] = useState<Load>({ state: 'loading' })

  useEffect(() => {
    let cancelled = false
    resumesApi.jobScores(resumeId)
      .then(r => { if (!cancelled) setLoad({ state: 'ready', jobs: r.data?.jobs ?? [] }) })
      .catch((err: { response?: { data?: { detail?: string } } }) => {
        if (!cancelled) setLoad({ state: 'error', message: err?.response?.data?.detail || 'Could not load the job matches.' })
      })
    return () => { cancelled = true }
  }, [resumeId])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const jobs = load.state === 'ready' ? load.jobs : []
  const active = jobs.filter(j => j.status === 'active')

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-box rjm" role="dialog" aria-modal="true" aria-labelledby="rjm-title">
        <div className="modal-header rjm-head">
          <div className="rjm-head-text">
            <h2 id="rjm-title">Job matches</h2>
            <p className="rjm-sub">
              {load.state === 'ready'
                ? jobs.length === 0
                  ? `${candidateName} is not in any job description yet.`
                  : `${candidateName} appears in ${active.length} job description${active.length === 1 ? '' : 's'}, highest score first.`
                : candidateName}
            </p>
          </div>
          <button type="button" className="modal-close rjm-close" aria-label="Close" onClick={onClose} autoFocus>
            <CloseIcon />
          </button>
        </div>

        <div className="rjm-body">
          {load.state === 'loading' && <p className="rjm-state" role="status">Loading job matches...</p>}
          {load.state === 'error' && <p className="rjm-state rjm-error" role="alert">{load.message}</p>}
          {load.state === 'ready' && jobs.length > 0 && (
            <ol className="rjm-list" aria-label={`Job matches for ${candidateName}`}>
              {jobs.map(job => {
                const percent = scorePercent(job.score)
                const removed = job.status === 'removed'
                return (
                  <li key={job.job_id} className={`rjm-row${removed ? ' rjm-row-removed' : ''}`}>
                    <div className="rjm-job">
                      <span className="rjm-title" title={job.title}>{job.title || 'Untitled job'}</span>
                      <span className="rjm-meta">
                        {removed
                          ? 'Low score, removed by admin'
                          : `${candidateName} scored ${percent === null ? 'no score yet' : `${percent}`} against this JD`}
                        {!removed && job.stage ? ` · ${STAGE_LABELS[job.stage] ?? job.stage}` : ''}
                      </span>
                    </div>
                    {removed ? (
                      <span className="rjm-score rjm-removed">Low score</span>
                    ) : percent === null ? (
                      <span className="rjm-score rjm-none">No score</span>
                    ) : (
                      <span className={`rjm-score ${scoreTone(percent)}`} aria-label={`Score ${percent} out of 100`}>{percent}</span>
                    )}
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      </div>
    </div>
  )
}
