import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { hrmsApi } from '../../lib/api'
import Pagination from './Pagination'
import { LEAVE_BADGE, errorText, formatDay, todayIso, type Coverage, type Employee, type LeaveRequest, type LeaveType } from './hrmsTypes'

interface Props {
  canManage: boolean
  notify: (message: string) => void
}

const FILTERS: { value: string; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: '', label: 'All' },
]

function RequestForm({ people, types, onClose, onSaved }: {
  people: Employee[]
  types: LeaveType[]
  onClose: () => void
  onSaved: (r: LeaveRequest) => void
}) {
  const active = people.filter(p => p.status !== 'exited')
  const usable = types.filter(t => t.active)
  const [employeeId, setEmployeeId] = useState(active[0]?.employee_id ?? '')
  const [typeId, setTypeId] = useState(usable[0]?.leave_type_id ?? '')
  const [start, setStart] = useState(todayIso())
  const [end, setEnd] = useState(todayIso())
  const [halfDay, setHalfDay] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!employeeId || !typeId) { setError('Choose an employee and a leave type.'); return }
    setSaving(true); setError('')
    try {
      const r = await hrmsApi.requestLeave({
        employee_id: employeeId, leave_type_id: typeId, start_date: start, end_date: end,
        half_day: halfDay && start === end, reason: reason.trim() || undefined,
      })
      onSaved(r.data)
    } catch (err) {
      setError(errorText(err, 'Could not create the leave request.'))
    } finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-box hr-modal" role="dialog" aria-modal="true" aria-labelledby="hr-leave-title">
        <div className="modal-header">
          <h2 id="hr-leave-title">New leave request</h2>
          <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <form className="hr-form" onSubmit={submit} noValidate>
          {error && <p className="hr-error" role="alert">{error}</p>}
          <div className="hr-form-grid">
            <label className="hr-field">Employee
              <select className="form-input" value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
                {active.length === 0 && <option value="">No employees yet</option>}
                {active.map(p => <option key={p.employee_id} value={p.employee_id}>{p.full_name}</option>)}
              </select>
            </label>
            <label className="hr-field">Leave type
              <select className="form-input" value={typeId} onChange={e => setTypeId(e.target.value)}>
                {usable.map(t => <option key={t.leave_type_id} value={t.leave_type_id}>{t.name}</option>)}
              </select>
            </label>
            <label className="hr-field">From<input className="form-input" type="date" value={start} onChange={e => { setStart(e.target.value); if (e.target.value > end) setEnd(e.target.value) }} /></label>
            <label className="hr-field">To<input className="form-input" type="date" value={end} min={start} onChange={e => setEnd(e.target.value)} /></label>
          </div>
          {start === end && (
            <label className="hr-check"><input type="checkbox" checked={halfDay} onChange={e => setHalfDay(e.target.checked)} /> Half day</label>
          )}
          <label className="hr-field">Reason<textarea className="form-input" rows={3} value={reason} onChange={e => setReason(e.target.value)} /></label>
          <p className="hr-muted">Only working days count. Weekends and company holidays are skipped.</p>
          <div className="modal-footer hr-form-foot">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Saving...' : 'Create request'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function CoverageModal({ request, coverage, busy, onApprove, onClose }: {
  request: LeaveRequest
  coverage: Coverage
  busy: boolean
  onApprove: (() => void) | null
  onClose: () => void
}) {
  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-box hr-modal" role="dialog" aria-modal="true" aria-labelledby="hr-cover-title">
        <div className="modal-header">
          <h2 id="hr-cover-title">Team coverage for {request.employee_name}</h2>
          <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="hr-form hr-cover">
          <p className={coverage.warning ? 'hr-cover-warn' : 'hr-cover-ok'} role={coverage.warning ? 'alert' : 'status'}>
            {coverage.warning
              ? `${coverage.team} would be under half strength on ${coverage.low_days} day${coverage.low_days === 1 ? '' : 's'}.`
              : `${coverage.team} keeps enough people in on every day of this leave.`}
          </p>
          <p className="hr-muted">{coverage.team}, {coverage.team_size} people. Others already off or waiting for approval on these days:</p>
          <ul className="hr-cover-list" aria-label="Coverage by day">
            {coverage.days.map(d => (
              <li key={d.date} className={`hr-cover-day${d.low ? ' hr-cover-day-low' : ''}`}>
                <span className="hr-strong">{formatDay(d.date)}</span>
                <span className="hr-muted">{d.off.length === 0 ? 'Nobody else off' : d.off.map(o => `${o.full_name}${o.status === 'pending' ? ' (pending)' : ''}`).join(', ')}</span>
                <span className={d.low ? 'hr-danger-text hr-strong' : 'hr-strong'}>{d.available} in, {Math.round(d.coverage * 100)}%</span>
              </li>
            ))}
          </ul>
          <div className="modal-footer hr-form-foot">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>{onApprove ? 'Not now' : 'Close'}</button>
            {onApprove && (
              <button type="button" className={coverage.warning ? 'hr-btn-danger' : 'btn btn-primary btn-sm'} disabled={busy} onClick={onApprove}>
                {busy ? 'Approving...' : coverage.warning ? 'Approve anyway' : 'Approve'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function LeaveTypes({ types, canManage, onChanged, notify }: {
  types: LeaveType[]
  canManage: boolean
  onChanged: () => void
  notify: (m: string) => void
}) {
  const [name, setName] = useState('')
  const [days, setDays] = useState('5')
  const [error, setError] = useState('')

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Enter a name for the leave type.'); return }
    setError('')
    try {
      await hrmsApi.createLeaveType({ name: name.trim(), annual_allowance: Number(days) || 0 })
      setName(''); setDays('5'); notify('Leave type added.'); onChanged()
    } catch (err) { setError(errorText(err, 'Could not add the leave type.')) }
  }

  async function change(t: LeaveType, patch: { annual_allowance?: number; active?: boolean }) {
    setError('')
    try { await hrmsApi.updateLeaveType(t.leave_type_id, patch); notify('Leave type updated.'); onChanged() }
    catch (err) { setError(errorText(err, 'Could not update the leave type.')) }
  }

  return (
    <section className="card hr-card" aria-labelledby="hr-types">
      <h3 className="hr-card-title" id="hr-types">Leave types and yearly allowance</h3>
      {error && <p className="hr-error" role="alert">{error}</p>}
      <table className="hr-table">
        <thead><tr><th>Type</th><th>Days per year</th><th>Status</th></tr></thead>
        <tbody>
          {types.map(t => (
            <tr key={t.leave_type_id}>
              <td className="hr-strong">{t.name}</td>
              <td>
                {canManage ? (
                  <input
                    className="form-input hr-days"
                    type="number"
                    min={0}
                    max={366}
                    defaultValue={t.annual_allowance}
                    aria-label={`Days per year for ${t.name}`}
                    onBlur={e => { const v = Number(e.target.value); if (v !== t.annual_allowance) change(t, { annual_allowance: v }) }}
                  />
                ) : t.annual_allowance}
              </td>
              <td>
                {canManage ? (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => change(t, { active: !t.active })}>
                    {t.active ? 'Turn off' : 'Turn on'}
                  </button>
                ) : (t.active ? 'In use' : 'Off')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {canManage && (
        <form className="hr-inline-form" onSubmit={add}>
          <input className="form-input" placeholder="New leave type, e.g. Study leave" aria-label="New leave type name" value={name} onChange={e => setName(e.target.value)} />
          <input className="form-input hr-days" type="number" min={0} max={366} aria-label="Days per year" value={days} onChange={e => setDays(e.target.value)} />
          <button type="submit" className="btn btn-primary btn-sm">Add type</button>
        </form>
      )}
    </section>
  )
}

export default function LeaveTab({ canManage, notify }: Props) {
  const [filter, setFilter] = useState('pending')
  const [requests, setRequests] = useState<LeaveRequest[] | null>(null)
  const [types, setTypes] = useState<LeaveType[]>([])
  const [people, setPeople] = useState<Employee[]>([])
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [cover, setCover] = useState<{ request: LeaveRequest; coverage: Coverage; approving: boolean } | null>(null)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(10)
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')
  const [meta, setMeta] = useState<{ total: number; pages: number; counts: Record<string, number> }>({ total: 0, pages: 1, counts: {} })

  useEffect(() => {
    const next = q.trim()
    if (next === term) return
    const id = window.setTimeout(() => { setTerm(next); setPage(1) }, 300)
    return () => window.clearTimeout(id)
  }, [q, term])

  const loadRequests = useCallback(async () => {
    try {
      const r = await hrmsApi.leaveRequests({ ...(filter ? { status: filter } : {}), ...(term ? { q: term } : {}), page, limit: size })
      setRequests(r.data?.requests ?? [])
      setMeta({ total: r.data?.total ?? 0, pages: r.data?.pages ?? 1, counts: r.data?.counts ?? {} })
      if (r.data?.page && r.data.page !== page) setPage(r.data.page)
      setError('')
    } catch (err) { setError(errorText(err, 'Could not load leave requests.')) }
  }, [filter, term, page, size])

  const loadTypes = useCallback(async () => {
    try { setTypes((await hrmsApi.leaveTypes()).data?.leave_types ?? []) } catch { setTypes([]) }
  }, [])

  useEffect(() => { loadRequests() }, [loadRequests])
  useEffect(() => {
    loadTypes()
    hrmsApi.employees().then(r => setPeople(r.data?.employees ?? [])).catch(() => setPeople([]))
  }, [loadTypes])

  async function checkCoverage(r: LeaveRequest, approving: boolean) {
    setBusy(r.request_id); setError('')
    try {
      const coverage = (await hrmsApi.requestCoverage(r.request_id)).data as Coverage
      if (approving && !coverage.warning) {
        setBusy(null)
        await act(r, 'approve')
        return
      }
      setCover({ request: r, coverage, approving })
    } catch (err) {
      setError(errorText(err, 'Could not check team coverage.'))
    } finally { setBusy(null) }
  }

  async function act(r: LeaveRequest, action: 'approve' | 'reject' | 'cancel') {
    setBusy(r.request_id); setError('')
    try {
      if (action === 'approve') await hrmsApi.approveLeave(r.request_id)
      else if (action === 'reject') await hrmsApi.rejectLeave(r.request_id)
      else await hrmsApi.cancelLeave(r.request_id)
      notify(action === 'approve' ? `Leave approved for ${r.employee_name}.` : action === 'reject' ? `Leave rejected for ${r.employee_name}.` : 'Leave cancelled.')
      await loadRequests()
    } catch (err) {
      setError(errorText(err, 'Could not update the request.'))
    } finally { setBusy(null) }
  }

  return (
    <div className="hr-stack">
      <div className="hr-toolbar">
        <div className="hr-seg" role="group" aria-label="Request status">
          {FILTERS.map(f => (
            <button key={f.label} type="button" className={`hr-seg-btn${filter === f.value ? ' hr-seg-on' : ''}`} aria-pressed={filter === f.value} onClick={() => { setFilter(f.value); setPage(1) }}>
              {f.label}{meta.counts[f.value || 'all'] !== undefined && <span className="hr-seg-count"> {meta.counts[f.value || 'all']}</span>}
            </button>
          ))}
        </div>
        <input className="form-input hr-search" type="search" placeholder="Search employee or leave type" aria-label="Search leave requests" value={q} onChange={e => setQ(e.target.value)} />
        {canManage && <button type="button" className="btn btn-primary btn-sm hr-push" onClick={() => setCreating(true)}>New leave request</button>}
      </div>

      {error && <p className="hr-error" role="alert">{error}</p>}
      {!requests && !error && <p className="hr-muted" role="status">Loading leave requests...</p>}
      {requests && requests.length === 0 && <p className="hr-empty">{term ? 'No leave requests match this search.' : `No ${filter || ''} leave requests.`}</p>}
      {requests && requests.length > 0 && (
        <div className="card hr-table-wrap">
          <table className="hr-table">
            <thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th>Days</th><th>Reason</th><th>Status</th>{canManage && <th className="hr-actions-col">Actions</th>}</tr></thead>
            <tbody>
              {requests.map(r => (
                <tr key={r.request_id}>
                  <td><div className="hr-strong">{r.employee_name}</div>{r.department_name && <div className="hr-muted">{r.department_name}</div>}</td>
                  <td>{r.leave_type_name}</td>
                  <td className="hr-nowrap">{r.start_date === r.end_date ? formatDay(r.start_date) : `${formatDay(r.start_date)} to ${formatDay(r.end_date)}`}</td>
                  <td>{r.days}</td>
                  <td className="hr-reason">{r.reason || '-'}</td>
                  <td><span className={`badge ${LEAVE_BADGE[r.status]}`}>{r.status.charAt(0).toUpperCase() + r.status.slice(1)}</span></td>
                  {canManage && (
                    <td className="hr-actions-col">
                      {r.status === 'pending' && (
                        <>
                          <button type="button" className="btn btn-primary btn-sm" disabled={busy === r.request_id} onClick={() => checkCoverage(r, true)} aria-label={`Approve leave for ${r.employee_name}`}>Approve</button>
                          <button type="button" className="btn btn-ghost btn-sm" disabled={busy === r.request_id} onClick={() => checkCoverage(r, false)} aria-label={`Check coverage for ${r.employee_name}`}>Coverage</button>
                          <button type="button" className="btn btn-ghost btn-sm hr-danger-text" disabled={busy === r.request_id} onClick={() => act(r, 'reject')} aria-label={`Reject leave for ${r.employee_name}`}>Reject</button>
                        </>
                      )}
                      {(r.status === 'pending' || r.status === 'approved') && (
                        <button type="button" className="btn btn-ghost btn-sm" disabled={busy === r.request_id} onClick={() => act(r, 'cancel')} aria-label={`Cancel leave for ${r.employee_name}`}>Cancel</button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination label="requests" page={page} pages={meta.pages} total={meta.total} size={size} onPage={setPage} onSize={n => { setSize(n); setPage(1) }} />
        </div>
      )}

      <LeaveTypes types={types} canManage={canManage} onChanged={loadTypes} notify={notify} />

      {cover && (
        <CoverageModal
          request={cover.request}
          coverage={cover.coverage}
          busy={busy === cover.request.request_id}
          onApprove={() => { const r = cover.request; act(r, 'approve').then(() => setCover(null)) }}
          onClose={() => setCover(null)}
        />
      )}

      {creating && (
        <RequestForm
          people={people}
          types={types}
          onClose={() => setCreating(false)}
          onSaved={r => { setCreating(false); notify(`Leave request created for ${r.employee_name} (${r.days} day${r.days === 1 ? '' : 's'}).`); loadRequests() }}
        />
      )}
    </div>
  )
}
