import DeadlineBar from './DeadlineBar'
import './JobDetails.css'

interface Props {
  job: Record<string, unknown>
}

const BULLET_RE = /^\s*[---•*·]\s+/

const SOURCE_LABELS: Record<string, string> = {
  manual: 'Manual', linkedin: 'LinkedIn', naukri: 'Naukri',
  remotive: 'Remotive', arbeitnow: 'Arbeitnow',
  remoteok: 'RemoteOK', themuse: 'The Muse', jobicy: 'Jobicy',
}
function sourceLabel(s: string) { return SOURCE_LABELS[s] || s.charAt(0).toUpperCase() + s.slice(1) }

type Block =
  | { type: 'heading'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'para'; text: string }

function parseDescription(raw: string): Block[] {
  const lines = raw.split(/\r?\n/)
  const blocks: Block[] = []
  let list: string[] | null = null

  const flushList = () => {
    if (list && list.length) blocks.push({ type: 'list', items: list })
    list = null
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) { flushList(); continue }

    if (line.startsWith('## ')) {
      flushList()
      blocks.push({ type: 'heading', text: line.slice(3).trim() })
      continue
    }

    if (BULLET_RE.test(line)) {
      const item = line.replace(BULLET_RE, '').trim()
      if (item) (list ??= []).push(item)
      continue
    }

    flushList()

    const noColon = line.replace(/:$/, '')
    const isColonHead = /:$/.test(line) && line.length <= 70 && !/[.!?]/.test(noColon)
    const isCapsHead = line.length <= 60 && /[A-Za-z]/.test(line) && /^[A-Z0-9][A-Z0-9 &/'’()-]+$/.test(line)
    blocks.push(isColonHead || isCapsHead ? { type: 'heading', text: noColon } : { type: 'para', text: line })
  }
  flushList()
  return blocks
}

function FormattedDescription({ text }: { text: string }) {
  const blocks = parseDescription(text)
  return (
    <div className="jd-description">
      {blocks.map((b, i) => {
        if (b.type === 'heading') return <h5 key={i} className="jd-desc-heading">{b.text}</h5>
        if (b.type === 'list')
          return (
            <ul key={i} className="jd-desc-list">
              {b.items.map((it, j) => <li key={j}>{it}</li>)}
            </ul>
          )
        return <p key={i} className="jd-desc-para">{b.text}</p>
      })}
    </div>
  )
}

export default function JobDetails({ job }: Props) {
  const parsed = (job.parsed_criteria || {}) as Record<string, unknown>
  const targeting = (job.targeting || {}) as Record<string, unknown>
  const requiredSkills = (parsed.skills as string[]) || []
  const preferredSkills = (parsed.nice_to_have as string[]) || []
  const keyRequirements = (parsed.key_requirements as string[]) || []
  const certifications = (parsed.certifications as string[]) || []
  const hasParsed =
    requiredSkills.length > 0 ||
    preferredSkills.length > 0 ||
    keyRequirements.length > 0 ||
    certifications.length > 0 ||
    !!parsed.experience_level ||
    !!parsed.industry
  const requiredSeniority = (targeting.required_seniority as string[]) || []
  const hasTargeting = !!(targeting.required_domain || requiredSeniority.length > 0)

  return (
    <div className="job-details-panel">
      <div className="jd-header">
        <h2 className="jd-title">{job.title as string}</h2>
        <div className="jd-badges">
          {!!job.company_name && <span className="jd-badge">{job.company_name as string}</span>}
          {!!job.employment_type && <span className="jd-badge">{(job.employment_type as string).replace('-', '‑')}</span>}
          {!!job.difficulty && <span className="jd-badge jd-badge-accent">{job.difficulty as string}</span>}
          {!!job.is_remote && <span className="jd-badge jd-badge-green">Remote</span>}
        </div>
        <div className="jd-meta">
          {!!job.location && (
            <span className="jd-meta-item">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
              </svg>
              {job.location as string}
            </span>
          )}
          {!!(job.salary_min || job.salary_max) && (
            <span className="jd-meta-item">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="1" x2="12" y2="23"/>
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
              </svg>
              {job.salary_min ? (job.salary_min as number).toLocaleString() : '-'}
              {' - '}
              {job.salary_max ? (job.salary_max as number).toLocaleString() : '-'}
            </span>
          )}
        </div>
      </div>

      <div className="jd-body">
        <div className="jd-section">
          <h4 className="jd-section-title">Application Deadline</h4>
          <DeadlineBar createdAt={job.created_at as string} deadlineAt={(job.deadline_at as string) ?? null} />
        </div>

        <div className="jd-section">
          <h4 className="jd-section-title">Description</h4>
          {job.description
            ? <FormattedDescription text={job.description as string} />
            : <p className="jd-pending">Full description loading…</p>
          }
        </div>

        <div className="jd-section">
          <h4 className="jd-section-title">AI-Parsed Criteria</h4>
          {hasParsed ? (
            <>
              {requiredSkills.length > 0 && (
                <div className="jd-skill-group">
                  <span className="jd-skill-label">Required Skills</span>
                  <div className="jd-skill-list">
                    {requiredSkills.map(s => <span key={s} className="jd-skill-tag required">{s}</span>)}
                  </div>
                </div>
              )}
              {preferredSkills.length > 0 && (
                <div className="jd-skill-group">
                  <span className="jd-skill-label">Preferred Skills</span>
                  <div className="jd-skill-list">
                    {preferredSkills.map(s => <span key={s} className="jd-skill-tag preferred">{s}</span>)}
                  </div>
                </div>
              )}
              {keyRequirements.length > 0 && (
                <div className="jd-skill-group">
                  <span className="jd-skill-label">Key Requirements</span>
                  <ul className="jd-desc-list">
                    {keyRequirements.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              )}
              {certifications.length > 0 && (
                <div className="jd-skill-group">
                  <span className="jd-skill-label">Certifications</span>
                  <div className="jd-skill-list">
                    {certifications.map(c => <span key={c} className="jd-skill-tag preferred">{c}</span>)}
                  </div>
                </div>
              )}
              <div className="jd-criteria-row">
                {!!parsed.experience_level && (
                  <div className="jd-criteria-item">
                    <span className="jd-criteria-label">Experience Level</span>
                    <span className="jd-criteria-val">{parsed.experience_level as string}</span>
                  </div>
                )}
                {!!parsed.industry && (
                  <div className="jd-criteria-item">
                    <span className="jd-criteria-label">Industry</span>
                    <span className="jd-criteria-val">{(parsed.industry as string).replace(/_/g, ' ')}</span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <p className="jd-pending">AI is parsing criteria - check back shortly after creating the job.</p>
          )}
        </div>

        {hasTargeting && (
          <div className="jd-section">
            <h4 className="jd-section-title">Targeting</h4>
            <div className="jd-criteria-row">
              {!!targeting.required_domain && (
                <div className="jd-criteria-item">
                  <span className="jd-criteria-label">Domain</span>
                  <span className="jd-criteria-val">{(targeting.required_domain as string).replace(/_/g, ' ')}</span>
                </div>
              )}
              {requiredSeniority.length > 0 && (
                <div className="jd-criteria-item">
                  <span className="jd-criteria-label">Seniority</span>
                  <span className="jd-criteria-val">{requiredSeniority.join(' / ')}</span>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="jd-section jd-meta-footer">
          <span>
            Source <strong className={`jd-source-chip jd-source-${(job.source as string) || 'manual'}`}>
              {sourceLabel((job.source as string) || 'manual')}
            </strong>
          </span>
          {!!job.source_url && (
            <a href={job.source_url as string} target="_blank" rel="noreferrer" className="jd-source-link">
              View original ↗
            </a>
          )}
          {!!job.created_by && <span>Created by <strong>{job.created_by as string}</strong></span>}
          {!!job.created_at && (
            <span>Created <strong>{new Date(job.created_at as string).toLocaleDateString()}</strong></span>
          )}
          {!!job.updated_at && (
            <span>Updated <strong>{new Date(job.updated_at as string).toLocaleDateString()}</strong></span>
          )}
        </div>
      </div>
    </div>
  )
}
