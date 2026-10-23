import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { resumesApi, type ResumeFilterParams } from '../../../lib/api'
import { useAuthStore } from '../../../store/auth.store'
import ResumeFilters from '../components/ResumeFilters'
import ResumeFolders from '../components/ResumeFolders'
import ResumeJobsModal from '../components/ResumeJobsModal'
import ResumeViewerModal from '../components/ResumeViewerModal'
import UploadResumesModal from '../components/UploadResumesModal'
import {
  EMPTY_FILTERS,
  EMPTY_OPTIONS,
  SEMANTIC_MIN_CHARS,
  STATUS_OPTIONS,
  apiDetail,
  folderParams,
  leavesFolders,
  normalizeOptions,
  toParams,
  type ResumeFilterOptions,
  type ResumeFilterValues,
  type ResumeNotice,
  type ViewMode,
} from '../components/resumeFilterModel'
import './ResumesPage.css'

const PAGE_SIZE = 20
const SEMANTIC_LIMIT = 50
const SEMANTIC_UNAVAILABLE = 'Semantic search is not available right now'

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  processed: { label: 'Processed', cls: 'badge-green' },
  pending: { label: 'Processing', cls: 'badge-yellow' },
  failed: { label: 'Failed', cls: 'badge-red' },
}

interface ResumeRow {
  resume_id: string
  filename?: string
  candidate_name?: string
  candidate_email?: string
  processing_status?: string
  created_at?: string
  location?: string
  headline?: string
  match_score?: number
  classification?: {
    job_domain?: string
    seniority_level?: string
    years_experience?: number
    skills?: string[]
  }
}

interface PendingDelete { ids: string[]; label: string }

const MAX_SKILL_CHIPS = 3

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`
const pretty = (s?: string) => (s ? s.replace(/_/g, ' ') : '')
const rowLabel = (r: ResumeRow) => r.candidate_name || r.filename || 'Unnamed résumé'

function initials(label: string): string {
  const words = label.replace(/\.[a-z0-9]{2,4}$/i, '').split(/[\s_.-]+/).filter(w => /^\p{L}/u.test(w))
  const letters = words.slice(0, 2).map(w => w.charAt(0).toUpperCase()).join('')
  return letters || '?'
}

function formatDate(iso?: string): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function matchPercent(score?: number): string {
  if (typeof score !== 'number' || !Number.isFinite(score)) return '-'
  return `${Math.round(Math.min(1, Math.max(0, score)) * 100)}%`
}

export default function ResumesPage() {
  const user = useAuthStore(s => s.user)
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'

  const [searchParams, setSearchParams] = useSearchParams()
  const rawStatus = searchParams.get('status') ?? ''
  const status = STATUS_OPTIONS.some(o => o.value === rawStatus) ? rawStatus : ''
  const [view, setView] = useState<ViewMode>(() => (status ? 'all' : 'folders'))

  const [base, setBase] = useState<ResumeFilterValues>(EMPTY_FILTERS)
  const [semantic, setSemantic] = useState(false)
  const [resultMode, setResultMode] = useState<'list' | 'semantic'>('list')
  const [options, setOptions] = useState<ResumeFilterOptions>(EMPTY_OPTIONS)
  const [optionsLoading, setOptionsLoading] = useState(true)

  const [rows, setRows] = useState<ResumeRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [viewer, setViewer] = useState<{ resumeId: string; name: string } | null>(null)
  const [jobScores, setJobScores] = useState<{ resumeId: string; name: string } | null>(null)
  const [notice, setNotice] = useState<ResumeNotice | null>(null)
  const [showUpload, setShowUpload] = useState(false)

  const latestRequest = useRef(0)
  const selectAllRef = useRef<HTMLInputElement>(null)

  const filters = useMemo<ResumeFilterValues>(() => ({ ...base, status }), [base, status])
  const paramsKey = JSON.stringify(toParams(filters))
  const params = useMemo(() => JSON.parse(paramsKey) as ResumeFilterParams, [paramsKey])
  const hasFilters = Object.keys(params).length > 0
  const semanticActive = semantic && (params.search ?? '').length >= SEMANTIC_MIN_CHARS
  const folderKey = JSON.stringify(folderParams(params))
  const foldersFilter = useMemo(() => JSON.parse(folderKey) as ResumeFilterParams, [folderKey])

  useEffect(() => {
    if (!searchParams.has('view')) return
    const next = new URLSearchParams(searchParams)
    next.delete('view')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  useEffect(() => {
    let current = true
    resumesApi.options()
      .then(r => { if (current) setOptions(normalizeOptions(r.data)) })
      .catch(() => { })
      .finally(() => { if (current) setOptionsLoading(false) })
    return () => { current = false }
  }, [refreshKey])

  useEffect(() => {
    if (view === 'folders') return
    const id = ++latestRequest.current
    const isCurrent = () => id === latestRequest.current
    const requestPage = semanticActive ? 1 : page
    setLoading(true)
    setError('')

    async function load() {
      if (semanticActive) {
        const { search: q, ...rest } = params
        try {
          const r = await resumesApi.semantic({ q: q ?? '', ...rest, limit: SEMANTIC_LIMIT })
          if (!isCurrent()) return
          const list: ResumeRow[] = r.data.resumes ?? []
          setRows(list)
          setTotal(list.length)
          setResultMode('semantic')
          setLoading(false)
          return
        } catch (e) {
          if (!isCurrent()) return
          setNotice({ kind: 'error', text: apiDetail(e, SEMANTIC_UNAVAILABLE) })
        }
      }
      try {
        const r = await resumesApi.list({ page: requestPage, limit: PAGE_SIZE, ...params })
        if (!isCurrent()) return
        const list: ResumeRow[] = r.data.resumes ?? []
        const count: number = r.data.total ?? list.length
        if (list.length === 0 && count > 0 && requestPage > 1) {
          setPage(Math.ceil(count / PAGE_SIZE))
          return
        }
        setRows(list)
        setTotal(count)
        setResultMode('list')
      } catch {
        if (isCurrent()) setError("Couldn't load résumés.")
      } finally {
        if (isCurrent()) setLoading(false)
      }
    }

    load()
  }, [page, view, semanticActive, params, refreshKey])

  useEffect(() => { setSelected(new Set()) }, [page, paramsKey, view, semanticActive])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(t)
  }, [notice])

  useEffect(() => {
    if (!pendingDelete || deleting) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPendingDelete(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pendingDelete, deleting])

  const allSelected = rows.length > 0 && rows.every(r => selected.has(r.resume_id))
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = selected.size > 0 && !allSelected
  }, [selected, allSelected])

  const showingSemantic = resultMode === 'semantic'
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const firstShown = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const lastShown = Math.min(page * PAGE_SIZE, total)

  function changeStatus(value: string) {
    setSearchParams(value ? { status: value } : {}, { replace: true })
  }

  function changeFilters(patch: Partial<ResumeFilterValues>) {
    const { status: nextStatus, ...rest } = patch
    if (Object.keys(rest).length > 0) setBase(prev => ({ ...prev, ...rest }))
    if (view === 'folders' && leavesFolders(rest)) setView('all')
    if (nextStatus !== undefined) changeStatus(nextStatus)
    setPage(1)
  }

  function clearFilters() {
    setBase(EMPTY_FILTERS)
    changeStatus('')
    setPage(1)
  }

  function applySaved(next: ResumeFilterValues) {
    setBase(next)
    changeStatus(next.status)
    setView('all')
    setPage(1)
  }

  function changeView(next: ViewMode) {
    if (next === 'folders') setSemantic(false)
    setView(next)
    setPage(1)
  }

  function changeSemantic(on: boolean) {
    setSemantic(on)
    if (on && view === 'folders') setView('all')
    setPage(1)
  }

  function openFolder(value: string) {
    setBase(prev => ({ ...prev, businessDomain: value, role: '' }))
    setView('all')
    setPage(1)
  }

  function toggleRow(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map(r => r.resume_id)))
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      const { deleted, in_progress, not_found } = (await resumesApi.bulkDelete(pendingDelete.ids)).data
      const removed = deleted.length + not_found.length
      const skipped = in_progress.length
      if (removed > 0) {
        setNotice({
          kind: 'ok',
          text: `Deleted ${plural(removed, 'résumé', 'résumés')}.`
            + (skipped ? ` ${plural(skipped, 'was', 'were')} still being processed and skipped.` : ''),
        })
      } else {
        setNotice({
          kind: 'error',
          text: `Nothing was deleted: ${plural(skipped, 'résumé is', 'résumés are')} still being processed. Try again in a few minutes.`,
        })
      }
      setPendingDelete(null)
      setSelected(new Set())
      setRefreshKey(k => k + 1)
    } catch (e) {
      setNotice({ kind: 'error', text: apiDetail(e, 'Delete failed. Please try again.') })
      setPendingDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  const deleteTargets = pendingDelete?.ids.length ?? 0

  return (
    <div className="rs">
      <header className="rs-head">
        <div>
          <h1 className="rs-h1">Résumés</h1>
        </div>
        {isAdmin && (
          <button className="btn btn-primary btn-sm" onClick={() => setShowUpload(true)}>Upload Résumés</button>
        )}
      </header>

      {notice && (
        <div className={`rs-notice rs-notice-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
          <span>{notice.text}</span>
          <button className="rs-notice-x" onClick={() => setNotice(null)} aria-label="Dismiss">✕</button>
        </div>
      )}

      <section className="rs-card">
        <ResumeFilters
          filters={filters}
          options={options}
          optionsLoading={optionsLoading}
          semantic={semantic}
          view={view}
          onChange={changeFilters}
          onClearAll={clearFilters}
          onSemanticChange={changeSemantic}
          onViewChange={changeView}
          onApplySaved={applySaved}
          onNotice={setNotice}
        />

        {isAdmin && selected.size > 0 && (
          <div className="rs-bulk" role="region" aria-label="Bulk actions">
            <span className="rs-bulk-count">{selected.size} selected</span>
            <button
              className="rs-btn-delete"
              onClick={() => setPendingDelete({ ids: [...selected], label: plural(selected.size, 'résumé', 'résumés') })}
            >
              Delete selected
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>Clear selection</button>
          </div>
        )}

        {view === 'folders' ? (
          <ResumeFolders params={foldersFilter} reloadKey={refreshKey} hasFilters={hasFilters} onOpen={openFolder} />
        ) : error ? (
          <div className="rs-state">
            <p>{error}</p>
            <button className="btn btn-ghost btn-sm" onClick={() => setRefreshKey(k => k + 1)}>Retry</button>
          </div>
        ) : loading && rows.length === 0 ? (
          <div className="rs-skeleton" aria-busy="true">
            <span className="rs-sr-only">Loading résumés…</span>
            {Array.from({ length: 5 }, (_, i) => <div key={i} className="rs-skeleton-row" aria-hidden />)}
          </div>
        ) : rows.length === 0 ? (
          <div className="rs-state">
            {hasFilters ? (
              <>
                <p>No résumés match your filters.</p>
                <button className="btn btn-ghost btn-sm" onClick={clearFilters}>Clear filters</button>
              </>
            ) : (
              <>
                <p>No résumés yet.</p>
                {isAdmin && <button className="btn btn-primary btn-sm" onClick={() => setShowUpload(true)}>Upload Résumés</button>}
              </>
            )}
          </div>
        ) : (
          <div className={`rs-table-wrap${loading ? ' rs-table-busy' : ''}`}>
            <table className="rs-table">
              <thead>
                <tr>
                  {isAdmin && (
                    <th className="rs-col-check">
                      <input ref={selectAllRef} type="checkbox" aria-label="Select all résumés on this page" checked={allSelected} onChange={toggleAll} />
                    </th>
                  )}
                  <th>Candidate</th>
                  <th>File</th>
                  <th>Profile</th>
                  <th>Details</th>
                  {showingSemantic && <th>Match</th>}
                  <th>Status</th>
                  <th>Added</th>
                  <th className="rs-col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const label = rowLabel(r)
                  const badge = STATUS_BADGE[r.processing_status ?? '']
                  const years = r.classification?.years_experience
                  const skills = r.classification?.skills ?? []
                  return (
                    <tr key={r.resume_id} className={selected.has(r.resume_id) ? 'rs-row-selected' : undefined}>
                      {isAdmin && (
                        <td className="rs-col-check">
                          <input type="checkbox" aria-label={`Select ${label}`} checked={selected.has(r.resume_id)} onChange={() => toggleRow(r.resume_id)} />
                        </td>
                      )}
                      <td>
                        <div className="rs-person">
                          <span className="rs-avatar" aria-hidden>{initials(label)}</span>
                          <div className="rs-person-text">
                            <div className="rs-name" title={label}>{label}</div>
                            {r.candidate_email && <div className="rs-muted rs-ellipsis" title={r.candidate_email}>{r.candidate_email}</div>}
                            {r.headline && <div className="rs-muted rs-ellipsis" title={r.headline}>{r.headline}</div>}
                          </div>
                        </div>
                      </td>
                      <td><span className="rs-file" title={r.filename}>{r.filename || '-'}</span></td>
                      <td>
                        <div className="rs-cap">{pretty(r.classification?.job_domain) || '-'}</div>
                        {r.classification?.seniority_level && <div className="rs-muted rs-cap">{pretty(r.classification.seniority_level)}</div>}
                        {skills.length > 0 && (
                          <div className="rs-chips">
                            {skills.slice(0, MAX_SKILL_CHIPS).map(s => <span key={s} className="rs-chip">{s}</span>)}
                            {skills.length > MAX_SKILL_CHIPS && <span className="rs-chip rs-chip-more">+{skills.length - MAX_SKILL_CHIPS}</span>}
                          </div>
                        )}
                      </td>
                      <td>
                        {typeof years !== 'number' && !r.location
                          ? '-'
                          : (
                            <>
                              {typeof years === 'number' && <div>{plural(years, 'yr', 'yrs')}</div>}
                              {r.location && <div className="rs-muted">{r.location}</div>}
                            </>
                          )}
                      </td>
                      {showingSemantic && (
                        <td className="rs-nowrap"><span className="rs-match">{matchPercent(r.match_score)}</span></td>
                      )}
                      <td>
                        {badge
                          ? <span className={`badge ${badge.cls}`}>{badge.label}</span>
                          : <span className="badge badge-gray">{r.processing_status || 'Unknown'}</span>}
                      </td>
                      <td className="rs-nowrap">{formatDate(r.created_at)}</td>
                      <td className="rs-col-actions">
                        <button className="btn btn-ghost btn-sm rs-act" onClick={() => setViewer({ resumeId: r.resume_id, name: label })} aria-label={`View file for ${label}`}>
                          View
                        </button>
                        <button className="btn btn-ghost btn-sm rs-act" onClick={() => setJobScores({ resumeId: r.resume_id, name: label })} aria-label={`Job matches for ${label}`} title="See every job description this candidate is in, with scores">
                          JDs
                        </button>
                        {isAdmin && (
                          <button className="btn btn-danger btn-sm rs-act" onClick={() => setPendingDelete({ ids: [r.resume_id], label })} aria-label={`Delete ${label}`}>
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {view === 'all' && !error && total > 0 && (
          <footer className="rs-foot">
            {showingSemantic ? (
              <span className="rs-muted">Showing the {plural(total, 'closest match', 'closest matches')}</span>
            ) : (
              <>
                <span className="rs-muted">Showing {firstShown.toLocaleString()}–{lastShown.toLocaleString()} of {plural(total, 'résumé', 'résumés')}</span>
                <div className="rs-pager">
                  <button className="btn btn-ghost btn-sm" onClick={() => setPage(p => p - 1)} disabled={page <= 1 || loading}>Previous</button>
                  <span className="rs-muted">Page {page} of {pageCount}</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => setPage(p => p + 1)} disabled={page >= pageCount || loading}>Next</button>
                </div>
              </>
            )}
          </footer>
        )}
      </section>

      {pendingDelete && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget && !deleting) setPendingDelete(null) }}>
          <div className="modal-box" role="dialog" aria-modal="true" aria-labelledby="rs-del-title">
            <div className="modal-header">
              <h2 id="rs-del-title">{deleteTargets === 1 ? 'Delete this résumé?' : `Delete ${deleteTargets} résumés?`}</h2>
            </div>
            <div className="rs-modal-body">
              {deleteTargets === 1 && <p className="rs-modal-target">{pendingDelete.label}</p>}
              <p>
                {deleteTargets === 1 ? 'It will be' : 'They will be'} permanently removed, along with the stored file and
                {' '}{deleteTargets === 1 ? 'its' : 'their'} place in every job's candidate pipeline. Invite and interview
                records for {deleteTargets === 1 ? 'this candidate are' : 'these candidates are'} kept. This can't be undone.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost btn-sm" onClick={() => setPendingDelete(null)} disabled={deleting}>Cancel</button>
              <button className="rs-btn-delete" onClick={confirmDelete} disabled={deleting} autoFocus>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {jobScores && (
        <ResumeJobsModal resumeId={jobScores.resumeId} candidateName={jobScores.name} onClose={() => setJobScores(null)} />
      )}

      {viewer && (
        <ResumeViewerModal resumeId={viewer.resumeId} candidateName={viewer.name} onClose={() => setViewer(null)} />
      )}

      {showUpload && (
        <UploadResumesModal onClose={() => setShowUpload(false)} onUploaded={() => setRefreshKey(k => k + 1)} />
      )}
    </div>
  )
}
