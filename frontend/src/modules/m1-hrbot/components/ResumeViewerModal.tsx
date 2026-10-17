import { useEffect, useRef, useState } from 'react'
import { renderAsync } from 'docx-preview'
import { resumesApi } from '../../../lib/api'
import { resumeDownloadUrl } from '../../../lib/config'
import { useAuthStore } from '../../../store/auth.store'
import './ResumeViewerModal.css'

const EyeIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" fillOpacity="0.16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
  </svg>
)
const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)
const DownloadIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
)
const ExternalIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
    <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
  </svg>
)

interface Props {
  resumeId: string
  candidateName: string
  onClose: () => void
}

type Shown =
  | { kind: 'pdf'; url: string }
  | { kind: 'docx'; blob: Blob }
  | { kind: 'text'; text: string }

export default function ResumeViewerModal({ resumeId, candidateName, onClose }: Props) {
  const token = useAuthStore(s => s.token)
  const [meta, setMeta] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [shown, setShown] = useState<Shown | null>(null)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [filename, setFilename] = useState('')
  const [renderError, setRenderError] = useState(false)
  const docxHostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    const urls: string[] = []

    async function init() {
      let metaLocal: Record<string, unknown> = {}
      try {
        const r = await resumesApi.get(resumeId, true)
        metaLocal = r.data as Record<string, unknown>
        if (!cancelled) setMeta(metaLocal)
      } catch { }

      const fn = ((metaLocal.filename as string) || '').toLowerCase()
      if (!cancelled) setFilename((metaLocal.filename as string) || '')

      try {
        const res = await fetch(resumeDownloadUrl(resumeId), {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const header = (res.headers.get('content-type') || '').toLowerCase()
        const isText = fn.endsWith('.txt') || header.startsWith('text/')
        let text = ''
        let blob: Blob
        if (isText) {
          text = await res.text()
          blob = new Blob([text], { type: header || 'text/plain' })
        } else {
          blob = await res.blob()
        }
        const ct = header || blob.type.toLowerCase()
        const isDocx = fn.endsWith('.docx') || ct.includes('wordprocessingml') || ct.includes('officedocument')
        const isPdf = fn.endsWith('.pdf') || ct.includes('pdf')

        if (cancelled) return
        const saved = URL.createObjectURL(blob)
        urls.push(saved)
        setDownloadUrl(saved)

        if (isDocx) {
          setShown({ kind: 'docx', blob })
        } else if (isPdf) {
          const url = URL.createObjectURL(ct.includes('pdf') ? blob : blob.slice(0, blob.size, 'application/pdf'))
          urls.push(url)
          setShown({ kind: 'pdf', url })
        } else if (isText) {
          setShown({ kind: 'text', text })
        }
      } catch { }

      if (!cancelled) setLoading(false)
    }

    init()
    return () => {
      cancelled = true
      urls.forEach(u => URL.revokeObjectURL(u))
    }
  }, [resumeId, token])

  const docxBlob = shown?.kind === 'docx' ? shown.blob : null
  useEffect(() => {
    if (loading || !docxBlob || !docxHostRef.current) return
    const host = docxHostRef.current
    host.innerHTML = ''
    let cancelled = false
    renderAsync(docxBlob, host, undefined, {
      className: 'docx',
      inWrapper: true,
      breakPages: true,
      ignoreLastRenderedPageBreak: true,
      experimental: true,
      useBase64URL: true,
      renderHeaders: true,
      renderFooters: true,
    }).catch(() => { if (!cancelled) setRenderError(true) })
    return () => { cancelled = true }
  }, [loading, docxBlob])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const cls = ((meta?.classification || {}) as Record<string, unknown>)
  const extractedText = (meta?.text as string) || (meta?.resume_text as string) || (meta?.raw_text as string) || ''
  const pageText = shown?.kind === 'text' ? shown.text : extractedText
  const showDocx = shown?.kind === 'docx' && !renderError

  function handleDownload() {
    if (!downloadUrl) return
    const a = document.createElement('a')
    a.href = downloadUrl
    a.download = filename || 'resume'
    a.click()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="resume-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Résumé of ${candidateName || 'the candidate'}`}
        onClick={e => e.stopPropagation()}
      >

        <div className="resume-modal-header">
          <div className="resume-modal-title">
            <EyeIcon />
            <span>{candidateName || 'Resume'}</span>
            {filename && <span className="resume-filename">{filename}</span>}
          </div>
          <div className="resume-modal-actions">
            {downloadUrl && (
              <button className="rm-btn rm-btn-download" onClick={handleDownload} title="Download resume">
                <DownloadIcon /> Download
              </button>
            )}
            {shown?.kind === 'pdf' && (
              <a className="rm-btn rm-btn-open" href={shown.url} target="_blank" rel="noreferrer">
                <ExternalIcon /> Open
              </a>
            )}
            <button className="rm-close" onClick={onClose} aria-label="Close"><CloseIcon /></button>
          </div>
        </div>

        <div className="resume-modal-body">
          {loading ? (
            <div className="resume-modal-loading"><span className="rm-spinner" />Loading resume…</div>
          ) : shown?.kind === 'pdf' ? (
            <div className="rm-viewer rm-viewer-pdf">
              <iframe src={`${shown.url}#view=FitH&toolbar=1`} className="resume-iframe" title="Resume preview" />
            </div>
          ) : showDocx ? (
            <div className="rm-viewer rm-docx-host" ref={docxHostRef} />
          ) : pageText ? (
            <div className="rm-viewer">
              <div className="rm-page">
                <pre className="resume-text-content">{pageText}</pre>
              </div>
            </div>
          ) : (
            <div className="resume-no-preview">
              <div className="resume-no-preview-icon">📄</div>
              <p>Preview not available for this résumé.</p>
              {!!cls.job_domain && (
                <div className="resume-meta-grid">
                  {!!cls.job_domain      && <div className="rm-meta-item"><span>Domain</span>{String(cls.job_domain)}</div>}
                  {!!cls.seniority_level && <div className="rm-meta-item"><span>Seniority</span>{String(cls.seniority_level)}</div>}
                  {!!cls.years_of_experience && <div className="rm-meta-item"><span>Experience</span>{String(cls.years_of_experience)} yrs</div>}
                  {!!cls.education       && <div className="rm-meta-item"><span>Education</span>{String(cls.education)}</div>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
