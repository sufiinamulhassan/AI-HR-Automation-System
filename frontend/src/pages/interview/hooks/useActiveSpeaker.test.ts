import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useActiveSpeaker, type ActiveSpeakerInput } from './useActiveSpeaker'


const LOUD = 0.3
const QUIET = 0

function inputs(ai: boolean, me: number): ActiveSpeakerInput[] {
  return [{ id: 'ai', level: 0, priority: ai }, { id: 'me', level: me }]
}

function advance(ms: number) {
  act(() => { vi.advanceTimersByTime(ms) })
}

describe('useActiveSpeaker', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('gives the interviewer the stage immediately while it is speaking', () => {
    const { result } = renderHook(() => useActiveSpeaker(inputs(true, QUIET), 'ai'))
    advance(150)
    expect(result.current).toBe('ai')
  })

  it('does not hand the stage to a brief noise', () => {
    const { result, rerender } = renderHook(
      ({ i }: { i: ActiveSpeakerInput[] }) => useActiveSpeaker(i, 'ai'),
      { initialProps: { i: inputs(false, QUIET) } },
    )
    advance(200)
    expect(result.current).toBe('ai')

    rerender({ i: inputs(false, LOUD) })
    advance(150)
    rerender({ i: inputs(false, QUIET) })
    advance(150)

    expect(result.current).toBe('ai')
  })

  it('switches to the candidate once they are genuinely speaking', () => {
    const { result, rerender } = renderHook(
      ({ i }: { i: ActiveSpeakerInput[] }) => useActiveSpeaker(i, 'ai'),
      { initialProps: { i: inputs(false, QUIET) } },
    )
    advance(200)

    rerender({ i: inputs(false, LOUD) })
    advance(500)

    expect(result.current).toBe('me')
  })

  it('holds the stage through a breath rather than flickering back', () => {
    const { result, rerender } = renderHook(
      ({ i }: { i: ActiveSpeakerInput[] }) => useActiveSpeaker(i, 'ai'),
      { initialProps: { i: inputs(false, LOUD) } },
    )
    advance(500)
    expect(result.current).toBe('me')

    rerender({ i: inputs(false, QUIET) })
    advance(400)
    expect(result.current).toBe('me')

    rerender({ i: inputs(false, LOUD) })
    advance(200)
    expect(result.current).toBe('me')
  })

  it('falls back once the candidate has really stopped', () => {
    const { result, rerender } = renderHook(
      ({ i }: { i: ActiveSpeakerInput[] }) => useActiveSpeaker(i, 'ai'),
      { initialProps: { i: inputs(false, LOUD) } },
    )
    advance(500)
    expect(result.current).toBe('me')

    rerender({ i: inputs(false, QUIET) })
    advance(1200)

    expect(result.current).toBe('ai')
  })

  it('lets the interviewer interrupt without waiting out the fuse', () => {
    const { result, rerender } = renderHook(
      ({ i }: { i: ActiveSpeakerInput[] }) => useActiveSpeaker(i, 'ai'),
      { initialProps: { i: inputs(false, LOUD) } },
    )
    advance(500)
    expect(result.current).toBe('me')

    rerender({ i: inputs(true, LOUD) })
    advance(150)

    expect(result.current).toBe('ai')
  })
})
