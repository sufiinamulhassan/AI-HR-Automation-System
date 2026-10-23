import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { jobsApi, intelApi } from '../../../lib/api'
import JobForm from '../components/JobForm'
import JobList from '../components/JobList'
import JobBrowserModal from '../components/JobBrowserModal'
import JobDetails from '../components/JobDetails'
import LowMatchCleanup from '../components/LowMatchCleanup'
import SourcingPanel from '../components/SourcingPanel'
import UploadResumesModal from '../components/UploadResumesModal'
import UploadProgressWidget from '../components/UploadProgressWidget'
import CandidatePipeline from '../components/CandidatePipeline'
import CompareCandidatesModal from '../components/CompareCandidatesModal'
import ReportModal from '../components/ReportModal'
import { useUploadStore } from '../../../store/upload.store'
import { useAuthStore } from '../../../store/auth.store'
import './HRBotDashboard.css'

type Job = Record<string, unknown>

const CompareIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
  </svg>
)

interface IntelStats {
  total?: number
  by_domain?: Record<string, number>
  by_seniority?: Record<string, number>
  invite_funnel?: {
    auto_invited?: number
    manually_invited?: number
    interviewed?: number
    hired?: number
  }
}

export default function HRBotDashboard() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [jobsTotal, setJobsTotal] = useState(0)
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [jobDetail, setJobDetail] = useState<Job | null>(null)
  const [showJobForm, setShowJobForm] = useState(false)
  const [editJob, setEditJob] = useState<Job | null>(null)
  const [reportToken, setReportToken] = useState<string | null>(null)
  const [showBulkUpload, setShowBulkUpload] = useState(false)
  const [showJobBrowser, setShowJobBrowser] = useState(false)
  const [showCompare, setShowCompare] = useState(false)
  const [stats, setStats] = useState<IntelStats>({})
  const [tab, setTab] = useState<'pipeline' | 'details' | 'sourcing' | 'cleanup'>('pipeline')
  const [search, setSearch] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [rematching, setRematching] = useState(false)
  const [rematchMsg, setRematchMsg] = useState('')
  const [showRematchConfirm, setShowRematchConfirm] = useState(false)

  const user = useAuthStore(s => s.user)
  const isSuperAdmin = user?.role === 'superadmin'
  const isAdmin = user?.role === 'admin' || isSuperAdmin

  const uploadStatus = useUploadStore(s => s.batch?.status)
  const resumeUpload = useUploadStore(s => s.resume)
  const prevUploadStatus = useRef<string | undefined>(undefined)

  const [searchParams, setSearchParams] = useSearchParams()
  const [focus, setFocus] = useState<{ jobId: string; candidateId: string } | null>(null)
  const started = useRef(false)

  function takeLinkParams(names: string[]) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      for (const name of names) next.delete(name)
      return next
    }, { replace: true })
  }

  useEffect(() => {
    (async () => {
      const list = await loadJobs()
      loadStats()
      if (isAdmin) resumeUpload()

      const wantsNew = searchParams.get('new') !== null
      const wantsUpload = searchParams.get('upload') !== null
      if (isAdmin && wantsNew) {
        setEditJob(null); setShowJobForm(true)
      } else if (isAdmin && wantsUpload) {
        setShowBulkUpload(true)
      }

      const linkedJob = searchParams.get('job')
      const linkedCandidate = searchParams.get('candidate')
      const found = linkedJob ? await findJob(linkedJob, list) : null
      const start = found?.job ?? list[0] ?? null
      if (found?.full) openFetchedJob(found.job)
      else if (start) handleSelectJob(start)
      if (linkedCandidate && start) setFocus({ jobId: start.job_id as string, candidateId: linkedCandidate })

      if (wantsNew || wantsUpload || linkedJob !== null || linkedCandidate !== null) {
        takeLinkParams(['new', 'upload', 'job', 'candidate'])
      }
      started.current = true
    })()
  }, [])

  useEffect(() => {
    if (!started.current) return
    const linkedJob = searchParams.get('job')
    const linkedCandidate = searchParams.get('candidate')
    if (linkedJob === null && linkedCandidate === null) return
    ;(async () => {
      let open = selectedJob
      if (linkedJob && linkedJob !== selectedJob?.job_id) {
        const found = await findJob(linkedJob, jobs)
        if (found) {
          open = found.job
          if (found.full) openFetchedJob(found.job)
          else handleSelectJob(found.job)
        }
      } else {
        setTab('pipeline')
      }
      if (linkedCandidate && open) setFocus({ jobId: open.job_id as string, candidateId: linkedCandidate })
      takeLinkParams(['job', 'candidate'])
    })()
  }, [searchParams])

  useEffect(() => {
    if (uploadStatus === 'completed' && prevUploadStatus.current !== 'completed') {
      loadStats()
      loadJobs(search || undefined)
    }
    prevUploadStatus.current = uploadStatus
  }, [uploadStatus])

  async function loadJobs(q?: string): Promise<Job[]> {
    try {
      const r = await jobsApi.list({ page: 1, limit: 50, ...(q ? { search: q } : {}) })
      const list: Job[] = r.data.jobs ?? []
      setJobs(list)
      setJobsTotal(r.data.total ?? list.length)
      return list
    } catch { return [] }
  }

  async function loadJobDetail(id: string) {
    setJobDetail(null)
    try {
      const r = await jobsApi.get(id)
      setJobDetail(r.data)
    } catch { setJobDetail(null) }
  }

  async function refreshJobDetail(id: string) {
    try {
      const r = await jobsApi.get(id)
      setJobDetail(current => (current && current.job_id !== id ? current : r.data))
    } catch { }
  }

  async function findJob(id: string, known: Job[]): Promise<{ job: Job; full: boolean } | null> {
    const listed = known.find(j => j.job_id === id)
    if (listed) return { job: listed, full: false }
    try {
      const r = await jobsApi.get(id)
      return r.data?.job_id ? { job: r.data as Job, full: true } : null
    } catch { return null }
  }

  function openFetchedJob(job: Job) {
    setSelectedJob(job)
    setJobDetail(job)
    setTab('pipeline')
  }

  async function loadStats() {
    try {
      const r = await intelApi.stats()
      setStats(r.data)
    } catch { }
  }

  async function handleRematch() {
    setShowRematchConfirm(false)
    setRematching(true)
    setRematchMsg('')
    try {
      const r = await jobsApi.rematchAll(false)
      const list = await loadJobs(search || undefined)
      await loadStats()
      if (selectedJob) {
        const fresh = list.find(j => j.job_id === selectedJob.job_id)
        if (fresh) setSelectedJob(fresh)
      }
      setRematchMsg(`Matched ${r.data.matched ?? 0} across ${r.data.jobs ?? 0} JDs`)
    } catch {
      setRematchMsg('Re-match failed')
    }
    setRematching(false)
    setTimeout(() => setRematchMsg(''), 5000)
  }

  function handleSearch(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value
    setSearch(q)
    loadJobs(q || undefined)
  }

  function handleSelectJob(job: Job) {
    setSelectedJob(job)
    setTab('pipeline')
    loadJobDetail(job.job_id as string)
  }

  async function handleEditJob(job: Job) {
    const id = job.job_id as string
    if (jobDetail?.job_id === id) {
      setEditJob(jobDetail)
    } else {
      try { const r = await jobsApi.get(id); setEditJob(r.data) }
      catch { setEditJob(job) }
    }
    setShowJobForm(true)
  }

  async function handleDeleteJob(id: string) {
    if (!confirm('Delete this job?')) return
    setDeleteError('')
    try {
      await jobsApi.delete(id)
      if (selectedJob?.job_id === id) { setSelectedJob(null); setJobDetail(null) }
      loadJobs(search || undefined)
    } catch {
      setDeleteError('Failed to delete job. Please try again.')
      setTimeout(() => setDeleteError(''), 4000)
    }
  }

  async function handleSave() {
    setShowJobForm(false)
    const list = await loadJobs(search || undefined)
    if (selectedJob) {
      const updated = list.find(j => j.job_id === selectedJob.job_id)
      if (updated) { setSelectedJob(updated); loadJobDetail(updated.job_id as string) }
    }
  }

  const clearFocus = useCallback(() => setFocus(null), [])

  const funnel = stats.invite_funnel ?? {}

  return (
    <div className={`hrbot-dashboard${selectedJob ? ' hrbot-mobile-detail' : ''}`}>

      <aside className="job-sidebar">
        <div className="job-sidebar-header">
          <h2>Job Descriptions</h2>
          {isSuperAdmin && (
            <button
              className="btn-sm btn-rematch"
              onClick={() => setShowRematchConfirm(true)}
              disabled={rematching}
              title="Re-match all resumes against all job descriptions"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={rematching ? 'spin' : ''}>
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 16h5v5" />
              </svg>
              {rematching ? 'Matching…' : 'Re-match'}
            </button>
          )}
        </div>
        {rematchMsg && <div className="rematch-msg">{rematchMsg}</div>}

        <div className="stats-bar">
          <div className="stat">
            <span className="stat-val">{stats.total ?? 0}</span>
            <span className="stat-label">Resumes</span>
          </div>
          <div className="stat">
            <span className="stat-val">{jobsTotal}</span>
            <span className="stat-label">Open JDs</span>
          </div>
          <div className="stat">
            <span className="stat-val">{funnel.auto_invited ?? 0}</span>
            <span className="stat-label">Invited</span>
          </div>
          <div className="stat stat-hired">
            <span className="stat-val">{funnel.hired ?? 0}</span>
            <span className="stat-label">Hired</span>
          </div>
        </div>

        {isAdmin && (
          <button className="btn-upload-resumes" onClick={() => setShowBulkUpload(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Upload Resumes
          </button>
        )}

        <input
          className="job-search"
          type="search"
          placeholder="Search jobs…"
          value={search}
          onChange={handleSearch}
        />

        {deleteError && <div className="job-delete-error">{deleteError}</div>}

        <JobList
          jobs={jobs}
          selected={selectedJob?.job_id as string | undefined}
          onSelect={handleSelectJob}
          onEdit={handleEditJob}
          onDelete={handleDeleteJob}
          canManage={isAdmin}
        />

        <div className="job-sidebar-footer">
          <button className="btn-browse-jobs" onClick={() => setShowJobBrowser(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
            Browse all jobs
          </button>
        </div>
      </aside>

      <section className="hrbot-content">
        {selectedJob ? (
          <>
            <button
              className="hrbot-back-btn"
              onClick={() => { setSelectedJob(null); setJobDetail(null) }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
              </svg>
              Back to jobs
            </button>
            <div className="content-tabs">
              <button className={`tab${tab === 'pipeline' ? ' active' : ''}`} onClick={() => setTab('pipeline')}>
                Candidate Pipeline
              </button>
              <button className={`tab${tab === 'details' ? ' active' : ''}`} onClick={() => setTab('details')}>
                Job Details
              </button>
              <button className={`tab${tab === 'sourcing' ? ' active' : ''}`} onClick={() => setTab('sourcing')}>
                Sourcing
              </button>
              {isAdmin && (
                <button className={`tab${tab === 'cleanup' ? ' active' : ''}`} onClick={() => setTab('cleanup')}>
                  Remove Low Matches
                </button>
              )}
              {isAdmin && (
                <button type="button" className="btn btn-ghost btn-sm content-tabs-action" onClick={() => setShowCompare(true)}>
                  <CompareIcon /> Compare
                </button>
              )}
            </div>

            {tab === 'pipeline' && (
              <CandidatePipeline
                job={jobDetail ?? selectedJob}
                onViewReport={setReportToken}
                onRefresh={() => loadJobs(search || undefined)}
                focusCandidateId={focus && focus.jobId === selectedJob.job_id ? focus.candidateId : null}
                onFocusHandled={clearFocus}
              />
            )}
            {tab === 'details' && <JobDetails job={jobDetail ?? selectedJob} />}
            {tab === 'sourcing' && <SourcingPanel jobId={selectedJob.job_id as string} />}
            {tab === 'cleanup' && isAdmin && (
              <section className="lmc-panel" aria-labelledby="lmc-panel-title">
                <h3 className="lmc-panel-title" id="lmc-panel-title">Remove Low Matches</h3>
                <LowMatchCleanup
                  key={selectedJob.job_id as string}
                  jobId={selectedJob.job_id as string}
                  currentMinimum={typeof (jobDetail ?? selectedJob).min_match_score === 'number' ? (jobDetail ?? selectedJob).min_match_score as number : null}
                  onDone={() => { refreshJobDetail(selectedJob.job_id as string); loadJobs(search || undefined) }}
                />
              </section>
            )}
          </>
        ) : (
          <div className="hrbot-empty">
            <div className="hrbot-empty-icon">
              <svg width="46" height="46" viewBox="0 0 24 24" fill="currentColor" fillOpacity="0.16" stroke="var(--gray-300)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                <polyline points="14 2 14 8 20 8" fill="none" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
              </svg>
            </div>
            <h3>{jobsTotal > 0 ? 'Select a job description' : 'No job descriptions yet'}</h3>
            <p>
              {jobsTotal > 0
                ? 'Pick a JD from the sidebar to review its candidate pipeline.'
                : isAdmin
                  ? 'Create your first job description to start matching candidates.'
                  : 'Job descriptions added by an admin will appear here.'}
            </p>
            {isAdmin && (
              <button className="btn-primary" onClick={() => { setEditJob(null); setShowJobForm(true) }}>
                + Create New JD
              </button>
            )}
          </div>
        )}
      </section>

      {isAdmin && showJobForm && (
        <JobForm job={editJob} onSave={handleSave} onClose={() => setShowJobForm(false)} />
      )}

      {reportToken && (
        <ReportModal token={reportToken} onClose={() => setReportToken(null)} />
      )}

      {showCompare && isAdmin && selectedJob && (
        <CompareCandidatesModal
          key={selectedJob.job_id as string}
          jobId={selectedJob.job_id as string}
          jobTitle={(jobDetail ?? selectedJob).title as string}
          onClose={() => setShowCompare(false)}
        />
      )}

      {isAdmin && showBulkUpload && (
        <UploadResumesModal onClose={() => setShowBulkUpload(false)} />
      )}

      {showJobBrowser && (
        <JobBrowserModal onSelect={handleSelectJob} onClose={() => setShowJobBrowser(false)} />
      )}

      {showRematchConfirm && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowRematchConfirm(false) }}>
          <div className="modal-box rematch-confirm">
            <div className="rematch-confirm-body">
              <div className="rematch-warn-icon" aria-hidden>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" fillOpacity="0.16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </div>
              <h2>Re-match all resumes?</h2>
              <p>
                This will run a similarity match of <strong>every resume</strong> against
                <strong> every job description</strong> and rebuild all candidate pipelines.
              </p>
              <p className="rematch-confirm-note">
                It processes the entire resume pool in one pass, so it can be a heavy operation
                and may take a while. Only run this when you intend to refresh all pipelines.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setShowRematchConfirm(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleRematch}>Yes, re-match all</button>
            </div>
          </div>
        </div>
      )}

      {isAdmin && <UploadProgressWidget onOpen={() => setShowBulkUpload(true)} />}
    </div>
  )
}
