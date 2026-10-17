import { describe, expect, it } from 'vitest'
import { careersJobUrl, isJobPublic } from './careersVisibility'

describe('isJobPublic', () => {
  it('is public when the job says so, whatever its source', () => {
    expect(isJobPublic({ is_public: true, source: 'linkedin' })).toBe(true)
    expect(isJobPublic({ is_public: true })).toBe(true)
  })

  it('is not public when the job says it is not, even for a manual job', () => {
    expect(isJobPublic({ is_public: false, source: 'manual' })).toBe(false)
    expect(isJobPublic({ is_public: false })).toBe(false)
  })

  it('treats an older manual job with no flag as public and an imported one as not', () => {
    expect(isJobPublic({ source: 'manual' })).toBe(true)
    expect(isJobPublic({})).toBe(true)
    expect(isJobPublic({ is_public: null, source: 'manual' })).toBe(true)
    expect(isJobPublic({ source: 'remotive' })).toBe(false)
    expect(isJobPublic({ source: 'linkedin' })).toBe(false)
  })

  it('defaults to public when there is no job yet', () => {
    expect(isJobPublic(null)).toBe(true)
    expect(isJobPublic(undefined)).toBe(true)
  })
})

describe('careersJobUrl', () => {
  it('joins the origin, /careers/ and the job id', () => {
    expect(careersJobUrl('job-1', 'https://hire.acme.test')).toBe('https://hire.acme.test/careers/job-1')
  })

  it('uses the page origin by default', () => {
    expect(careersJobUrl('job-1')).toBe(`${window.location.origin}/careers/job-1`)
  })
})
