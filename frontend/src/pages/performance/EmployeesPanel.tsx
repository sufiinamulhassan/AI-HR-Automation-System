import { useEffect, useState } from 'react'
import { performanceApi, adminConfigApi, authApi, candidatesApi } from '../../lib/api'
import { ERASED_LABEL } from '../../lib/erased'
import type { RatingConfig } from './RatingForm'
import './EmployeesPanel.css'

interface Employee {
  employee_id: string
  candidate_id: string
  job_id?: string | null
  offer_id?: string | null
  department?: string | null
  job_grade?: string | null
  manager_id?: string | null
  hired_at?: string | null
  status: string
}

interface Goal {
  goal_id: string
  owner_id: string
  title: string
  description?: string | null
  due_date?: string | null
  progress_pct: number
  parent_goal_id?: string | null
  status: 'active' | 'completed' | 'abandoned'
}

interface Review {
  review_id: string
  cycle_id: string
  employee_id: string
  reviewer_id: string
  reviewer_type: 'self' | 'manager' | 'peer' | 'skip_level'
  secure_token?: string
  ratings: Record<string, number>
  comments?: string | null
  status: 'pending' | 'submitted'
  submitted_at?: string | null
}

interface Cycle {
  cycle_id: string
  name: string
  status: 'draft' | 'active' | 'closed'
  review_types: string[]
}

interface CandidateInfo { name?: string; email?: string; erased?: boolean }

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

function formatDate(d?: string | null): string {
  if (!d) return '-'
  const parsed = new Date(d)
  if (isNaN(parsed.getTime())) return d
  return parsed.toLocaleDateString('en-GB')
}

const GOAL_STATUSES = ['active', 'completed', 'abandoned'] as const
const EMPTY_GOAL_FORM = { title: '', description: '', due_date: '', parent_goal_id: '', progress_pct: 0, status: 'active' as string }

interface EmployeesPanelProps {
  canManage: boolean
  showToast: (msg: string) => void
}

export default function EmployeesPanel({ canManage, showToast }: EmployeesPanelProps) {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [departments, setDepartments] = useState<{ department_id: string; name: string }[]>([])
  const [candidateInfo, setCandidateInfo] = useState<Record<string, CandidateInfo>>({})
  const [managerEmails, setManagerEmails] = useState<string[]>([])

  const [filters, setFilters] = useState({ department: '', job_grade: '', manager_id: '' })
  const [selected, setSelected] = useState<Employee | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const [empRes, deptRes] = await Promise.all([
        performanceApi.employees.list(),
        adminConfigApi.listDepartments().catch(() => ({ data: { departments: [] } })),
      ])
      const emps: Employee[] = empRes.data.employees ?? []
      setEmployees(emps)
      setDepartments(deptRes.data.departments ?? [])
      await loadCandidateNames(emps.map(e => e.candidate_id))
    } catch {
      setEmployees([])
    }
    try {
      const r = await authApi.listUsers()
      const users = Array.isArray(r.data) ? r.data : []
      setManagerEmails(users.map((u: { email: string }) => u.email))
    } catch { setManagerEmails([]) }
    setLoading(false)
  }

  async function loadCandidateNames(candidateIds: string[]) {
    const unique = Array.from(new Set(candidateIds.filter(Boolean)))
    const missing = unique.filter(id => !(id in candidateInfo))
    if (missing.length === 0) return
    const pairs = await Promise.all(missing.map(async id => {
      try {
        const r = await candidatesApi.get(id)
        return [id, { name: r.data?.name, email: r.data?.email, erased: r.data?.erased === true }] as const
      } catch {
        return [id, {}] as const
      }
    }))
    setCandidateInfo(prev => ({ ...prev, ...Object.fromEntries(pairs) }))
  }

  async function applyFilters() {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (filters.department) params.department = filters.department
      if (filters.job_grade) params.job_grade = filters.job_grade
      if (filters.manager_id) params.manager_id = filters.manager_id
      const r = await performanceApi.employees.list(params)
      const emps: Employee[] = r.data.employees ?? []
      setEmployees(emps)
      await loadCandidateNames(emps.map(e => e.candidate_id))
    } catch { }
    setLoading(false)
  }

  function departmentName(id?: string | null): string {
    if (!id) return '-'
    return departments.find(d => d.department_id === id)?.name || id
  }

  function candidateName(candidateId: string): string {
    if (candidateInfo[candidateId]?.erased) return ERASED_LABEL
    return candidateInfo[candidateId]?.name || candidateId
  }

  return (
    <section className="ep-section">
      <div className="ep-filters">
        <label className="ep-filter-field">
          <span className="form-label">Department</span>
          <select className="form-input" value={filters.department} onChange={e => setFilters(f => ({ ...f, department: e.target.value }))}>
            <option value="">All departments</option>
            {departments.map(d => <option key={d.department_id} value={d.department_id}>{d.name}</option>)}
          </select>
        </label>
        <label className="ep-filter-field">
          <span className="form-label">Job Grade</span>
          <input className="form-input" value={filters.job_grade} onChange={e => setFilters(f => ({ ...f, job_grade: e.target.value }))} placeholder="e.g. AVP" />
        </label>
        <label className="ep-filter-field">
          <span className="form-label">Manager Email</span>
          <input className="form-input" value={filters.manager_id} onChange={e => setFilters(f => ({ ...f, manager_id: e.target.value }))} placeholder="manager@company.com" />
        </label>
        <button className="btn btn-primary btn-sm ep-filter-btn" onClick={applyFilters}>Apply Filters</button>
      </div>

      <div className="ep-table-wrap card">
        {loading ? (
          <div className="ep-loading">Loading employees…</div>
        ) : (
          <table className="ep-table">
            <thead>
              <tr><th>Employee</th><th>Department</th><th>Job Grade</th><th>Manager</th><th>Status</th><th>Hired</th><th></th></tr>
            </thead>
            <tbody>
              {employees.length === 0 ? (
                <tr><td colSpan={7} className="ep-empty">No employees found.</td></tr>
              ) : employees.map(emp => (
                <tr key={emp.employee_id}>
                  <td data-label="Employee">
                    <div className="ep-name">{candidateName(emp.candidate_id)}</div>
                    <div className="ep-email">{candidateInfo[emp.candidate_id]?.email || ''}</div>
                  </td>
                  <td data-label="Department">{departmentName(emp.department)}</td>
                  <td data-label="Job Grade">{emp.job_grade || '-'}</td>
                  <td data-label="Manager">{emp.manager_id || '-'}</td>
                  <td data-label="Status"><span className={`badge ${emp.status === 'active' ? 'badge-green' : 'badge-gray'}`}>{emp.status}</span></td>
                  <td data-label="Hired">{formatDate(emp.hired_at)}</td>
                  <td data-label="Actions">
                    <button className="ep-view-btn" onClick={() => setSelected(emp)}>View</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <EmployeeDetail
          employee={selected}
          employees={employees}
          departmentName={departmentName}
          candidateName={candidateName}
          managerEmails={managerEmails}
          canManage={canManage}
          showToast={showToast}
          onClose={() => setSelected(null)}
          onManagerUpdated={updated => {
            setEmployees(list => list.map(e => e.employee_id === updated.employee_id ? updated : e))
            setSelected(updated)
          }}
        />
      )}
    </section>
  )
}

interface EmployeeDetailProps {
  employee: Employee
  employees: Employee[]
  departmentName: (id?: string | null) => string
  candidateName: (candidateId: string) => string
  managerEmails: string[]
  canManage: boolean
  showToast: (msg: string) => void
  onClose: () => void
  onManagerUpdated: (updated: Employee) => void
}

function EmployeeDetail({
  employee, employees, departmentName, candidateName, managerEmails, canManage, showToast, onClose, onManagerUpdated,
}: EmployeeDetailProps) {
  const [goals, setGoals] = useState<Goal[]>([])
  const [goalsLoading, setGoalsLoading] = useState(true)
  const [goalModal, setGoalModal] = useState<'create' | 'edit' | null>(null)
  const [goalSelected, setGoalSelected] = useState<Goal | null>(null)
  const [goalForm, setGoalForm] = useState({ ...EMPTY_GOAL_FORM })
  const [saving, setSaving] = useState(false)

  const [managerDraft, setManagerDraft] = useState(employee.manager_id || '')
  const [managerSaving, setManagerSaving] = useState(false)

  const [cycles, setCycles] = useState<Cycle[]>([])
  const [cyclesBlocked, setCyclesBlocked] = useState(false)
  const [reviewCycleId, setReviewCycleId] = useState('')
  const [reviews, setReviews] = useState<Review[]>([])
  const [reviewsLoading, setReviewsLoading] = useState(false)
  const [assignModal, setAssignModal] = useState(false)
  const [assignForm, setAssignForm] = useState({ reviewer_type: 'self' as 'self' | 'peer', reviewer_employee_id: '' })
  const [assigning, setAssigning] = useState(false)
  const [ratingConfig, setRatingConfig] = useState<RatingConfig | null>(null)

  useEffect(() => {
    loadGoals()
    loadCycles()
    performanceApi.ratingConfig().then(r => setRatingConfig(r.data)).catch(() => setRatingConfig(null))
    setManagerDraft(employee.manager_id || '')
  }, [employee.employee_id])

  useEffect(() => {
    if (reviewCycleId) loadReviews(reviewCycleId)
  }, [reviewCycleId, employee.employee_id])

  async function loadGoals() {
    setGoalsLoading(true)
    try {
      const r = await performanceApi.employees.listGoals(employee.employee_id)
      setGoals(r.data.goals ?? [])
    } catch { setGoals([]) }
    setGoalsLoading(false)
  }

  async function loadCycles() {
    try {
      const r = await performanceApi.cycles.list()
      const list: Cycle[] = r.data.cycles ?? []
      setCycles(list)
      setCyclesBlocked(false)
      const active = list.find(c => c.status === 'active')
      if (active) setReviewCycleId(active.cycle_id)
    } catch {
      setCycles([])
      setCyclesBlocked(true)
    }
  }

  async function loadReviews(cycleId: string) {
    setReviewsLoading(true)
    try {
      const r = await performanceApi.reviews.list({ cycle_id: cycleId, employee_id: employee.employee_id })
      setReviews(r.data.reviews ?? [])
    } catch { setReviews([]) }
    setReviewsLoading(false)
  }

  function openCreateGoal() {
    setGoalForm({ ...EMPTY_GOAL_FORM })
    setGoalSelected(null)
    setGoalModal('create')
  }

  function openEditGoal(g: Goal) {
    setGoalSelected(g)
    setGoalForm({
      title: g.title, description: g.description || '', due_date: g.due_date || '',
      parent_goal_id: g.parent_goal_id || '', progress_pct: g.progress_pct, status: g.status,
    })
    setGoalModal('edit')
  }

  async function saveGoal() {
    setSaving(true)
    try {
      if (goalModal === 'create') {
        await performanceApi.employees.createGoal(employee.employee_id, {
          title: goalForm.title,
          description: goalForm.description || undefined,
          due_date: goalForm.due_date || undefined,
          parent_goal_id: goalForm.parent_goal_id || undefined,
        })
        showToast('Goal created')
      } else if (goalSelected) {
        await performanceApi.goals.update(goalSelected.goal_id, {
          title: goalForm.title,
          description: goalForm.description,
          due_date: goalForm.due_date || null,
          progress_pct: goalForm.progress_pct,
          status: goalForm.status,
          parent_goal_id: goalForm.parent_goal_id || null,
        })
        showToast('Goal updated')
      }
      setGoalModal(null)
      loadGoals()
    } catch (e) {
      showToast(errorMessage(e, 'Failed to save goal'))
    }
    setSaving(false)
  }

  async function saveManager() {
    setManagerSaving(true)
    try {
      const r = await performanceApi.employees.setManager(employee.employee_id, managerDraft.trim() || null)
      showToast('Manager updated')
      onManagerUpdated(r.data)
    } catch (e) {
      showToast(errorMessage(e, 'Failed to update manager'))
    }
    setManagerSaving(false)
  }

  async function submitAssign() {
    if (!reviewCycleId) {
      showToast('Choose a cycle first')
      return
    }
    setAssigning(true)
    try {
      await performanceApi.reviews.assign({
        cycle_id: reviewCycleId,
        employee_id: employee.employee_id,
        reviewer_type: assignForm.reviewer_type,
        reviewer_employee_id: assignForm.reviewer_type === 'peer' ? assignForm.reviewer_employee_id : undefined,
      })
      showToast('Review assigned and invite sent')
      setAssignModal(false)
      loadReviews(reviewCycleId)
    } catch (e) {
      showToast(errorMessage(e, 'Failed to assign review'))
    }
    setAssigning(false)
  }

  const otherEmployees = employees.filter(e => e.employee_id !== employee.employee_id)
  const selectedCycle = cycles.find(c => c.cycle_id === reviewCycleId)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box ep-detail-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{candidateName(employee.candidate_id)}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="ep-detail-body">
          <div className="ep-detail-summary">
            <span><strong>Department:</strong> {departmentName(employee.department)}</span>
            <span><strong>Job Grade:</strong> {employee.job_grade || '-'}</span>
            <span><strong>Status:</strong> {employee.status}</span>
          </div>

          <div className="ep-detail-card">
            <div className="ep-detail-card-title">Manager</div>
            {canManage ? (
              <div className="ep-manager-row">
                <input
                  className="form-input"
                  list="ep-manager-suggestions"
                  value={managerDraft}
                  onChange={e => setManagerDraft(e.target.value)}
                  placeholder="manager@company.com (leave blank to clear)"
                />
                <datalist id="ep-manager-suggestions">
                  {managerEmails.map(m => <option key={m} value={m} />)}
                </datalist>
                <button className="btn btn-primary btn-sm" onClick={saveManager} disabled={managerSaving}>
                  {managerSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            ) : (
              <p className="ep-readonly-text">{employee.manager_id || 'No manager assigned.'}</p>
            )}
          </div>

          <div className="ep-detail-card">
            <div className="ep-detail-card-title-row">
              <span className="ep-detail-card-title">Goals</span>
              {canManage && <button className="btn btn-ghost btn-sm" onClick={openCreateGoal}>+ Add Goal</button>}
            </div>
            {goalsLoading ? (
              <div className="ep-loading">Loading goals…</div>
            ) : goals.length === 0 ? (
              <p className="ep-readonly-text">No goals set.</p>
            ) : (
              <ul className="ep-goal-list">
                {goals.map(g => (
                  <li key={g.goal_id} className="ep-goal-item">
                    <div className="ep-goal-main">
                      <span className="ep-goal-title">{g.title}</span>
                      <span className={`badge ${g.status === 'completed' ? 'badge-green' : g.status === 'abandoned' ? 'badge-gray' : 'badge-blue'}`}>{g.status}</span>
                      <span className="ep-goal-progress">{g.progress_pct}%</span>
                    </div>
                    {g.description && <p className="ep-goal-desc">{g.description}</p>}
                    <div className="ep-goal-footer">
                      <span className="ep-goal-due">Due {formatDate(g.due_date)}</span>
                      {canManage && <button className="ep-view-btn" onClick={() => openEditGoal(g)}>Edit</button>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="ep-detail-card">
            <div className="ep-detail-card-title-row">
              <span className="ep-detail-card-title">Reviews</span>
              {canManage && (
                <button className="btn btn-ghost btn-sm" onClick={() => setAssignModal(true)} disabled={!reviewCycleId}>
                  + Assign Review
                </button>
              )}
            </div>
            {cyclesBlocked ? (
              <p className="ep-readonly-text">Cycle information isn&rsquo;t available to you.</p>
            ) : (
              <label className="ep-cycle-select">
                <span className="form-label">Cycle</span>
                <select className="form-input" value={reviewCycleId} onChange={e => setReviewCycleId(e.target.value)}>
                  <option value="">Select a cycle</option>
                  {cycles.map(c => <option key={c.cycle_id} value={c.cycle_id}>{c.name} ({c.status})</option>)}
                </select>
              </label>
            )}
            {reviewsLoading ? (
              <div className="ep-loading">Loading reviews…</div>
            ) : reviewCycleId && (
              reviews.length === 0 ? (
                <p className="ep-readonly-text">No reviews for this cycle yet.</p>
              ) : (
                <ul className="ep-review-list">
                  {reviews.map(r => (
                    <li key={r.review_id} className="ep-review-item">
                      <span className="ep-review-type">{r.reviewer_type}</span>
                      <span className={`badge ${r.status === 'submitted' ? 'badge-green' : 'badge-yellow'}`}>{r.status}</span>
                      <span className="ep-review-date">{r.submitted_at ? formatDate(r.submitted_at) : 'Not yet submitted'}</span>
                    </li>
                  ))}
                </ul>
              )
            )}
          </div>
        </div>
      </div>

      {goalModal && (
        <div className="modal-overlay" onClick={() => setGoalModal(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{goalModal === 'create' ? 'Add Goal' : 'Edit Goal'}</h2>
              <button className="modal-close" onClick={() => setGoalModal(null)}>✕</button>
            </div>
            <div className="ep-modal-form">
              <label className="ep-field">
                <span className="form-label">Title *</span>
                <input className="form-input" value={goalForm.title} onChange={e => setGoalForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Ship the Q3 migration" />
              </label>
              <label className="ep-field">
                <span className="form-label">Description</span>
                <input className="form-input" value={goalForm.description} onChange={e => setGoalForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional" />
              </label>
              <label className="ep-field">
                <span className="form-label">Due Date</span>
                <input type="date" className="form-input" value={goalForm.due_date} onChange={e => setGoalForm(f => ({ ...f, due_date: e.target.value }))} />
              </label>
              <label className="ep-field">
                <span className="form-label">Parent Goal</span>
                <select className="form-input" value={goalForm.parent_goal_id} onChange={e => setGoalForm(f => ({ ...f, parent_goal_id: e.target.value }))}>
                  <option value="">None</option>
                  {goals.filter(g => g.goal_id !== goalSelected?.goal_id).map(g => <option key={g.goal_id} value={g.goal_id}>{g.title}</option>)}
                </select>
              </label>
              {goalModal === 'edit' && (
                <>
                  <label className="ep-field">
                    <span className="form-label">Progress ({goalForm.progress_pct}%)</span>
                    <input
                      type="number" min={0} max={100} className="form-input"
                      value={goalForm.progress_pct}
                      onChange={e => setGoalForm(f => ({ ...f, progress_pct: Math.max(0, Math.min(100, Number(e.target.value))) }))}
                    />
                  </label>
                  <label className="ep-field">
                    <span className="form-label">Status</span>
                    <select className="form-input" value={goalForm.status} onChange={e => setGoalForm(f => ({ ...f, status: e.target.value }))}>
                      {GOAL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                </>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setGoalModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveGoal} disabled={saving || !goalForm.title.trim()}>
                {saving ? 'Saving…' : goalModal === 'create' ? 'Create' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {assignModal && (
        <div className="modal-overlay" onClick={() => setAssignModal(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Assign Review: {selectedCycle?.name}</h2>
              <button className="modal-close" onClick={() => setAssignModal(false)}>✕</button>
            </div>
            <div className="ep-modal-form">
              <label className="ep-field">
                <span className="form-label">Reviewer Type</span>
                <select
                  className="form-input"
                  value={assignForm.reviewer_type}
                  onChange={e => setAssignForm(f => ({ ...f, reviewer_type: e.target.value as 'self' | 'peer' }))}
                >
                  <option value="self">Self</option>
                  <option value="peer">Peer</option>
                </select>
              </label>
              {assignForm.reviewer_type === 'peer' && (
                <label className="ep-field">
                  <span className="form-label">Peer Reviewer *</span>
                  <select
                    className="form-input"
                    value={assignForm.reviewer_employee_id}
                    onChange={e => setAssignForm(f => ({ ...f, reviewer_employee_id: e.target.value }))}
                  >
                    <option value="">Select an employee</option>
                    {otherEmployees.map(e => <option key={e.employee_id} value={e.employee_id}>{candidateName(e.candidate_id)}</option>)}
                  </select>
                </label>
              )}
              {ratingConfig && ratingConfig.dimensions.length === 0 && (
                <p className="ep-readonly-text">No rating dimensions are configured yet: configure them on the Rating Config tab first.</p>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setAssignModal(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={submitAssign}
                disabled={assigning || (assignForm.reviewer_type === 'peer' && !assignForm.reviewer_employee_id)}
              >
                {assigning ? 'Assigning…' : 'Assign & Send Invite'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
