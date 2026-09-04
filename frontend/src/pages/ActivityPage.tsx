import { useEffect, useState } from 'react'
import { intelApi, jobsApi } from '../lib/api'
import { useAuthStore } from '../store/auth.store'
import { useUploadStore } from '../store/upload.store'
import './ActivityPage.css'

type Batch = Record<string, unknown>
type Job = Record<string, unknown>

function fmtTime(iso?: string) {
  if (!iso) return '-'
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) }
  catch { return iso }
}
function fmtDate(iso?: string) {
  if (!iso) return '-'
  try { return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' } as Intl.DateTimeFormatOptions) }
  catch { return iso }
}

function BatchDetailModal({ batchId, onClose }: { batchId: string; onClose: () => void }) {
  const [d, setD] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    intelApi.batchDetail(batchId).then(r => setD(r.data)).catch(() => setD(null)).finally(() => setLoading(false))
  }, [batchId])

  const tokens = (d?.tokens || {}) as Record<string, number>
  const byJd = (d?.by_jd || []) as { job_id: string; title: string; count: number }[]
  const errors = (d?.errors || []) as { filename: string; error: string }[]
  const cost = (d?.cost_usd as number) ?? 0

  const stats = [
    { label: 'Uploaded', val: (d?.total_files as number) ?? 0, cls: '' },
    { label: 'Processed', val: (d?.processed as number) ?? 0, cls: 'ok' },
    { label: 'Duplicates skipped', val: (d?.skipped_duplicates as number) ?? 0, cls: 'warn' },
    { label: 'Failed', val: (d?.failed as number) ?? 0, cls: 'danger' },
    { label: 'Matched to JDs', val: (d?.matched as number) ?? 0, cls: 'ok' },
    { label: 'Not matched', val: (d?.not_matched as number) ?? 0, cls: 'muted' },
    { label: 'Auto-invited', val: (d?.auto_invited as number) ?? 0, cls: 'accent' },
  ]

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-box act-modal">
        <div className="modal-header">
          <h2>Batch summary</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="act-modal-body">
          {loading ? (
            <div className="act-loading">Loading…</div>
          ) : !d ? (
            <div className="act-loading">Batch not found.</div>
          ) : (
            <>
              <div className="act-stat-grid">
                {stats.map(s => (
                  <div key={s.label} className={`act-stat ${s.cls}`}>
                    <span className="act-stat-val">{s.val}</span>
                    <span className="act-stat-label">{s.label}</span>
                  </div>
                ))}
              </div>

              {((d?.ignored_files as number) ?? 0) > 0 && (
                <p className="act-ignored-note">
                  {(d?.ignored_files as number)} temp/invalid file{(d?.ignored_files as number) !== 1 ? 's' : ''} ignored before processing (e.g. Word “~$” lock files).
                </p>
              )}

              <div className="act-cost">
                <div className="act-cost-main">
                  <span className="act-cost-label">OpenAI cost (this batch)</span>
                  <span className="act-cost-val">${cost.toFixed(4)}</span>
                </div>
                <div className="act-cost-tokens">
                  {(tokens.prompt ?? 0).toLocaleString()} prompt · {(tokens.completion ?? 0).toLocaleString()} completion · {(tokens.embedding ?? 0).toLocaleString()} embedding tokens
                </div>
              </div>

              <div className="act-section-title">Resumes per Job Description</div>
              {byJd.length > 0 ? (
                <div className="act-jd-list">
                  {byJd.map(j => (
                    <div key={j.job_id} className="act-jd-row">
                      <span className="act-jd-title">{j.title}</span>
                      <span className="act-jd-count">{j.count}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="act-empty-note">No resumes from this batch matched an open JD.</p>
              )}

              {errors.length > 0 && (
                <>
                  <div className="act-section-title">Failed files ({errors.length})</div>
                  <div className="act-err-list">
                    {errors.map((e, i) => (
                      <div key={i} className="act-err-row">
                        <span className="act-err-file">{e.filename}</span>
                        <span className="act-err-msg">{e.error}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="act-meta">
                Uploaded by <strong>{(d.uploaded_by as string) || 'unknown'}</strong> · {fmtTime(d.created_at as string)}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const PAGE_SIZE = 10

function ResumesActivity({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const [batches, setBatches] = useState<Batch[]>([])
  const [loading, setLoading] = useState(true)
  const [openBatch, setOpenBatch] = useState<string | null>(null)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [purging, setPurging] = useState(false)
  const [purgeMsg, setPurgeMsg] = useState('')
  const [page, setPage] = useState(1)

  const uploadStatus = useUploadStore(s => s.batch?.status)

  const totalPages = Math.max(1, Math.ceil(batches.length / PAGE_SIZE))
  useEffect(() => { if (page > totalPages) setPage(totalPages) }, [page, totalPages])
  const pageItems = batches.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function load() {
    setLoading(true)
    setPage(1)
    intelApi.batches(25).then(r => setBatches(r.data.batches || [])).catch(() => setBatches([])).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])
  useEffect(() => { if (uploadStatus === 'completed') load() }, [uploadStatus])

  async function deleteBatch(e: React.MouseEvent, batchId: string) {
    e.stopPropagation()
    if (!confirm('Dismiss this batch notification? (Processed resumes are kept.)')) return
    try { await intelApi.deleteBatch(batchId); setBatches(bs => bs.filter(b => b.batch_id !== batchId)) } catch {}
  }

  async function clearAll() {
    if (!confirm('Clear all batch notifications? (Processed resumes are kept.)')) return
    try { await intelApi.clearBatches(); setBatches([]) } catch {}
  }

  async function handlePurge() {
    if (!fromDate && !toDate) { setPurgeMsg('Pick at least one date.'); return }
    const range = `${fromDate || 'the beginning'} → ${toDate || 'now'}`
    if (!confirm(`Permanently delete ALL resumes created between ${range}?\n\nThis removes them from the database, file store, and JD pipelines. This cannot be undone.`)) return
    setPurging(true); setPurgeMsg('')
    try {
      const r = await intelApi.purgeResumes({ from_date: fromDate || undefined, to_date: toDate || undefined })
      setPurgeMsg(`Deleted ${r.data.deleted ?? 0} resume${r.data.deleted !== 1 ? 's' : ''}.`)
      load()
    } catch { setPurgeMsg('Delete failed.') }
    setPurging(false)
  }

  return (
    <div className="act-pane">
      <div className="act-pane-head">
        <h2>Resume processing</h2>
        <div className="act-head-actions">
          {isSuperAdmin && batches.length > 0 && (
            <button className="act-clear" onClick={clearAll}>Clear all</button>
          )}
          <button className="act-refresh" onClick={load}>↻ Refresh</button>
        </div>
      </div>

      {loading ? (
        <div className="act-loading">Loading batches…</div>
      ) : batches.length === 0 ? (
        <div className="act-empty">No upload batches yet. Upload resumes to see processing activity here.</div>
      ) : (
        <>
        <div className="act-batch-list">
          {pageItems.map(b => {
            const status = (b.status as string) || 'processing'
            const done = status === 'completed'
            return (
              <div
                key={b.batch_id as string}
                className="act-batch"
                role="button" tabIndex={0}
                onClick={() => setOpenBatch(b.batch_id as string)}
                onKeyDown={e => e.key === 'Enter' && setOpenBatch(b.batch_id as string)}
              >
                <span className={`act-batch-dot ${status}`} />
                <div className="act-batch-info">
                  <div className="act-batch-title">
                    {done ? '✓ Processed' : status === 'failed' ? '✕ Failed' : '⏳ Processing'}
                    {' '}{(b.processed as number) ?? 0}/{(b.total_files as number) ?? 0} resumes
                  </div>
                  <div className="act-batch-sub">
                    by {(b.uploaded_by as string) || 'unknown'} · {fmtTime(b.created_at as string)}
                    {(b.cost_usd as number) > 0 && <> · ${(b.cost_usd as number).toFixed(3)}</>}
                  </div>
                </div>
                <span className="act-batch-view">View details →</span>
                {isSuperAdmin && (
                  <button className="act-row-del" title="Dismiss notification" onClick={e => deleteBatch(e, b.batch_id as string)}>✕</button>
                )}
              </div>
            )
          })}
        </div>
        {totalPages > 1 && (
          <div className="act-pagination">
            <button className="act-page-btn" disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))}>← Prev</button>
            <span className="act-page-info">
              Page {page} of {totalPages}
              <span className="act-page-range"> · showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, batches.length)} of {batches.length}</span>
            </span>
            <button className="act-page-btn" disabled={page === totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Next →</button>
          </div>
        )}
        </>
      )}

      {isSuperAdmin && (
        <div className="act-danger">
          <div className="act-danger-title">⚠ Delete resumes by date (super admin)</div>
          <p>Permanently remove resumes created in a date range from all stores.</p>
          <div className="act-danger-row">
            <label>From<input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} /></label>
            <label>To<input type="date" value={toDate} onChange={e => setToDate(e.target.value)} /></label>
            <button className="act-btn-danger" onClick={handlePurge} disabled={purging}>
              {purging ? 'Deleting…' : 'Delete resumes'}
            </button>
          </div>
          {purgeMsg && <div className="act-danger-msg">{purgeMsg}</div>}
        </div>
      )}

      {openBatch && <BatchDetailModal batchId={openBatch} onClose={() => setOpenBatch(null)} />}
    </div>
  )
}

function JDActivity({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const [expired, setExpired] = useState<Job[]>([])
  const [autoDelete, setAutoDelete] = useState(false)
  const [autoDeleted, setAutoDeleted] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [page, setPage] = useState(1)

  const totalPages = Math.max(1, Math.ceil(expired.length / PAGE_SIZE))
  useEffect(() => { if (page > totalPages) setPage(totalPages) }, [page, totalPages])
  const pageItems = expired.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function load() {
    setLoading(true)
    setPage(1)
    jobsApi.expired().then(r => {
      setExpired(r.data.expired || [])
      setAutoDelete(!!r.data.auto_delete_expired)
      setAutoDeleted(r.data.auto_deleted || 0)
    }).catch(() => setExpired([])).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  async function toggleAuto(next: boolean) {
    setBusy(true); setMsg('')
    try {
      await jobsApi.setJdSettings({ auto_delete_expired: next })
      setAutoDelete(next)
      load()
    } catch { setMsg('Could not update setting.') }
    setBusy(false)
  }

  async function deleteOne(jobId: string) {
    if (!confirm('Delete this expired job description? This cannot be undone.')) return
    try { await jobsApi.delete(jobId); setExpired(xs => xs.filter(j => j.job_id !== jobId)) } catch { setMsg('Delete failed.') }
  }

  async function purgeAll() {
    if (!confirm(`Delete ALL ${expired.length} expired job description${expired.length !== 1 ? 's' : ''}? This cannot be undone.`)) return
    setBusy(true); setMsg('')
    try {
      const r = await jobsApi.purgeExpired()
      setMsg(`Deleted ${r.data.deleted ?? 0} expired JD${r.data.deleted !== 1 ? 's' : ''}.`)
      load()
    } catch { setMsg('Delete failed.') }
    setBusy(false)
  }

  return (
    <div className="act-pane">
      <div className="act-pane-head">
        <h2>Job descriptions</h2>
        <button className="act-refresh" onClick={load}>↻ Refresh</button>
      </div>

      {isSuperAdmin && (
        <div className="act-toggle-card">
          <div>
            <div className="act-toggle-title">Auto-delete expired JDs</div>
            <div className="act-toggle-sub">When on, JDs are removed automatically once their deadline passes. Super-admin only.</div>
          </div>
          <button
            className={`act-toggle${autoDelete ? ' on' : ''}`}
            onClick={() => toggleAuto(!autoDelete)}
            disabled={busy}
            role="switch" aria-checked={autoDelete}
          >
            <span className="act-toggle-knob" />
          </button>
        </div>
      )}

      {loading ? (
        <div className="act-loading">Loading…</div>
      ) : autoDelete ? (
        <div className="act-empty">
          Auto-delete is <strong>on</strong> - expired JDs are removed automatically.
          {autoDeleted > 0 && <> Just cleaned up {autoDeleted}.</>}
        </div>
      ) : expired.length === 0 ? (
        <div className="act-empty">No expired job descriptions. 🎉</div>
      ) : (
        <>
          <div className="act-expired-head">
            <span className="act-expired-count">{expired.length} expired JD{expired.length !== 1 ? 's' : ''}</span>
            {isSuperAdmin && (
              <button className="act-btn-danger" onClick={purgeAll} disabled={busy}>
                Delete all expired
              </button>
            )}
          </div>
          <div className="act-batch-list">
            {pageItems.map(j => (
              <div key={j.job_id as string} className="act-expired-row">
                <span className="act-batch-dot failed" />
                <div className="act-batch-info">
                  <div className="act-batch-title">{j.title as string}</div>
                  <div className="act-batch-sub">
                    {(j.company_name as string) || '-'} · closed {fmtDate(j.deadline_at as string)}
                    {' · '}<span className="act-src">{(j.source as string) || 'manual'}</span>
                  </div>
                </div>
                <span className="act-expired-badge">Expired</span>
                {isSuperAdmin && (
                  <button className="act-row-del" title="Delete this JD" onClick={() => deleteOne(j.job_id as string)}>✕</button>
                )}
              </div>
            ))}
          </div>
          {totalPages > 1 && (
            <div className="act-pagination">
              <button className="act-page-btn" disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))}>← Prev</button>
              <span className="act-page-info">
                Page {page} of {totalPages}
                <span className="act-page-range"> · showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, expired.length)} of {expired.length}</span>
              </span>
              <button className="act-page-btn" disabled={page === totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Next →</button>
            </div>
          )}
        </>
      )}
      {msg && <div className="act-danger-msg">{msg}</div>}
    </div>
  )
}

export default function ActivityPage() {
  const user = useAuthStore(s => s.user) as Record<string, string> | null
  const isSuperAdmin = user?.role === 'superadmin'
  const [tab, setTab] = useState<'resumes' | 'jds'>('resumes')

  return (
    <div className="activity-page">
      <div className="act-header">
        <h1>Activity</h1>
        <div className="act-tabs">
          <button className={`act-tab${tab === 'resumes' ? ' active' : ''}`} onClick={() => setTab('resumes')}>Resumes</button>
          <button className={`act-tab${tab === 'jds' ? ' active' : ''}`} onClick={() => setTab('jds')}>Job Descriptions</button>
        </div>
      </div>
      {tab === 'resumes' ? <ResumesActivity isSuperAdmin={isSuperAdmin} /> : <JDActivity isSuperAdmin={isSuperAdmin} />}
    </div>
  )
}
