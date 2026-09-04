import type { CoachTip } from '../hooks/useCoachMetrics'
import './AiNotesPanel.css'

interface Props {
  tips: CoachTip[]
  captionsSupported: boolean
}

const TONE_ICON: Record<CoachTip['tone'], string> = {
  good: '✓',
  watch: '!',
  tip: '★',
}

export default function AiNotesPanel({ tips, captionsSupported }: Props) {
  return (
    <div className="notes-panel">
      <div className="notes-header">
        <span className="notes-badge">private - only you can see this</span>
      </div>

      {tips.length === 0 ? (
        <p className="notes-empty">
          {captionsSupported
            ? 'Tips on your pace and clarity appear here while you answer.'
            : 'Your browser does not support live captions, so pace tips are limited. Chrome gives the full experience.'}
        </p>
      ) : (
        <ul className="notes-tips">
          {tips.map(t => (
            <li key={t.id} className={`notes-tip notes-tip-${t.tone}`}>
              <span className="notes-tip-icon" aria-hidden="true">{TONE_ICON[t.tone]}</span>
              <div>
                <div className="notes-tip-title">{t.title}</div>
                <div className="notes-tip-body">{t.body}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
