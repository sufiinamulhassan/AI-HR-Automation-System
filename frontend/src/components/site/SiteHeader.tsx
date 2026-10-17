import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { PRODUCT_NAME } from '../../lib/brand'
import { prefetchRoute } from '../../lib/prefetch'
import { NAV_LOGIN, NAV_MENUS, type NavMenu } from '../../lib/siteNav'
import { SiteIcon } from './siteIcons'
import './SiteHeader.css'

const OPEN_DELAY_MS = 60
const CLOSE_DELAY_MS = 160

function isActive(menu: NavMenu, pathname: string): boolean {
  if (menu.to && (pathname === menu.to || pathname.startsWith(`${menu.to}/`))) return true
  return (menu.items ?? []).some(item => pathname === item.to || pathname.startsWith(`${item.to}/`))
}

function Panel({ menu, id, labelledBy, onNavigate }: { menu: NavMenu; id: string; labelledBy: string; onNavigate: () => void }) {
  const items = menu.items ?? []
  return (
    <div id={id} role="group" aria-labelledby={labelledBy} className={`xv-panel xv-panel-cols-${menu.columns ?? 2}`}>
      <div className="xv-panel-main">
        <ul className="xv-panel-list">
          {items.map(item => (
            <li key={item.to}>
              <Link
                to={item.to}
                className="xv-panel-item"
                onClick={onNavigate}
                onMouseEnter={() => prefetchRoute(item.to)}
                onFocus={() => prefetchRoute(item.to)}
              >
                <span className="xv-panel-icon"><SiteIcon name={item.icon} size={18} /></span>
                <span className="xv-panel-text">
                  <span className="xv-panel-title">{item.label}</span>
                  <span className="xv-panel-desc">{item.description}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {menu.all && (
          <Link to={menu.all.to} className="xv-panel-all" onClick={onNavigate}>
            {menu.all.label}
            <SiteIcon name="arrowright" size={14} />
          </Link>
        )}
      </div>
      {menu.featured && menu.featured.length > 0 && (
        <div className="xv-panel-side">
          {menu.featured.map(card => (
            <aside key={card.to} className="xv-panel-featured">
              <span className="xv-panel-eyebrow">{card.eyebrow}</span>
              <strong className="xv-panel-feature-title">{card.title}</strong>
              <p className="xv-panel-feature-text">{card.description}</p>
              <Link to={card.to} className="xv-panel-feature-link" onClick={onNavigate}>
                {card.cta}
                <SiteIcon name="arrowright" size={14} />
              </Link>
            </aside>
          ))}
        </div>
      )}
    </div>
  )
}

function DesktopMenu({ menu, open, onOpen, onClose, onDismiss, onToggle }: {
  menu: NavMenu
  open: boolean
  onOpen: () => void
  onClose: () => void
  onDismiss: () => void
  onToggle: () => void
}) {
  const { pathname } = useLocation()
  const base = useId()
  const triggerId = `${base}-trigger`
  const panelId = `${base}-panel`
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const active = isActive(menu, pathname)

  function keyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape' && open) {
      e.stopPropagation()
      onDismiss()
      triggerRef.current?.focus()
    }
  }

  return (
    <div
      className={`xv-menu${open ? ' is-open' : ''}`}
      onMouseEnter={onOpen}
      onMouseLeave={onClose}
      onKeyDown={keyDown}
    >
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className={`xv-menu-trigger${active ? ' is-current' : ''}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
      >
        <span className="xv-nav-label">{menu.label}</span>
        <SiteIcon name="chevron" size={14} className="xv-menu-chevron" />
      </button>
      <Panel menu={menu} id={panelId} labelledBy={triggerId} onNavigate={onDismiss} />
    </div>
  )
}

function Drawer({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  return (
    <div id="site-drawer" className={`xv-drawer${open ? ' is-open' : ''}`} aria-hidden={!open} {...(open ? {} : { inert: '' as unknown as boolean })}>
      <nav aria-label="Mobile" className="xv-drawer-nav">
        {NAV_MENUS.map(menu => {
          if (!menu.items) {
            return (
              <Link key={menu.label} to={menu.to ?? '/'} className="xv-drawer-link" onClick={onNavigate}>
                {menu.label}
              </Link>
            )
          }
          const isOpen = expanded === menu.label
          const panelId = `drawer-${menu.label.toLowerCase()}`
          return (
            <div key={menu.label} className="xv-drawer-group">
              <button
                type="button"
                className="xv-drawer-trigger"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setExpanded(isOpen ? null : menu.label)}
              >
                {menu.label}
                <SiteIcon name="chevron" size={16} className="xv-drawer-chevron" />
              </button>
              <ul id={panelId} className="xv-drawer-list" hidden={!isOpen}>
                {menu.items.map(item => (
                  <li key={item.to}>
                    <Link to={item.to} className="xv-drawer-item" onClick={onNavigate}>
                      <span className="xv-drawer-icon"><SiteIcon name={item.icon} size={16} /></span>
                      <span>
                        <span className="xv-drawer-title">{item.label}</span>
                        <span className="xv-drawer-desc">{item.description}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </nav>
      <div className="xv-drawer-actions">
        <Link to={NAV_LOGIN.to} className="xv-btn xv-btn-primary xv-btn-md" onClick={onNavigate}>
          <span className="xv-btn-label">{NAV_LOGIN.label}</span>
          <span className="xv-btn-chip" aria-hidden="true"><SiteIcon name="arrowright" size={16} /></span>
        </Link>
      </div>
    </div>
  )
}

export default function SiteHeader() {
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [drawer, setDrawer] = useState(false)
  const { pathname } = useLocation()
  const barRef = useRef<HTMLElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const closeAll = useCallback(() => {
    clearTimeout(timer.current)
    setOpenMenu(null)
    setDrawer(false)
  }, [])

  const schedule = useCallback((label: string | null, delay: number) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpenMenu(label), delay)
  }, [])

  useEffect(() => closeAll(), [pathname, closeAll])

  useEffect(() => {
    function outside(e: MouseEvent) {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpenMenu(null)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [])

  useEffect(() => {
    document.body.classList.toggle('xv-locked', drawer)
    return () => document.body.classList.remove('xv-locked')
  }, [drawer])

  useEffect(() => () => clearTimeout(timer.current), [])

  return (
    <header className="xv-nav" ref={barRef}>
      <span aria-hidden="true" className="xv-nav-dot xv-nav-dot-tl" />
      <span aria-hidden="true" className="xv-nav-dot xv-nav-dot-bl" />
      <span aria-hidden="true" className="xv-nav-dot xv-nav-dot-tr" />
      <span aria-hidden="true" className="xv-nav-dot xv-nav-dot-br" />

      <div className="xv-shell xv-nav-inner">
        <Link to="/" className="xv-brand" onClick={closeAll} aria-label={`${PRODUCT_NAME} home`}>
          <span aria-hidden="true" className="xv-cell-dot xv-cell-dot-t" />
          <span aria-hidden="true" className="xv-cell-dot xv-cell-dot-b" />
          <span className="xv-brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2" />
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="m16 11 2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="xv-brand-text">
            <span className="xv-brand-name">{PRODUCT_NAME}</span>
          </span>
        </Link>

        <nav aria-label="Primary" className="xv-hdr-links">
          {NAV_MENUS.map(menu => {
            if (!menu.items) {
              return (
                <NavLink
                  key={menu.label}
                  to={menu.to ?? '/'}
                  className="xv-hdr-link"
                  onMouseEnter={() => { prefetchRoute(menu.to ?? '/'); schedule(null, CLOSE_DELAY_MS) }}
                  onFocus={() => prefetchRoute(menu.to ?? '/')}
                  onTouchStart={() => prefetchRoute(menu.to ?? '/')}
                >
                  <span className="xv-nav-label">{menu.label}</span>
                </NavLink>
              )
            }
            return (
              <DesktopMenu
                key={menu.label}
                menu={menu}
                open={openMenu === menu.label}
                onOpen={() => schedule(menu.label, OPEN_DELAY_MS)}
                onClose={() => schedule(null, CLOSE_DELAY_MS)}
                onDismiss={() => { clearTimeout(timer.current); setOpenMenu(null) }}
                onToggle={() => { clearTimeout(timer.current); setOpenMenu(current => (current === menu.label ? null : menu.label)) }}
              />
            )
          })}
        </nav>

        <div className="xv-nav-actions xv-hdr-actions">
          <span aria-hidden="true" className="xv-cell-dot xv-cell-dot-tl" />
          <span aria-hidden="true" className="xv-cell-dot xv-cell-dot-bl" />
          <Link to={NAV_LOGIN.to} className="xv-btn xv-btn-primary xv-btn-nav xv-hdr-cta">
            <span className="xv-btn-label">{NAV_LOGIN.label}</span>
            <span className="xv-btn-chip" aria-hidden="true"><SiteIcon name="arrowright" size={14} /></span>
          </Link>
          <button
            type="button"
            className="xv-hdr-burger"
            aria-label={drawer ? 'Close menu' : 'Open menu'}
            aria-expanded={drawer}
            aria-controls="site-drawer"
            onClick={() => { setOpenMenu(null); setDrawer(v => !v) }}
          >
            <SiteIcon name={drawer ? 'close' : 'menu'} size={22} />
          </button>
        </div>
      </div>

      <Drawer open={drawer} onNavigate={closeAll} />
    </header>
  )
}
