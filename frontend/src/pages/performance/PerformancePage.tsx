import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { performanceApi, adminConfigApi, jobGradesApi, candidatesApi } from '../../lib/api'
import { ERASED_LABEL } from '../../lib/erased'
import { usePerformanceAccess } from './usePerformanceAccess'
import EmployeesPanel from './EmployeesPanel'
import RatingForm, { type RatingConfig } from './RatingForm'
import '../../styles/admin-tabs.css'
import './PerformancePage.css'

type ShowToast = (msg: string) => void

function errorMessage(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof detail === 'string' && detail.trim()) return detail
  if (Array.isArray(detail) && detail.length) {
    return detail
      .map(d => (d && typeof d === 'object' && 'msg' in d) ? String((d as { msg: unknown }).msg) : String(d))
      .join('; ')
  }
  return fallback
}

interface Cycle {
  cycle_id: string
  name: string
  period_start: string
  period_end: string
  scope: { type: string; value?: string | null }
  review_types: string[]
  status: 'draft' | 'active' | 'closed'
}

interface CycleCoverage {
  cycle_id: string
  cycle_name: string
  reviewer_types: string[]
  employees_in_scope: number
  expected_reviews: number
  submitted_reviews: number
  outstanding_reviews: number
  outstanding: Array<{
    employee_id: string
    employee_name?: string | null
    reviewer_type: string
    expected_reviewer_email?: string | null
    blocked: boolean
  }>
}

const REVIEW_TYPE_OPTIONS = ['self', 'manager', 'peer', 'skip_level'] as const

const EMPTY_CYCLE_FORM = {
  name: '', period_start: '', period_end: '',
  scope_type: 'org_wide' as string, scope_value: '',
  review_types: [] as string[],
}

function CyclesTab({ showToast }: { showToast: ShowToast }) {
  const [cycles, setCycles] = useState<Cycle[]>([])
  const [loading, setLoading] = useState(true)
  const [departments, setDepartments] = useState<{ department_id: string; name: string }[]>([])
  const [grades, setGrades] = useState<{ job_grade_id: string; name: string }[]>([])
  const [modal, setModal] = useState<'create' | 'edit' | null>(null)
  const [selected, setSelected] = useState<Cycle | null>(null)
  const [form, setForm] = useState({ ...EMPTY_CYCLE_FORM })
  const [saving, setSaving] = useState(false)

  const [coverageFor, setCoverageFor] = useState<Cycle | null>(null)
  const [coverage, setCoverage] = useState<CycleCoverage | null>(null)
  const [coverageLoading, setCoverageLoading] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const r = await performanceApi.cycles.list()
      setCycles(r.data.cycles ?? [])
    } catch { setCycles([]) }
    const [d, g] = await Promise.all([
      adminConfigApi.listDepartments().catch(() => ({ data: { departments: [] } })),
      jobGradesApi.list().catch(() => ({ data: { job_grades: [] } })),
    ])
    setDepartments(d.data.departments ?? [])
    setGrades(g.data.job_grades ?? g.data.grades ?? [])
    setLoading(false)
  }

  function openCreate() {
    setForm({ ...EMPTY_CYCLE_FORM })
    setSelected(null)
    setModal('create')
  }

  function openEdit(c: Cycle) {
    setSelected(c)
    setForm({
      name: c.name, period_start: c.period_start, period_end: c.period_end,
      scope_type: c.scope?.type || 'org_wide', scope_value: c.scope?.value || '',
      review_types: c.review_types || [],
    })
    setModal('edit')
  }

  function toggleReviewType(t: string) {
    setForm(f => ({
      ...f,
      review_types: f.review_types.includes(t) ? f.review_types.filter(x => x !== t) : [...f.review_types, t],
    }))
  }

  async function save() {
    setSaving(true)
    const scope = { type: form.scope_type, value: form.scope_type === 'org_wide' ? null : (form.scope_value || null) }
    try {
      if (modal === 'create') {
        await performanceApi.cycles.create({
          name: form.name, period_start: form.period_start, period_end: form.period_end,
          scope, review_types: form.review_types,
        })
        showToast('Cycle created')
      } else if (selected) {
        await performanceApi.cycles.update(selected.cycle_id, {
          name: form.name, period_start: form.period_start, period_end: form.period_end,
          scope, review_types: form.review_types,
        })
        showToast('Cycle updated')
      }
      setModal(null)
      load()
    } catch (e) {
      showToast(errorMessage(e, 'Failed to save cycle'))
    }
    setSaving(false)
  }

  async function activate(c: Cycle) {
    try {
      await performanceApi.cycles.update(c.cycle_id, { status: 'active' })
      showToast('Cycle activated')
      load()
    } catch (e) { showToast(errorMessage(e, 'Failed to activate cycle')) }
  }

  async function closeCycle(c: Cycle) {
    if (!confirm(`Close cycle "${c.name}"? This cannot be undone.`)) return
    try {
      await performanceApi.cycles.close(c.cycle_id)
      showToast('Cycle closed')
      load()
    } catch (e) { showToast(errorMessage(e, 'Failed to close cycle')) }
  }

  async function openCoverage(c: Cycle) {
    setCoverageFor(c)
    setCoverage(null)
    setCoverageLoading(true)
    try {
      const r = await performanceApi.cycles.coverage(c.cycle_id)
      setCoverage(r.data)
    } catch (e) {
      showToast(errorMessage(e, 'Failed to load review coverage'))
      setCoverageFor(null)
    }
    setCoverageLoading(false)
  }

  const formValid = form.name.trim() && form.period_start && form.period_end && form.review_types.length > 0
    && (form.scope_type === 'org_wide' || form.scope_value)

  const hasManagerOrSkipLevel = (c: Cycle) => (c.review_types || []).some(t => t === 'manager' || t === 'skip_level')

  return (
    <section className="pf-section">
      <div className="pf-table-wrap card">
        <div className="card-header">
          <span className="card-title">Performance Cycles</span>
          <button className="btn btn-primary" onClick={openCreate}>+ New Cycle</button>
        </div>
        {loading ? (
          <div className="pf-loading">Loading cycles…</div>
        ) : (
          <table className="pf-table">
            <thead><tr><th>Name</th><th>Period</th><th>Scope</th><th>Review Types</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {cycles.length === 0 ? (
                <tr><td colSpan={6} className="pf-empty">No cycles yet.</td></tr>
              ) : cycles.map(c => (
                <tr key={c.cycle_id}>
                  <td data-label="Name">{c.name}</td>
                  <td data-label="Period">{c.period_start} – {c.period_end}</td>
                  <td data-label="Scope">{c.scope?.type === 'org_wide' ? 'Org-wide' : `${c.scope?.type}: ${c.scope?.value}`}</td>
                  <td data-label="Review Types">{(c.review_types || []).join(', ')}</td>
                  <td data-label="Status">
                    <span className={`badge ${c.status === 'active' ? 'badge-green' : c.status === 'closed' ? 'badge-gray' : 'badge-yellow'}`}>{c.status}</span>
                  </td>
                  <td data-label="Actions">
                    <div className="pf-row-actions">
                      {c.status !== 'closed' && <button className="pf-action-btn" onClick={() => openEdit(c)}>Edit</button>}
                      {c.status === 'draft' && <button className="pf-action-btn" onClick={() => activate(c)}>Activate</button>}
                      {hasManagerOrSkipLevel(c) && <button className="pf-action-btn" onClick={() => openCoverage(c)}>Coverage</button>}
                      {c.status !== 'closed' && <button className="pf-action-btn pf-action-danger" onClick={() => closeCycle(c)}>Close</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{modal === 'create' ? 'New Cycle' : `Edit, ${selected?.name}`}</h2>
              <button className="modal-close" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="pf-modal-form">
              <label className="pf-field">
                <span className="form-label">Name *</span>
                <input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Q3 2026 Review" />
              </label>
              <div className="pf-field-row">
                <label className="pf-field">
                  <span className="form-label">Period Start *</span>
                  <input type="date" className="form-input" value={form.period_start} onChange={e => setForm(f => ({ ...f, period_start: e.target.value }))} />
                </label>
                <label className="pf-field">
                  <span className="form-label">Period End *</span>
                  <input type="date" className="form-input" value={form.period_end} onChange={e => setForm(f => ({ ...f, period_end: e.target.value }))} />
                </label>
              </div>
              <label className="pf-field">
                <span className="form-label">Scope</span>
                <select className="form-input" value={form.scope_type} onChange={e => setForm(f => ({ ...f, scope_type: e.target.value, scope_value: '' }))}>
                  <option value="org_wide">Org-wide</option>
                  <option value="department">Department</option>
                  <option value="job_grade">Job Grade</option>
                </select>
              </label>
              {form.scope_type === 'department' && (
                <label className="pf-field">
                  <span className="form-label">Department *</span>
                  <select className="form-input" value={form.scope_value} onChange={e => setForm(f => ({ ...f, scope_value: e.target.value }))}>
                    <option value="">Select a department</option>
                    {departments.map(d => <option key={d.department_id} value={d.department_id}>{d.name}</option>)}
                  </select>
                </label>
              )}
              {form.scope_type === 'job_grade' && (
                <label className="pf-field">
                  <span className="form-label">Job Grade *</span>
                  <select className="form-input" value={form.scope_value} onChange={e => setForm(f => ({ ...f, scope_value: e.target.value }))}>
                    <option value="">Select a job grade</option>
                    {grades.map(g => <option key={g.job_grade_id} value={g.name}>{g.name}</option>)}
                  </select>
                </label>
              )}
              <div className="pf-field">
                <span className="form-label">Review Types *</span>
                <div className="pf-checkbox-row">
                  {REVIEW_TYPE_OPTIONS.map(t => (
                    <label key={t} className="pf-checkbox">
                      <input type="checkbox" checked={form.review_types.includes(t)} onChange={() => toggleReviewType(t)} />
                      <span>{t.replace('_', '-')}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving || !formValid}>
                {saving ? 'Saving…' : modal === 'create' ? 'Create' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {coverageFor && (
        <div className="modal-overlay" onClick={() => setCoverageFor(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Review Coverage: {coverageFor.name}</h2>
              <button className="modal-close" onClick={() => setCoverageFor(null)}>✕</button>
            </div>
            <div className="pf-modal-form">
              {coverageLoading || !coverage ? (
                <div className="pf-loading">Loading coverage…</div>
              ) : (
                <>
                  {coverage.reviewer_types.map(rt => {
                    const outstandingForType = coverage.outstanding.filter(o => o.reviewer_type === rt).length
                    return (
                      <p key={rt} className="pf-coverage-summary">
                        <strong>{outstandingForType}</strong> of <strong>{coverage.employees_in_scope}</strong>{' '}
                        {rt.replace('_', '-')} reviews still outstanding
                      </p>
                    )
                  })}
                  {coverage.outstanding.length === 0 ? (
                    <p className="pf-empty">All manager/skip-level reviews for this cycle are in.</p>
                  ) : (
                    <table className="pf-table">
                      <thead><tr><th>Employee</th><th>Type</th><th>Expected Reviewer</th><th></th></tr></thead>
                      <tbody>
                        {coverage.outstanding.map((o, i) => (
                          <tr key={`${o.employee_id}-${o.reviewer_type}-${i}`}>
                            <td data-label="Employee">{o.employee_name || o.employee_id}</td>
                            <td data-label="Type">{o.reviewer_type.replace('_', '-')}</td>
                            <td data-label="Expected Reviewer">{o.expected_reviewer_email || '-'}</td>
                            <td data-label="">
                              {o.blocked && (
                                <span className="badge badge-yellow" title="No manager assigned to resolve this reviewer yet">
                                  blocked
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setCoverageFor(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

interface RatingDimensionRow {
  dimension_id: string
  name: string
  description?: string | null
}

function RatingConfigTab({ showToast }: { showToast: ShowToast }) {
  const [scaleMin, setScaleMin] = useState(1)
  const [scaleMax, setScaleMax] = useState(5)
  const [dimensions, setDimensions] = useState<RatingDimensionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [scaleSaving, setScaleSaving] = useState(false)
  const [modal, setModal] = useState<'create' | 'edit' | null>(null)
  const [selected, setSelected] = useState<RatingDimensionRow | null>(null)
  const [form, setForm] = useState({ name: '', description: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const r = await performanceApi.ratingConfig()
      setScaleMin(r.data.scale_min ?? 1)
      setScaleMax(r.data.scale_max ?? 5)
      setDimensions(r.data.dimensions ?? [])
    } catch { }
    setLoading(false)
  }

  async function saveScale() {
    setScaleSaving(true)
    try {
      await performanceApi.ratingScale.update({ scale_min: scaleMin, scale_max: scaleMax })
      showToast('Rating scale saved')
      load()
    } catch (e) { showToast(errorMessage(e, 'Failed to save rating scale')) }
    setScaleSaving(false)
  }

  function openCreate() { setForm({ name: '', description: '' }); setSelected(null); setModal('create') }
  function openEdit(d: RatingDimensionRow) { setSelected(d); setForm({ name: d.name, description: d.description || '' }); setModal('edit') }

  async function save() {
    setSaving(true)
    try {
      if (modal === 'create') {
        await performanceApi.ratingDimensions.create({ name: form.name, description: form.description || undefined })
        showToast('Rating dimension created')
      } else if (selected) {
        await performanceApi.ratingDimensions.update(selected.dimension_id, { name: form.name, description: form.description })
        showToast('Rating dimension updated')
      }
      setModal(null)
      load()
    } catch (e) { showToast(errorMessage(e, 'Failed to save rating dimension')) }
    setSaving(false)
  }

  async function remove(d: RatingDimensionRow) {
    if (!confirm(`Delete rating dimension "${d.name}"?`)) return
    try {
      await performanceApi.ratingDimensions.delete(d.dimension_id)
      showToast('Rating dimension deleted')
      load()
    } catch (e) { showToast(errorMessage(e, 'Failed to delete rating dimension')) }
  }

  return (
    <section className="pf-section">
      <div className="pf-table-wrap card">
        <div className="card-header">
          <span className="card-title">Rating Scale</span>
        </div>
        <div className="pf-scale-row">
          <label className="pf-field">
            <span className="form-label">Minimum</span>
            <input type="number" className="form-input" value={scaleMin} onChange={e => setScaleMin(Number(e.target.value))} />
          </label>
          <label className="pf-field">
            <span className="form-label">Maximum</span>
            <input type="number" className="form-input" value={scaleMax} onChange={e => setScaleMax(Number(e.target.value))} />
          </label>
          <button className="btn btn-primary btn-sm pf-scale-save" onClick={saveScale} disabled={scaleSaving || scaleMin >= scaleMax}>
            {scaleSaving ? 'Saving…' : 'Save Scale'}
          </button>
        </div>
      </div>

      <div className="pf-table-wrap card">
        <div className="card-header">
          <span className="card-title">Rating Dimensions</span>
          <button className="btn btn-primary" onClick={openCreate}>+ Add Dimension</button>
        </div>
        {loading ? (
          <div className="pf-loading">Loading…</div>
        ) : (
          <table className="pf-table">
            <thead><tr><th>Name</th><th>Description</th><th></th></tr></thead>
            <tbody>
              {dimensions.length === 0 ? (
                <tr><td colSpan={3} className="pf-empty">No rating dimensions yet.</td></tr>
              ) : dimensions.map(d => (
                <tr key={d.dimension_id}>
                  <td data-label="Name">{d.name}</td>
                  <td data-label="Description">{d.description || '-'}</td>
                  <td data-label="Actions">
                    <div className="pf-row-actions">
                      <button className="pf-action-btn" onClick={() => openEdit(d)}>Edit</button>
                      <button className="pf-action-btn pf-action-danger" onClick={() => remove(d)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{modal === 'create' ? 'Add Dimension' : `Edit, ${selected?.name}`}</h2>
              <button className="modal-close" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="pf-modal-form">
              <label className="pf-field">
                <span className="form-label">Name *</span>
                <input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Communication" />
              </label>
              <label className="pf-field">
                <span className="form-label">Description</span>
                <input className="form-input" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional" />
              </label>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving || !form.name.trim()}>
                {saving ? 'Saving…' : modal === 'create' ? 'Create' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

interface ReportEmployee {
  employee_id: string
  candidate_id: string
  department?: string | null
  job_grade?: string | null
}

interface MyReview {
  review_id: string
  employee_id: string
  reviewer_type: string
  status: string
  submitted_at?: string | null
}

interface ActiveCycle {
  cycle_id: string
  name: string
  status: string
}

function MyReportsTab({ showToast }: { showToast: ShowToast }) {
  const [directReports, setDirectReports] = useState<ReportEmployee[]>([])
  const [skipReports, setSkipReports] = useState<ReportEmployee[]>([])
  const [loading, setLoading] = useState(true)
  const [candidateInfo, setCandidateInfo] = useState<Record<string, { name?: string; email?: string; erased?: boolean }>>({})

  const [cycles, setCycles] = useState<ActiveCycle[]>([])

  const [reviewModal, setReviewModal] = useState<{ employee: ReportEmployee; reviewerType: 'manager' | 'skip_level' } | null>(null)
  const [ratingConfig, setRatingConfig] = useState<RatingConfig | null>(null)
  const [selectedCycleId, setSelectedCycleId] = useState('')
  const [submitBusy, setSubmitBusy] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const [mine, setMine] = useState<MyReview[]>([])
  const [mineLoading, setMineLoading] = useState(true)

  useEffect(() => { load(); loadMine() }, [])

  async function load() {
    setLoading(true)
    try {
      const r = await performanceApi.myReports()
      const direct: ReportEmployee[] = r.data.direct_reports ?? []
      const skip: ReportEmployee[] = r.data.skip_level_reports ?? []
      setDirectReports(direct)
      setSkipReports(skip)
      await loadNames([...direct, ...skip].map(e => e.candidate_id))
    } catch { setDirectReports([]); setSkipReports([]) }
    try {
      const r = await performanceApi.cycles.listActive()
      setCycles(r.data.cycles ?? [])
    } catch { setCycles([]) }
    performanceApi.ratingConfig().then(r => setRatingConfig(r.data)).catch(() => setRatingConfig(null))
    setLoading(false)
  }

  async function loadMine() {
    setMineLoading(true)
    try {
      const r = await performanceApi.reviewsMine()
      setMine(r.data.reviews ?? [])
    } catch { setMine([]) }
    setMineLoading(false)
  }

  async function loadNames(candidateIds: string[]) {
    const unique = Array.from(new Set(candidateIds.filter(Boolean)))
    const pairs = await Promise.all(unique.map(async id => {
      try { const r = await candidatesApi.get(id); return [id, { name: r.data?.name, email: r.data?.email, erased: r.data?.erased === true }] as const }
      catch { return [id, {}] as const }
    }))
    setCandidateInfo(prev => ({ ...prev, ...Object.fromEntries(pairs) }))
  }

  function nameOf(candidateId: string): string {
    if (candidateInfo[candidateId]?.erased) return ERASED_LABEL
    return candidateInfo[candidateId]?.name || candidateId
  }

  function openReview(employee: ReportEmployee, reviewerType: 'manager' | 'skip_level') {
    setReviewModal({ employee, reviewerType })
    setSelectedCycleId(cycles[0]?.cycle_id || '')
    setSubmitError('')
  }

  async function submitReview(ratings: Record<string, number>, comments: string) {
    if (!reviewModal) return
    const cycleId = selectedCycleId
    if (!cycleId) { setSubmitError('Choose a cycle first'); return }
    setSubmitBusy(true)
    setSubmitError('')
    try {
      await performanceApi.managerSubmit({
        cycle_id: cycleId,
        employee_id: reviewModal.employee.employee_id,
        reviewer_type: reviewModal.reviewerType,
        ratings, comments: comments || undefined,
      })
      showToast('Review submitted')
      setReviewModal(null)
      loadMine()
    } catch (e) {
      setSubmitError(errorMessage(e, 'Failed to submit review'))
    }
    setSubmitBusy(false)
  }

  function ReportsTable({ list, reviewerType, emptyLabel }: { list: ReportEmployee[]; reviewerType: 'manager' | 'skip_level'; emptyLabel: string }) {
    return (
      <table className="pf-table">
        <thead><tr><th>Employee</th><th>Department</th><th>Job Grade</th><th></th></tr></thead>
        <tbody>
          {list.length === 0 ? (
            <tr><td colSpan={4} className="pf-empty">{emptyLabel}</td></tr>
          ) : list.map(e => (
            <tr key={e.employee_id}>
              <td data-label="Employee">{nameOf(e.candidate_id)}</td>
              <td data-label="Department">{e.department || '-'}</td>
              <td data-label="Job Grade">{e.job_grade || '-'}</td>
              <td data-label="Actions">
                <button className="pf-action-btn" onClick={() => openReview(e, reviewerType)}>Submit Review</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  const allReports = [...directReports, ...skipReports]

  return (
    <section className="pf-section">
      <div className="pf-table-wrap card">
        <div className="card-header"><span className="card-title">Direct Reports</span></div>
        {loading ? <div className="pf-loading">Loading…</div> : <ReportsTable list={directReports} reviewerType="manager" emptyLabel="You have no direct reports." />}
      </div>

      <div className="pf-table-wrap card">
        <div className="card-header"><span className="card-title">Skip-Level Reports</span></div>
        {loading ? <div className="pf-loading">Loading…</div> : <ReportsTable list={skipReports} reviewerType="skip_level" emptyLabel="You have no skip-level reports." />}
      </div>

      <div className="pf-table-wrap card">
        <div className="card-header"><span className="card-title">Reviews I&rsquo;ve Submitted</span></div>
        {mineLoading ? <div className="pf-loading">Loading…</div> : (
          <table className="pf-table">
            <thead><tr><th>Employee</th><th>Type</th><th>Status</th><th>Submitted</th></tr></thead>
            <tbody>
              {mine.length === 0 ? (
                <tr><td colSpan={4} className="pf-empty">You haven&rsquo;t submitted any reviews yet.</td></tr>
              ) : mine.map(r => {
                const emp = allReports.find(e => e.employee_id === r.employee_id)
                return (
                  <tr key={r.review_id}>
                    <td data-label="Employee">{emp ? nameOf(emp.candidate_id) : r.employee_id}</td>
                    <td data-label="Type">{r.reviewer_type}</td>
                    <td data-label="Status"><span className="badge badge-green">{r.status}</span></td>
                    <td data-label="Submitted">{r.submitted_at ? new Date(r.submitted_at).toLocaleDateString('en-GB') : '-'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {reviewModal && ratingConfig && (
        <div className="modal-overlay" onClick={() => setReviewModal(null)}>
          <div className="modal-box pf-review-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{reviewModal.reviewerType === 'manager' ? 'Manager Review' : 'Skip-Level Review'} - {nameOf(reviewModal.employee.candidate_id)}</h2>
              <button className="modal-close" onClick={() => setReviewModal(null)}>✕</button>
            </div>
            <div className="pf-modal-form">
              <label className="pf-field">
                <span className="form-label">Cycle *</span>
                <select className="form-input" value={selectedCycleId} onChange={e => setSelectedCycleId(e.target.value)}>
                  <option value="">Select a cycle</option>
                  {cycles.map(c => <option key={c.cycle_id} value={c.cycle_id}>{c.name}</option>)}
                </select>
                {cycles.length === 0 && (
                  <span className="adm-field-hint">No active cycle right now: ask an admin to activate one.</span>
                )}
              </label>
              <RatingForm
                config={ratingConfig}
                submitting={submitBusy}
                error={submitError}
                submitLabel={reviewModal.reviewerType === 'manager' ? 'Submit Manager Review' : 'Submit Skip-Level Review'}
                onSubmit={submitReview}
              />
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

type Tab = 'cycles' | 'rating-config' | 'employees' | 'my-reports'

const TAB_LABELS: Record<Tab, string> = {
  cycles: 'Cycles',
  'rating-config': 'Rating Config',
  employees: 'Employees',
  'my-reports': 'My Reports',
}

const ALL_TABS: Tab[] = ['cycles', 'rating-config', 'employees', 'my-reports']

function isTab(v: string | null): v is Tab {
  return !!v && (ALL_TABS as string[]).includes(v)
}

export default function PerformancePage() {
  const access = usePerformanceAccess()
  const [searchParams, setSearchParams] = useSearchParams()
  const rawTab = searchParams.get('tab')

  const [toast, setToast] = useState('')
  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3500)
  }

  if (access.loading) {
    return (
      <div className="pf-page">
        <div className="page-header"><div><div className="page-title">Performance</div></div></div>
        <div className="pf-loading-page">Checking access…</div>
      </div>
    )
  }

  if (!access.hasAnyAccess) {
    return (
      <div className="pf-page">
        <div className="page-header"><div><div className="page-title">Performance</div></div></div>
        <div className="pf-no-access card">
          You don&rsquo;t have access to Performance Management. Ask an admin to grant you the relevant permission.
        </div>
      </div>
    )
  }

  const availableTabs: Tab[] = [
    ...(access.canRead ? (['cycles', 'rating-config', 'employees'] as Tab[]) : []),
    ...(access.canReview ? (['my-reports'] as Tab[]) : []),
  ]
  const tab: Tab = (isTab(rawTab) && availableTabs.includes(rawTab)) ? rawTab : availableTabs[0]

  function setTab(next: Tab) {
    setSearchParams(next === availableTabs[0] ? {} : { tab: next }, { replace: true })
  }

  return (
    <div className="pf-page">
      {toast && <div className="pf-toast">{toast}</div>}
      <div className="page-header">
        <div>
          <div className="page-title">Performance</div>
        </div>
      </div>

      <div className="adm-tabs" role="tablist">
        {availableTabs.map(t => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`adm-tab${tab === t ? ' adm-tab-active' : ''}`}
            onClick={() => setTab(t)}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === 'cycles' && <CyclesTab showToast={showToast} />}
      {tab === 'rating-config' && <RatingConfigTab showToast={showToast} />}
      {tab === 'employees' && <EmployeesPanel canManage={access.canManage} showToast={showToast} />}
      {tab === 'my-reports' && <MyReportsTab showToast={showToast} />}
    </div>
  )
}
