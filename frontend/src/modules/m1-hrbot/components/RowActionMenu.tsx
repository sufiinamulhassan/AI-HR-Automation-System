import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import './RowActionMenu.css'

export interface MenuItem {
  id: string
  label: string
  onSelect: () => void
  tone?: 'danger'
  disabled?: boolean
}

interface Props {
  label: string
  getItems: () => MenuItem[]
}

const DotsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/>
  </svg>
)

const GAP = 4
const MARGIN = 8

export default function RowActionMenu({ label, getItems }: Props) {
  const menuId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  const items = open ? getItems() : []

  function close(returnFocus: boolean) {
    setOpen(false)
    setPos(null)
    if (returnFocus) triggerRef.current?.focus()
  }

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !menuRef.current) return
    const t = triggerRef.current.getBoundingClientRect()
    const m = menuRef.current.getBoundingClientRect()
    let top = t.bottom + GAP
    if (top + m.height > window.innerHeight - MARGIN && t.top - GAP - m.height >= MARGIN) {
      top = t.top - GAP - m.height
    }
    const left = Math.max(MARGIN, Math.min(t.right - m.width, window.innerWidth - m.width - MARGIN))
    setPos({ top, left })
  }, [open])

  const placed = pos !== null
  useEffect(() => {
    if (!placed) return
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus({ preventScroll: true })
  }, [placed])

  useEffect(() => {
    if (!open) return

    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      close(false)
    }
    function onViewportChange(e: Event) {
      if (e.type === 'scroll' && menuRef.current?.contains(e.target as Node)) return
      close(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('scroll', onViewportChange, true)
    window.addEventListener('resize', onViewportChange)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('scroll', onViewportChange, true)
      window.removeEventListener('resize', onViewportChange)
    }
  }, [open])

  function onTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
    }
  }

  function onMenuKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const nodes = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])
    const at = nodes.indexOf(document.activeElement as HTMLElement)
    const go = (i: number) => { e.preventDefault(); nodes[(i + nodes.length) % nodes.length]?.focus() }
    switch (e.key) {
      case 'ArrowDown': go(at + 1); break
      case 'ArrowUp':   go(at < 0 ? -1 : at - 1); break
      case 'Home':      go(0); break
      case 'End':       go(-1); break
      case 'Escape':    e.preventDefault(); close(true); break
      case 'Tab':       e.preventDefault(); close(true); break
    }
  }

  function choose(item: MenuItem) {
    close(true)
    item.onSelect()
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`row-menu-trigger${open ? ' open' : ''}`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={onTriggerKeyDown}
      >
        <DotsIcon />
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          className="row-menu"
          style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: 'hidden' }}
          onKeyDown={onMenuKeyDown}
        >
          {items.map(item => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={item.disabled}
              className={`row-menu-item${item.tone === 'danger' ? ' row-menu-item-danger' : ''}`}
              onClick={() => choose(item)}
            >
              {item.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
