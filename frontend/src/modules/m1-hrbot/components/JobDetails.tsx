import { useEffect, useRef, useState } from 'react'
import { parseDescription } from '../../../lib/jobDescription'
import DeadlineBar from './DeadlineBar'
import { careersJobUrl, isJobPublic } from './careersVisibility'
import './JobDetails.css'

interface Props {
  job: Record<string, unknown>
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function jobCapacity(job: Record<string, unknown>) {
  const limit = numberOrNull(job.max_resumes)
  const max = limit !== null && limit > 0 ? limit : null
  const pipeline = Array.isArray(job.candidate_pipeline) ? job.candidate_pipeline.length : 0
  const count = numberOrNull(job.resume_count) ?? pipeline
  return { max, count, full: max !== null && count >= max }
}

function CapacityBlock({ job }: Props) {
  const { max, count, full } = jobCapacity(job)
  const share = max ? Math.min(100, Math.round((count / max) * 100)) : 0
  return (
    <div className="jd-section">
      <h4 className="jd-section-title">Résumé Limit</h4>
      {max === null ? (
        <p className="jd-capacity-note">
          No limit. {count.toLocaleString()} résumé{count === 1 ? '' : 's'} in the pipeline. Edit the job to set a maximum.
        </p>
      ) : (
        <>
          <div className="jd-capacity-head">
            <span className="jd-capacity-count">{count.toLocaleString()} of {max.toLocaleString()} résumés taken</span>
            <span className={`jd-careers-pill ${full ? 'is-full' : 'is-public'}`}>
              {full ? 'Full, no more candidates accepted' : `${(max - count).toLocaleString()} left`}
            </span>
          </div>
          <div
            className="jd-capacity-bar"
            role="progressbar"
            aria-label="Résumés taken"
            aria-valuemin={0}
            aria-valuemax={max}
            aria-valuenow={Math.min(count, max)}
          >
            <span className={`jd-capacity-fill${full ? ' is-full' : ''}`} style={{ width: `${share}%` }} />
          </div>
          <p className="jd-capacity-note">
            {full
              ? 'This JD takes no more résumés and the careers page tells candidates that no more candidates are accepted.'
              : 'When the limit is reached, this JD stops taking résumés and the careers page stops accepting applications.'}
          </p>
        </>
      )}
    </div>
  )
}

const SOURCE_LABELS: Record<string, string> = {
  manual: 'Manual', linkedin: 'LinkedIn',
  remotive: 'Remotive', arbeitnow: 'Arbeitnow',
  remoteok: 'RemoteOK', themuse: 'The Muse', jobicy: 'Jobicy',
}
function sourceLabel(s: string) { return SOURCE_LABELS[s] || s.charAt(0).toUpperCase() + s.slice(1) }

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

type CopyState = 'idle' | 'copied' | 'failed'

function CareersBlock({ job }: Props) {
  const isPublic = isJobPublic(job)
  const url = careersJobUrl(String(job.job_id ?? ''))
  const [copy, setCopy] = useState<CopyState>('idle')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (copy === 'idle') return
    const id = window.setTimeout(() => setCopy('idle'), 2000)
    return () => window.clearTimeout(id)
  }, [copy])

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url)
      setCopy('copied')
    } catch {
      inputRef.current?.select()
      setCopy('failed')
    }
  }

  return (
    <div className="jd-section">
      <h4 className="jd-section-title">Careers Page</h4>
      <div className="jd-careers-status">
        <span className={`jd-careers-pill ${isPublic ? 'is-public' : 'is-private'}`}>
          {isPublic ? 'Public' : 'Not public'}
        </span>
        <span className="jd-careers-note">
          {isPublic
            ? 'Visible on the careers page. Candidates can apply with a résumé.'
            : 'Hidden from the careers page. Edit the job and turn on Show on the careers page to publish it.'}
        </span>
      </div>
      {isPublic && (
        <div className="jd-careers-link">
          <input
            ref={inputRef}
            className="jd-careers-url"
            type="text"
            readOnly
            value={url}
            aria-label="Public job link"
            onFocus={e => e.currentTarget.select()}
          />
          <button type="button" className="jd-careers-btn" onClick={copyLink}>Copy</button>
          <a className="jd-careers-btn jd-careers-open" href={url} target="_blank" rel="noreferrer">Open page</a>
          <span className="jd-careers-copied" role="status">
            {copy === 'copied' ? 'Copied' : copy === 'failed' ? 'Press Ctrl+C to copy' : ''}
          </span>
        </div>
      )}
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
          {!!job.job_grade && <span className="jd-badge">{job.job_grade as string}</span>}
          {!!job.is_remote && <span className="jd-badge jd-badge-green">Remote</span>}
        </div>
        <div className="jd-meta">
          {!!job.location && (
            <span className="jd-meta-item">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" fillOpacity="0.16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3" fill="none"/>
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
              {' – '}
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

        <CapacityBlock job={job} />

        <CareersBlock job={job} />

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
            <p className="jd-pending">AI is parsing criteria. Check back shortly after creating the job.</p>
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
