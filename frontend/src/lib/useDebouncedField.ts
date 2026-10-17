import { useCallback, useEffect, useRef, useState } from 'react'

export interface DebouncedField {
  draft: string
  setDraft: (next: string) => void
  flush: (next?: string) => void
}

export function useDebouncedField(value: string, commit: (next: string) => void, delay = 300): DebouncedField {
  const [draft, setDraft] = useState(value)
  const committed = useRef(value)
  const latestDraft = useRef(value)
  const latestCommit = useRef(commit)

  useEffect(() => { latestCommit.current = commit }, [commit])
  useEffect(() => { latestDraft.current = draft }, [draft])

  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value
      latestDraft.current = value
      setDraft(value)
    }
  }, [value])

  useEffect(() => {
    const next = draft.trim()
    if (next === committed.current) return
    const timer = setTimeout(() => {
      if (committed.current === next) return
      committed.current = next
      latestCommit.current(next)
    }, delay)
    return () => clearTimeout(timer)
  }, [draft, delay])

  const flush = useCallback((next?: string) => {
    if (next !== undefined) {
      latestDraft.current = next
      setDraft(next)
    }
    const text = latestDraft.current.trim()
    if (text === committed.current) return
    committed.current = text
    latestCommit.current(text)
  }, [])

  return { draft, setDraft, flush }
}
