import { Link } from 'react-router-dom'
import AttentionMenu from './AttentionMenu'
import './TopBar.css'

const ChevronDownIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
)

const BellIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
)

interface TopBarProps {
  name: string
  roleLabel: string
  avatarInitial: string
  avatarUrl?: string | null
  showAttention?: boolean
}

export default function TopBar({ name, roleLabel, avatarInitial, avatarUrl, showAttention = false }: TopBarProps) {
  return (
    <div className="dashboard-topbar">
      <Link to="/dashboard/profile" className="topbar-user">
        <div className="topbar-user-avatar">
          {avatarUrl ? <img className="topbar-user-avatar-img" src={avatarUrl} alt="" /> : avatarInitial}
        </div>
        <div className="topbar-user-info">
          <div className="topbar-user-name">{name}</div>
          <div className="topbar-user-role">{roleLabel}</div>
        </div>
        <span className="topbar-user-chevron"><ChevronDownIcon /></span>
      </Link>

      <div className="topbar-actions">
        {showAttention && <AttentionMenu />}
        <Link to="/dashboard/activity" className="topbar-bell" aria-label="Notifications" title="Notifications">
          <BellIcon />
        </Link>
      </div>
    </div>
  )
}
