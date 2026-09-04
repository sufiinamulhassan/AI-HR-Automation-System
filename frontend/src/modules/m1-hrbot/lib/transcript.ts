
export interface TranscriptEntry {
  role?: string
  content?: string
  timestamp?: string
  question?: string
  answer?: string
  answered_at?: string
}

export interface TranscriptTurn {
  role: string
  content: string
  timestamp?: string
}

export function toTurns(entries: TranscriptEntry[] | undefined | null): TranscriptTurn[] {
  const turns: TranscriptTurn[] = []
  for (const e of entries ?? []) {
    if (!e || typeof e !== 'object') continue
    if (e.question || e.answer) {
      if (e.question) turns.push({ role: 'agent', content: e.question, timestamp: e.answered_at })
      if (e.answer) turns.push({ role: 'candidate', content: e.answer, timestamp: e.answered_at })
    } else if (e.content) {
      turns.push({ role: e.role || 'unknown', content: e.content, timestamp: e.timestamp })
    }
  }
  return turns
}
