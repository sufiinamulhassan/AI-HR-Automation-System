import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDebouncedField } from './useDebouncedField'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('useDebouncedField', () => {
  it('starts with the value it is given and commits nothing', () => {
    const commit = vi.fn()
    const { result } = renderHook(() => useDebouncedField('abc', commit))
    expect(result.current.draft).toBe('abc')
    act(() => { vi.advanceTimersByTime(1000) })
    expect(commit).not.toHaveBeenCalled()
  })

  it('commits the trimmed text once typing has paused for 300 ms', () => {
    const commit = vi.fn()
    const { result } = renderHook(() => useDebouncedField('', commit))
    act(() => { result.current.setDraft('j') })
    act(() => { vi.advanceTimersByTime(200) })
    act(() => { result.current.setDraft('ja ') })
    act(() => { vi.advanceTimersByTime(299) })
    expect(commit).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(1) })
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith('ja')
  })

  it('uses the delay it is given', () => {
    const commit = vi.fn()
    const { result } = renderHook(() => useDebouncedField('', commit, 50))
    act(() => { result.current.setDraft('x') })
    act(() => { vi.advanceTimersByTime(50) })
    expect(commit).toHaveBeenCalledWith('x')
  })

  it('does not commit text that equals what is already committed', () => {
    const commit = vi.fn()
    const { result } = renderHook(() => useDebouncedField('go', commit))
    act(() => { result.current.setDraft('go ') })
    act(() => { vi.advanceTimersByTime(1000) })
    expect(commit).not.toHaveBeenCalled()
  })

  it('commits at once on flush, and the pending timer does not commit again', () => {
    const commit = vi.fn()
    const { result } = renderHook(() => useDebouncedField('', commit))
    act(() => { result.current.setDraft('spring') })
    act(() => { result.current.flush() })
    expect(commit).toHaveBeenCalledWith('spring')
    act(() => { vi.advanceTimersByTime(1000) })
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('sets the text and commits it at once when flush is given a value', () => {
    const commit = vi.fn()
    const { result } = renderHook(() => useDebouncedField('abc', commit))
    act(() => { result.current.flush('') })
    expect(result.current.draft).toBe('')
    expect(commit).toHaveBeenCalledWith('')
    act(() => { vi.advanceTimersByTime(1000) })
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('follows a change made from outside and does not commit it back', () => {
    const commit = vi.fn()
    const { result, rerender } = renderHook(({ value }) => useDebouncedField(value, commit), { initialProps: { value: 'a' } })
    rerender({ value: 'b' })
    expect(result.current.draft).toBe('b')
    act(() => { vi.advanceTimersByTime(1000) })
    expect(commit).not.toHaveBeenCalled()
  })

  it('drops a pending commit when the value is reset from outside', () => {
    const commit = vi.fn()
    const { result, rerender } = renderHook(({ value }) => useDebouncedField(value, commit), { initialProps: { value: 'java' } })
    act(() => { result.current.setDraft('javax') })
    rerender({ value: '' })
    expect(result.current.draft).toBe('')
    act(() => { vi.advanceTimersByTime(1000) })
    expect(commit).not.toHaveBeenCalled()
  })

  it('uses the latest commit function', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { result, rerender } = renderHook(({ commit }) => useDebouncedField('', commit), { initialProps: { commit: first } })
    act(() => { result.current.setDraft('q') })
    rerender({ commit: second })
    act(() => { vi.advanceTimersByTime(300) })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith('q')
  })
})
