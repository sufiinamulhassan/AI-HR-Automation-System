import { describe, expect, it } from 'vitest'
import { PHYSICAL_PLATFORM_LABEL, PLATFORM_OPTIONS, describeMeetingChange, platformName } from './externalInterview'
import { loadInterviewPrefs } from './interviewPrefs'

describe('platformName', () => {
  it('names the online platforms and an interview in person', () => {
    expect(platformName('zoom')).toBe('Zoom')
    expect(platformName('meet')).toBe('Google Meet')
    expect(platformName('physical')).toBe('In person')
    expect(PHYSICAL_PLATFORM_LABEL).toBe('In person')
  })

  it('gives nothing for a missing or unknown platform', () => {
    expect(platformName(null)).toBe('')
    expect(platformName(undefined)).toBe('')
    expect(platformName('')).toBe('')
    expect(platformName('carrier-pigeon')).toBe('')
  })

  it('keeps in person out of the platform list, which is only for meetings that have a link', () => {
    expect(PLATFORM_OPTIONS.map(p => p.value)).toEqual(['zoom', 'meet', 'teams', 'other'])
  })
})

describe('describeMeetingChange for an interview in person', () => {
  it('calls the place the address', () => {
    expect(describeMeetingChange('location', ['Head Office, Hyderabad', 'Annexe, Pune'])).toBe('Address: Head Office, Hyderabad to Annexe, Pune')
  })

  it('shows a switch between a meeting and in person by name', () => {
    expect(describeMeetingChange('platform', ['zoom', 'physical'])).toBe('Platform: Zoom to In person')
    expect(describeMeetingChange('platform', ['physical', 'teams'])).toBe('Platform: In person to Microsoft Teams')
  })

  it('shows nothing before as a dash, and cuts a long address short', () => {
    expect(describeMeetingChange('location', [null, 'Annexe, Pune'])).toBe('Address: - to Annexe, Pune')
    const long = 'A'.repeat(100)
    const text = describeMeetingChange('location', [long, long])
    expect(text).toContain('…')
    expect(text.length).toBeLessThan(140)
  })
})

describe('the remembered platform', () => {
  it('is never in person, so the next online meeting does not start on it', () => {
    const key = 'someone@x.com'
    localStorage.setItem(`hr-bot.interview-setup:${key}`, JSON.stringify({ platform: 'physical', duration: '60', label: '' }))
    expect(loadInterviewPrefs(key)).toEqual({ duration: '60', label: '' })
    localStorage.removeItem(`hr-bot.interview-setup:${key}`)
  })
})
