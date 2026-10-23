import { Suspense, useEffect, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/auth.store'
import './PlatformLayout.css'

const iconProps = {
  width: 16, height: 16, viewBox: '0 0 24 24', fill: 'currentColor', fillOpacity: 0.16, stroke: 'currentColor',
  strokeWidth: 2.5, strokeLinecap: 'round', strokeLinejoin: 'round',
} as const

const OverviewIcon = () => (
  <svg {...iconProps} aria-hidden>
    <rect x="3" y="3" width="7" height="9" rx="1" />
    <rect x="14" y="3" width="7" height="5" rx="1" />
    <rect x="14" y="12" width="7" height="9" rx="1" />
    <rect x="3" y="16" width="7" height="5" rx="1" />
  </svg>
)

const ClientsIcon = () => (
  <svg {...iconProps} aria-hidden>
    <rect x="4" y="2" width="16" height="20" rx="1" />
    <path d="M9 22v-4h6v4" fill="none" />
    <path d="M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01" fill="none" />
  </svg>
)

const UsageIcon = () => (
  <svg {...iconProps} aria-hidden>
    <rect x="4" y="12" width="4" height="8" rx="1" />
    <rect x="10" y="6" width="4" height="14" rx="1" />
    <rect x="16" y="9" width="4" height="11" rx="1" />
  </svg>
)

const AiIcon = () => (
  <svg {...iconProps} aria-hidden>
    <rect x="6" y="6" width="12" height="12" rx="2" />
    <path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" fill="none" />
  </svg>
)

const BillingIcon = () => (
  <svg {...iconProps} aria-hidden>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3 10h18M7 15h4" fill="none" />
  </svg>
)

const HealthIcon = () => (
  <svg {...iconProps} aria-hidden>
    <path d="M3 12h4l2-6 4 12 2-6h6" fill="none" />
  </svg>
)

const AuditIcon = () => (
  <svg {...iconProps} aria-hidden>
    <rect x="5" y="3" width="14" height="18" rx="2" />
    <path d="M9 8h6M9 12h6M9 16h4" fill="none" />
  </svg>
)

const OwnersIcon = () => (
  <svg {...iconProps} aria-hidden>
    <path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z" />
    <path d="M9 12l2 2 4-4" fill="none" />
  </svg>
)

const InboxIcon = () => (
  <svg {...iconProps} aria-hidden>
    <path d="M4 13l2-8h12l2 8v6H4z" />
    <path d="M4 13h5l1 2h4l1-2h5" fill="none" />
  </svg>
)

const MailIcon = () => (
  <svg {...iconProps} aria-hidden>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3 7l9 6 9-6" fill="none" />
  </svg>
)

const LogoutIcon = () => (
  <svg {...iconProps} fill="none" aria-hidden>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
)

const MenuIcon = () => (
  <svg {...iconProps} width={20} height={20} fill="none" aria-hidden>
    <line x1="4" y1="7" x2="20" y2="7" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="17" x2="20" y2="17" />
  </svg>
)

const NAV: { to: string; label: string; icon: ReactNode; end?: boolean }[] = [
  { to: '/platform', label: 'Overview', icon: <OverviewIcon />, end: true },
  { to: '/platform/clients', label: 'Clients', icon: <ClientsIcon /> },
  { to: '/platform/inbox', label: 'Inbox', icon: <InboxIcon /> },
  { to: '/platform/usage', label: 'Usage', icon: <UsageIcon /> },
  { to: '/platform/ai', label: 'AI models', icon: <AiIcon /> },
  { to: '/platform/billing', label: 'Billing', icon: <BillingIcon /> },
  { to: '/platform/health', label: 'Health', icon: <HealthIcon /> },
  { to: '/platform/mail', label: 'Email', icon: <MailIcon /> },
  { to: '/platform/audit', label: 'Audit', icon: <AuditIcon /> },
  { to: '/platform/owners', label: 'Platform owners', icon: <OwnersIcon /> },
]

export default function PlatformLayout() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)

  const name = user?.name || user?.email || 'Platform owner'
  const current = NAV.find(n => (n.end ? location.pathname === n.to : location.pathname.startsWith(n.to)))
    ?? (location.pathname.startsWith('/platform/companies') ? NAV.find(n => n.to === '/platform/clients') : undefined)

  useEffect(() => { setMobileOpen(false) }, [location.pathname])
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [mobileOpen])

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <div className="plat-shell">
      <div className="plat-mobile-bar">
        <button
          type="button"
          className="plat-mobile-menu"
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen(o => !o)}
        >
          <MenuIcon />
        </button>
        <span className="plat-mobile-title">{current?.label ?? 'Platform'}</span>
      </div>

      {mobileOpen && <div className="plat-backdrop" onClick={() => setMobileOpen(false)} />}

      <aside className={`plat-sidebar${mobileOpen ? ' plat-sidebar-open' : ''}`}>
        <div className="plat-brand">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
            <circle cx="9" cy="7" r="4" stroke="#4778f3" strokeWidth="2" />
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" stroke="#4778f3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="m16 11 2 2 4-4" stroke="#4778f3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="plat-brand-text">
            <div className="plat-brand-name">Hirely<span className="plat-brand-accent">.ai</span></div>
            <div className="plat-brand-role">Platform Console</div>
          </div>
        </div>

        <nav className="plat-nav" aria-label="Platform console">
          {NAV.map(n => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => `plat-nav-item${isActive ? ' plat-nav-item-active' : ''}`}
            >
              <span className="plat-nav-icon">{n.icon}</span>
              <span className="plat-nav-label">{n.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="plat-footer">
          <button type="button" className="plat-logout" onClick={handleLogout}>
            <LogoutIcon />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      <main className="plat-main">
        <div className="plat-topbar">
          <div className="plat-user">
            <div className="plat-user-avatar" aria-hidden>{name.charAt(0).toUpperCase()}</div>
            <div className="plat-user-info">
              <div className="plat-user-name">{name}</div>
              <div className="plat-user-role">Platform owner</div>
            </div>
          </div>
        </div>
        <Suspense fallback={<div role="status" className="plat-loading">Loading…</div>}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  )
}
