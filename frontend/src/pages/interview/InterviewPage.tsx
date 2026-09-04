import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import ProctoringMonitor from '../../modules/m1-hrbot/components/ProctoringMonitor'
import CodingWorkspace from '../../components/coding/CodingWorkspace'
import { useCodingSession } from '../../components/coding/useCodingSession'
import { enterFullscreen } from '../../modules/m1-hrbot/lib/lockdown'
import { MAX_ANSWER_SECONDS, MAX_VIOLATIONS, useInterviewSession } from './useInterviewSession'
import { useAudioLevel, SILENCE_FLOOR } from './hooks/useAudioLevel'
import { useActiveSpeaker } from './hooks/useActiveSpeaker'
import { useHandsFreeTurn } from './hooks/useHandsFreeTurn'
import { useLiveCaptions } from './hooks/useLiveCaptions'
import { useCoachMetrics } from './hooks/useCoachMetrics'
import SpeakerStage, { type StageParticipant } from './components/SpeakerStage'
import LiveTranscript from './components/LiveTranscript'
import RecapPanel from './components/RecapPanel'
import AiNotesPanel from './components/AiNotesPanel'
import FreeformCodeEditor from './components/FreeformCodeEditor'
import Whiteboard from './components/Whiteboard'
import TurnControls from './components/TurnControls'
import './InterviewPage.css'

type Tab = 'notes' | 'transcript' | 'summary' | 'code' | 'whiteboard'

const DESIGN_QUESTION_RE = /\b(design|architecture|diagram|whiteboard|sketch|draw|wireframe|flow ?chart|system design)\b/i
function isDesignQuestion(question?: string) {
  return Boolean(question && DESIGN_QUESTION_RE.test(question))
}

const BrandMark = () => (
  <svg width="20" height="20" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M20 14C22.2091 14 24 12.2091 24 10C24 7.79086 22.2091 6 20 6C17.7909 6 16 7.79086 16 10C16 12.2091 17.7909 14 20 14Z" fill="#4778f3" />
    <path d="M20 16C14.4772 16 10 20.4772 10 26C10 31.5228 14.4772 36 20 36C25.5228 36 30 31.5228 30 26C30 24 29.2 22.2 27.8 20.8L25.8 22.8C26.5 23.7 27 24.8 27 26C27 29.866 23.866 33 20 33C16.134 33 13 29.866 13 26C13 22.134 16.134 19 20 19C21.2 19 22.3 19.3 23.2 19.9L25.2 17.9C23.7 16.7 21.9 16 20 16Z" fill="#4778f3" />
  </svg>
)

export default function InterviewPage() {
  const { token } = useParams<{ token: string }>()
  const [tab, setTab] = useState<Tab>('transcript')
  const [ccEnabled, setCcEnabled] = useState(false)

  const [handsFreeWanted, setHandsFreeWanted] = useState(true)
  const handsFreeRef = useRef(false)
  const s = useInterviewSession(token, { autoAdvance: handsFreeRef.current })

  const { levelRef, level, supported: levelSupported } = useAudioLevel(s.stream, s.status === 'active')

  const coding = useCodingSession(token, s.codingAssigned && s.status === 'active')
  const codeReady = Boolean(coding.session)

  const handsFree = useHandsFreeTurn({
    enabled: handsFreeWanted && levelSupported && tab !== 'code',
    levelRef,
    status: s.status,
    turnPhase: s.turnPhase,
    readyToken: s.readyToken,
    startRecording: s.startRecording,
    stopRecording: s.stopRecording,
  })
  handsFreeRef.current = handsFree.active
  const captions = useLiveCaptions(s.turnPhase === 'recording')
  const coach = useCoachMetrics({
    levelRef,
    turnPhase: s.turnPhase,
    recordSecs: s.recordSecs,
    liveText: captions.text,
    draftAnswer: s.draftAnswer,
    transcript: s.transcript,
  })

  const aiSpeaking = s.status === 'active' && s.turnPhase === 'speaking'
  const candidateSpeaking = s.status === 'active' && level >= SILENCE_FLOOR

  const participants = useMemo<StageParticipant[]>(() => [
    {
      id: 'ai',
      name: 'AI Interviewer',
      kind: 'ai',
      level: 0,
      speaking: aiSpeaking,
      sublabel: s.questions.length ? `Question ${Math.min(s.qIndex + 1, s.questions.length)} of ${s.questions.length}` : undefined,
    },
    {
      id: 'me',
      name: s.candidateName || 'You',
      kind: 'candidate',
      stream: s.stream,
      level,
      speaking: candidateSpeaking,
    },
  ], [aiSpeaking, candidateSpeaking, level, s.stream, s.candidateName, s.qIndex, s.questions.length])

  const speakerInputs = useMemo(() => [
    { id: 'ai', level: 0, priority: aiSpeaking },
    { id: 'me', level },
  ], [aiSpeaking, level])

  const focusedId = useActiveSpeaker(speakerInputs, 'ai')

  const pendingQuestion =
    s.status === 'active' && s.turnPhase !== 'thinking' && s.qIndex >= s.transcript.length
      ? s.questions[s.qIndex] ?? null
      : null

  const currentQuestion = s.questions[s.qIndex]
  const autoOfferWhiteboard = isDesignQuestion(currentQuestion)

  const whiteboardOfferedForRef = useRef<string | null>(null)
  useEffect(() => {
    if (!autoOfferWhiteboard || !currentQuestion) return
    if (whiteboardOfferedForRef.current === currentQuestion) return
    whiteboardOfferedForRef.current = currentQuestion
    setTab('whiteboard')
  }, [autoOfferWhiteboard, currentQuestion])


  if (s.status === 'scheduled') return (
    <div className="iv-gate">
      <div className="iv-gate-card">
        <div className="iv-gate-icon">🕒</div>
        <h2>This interview isn't open yet</h2>
        <p>{s.scheduledMsg || 'This interview is scheduled to begin later. Please check back at the scheduled time.'}</p>
      </div>
    </div>
  )

  if (s.status === 'error') return (
    <div className="iv-gate">
      <div className="iv-gate-card iv-gate-danger">
        <div className="iv-gate-icon">✕</div>
        <h2>Session Error</h2>
        <p>{s.errorMsg || 'This interview link is invalid or has already been used.'}</p>
      </div>
    </div>
  )

  if (s.status === 'loading') return (
    <div className="iv-gate">
      <div className="iv-gate-card">
        <div className="iv-gate-spinner" />
        <h2>Preparing your interview</h2>
        <p>One moment while we load your session…</p>
      </div>
    </div>
  )

  if (s.status === 'lobby') return (
    <div className="iv-gate">
      <div className="iv-gate-card iv-lobby">
        <div className="iv-gate-icon">🎙️</div>
        <h2>{s.candidateName ? `Hello ${s.candidateName}` : 'Ready to begin'}</h2>
        <p className="iv-lobby-lead">
          One tap to grant camera and microphone access and enter fullscreen - required by your
          browser to start.
        </p>
        {s.mediaError && <div className="iv-lobby-error">{s.mediaError}</div>}
        <button className="btn-lobby-start" onClick={() => s.grantMediaAndStart()} disabled={s.requestingMedia}>
          {s.requestingMedia ? 'Starting…' : s.mediaError ? 'Retry' : 'Start Interview'}
        </button>
      </div>
    </div>
  )

  if (s.status === 'done') return (
    <div className="iv-gate">
      <div className="iv-gate-card iv-gate-success">
        <div className="iv-gate-icon">✓</div>
        <h2>Interview complete</h2>
        <p>Your responses have been recorded and sent to the hiring team. You may now close this window.</p>
      </div>
    </div>
  )

  if (s.status === 'terminated') return (
    <div className="iv-gate">
      <div className="iv-gate-card iv-gate-danger">
        <div className="iv-gate-icon">✕</div>
        <h2>This interview has been ended</h2>
        <p>
          You navigated away from the interview {MAX_VIOLATIONS} times. Your answers so far have
          been submitted and your recruiter has been notified.
        </p>
      </div>
    </div>
  )


  return (
    <div className="iv-page">
      <header className="iv-header">
        <div className="iv-brand">
          <BrandMark />
          Hirely.ai Interview
        </div>

        <div className="iv-header-right">
          {s.durationSecs > 0 && <div className="iv-timer">{s.formatRemaining()}</div>}
          {s.questions.length > 0 && (
            <div className="iv-progress">
              {Math.min(s.qIndex + 1, s.questions.length)} / {s.questions.length}
            </div>
          )}
          {s.violationCount > 0 && (
            <div className="iv-violations" title="Tab switches recorded">
              ⚠ {s.violationCount} / {MAX_VIOLATIONS}
            </div>
          )}
          <div className="iv-status">
            <span className="iv-status-dot" />
            Live
          </div>
          <button className="btn-end-interview" onClick={s.endInterview}>End Interview</button>
        </div>
      </header>

      <div className="iv-body">
        <main className="iv-main">
          <div className="iv-panel">
            <div className="iv-tabs" role="tablist" aria-label="Interview panels">
              <button
                role="tab" aria-selected={tab === 'notes'}
                className={`iv-tab${tab === 'notes' ? ' iv-tab-active' : ''}`}
                onClick={() => setTab('notes')}
              >
                AI Notes
              </button>
              <button
                role="tab" aria-selected={tab === 'transcript'}
                className={`iv-tab${tab === 'transcript' ? ' iv-tab-active' : ''}`}
                onClick={() => setTab('transcript')}
              >
                Transcript
              </button>
              <button
                role="tab" aria-selected={tab === 'summary'}
                className={`iv-tab${tab === 'summary' ? ' iv-tab-active' : ''}`}
                onClick={() => setTab('summary')}
              >
                Summary
              </button>
              <button
                role="tab" aria-selected={tab === 'code'}
                className={`iv-tab${tab === 'code' ? ' iv-tab-active' : ''}`}
                onClick={() => setTab('code')}
              >
                Code Screening
                {codeReady && coding.status === 'done' && <span className="iv-tab-badge">✓</span>}
              </button>
              <button
                role="tab" aria-selected={tab === 'whiteboard'}
                className={`iv-tab${tab === 'whiteboard' ? ' iv-tab-active' : ''}`}
                onClick={() => setTab('whiteboard')}
              >
                Whiteboard
              </button>
            </div>

            <div className="iv-panel-body">
              {tab === 'notes' && (
                <AiNotesPanel tips={coach.tips} captionsSupported={captions.supported} />
              )}
              {tab === 'transcript' && (
                <LiveTranscript
                  transcript={s.transcript}
                  pendingQuestion={pendingQuestion}
                  interimText={captions.text}
                  draftAnswer={s.draftAnswer}
                  turnPhase={s.turnPhase}
                  candidateName={s.candidateName}
                  startedAt={s.startedAt}
                />
              )}
              {tab === 'summary' && (
                <RecapPanel
                  transcript={s.transcript}
                  totalQuestions={s.questions.length}
                  elapsedLabel={s.formatRemaining()}
                  avgWords={coach.session.avgWords}
                />
              )}
              {tab === 'code' && (
                <div className="iv-code-host">
                  {coding.session ? (
                    <CodingWorkspace
                      session={coding.session}
                      status={coding.status}
                      errorMsg={coding.errorMsg}
                      result={coding.result}
                      onSubmit={coding.submit}
                      runStatus={coding.runStatus}
                      runResult={coding.runResult}
                      runErrorMsg={coding.runErrorMsg}
                      onRun={coding.run}
                      onIntegrityEvent={coding.flag}
                    />
                  ) : (
                    <FreeformCodeEditor onIntegrityEvent={coding.flag} />
                  )}
                </div>
              )}
              {tab === 'whiteboard' && <Whiteboard prompt={currentQuestion} />}
            </div>
          </div>
        </main>

        <aside className="iv-side">
          <SpeakerStage
            participants={participants}
            focusedId={focusedId}
            caption={ccEnabled && s.turnPhase === 'recording' ? captions.text : undefined}
            captionsAvailable={captions.supported}
            captionsEnabled={ccEnabled}
            onToggleCaptions={() => setCcEnabled(v => !v)}
          />

          <TurnControls
            turnPhase={s.turnPhase}
            voiceNotice={s.voiceNotice}
            draftAnswer={s.draftAnswer}
            recordTimeLabel={s.formatRecordTime()}
            maxAnswerMinutes={Math.round(MAX_ANSWER_SECONDS / 60)}
            handsFree={handsFree.active}
            hasSpoken={handsFree.hasSpoken}
            onUseButtons={() => setHandsFreeWanted(false)}
            onRecord={s.startRecording}
            onStop={s.stopRecording}
            onRerecord={() => { s.setDraftAnswer(''); s.setTurnPhase('ready') }}
            onUseAnswer={() => s.advance(s.draftAnswer)}
          />
        </aside>
      </div>

      {s.fullscreenLost && !s.warningOpen && (
        <div className="iv-nag">
          <span>
            You left fullscreen. This has been recorded - please return to fullscreen
            to continue your interview.
          </span>
          <button className="btn-refullscreen" onClick={() => { void enterFullscreen() }}>
            Return to fullscreen
          </button>
        </div>
      )}

      <ProctoringMonitor stream={s.stream} onFlag={s.handleProctoringFlag} headless />

      {s.warningOpen && (
        <div className="modal-overlay iv-warning-overlay">
          <div className="modal-box iv-warning-box">
            <div className="iv-warning-icon">⚠️</div>
            <h2>Please stay on this tab</h2>
            <p>
              You navigated away from the interview. This has been recorded and shared with
              your recruiter.
            </p>
            <p className="iv-warning-count">
              Warning <strong>{s.violationCount}</strong> of {MAX_VIOLATIONS}
            </p>
            <p className="iv-warning-consequence">
              Your interview will be submitted automatically and ended if you navigate away
              {' '}{MAX_VIOLATIONS - s.violationCount === 1
                ? 'one more time'
                : `${MAX_VIOLATIONS - s.violationCount} more times`}.
              The clock keeps running while this message is shown.
            </p>
            <button className="btn-resume" onClick={() => s.setWarningOpen(false)}>
              Resume interview
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
