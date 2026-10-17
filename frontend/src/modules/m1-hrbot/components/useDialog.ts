import { useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react'

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useDialog(requestClose: () => void) {
  const boxRef = useRef<HTMLDivElement>(null)
  const pressStartedOn = useRef<EventTarget | null>(null)

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    boxRef.current?.focus()
    return () => { opener?.focus?.() }
  }, [])

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') requestClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [requestClose])

  function trapTab(e: KeyboardEvent<HTMLElement>) {
    if (e.key !== 'Tab' || !boxRef.current) return
    const nodes = Array.from(boxRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(n => !n.closest('[hidden]'))
    if (nodes.length === 0) { e.preventDefault(); return }
    const first = nodes[0]
    const last = nodes[nodes.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === boxRef.current)) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
  }

  function onBackdropMouseDown(e: MouseEvent<HTMLDivElement>) { pressStartedOn.current = e.target }
  function onBackdropClick(e: MouseEvent<HTMLDivElement>) {
    const startedHere = pressStartedOn.current === null || pressStartedOn.current === e.currentTarget
    pressStartedOn.current = null
    if (e.target === e.currentTarget && startedHere) requestClose()
  }

  return { boxRef, trapTab, onBackdropMouseDown, onBackdropClick }
}
