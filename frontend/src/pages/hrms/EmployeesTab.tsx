import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { adminConfigApi, hrmsApi } from '../../lib/api'
import {
  EMPLOYMENT_LABELS, STATUS_BADGE, STATUS_LABELS, errorText, formatDay, todayIso,
  type Employee, type LeaveBalance,
} from './hrmsTypes'
import Pagination, { downloadCsv, usePaged } from './Pagination'

interface Props {
  canManage: boolean
  notify: (message: string) => void
}

interface Department { department_id: string; name: string }

type SortKey = 'full_name' | 'designation' | 'department_name' | 'manager_name' | 'joined_on' | 'status'

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'full_name', label: 'Employee' },
  { key: 'designation', label: 'Designation' },
  { key: 'department_name', label: 'Department' },
  { key: 'manager_name', label: 'Manager' },
  { key: 'joined_on', label: 'Joined' },
  { key: 'status', label: 'Status' },
]

type Draft = Record<'full_name' | 'email' | 'phone' | 'designation' | 'department' | 'manager_id' | 'employment_type' | 'location' | 'joined_on' | 'employee_code', string>

const EMPTY: Draft = {
  full_name: '', email: '', phone: '', designation: '', department: '', manager_id: '',
  employment_type: 'full_time', location: '', joined_on: todayIso(), employee_code: '',
}

function draftOf(e: Employee): Draft {
  return {
    full_name: e.full_name || '', email: e.email || '', phone: e.phone || '', designation: e.designation || '',
    department: e.department || '', manager_id: e.manager_id || '', employment_type: e.employment_type || 'full_time',
    location: e.location || '', joined_on: (e.joined_on || '').slice(0, 10), employee_code: e.employee_code || '',
  }
}

function EmployeeForm({ employee, people, departments, onClose, onSaved }: {
  employee: Employee | null
  people: Employee[]
  departments: Department[]
  onClose: () => void
  onSaved: (e: Employee, created: boolean) => void
}) {
  const [draft, setDraft] = useState<Draft>(employee ? draftOf(employee) : EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof Draft, v: string) => setDraft(d => ({ ...d, [k]: v }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!draft.full_name.trim()) { setError('Enter the employee name.'); return }
    setSaving(true); setError('')
    const payload = Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, v.trim() === '' ? null : v.trim()]))
    try {
      const r = employee
        ? await hrmsApi.updateEmployee(employee.employee_id, payload)
        : await hrmsApi.createEmployee(payload)
      onSaved(r.data, !employee)
    } catch (err) {
      setError(errorText(err, 'Could not save the employee.'))
    } finally { setSaving(false) }
  }

  const managers = people.filter(p => p.status !== 'exited' && p.employee_id !== employee?.employee_id)

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-box hr-modal" role="dialog" aria-modal="true" aria-labelledby="hr-emp-title">
        <div className="modal-header">
          <h2 id="hr-emp-title">{employee ? 'Edit employee' : 'Add employee'}</h2>
          <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <form className="hr-form" onSubmit={submit} noValidate>
          {error && <p className="hr-error" role="alert">{error}</p>}
          <div className="hr-form-grid">
            <label className="hr-field">Full name *<input className="form-input" value={draft.full_name} onChange={e => set('full_name', e.target.value)} required /></label>
            <label className="hr-field">Work email<input className="form-input" type="email" value={draft.email} onChange={e => set('email', e.target.value)} /></label>
            <label className="hr-field">Phone<input className="form-input" value={draft.phone} onChange={e => set('phone', e.target.value)} /></label>
            <label className="hr-field">Designation<input className="form-input" value={draft.designation} onChange={e => set('designation', e.target.value)} /></label>
            <label className="hr-field">Department
              <select className="form-input" value={draft.department} onChange={e => set('department', e.target.value)}>
                <option value="">No department</option>
                {departments.map(d => <option key={d.department_id} value={d.department_id}>{d.name}</option>)}
              </select>
            </label>
            <label className="hr-field">Manager
              <select className="form-input" value={draft.manager_id} onChange={e => set('manager_id', e.target.value)}>
                <option value="">No manager</option>
                {managers.map(m => <option key={m.employee_id} value={m.employee_id}>{m.full_name}</option>)}
              </select>
            </label>
            <label className="hr-field">Employment type
              <select className="form-input" value={draft.employment_type} onChange={e => set('employment_type', e.target.value)}>
                {Object.entries(EMPLOYMENT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="hr-field">Location<input className="form-input" value={draft.location} onChange={e => set('location', e.target.value)} /></label>
            <label className="hr-field">Join date<input className="form-input" type="date" value={draft.joined_on} onChange={e => set('joined_on', e.target.value)} /></label>
            <label className="hr-field">Employee code<input className="form-input" value={draft.employee_code} onChange={e => set('employee_code', e.target.value)} /></label>
          </div>
          <div className="modal-footer hr-form-foot">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Saving...' : employee ? 'Save changes' : 'Add employee'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function OffboardForm({ employee, onClose, onDone }: { employee: Employee; onClose: () => void; onDone: (e: Employee) => void }) {
  const [day, setDay] = useState(todayIso())
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      const r = await hrmsApi.offboard(employee.employee_id, { exited_on: day, reason: reason.trim() || undefined })
      onDone(r.data)
    } catch (err) {
      setError(errorText(err, 'Could not offboard the employee.'))
    } finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-box" role="dialog" aria-modal="true" aria-labelledby="hr-off-title">
        <div className="modal-header">
          <h2 id="hr-off-title">Offboard {employee.full_name}?</h2>
          <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <form className="hr-form" onSubmit={submit}>
          {error && <p className="hr-error" role="alert">{error}</p>}
          <p className="hr-muted">They are marked as exited, their pending leave is cancelled and anyone reporting to them is left without a manager.</p>
          <label className="hr-field">Last working day<input className="form-input" type="date" value={day} onChange={e => setDay(e.target.value)} required /></label>
          <label className="hr-field">Reason<textarea className="form-input" rows={3} value={reason} onChange={e => setReason(e.target.value)} /></label>
          <div className="modal-footer hr-form-foot">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
            <button type="submit" className="hr-btn-danger" disabled={saving || !day}>{saving ? 'Saving...' : 'Offboard'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ProfileDrawer({ employeeId, onClose }: { employeeId: string; onClose: () => void }) {
  const [data, setData] = useState<(Employee & { leave_balances: LeaveBalance[] }) | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    hrmsApi.employee(employeeId)
      .then(r => { if (live) setData(r.data) })
      .catch(err => { if (live) setError(errorText(err, 'Could not load the profile.')) })
    return () => { live = false }
  }, [employeeId])

  const facts = data ? [
    ['Email', data.email], ['Phone', data.phone], ['Designation', data.designation], ['Department', data.department_name],
    ['Manager', data.manager_name], ['Employment type', EMPLOYMENT_LABELS[data.employment_type || ''] || data.employment_type],
    ['Location', data.location], ['Joined', formatDay(data.joined_on)], ['Employee code', data.employee_code],
    ['Source', data.source === 'offer' ? 'Hired through an accepted offer' : 'Added by HR'],
    ...(data.status === 'exited' ? [['Exited', formatDay(data.exited_on)], ['Exit reason', data.exit_reason]] : []),
  ].filter(([, v]) => v) as [string, string][] : []

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-box hr-modal" role="dialog" aria-modal="true" aria-labelledby="hr-prof-title">
        <div className="modal-header">
          <h2 id="hr-prof-title">{data ? data.full_name : 'Employee profile'}</h2>
          <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="hr-form">
          {error && <p className="hr-error" role="alert">{error}</p>}
          {!data && !error && <p className="hr-muted" role="status">Loading profile...</p>}
          {data && (
            <>
              <span className={`badge ${STATUS_BADGE[data.status]}`}>{STATUS_LABELS[data.status]}</span>
              <dl className="hr-facts">
                {facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
              </dl>
              <h3 className="hr-card-title">Leave balance {new Date().getFullYear()}</h3>
              <table className="hr-table">
                <thead><tr><th>Type</th><th>Allowance</th><th>Used</th><th>Pending</th><th>Left</th></tr></thead>
                <tbody>
                  {data.leave_balances.map(b => (
                    <tr key={b.leave_type_id}><td>{b.name}</td><td>{b.allowance}</td><td>{b.used}</td><td>{b.pending}</td><td className="hr-strong">{b.remaining}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function EmployeesTab({ canManage, notify }: Props) {
  const [people, setPeople] = useState<Employee[] | null>(null)
  const [departments, setDepartments] = useState<Department[]>([])
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [department, setDepartment] = useState('')
  const [status, setStatus] = useState('')
  const [editing, setEditing] = useState<Employee | 'new' | null>(null)
  const [leaving, setLeaving] = useState<Employee | null>(null)
  const [viewing, setViewing] = useState<string | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'full_name', dir: 1 })

  const load = useCallback(async () => {
    try {
      const r = await hrmsApi.employees()
      setPeople(r.data?.employees ?? [])
      setError('')
    } catch (err) {
      setError(errorText(err, 'Could not load employees.'))
    }
  }, [])

  useEffect(() => {
    load()
    adminConfigApi.listDepartments()
      .then(r => setDepartments((r.data?.departments ?? r.data ?? []) as Department[]))
      .catch(() => setDepartments([]))
  }, [load])

  const term = q.trim().toLowerCase()
  const shown = useMemo(() => {
    const rows = (people ?? []).filter(p =>
      (!department || p.department === department) &&
      (!status || p.status === status) &&
      (!term || [p.full_name, p.email, p.designation, p.employee_code, p.department_name].join(' ').toLowerCase().includes(term)),
    )
    return [...rows].sort((a, b) => String(a[sort.key] ?? '').localeCompare(String(b[sort.key] ?? ''), undefined, { numeric: true }) * sort.dir)
  }, [people, department, status, term, sort])
  const paged = usePaged(shown, 10, `${department}|${status}|${term}|${sort.key}|${sort.dir}`)
  const counts = useMemo(() => {
    const all = people ?? []
    return { active: all.filter(p => p.status === 'active').length, on_leave: all.filter(p => p.status === 'on_leave').length, exited: all.filter(p => p.status === 'exited').length }
  }, [people])

  function toggleSort(key: SortKey) {
    setSort(s => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }))
  }

  function exportCsv() {
    downloadCsv('employees.csv',
      ['Name', 'Email', 'Phone', 'Designation', 'Department', 'Manager', 'Employment type', 'Location', 'Joined', 'Employee code', 'Status'],
      shown.map(p => [p.full_name, p.email, p.phone, p.designation, p.department_name, p.manager_name, EMPLOYMENT_LABELS[p.employment_type || ''] || p.employment_type, p.location, p.joined_on, p.employee_code, STATUS_LABELS[p.status]]))
  }

  return (
    <div className="hr-stack">
      <div className="hr-toolbar">
        <input className="form-input hr-search" type="search" placeholder="Search name, email, designation" aria-label="Search employees" value={q} onChange={e => setQ(e.target.value)} />
        <select className="form-input hr-select" aria-label="Department" value={department} onChange={e => setDepartment(e.target.value)}>
          <option value="">All departments</option>
          {departments.map(d => <option key={d.department_id} value={d.department_id}>{d.name}</option>)}
        </select>
        <select className="form-input hr-select" aria-label="Status" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l} ({counts[v as keyof typeof counts]})</option>)}
        </select>
        <div className="hr-push hr-actions-row">
          <button type="button" className="btn btn-ghost btn-sm" onClick={exportCsv} disabled={shown.length === 0}>Export CSV</button>
          {canManage && <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>Add employee</button>}
        </div>
      </div>

      {error && <p className="hr-error" role="alert">{error}</p>}
      {!people && !error && <p className="hr-muted" role="status">Loading employees...</p>}
      {people && shown.length === 0 && (
        <p className="hr-empty">{people.length === 0 ? 'No employees yet. People hired through accepted offers appear here, or add them yourself.' : 'No employees match these filters.'}</p>
      )}
      {shown.length > 0 && (
        <div className="card hr-table-wrap">
          <table className="hr-table">
            <thead>
              <tr>
                {COLUMNS.map(c => (
                  <th key={c.key} aria-sort={sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" className="hr-sort" onClick={() => toggleSort(c.key)}>
                      {c.label}<span className="hr-sort-mark" aria-hidden="true">{sort.key === c.key ? (sort.dir === 1 ? '▲' : '▼') : ''}</span>
                    </button>
                  </th>
                ))}
                <th className="hr-actions-col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paged.slice.map(p => (
                <tr key={p.employee_id}>
                  <td>
                    <div className="hr-strong">{p.full_name}</div>
                    {p.email && <div className="hr-muted">{p.email}</div>}
                  </td>
                  <td>{p.designation || '-'}</td>
                  <td>{p.department_name || '-'}</td>
                  <td>{p.manager_name || '-'}</td>
                  <td className="hr-nowrap">{formatDay(p.joined_on)}</td>
                  <td><span className={`badge ${STATUS_BADGE[p.status]}`}>{STATUS_LABELS[p.status]}</span></td>
                  <td className="hr-actions-col">
                    <button type="button" className="btn btn-ghost btn-sm" aria-label={`View ${p.full_name}`} onClick={() => setViewing(p.employee_id)}>View</button>
                    {canManage && p.status !== 'exited' && (
                      <>
                        <button type="button" className="btn btn-ghost btn-sm" aria-label={`Edit ${p.full_name}`} onClick={() => setEditing(p)}>Edit</button>
                        <button type="button" className="btn btn-ghost btn-sm hr-danger-text" aria-label={`Offboard ${p.full_name}`} onClick={() => setLeaving(p)}>Offboard</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination label="employees" page={paged.page} pages={paged.pages} total={paged.total} size={paged.size} onPage={paged.setPage} onSize={paged.setSize} />
        </div>
      )}

      {editing && (
        <EmployeeForm
          employee={editing === 'new' ? null : editing}
          people={people ?? []}
          departments={departments}
          onClose={() => setEditing(null)}
          onSaved={(e, created) => { setEditing(null); notify(created ? `${e.full_name} was added.` : 'Changes saved.'); load() }}
        />
      )}
      {leaving && (
        <OffboardForm
          employee={leaving}
          onClose={() => setLeaving(null)}
          onDone={e => { setLeaving(null); notify(`${e.full_name} was offboarded.`); load() }}
        />
      )}
      {viewing && <ProfileDrawer employeeId={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}
