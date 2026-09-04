import type { TranscriptEntry } from '../useInterviewSession'
import './RecapPanel.css'

interface Props {
  transcript: TranscriptEntry[]
  totalQuestions: number
  elapsedLabel: string
  avgWords: number
}

const GIST_CHARS = 220

function gist(text: string): string {
  const clean = text.trim()
  if (clean.length <= GIST_CHARS) return clean
  const cut = clean.slice(0, GIST_CHARS)
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
  return (lastStop > GIST_CHARS * 0.5 ? cut.slice(0, lastStop + 1) : `${cut.trimEnd()}…`)
}

export default function RecapPanel({ transcript, totalQuestions, elapsedLabel, avgWords }: Props) {
  const answered = transcript.filter(t => t.answer)

  return (
    <div className="recap">
      <div className="recap-stats">
        <div className="recap-stat">
          <span className="recap-stat-value">{answered.length}<span className="recap-stat-of">/{totalQuestions}</span></span>
          <span className="recap-stat-label">Answered</span>
        </div>
        <div className="recap-stat">
          <span className="recap-stat-value">{elapsedLabel}</span>
          <span className="recap-stat-label">Time left</span>
        </div>
        <div className="recap-stat">
          <span className="recap-stat-value">{avgWords || '-'}</span>
          <span className="recap-stat-label">Avg words / answer</span>
        </div>
      </div>

      {answered.length === 0 ? (
        <p className="recap-empty">
          Once you have answered a question it will be summarised here, so you can see what
          ground you have already covered.
        </p>
      ) : (
        <ol className="recap-list">
          {answered.map((entry, i) => (
            <li key={`${i}-${entry.answered_at}`} className="recap-item">
              <div className="recap-q">
                <span className="recap-q-num">{i + 1}</span>
                {entry.question}
              </div>
              <p className="recap-a">{gist(entry.answer)}</p>
            </li>
          ))}
        </ol>
      )}

      <p className="recap-foot">
        This recap is generated on your own device from the transcript above. It is not
        an assessment, and it is not sent anywhere.
      </p>
    </div>
  )
}
