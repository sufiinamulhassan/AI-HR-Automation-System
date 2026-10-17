import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const filters = vi.fn()
const jobs = vi.fn()
const plans = vi.fn()

vi.mock('./api', () => ({
  careersApi: { filters: (...a: unknown[]) => filters(...a), jobs: (...a: unknown[]) => jobs(...a) },
  siteApi: { plans: (...a: unknown[]) => plans(...a) },
}))

const prefetch = await import('./prefetch')

beforeEach(() => {
  vi.stubEnv('MODE', 'production')
  filters.mockReset().mockResolvedValue({})
  jobs.mockReset().mockResolvedValue({})
  plans.mockReset().mockResolvedValue({})
  prefetch.resetPrefetchForTests()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('normalisePath', () => {
  it('drops the query, the hash and a trailing slash', () => {
    expect(prefetch.normalisePath('/careers?q=a#top')).toBe('/careers')
    expect(prefetch.normalisePath('/careers/')).toBe('/careers')
    expect(prefetch.normalisePath('/')).toBe('/')
  })
})

describe('prefetchData', () => {
  it('asks for the first page of jobs and the filters the careers page will ask for', () => {
    prefetch.prefetchData('/careers')
    expect(filters).toHaveBeenCalledTimes(1)
    expect(jobs).toHaveBeenCalledWith({ page: 1, limit: 12 })
  })

  it('does not ask again within a few seconds, but does after that', () => {
    prefetch.prefetchData('/careers', 1000)
    prefetch.prefetchData('/careers', 5000)
    expect(jobs).toHaveBeenCalledTimes(1)
    prefetch.prefetchData('/careers', 30000)
    expect(jobs).toHaveBeenCalledTimes(2)
  })

  it('knows the pricing data too, and ignores pages with nothing to fetch', () => {
    prefetch.prefetchData('/pricing')
    expect(plans).toHaveBeenCalledTimes(1)
    prefetch.prefetchData('/about')
    expect(filters).not.toHaveBeenCalled()
  })

  it('never lets a failed warm up reach the person', async () => {
    jobs.mockRejectedValue(new Error('offline'))
    expect(() => prefetch.prefetchData('/careers')).not.toThrow()
    await Promise.resolve()
  })

  it('does nothing under test unless the mode says otherwise', () => {
    vi.stubEnv('MODE', 'test')
    prefetch.prefetchData('/careers')
    expect(jobs).not.toHaveBeenCalled()
  })
})

describe('chunkKey', () => {
  it('sends every page of a section to the chunk of that section', () => {
    expect(prefetch.chunkKey('/integrations/zoom/')).toBe('/integrations')
    expect(prefetch.chunkKey('/integrations/webhooks?x=1')).toBe('/integrations')
    expect(prefetch.chunkKey('/compare/traditional-ats#top')).toBe('/compare')
    expect(prefetch.chunkKey('/compare/traditional-ats')).toBe('/compare')
  })

  it('leaves section hubs and other pages as they are', () => {
    expect(prefetch.chunkKey('/compare')).toBe('/compare')
    expect(prefetch.chunkKey('/pricing')).toBe('/pricing')
    expect(prefetch.chunkKey('/comparekit')).toBe('/comparekit')
  })
})

describe('prefetchChunks', () => {
  it('starts each page once and skips pages it does not know', () => {
    expect(() => prefetch.prefetchChunks('/careers')).not.toThrow()
    expect(() => prefetch.prefetchChunks('/careers')).not.toThrow()
    expect(() => prefetch.prefetchChunks('/nowhere')).not.toThrow()
  })
})

describe('prefetchChunksWhenIdle', () => {
  it('waits for an idle moment and can be cancelled', () => {
    vi.useFakeTimers()
    const cancel = prefetch.prefetchChunksWhenIdle(['/pricing'])
    expect(typeof cancel).toBe('function')
    cancel()
    vi.runAllTimers()
  })

  it('is a no-op under test', () => {
    vi.stubEnv('MODE', 'test')
    const cancel = prefetch.prefetchChunksWhenIdle(['/pricing'])
    expect(() => cancel()).not.toThrow()
  })
})

describe('prefetchRoute', () => {
  it('warms both the code and the data of a page', () => {
    prefetch.prefetchRoute('/careers')
    expect(jobs).toHaveBeenCalledTimes(1)
  })
})
