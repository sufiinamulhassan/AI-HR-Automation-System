import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Component, useEffect, useState, type ReactNode } from 'react'
import { useAuthStore } from '../../store/auth.store'

class PageBoundary extends Component<{ children: ReactNode }, { crashed: boolean; msg: string }> {
  state = { crashed: false, msg: '' }
  static getDerivedStateFromError(e: Error) { return { crashed: true, msg: e.message } }
  componentDidCatch(e: Error) { console.error('[PageBoundary]', e) }
  render() {
    if (this.state.crashed)
      return (
        <div style={{ padding: '2rem', color: '#ef4444', fontFamily: 'monospace', fontSize: '.875rem', lineHeight: 1.6 }}>
          <strong>Something went wrong on this page.</strong><br />
          {this.state.msg}<br />
          <button style={{ marginTop: '1rem', cursor: 'pointer', padding: '.35rem .8rem' }}
            onClick={() => this.setState({ crashed: false, msg: '' })}>
            Retry
          </button>
        </div>
      )
    return this.props.children
  }
}
import ModelSelector from './ModelSelector'
import './DashboardLayout.css'

const DashboardIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
    <rect x="3" y="3" width="7" height="9" rx="1" />
    <rect x="14" y="3" width="7" height="5" rx="1" />
    <rect x="14" y="12" width="7" height="9" rx="1" />
    <rect x="3" y="16" width="7" height="5" rx="1" />
  </svg>
)

const HRBotIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
    <path d="M12 8V4H8" />
    <rect width="16" height="12" x="4" y="8" rx="2" />
    <path d="M2 14h2" />
    <path d="M20 14h2" />
    <path d="M15 13v2" />
    <path d="M9 13v2" />
  </svg>
)

const ActivityIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
  </svg>
)

const UsersIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
)

const ScenariosIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="9" y1="13" x2="15" y2="13" />
    <line x1="9" y1="17" x2="15" y2="17" />
  </svg>
)

const SettingsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06-.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)

const CompanyIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
    <rect x="4" y="2" width="16" height="20" rx="1" />
    <path d="M9 22v-4h6v4" />
    <path d="M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01" />
  </svg>
)

const GuideIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    <path d="M9 7h6" />
  </svg>
)

const LogoutIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
)

const MenuIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="7" x2="20" y2="7" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="17" x2="20" y2="17" />
  </svg>
)

const ChevronIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
)

const MODULES: { to: string; label: string; icon: ReactNode; end?: boolean }[] = [
  { to: '/dashboard',             label: 'Dashboard',        icon: <DashboardIcon />, end: true },
  { to: '/dashboard/hrbot',       label: 'Recruiting',           icon: <HRBotIcon /> },
  { to: '/dashboard/activity',    label: 'Activity',         icon: <ActivityIcon /> },
]

const ADMIN_NAV = [
  { to: '/dashboard/users', label: 'Users & Roles', icon: <UsersIcon /> },
  { to: '/dashboard/settings', label: 'Platform Settings', icon: <SettingsIcon /> },
  { to: '/dashboard/organization', label: 'Organization', icon: <CompanyIcon /> },
  { to: '/dashboard/interview-automation', label: 'Interview & Automation', icon: <ScenariosIcon /> },
]

const GUIDE_NAV = { to: '/dashboard/guide', label: 'User Guide', icon: <GuideIcon /> }

const ROLE_LABELS: Record<string, string> = {
  superadmin: 'Super Admin',
  admin: 'HR Admin',
  standard: 'Recruiter',
}

const ROLE_CLASS: Record<string, string> = {
  superadmin: 'role-super',
  admin: 'role-admin',
  standard: 'role-standard',
}

export default function DashboardLayout() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const u = user as Record<string, string> | null
  const role = u?.role || 'standard'
  const isAdmin = role === 'admin' || role === 'superadmin'

  const isOnAdminRoute = ADMIN_NAV.some(n => location.pathname.startsWith(n.to))
  const [adminExpanded, setAdminExpanded] = useState(isOnAdminRoute)

  useEffect(() => {
    if (isOnAdminRoute) setAdminExpanded(true)
  }, [isOnAdminRoute])

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [mobileOpen])

  const allNav = [...MODULES, ...(isAdmin ? ADMIN_NAV : []), GUIDE_NAV]
  const currentPage = allNav.find(n => ('end' in n && n.end) ? location.pathname === n.to : location.pathname.startsWith(n.to))
  const pageTitle = location.pathname === '/dashboard/profile' ? 'Profile' : (currentPage?.label || 'Dashboard')

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <div className="dashboard-shell">
      <div className="mobile-topbar">
        <button
          className="mobile-topbar-hamburger"
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen(o => !o)}
        >
          <MenuIcon />
        </button>
        <span className="mobile-topbar-title">{pageTitle}</span>
      </div>

      {mobileOpen && <div className="sidebar-backdrop" onClick={() => setMobileOpen(false)} />}

      <aside className={`sidebar${mobileOpen ? ' sidebar-mobile-open' : ''}`}>
        <div className="sidebar-brand">
          <div className="brand-logo-icon">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2" />
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="m16 11 2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="brand-text">
            <div className="brand-name">Hirely<span className="brand-name-sub">.ai</span></div>
            <div className="brand-role-desc">
              {role === 'superadmin' ? 'Super Admin Portal' : role === 'admin' ? 'HR Admin Portal' : 'Recruiter Portal'}
            </div>
          </div>
          <button className="sidebar-close-btn" aria-label="Close menu" onClick={() => setMobileOpen(false)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="sidebar-scroll">
          <nav className="sidebar-nav">
            {MODULES.map(n => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              >
                <span className="nav-icon">{n.icon}</span>
                <span className="nav-label">{n.label}</span>
              </NavLink>
            ))}
          </nav>

          {isAdmin && (
            <>
              <div className="sidebar-divider" />
              <button
                type="button"
                className={`sidebar-admin-toggle${isOnAdminRoute ? ' active' : ''}`}
                aria-expanded={adminExpanded}
                onClick={() => setAdminExpanded(v => !v)}
              >
                <span className="nav-icon"><SettingsIcon /></span>
                <span className="nav-label">Admin Settings</span>
                <span className={`admin-toggle-chevron${adminExpanded ? ' expanded' : ''}`}><ChevronIcon /></span>
              </button>
              {adminExpanded && (
                <nav className="sidebar-nav sidebar-nav-admin">
                  {ADMIN_NAV.map(n => (
                    <NavLink
                      key={n.to}
                      to={n.to}
                      className={({ isActive }) => `nav-item nav-item-admin${isActive ? ' active' : ''}`}
                    >
                      <span className="nav-icon">{n.icon}</span>
                      <span className="nav-label">{n.label}</span>
                    </NavLink>
                  ))}
                </nav>
              )}
            </>
          )}

          <div className="sidebar-divider" />
          <nav className="sidebar-nav">
            <NavLink
              to={GUIDE_NAV.to}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <span className="nav-icon">{GUIDE_NAV.icon}</span>
              <span className="nav-label">{GUIDE_NAV.label}</span>
            </NavLink>
          </nav>
        </div>

        <div className="sidebar-footer">
          <div className="sidebar-model-wrap">
            <ModelSelector />
          </div>

          <NavLink to="/dashboard/profile" className={({ isActive }) => `sidebar-user${isActive ? ' sidebar-user-active' : ''}`}>
            <div className="sidebar-user-avatar">
              {(u?.name || 'A').charAt(0).toUpperCase()}
            </div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{u?.name || 'Admin'}</div>
              <span className={`role-badge ${ROLE_CLASS[role] || 'role-standard'}`}>
                {ROLE_LABELS[role] || role}
              </span>
            </div>
          </NavLink>

          <button className="btn-logout" onClick={handleLogout}>
            <span className="btn-logout-icon"><LogoutIcon /></span>
            <span className="btn-logout-text">Sign out</span>
          </button>
        </div>
      </aside>

      <main className="dashboard-main">
        <PageBoundary>
          <Outlet />
        </PageBoundary>
      </main>
    </div>
  )
}
