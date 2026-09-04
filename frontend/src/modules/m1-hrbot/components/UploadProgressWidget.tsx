import { useUploadStore } from '../../../store/upload.store'
import './UploadProgressWidget.css'

const SpinnerIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="upw-spin">
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
)

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
)

const AlertIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
)

export default function UploadProgressWidget({ onOpen }: { onOpen: () => void }) {
  const batch   = useUploadStore(s => s.batch)
  const dismiss = useUploadStore(s => s.dismiss)

  if (!batch) return null

  const done   = batch.status === 'completed'
  const failed = batch.status === 'failed'
  const handled = batch.processed + batch.skippedDuplicates + batch.failed
  const pct = batch.totalFiles > 0 ? Math.round((handled / batch.totalFiles) * 100) : 0
  const hasFailures = batch.failed > 0

  const warn = failed || (done && hasFailures)
  const icon = warn ? <AlertIcon /> : done ? <CheckIcon /> : <SpinnerIcon />
  const title = failed ? 'Upload failed'
    : done ? (hasFailures ? `Done - ${batch.failed} failed` : 'Upload complete')
    : 'Processing resumes…'

  return (
    <div
      className={`upw${done && !hasFailures ? ' upw-done' : ''}${warn ? ' upw-failed' : ''}`}
      onClick={onOpen}
      role="button"
      title="Click to view upload details"
    >
      <div className="upw-icon">{icon}</div>
      <div className="upw-body">
        <div className="upw-title">{title}</div>
        <div className="upw-sub">
          {batch.processed} processed{batch.skippedDuplicates > 0 && ` · ${batch.skippedDuplicates} dup`}{hasFailures && ` · ${batch.failed} failed`} · {pct}%
        </div>
        <div className="upw-bar-wrap">
          <div className="upw-bar" style={{ width: `${done ? 100 : pct}%` }} />
        </div>
      </div>
      <button
        className="upw-close"
        title="Dismiss"
        onClick={e => { e.stopPropagation(); dismiss() }}
      >
        ✕
      </button>
    </div>
  )
}
