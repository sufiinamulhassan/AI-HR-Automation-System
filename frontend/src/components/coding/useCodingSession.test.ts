import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCodingSession } from './useCodingSession'

describe('useCodingSession, autosave', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('posts the current language and code to the autosave endpoint', () => {
    fetchMock.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ saved: true, updated_at: '2026-01-01T00:00:00Z' }),
    })

    const { result } = renderHook(() => useCodingSession('tok_abc', false))
    result.current.autosave('python', 'print(1)')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/coding/session/tok_abc/autosave')
    expect(init).toMatchObject({ method: 'POST' })
    expect(JSON.parse(init.body)).toEqual({ language: 'python', code: 'print(1)' })
  })

  it('does nothing when there is no token yet', () => {
    const { result } = renderHook(() => useCodingSession(undefined, false))
    result.current.autosave('python', 'print(1)')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('swallows a network failure silently, no throw, no error state', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))

    const { result } = renderHook(() => useCodingSession('tok_abc', false))
    expect(() => result.current.autosave('python', 'print(1)')).not.toThrow()

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(result.current.errorMsg).toBe('')
    expect(result.current.status).toBe('loading')
  })

  it('swallows a non-2xx response the same way', async () => {
    fetchMock.mockResolvedValue({
      ok: false, status: 400,
      json: async () => ({ detail: 'No coding assessment has been assigned yet' }),
    })

    const { result } = renderHook(() => useCodingSession('tok_abc', false))
    result.current.autosave('python', 'print(1)')

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(result.current.errorMsg).toBe('')
  })
})
