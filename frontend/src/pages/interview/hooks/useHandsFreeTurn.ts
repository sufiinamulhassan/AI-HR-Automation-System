import { useEffect, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { SILENCE_FLOOR } from './useAudioLevel'
import type { Status, TurnPhase } from '../useInterviewSession'


const ARM_DELAY_MS = 450
const SPEECH_ON = 0.024
const SPEECH_OFF = SILENCE_FLOOR
const END_OF_SPEECH_MS = 2200
const NO_SPEECH_MS = 20_000
const MAX_SILENT_TURNS = 2
const TICK_MS = 100

interface Args {
  enabled: boolean
  levelRef: MutableRefObject<number>
  status: Status
  turnPhase: TurnPhase
  readyToken: number
  startRecording: () => void
  stopRecording: () => void
}

export function useHandsFreeTurn({ enabled, levelRef, status, turnPhase, readyToken, startRecording, stopRecording }: Args) {
  const [hasSpoken, setHasSpoken] = useState(false)
  const [degraded, setDegraded] = useState(false)

  const silentTurnsRef = useRef(0)
  const startRef = useRef(startRecording)
  startRef.current = startRecording
  const stopRef = useRef(stopRecording)
  stopRef.current = stopRecording

  const active = enabled && !degraded && status === 'active'

  useEffect(() => {
    if (!active || turnPhase !== 'ready') return
    const timer = setTimeout(() => startRef.current(), ARM_DELAY_MS)
    return () => clearTimeout(timer)
  }, [active, turnPhase, readyToken])

  useEffect(() => {
    if (!active || turnPhase !== 'recording') return

    setHasSpoken(false)
    const armedAt = Date.now()
    let spoke = false
    let lastVoiceAt = armedAt
    let ended = false

    const timer = setInterval(() => {
      if (ended) return
      const level = levelRef.current
      const now = Date.now()

      if (!spoke) {
        if (level >= SPEECH_ON) {
          spoke = true
          lastVoiceAt = now
          setHasSpoken(true)
        } else if (now - armedAt >= NO_SPEECH_MS) {
          ended = true
          silentTurnsRef.current += 1
          if (silentTurnsRef.current >= MAX_SILENT_TURNS) setDegraded(true)
          stopRef.current()
        }
        return
      }

      if (level >= SPEECH_OFF) {
        lastVoiceAt = now
        return
      }
      if (now - lastVoiceAt >= END_OF_SPEECH_MS) {
        ended = true
        silentTurnsRef.current = 0
        stopRef.current()
      }
    }, TICK_MS)

    return () => clearInterval(timer)
  }, [active, turnPhase, levelRef])

  return {
    active,
    hasSpoken,
    degraded,
    disable: () => setDegraded(true),
  }
}
