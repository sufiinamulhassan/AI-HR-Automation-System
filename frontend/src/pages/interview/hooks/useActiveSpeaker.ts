import { useEffect, useRef, useState } from 'react'
import { SILENCE_FLOOR } from './useAudioLevel'

export interface ActiveSpeakerInput {
  id: string
  level: number
  priority?: boolean
}

const GRAB_MS = 300
const RELEASE_MS = 900
const TICK_MS = 100

export function useActiveSpeaker(inputs: ActiveSpeakerInput[], fallbackId: string | null = null) {
  const [focusedId, setFocusedId] = useState<string | null>(fallbackId)

  const inputsRef = useRef(inputs)
  inputsRef.current = inputs
  const fallbackRef = useRef(fallbackId)
  fallbackRef.current = fallbackId

  const focusedRef = useRef<string | null>(fallbackId)
  const challengerRef = useRef<{ id: string; since: number } | null>(null)
  const quietSinceRef = useRef<number | null>(null)

  useEffect(() => {
    const commit = (id: string | null) => {
      if (focusedRef.current === id) return
      focusedRef.current = id
      challengerRef.current = null
      quietSinceRef.current = null
      setFocusedId(id)
    }

    const timer = setInterval(() => {
      const list = inputsRef.current
      if (list.length === 0) return
      const now = Date.now()

      const priority = list.find(p => p.priority)
      if (priority) {
        commit(priority.id)
        return
      }

      let loudest: ActiveSpeakerInput | null = null
      for (const p of list) {
        if (p.level < SILENCE_FLOOR) continue
        if (!loudest || p.level > loudest.level) loudest = p
      }

      const current = focusedRef.current
      const currentInput = list.find(p => p.id === current) ?? null

      if (!loudest) {
        if (quietSinceRef.current === null) quietSinceRef.current = now
        else if (now - quietSinceRef.current >= RELEASE_MS) {
          const fb = fallbackRef.current
          if (fb && list.some(p => p.id === fb)) commit(fb)
        }
        challengerRef.current = null
        return
      }

      quietSinceRef.current = null

      if (loudest.id === current) {
        challengerRef.current = null
        return
      }

      if (currentInput && currentInput.level >= SILENCE_FLOOR) {
        challengerRef.current = null
        return
      }

      const challenger = challengerRef.current
      if (!challenger || challenger.id !== loudest.id) {
        challengerRef.current = { id: loudest.id, since: now }
        return
      }
      if (now - challenger.since >= GRAB_MS) commit(loudest.id)
    }, TICK_MS)

    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (focusedId && !inputs.some(p => p.id === focusedId)) {
      focusedRef.current = fallbackId
      setFocusedId(fallbackId)
    }
  }, [inputs, focusedId, fallbackId])

  return focusedId
}
