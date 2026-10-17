import { describe, expect, it } from 'vitest'
import { costBreakdownTiles, fmtAsOf, fmtMb, fmtStorage } from './format'

describe('fmtMb', () => {
  it('writes megabytes with a thousands separator and at most one decimal', () => {
    expect(fmtMb(12.5)).toBe('12.5 MB')
    expect(fmtMb(1200)).toBe('1,200 MB')
    expect(fmtMb(0)).toBe('0 MB')
    expect(fmtMb(120.46)).toBe('120.5 MB')
  })

  it('is a dash for a figure it does not have', () => {
    expect(fmtMb(null)).toBe('-')
    expect(fmtMb(undefined)).toBe('-')
  })
})

describe('fmtStorage', () => {
  it('is used against the cap', () => {
    expect(fmtStorage(120.5, 2000)).toBe('120.5 / 2,000 MB')
  })

  it('is just the amount where nothing caps it', () => {
    expect(fmtStorage(120, null)).toBe('120 MB')
    expect(fmtStorage(120, undefined)).toBe('120 MB')
  })

  it('is a dash where the usage is not known, whatever the cap', () => {
    expect(fmtStorage(null, 2000)).toBe('-')
    expect(fmtStorage(undefined, null)).toBe('-')
  })

  it('keeps a cap of nothing, since zero is a cap', () => {
    expect(fmtStorage(0, 0)).toBe('0 / 0 MB')
  })
})

describe('fmtAsOf', () => {
  const now = new Date(2026, 9, 12, 15, 30)

  it('is the time of day for something worked out today', () => {
    const at = new Date(2026, 9, 12, 14, 2).toISOString()
    expect(fmtAsOf(at, now)).toBe(new Date(2026, 9, 12, 14, 2).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }))
  })

  it('adds the day for something older', () => {
    const at = new Date(2026, 9, 10, 14, 2).toISOString()
    const time = new Date(2026, 9, 10, 14, 2).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    expect(fmtAsOf(at, now)).toBe(`${new Date(2026, 9, 10).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${time}`)
  })

  it('is nothing for no stamp, or for one that is not a date, so no As of is printed', () => {
    expect(fmtAsOf(undefined, now)).toBe('')
    expect(fmtAsOf(null, now)).toBe('')
    expect(fmtAsOf('', now)).toBe('')
    expect(fmtAsOf('yesterday', now)).toBe('')
  })
})

describe('costBreakdownTiles', () => {
  it('splits a total cost into the AI spend and the email estimate, in the money format', () => {
    expect(costBreakdownTiles({ ai_cost_usd: 0.333, email_cost_usd: 0.0009 })).toEqual([
      ['AI spend', '$0.3330'],
      ['Email (estimated)', '$0.0009'],
    ])
  })

  it('writes no email as zero dollars', () => {
    expect(costBreakdownTiles({ ai_cost_usd: 1.5, email_cost_usd: 0 })).toEqual([['AI spend', '$1.50'], ['Email (estimated)', '$0.00']])
  })
})
