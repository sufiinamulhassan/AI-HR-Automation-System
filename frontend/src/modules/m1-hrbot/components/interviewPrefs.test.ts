import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadInterviewPrefs, nextBusinessDayAtTen, saveInterviewPrefs } from './interviewPrefs'
import { readStored, readStoredJson, removeStored, writeStored, writeStoredJson } from './safeStorage'

const KEY = 'hr-bot.interview-setup:ada@x.com'

beforeEach(() => { window.localStorage.clear() })
afterEach(() => { vi.restoreAllMocks() })

describe('nextBusinessDayAtTen', () => {
  it.each([
    ['Monday', new Date(2026, 9, 5, 9, 0), 1, '2026-10-06T10:00'],
    ['Tuesday late in the day', new Date(2026, 9, 6, 23, 59), 2, '2026-10-07T10:00'],
    ['Thursday', new Date(2026, 9, 8, 15, 30), 4, '2026-10-09T10:00'],
    ['Friday', new Date(2026, 9, 9, 8, 0), 5, '2026-10-12T10:00'],
    ['Saturday', new Date(2026, 9, 10, 12, 0), 6, '2026-10-12T10:00'],
    ['Sunday', new Date(2026, 9, 11, 12, 0), 0, '2026-10-12T10:00'],
  ])('%s gives %s', (_name, now, weekday, expected) => {
    expect(now.getDay()).toBe(weekday)
    expect(nextBusinessDayAtTen(now)).toBe(expected)
  })

  it('crosses a month and a year end', () => {
    expect(nextBusinessDayAtTen(new Date(2026, 9, 30, 12, 0))).toBe('2026-11-02T10:00')
    expect(nextBusinessDayAtTen(new Date(2026, 11, 31, 12, 0))).toBe('2027-01-01T10:00')
  })

  it('crosses a clock change without moving the hour', () => {
    for (const now of [new Date(2026, 2, 27, 12, 0), new Date(2026, 9, 23, 12, 0), new Date(2026, 10, 1, 12, 0)]) {
      expect(nextBusinessDayAtTen(now)).toMatch(/T10:00$/)
    }
  })

  it('uses the current time when none is given', () => {
    expect(nextBusinessDayAtTen()).toMatch(/^\d{4}-\d{2}-\d{2}T10:00$/)
  })
})

describe('loadInterviewPrefs and saveInterviewPrefs', () => {
  it('round-trips what was saved, for the person who saved it', () => {
    saveInterviewPrefs('ada@x.com', { platform: 'other', duration: '30', label: 'Webex' })
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? 'null')).toEqual({ platform: 'other', duration: '30', label: 'Webex' })
    expect(loadInterviewPrefs('ada@x.com')).toEqual({ platform: 'other', duration: '30', label: 'Webex' })
    expect(loadInterviewPrefs('grace@x.com')).toEqual({})
  })

  it('does not tell people apart by the case of their address', () => {
    saveInterviewPrefs('Ada@X.com', { platform: 'teams', duration: '60', label: '' })
    expect(loadInterviewPrefs('ada@x.COM')).toMatchObject({ platform: 'teams', duration: '60' })
  })

  it('keeps the platform name already stored when a later save has none', () => {
    saveInterviewPrefs('ada@x.com', { platform: 'other', duration: '30', label: 'Webex' })
    saveInterviewPrefs('ada@x.com', { platform: 'zoom', duration: '45', label: '  ' })
    expect(loadInterviewPrefs('ada@x.com')).toEqual({ platform: 'zoom', duration: '45', label: 'Webex' })
    saveInterviewPrefs('ada@x.com', { platform: 'other', duration: '45', label: 'Whereby' })
    expect(loadInterviewPrefs('ada@x.com').label).toBe('Whereby')
  })

  it('does nothing without a person to keep it for', () => {
    saveInterviewPrefs(undefined, { platform: 'zoom', duration: '45', label: '' })
    saveInterviewPrefs('  ', { platform: 'zoom', duration: '45', label: '' })
    expect(window.localStorage.length).toBe(0)
    expect(loadInterviewPrefs(undefined)).toEqual({})
    expect(loadInterviewPrefs(null)).toEqual({})
  })

  it.each([
    ['an unknown platform', { platform: 'skype' }, {}],
    ['a length under five minutes', { duration: '4' }, {}],
    ['a length over eight hours', { duration: '481' }, {}],
    ['a length that is not whole', { duration: '45.5' }, {}],
    ['an empty length', { duration: '' }, {}],
    ['a length that is a number', { duration: 45 }, {}],
    ['a platform name over forty characters', { label: 'x'.repeat(41) }, {}],
    ['a platform name of the wrong kind', { label: 7 }, {}],
    ['a good value beside a bad one', { platform: 'meet', duration: '999' }, { platform: 'meet' }],
  ])('drops %s and keeps whatever is still good', (_what, stored, expected) => {
    window.localStorage.setItem(KEY, JSON.stringify(stored))
    expect(loadInterviewPrefs('ada@x.com')).toEqual(expected)
  })

  it('treats text that is not JSON, or JSON that is not an object, as nothing stored', () => {
    for (const text of ['not json', 'null', '5', '"zoom"']) {
      window.localStorage.setItem(KEY, text)
      expect(loadInterviewPrefs('ada@x.com')).toEqual({})
    }
  })

  it('does not throw when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(() => saveInterviewPrefs('ada@x.com', { platform: 'zoom', duration: '45', label: '' })).not.toThrow()
    expect(loadInterviewPrefs('ada@x.com')).toEqual({})
  })
})

describe('safeStorage', () => {
  it('reads, writes and removes', () => {
    expect(readStored('k')).toBeNull()
    expect(writeStored('k', 'v')).toBe(true)
    expect(readStored('k')).toBe('v')
    removeStored('k')
    expect(readStored('k')).toBeNull()
  })

  it('reads and writes JSON, and answers null for text that is not', () => {
    expect(writeStoredJson('j', { a: 1 })).toBe(true)
    expect(readStoredJson('j')).toEqual({ a: 1 })
    window.localStorage.setItem('j', '{broken')
    expect(readStoredJson('j')).toBeNull()
    expect(readStoredJson('missing')).toBeNull()
  })

  it('says false instead of throwing when a value cannot be stored', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(writeStoredJson('c', circular)).toBe(false)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(writeStored('k', 'v')).toBe(false)
    expect(writeStoredJson('k', { a: 1 })).toBe(false)
  })

  it('never throws when every call is refused', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked') })
    expect(readStored('k')).toBeNull()
    expect(readStoredJson('k')).toBeNull()
    expect(writeStored('k', 'v')).toBe(false)
    expect(() => removeStored('k')).not.toThrow()
  })
})
