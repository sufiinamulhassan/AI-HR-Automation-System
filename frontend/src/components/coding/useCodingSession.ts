import { useCallback, useEffect, useState } from 'react'
import { API_V1 } from '../../lib/config'

export interface CodingSessionData {
  question_id: string
  title: string
  description: string
  difficulty: string
  job_domain: string | null
  language_templates: Record<string, string>
  supported_languages?: string[]
  test_cases: { input: string; expected_output: string; is_hidden: boolean }[]
}

export interface CodingSubmissionResult {
  test_case_index: number
  passed: boolean
  is_hidden: boolean
  actual_output?: string
  expected_output?: string
  status?: string | null
  time_ms?: number | null
  memory_kb?: number | null
  stderr?: string | null
  compile_output?: string | null
  execution_error?: boolean
  skipped?: boolean
}

export interface CodingSubmissionResponse {
  submission_id: string
  question_id: string
  language: string
  status: 'queued' | 'completed' | 'error' | 'execution_error'
  results: CodingSubmissionResult[]
  score: number | null
}

export interface CodingRunResult {
  stdin: string
  stdout: string
  stderr: string
  compile_output: string
  status: string | null
  time: string | null
  memory: number | null
}

export type CodingStatus = 'loading' | 'active' | 'submitting' | 'done' | 'error'
export type CodingRunStatus = 'idle' | 'running' | 'done' | 'error'

export function useCodingSession(token: string | undefined, enabled = true) {
  const [status, setStatus] = useState<CodingStatus>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [session, setSession] = useState<CodingSessionData | null>(null)
  const [result, setResult] = useState<CodingSubmissionResponse | null>(null)
  const [runStatus, setRunStatus] = useState<CodingRunStatus>('idle')
  const [runErrorMsg, setRunErrorMsg] = useState('')
  const [runResult, setRunResult] = useState<CodingRunResult | null>(null)

  useEffect(() => {
    if (!token || !enabled) return
    let cancelled = false
    fetch(`${API_V1}/coding/session/${token}`)
      .then(r => {
        if (!r.ok) return r.json().then(d => Promise.reject(d?.detail || 'Unable to load coding assessment'))
        return r.json()
      })
      .then((data: CodingSessionData) => {
        if (cancelled) return
        setSession(data)
        setStatus('active')
      })
      .catch(err => {
        if (cancelled) return
        setErrorMsg(typeof err === 'string' ? err : 'Unable to load coding assessment')
        setStatus('error')
      })
    return () => { cancelled = true }
  }, [token, enabled])

  const submit = useCallback(async (language: string, code: string, keystrokes?: number) => {
    if (!token) return
    setStatus('submitting')
    setErrorMsg('')
    try {
      const res = await fetch(`${API_V1}/coding/session/${token}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language, code, keystrokes }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d?.detail || 'Submission failed')
      }
      const data: CodingSubmissionResponse = await res.json()
      setResult(data)
      setStatus('done')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Submission failed')
      setStatus('error')
    }
  }, [token])

  const run = useCallback(async (language: string, code: string, stdin?: string) => {
    if (!token) return
    setRunStatus('running')
    setRunErrorMsg('')
    try {
      const res = await fetch(`${API_V1}/coding/session/${token}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language, code, stdin }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d?.detail || 'Run failed')
      }
      const data: CodingRunResult = await res.json()
      setRunResult(data)
      setRunStatus('done')
    } catch (err) {
      setRunErrorMsg(err instanceof Error ? err.message : 'Run failed')
      setRunStatus('error')
    }
  }, [token])

  const flag = useCallback((event: string) => {
    if (!token) return
    fetch(`${API_V1}/coding/session/${token}/flag`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event }),
    }).catch(() => {})
  }, [token])

  return {
    session, status, errorMsg, result, submit,
    runStatus, runErrorMsg, runResult, run,
    flag,
  }
}
