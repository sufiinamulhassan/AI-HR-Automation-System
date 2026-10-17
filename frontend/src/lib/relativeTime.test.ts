import { describe, expect, it } from 'vitest'
import { relativeTime } from './relativeTime'

const NOW = Date.parse('2026-10-08T12:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

describe('relativeTime', () => {
  it('reads a moment under a minute old as just now', () => {
    expect(relativeTime(ago(5_000), NOW)).toBe('just now')
  })

  it('treats a timestamp slightly in the future as just now', () => {
    expect(relativeTime(ago(-10_000), NOW)).toBe('just now')
  })

  it('counts minutes, hours and days', () => {
    expect(relativeTime(ago(5 * MIN), NOW)).toBe('5 min ago')
    expect(relativeTime(ago(3 * HOUR), NOW)).toBe('3 h ago')
    expect(relativeTime(ago(2 * DAY), NOW)).toBe('2 d ago')
  })

  it('falls back to a date once the moment is over a month old', () => {
    expect(relativeTime(ago(45 * DAY), NOW)).toBe(new Date(NOW - 45 * DAY).toLocaleDateString())
  })

  it('returns the empty-value placeholder for a missing or bad value', () => {
    expect(relativeTime(null, NOW)).toBe('-')
    expect(relativeTime(undefined, NOW)).toBe('-')
    expect(relativeTime('not a date', NOW)).toBe('-')
  })
})
