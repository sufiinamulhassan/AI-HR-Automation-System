import { useEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { SILENCE_FLOOR } from './useAudioLevel'
import type { TranscriptEntry, TurnPhase } from '../useInterviewSession'


export interface CoachTip {
  id: string
  tone: 'good' | 'watch' | 'tip'
  title: string
  body: string
}

export interface AnswerMetrics {
  words: number
  seconds: number
  wpm: number | null
  hardFillers: number
  hedges: number
  hasNumbers: boolean
  hasExample: boolean
}

const HARD_FILLERS = ['um', 'umm', 'uh', 'uhh', 'er', 'erm', 'ah', 'hmm']
const HEDGES = ['like', 'basically', 'actually', 'literally', 'honestly', 'you know', 'i mean', 'sort of', 'kind of']
const EXAMPLE_MARKERS = /\b(for example|for instance|e\.g\.|such as|in my last|at my previous|when i |one time|specifically|we built|i built|i led|i shipped)\b/i

const MIN_SECONDS_FOR_WPM = 6
const MIN_WORDS_FOR_WPM = 12

const FAST_WPM = 175
const SLOW_WPM = 105
const IDEAL_WPM_LOW = 115
const IDEAL_WPM_HIGH = 165
const SHORT_ANSWER_WORDS = 30
const LONG_PAUSE_MS = 4000

function countOccurrences(haystack: string, needle: string): number {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = needle.includes(' ')
    ? new RegExp(escaped, 'g')
    : new RegExp(`\\b${escaped}\\b`, 'g')
  return (haystack.match(pattern) || []).length
}

export function analyseAnswer(text: string, seconds: number): AnswerMetrics {
  const clean = (text || '').trim()
  const lower = clean.toLowerCase()
  const words = clean ? clean.split(/\s+/).length : 0

  let hardFillers = 0
  for (const f of HARD_FILLERS) hardFillers += countOccurrences(lower, f)
  let hedges = 0
  for (const h of HEDGES) hedges += countOccurrences(lower, h)

  const enoughToRate = seconds >= MIN_SECONDS_FOR_WPM && words >= MIN_WORDS_FOR_WPM
  const wpm = enoughToRate ? Math.round(words / (seconds / 60)) : null

  return {
    words,
    seconds,
    wpm,
    hardFillers,
    hedges,
    hasNumbers: /\d/.test(clean),
    hasExample: EXAMPLE_MARKERS.test(clean),
  }
}

export function buildTips(m: AnswerMetrics, opts: { live: boolean; longestPauseMs: number }): CoachTip[] {
  const tips: CoachTip[] = []

  if (m.wpm !== null) {
    if (m.wpm > FAST_WPM) {
      tips.push({
        id: 'pace-fast',
        tone: 'watch',
        title: `Slow down a little - ${m.wpm} wpm`,
        body: 'You are speaking quickly. A short breath between points makes you much easier to follow.',
      })
    } else if (m.wpm < SLOW_WPM) {
      tips.push({
        id: 'pace-slow',
        tone: 'tip',
        title: `Pick up the pace - ${m.wpm} wpm`,
        body: 'There is room to speak a little more freely. Aim for a natural conversational rhythm.',
      })
    } else if (m.wpm >= IDEAL_WPM_LOW && m.wpm <= IDEAL_WPM_HIGH) {
      tips.push({
        id: 'pace-good',
        tone: 'good',
        title: `Good pace - ${m.wpm} wpm`,
        body: 'Clear and easy to follow. Keep it there.',
      })
    }
  }

  if (m.hardFillers >= 3) {
    tips.push({
      id: 'fillers',
      tone: 'watch',
      title: `${m.hardFillers} filler words`,
      body: 'A silent pause reads as far more confident than "um". Pausing to think is completely fine.',
    })
  }

  if (opts.longestPauseMs >= LONG_PAUSE_MS) {
    tips.push({
      id: 'pause',
      tone: 'tip',
      title: 'Long silence detected',
      body: 'If you need a moment, say so out loud - thinking time is expected and sounds better than dead air.',
    })
  }

  if (!opts.live && m.words > 0) {
    if (m.words < SHORT_ANSWER_WORDS) {
      tips.push({
        id: 'short',
        tone: 'tip',
        title: 'Try adding more detail',
        body: 'Short answers leave the interviewer guessing. Walk through what you did and why.',
      })
    }
    if (!m.hasExample) {
      tips.push({
        id: 'example',
        tone: 'tip',
        title: 'Add a concrete example',
        body: 'Ground the answer in something you actually did - a project, a decision, a trade-off you made.',
      })
    }
    if (!m.hasNumbers && m.words >= SHORT_ANSWER_WORDS) {
      tips.push({
        id: 'numbers',
        tone: 'tip',
        title: 'Quantify the impact',
        body: 'Numbers land: team size, time saved, users affected, percentage improved.',
      })
    }
  }

  return tips
}

interface CoachInput {
  levelRef: MutableRefObject<number>
  turnPhase: TurnPhase
  recordSecs: number
  liveText: string
  draftAnswer: string
  transcript: TranscriptEntry[]
}

export function useCoachMetrics({ levelRef, turnPhase, recordSecs, liveText, draftAnswer, transcript }: CoachInput) {
  const recording = turnPhase === 'recording'
  const [longestPauseMs, setLongestPauseMs] = useState(0)
  const silenceStartRef = useRef<number | null>(null)
  const lastAnswerSecsRef = useRef(0)

  useEffect(() => {
    if (!recording) {
      silenceStartRef.current = null
      return
    }
    setLongestPauseMs(0)
    const timer = setInterval(() => {
      const now = Date.now()
      if (levelRef.current < SILENCE_FLOOR) {
        if (silenceStartRef.current === null) silenceStartRef.current = now
        else {
          const run = now - silenceStartRef.current
          setLongestPauseMs(prev => (run > prev ? run : prev))
        }
      } else {
        silenceStartRef.current = null
      }
    }, 150)
    return () => clearInterval(timer)
  }, [recording, levelRef])

  if (recording) lastAnswerSecsRef.current = recordSecs

  const live = recording
  const text = recording ? liveText : draftAnswer
  const seconds = recording ? recordSecs : lastAnswerSecsRef.current

  const metrics = useMemo(() => analyseAnswer(text, seconds), [text, seconds])

  const tips = useMemo(() => {
    if (turnPhase !== 'recording' && turnPhase !== 'review') return []
    return buildTips(metrics, { live, longestPauseMs })
  }, [metrics, live, longestPauseMs, turnPhase])

  const session = useMemo(() => {
    const answers = transcript.filter(t => t.answer)
    const totalWords = answers.reduce((n, t) => n + t.answer.trim().split(/\s+/).length, 0)
    return {
      answered: answers.length,
      avgWords: answers.length ? Math.round(totalWords / answers.length) : 0,
    }
  }, [transcript])

  return { metrics, tips, session, longestPauseMs }
}
