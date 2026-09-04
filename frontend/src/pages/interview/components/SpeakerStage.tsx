import { useEffect, useMemo, useRef } from 'react'
import AiAvatar from './AiAvatar'
import './SpeakerStage.css'

export interface StageParticipant {
  id: string
  name: string
  kind: 'ai' | 'candidate' | 'guest'
  stream?: MediaStream | null
  level: number
  speaking: boolean
  sublabel?: string
}

interface Props {
  participants: StageParticipant[]
  focusedId: string | null
  compact?: boolean
  caption?: string
  captionsAvailable?: boolean
  captionsEnabled?: boolean
  onToggleCaptions?: () => void
}

function VideoTile({ stream }: { stream?: MediaStream | null }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (el.srcObject !== (stream ?? null)) el.srcObject = stream ?? null
  }, [stream])
  return <video ref={ref} className="tile-video" autoPlay playsInline muted />
}

export default function SpeakerStage({
  participants,
  focusedId,
  compact = false,
  caption,
  captionsAvailable = false,
  captionsEnabled = false,
  onToggleCaptions,
}: Props) {
  const onStage = useMemo(
    () => participants.find(p => p.id === focusedId) ?? participants[0] ?? null,
    [participants, focusedId]
  )

  const strip = participants.filter(p => p.id !== onStage?.id)

  return (
    <div className={`speaker-stage${compact ? ' speaker-stage-compact' : ''}`}>
      <div className="stage-well">
        {participants.map(p => {
          const isOnStage = p.id === onStage?.id
          const stripIndex = strip.findIndex(s => s.id === p.id)
          return (
            <div
              key={p.id}
              className={[
                'stage-tile',
                isOnStage ? 'stage-tile-focused' : 'stage-tile-strip',
                p.speaking ? 'stage-tile-speaking' : '',
              ].filter(Boolean).join(' ')}
              style={stripIndex >= 0 ? ({ ['--strip-i' as string]: stripIndex }) : undefined}
            >
              <div className="tile-media">
                {p.kind === 'ai'
                  ? <AiAvatar speaking={p.speaking} size={isOnStage ? 'lg' : 'sm'} />
                  : p.stream
                    ? <VideoTile stream={p.stream} />
                    : <div className="tile-initials">{p.name.slice(0, 1).toUpperCase() || '?'}</div>}
              </div>

              <span
                className="tile-ring"
                style={{ opacity: p.speaking ? Math.min(1, 0.35 + p.level * 6) : 0 }}
              />

              <div className="tile-footer">
                <span className="tile-name">{p.name}</span>
                {p.speaking && (
                  <span className="tile-bars" aria-label="speaking">
                    <i style={{ transform: `scaleY(${1 + Math.min(2.2, p.level * 14)})` }} />
                    <i style={{ transform: `scaleY(${1 + Math.min(2.6, p.level * 20)})` }} />
                    <i style={{ transform: `scaleY(${1 + Math.min(2.2, p.level * 11)})` }} />
                  </span>
                )}
              </div>

              {isOnStage && p.sublabel && <div className="tile-sublabel">{p.sublabel}</div>}
            </div>
          )
        })}

        {caption && !compact && (
          <div className="stage-caption" role="status" aria-live="polite">{caption}</div>
        )}

        {captionsAvailable && !compact && (
          <button
            type="button"
            className="stage-cc-toggle"
            aria-pressed={captionsEnabled}
            aria-label={captionsEnabled ? 'Turn off captions' : 'Turn on captions'}
            title={captionsEnabled ? 'Turn off captions' : 'Turn on captions'}
            onClick={onToggleCaptions}
          >
            CC
          </button>
        )}
      </div>
    </div>
  )
}
