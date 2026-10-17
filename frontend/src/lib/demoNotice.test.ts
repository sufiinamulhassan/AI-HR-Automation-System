import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEMO_NOTICE_EVENT, announceSimulated, isSimulatedResponse } from './demoNotice'

afterEach(() => vi.restoreAllMocks())

describe('isSimulatedResponse', () => {
  it('recognises the answer the server gives when it refuses to change anything in the demo', () => {
    expect(isSimulatedResponse({
      message: 'Demo mode: this action was simulated and nothing was changed.',
      demo: true, deleted: 0, success: true,
    })).toBe(true)
  })

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['text', 'demo'],
    ['a number', 1],
    ['a list', [{ demo: true, message: 'x' }]],
    ['an ordinary answer', { message: 'Saved' }],
    ['demo set to a word', { demo: 'true', message: 'x' }],
    ['demo false', { demo: false, message: 'x' }],
    ['no message', { demo: true }],
    ['an empty message', { demo: true, message: '' }],
    ['a message that is not text', { demo: true, message: 3 }],
  ])('does not mistake %s for one', (_name, value) => {
    expect(isSimulatedResponse(value)).toBe(false)
  })
})

describe('announceSimulated', () => {
  it('tells the page with the message attached', () => {
    const seen: string[] = []
    const listener = (event: Event) => seen.push((event as CustomEvent<string>).detail)
    window.addEventListener(DEMO_NOTICE_EVENT, listener)
    announceSimulated('Nothing was changed')
    window.removeEventListener(DEMO_NOTICE_EVENT, listener)
    expect(seen).toEqual(['Nothing was changed'])
  })
})
