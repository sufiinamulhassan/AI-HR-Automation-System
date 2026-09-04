import { useEffect, useState, type ReactNode } from 'react'
import { jobsApi } from '../../../lib/api'
import './ImportJDModal.css'

interface Source { id: string; label: string; requires_key: boolean; configured: boolean }
interface ImportResult { source: string; fetched: number; imported: number; skipped: number }
interface Props { onClose: () => void; onImported?: () => void }

const LinkedInGlyph = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M19 0h-14c-2.76 0-5 2.24-5 5v14c0 2.76 2.24 5 5 5h14c2.76 0 5-2.24 5-5v-14c0-2.76-2.24-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.27c-.97 0-1.75-.79-1.75-1.76s.78-1.75 1.75-1.75 1.75.79 1.75 1.75-.78 1.76-1.75 1.76zm13.5 12.27h-3v-5.6c0-3.37-4-3.12-4 0v5.6h-3v-11h3v1.77c1.4-2.59 7-2.78 7 2.48v6.75z"/>
  </svg>
)
const BriefcaseGlyph = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="20" height="14" x="2" y="7" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
  </svg>
)
const GlobeGlyph = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z" />
  </svg>
)

const SOURCE_META: Record<string, { color: string; glyph: ReactNode }> = {
  linkedin:  { color: '#0A66C2', glyph: <LinkedInGlyph /> },
  naukri:    { color: '#1875E5', glyph: <BriefcaseGlyph /> },
  remotive:  { color: '#6C5CE7', glyph: <GlobeGlyph /> },
  arbeitnow: { color: '#0f172a', glyph: <BriefcaseGlyph /> },
  remoteok:  { color: '#ef4444', glyph: <GlobeGlyph /> },
  themuse:   { color: '#db2777', glyph: <BriefcaseGlyph /> },
  jobicy:    { color: '#0891b2', glyph: <GlobeGlyph /> },
}

export default function ImportJDModal({ onClose, onImported }: Props) {
  const [sources, setSources]   = useState<Source[]>([])
  const [selected, setSelected] = useState('')
  const [query, setQuery]       = useState('')
  const [location, setLocation] = useState('')
  const [limit, setLimit]       = useState(10)
  const [datePosted, setDatePosted] = useState('any')
  const [jobType, setJobType]   = useState('')
  const [remoteOnly, setRemoteOnly] = useState(false)
  const [daysOpen, setDaysOpen] = useState(30)
  const [importing, setImporting] = useState(false)
  const [result, setResult]     = useState<ImportResult | null>(null)
  const [error, setError]       = useState('')

  useEffect(() => {
    jobsApi.sources()
      .then(r => {
        const list: Source[] = r.data.sources ?? []
        setSources(list)
        setSelected(list.find(s => s.configured)?.id || list[0]?.id || '')
      })
      .catch(() => setSources([]))
  }, [])

  const current = sources.find(s => s.id === selected)

  async function handleImport() {
    if (!selected) return
    setImporting(true); setError(''); setResult(null)
    try {
      const r = await jobsApi.importJobs({
        source: selected,
        query: query.trim() || undefined,
        location: location.trim() || undefined,
        limit,
        date_posted: datePosted !== 'any' ? datePosted : undefined,
        job_type: jobType || undefined,
        remote_only: remoteOnly || undefined,
        deadline_days: daysOpen,
      })
      setResult(r.data)
      onImported?.()
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Import failed.')
    }
    setImporting(false)
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-box ijd-modal">
        <div className="modal-header">
          <h2>Import Job Descriptions</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="ijd-body">
          <p className="ijd-intro">Pull JDs from an external source. They're saved tagged with their origin and parsed &amp; matched automatically - just like a manual JD.</p>

          <div className="ijd-sources">
            {sources.map(s => {
              const meta = SOURCE_META[s.id] || { color: '#64748b', glyph: <BriefcaseGlyph /> }
              const disabled = !s.configured
              return (
                <button
                  key={s.id}
                  className={`ijd-source${selected === s.id ? ' active' : ''}${disabled ? ' disabled' : ''}`}
                  onClick={() => !disabled && setSelected(s.id)}
                  disabled={disabled}
                  title={disabled ? `${s.label} needs an API key in settings` : s.label}
                >
                  <span className="ijd-source-logo" style={{ background: meta.color }}>{meta.glyph}</span>
                  <span className="ijd-source-label">{s.label}</span>
                  {disabled && <span className="ijd-source-tag">Key needed</span>}
                </button>
              )
            })}
          </div>

          <div className="ijd-fields">
            <label className="ijd-field">
              <span>Keywords</span>
              <input type="text" placeholder="e.g. DevOps Engineer" value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleImport()} />
            </label>
            <label className="ijd-field">
              <span>Location <i>(optional)</i></span>
              <input type="text" placeholder="e.g. Remote, USA" value={location}
                onChange={e => setLocation(e.target.value)} />
            </label>
            <label className="ijd-field ijd-field-sm">
              <span>Max</span>
              <input type="number" min={1} max={50} value={limit}
                onChange={e => setLimit(Math.max(1, Math.min(50, Number(e.target.value) || 10)))} />
            </label>
          </div>

          <div className="ijd-fields ijd-filters">
            <label className="ijd-field">
              <span>Date posted</span>
              <select value={datePosted} onChange={e => setDatePosted(e.target.value)}>
                <option value="any">Any time</option>
                <option value="day">Past 24 hours</option>
                <option value="week">Past week</option>
                <option value="month">Past month</option>
              </select>
            </label>
            <label className="ijd-field">
              <span>Job type</span>
              <select value={jobType} onChange={e => setJobType(e.target.value)}>
                <option value="">Any type</option>
                <option value="full-time">Full-time</option>
                <option value="contract">Contract</option>
                <option value="part-time">Part-time</option>
                <option value="internship">Internship</option>
              </select>
            </label>
            <label className="ijd-field ijd-field-sm">
              <span>Days open</span>
              <input type="number" min={0} max={365} value={daysOpen}
                title="Application window for imported JDs (0 = no deadline)"
                onChange={e => setDaysOpen(Math.max(0, Math.min(365, Number(e.target.value) || 0)))} />
            </label>
            <label className="ijd-checkbox">
              <input type="checkbox" checked={remoteOnly} onChange={e => setRemoteOnly(e.target.checked)} />
              <span>Remote only</span>
            </label>
          </div>

          {current && !current.configured && (
            <div className="ijd-note ijd-note-warn">
              <strong>{current.label}</strong> isn't configured. Add its API key in backend settings to enable it. Meanwhile use Remotive or Arbeitnow (no key required).
            </div>
          )}

          {result && (
            result.fetched === 0 ? (
              <div className="ijd-note ijd-note-warn">
                No jobs found on {result.source} for those keywords. Try broader terms
                (e.g. just “React”) or clear the location.
              </div>
            ) : result.imported === 0 ? (
              <div className="ijd-note ijd-note-warn">
                {result.skipped > 0
                  ? <>All {result.skipped} matching JD{result.skipped !== 1 ? 's' : ''} from {result.source} are already imported.</>
                  : <>Nothing imported from {result.source}. Try different keywords.</>}
              </div>
            ) : (
              <div className="ijd-note ijd-note-ok">
                Imported <strong>{result.imported}</strong> new JD{result.imported !== 1 ? 's' : ''} from {result.source}
                {result.skipped > 0 && <> · {result.skipped} duplicate{result.skipped !== 1 ? 's' : ''} skipped</>}.
                They'll appear in the Recruiting workspace as parsing completes.
              </div>
            )
          )}
          {error && <div className="ijd-note ijd-note-err">{error}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Close</button>
          <button className="btn-primary" onClick={handleImport} disabled={importing || !selected || !current?.configured}>
            {importing ? 'Importing…' : 'Import JDs'}
          </button>
        </div>
      </div>
    </div>
  )
}
