import { useCallback, useEffect, useMemo, useState } from 'react'
import Pagination, { downloadCsv, usePaged } from './Pagination'
import { hrmsApi } from '../../lib/api'
import {
  ATTENDANCE_LABELS, errorText, formatDay, todayIso,
  type AttendanceRow, type AttendanceSheet, type AttendanceStatus, type SummaryRow,
} from './hrmsTypes'

interface Props {
  canManage: boolean
  notify: (message: string) => void
}

const STATUSES = Object.keys(ATTENDANCE_LABELS) as AttendanceStatus[]
const NO_TIMES: AttendanceStatus[] = ['absent', 'on_leave']

function Row({ row, day, canManage, onSaved, onError }: {
  row: AttendanceRow
  day: string
  canManage: boolean
  onSaved: () => void
  onError: (m: string) => void
}) {
  const [status, setStatus] = useState<AttendanceStatus | ''>(row.record?.status ?? '')
  const [checkIn, setCheckIn] = useState(row.record?.check_in ?? '')
  const [checkOut, setCheckOut] = useState(row.record?.check_out ?? '')
  const [saving, setSaving] = useState(false)
  const timed = status !== '' && !NO_TIMES.includes(status)
  const dirty = status !== (row.record?.status ?? '') || checkIn !== (row.record?.check_in ?? '') || checkOut !== (row.record?.check_out ?? '')

  async function save() {
    if (!status) return
    setSaving(true)
    try {
      await hrmsApi.markAttendance({
        employee_id: row.employee_id, date: day, status,
        check_in: timed ? checkIn || null : null, check_out: timed ? checkOut || null : null,
      })
      onSaved()
    } catch (err) {
      onError(errorText(err, `Could not save attendance for ${row.full_name}.`))
    } finally { setSaving(false) }
  }

  return (
    <tr>
      <td><div className="hr-strong">{row.full_name}</div><div className="hr-muted">{[row.designation, row.department_name].filter(Boolean).join(', ') || '-'}</div></td>
      <td>
        {canManage ? (
          <select className="form-input hr-select" aria-label={`Status for ${row.full_name}`} value={status} onChange={e => setStatus(e.target.value as AttendanceStatus)}>
            <option value="">Not marked</option>
            {STATUSES.map(s => <option key={s} value={s}>{ATTENDANCE_LABELS[s]}</option>)}
          </select>
        ) : status ? ATTENDANCE_LABELS[status] : 'Not marked'}
        {row.record?.source === 'leave' && <div className="hr-muted">From approved leave</div>}
      </td>
      <td>
        {canManage ? <input className="form-input hr-time" type="time" aria-label={`Check in for ${row.full_name}`} disabled={!timed} value={timed ? checkIn : ''} onChange={e => setCheckIn(e.target.value)} /> : (row.record?.check_in || '-')}
      </td>
      <td>
        {canManage ? <input className="form-input hr-time" type="time" aria-label={`Check out for ${row.full_name}`} disabled={!timed} value={timed ? checkOut : ''} onChange={e => setCheckOut(e.target.value)} /> : (row.record?.check_out || '-')}
      </td>
      {canManage && (
        <td className="hr-actions-col">
          <button type="button" className="btn btn-primary btn-sm" disabled={!status || !dirty || saving} onClick={save} aria-label={`Save attendance for ${row.full_name}`}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </td>
      )}
    </tr>
  )
}

function DailySheet({ canManage, notify }: Props) {
  const [day, setDay] = useState(todayIso())
  const [sheet, setSheet] = useState<AttendanceSheet | null>(null)
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)
  const [q, setQ] = useState('')
  const [only, setOnly] = useState<AttendanceStatus | 'unmarked' | ''>('')
  const rows = useMemo(() => (sheet?.rows ?? []).filter(r =>
    (!q.trim() || `${r.full_name} ${r.department_name} ${r.designation}`.toLowerCase().includes(q.trim().toLowerCase())) &&
    (!only || (only === 'unmarked' ? !r.record : r.record?.status === only)),
  ), [sheet, q, only])
  const paged = usePaged(rows, 25, `${day}|${q}|${only}`)

  const load = useCallback(async () => {
    try { setSheet((await hrmsApi.attendance(day)).data); setError('') }
    catch (err) { setError(errorText(err, 'Could not load attendance.')) }
  }, [day])

  useEffect(() => { setSheet(null); load() }, [load])

  return (
    <div className="hr-stack">
      <div className="hr-toolbar">
        <label className="hr-field hr-inline">Date<input className="form-input" type="date" max={todayIso()} value={day} onChange={e => e.target.value && setDay(e.target.value)} /></label>
        {sheet && (
          <div className="hr-counts" aria-label="Attendance totals">
            {STATUSES.map(s => (
              <button key={s} type="button" className={`hr-count${only === s ? ' hr-count-on' : ''}`} aria-pressed={only === s} onClick={() => setOnly(o => (o === s ? '' : s))}>
                <strong>{sheet.counts[s]}</strong> {ATTENDANCE_LABELS[s]}
              </button>
            ))}
            <button type="button" className={`hr-count${only === 'unmarked' ? ' hr-count-on' : ''}`} aria-pressed={only === 'unmarked'} onClick={() => setOnly(o => (o === 'unmarked' ? '' : 'unmarked'))}>
              <strong>{sheet.counts.unmarked}</strong> Not marked
            </button>
          </div>
        )}
      </div>
      {sheet && sheet.rows.length > 0 && (
        <input className="form-input hr-search" type="search" placeholder="Search employee or department" aria-label="Search the attendance sheet" value={q} onChange={e => setQ(e.target.value)} />
      )}
      {sheet?.holiday && <p className="hr-note">{formatDay(sheet.date)} is a holiday: {sheet.holiday}.</p>}
      {sheet?.weekend && !sheet.holiday && <p className="hr-note">{formatDay(sheet.date)} is a weekend.</p>}
      {error && <p className="hr-error" role="alert">{error}</p>}
      {!sheet && !error && <p className="hr-muted" role="status">Loading attendance...</p>}
      {sheet && sheet.rows.length === 0 && <p className="hr-empty">No employees were on the roll on this date.</p>}
      {sheet && sheet.rows.length > 0 && (
        <div className="card hr-table-wrap">
          <table className="hr-table">
            <thead><tr><th>Employee</th><th>Status</th><th>Check in</th><th>Check out</th>{canManage && <th className="hr-actions-col">Save</th>}</tr></thead>
            <tbody>
              {paged.slice.map(r => (
                <Row
                  key={`${r.employee_id}-${sheet.date}-${version}`}
                  row={r}
                  day={sheet.date}
                  canManage={canManage}
                  onSaved={() => { notify(`Attendance saved for ${r.full_name}.`); load().then(() => setVersion(v => v + 1)) }}
                  onError={setError}
                />
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="hr-muted hr-pad">Nobody matches these filters.</p>}
          <Pagination label="people" page={paged.page} pages={paged.pages} total={paged.total} size={paged.size} onPage={paged.setPage} onSize={paged.setSize} />
        </div>
      )}
    </div>
  )
}

function MonthlySummary() {
  const now = new Date()
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
  const [rows, setRows] = useState<SummaryRow[] | null>(null)
  const [workdays, setWorkdays] = useState(0)
  const [error, setError] = useState('')
  const paged = usePaged(rows ?? [], 25, month)

  function exportCsv() {
    downloadCsv(`attendance-${month}.csv`,
      ['Employee', 'Department', 'Present', 'Remote', 'Half day', 'Absent', 'On leave', 'Not marked', 'Hours', 'Attendance rate'],
      (rows ?? []).map(r => [r.full_name, r.department_name, r.present, r.remote, r.half_day, r.absent, r.on_leave, r.unmarked, r.hours, r.attendance_rate === null ? '' : `${r.attendance_rate}%`]))
  }

  useEffect(() => {
    const [y, m] = month.split('-').map(Number)
    if (!y || !m) return
    let live = true
    setRows(null)
    hrmsApi.attendanceSummary(y, m)
      .then(r => { if (live) { setRows(r.data?.rows ?? []); setWorkdays(r.data?.working_days ?? 0); setError('') } })
      .catch(err => { if (live) setError(errorText(err, 'Could not load the summary.')) })
    return () => { live = false }
  }, [month])

  return (
    <div className="hr-stack">
      <div className="hr-toolbar">
        <label className="hr-field hr-inline">Month<input className="form-input" type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} /></label>
        <span className="hr-muted">{workdays} working day{workdays === 1 ? '' : 's'} so far</span>
        <button type="button" className="btn btn-ghost btn-sm hr-push" onClick={exportCsv} disabled={!rows || rows.length === 0}>Export CSV</button>
      </div>
      {error && <p className="hr-error" role="alert">{error}</p>}
      {!rows && !error && <p className="hr-muted" role="status">Loading summary...</p>}
      {rows && rows.length === 0 && <p className="hr-empty">No attendance for this month yet.</p>}
      {rows && rows.length > 0 && (
        <div className="card hr-table-wrap">
          <table className="hr-table">
            <thead><tr><th>Employee</th><th>Present</th><th>Remote</th><th>Half day</th><th>Absent</th><th>On leave</th><th>Not marked</th><th>Hours</th><th>Attendance</th></tr></thead>
            <tbody>
              {paged.slice.map(r => (
                <tr key={r.employee_id}>
                  <td><div className="hr-strong">{r.full_name}</div>{r.department_name && <div className="hr-muted">{r.department_name}</div>}</td>
                  <td>{r.present}</td><td>{r.remote}</td><td>{r.half_day}</td><td>{r.absent}</td><td>{r.on_leave}</td><td>{r.unmarked}</td>
                  <td>{r.hours}</td>
                  <td>
                    {r.attendance_rate === null ? '-' : (
                      <span className="hr-rate">
                        <span className="hr-rate-track"><span className="hr-rate-fill" style={{ width: `${r.attendance_rate}%` }} /></span>
                        <span className="hr-strong">{r.attendance_rate}%</span>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination label="employees" page={paged.page} pages={paged.pages} total={paged.total} size={paged.size} onPage={paged.setPage} onSize={paged.setSize} />
        </div>
      )}
    </div>
  )
}

export default function AttendanceTab({ canManage, notify }: Props) {
  const [view, setView] = useState<'daily' | 'monthly'>('daily')
  return (
    <div className="hr-stack">
      <div className="hr-seg" role="group" aria-label="Attendance view">
        <button type="button" className={`hr-seg-btn${view === 'daily' ? ' hr-seg-on' : ''}`} aria-pressed={view === 'daily'} onClick={() => setView('daily')}>Daily sheet</button>
        <button type="button" className={`hr-seg-btn${view === 'monthly' ? ' hr-seg-on' : ''}`} aria-pressed={view === 'monthly'} onClick={() => setView('monthly')}>Monthly summary</button>
      </div>
      {view === 'daily' ? <DailySheet canManage={canManage} notify={notify} /> : <MonthlySummary />}
    </div>
  )
}
