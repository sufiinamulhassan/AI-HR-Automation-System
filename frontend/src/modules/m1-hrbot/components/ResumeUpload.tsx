import { useEffect, useRef, useState } from 'react'
import { jobsApi, resumesApi } from '../../../lib/api'
import { useModelStore } from '../../../store/model.store'
import { useUploadStore } from '../../../store/upload.store'
import './ResumeUpload.css'


const UploadCloudIcon = () => (
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="1.5"
    strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.8, marginBottom: '0.75rem' }}>
    <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
    <path d="M12 12v9" />
    <polyline points="16 16 12 12 8 16" />
  </svg>
)

const DocumentIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round"
    style={{ display: 'inline-block', marginRight: '5px', verticalAlign: 'middle' }}>
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
)

const ChevronIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
    strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
)

const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
    strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="7" /><line x1="20" y1="20" x2="16.65" y2="16.65" />
  </svg>
)

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
    strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
)

const ALL_JOBS_LABEL = 'Match against all open jobs'

interface JobOption { job_id: string; title?: string }

interface Props { onSubmitted?: () => void }

type Outcome =
  | { kind: 'duplicate'; resumeId: string; message: string }
  | { kind: 'error'; message: string }

function isValidResume(f: File) {
  const base = (f.name || '').replace(/\\/g, '/').split('/').pop() || ''
  return /\.(pdf|docx)$/i.test(base) && !base.startsWith('~$') && !base.startsWith('._') && !base.startsWith('.')
}

export default function ResumeUpload({ onSubmitted }: Props) {
  const activeModel = useModelStore(s => s.activeModel)
  const inputRef = useRef<HTMLInputElement>(null)
  const comboRef = useRef<HTMLDivElement>(null)
  const comboSearchRef = useRef<HTMLInputElement>(null)

  const [files, setFiles] = useState<File[]>([])
  const [jobs, setJobs] = useState<JobOption[]>([])
  const [jobId, setJobId] = useState('')
  const [comboOpen, setComboOpen] = useState(false)
  const [jobQuery, setJobQuery] = useState('')
  const [pinning, setPinning] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  const batchStatus = useUploadStore(s => s.batch)
  const bulkUploading = useUploadStore(s => s.uploading)
  const bulkError = useUploadStore(s => s.error)
  const startUpload = useUploadStore(s => s.startUpload)

  useEffect(() => {
    jobsApi.list({ limit: 100 })
      .then(r => setJobs(r.data?.jobs ?? r.data?.items ?? []))
      .catch(() => setJobs([]))
  }, [])

  useEffect(() => {
    if (!comboOpen) return
    comboSearchRef.current?.focus()
    function onPointerDown(e: MouseEvent) {
      if (!comboRef.current?.contains(e.target as Node)) setComboOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setComboOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [comboOpen])

  function addFiles(incoming: File[]) {
    setOutcome(null)
    setFiles(prev => [...prev, ...incoming.filter(isValidResume)])
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    addFiles(Array.from(e.dataTransfer.files))
  }

  const jobLabel = (j: JobOption) => j.title || j.job_id
  const query = jobQuery.trim().toLowerCase()
  const visibleJobs = query
    ? jobs.filter(j => jobLabel(j).toLowerCase().includes(query))
    : jobs
  const selectedLabel = jobId
    ? (jobs.find(j => j.job_id === jobId)?.title || jobId)
    : ALL_JOBS_LABEL

  const targetingLocked = files.length > 1
  const willPin = files.length === 1 && !!jobId
  const uploading = bulkUploading || pinning

  function chooseJob(id: string) {
    setJobId(id)
    setComboOpen(false)
    setJobQuery('')
  }

  async function upload() {
    if (!files.length) return
    setOutcome(null)

    if (willPin) {
      setPinning(true)
      try {
        const r = await resumesApi.upload(files[0], jobId, activeModel || undefined)
        if (r.data?.status === 'duplicate') {
          setOutcome({
            kind: 'duplicate',
            resumeId: r.data.resume_id,
            message: r.data.message || 'This resume has already been uploaded.',
          })
        } else {
          setFiles([])
          if (inputRef.current) inputRef.current.value = ''
          onSubmitted?.()
        }
      } catch (e) {
        const err = e as { response?: { data?: { detail?: string } } }
        setOutcome({ kind: 'error', message: err?.response?.data?.detail || 'Upload failed. Please try again.' })
      }
      setPinning(false)
      return
    }

    const ok = await startUpload(files, activeModel || undefined)
    if (ok) {
      setFiles([])
      if (inputRef.current) inputRef.current.value = ''
      onSubmitted?.()
    }
  }

  const handled = batchStatus
    ? batchStatus.processed + batchStatus.skippedDuplicates + batchStatus.failed
    : 0
  const pct = batchStatus && batchStatus.totalFiles > 0
    ? Math.round((handled / batchStatus.totalFiles) * 100)
    : 0

  return (
    <div className="ru-panel">
      <p className="ru-sub">
        Drop up to 500 PDF or DOCX résumés - one or a whole folder. AI processing starts
        automatically in the background. Legacy <strong>.doc</strong> files aren't supported -
        save them as PDF or DOCX first.
      </p>

      <div
        className="ru-drop"
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
        onClick={() => inputRef.current?.click()}
      >
        <UploadCloudIcon />
        <span>Drag &amp; drop files here, or click to browse</span>
        <span className="ru-drop-hint">PDF &amp; DOCX supported</span>
        <input
          ref={inputRef} type="file" multiple accept=".pdf,.docx" hidden
          onChange={e => addFiles(Array.from(e.target.files || []))}
        />
      </div>

      {files.length > 0 && (
        <div className="ru-file-list">
          <div className="ru-file-list-header">
            <span>{files.length} file{files.length > 1 ? 's' : ''} selected</span>
            <button className="ru-btn-ghost" onClick={() => { setFiles([]); setOutcome(null) }}>Clear</button>
          </div>
          <div className="ru-file-items">
            {files.slice(0, 10).map((f, i) => (
              <div key={i} className="ru-file-item">
                <span><DocumentIcon /> {f.name}</span>
                <span className="ru-file-size">{(f.size / 1024).toFixed(0)} KB</span>
              </div>
            ))}
            {files.length > 10 && <div className="ru-file-more">+{files.length - 10} more</div>}
          </div>
        </div>
      )}

      <div className="ru-field">
        <span className="form-label" id="ru-jd-label">Target job description (optional)</span>

        <div className="ru-combo" ref={comboRef}>
          <button
            type="button"
            className={`ru-combo-trigger${comboOpen ? ' open' : ''}`}
            aria-haspopup="listbox"
            aria-expanded={comboOpen}
            aria-labelledby="ru-jd-label"
            disabled={targetingLocked}
            onClick={() => setComboOpen(o => !o)}
          >
            <span className={jobId ? 'ru-combo-value' : 'ru-combo-value muted'}>{selectedLabel}</span>
            <ChevronIcon />
          </button>

          {comboOpen && (
            <div className="ru-combo-panel">
              <div className="ru-combo-search">
                <SearchIcon />
                <input
                  ref={comboSearchRef}
                  type="text"
                  value={jobQuery}
                  placeholder="Search job descriptions…"
                  onChange={e => setJobQuery(e.target.value)}
                />
              </div>

              <ul className="ru-combo-list" role="listbox" aria-labelledby="ru-jd-label">
                {!query && (
                  <li>
                    <button
                      type="button" role="option" aria-selected={!jobId}
                      className={`ru-combo-option${!jobId ? ' selected' : ''}`}
                      onClick={() => chooseJob('')}
                    >
                      <span>{ALL_JOBS_LABEL}</span>
                      {!jobId && <CheckIcon />}
                    </button>
                  </li>
                )}
                {visibleJobs.map(j => (
                  <li key={j.job_id}>
                    <button
                      type="button" role="option" aria-selected={jobId === j.job_id}
                      className={`ru-combo-option${jobId === j.job_id ? ' selected' : ''}`}
                      onClick={() => chooseJob(j.job_id)}
                    >
                      <span>{jobLabel(j)}</span>
                      {jobId === j.job_id && <CheckIcon />}
                    </button>
                  </li>
                ))}
                {!visibleJobs.length && (
                  <li className="ru-combo-empty">
                    {jobs.length ? 'No job descriptions match that search.' : 'No open job descriptions.'}
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>

        <span className="ru-hint">
          {targetingLocked
            ? 'Targeting applies to a single résumé - this batch will be matched against every open JD.'
            : "Choosing a job pins the résumé to that job's pipeline even if the matcher wouldn't have surfaced it. It still carries its real match score, so check the pipeline's score filter if it doesn't appear."}
        </span>
      </div>

      {bulkError && <div className="ru-error">{bulkError}</div>}
      {outcome?.kind === 'error' && <div className="ru-error">{outcome.message}</div>}
      {outcome?.kind === 'duplicate' && (
        <div className="ru-warn">
          {outcome.message} Nothing was created - the existing record{' '}
          <code>{outcome.resumeId?.slice(0, 8)}</code> already covers this file.
        </div>
      )}

      {batchStatus && (
        <div className="ru-progress">
          <div className="ru-progress-header">
            <span className={`ru-status-badge ru-status-${batchStatus.status}`}>
              {batchStatus.status}
            </span>
            {batchStatus.uploadedBy && (
              <span className="ru-progress-by">by {batchStatus.uploadedBy}</span>
            )}
          </div>

          <div className="ru-metrics">
            <div className="ru-metric">
              <span className="ru-metric-val">{batchStatus.processed || 0}</span>
              <span className="ru-metric-label">Processed</span>
            </div>
            <div className="ru-metric ru-metric-highlight">
              <span className="ru-metric-val">{batchStatus.autoInvited || 0}</span>
              <span className="ru-metric-label">Auto-Invited</span>
            </div>
            <div className="ru-metric ru-metric-warn">
              <span className="ru-metric-val">{batchStatus.skippedDuplicates || 0}</span>
              <span className="ru-metric-label">Skipped</span>
            </div>
            <div className="ru-metric ru-metric-danger">
              <span className="ru-metric-val">{batchStatus.failed || 0}</span>
              <span className="ru-metric-label">Failed</span>
            </div>
          </div>

          <div className="ru-progress-bar-wrap">
            <div className="ru-progress-bar" style={{ width: `${pct}%` }} />
          </div>
          <div className="ru-progress-label">{pct}% of {batchStatus.totalFiles} files complete</div>
        </div>
      )}

      <div className="ru-footer">
        <button className="btn-primary" onClick={upload} disabled={uploading || !files.length}>
          {uploading
            ? 'Uploading…'
            : files.length
              ? `Upload ${files.length} file${files.length !== 1 ? 's' : ''}${willPin ? ' to this JD' : ''}`
              : 'Upload'}
        </button>
      </div>
    </div>
  )
}
