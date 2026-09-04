import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useHandsFreeTurn } from './useHandsFreeTurn'
import type { TurnPhase } from '../useInterviewSession'


const SILENT = 0
const ROOM_TONE = 0.008
const TALKING = 0.2

interface Props { turnPhase: TurnPhase; enabled?: boolean; readyToken?: number }

function setup(initial: Props) {
  const levelRef = { current: SILENT }
  const startRecording = vi.fn()
  const stopRecording = vi.fn()

  const view = renderHook(
    ({ turnPhase, enabled = true, readyToken = 0 }: Props) => useHandsFreeTurn({
      enabled,
      levelRef,
      status: 'active',
      turnPhase,
      readyToken,
      startRecording,
      stopRecording,
    }),
    { initialProps: initial },
  )

  return { view, levelRef, startRecording, stopRecording }
}

function advance(ms: number) {
  act(() => { vi.advanceTimersByTime(ms) })
}

function speakFor(levelRef: { current: number }, level: number, ms: number) {
  levelRef.current = level
  advance(ms)
}

describe('useHandsFreeTurn', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('opens the microphone by itself once the question has been read', () => {
    const { startRecording } = setup({ turnPhase: 'ready' })

    expect(startRecording).not.toHaveBeenCalled()
    advance(600)

    expect(startRecording).toHaveBeenCalledTimes(1)
  })

  it('does not open the microphone while the question is still playing', () => {
    const { startRecording } = setup({ turnPhase: 'speaking' })
    advance(2000)
    expect(startRecording).not.toHaveBeenCalled()
  })

  it('waits indefinitely for a first word rather than ending an empty turn early', () => {
    const { levelRef, stopRecording } = setup({ turnPhase: 'recording' })

    speakFor(levelRef, ROOM_TONE, 10_000)

    expect(stopRecording).not.toHaveBeenCalled()
  })

  it('ends the turn once the candidate stops speaking', () => {
    const { view, levelRef, stopRecording } = setup({ turnPhase: 'recording' })

    speakFor(levelRef, TALKING, 1500)
    expect(view.result.current.hasSpoken).toBe(true)

    speakFor(levelRef, SILENT, 2500)

    expect(stopRecording).toHaveBeenCalledTimes(1)
  })

  it('treats a pause for thought as part of the answer, not the end of it', () => {
    const { levelRef, stopRecording } = setup({ turnPhase: 'recording' })

    speakFor(levelRef, TALKING, 1000)
    speakFor(levelRef, SILENT, 1500)
    expect(stopRecording).not.toHaveBeenCalled()

    speakFor(levelRef, TALKING, 1000)
    speakFor(levelRef, SILENT, 1500)

    expect(stopRecording).not.toHaveBeenCalled()
  })

  it('gives up waiting if the candidate never says anything', () => {
    const { levelRef, stopRecording } = setup({ turnPhase: 'recording' })

    speakFor(levelRef, SILENT, 21_000)

    expect(stopRecording).toHaveBeenCalledTimes(1)
  })

  it('falls back to manual control after repeated silent turns', () => {
    const { view, levelRef, stopRecording } = setup({ turnPhase: 'recording' })

    speakFor(levelRef, SILENT, 21_000)
    expect(view.result.current.degraded).toBe(false)

    view.rerender({ turnPhase: 'ready' })
    view.rerender({ turnPhase: 'recording' })
    speakFor(levelRef, SILENT, 21_000)

    expect(view.result.current.degraded).toBe(true)
    expect(view.result.current.active).toBe(false)

    stopRecording.mockClear()
    view.rerender({ turnPhase: 'recording' })
    speakFor(levelRef, SILENT, 30_000)
    expect(stopRecording).not.toHaveBeenCalled()
  })

  it('a successful turn clears the silent-turn count', () => {
    const { view, levelRef } = setup({ turnPhase: 'recording' })

    speakFor(levelRef, SILENT, 21_000)
    view.rerender({ turnPhase: 'ready' })
    view.rerender({ turnPhase: 'recording' })
    speakFor(levelRef, TALKING, 1000)
    speakFor(levelRef, SILENT, 2500)
    view.rerender({ turnPhase: 'ready' })
    view.rerender({ turnPhase: 'recording' })
    speakFor(levelRef, SILENT, 21_000)

    expect(view.result.current.degraded).toBe(false)
  })

  it('stays out of the way entirely when disabled', () => {
    const { levelRef, startRecording, stopRecording } = setup({ turnPhase: 'ready', enabled: false })

    advance(1000)
    expect(startRecording).not.toHaveBeenCalled()

    speakFor(levelRef, TALKING, 1000)
    speakFor(levelRef, SILENT, 5000)
    expect(stopRecording).not.toHaveBeenCalled()
  })

  it('re-arms the microphone when readyToken changes even if turnPhase stays "ready"', () => {
    const { view, startRecording } = setup({ turnPhase: 'ready', readyToken: 0 })
    advance(600)
    expect(startRecording).toHaveBeenCalledTimes(1)

    view.rerender({ turnPhase: 'ready', readyToken: 1 })
    advance(600)
    expect(startRecording).toHaveBeenCalledTimes(2)
  })

  it('does not mistake room tone for speech', () => {
    const { view, levelRef } = setup({ turnPhase: 'recording' })

    speakFor(levelRef, ROOM_TONE, 3000)

    expect(view.result.current.hasSpoken).toBe(false)
  })
})
