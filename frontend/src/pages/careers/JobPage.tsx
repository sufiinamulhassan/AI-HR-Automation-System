import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { careersApi } from '../../lib/api'
import type { CareersJobDetail } from '../../lib/careersTypes'
import { parseDescription, withoutLeadingHeading } from '../../lib/jobDescription'
import { jobPostingLd } from '../../lib/jsonLd'
import { usePageMeta } from '../../lib/usePageMeta'
import { employmentTypeLabel, formatDate, placeLabel, postedAgo, sentenceCase } from './careersFormat'
import ApplyForm from './ApplyForm'
import CompanyLogo from './CompanyLogo'
import './JobPage.css'

type Status = 'loading' | 'ready' | 'missing' | 'error'

const ABOUT_TITLE = 'About the role'

function JobDescription({ text }: { text: string }) {
  const blocks = withoutLeadingHeading(parseDescription(text), ABOUT_TITLE)
  return (
    <div className="cr-job-desc">
      {blocks.map((block, index) => {
        if (block.type === 'heading') return <h3 key={index} className="cr-desc-heading">{block.text}</h3>
        if (block.type === 'list') {
          return (
            <ul key={index} className="cr-desc-list">
              {block.items.map((item, i) => <li key={i}>{item}</li>)}
            </ul>
          )
        }
        return <p key={index} className="cr-desc-para">{block.text}</p>
      })}
    </div>
  )
}

function BackLink() {
  return (
    <Link to="/careers" className="cr-back">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m15 18-6-6 6-6" />
      </svg>
      Back to all jobs
    </Link>
  )
}

function JobSkeleton() {
  return (
    <div className="cr-job-grid" aria-hidden="true">
      <div className="cr-job-main">
        <div className="cr-job-card cr-job-skel">
          <span className="cr-skel cr-skel-logo" />
          <span className="cr-skel cr-skel-line cr-skel-short" />
          <span className="cr-skel cr-skel-line cr-skel-title" />
          <span className="cr-skel cr-skel-line cr-skel-mid" />
        </div>
        <div className="cr-job-card cr-job-skel">
          <span className="cr-skel cr-skel-line" />
          <span className="cr-skel cr-skel-line" />
          <span className="cr-skel cr-skel-line cr-skel-mid" />
          <span className="cr-skel cr-skel-line" />
          <span className="cr-skel cr-skel-line cr-skel-short" />
        </div>
      </div>
      <div className="cr-job-aside">
        <div className="cr-job-card cr-job-skel">
          <span className="cr-skel cr-skel-line cr-skel-title" />
          <span className="cr-skel cr-skel-line" />
          <span className="cr-skel cr-skel-line" />
          <span className="cr-skel cr-skel-line" />
          <span className="cr-skel cr-skel-button" />
        </div>
      </div>
    </div>
  )
}

export default function JobPage() {
  const { jobId = '' } = useParams()
  const [job, setJob] = useState<CareersJobDetail | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let current = true
    setStatus('loading')
    setJob(null)
    careersApi.job(jobId)
      .then(r => {
        if (!current) return
        setJob(r.data)
        setStatus('ready')
      })
      .catch((err: unknown) => {
        if (!current) return
        const code = (err as { response?: { status?: number } })?.response?.status
        setStatus(code === 404 ? 'missing' : 'error')
      })
    return () => { current = false }
  }, [jobId, attempt])

  usePageMeta({
    title: job ? `${job.title} at ${job.company.name}` : 'Careers',
    description: job
      ? `${job.title} at ${job.company.name}. ${job.summary}`.slice(0, 158).trim()
      : 'Open roles from companies hiring on Hirely.ai.',
    jsonLd: job && job.accepting ? [jobPostingLd(job)] : [],
  })

  if (status === 'loading') {
    return (
      <div className="cr-shell cr-job-wrap" aria-busy="true">
        <BackLink />
        <JobSkeleton />
      </div>
    )
  }

  if (status === 'missing') {
    return (
      <div className="cr-shell cr-job-wrap">
        <div className="cr-state">
          <h1 className="cr-state-title">This job is no longer open</h1>
          <p className="cr-state-text">It may have been filled, closed or taken down by the company.</p>
          <Link to="/careers" className="btn btn-primary">Browse all jobs</Link>
        </div>
      </div>
    )
  }

  if (status === 'error' || !job) {
    return (
      <div className="cr-shell cr-job-wrap">
        <BackLink />
        <div className="cr-state" role="alert">
          <h1 className="cr-state-title">We could not load this job</h1>
          <p className="cr-state-text">Check your connection and try again.</p>
          <button type="button" className="btn btn-primary" onClick={() => setAttempt(a => a + 1)}>Retry</button>
        </div>
      </div>
    )
  }

  const now = Date.now()
  const type = employmentTypeLabel(job.employment_type)
  const place = placeLabel(job.location, job.is_remote)
  const posted = postedAgo(job.posted_at, now)
  const facts = [
    { label: 'Experience level', value: sentenceCase(job.experience_level) },
    { label: 'Job grade', value: sentenceCase(job.job_grade) },
    { label: 'Industry', value: sentenceCase(job.industry || job.company.industry) },
    { label: 'Posted', value: posted },
    { label: 'Closes', value: job.deadline_at ? formatDate(job.deadline_at) : '' },
  ].filter(fact => fact.value)
  const skills = job.skills ?? []

  return (
    <div className="cr-shell cr-job-wrap">
      <BackLink />

      <header className="cr-job-head">
        <CompanyLogo name={job.company.name} logoUrl={job.company.logo_url} size="lg" />
        <div className="cr-job-head-text">
          <Link to={`/careers?company=${encodeURIComponent(job.company.slug)}`} className="cr-job-company">
            {job.company.name}
          </Link>
          <h1 className="cr-job-title">{job.title}</h1>
          <div className="cr-tags">
            {place && <span className="cr-tag">{place}</span>}
            {type && <span className="cr-tag">{type}</span>}
            {job.is_remote && <span className="cr-tag cr-tag-remote">Remote</span>}
          </div>
        </div>
        <a href="#apply" className="btn btn-primary cr-job-jump">Apply now</a>
      </header>

      <div className="cr-job-grid">
        <div className="cr-job-main">
          {(facts.length > 0 || skills.length > 0) && (
            <section className="cr-job-card" aria-label="Role details">
              {facts.length > 0 && (
                <dl className="cr-facts">
                  {facts.map(fact => (
                    <div className="cr-fact" key={fact.label}>
                      <dt>{fact.label}</dt>
                      <dd>{fact.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {skills.length > 0 && (
                <div className="cr-job-skills">
                  <h2 className="cr-job-h">Skills</h2>
                  <ul className="cr-chips" aria-label="Skills">
                    {skills.map(skill => <li key={skill} className="cr-chip">{skill}</li>)}
                  </ul>
                </div>
              )}
            </section>
          )}

          <section className="cr-job-card" aria-labelledby="cr-job-about">
            <h2 className="cr-job-h" id="cr-job-about">{ABOUT_TITLE}</h2>
            <JobDescription text={String(job.description ?? '')} />
          </section>
        </div>

        <aside className="cr-job-aside" aria-label="Apply">
          <ApplyForm jobId={job.job_id} jobTitle={job.title} company={job.company} />
        </aside>
      </div>
    </div>
  )
}
