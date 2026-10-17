import { useEffect, useState } from 'react'
import { jobsApi } from '../../../lib/api'
import './SourcingPanel.css'

interface Props {
  jobId: string
}

interface SourcingSpec {
  title?: string
  seniority?: string
  domain?: string
  industry?: string
  location?: string
  is_remote?: boolean
  skills?: string[]
  nice_to_have?: string[]
  keywords?: string[]
}

interface SourcingQueries {
  strict: string
  balanced: string
  broad: string
}

interface SourcingData {
  job_id: string
  spec: SourcingSpec
  queries: SourcingQueries
}

const TIERS: { key: keyof SourcingQueries; label: string; desc: string }[] = [
  {
    key: 'strict',
    label: 'Strict',
    desc: 'Every required skill and the location must match: fewest, most tightly-qualified results.',
  },
  {
    key: 'balanced',
    label: 'Balanced',
    desc: 'Core skills and location match; nice-to-haves are optional: a middle ground between precision and reach.',
  },
  {
    key: 'broad',
    label: 'Broad',
    desc: 'Casts the widest net across title, keywords and all skills: use when the tighter tiers return too few candidates.',
  },
]

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    }).catch(() => {})
  }
  return (
    <button className="src-copy-btn" onClick={copy} aria-label={label} title={label}>
      {copied ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" fillOpacity="0.16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" fill="none" />
        </svg>
      )}
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

function FieldChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="src-field-chip">
      <span className="src-field-label">{label}</span>
      <span className="src-field-val">{value}</span>
    </div>
  )
}

function TagGroup({ label, tags }: { label: string; tags: string[] }) {
  return (
    <div className="src-tag-group">
      <span className="src-field-label">{label}</span>
      <div className="src-tag-list">
        {tags.map(t => <span key={t} className="src-tag">{t}</span>)}
      </div>
    </div>
  )
}

export default function SourcingPanel({ jobId }: Props) {
  const [data, setData] = useState<SourcingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    setData(null)
    jobsApi.sourcing(jobId)
      .then(r => { if (active) setData(r.data) })
      .catch(() => { if (active) setError("Couldn't load sourcing strings for this job.") })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [jobId])

  if (loading) return <div className="sourcing-loading">Loading sourcing strings…</div>
  if (error || !data) return <div className="sourcing-error">{error || "Couldn't load sourcing strings for this job."}</div>

  const spec = data.spec || {}
  const skills = spec.skills || []
  const niceToHave = spec.nice_to_have || []
  const keywords = spec.keywords || []
  const hasFields = !!(spec.title || spec.seniority || spec.domain || spec.industry || spec.location || spec.is_remote)

  return (
    <div className="sourcing-panel">
      <div className="src-section">
        <h4 className="src-section-title">Extracted Criteria</h4>
        {hasFields && (
          <div className="src-field-grid">
            {!!spec.title && <FieldChip label="Title" value={spec.title} />}
            {!!spec.seniority && <FieldChip label="Seniority" value={spec.seniority} />}
            {!!spec.domain && <FieldChip label="Domain" value={spec.domain.replace(/_/g, ' ')} />}
            {!!spec.industry && <FieldChip label="Industry" value={spec.industry.replace(/_/g, ' ')} />}
            {!!spec.location && <FieldChip label="Location" value={spec.location} />}
            {!!spec.is_remote && <FieldChip label="Work Mode" value="Remote" />}
          </div>
        )}
        {skills.length > 0 && <TagGroup label="Skills" tags={skills} />}
        {niceToHave.length > 0 && <TagGroup label="Nice to Have" tags={niceToHave} />}
        {keywords.length > 0 && <TagGroup label="Keywords" tags={keywords} />}
        {!hasFields && skills.length === 0 && niceToHave.length === 0 && keywords.length === 0 && (
          <p className="sourcing-pending">No parsed criteria available for this job yet.</p>
        )}
      </div>

      <div className="src-section">
        <h4 className="src-section-title">Boolean Search Strings</h4>
        {TIERS.map(t => (
          <div key={t.key} className="src-query-box">
            <div className="src-query-header">
              <span className="src-query-label">{t.label}</span>
              <CopyButton text={data.queries[t.key]} label={`Copy ${t.label} query`} />
            </div>
            <p className="src-query-desc">{t.desc}</p>
            <pre className="src-query-pre"><code>{data.queries[t.key]}</code></pre>
          </div>
        ))}
      </div>
    </div>
  )
}
