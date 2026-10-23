import { useEffect, useState } from 'react'
import { hrmsApi } from '../../lib/api'
import { ChartCard, GroupedBarChart, HBarChart, LineChart, SERIES } from './charts'
import { EMPLOYMENT_LABELS, errorText, formatDay, monthLabel, shortDay, type Analytics, type Overview } from './hrmsTypes'

interface Props {
  onOpen: (tab: 'employees' | 'leave' | 'attendance' | 'holidays') => void
}

const RANGES = [6, 12, 24]

export default function OverviewTab({ onOpen }: Props) {
  const [data, setData] = useState<Overview | null>(null)
  const [stats, setStats] = useState<Analytics | null>(null)
  const [months, setMonths] = useState(12)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    hrmsApi.overview()
      .then(r => { if (live) setData(r.data) })
      .catch(err => { if (live) setError(errorText(err, 'Could not load the overview.')) })
    return () => { live = false }
  }, [])

  useEffect(() => {
    let live = true
    hrmsApi.analytics(months)
      .then(r => { if (live) setStats(r.data) })
      .catch(() => { if (live) setStats(null) })
    return () => { live = false }
  }, [months])

  if (error) return <p className="hr-error" role="alert">{error}</p>
  if (!data) return <p className="hr-muted" role="status">Loading overview...</p>

  const present = data.attendance_today.present + data.attendance_today.remote + data.attendance_today.half_day
  const tiles = [
    { label: 'Headcount', value: data.headcount.toLocaleString(), hint: `${data.active} active, ${data.exited} exited`, tab: 'employees' as const },
    { label: 'On leave today', value: data.on_leave_today.length.toLocaleString(), hint: 'Approved leave', tab: 'leave' as const },
    { label: 'Present today', value: present.toLocaleString(), hint: `${data.attendance_today.unmarked} not marked`, tab: 'attendance' as const },
    { label: 'Pending leave', value: data.pending_leave.toLocaleString(), hint: 'Waiting for a decision', tab: 'leave' as const },
    { label: 'Attendance, 30 days', value: stats?.average_attendance == null ? '-' : `${stats.average_attendance}%`, hint: 'Average across working days', tab: 'attendance' as const },
    { label: 'Attrition, 12 months', value: stats?.attrition_rate == null ? '-' : `${stats.attrition_rate}%`, hint: stats ? `${stats.joiners_12m} joined, ${stats.exits_12m} left` : 'Joiners and leavers', tab: 'employees' as const },
  ]

  const trend = stats?.headcount_trend ?? []
  const attendance = stats?.attendance_trend ?? []
  const hasAttendance = attendance.some(r => r.rate !== null)
  const leave = stats?.leave_by_type ?? []

  return (
    <div className="hr-stack">
      <div className="hr-tiles">
        {tiles.map(t => (
          <button key={t.label} type="button" className="hr-tile" onClick={() => onOpen(t.tab)}>
            <span className="hr-tile-label">{t.label}</span>
            <span className="hr-tile-value">{t.value}</span>
            <span className="hr-tile-hint">{t.hint}</span>
          </button>
        ))}
      </div>

      <div className="hr-range" role="group" aria-label="Chart range">
        <span className="hr-muted">Range</span>
        <div className="hr-seg">
          {RANGES.map(r => (
            <button key={r} type="button" className={`hr-seg-btn${months === r ? ' hr-seg-on' : ''}`} aria-pressed={months === r} onClick={() => setMonths(r)}>
              {r} months
            </button>
          ))}
        </div>
      </div>

      <div className="hr-grid hr-grid-charts">
        <ChartCard
          title="Headcount"
          subtitle="People on the roll at the end of each month"
          empty={!stats ? 'Loading chart...' : trend.every(r => r.headcount === 0) ? 'No employees yet.' : undefined}
          table={{ columns: ['Month', 'Headcount'], rows: trend.map(r => [monthLabel(r.month), r.headcount]) }}
        >
          <LineChart seriesLabel="Headcount" points={trend.map(r => ({ label: monthLabel(r.month), value: r.headcount }))} />
        </ChartCard>

        <ChartCard
          title="Joiners and leavers"
          subtitle="People who joined and left each month"
          legend={[{ label: 'Joined', color: SERIES[0] }, { label: 'Left', color: SERIES[1] }]}
          empty={!stats ? 'Loading chart...' : trend.every(r => !r.joiners && !r.exits) ? 'Nobody joined or left in this range.' : undefined}
          table={{ columns: ['Month', 'Joined', 'Left'], rows: trend.map(r => [monthLabel(r.month), r.joiners, r.exits]) }}
        >
          <GroupedBarChart series={['Joined', 'Left']} groups={trend.map(r => ({ label: monthLabel(r.month), values: [r.joiners, r.exits] }))} />
        </ChartCard>

        <ChartCard
          title="Attendance rate"
          subtitle="Share of marked people present, remote or half day, last 30 working days"
          empty={!stats ? 'Loading chart...' : !hasAttendance ? 'No attendance marked yet.' : undefined}
          table={{
            columns: ['Day', 'Rate', 'Present', 'Remote', 'Half day', 'Absent', 'On leave'],
            rows: attendance.map(r => [shortDay(r.date), r.rate === null ? '-' : `${r.rate}%`, r.present, r.remote, r.half_day, r.absent, r.on_leave]),
          }}
        >
          <LineChart seriesLabel="Attendance rate" unit="%" maxValue={100} points={attendance.map(r => ({ label: shortDay(r.date), value: r.rate }))} />
        </ChartCard>

        <ChartCard
          title="Leave taken this year"
          subtitle="Approved working days by leave type"
          empty={!stats ? 'Loading chart...' : leave.length === 0 ? 'No leave taken this year.' : undefined}
          table={{ columns: ['Leave type', 'Approved days', 'Pending days'], rows: leave.map(r => [r.name, r.approved, r.pending]) }}
        >
          <HBarChart seriesLabel="Approved leave days by type" unit=" d" rows={leave.map(r => ({ label: r.name, value: r.approved, detail: `${r.approved} approved, ${r.pending} pending` }))} />
        </ChartCard>

        <ChartCard
          title="Headcount by department"
          empty={data.departments.length === 0 ? 'No employees yet.' : undefined}
          table={{ columns: ['Department', 'People'], rows: data.departments.map(d => [d.name, d.count]) }}
        >
          <HBarChart seriesLabel="Headcount by department" rows={data.departments.map(d => ({ label: d.name, value: d.count }))} />
        </ChartCard>

        <ChartCard
          title="Tenure and employment type"
          empty={!stats ? 'Loading chart...' : !stats.tenure.some(t => t.count) ? 'No employees yet.' : undefined}
          table={{
            columns: ['Group', 'People'],
            rows: [...(stats?.tenure ?? []).map(t => [t.label, t.count]), ...(stats?.employment_mix ?? []).map(m => [EMPLOYMENT_LABELS[m.type] ?? m.type, m.count])],
          }}
        >
          <HBarChart seriesLabel="People by tenure" rows={(stats?.tenure ?? []).map(t => ({ label: t.label, value: t.count }))} />
          <div className="hr-chip-row" aria-label="Employment type">
            {(stats?.employment_mix ?? []).map(m => (
              <span key={m.type} className="hr-mix-chip"><strong>{m.count}</strong> {EMPLOYMENT_LABELS[m.type] ?? m.type}</span>
            ))}
          </div>
        </ChartCard>
      </div>

      <div className="hr-grid">
        <section className="card hr-card" aria-labelledby="hr-away">
          <h3 className="hr-card-title" id="hr-away">On leave today</h3>
          {data.on_leave_today.length === 0 ? (
            <p className="hr-muted">Nobody is on leave today.</p>
          ) : (
            <ul className="hr-list">
              {data.on_leave_today.map(p => (
                <li key={p.employee_id} className="hr-list-row">
                  <span className="hr-strong">{p.employee_name}</span>
                  <span className="hr-muted">{p.leave_type_name}, back after {formatDay(p.end_date)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card hr-card" aria-labelledby="hr-new">
          <h3 className="hr-card-title" id="hr-new">New joiners, last 30 days</h3>
          {data.new_joiners.length === 0 ? (
            <p className="hr-muted">No one joined in the last 30 days.</p>
          ) : (
            <ul className="hr-list">
              {data.new_joiners.map(p => (
                <li key={p.employee_id} className="hr-list-row">
                  <span className="hr-strong">{p.full_name}</span>
                  <span className="hr-muted">{p.designation || 'No designation'}, joined {formatDay(p.joined_on)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card hr-card" aria-labelledby="hr-hol">
          <h3 className="hr-card-title" id="hr-hol">Upcoming holidays</h3>
          {data.upcoming_holidays.length === 0 ? (
            <p className="hr-muted">No holidays scheduled. Add them in the Holidays tab.</p>
          ) : (
            <ul className="hr-list">
              {data.upcoming_holidays.map(h => (
                <li key={h.holiday_id} className="hr-list-row">
                  <span className="hr-strong">{h.name}</span>
                  <span className="hr-muted">{formatDay(h.date)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
