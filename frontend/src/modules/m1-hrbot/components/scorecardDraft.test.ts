import { beforeEach, describe, expect, it } from 'vitest'
import {
  DRAFT_TTL_MS, SCORECARD_LIMITS, clearScorecardDraft, loadScorecardDraft, saveScorecardDraft, scorecardDraftKey,
  type ScorecardDraft,
} from './scorecardDraft'

const KEY = 'hr-bot.scorecard-draft:test'
const DRAFT: ScorecardDraft = {
  name: 'Priya Nair',
  role: 'engineer',
  marks: { q1: { rating: 4, notes: 'Knew hot keys' }, q2: { rating: null, notes: '' } },
  ratings: { technical: 5, confidence: 3 },
  recommendation: 'hire',
  summary: 'Clear thinker, explained trade-offs well.',
  strengths: 'Systems depth',
  concerns: '',
}

beforeEach(() => { window.localStorage.clear() })

describe('scorecardDraftKey', () => {
  it('names the scope and the id', () => {
    expect(scorecardDraftKey('link', 'tok_abc')).toBe('hr-bot.scorecard-draft:link:tok_abc')
    expect(scorecardDraftKey('candidate', 'cand_1')).toBe('hr-bot.scorecard-draft:candidate:cand_1')
  })

  it('keeps HR\'s drafts apart by signed-in user, whatever the case of the address', () => {
    const sam = scorecardDraftKey('candidate', 'cand_1', 'Sam@X.com')
    expect(sam).toBe('hr-bot.scorecard-draft:candidate:sam@x.com:cand_1')
    expect(scorecardDraftKey('candidate', 'cand_1', 'grace@x.com')).not.toBe(sam)
    expect(scorecardDraftKey('candidate', 'cand_2', 'sam@x.com')).not.toBe(sam)
  })

  it('does not add a user to a link\'s key: the link is the only identity there', () => {
    expect(scorecardDraftKey('link', 'tok_abc', 'sam@x.com')).toBe('hr-bot.scorecard-draft:link:tok_abc')
  })

  it('ignores a blank user', () => {
    expect(scorecardDraftKey('candidate', 'cand_1', '  ')).toBe('hr-bot.scorecard-draft:candidate:cand_1')
    expect(scorecardDraftKey('candidate', 'cand_1', null)).toBe('hr-bot.scorecard-draft:candidate:cand_1')
  })
})

describe('saveScorecardDraft and loadScorecardDraft', () => {
  it('round-trips a draft', () => {
    saveScorecardDraft(KEY, DRAFT)
    expect(loadScorecardDraft(KEY)).toEqual(DRAFT)
  })

  it('stamps the time it was saved at', () => {
    saveScorecardDraft(KEY, DRAFT, 1234)
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? 'null')).toMatchObject({ v: 1, savedAt: 1234, name: 'Priya Nair' })
  })

  it('answers null when nothing is stored', () => {
    expect(loadScorecardDraft(KEY)).toBeNull()
  })

  it('drops a draft older than the limit, and removes it', () => {
    saveScorecardDraft(KEY, DRAFT, 1000)
    expect(loadScorecardDraft(KEY, 1000 + DRAFT_TTL_MS)).toEqual(DRAFT)
    expect(loadScorecardDraft(KEY, 1000 + DRAFT_TTL_MS + 1)).toBeNull()
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })

  it('cuts text that is longer than the form allows', () => {
    window.localStorage.setItem(KEY, JSON.stringify({
      savedAt: Date.now(), name: 'n'.repeat(1000), summary: 's'.repeat(9000), strengths: 'a'.repeat(5000), concerns: 'c'.repeat(5000),
      marks: { q1: { rating: 3, notes: 'x'.repeat(5000) } },
    }))
    const draft = loadScorecardDraft(KEY)
    expect(draft?.name).toHaveLength(SCORECARD_LIMITS.name)
    expect(draft?.summary).toHaveLength(SCORECARD_LIMITS.summary)
    expect(draft?.strengths).toHaveLength(SCORECARD_LIMITS.detail)
    expect(draft?.concerns).toHaveLength(SCORECARD_LIMITS.detail)
    expect(draft?.marks.q1.notes).toHaveLength(SCORECARD_LIMITS.notes)
  })

  it('keeps no more marks than a guide could have', () => {
    const marks = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`q${i}`, { rating: 3, notes: '' }]))
    window.localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now(), marks }))
    expect(Object.keys(loadScorecardDraft(KEY)?.marks ?? {})).toHaveLength(200)
  })

  it('accepts only whole ratings from 1 to 5, as a mark and as an area', () => {
    window.localStorage.setItem(KEY, JSON.stringify({
      savedAt: Date.now(),
      marks: { a: { rating: 0 }, b: { rating: 6 }, c: { rating: 2.5 }, d: { rating: '3' }, e: { rating: 5 } },
      ratings: { technical: 0, communication: 6, problem_solving: 1.5, cultural_fit: '4', confidence: 5 },
    }))
    const draft = loadScorecardDraft(KEY)
    expect(Object.fromEntries(Object.entries(draft?.marks ?? {}).map(([id, m]) => [id, m.rating]))).toEqual({ a: null, b: null, c: null, d: null, e: 5 })
    expect(draft?.ratings).toEqual({ confidence: 5 })
  })

  it('accepts only the roles and recommendations the form offers', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now(), role: 'ceo', recommendation: 'maybe' }))
    expect(loadScorecardDraft(KEY)).toMatchObject({ role: '', recommendation: '' })
    window.localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now(), role: 'hiring_manager', recommendation: 'no_hire' }))
    expect(loadScorecardDraft(KEY)).toMatchObject({ role: 'hiring_manager', recommendation: 'no_hire' })
  })

  it('skips a mark that is not an object, and ignores marks that are not an object', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now(), marks: { a: 'x', b: null, c: 4, d: { rating: 2, notes: 'ok' } } }))
    expect(loadScorecardDraft(KEY)?.marks).toEqual({ d: { rating: 2, notes: 'ok' } })
    window.localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now(), marks: 'junk', ratings: [1, 2] }))
    expect(loadScorecardDraft(KEY)).toMatchObject({ marks: {}, ratings: {} })
  })

  it.each(['{broken', '5', '"text"', 'null', 'true'])('answers null for stored %s', stored => {
    window.localStorage.setItem(KEY, stored)
    expect(loadScorecardDraft(KEY)).toBeNull()
  })
})

describe('clearScorecardDraft', () => {
  it('removes a draft and tolerates nothing to remove', () => {
    saveScorecardDraft(KEY, DRAFT)
    clearScorecardDraft(KEY)
    expect(window.localStorage.getItem(KEY)).toBeNull()
    expect(() => clearScorecardDraft(KEY)).not.toThrow()
    expect(() => clearScorecardDraft(undefined)).not.toThrow()
  })

  it('leaves other drafts alone', () => {
    saveScorecardDraft(KEY, DRAFT)
    saveScorecardDraft(`${KEY}:other`, DRAFT)
    clearScorecardDraft(KEY)
    expect(loadScorecardDraft(`${KEY}:other`)).toEqual(DRAFT)
  })
})
