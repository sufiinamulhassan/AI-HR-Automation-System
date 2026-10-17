import { useEffect, useRef, useState } from 'react'
import { jobsApi, type JobBrowseResult, type JobStatusFilter } from '../../../lib/api'
import { useAuthStore } from '../../../store/auth.store'
import './JobBrowserModal.css'

type Job = Record<string, unknown>

export const PAGE_SIZE = 20
export const SEARCH_DEBOUNCE_MS = 300

const TABS: { key: JobStatusFilter; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'closed', label: 'Closed' },
  { key: 'all', label: 'All' },
]

const SKELETON_ROWS = 6

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

const SearchIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
)

function isOpen(job: Job): boolean {
  const deadline = typeof job.deadline_at === 'string' ? Date.parse(job.deadline_at) : NaN
  return !(deadline < Date.now())
}

function formatCreated(value: unknown): string {
  if (typeof value !== 'string') return ''
  const t = Date.parse(value)
  if (Number.isNaN(t)) return ''
  return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

interface View {
  query: string
  status: JobStatusFilter
  page: number
}

interface Props {
  onSelect: (job: Job) => void
  onClose: () => void
}

export default function JobBrowserModal({ onSelect, onClose }: Props) {
  const role = useAuthStore(s => s.user?.role)
  const canCreate = role === 'admin' || role === 'superadmin'
  const [search, setSearch] = useState('')
  const [view, setView] = useState<View>({ query: '', status: 'all', page: 1 })
  const [attempt, setAttempt] = useState(0)

  const [jobs, setJobs] = useState<Job[]>([])
  const [total, setTotal] = useState(0)
  const [pageSize, setPageSize] = useState(PAGE_SIZE)
  const [counts, setCounts] = useState<JobBrowseResult['counts'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null
    searchRef.current?.focus()
    return () => { returnTo?.focus?.() }
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const query = search.trim()
    const timer = setTimeout(() => {
      setView(v => (v.query === query ? v : { ...v, query, page: 1 }))
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    let live = true
    const controller = new AbortController()
    setLoading(true)
    setFailed(false)

    jobsApi
      .browse(
        {
          page: view.page,
          limit: PAGE_SIZE,
          status: view.status,
          ...(view.query ? { search: view.query } : {}),
        },
        controller.signal,
      )
      .then(r => {
        if (!live) return
        const data = r.data
        const rows = data.jobs ?? []
        const matched = data.total ?? rows.length
        const size = data.limit || PAGE_SIZE
        const lastPage = Math.max(1, Math.ceil(matched / size))
        if (rows.length === 0 && view.page > lastPage) {
          setView(v => ({ ...v, page: lastPage }))
          return
        }
        setJobs(rows)
        setTotal(matched)
        setPageSize(size)
        if (data.counts) setCounts(data.counts)
        setLoading(false)
      })
      .catch(() => {
        if (!live) return
        setFailed(true)
        setLoading(false)
      })

    return () => {
      live = false
      controller.abort()
    }
  }, [view, attempt])

  function choose(job: Job) {
    onSelect(job)
    onClose()
  }

  function selectTab(status: JobStatusFilter) {
    setView(v => (v.status === status ? v : { ...v, status, page: 1 }))
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const first = (view.page - 1) * pageSize + 1
  const last = first + jobs.length - 1
  const showResults = !loading && !failed && jobs.length > 0
  const showEmpty = !loading && !failed && jobs.length === 0

  return (
    <div
      className="modal-overlay"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="modal-box jb-modal" role="dialog" aria-modal="true" aria-labelledby="jb-title">
        <div className="modal-header">
          <h2 id="jb-title">Browse all jobs</h2>
          <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <div className="jb-search-wrap">
          <div className="jb-search-field">
            <span className="jb-search-icon"><SearchIcon /></span>
            <input
              ref={searchRef}
              className="jb-search"
              type="search"
              placeholder="Search by title or company…"
              aria-label="Search jobs"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="jb-tabs" role="tablist" aria-label="Job status">
          {TABS.map(t => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={view.status === t.key}
              className="jb-tab"
              onClick={() => selectTab(t.key)}
            >
              {t.label}
              {counts && <span className="jb-tab-count">{counts[t.key]}</span>}
            </button>
          ))}
        </div>

        <div className="jb-body" role="tabpanel" aria-busy={loading}>
          {loading && (
            <div className="jb-skeletons" role="status">
              <span className="jb-visually-hidden">Loading jobs…</span>
              {Array.from({ length: SKELETON_ROWS }, (_, i) => (
                <div key={i} className="jb-skeleton-row" aria-hidden="true">
                  <span className="jb-skel jb-skel-title" />
                  <span className="jb-skel jb-skel-meta" />
                </div>
              ))}
            </div>
          )}

          {failed && (
            <div className="jb-error" role="alert">
              <span>Could not load jobs.</span>
              <button type="button" className="jb-retry" onClick={() => setAttempt(a => a + 1)}>
                Retry
              </button>
            </div>
          )}

          {showEmpty && (
            <div className="jb-empty">
              <strong>No jobs match</strong>
              <span>
                {view.query
                  ? 'Try a different search, or check another tab.'
                  : view.status === 'all'
                    ? (canCreate ? 'Create a job description to get started.' : 'There are no jobs yet.')
                    : `There are no ${view.status} jobs right now.`}
              </span>
            </div>
          )}

          {showResults && (
            <ul className="jb-list">
              {jobs.map(job => {
                const open = isOpen(job)
                const created = formatCreated(job.created_at)
                return (
                  <li key={job.job_id as string}>
                    <button type="button" className="jb-row" onClick={() => choose(job)}>
                      <span className="jb-row-main">
                        <span className="jb-row-title">{(job.title as string) || 'Untitled job'}</span>
                        <span className="jb-row-meta">
                          {!!job.company_name && <span>{job.company_name as string}</span>}
                          {!!job.location && <span>{job.location as string}</span>}
                          {created && <span>Created {created}</span>}
                        </span>
                      </span>
                      <span className={`jb-badge ${open ? 'jb-badge-open' : 'jb-badge-closed'}`}>
                        {open ? 'Open' : 'Closed'}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="modal-footer jb-footer">
          <span className="jb-range" aria-live="polite">
            {showResults && `Showing ${first}-${last} of ${total}`}
          </span>
          <div className="jb-pager">
            <button
              type="button"
              className="jb-page-btn"
              disabled={loading || failed || view.page <= 1}
              onClick={() => setView(v => ({ ...v, page: v.page - 1 }))}
            >
              Previous
            </button>
            <button
              type="button"
              className="jb-page-btn"
              disabled={loading || failed || view.page >= totalPages}
              onClick={() => setView(v => ({ ...v, page: v.page + 1 }))}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
