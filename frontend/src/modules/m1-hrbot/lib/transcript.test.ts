import { describe, expect, it } from 'vitest'
import { toTurns } from './transcript'


const REAL = [
  {
    question: 'Tell me about your Python experience.',
    answer: 'Seven years, mostly FastAPI and asyncio services.',
    answered_at: '2026-06-06T15:01:30Z',
  },
  {
    question: 'Describe a hard bug you fixed.',
    answer: 'A connection-pool leak that only surfaced after an hour under load.',
    answered_at: '2026-06-06T15:04:10Z',
  },
]

const CHAT = [
  { role: 'agent', content: 'Tell me about your Python experience.', timestamp: '2026-06-06T15:01:00Z' },
  { role: 'candidate', content: 'Seven years, mostly FastAPI.', timestamp: '2026-06-06T15:01:30Z' },
]

describe('toTurns', () => {
  it('renders the shape the live interview actually stores', () => {
    const turns = toTurns(REAL)

    expect(turns).toHaveLength(4)
    expect(turns[0]).toMatchObject({ role: 'agent', content: 'Tell me about your Python experience.' })
    expect(turns[1]).toMatchObject({
      role: 'candidate',
      content: 'Seven years, mostly FastAPI and asyncio services.',
    })
    expect(turns.every(t => t.content.length > 0)).toBe(true)
  })

  it('carries the answered_at timestamp onto both turns of a pair', () => {
    const turns = toTurns([REAL[0]])
    expect(turns[0].timestamp).toBe('2026-06-06T15:01:30Z')
    expect(turns[1].timestamp).toBe('2026-06-06T15:01:30Z')
  })

  it('still renders the chat-message shape', () => {
    const turns = toTurns(CHAT)
    expect(turns).toHaveLength(2)
    expect(turns[0]).toMatchObject({ role: 'agent', content: 'Tell me about your Python experience.' })
    expect(turns[1].timestamp).toBe('2026-06-06T15:01:30Z')
  })

  it('handles a mixture of both shapes', () => {
    const turns = toTurns([REAL[0], ...CHAT])
    expect(turns).toHaveLength(4)
    expect(turns.map(t => t.content)).toContain('Seven years, mostly FastAPI and asyncio services.')
    expect(turns.map(t => t.content)).toContain('Seven years, mostly FastAPI.')
  })

  it('drops entries that carry neither shape rather than rendering blank rows', () => {
    const turns = toTurns([
      REAL[0],
      {},
      { answered_at: '2026-06-06T15:00:00Z' },
      { role: 'agent' },
      null as never,
    ])
    expect(turns).toHaveLength(2)
    expect(turns.every(t => t.content.length > 0)).toBe(true)
  })

  it('emits only the half that is present when a pair is incomplete', () => {
    expect(toTurns([{ question: 'Only a question was recorded.' }])).toEqual([
      { role: 'agent', content: 'Only a question was recorded.', timestamp: undefined },
    ])
    expect(toTurns([{ answer: 'Only an answer was recorded.' }])).toEqual([
      { role: 'candidate', content: 'Only an answer was recorded.', timestamp: undefined },
    ])
  })

  it('tolerates empty, undefined and null input', () => {
    expect(toTurns([])).toEqual([])
    expect(toTurns(undefined)).toEqual([])
    expect(toTurns(null)).toEqual([])
  })
})
