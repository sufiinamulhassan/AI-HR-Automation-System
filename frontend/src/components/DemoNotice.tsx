import { useEffect, useRef, useState } from 'react'
import { DEMO_NOTICE_EVENT } from '../lib/demoNotice'
import './DemoNotice.css'

const SHOW_MS = 5000

export default function DemoNotice() {
  const [message, setMessage] = useState('')
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    function show(event: Event) {
      const text = (event as CustomEvent<string>).detail
      if (typeof text !== 'string' || !text) return
      setMessage(text)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setMessage(''), SHOW_MS)
    }
    window.addEventListener(DEMO_NOTICE_EVENT, show)
    return () => {
      window.removeEventListener(DEMO_NOTICE_EVENT, show)
      window.clearTimeout(timer.current)
    }
  }, [])

  return (
    <div className="demo-notice-region" role="status" aria-live="polite">
      {message && (
        <div className="demo-notice">
          <span className="demo-notice-text">{message}</span>
          <button type="button" className="demo-notice-close" aria-label="Dismiss" onClick={() => setMessage('')}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}
