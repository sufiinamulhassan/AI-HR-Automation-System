import { describe, expect, it } from 'vitest'
import { claimPageTitle, pageTitleClaimed } from './pageTitle'

describe('pageTitle', () => {
  it('is unclaimed until a page claims it, and free again when it lets go', () => {
    expect(pageTitleClaimed()).toBe(false)
    const release = claimPageTitle()
    expect(pageTitleClaimed()).toBe(true)
    release()
    expect(pageTitleClaimed()).toBe(false)
  })

  it('stays claimed until every claim is released', () => {
    const first = claimPageTitle()
    const second = claimPageTitle()
    first()
    expect(pageTitleClaimed()).toBe(true)
    second()
    expect(pageTitleClaimed()).toBe(false)
  })

  it('counts a release only once', () => {
    const first = claimPageTitle()
    const second = claimPageTitle()
    first()
    first()
    expect(pageTitleClaimed()).toBe(true)
    second()
    expect(pageTitleClaimed()).toBe(false)
  })
})
