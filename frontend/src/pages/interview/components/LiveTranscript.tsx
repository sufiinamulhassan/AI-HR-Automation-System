import { useEffect, useMemo, useRef } from 'react'
import type { TranscriptEntry, TurnPhase } from '../useInterviewSession'
import './LiveTranscript.css'

interface Props {
  transcript: TranscriptEntry[]
  pendingQuestion: string | null
  interimText: string
  draftAnswer: string
  turnPhase: TurnPhase
  candidateName: string
  startedAt: number | null
}

function timecode(iso: string, startedAt: number | null): string {
  if (!startedAt) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const secs = Math.max(0, Math.floor((t - startedAt) / 1000))
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

interface Row {
  key: string
  speaker: 'ai' | 'candidate'
  name: string
  text: string
  at: string
  anchor?: string
  state?: 'interim' | 'draft'
}

export default function LiveTranscript({
  transcript, pendingQuestion, interimText, draftAnswer, turnPhase, candidateName, startedAt,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(true)

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    transcript.forEach((entry, i) => {
      out.push({
        key: `q${i}`, anchor: `transcript-q${i}`,
        speaker: 'ai', name: 'AI Interviewer',
        text: entry.question, at: timecode(entry.answered_at, startedAt),
      })
      out.push({
        key: `a${i}`,
        speaker: 'candidate', name: candidateName || 'You',
        text: entry.answer || '(skipped)', at: timecode(entry.answered_at, startedAt),
      })
    })
    if (pendingQuestion) {
      out.push({
        key: 'pending', anchor: `transcript-q${transcript.length}`,
        speaker: 'ai', name: 'AI Interviewer', text: pendingQuestion, at: '',
      })
    }
    if (turnPhase === 'recording' && interimText) {
      out.push({
        key: 'interim', speaker: 'candidate', name: candidateName || 'You',
        text: interimText, at: '', state: 'interim',
      })
    }
    if (turnPhase === 'review' && draftAnswer) {
      out.push({
        key: 'draft', speaker: 'candidate', name: candidateName || 'You',
        text: draftAnswer, at: '', state: 'draft',
      })
    }
    return out
  }, [transcript, pendingQuestion, interimText, draftAnswer, turnPhase, candidateName, startedAt])

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const onScroll = () => {
      pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (pinnedRef.current) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [rows.length, interimText])

  return (
    <div className="lt-panel">
      <div className="lt-scroller" ref={scrollerRef}>
        {rows.length === 0 && (
          <div className="lt-empty">Your conversation will appear here as it happens.</div>
        )}

        {rows.map(row => (
          <div
            key={row.key}
            id={row.anchor}
            className={`lt-row lt-${row.speaker}${row.state ? ` lt-${row.state}` : ''}`}
          >
            <div className="lt-meta">
              <span className={`lt-avatar lt-avatar-${row.speaker}`}>
                {row.speaker === 'ai' ? 'AI' : (candidateName || 'You').slice(0, 1).toUpperCase()}
              </span>
              <span className="lt-name">{row.name}</span>
              {row.at && <span className="lt-time">{row.at}</span>}
              {row.state === 'interim' && <span className="lt-tag">live</span>}
              {row.state === 'draft' && <span className="lt-tag lt-tag-draft">unconfirmed</span>}
            </div>
            <p className="lt-text">{row.text}</p>
          </div>
        ))}

        {turnPhase === 'thinking' && (
          <div className="lt-row lt-ai">
            <div className="lt-meta">
              <span className="lt-avatar lt-avatar-ai">AI</span>
              <span className="lt-name">AI Interviewer</span>
            </div>
            <p className="lt-text lt-thinking">
              <span /><span /><span />
            </p>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  )
}
