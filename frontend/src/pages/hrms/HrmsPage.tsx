import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuthStore } from '../../store/auth.store'
import OverviewTab from './OverviewTab'
import EmployeesTab from './EmployeesTab'
import LeaveTab from './LeaveTab'
import AttendanceTab from './AttendanceTab'
import HolidaysTab from './HolidaysTab'
import InsightsTab from './InsightsTab'
import '../../styles/admin-tabs.css'
import './HrmsPage.css'

type Tab = 'overview' | 'insights' | 'employees' | 'leave' | 'attendance' | 'holidays'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'insights', label: 'People Insights' },
  { id: 'employees', label: 'Employees' },
  { id: 'leave', label: 'Leave' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'holidays', label: 'Holidays' },
]

export default function HrmsPage() {
  const role = useAuthStore(s => s.user?.role)
  const canManage = role === 'admin' || role === 'superadmin'
  const [tab, setTab] = useState<Tab>('overview')
  const [toast, setToast] = useState('')
  const timer = useRef<number | undefined>(undefined)

  const notify = useCallback((message: string) => {
    setToast(message)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setToast(''), 3000)
  }, [])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  return (
    <div className="hr-page">
      {toast && <div className="hr-toast" role="status">{toast}</div>}
      <div className="page-header">
        <div>
          <div className="page-title">HRMS</div>
          <div className="page-sub">Employees, leave, attendance and holidays in one place.</div>
        </div>
      </div>

      <div className="adm-tabs" role="tablist" aria-label="HRMS sections">
        {TABS.filter(t => t.id !== 'insights' || canManage).map(t => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`adm-tab${tab === t.id ? ' adm-tab-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="hr-body" role="tabpanel">
        {tab === 'overview' && <OverviewTab onOpen={setTab} />}
        {tab === 'insights' && canManage && <InsightsTab />}
        {tab === 'employees' && <EmployeesTab canManage={canManage} notify={notify} />}
        {tab === 'leave' && <LeaveTab canManage={canManage} notify={notify} />}
        {tab === 'attendance' && <AttendanceTab canManage={canManage} notify={notify} />}
        {tab === 'holidays' && <HolidaysTab canManage={canManage} notify={notify} />}
      </div>
    </div>
  )
}
