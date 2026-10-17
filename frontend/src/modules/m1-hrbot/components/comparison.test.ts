import { describe, expect, it } from 'vitest'
import type { ComparisonRow } from '../../../lib/api'
import {
  bestRecommendation, bestScore, comparisonToCsv, csvField, csvFileName, defaultDirection, offerLabel,
  scoreOf, scoreText, sortRows,
} from './comparison'

const row = (over: Partial<ComparisonRow>): ComparisonRow => ({
  rank: 1, candidate_id: 'c', resume_id: 'r', name: 'A', stage: 'completed', source: 'ai', final_score: 50,
  dimensions: { technical: null, communication: null, problem_solving: null, cultural_fit: null, confidence: null },
  recommendation: null, interviewed_at: null, match_score: null, offer_status: null, secure_token: 't', ...over,
})

describe('scoreText', () => {
  it.each([
    [88, '88'], [74.5, '74.5'], [74.46, '74.5'], [0, '0'], [null, '-'], [undefined, '-'], [Number.NaN, '-'],
  ])('%s is shown as %s', (value, text) => {
    expect(scoreText(value as number | null)).toBe(text)
  })
})

describe('offerLabel', () => {
  it('capitalises a status and spaces its words, and dashes a missing one', () => {
    expect(offerLabel('sent')).toBe('Sent')
    expect(offerLabel('pending_approval')).toBe('Pending approval')
    expect(offerLabel(null)).toBe('-')
    expect(offerLabel('')).toBe('-')
  })
})

describe('bestScore', () => {
  it('is the highest of at least two different scores', () => {
    expect(bestScore([70, 90, null, 80])).toBe(90)
  })
  it('is nothing when fewer than two are scored', () => {
    expect(bestScore([null, null])).toBeNull()
    expect(bestScore([80, null])).toBeNull()
    expect(bestScore([])).toBeNull()
  })
  it('is nothing when every scored row is the same', () => {
    expect(bestScore([70, 70, null])).toBeNull()
  })
  it('counts a zero as a score', () => {
    expect(bestScore([0, 10])).toBe(10)
  })
})

describe('bestRecommendation', () => {
  it('is hire over maybe over reject', () => {
    expect(bestRecommendation(['maybe', 'hire', 'reject'])).toBe('hire')
    expect(bestRecommendation(['maybe', 'reject', null])).toBe('maybe')
  })
  it('is nothing when they all agree or fewer than two are given', () => {
    expect(bestRecommendation(['hire', 'hire'])).toBeNull()
    expect(bestRecommendation(['hire', null])).toBeNull()
  })
})

describe('sortRows', () => {
  const a = row({ rank: 1, candidate_id: 'a', name: 'Beta', final_score: 60, recommendation: 'maybe', offer_status: 'sent' })
  const b = row({ rank: 2, candidate_id: 'b', name: 'alpha', final_score: 90, recommendation: 'hire' })
  const c = row({ rank: 3, candidate_id: 'c', name: 'Gamma', final_score: null, recommendation: null })
  const ids = (rows: ComparisonRow[]) => rows.map(r => r.candidate_id)

  it('does not change the rows it is given', () => {
    const rows = [c, b, a]
    sortRows(rows, { key: 'name', dir: 'asc' })
    expect(ids(rows)).toEqual(['c', 'b', 'a'])
  })
  it('sorts names without regard to case', () => {
    expect(ids(sortRows([a, b, c], { key: 'name', dir: 'asc' }))).toEqual(['b', 'a', 'c'])
  })
  it('keeps an unscored row last in both directions', () => {
    expect(ids(sortRows([c, a, b], { key: 'final_score', dir: 'desc' }))).toEqual(['b', 'a', 'c'])
    expect(ids(sortRows([c, a, b], { key: 'final_score', dir: 'asc' }))).toEqual(['a', 'b', 'c'])
  })
  it('keeps the incoming order between equal values', () => {
    const x = row({ candidate_id: 'x', final_score: 70 })
    const y = row({ candidate_id: 'y', final_score: 70 })
    expect(ids(sortRows([x, y], { key: 'final_score', dir: 'desc' }))).toEqual(['x', 'y'])
    expect(ids(sortRows([y, x], { key: 'final_score', dir: 'asc' }))).toEqual(['y', 'x'])
  })
  it('sorts by an area, a recommendation and an offer status', () => {
    const p = row({ candidate_id: 'p', dimensions: { technical: 40, communication: null, problem_solving: null, cultural_fit: null, confidence: null } })
    const q = row({ candidate_id: 'q', dimensions: { technical: 95, communication: null, problem_solving: null, cultural_fit: null, confidence: null } })
    expect(ids(sortRows([p, q], { key: 'technical', dir: 'desc' }))).toEqual(['q', 'p'])
    expect(ids(sortRows([c, a, b], { key: 'recommendation', dir: 'desc' }))).toEqual(['b', 'a', 'c'])
    expect(ids(sortRows([b, a], { key: 'offer_status', dir: 'asc' }))).toEqual(['a', 'b'])
  })
})

describe('defaultDirection', () => {
  it('starts scores and recommendations best first, and words and ranks lowest first', () => {
    expect(defaultDirection('final_score')).toBe('desc')
    expect(defaultDirection('technical')).toBe('desc')
    expect(defaultDirection('recommendation')).toBe('desc')
    expect(defaultDirection('name')).toBe('asc')
    expect(defaultDirection('rank')).toBe('asc')
  })
})

describe('scoreOf', () => {
  it('reads the final score and the areas, and treats a missing figure as null', () => {
    const r = row({ final_score: 81, dimensions: { technical: 70, communication: null, problem_solving: null, cultural_fit: null, confidence: null } })
    expect(scoreOf(r, 'final_score')).toBe(81)
    expect(scoreOf(r, 'technical')).toBe(70)
    expect(scoreOf(r, 'communication')).toBeNull()
  })
})

describe('csvField', () => {
  it('leaves plain text and numbers alone and empties null', () => {
    expect(csvField('Ada Lovelace')).toBe('Ada Lovelace')
    expect(csvField(88)).toBe('88')
    expect(csvField(0)).toBe('0')
    expect(csvField(null)).toBe('')
    expect(csvField(undefined)).toBe('')
  })
  it('quotes a field with a comma, a quote or a line break, doubling the quotes', () => {
    expect(csvField('Lovelace, Ada')).toBe('"Lovelace, Ada"')
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
    expect(csvField('a\nb')).toBe('"a\nb"')
  })
  it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx'])('makes %j plain text so a spreadsheet will not run it', value => {
    expect(csvField(value).replace(/^"|"$/g, '')).toContain(`'${value}`)
  })
  it('does not prefix a number, however it prints', () => {
    expect(csvField(-3)).toBe('-3')
  })
})

describe('comparisonToCsv', () => {
  it('begins with a byte order mark and a header, and ends each line with CRLF', () => {
    const csv = comparisonToCsv([])
    expect(csv.startsWith(String.fromCharCode(0xfeff) + 'Rank,Candidate,Stage,Source,Final score,')).toBe(true)
    expect(csv.endsWith('Match score\r\n')).toBe(true)
  })
  it('writes one line per row in the order given, with blanks for what is missing', () => {
    const csv = comparisonToCsv([
      row({ rank: 2, name: 'B, Bob', final_score: null, source: 'interviewer_scorecard', recommendation: 'reject', offer_status: 'declined' }),
    ])
    const lines = csv.split('\r\n')
    expect(lines[1]).toBe('2,"B, Bob",completed,Scorecard,,,,,,,Reject,Declined,,')
  })
  it('writes Erased candidate for a person with no name left, not a blank', () => {
    const csv = comparisonToCsv([row({ rank: 3, name: undefined, erased: true, final_score: null })])
    expect(csv.split('\r\n')[1].startsWith('3,Erased candidate,completed,')).toBe(true)
  })
})

describe('csvFileName', () => {
  it('makes a safe name from the job title', () => {
    expect(csvFileName('Senior Backend Engineer (Remote)')).toBe('comparison-senior-backend-engineer-remote.csv')
    expect(csvFileName('???')).toBe('comparison-job.csv')
  })
})
