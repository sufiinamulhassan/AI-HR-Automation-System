import type { TurnPhase } from '../useInterviewSession'
import './TurnControls.css'

interface Props {
  turnPhase: TurnPhase
  voiceNotice: string
  draftAnswer: string
  recordTimeLabel: string
  maxAnswerMinutes: number
  handsFree: boolean
  hasSpoken: boolean
  onUseButtons: () => void
  onRecord: () => void
  onStop: () => void
  onRerecord: () => void
  onUseAnswer: () => void
}

export default function TurnControls({
  turnPhase, voiceNotice, draftAnswer, recordTimeLabel, maxAnswerMinutes,
  handsFree, hasSpoken, onUseButtons, onRecord, onStop, onRerecord, onUseAnswer,
}: Props) {
  return (
    <div className="turn-bar">
      {voiceNotice && <div className="turn-notice" role="status">{voiceNotice}</div>}

      {turnPhase === 'speaking' && (
        <div className="turn-state" role="status" aria-live="polite">
          <span className="turn-speaking-dot" />
          Your interviewer is speaking…
        </div>
      )}

      {turnPhase === 'ready' && (handsFree ? (
        <div className="turn-state" role="status" aria-live="polite">
          <span className="turn-speaking-dot" />
          Opening your microphone…
        </div>
      ) : (
        <button className="btn-record" onClick={onRecord}>
          <span className="record-dot" /> Record your answer
        </button>
      ))}

      {turnPhase === 'recording' && (handsFree ? (
        <div className="turn-listening">
          <div className="turn-listening-main">
            <span className={`listen-orb${hasSpoken ? ' listen-orb-live' : ''}`} />
            <div className="turn-listening-copy">
              <div className="turn-listening-title" role="status" aria-live="polite">
                {hasSpoken ? 'Listening - take your time' : 'Go ahead, start speaking'}
              </div>
              <div className="turn-listening-sub">
                {hasSpoken
                  ? 'I\'ll move to the next question when you finish.'
                  : 'Your answer records automatically. Just talk normally.'}
              </div>
            </div>
            <span className="recording-time">{recordTimeLabel}</span>
          </div>
          <div className="turn-listening-actions">
            <button className="btn-done" onClick={onStop}>
              {hasSpoken ? "I'm done" : 'Skip this question'}
            </button>
            <button type="button" className="btn-use-buttons" onClick={onUseButtons}>
              Use buttons instead
            </button>
          </div>
        </div>
      ) : (
        <div className="turn-recording">
          <span className="recording-pulse" />
          <span className="recording-time">{recordTimeLabel}</span>
          <button className="btn-stop" onClick={onStop}>Stop &amp; submit answer</button>
          <span className="recording-limit">Max {maxAnswerMinutes} min</span>
        </div>
      ))}

      {turnPhase === 'transcribing' && (
        <div className="turn-state" role="status" aria-live="polite">
          <div className="turn-spinner" />
          Transcribing your answer…
        </div>
      )}

      {turnPhase === 'review' && (
        <div className="turn-review">
          <div className="turn-review-label">Here's what we heard - is this right?</div>
          <div className="turn-review-text">{draftAnswer}</div>
          <div className="turn-review-actions">
            <button className="btn-rerecord" onClick={onRerecord}>Record again</button>
            <button className="btn-send" onClick={onUseAnswer}>Use this answer →</button>
          </div>
        </div>
      )}

      {turnPhase === 'thinking' && (
        <div className="turn-state" role="status" aria-live="polite">
          <div className="turn-spinner" />
          Preparing the next question…
        </div>
      )}
    </div>
  )
}
