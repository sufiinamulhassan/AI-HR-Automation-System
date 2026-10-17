import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  DEFAULT_PLATFORM_WINDOW, PLATFORM_WINDOWS, type PlatformPeriod, type PlatformWindow, type ReadOptions,
} from '../../lib/platformTypes'
import { errorDetail, errorStatus } from './format'

export interface Loaded<T> {
  data: T | null
  loading: boolean
  error: string
  status: number | undefined
  reload: () => void
}

export function useLoaded<T>(load: () => Promise<T>, deps: readonly unknown[], failure: string): Loaded<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [status, setStatus] = useState<number | undefined>(undefined)
  const [nonce, setNonce] = useState(0)
  const latest = useRef(0)
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    const id = ++latest.current
    setLoading(true)
    loadRef.current()
      .then(value => {
        if (id !== latest.current) return
        setData(value)
        setError('')
        setStatus(undefined)
      })
      .catch(e => {
        if (id !== latest.current) return
        setError(errorDetail(e, failure))
        setStatus(errorStatus(e))
      })
      .finally(() => {
        if (id === latest.current) setLoading(false)
      })
  }, [...deps, nonce])

  useEffect(() => () => { latest.current += 1 }, [])

  const reload = useCallback(() => setNonce(n => n + 1), [])
  return { data, loading, error, status, reload }
}

export function useForceRefresh() {
  const flag = useRef(false)
  const take = useCallback((): ReadOptions | undefined => {
    if (!flag.current) return undefined
    flag.current = false
    return { refresh: true }
  }, [])
  const mark = useCallback(() => { flag.current = true }, [])
  return { take, mark }
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

export function usePlatformPeriod(): [PlatformPeriod, (p: PlatformPeriod) => void] {
  const [params, setParams] = useSearchParams()
  const monthParam = params.get('month')
  const windowParam = Number(params.get('window'))
  const value = useMemo<PlatformPeriod>(() => {
    if (monthParam && MONTH_RE.test(monthParam)) return { month: monthParam }
    return (PLATFORM_WINDOWS as readonly number[]).includes(windowParam) ? (windowParam as PlatformWindow) : DEFAULT_PLATFORM_WINDOW
  }, [monthParam, windowParam])
  const set = useCallback(
    (p: PlatformPeriod) => {
      if (typeof p !== 'number') setParams({ month: p.month }, { replace: true })
      else setParams(p === DEFAULT_PLATFORM_WINDOW ? {} : { window: String(p) }, { replace: true })
    },
    [setParams],
  )
  return [value, set]
}

export function useArrivalNotice(showToast: (message: string) => void) {
  const navigate = useNavigate()
  const location = useLocation()
  const notice = useRef((location.state as { notice?: string } | null)?.notice)
  useEffect(() => {
    if (!notice.current) return
    showToast(notice.current)
    notice.current = undefined
    navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null })
  }, [])
}
