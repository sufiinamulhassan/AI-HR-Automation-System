import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { careersApi } from '../../lib/api'
import { PRODUCT_NAME } from '../../lib/brand'
import { usePageMeta } from '../../lib/usePageMeta'
import type { CareersFilters, CareersJobList, CareersJobParams, CareersJobSummary } from '../../lib/careersTypes'
import { deadlineText, employmentTypeLabel, placeLabel, postedAgo } from './careersFormat'
import CompanyLogo from './CompanyLogo'
import './CareersPage.css'

const PAGE_SIZE = 12
const SEARCH_DEBOUNCE_MS = 350
const SKELETON_COUNT = 6
const SLOW_LOAD_MS = 800
const MAX_SKILLS = 4

interface Query {
  q: string
  company: string
  location: string
  type: string
  remote: boolean
  page: number
}

function readQuery(params: URLSearchParams): Query {
  const page = Number.parseInt(params.get('page') ?? '', 10)
  return {
    q: (params.get('q') ?? '').trim(),
    company: params.get('company') ?? '',
    location: params.get('location') ?? '',
    type: params.get('type') ?? '',
    remote: params.get('remote') === 'true',
    page: Number.isFinite(page) && page > 0 ? page : 1,
  }
}

function writeQuery(query: Query): URLSearchParams {
  const next = new URLSearchParams()
  if (query.q) next.set('q', query.q)
  if (query.company) next.set('company', query.company)
  if (query.location) next.set('location', query.location)
  if (query.type) next.set('type', query.type)
  if (query.remote) next.set('remote', 'true')
  if (query.page > 1) next.set('page', String(query.page))
  return next
}

function apiParams(query: Query): CareersJobParams {
  const params: CareersJobParams = { page: query.page, limit: PAGE_SIZE }
  if (query.q) params.q = query.q
  if (query.company) params.company = query.company
  if (query.location) params.location = query.location
  if (query.type) params.type = query.type
  if (query.remote) params.remote = true
  return params
}

function countLabel(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  )
}

function JobCard({ job, now }: { job: CareersJobSummary; now: number }) {
  const posted = postedAgo(job.posted_at, now)
  const deadline = deadlineText(job.deadline_at, now)
  const type = employmentTypeLabel(job.employment_type)
  const place = placeLabel(job.location, job.is_remote)
  const skills = job.skills.slice(0, MAX_SKILLS)

  return (
    <li className="cr-card-item">
      <article className="cr-card">
        <div className="cr-card-company">
          <CompanyLogo name={job.company.name} logoUrl={job.company.logo_url} />
          <span className="cr-card-company-name">{job.company.name}</span>
        </div>

        <h3 className="cr-card-title">{job.title}</h3>

        <div className="cr-tags">
          {place && <span className="cr-tag"><PinIcon />{place}</span>}
          {type && <span className="cr-tag">{type}</span>}
          {job.is_remote && <span className="cr-tag cr-tag-remote">Remote</span>}
          {job.accepting === false && <span className="cr-tag cr-tag-closed">No more candidates accepted</span>}
        </div>

        {job.summary && <p className="cr-card-summary">{job.summary}</p>}

        {skills.length > 0 && (
          <ul className="cr-chips" aria-label="Skills">
            {skills.map(skill => <li key={skill} className="cr-chip">{skill}</li>)}
          </ul>
        )}

        <div className="cr-card-foot">
          <div className="cr-card-dates">
            {posted && <span>Posted {posted}</span>}
            {deadline && <span className="cr-card-deadline">{deadline}</span>}
          </div>
          <Link
            to={`/careers/${encodeURIComponent(job.job_id)}`}
            className="btn btn-primary btn-sm cr-card-link"
            aria-label={`View job: ${job.title} at ${job.company.name}`}
          >
            View job
          </Link>
        </div>
      </article>
    </li>
  )
}

function SkeletonCard() {
  return (
    <div className="cr-card cr-skel-card" aria-hidden="true">
      <div className="cr-skel-row">
        <span className="cr-skel cr-skel-logo" />
        <span className="cr-skel cr-skel-line cr-skel-short" />
      </div>
      <span className="cr-skel cr-skel-line cr-skel-title" />
      <div className="cr-skel-row">
        <span className="cr-skel cr-skel-pill" />
        <span className="cr-skel cr-skel-pill" />
      </div>
      <span className="cr-skel cr-skel-line" />
      <span className="cr-skel cr-skel-line cr-skel-mid" />
      <div className="cr-skel-row cr-skel-foot">
        <span className="cr-skel cr-skel-line cr-skel-short" />
        <span className="cr-skel cr-skel-button" />
      </div>
    </div>
  )
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  )
}

export default function CareersPage() {
  const [params, setParams] = useSearchParams()
  const query = useMemo(() => readQuery(params), [params])
  const queryKey = writeQuery(query).toString()
  const queryRef = useRef(query)
  queryRef.current = query
  const resultsRef = useRef<HTMLDivElement | null>(null)

  const [text, setText] = useState(query.q)
  const [filters, setFilters] = useState<CareersFilters | null>(null)
  const [result, setResult] = useState<CareersJobList | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)

  usePageMeta({
    title: 'Careers',
    description: `Open roles from companies hiring on ${PRODUCT_NAME}. Search by title, skill or location and apply with your resume.`,
  })

  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (status !== 'loading' || !result) {
      setSlow(false)
      return
    }
    const id = window.setTimeout(() => setSlow(true), SLOW_LOAD_MS)
    return () => window.clearTimeout(id)
  }, [status, result])

  useEffect(() => {
    let current = true
    careersApi.filters()
      .then(r => { if (current) setFilters(r.data) })
      .catch(() => { if (current) setFilters(null) })
    return () => { current = false }
  }, [])

  useEffect(() => {
    setText(shown => (shown.trim() === query.q ? shown : query.q))
  }, [query.q])

  useEffect(() => {
    const next = text.trim()
    if (next === queryRef.current.q) return
    const id = window.setTimeout(() => {
      setParams(writeQuery({ ...queryRef.current, q: next, page: 1 }), { replace: true })
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(id)
  }, [text, setParams])

  useEffect(() => {
    let current = true
    setStatus('loading')
    careersApi.jobs(apiParams(query))
      .then(r => {
        if (!current) return
        const data = r.data
        if (data.jobs.length === 0 && data.total > 0 && query.page > 1) {
          setParams(writeQuery({ ...query, page: Math.max(1, data.pages) }), { replace: true })
          return
        }
        setResult(data)
        setStatus('ready')
      })
      .catch(() => { if (current) setStatus('error') })
    return () => { current = false }
  }, [queryKey, attempt])

  const hasFilters = !!(query.q || query.company || query.location || query.type || query.remote)

  function update(patch: Partial<Query>) {
    setParams(writeQuery({ ...query, page: 1, ...patch }))
  }

  function goToPage(page: number) {
    update({ page })
    resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function clearFilters() {
    setText('')
    setParams(new URLSearchParams())
  }

  function submitSearch(e: FormEvent) {
    e.preventDefault()
    const next = text.trim()
    if (next !== query.q) setParams(writeQuery({ ...query, q: next, page: 1 }), { replace: true })
  }

  const companies = filters?.companies ?? []
  const locations = filters?.locations ?? []
  const types = filters?.employment_types ?? []
  const jobs = result?.jobs ?? []
  const total = result?.total ?? 0
  const pages = result?.pages ?? 1
  const page = Math.min(query.page, Math.max(1, pages))
  const now = Date.now()
  const isEmpty = status === 'ready' && jobs.length === 0
  const refreshing = status === 'loading' && result !== null
  const showSkeleton = status === 'loading' && (result === null || slow)
  const showJobs = jobs.length > 0 && (status === 'ready' || (refreshing && !slow))
  const showPager = pages > 1 && (status === 'ready' || (refreshing && !slow))

  return (
    <div className="cr-list-page">
      <section className="cr-hero">
        <div className="cr-shell">
          {filters && filters.companies.length > 0 && (
            <span className="cr-eyebrow">
              <span aria-hidden="true" className="cr-eyebrow-dot" />
              Hiring now at {countLabel(filters.companies.length, 'company', 'companies')}
            </span>
          )}
          <h1 className="cr-hero-title">Find your next role</h1>
          <p className="cr-hero-sub">
            Open positions from companies hiring on {PRODUCT_NAME}. Pick a role and apply with your résumé in a minute.
          </p>

          <div className="cr-toolbar">
            <span aria-hidden="true" className="cr-corner cr-corner-tl" />
            <span aria-hidden="true" className="cr-corner cr-corner-tr" />
            <span aria-hidden="true" className="cr-corner cr-corner-bl" />
            <span aria-hidden="true" className="cr-corner cr-corner-br" />

            <form className="cr-search" role="search" onSubmit={submitSearch}>
              <span className="cr-search-icon"><SearchIcon /></span>
              <input
                type="search"
                className="form-input cr-search-input"
                aria-label="Search jobs"
                placeholder="Search by job title, skill or keyword"
                value={text}
                onChange={e => setText(e.target.value)}
                autoComplete="off"
              />
            </form>

            <div className="cr-filters" role="group" aria-label="Filters">
              <label className="cr-filter">
                <span className="form-label">Company</span>
                <select
                  className="form-input"
                  value={query.company}
                  onChange={e => update({ company: e.target.value })}
                >
                  <option value="">All companies</option>
                  {companies.map(c => (
                    <option key={c.slug} value={c.slug}>{c.name} ({c.open_jobs})</option>
                  ))}
                  {query.company && !companies.some(c => c.slug === query.company) && (
                    <option value={query.company}>{query.company}</option>
                  )}
                </select>
              </label>

              <label className="cr-filter">
                <span className="form-label">Location</span>
                <select
                  className="form-input"
                  value={query.location}
                  onChange={e => update({ location: e.target.value })}
                >
                  <option value="">All locations</option>
                  {locations.map(l => <option key={l} value={l}>{l}</option>)}
                  {query.location && !locations.includes(query.location) && (
                    <option value={query.location}>{query.location}</option>
                  )}
                </select>
              </label>

              <label className="cr-filter">
                <span className="form-label">Employment type</span>
                <select
                  className="form-input"
                  value={query.type}
                  onChange={e => update({ type: e.target.value })}
                >
                  <option value="">All types</option>
                  {types.map(t => <option key={t} value={t}>{employmentTypeLabel(t)}</option>)}
                  {query.type && !types.includes(query.type) && (
                    <option value={query.type}>{employmentTypeLabel(query.type)}</option>
                  )}
                </select>
              </label>

              <label className="cr-toggle">
                <input
                  type="checkbox"
                  checked={query.remote}
                  onChange={e => update({ remote: e.target.checked })}
                />
                <span className="cr-toggle-track" aria-hidden="true" />
                <span className="cr-toggle-label">Remote only</span>
              </label>

              {hasFilters && !isEmpty && (
                <button type="button" className="btn btn-ghost btn-sm cr-clear" onClick={clearFilters}>
                  Clear filters
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="cr-results" ref={resultsRef} aria-busy={status === 'loading'}>
        <div className="cr-shell">
          <p className="cr-count" role="status">
            {status === 'loading' && result === null && 'Loading roles'}
            {(status === 'ready' || (status === 'loading' && result !== null)) && countLabel(total, 'open role', 'open roles')}
          </p>

          {showSkeleton && (
            <div className="cr-grid-list" aria-hidden="true">
              {Array.from({ length: SKELETON_COUNT }, (_, i) => <SkeletonCard key={i} />)}
            </div>
          )}

          {status === 'error' && (
            <div className="cr-state" role="alert">
              <h2 className="cr-state-title">We could not load the jobs</h2>
              <p className="cr-state-text">Check your connection and try again.</p>
              <button type="button" className="btn btn-primary" onClick={() => setAttempt(a => a + 1)}>Retry</button>
            </div>
          )}

          {isEmpty && (
            hasFilters ? (
              <div className="cr-state">
                <h2 className="cr-state-title">No jobs match your search</h2>
                <p className="cr-state-text">Try a different keyword or remove some filters.</p>
                <button type="button" className="btn btn-primary" onClick={clearFilters}>Clear filters</button>
              </div>
            ) : (
              <div className="cr-state">
                <h2 className="cr-state-title">No open roles right now</h2>
                <p className="cr-state-text">New positions are posted often. Check back soon.</p>
              </div>
            )
          )}

          {showJobs && (
            <ul className={`cr-grid-list${refreshing ? ' is-stale' : ''}`}>
              {jobs.map(job => <JobCard key={job.job_id} job={job} now={now} />)}
            </ul>
          )}

          {showPager && (
            <nav className="cr-pager" aria-label="Pagination">
              <button type="button" className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => goToPage(page - 1)}>
                Previous
              </button>
              <span className="cr-pager-info">Page {page} of {pages}</span>
              <button type="button" className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => goToPage(page + 1)}>
                Next
              </button>
            </nav>
          )}
        </div>
      </section>
    </div>
  )
}
