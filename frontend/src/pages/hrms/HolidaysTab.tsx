import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { hrmsApi } from '../../lib/api'
import { errorText, formatDay, todayIso, type Holiday } from './hrmsTypes'

interface Props {
  canManage: boolean
  notify: (message: string) => void
}

const WEEKDAY = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long' })

export default function HolidaysTab({ canManage, notify }: Props) {
  const [year, setYear] = useState(new Date().getFullYear())
  const [holidays, setHolidays] = useState<Holiday[] | null>(null)
  const [error, setError] = useState('')
  const [day, setDay] = useState('')
  const [name, setName] = useState('')
  const [optional, setOptional] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try { setHolidays((await hrmsApi.holidays(year)).data?.holidays ?? []); setError('') }
    catch (err) { setError(errorText(err, 'Could not load holidays.')) }
  }, [year])

  useEffect(() => { setHolidays(null); load() }, [load])

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!day || !name.trim()) { setError('Enter a date and a name.'); return }
    setSaving(true); setError('')
    try {
      await hrmsApi.addHoliday({ date: day, name: name.trim(), optional })
      notify(`${name.trim()} was added.`)
      setDay(''); setName(''); setOptional(false)
      if (Number(day.slice(0, 4)) !== year) setYear(Number(day.slice(0, 4)))
      else load()
    } catch (err) { setError(errorText(err, 'Could not add the holiday.')) }
    finally { setSaving(false) }
  }

  async function remove(h: Holiday) {
    setError('')
    try { await hrmsApi.deleteHoliday(h.holiday_id); notify(`${h.name} was removed.`); load() }
    catch (err) { setError(errorText(err, 'Could not remove the holiday.')) }
  }

  return (
    <div className="hr-stack">
      <div className="hr-toolbar">
        <div className="hr-seg" role="group" aria-label="Year">
          <button type="button" className="hr-seg-btn" aria-label="Previous year" onClick={() => setYear(y => y - 1)}>‹</button>
          <span className="hr-seg-label">{year}</span>
          <button type="button" className="hr-seg-btn" aria-label="Next year" onClick={() => setYear(y => y + 1)}>›</button>
        </div>
      </div>

      {canManage && (
        <form className="card hr-card hr-inline-form" onSubmit={add} aria-label="Add a holiday">
          <input className="form-input" type="date" aria-label="Holiday date" value={day} onChange={e => setDay(e.target.value)} />
          <input className="form-input" placeholder="Holiday name, e.g. Independence Day" aria-label="Holiday name" value={name} onChange={e => setName(e.target.value)} />
          <label className="hr-check"><input type="checkbox" checked={optional} onChange={e => setOptional(e.target.checked)} /> Optional</label>
          <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Adding...' : 'Add holiday'}</button>
        </form>
      )}

      {error && <p className="hr-error" role="alert">{error}</p>}
      {!holidays && !error && <p className="hr-muted" role="status">Loading holidays...</p>}
      {holidays && holidays.length === 0 && <p className="hr-empty">No holidays in {year}.</p>}
      {holidays && holidays.length > 0 && (
        <p className="hr-muted">{holidays.length} holiday{holidays.length === 1 ? '' : 's'} in {year}, {holidays.filter(h => h.date >= todayIso()).length} still to come.</p>
      )}
      {holidays && holidays.length > 0 && (
        <div className="card hr-table-wrap">
          <table className="hr-table">
            <thead><tr><th>Date</th><th>Day</th><th>Holiday</th><th>Type</th>{canManage && <th className="hr-actions-col">Actions</th>}</tr></thead>
            <tbody>
              {holidays.map(h => (
                <tr key={h.holiday_id} className={h.date < todayIso() ? 'hr-row-past' : undefined}>
                  <td className="hr-nowrap">{formatDay(h.date)}{h.date < todayIso() && <span className="hr-muted"> (past)</span>}</td>
                  <td>{WEEKDAY(h.date)}</td>
                  <td className="hr-strong">{h.name}</td>
                  <td>{h.optional ? 'Optional' : 'Company holiday'}</td>
                  {canManage && (
                    <td className="hr-actions-col">
                      <button type="button" className="btn btn-ghost btn-sm hr-danger-text" aria-label={`Remove ${h.name}`} onClick={() => remove(h)}>Remove</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
