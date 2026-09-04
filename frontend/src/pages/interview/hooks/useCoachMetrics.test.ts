import { describe, expect, it } from 'vitest'
import { analyseAnswer, buildTips } from './useCoachMetrics'


const noPause = { live: false, longestPauseMs: 0 }

describe('analyseAnswer', () => {
  it('refuses to report a pace it cannot measure', () => {
    expect(analyseAnswer('I built things', 1).wpm).toBeNull()
    expect(analyseAnswer('', 60).wpm).toBeNull()
  })

  it('computes words per minute once there is enough speech', () => {
    const text = Array.from({ length: 30 }, () => 'word').join(' ')
    expect(analyseAnswer(text, 60).wpm).toBe(30)
    expect(analyseAnswer(text, 30).wpm).toBe(60)
  })

  it('separates hard disfluencies from hedge words', () => {
    const m = analyseAnswer('Um, I uh basically like shipped it', 10)
    expect(m.hardFillers).toBe(2)
    expect(m.hedges).toBe(2)
  })

  it('does not count filler substrings inside real words', () => {
    const m = analyseAnswer('The aluminium eruption interrupted us', 10)
    expect(m.hardFillers).toBe(0)
  })

  it('detects concrete grounding in an answer', () => {
    expect(analyseAnswer('For example, I led a team of 4', 10).hasExample).toBe(true)
    expect(analyseAnswer('For example, I led a team of 4', 10).hasNumbers).toBe(true)
    expect(analyseAnswer('I am a hard worker who cares', 10).hasExample).toBe(false)
    expect(analyseAnswer('I am a hard worker who cares', 10).hasNumbers).toBe(false)
  })
})

describe('buildTips', () => {
  const longAnswer = Array.from({ length: 60 }, () => 'word').join(' ')

  it('flags a rushed delivery', () => {
    const tips = buildTips(analyseAnswer(longAnswer, 15), noPause)
    expect(tips.map(t => t.id)).toContain('pace-fast')
  })

  it('praises a conversational pace instead of nagging', () => {
    const tips = buildTips(analyseAnswer(longAnswer, 26), noPause)
    const pace = tips.find(t => t.id.startsWith('pace-'))
    expect(pace?.id).toBe('pace-good')
    expect(pace?.tone).toBe('good')
  })

  it('stays quiet about answer shape while the candidate is still talking', () => {
    const metrics = analyseAnswer('Short answer so far', 8)
    const live = buildTips(metrics, { live: true, longestPauseMs: 0 })
    expect(live.map(t => t.id)).not.toContain('short')
    expect(live.map(t => t.id)).not.toContain('example')
  })

  it('asks for specifics only once the answer is finished', () => {
    const metrics = analyseAnswer('I am a hard worker who really cares about quality', 12)
    const ids = buildTips(metrics, noPause).map(t => t.id)
    expect(ids).toContain('short')
    expect(ids).toContain('example')
  })

  it('never asks for an example when the answer already has one', () => {
    const text = `For example, I led a team of 4 and cut build time by 30 percent. ${longAnswer}`
    const ids = buildTips(analyseAnswer(text, 30), noPause).map(t => t.id)
    expect(ids).not.toContain('example')
    expect(ids).not.toContain('numbers')
  })

  it('surfaces a long silence', () => {
    const tips = buildTips(analyseAnswer(longAnswer, 26), { live: true, longestPauseMs: 5000 })
    expect(tips.map(t => t.id)).toContain('pause')
  })

  it('only coaches delivery - it never scores the candidate', () => {
    const everything = buildTips(analyseAnswer('um uh er I guess', 10), { live: false, longestPauseMs: 9000 })
    const words = everything.map(t => `${t.title} ${t.body}`).join(' ').toLowerCase()
    for (const forbidden of ['score', 'rating', 'rank', 'pass', 'fail', 'weak', 'poor']) {
      expect(words).not.toContain(forbidden)
    }
  })
})
