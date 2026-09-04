import type { StageParticipant } from './SpeakerStage'
import './SessionRail.css'

interface Props {
  participants: StageParticipant[]
  questions: string[]
  qIndex: number
  answeredCount: number
  onJumpToChapter: (index: number) => void
}

export default function SessionRail({
  participants, questions, qIndex, answeredCount, onJumpToChapter,
}: Props) {
  return (
    <aside className="rail">
      <section className="rail-section">
        <h2 className="rail-title">In this interview</h2>
        <ul className="rail-people">
          {participants.map(p => (
            <li key={p.id} className="rail-person">
              <span className={`rail-dot${p.speaking ? ' rail-dot-live' : ''}`} />
              <span className="rail-person-name">{p.name}</span>
              <span className="rail-person-role">{p.kind === 'ai' ? 'Interviewer' : 'Candidate'}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rail-section rail-section-grow">
        <h2 className="rail-title">
          Questions
          <span className="rail-title-count">{answeredCount}/{questions.length}</span>
        </h2>
        <ol className="rail-chapters">
          {questions.map((q, i) => {
            const state = i < answeredCount ? 'done' : i === qIndex ? 'current' : 'upcoming'
            if (state === 'upcoming') return null
            return (
              <li key={`${i}-${q.slice(0, 24)}`} className={`rail-chapter rail-chapter-${state}`}>
                <button
                  type="button"
                  className="rail-chapter-btn"
                  onClick={() => onJumpToChapter(i)}
                >
                  <span className="rail-chapter-marker">{state === 'done' ? '✓' : i + 1}</span>
                  <span className="rail-chapter-text">{q}</span>
                </button>
              </li>
            )
          })}
        </ol>
      </section>
    </aside>
  )
}
