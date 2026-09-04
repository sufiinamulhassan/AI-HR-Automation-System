import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { jobsApi, intelApi } from '../../../lib/api'
import JobForm from '../components/JobForm'
import JobList from '../components/JobList'
import JobDetails from '../components/JobDetails'
import UploadResumesModal from '../components/UploadResumesModal'
import UploadProgressWidget from '../components/UploadProgressWidget'
import CandidatePipeline from '../components/CandidatePipeline'
import ReportModal from '../components/ReportModal'
import { useUploadStore } from '../../../store/upload.store'
import { useAuthStore } from '../../../store/auth.store'
import './HRBotDashboard.css'

type Job = Record<string, unknown>

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
  const [stats, setStats] = useState<IntelStats>({})
  const [tab, setTab] = useState<'pipeline' | 'details'>('pipeline')
  const [search, setSearch] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [rematching, setRematching] = useState(false)
  const [rematchMsg, setRematchMsg] = useState('')
  const [showRematchConfirm, setShowRematchConfirm] = useState(false)

  const user = useAuthStore(s => s.user)
  const isSuperAdmin = user?.role === 'superadmin'

  const uploadStatus = useUploadStore(s => s.batch?.status)
  const resumeUpload = useUploadStore(s => s.resume)
  const prevUploadStatus = useRef<string | undefined>(undefined)

  const [searchParams, setSearchParams] = useSearchParams()

  useEffect(() => {
    (async () => {
      const list = await loadJobs()
      loadStats()
      resumeUpload()

      if (searchParams.get('new') !== null) {
        setEditJob(null); setShowJobForm(true)
      } else if (searchParams.get('upload') !== null) {
        setShowBulkUpload(true)
      }
      if (searchParams.get('new') !== null || searchParams.get('upload') !== null) {
        setSearchParams({}, { replace: true })
      }
      if (list.length) handleSelectJob(list[0])
    })()
  }, [])

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

  async function loadStats() {
    try {
      const r = await intelApi.stats()
      setStats(r.data)
    } catch {}
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

        <button className="btn-upload-resumes" onClick={() => setShowBulkUpload(true)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Upload Resumes
        </button>

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
        />
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
            </div>

            {tab === 'pipeline' && (
              <CandidatePipeline
                job={jobDetail ?? selectedJob}
                onViewReport={setReportToken}
                onRefresh={() => loadJobs(search || undefined)}
              />
            )}
            {tab === 'details' && <JobDetails job={jobDetail ?? selectedJob} />}
          </>
        ) : (
          <div className="hrbot-empty">
            <div className="hrbot-empty-icon">
              <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="var(--gray-300)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                <polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
              </svg>
            </div>
            <h3>{jobsTotal > 0 ? 'Select a job description' : 'No job descriptions yet'}</h3>
            <p>
              {jobsTotal > 0
                ? 'Pick a JD from the sidebar to review its candidate pipeline.'
                : 'Create your first job description to start matching candidates.'}
            </p>
            <button className="btn-primary" onClick={() => { setEditJob(null); setShowJobForm(true) }}>
              + Create New JD
            </button>
          </div>
        )}
      </section>

      {showJobForm && (
        <JobForm job={editJob} onSave={handleSave} onClose={() => setShowJobForm(false)} />
      )}

      {reportToken && (
        <ReportModal token={reportToken} onClose={() => setReportToken(null)} />
      )}

      {showBulkUpload && (
        <UploadResumesModal onClose={() => setShowBulkUpload(false)} />
      )}

      {showRematchConfirm && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowRematchConfirm(false) }}>
          <div className="modal-box rematch-confirm">
            <div className="rematch-confirm-body">
              <div className="rematch-warn-icon" aria-hidden>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
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

      <UploadProgressWidget onOpen={() => setShowBulkUpload(true)} />
    </div>
  )
}
