import { describe, expect, it } from 'vitest'
import {
  MAX_RESUME_BYTES, applyErrorMessage, companyInitial, deadlineText, employmentTypeLabel, formatDate,
  formatFileSize, placeLabel, postedAgo, safeHttpUrl, sentenceCase, validateApplication, validateConsent,
  validateEmail, validateName, validateNote, validatePhone, validateResume,
} from './careersFormat'

const NOW = Date.parse('2026-10-15T12:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

describe('postedAgo', () => {
  it('says just now inside the first minute and for dates slightly in the future', () => {
    expect(postedAgo(ago(20_000), NOW)).toBe('just now')
    expect(postedAgo(ago(-5 * MIN), NOW)).toBe('just now')
  })

  it('counts minutes, hours and days with the right plural', () => {
    expect(postedAgo(ago(MIN), NOW)).toBe('1 minute ago')
    expect(postedAgo(ago(14 * MIN), NOW)).toBe('14 minutes ago')
    expect(postedAgo(ago(HOUR), NOW)).toBe('1 hour ago')
    expect(postedAgo(ago(5 * HOUR), NOW)).toBe('5 hours ago')
    expect(postedAgo(ago(DAY), NOW)).toBe('1 day ago')
    expect(postedAgo(ago(3 * DAY), NOW)).toBe('3 days ago')
  })

  it('moves to months and years for older posts', () => {
    expect(postedAgo(ago(45 * DAY), NOW)).toBe('1 month ago')
    expect(postedAgo(ago(90 * DAY), NOW)).toBe('3 months ago')
    expect(postedAgo(ago(400 * DAY), NOW)).toBe('1 year ago')
    expect(postedAgo(ago(800 * DAY), NOW)).toBe('2 years ago')
  })

  it('returns an empty string for a missing or invalid date', () => {
    expect(postedAgo(null, NOW)).toBe('')
    expect(postedAgo(undefined, NOW)).toBe('')
    expect(postedAgo('not a date', NOW)).toBe('')
  })
})

describe('deadlineText', () => {
  it('names the closing day without a year when it falls in the current year', () => {
    expect(deadlineText('2026-11-03T12:00:00Z', NOW, 'UTC')).toBe('Closes Nov 3')
  })

  it('adds the year when the deadline is in another year', () => {
    expect(deadlineText('2027-01-09T12:00:00Z', NOW, 'UTC')).toBe('Closes Jan 9, 2027')
  })

  it('says Closed once the deadline has passed', () => {
    expect(deadlineText('2026-10-01T12:00:00Z', NOW, 'UTC')).toBe('Closed')
  })

  it('returns an empty string when there is no deadline or it is invalid', () => {
    expect(deadlineText(null, NOW)).toBe('')
    expect(deadlineText('soon', NOW)).toBe('')
  })
})

describe('formatDate', () => {
  it('writes the full date and tolerates bad input', () => {
    expect(formatDate('2026-11-03T12:00:00Z', 'UTC')).toBe('Nov 3, 2026')
    expect(formatDate(null)).toBe('')
    expect(formatDate('nope')).toBe('')
  })
})

describe('labels', () => {
  it('turns a lowercase employment type into a readable label', () => {
    expect(employmentTypeLabel('full-time')).toBe('Full time')
    expect(employmentTypeLabel('part-time')).toBe('Part time')
    expect(employmentTypeLabel('contract')).toBe('Contract')
    expect(employmentTypeLabel('internship')).toBe('Internship')
    expect(employmentTypeLabel('')).toBe('')
    expect(employmentTypeLabel(null)).toBe('')
  })

  it('cleans separators in free values such as an industry', () => {
    expect(sentenceCase('information_technology')).toBe('Information technology')
    expect(sentenceCase('  senior   level ')).toBe('Senior level')
  })

  it('takes the first letter of the company name for the logo fallback', () => {
    expect(companyInitial('  acme corp')).toBe('A')
    expect(companyInitial('')).toBe('?')
    expect(companyInitial(undefined)).toBe('?')
  })
})

describe('formatFileSize', () => {
  it('formats bytes, kilobytes and megabytes', () => {
    expect(formatFileSize(0)).toBe('0 B')
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(1024)).toBe('1 KB')
    expect(formatFileSize(12.34 * 1024)).toBe('12.3 KB')
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe('1.5 MB')
    expect(formatFileSize(4 * 1024 * 1024)).toBe('4 MB')
  })

  it('returns an empty string for a size that makes no sense', () => {
    expect(formatFileSize(-1)).toBe('')
    expect(formatFileSize(Number.NaN)).toBe('')
  })
})

describe('safeHttpUrl', () => {
  it('keeps http and https links and drops everything else', () => {
    expect(safeHttpUrl('https://acme.test/privacy')).toBe('https://acme.test/privacy')
    expect(safeHttpUrl(' http://acme.test ')).toBe('http://acme.test')
    expect(safeHttpUrl('javascript:alert(1)')).toBe('')
    expect(safeHttpUrl('acme.test/privacy')).toBe('')
    expect(safeHttpUrl(null)).toBe('')
  })
})

describe('validation', () => {
  it('requires a name of 2 to 120 characters after collapsing spaces', () => {
    expect(validateName('')).toBe('Enter your full name.')
    expect(validateName('  A  ')).toBe('Enter your full name.')
    expect(validateName('Ada Lovelace')).toBe('')
    expect(validateName('x'.repeat(121))).toBe('Your name must be at most 120 characters.')
  })

  it('requires a plausible email address', () => {
    expect(validateEmail('')).toBe('Enter a valid email address.')
    expect(validateEmail('ada@')).toBe('Enter a valid email address.')
    expect(validateEmail('ada@acme')).toBe('Enter a valid email address.')
    expect(validateEmail('ada lovelace@acme.test')).toBe('Enter a valid email address.')
    expect(validateEmail(' ada@acme.test ')).toBe('')
  })

  it('accepts an empty phone and checks the allowed characters and length otherwise', () => {
    expect(validatePhone('')).toBe('')
    expect(validatePhone('   ')).toBe('')
    expect(validatePhone('+44 (0) 20-7946.0958')).toBe('')
    expect(validatePhone('1234')).not.toBe('')
    expect(validatePhone('call me maybe')).not.toBe('')
    expect(validatePhone('1'.repeat(31))).not.toBe('')
  })

  it('limits the note to 2000 characters', () => {
    expect(validateNote('')).toBe('')
    expect(validateNote('a'.repeat(2000))).toBe('')
    expect(validateNote('a'.repeat(2001))).toBe('Your note must be at most 2000 characters.')
  })

  it('requires consent', () => {
    expect(validateConsent(false)).not.toBe('')
    expect(validateConsent(true)).toBe('')
  })

  it('requires a résumé of an allowed type that is not empty and not over 4 MB', () => {
    expect(validateResume(null)).toBe('Attach your résumé as a file.')
    expect(validateResume({ name: 'cv.pdf', size: 1000 })).toBe('')
    expect(validateResume({ name: 'CV.DOCX', size: 1000 })).toBe('')
    expect(validateResume({ name: 'cv.doc', size: 1000 })).toBe('')
    expect(validateResume({ name: 'OLD CV.DOC', size: 1000 })).toBe('')
    expect(validateResume({ name: 'cv.txt', size: 1000 })).toBe('')
    expect(validateResume({ name: 'cv.exe', size: 1000 })).toBe('Upload a PDF, Word (.doc or .docx) or plain text (.txt) file.')
    expect(validateResume({ name: 'cv', size: 1000 })).toBe('Upload a PDF, Word (.doc or .docx) or plain text (.txt) file.')
    expect(validateResume({ name: 'cv.pdf', size: 0 })).toBe('That file is empty.')
    expect(validateResume({ name: 'cv.pdf', size: MAX_RESUME_BYTES })).toBe('')
    expect(validateResume({ name: 'cv.pdf', size: MAX_RESUME_BYTES + 1 })).toBe('The file is too large. The limit is 4 MB.')
  })

  it('reports every failing field of a whole application at once', () => {
    const errors = validateApplication({ name: '', email: 'x', phone: '12', note: '', consent: false, resume: null })
    expect(Object.keys(errors).sort()).toEqual(['consent', 'email', 'name', 'phone', 'resume'])
    const ok = validateApplication({
      name: 'Ada Lovelace', email: 'ada@acme.test', phone: '', note: '', consent: true,
      resume: new File(['x'], 'cv.pdf', { type: 'application/pdf' }),
    })
    expect(ok).toEqual({})
  })
})

describe('applyErrorMessage', () => {
  it('shows the text the server sent', () => {
    expect(applyErrorMessage({ response: { status: 409, data: { detail: 'You have already applied.' } } }))
      .toBe('You have already applied.')
  })

  it('falls back to a sentence for the status when the server sent no text', () => {
    expect(applyErrorMessage({ response: { status: 429, data: {} } })).toMatch(/too many/i)
    expect(applyErrorMessage({ response: { status: 413, data: {} } })).toMatch(/too large/i)
    expect(applyErrorMessage({ response: { status: 415, data: {} } })).toMatch(/PDF/)
    expect(applyErrorMessage({ response: { status: 422, data: { detail: [{ msg: 'bad' }] } } })).toMatch(/could not send/i)
  })

  it('shows the unreadable-file text the server sends with a 422', () => {
    const detail = 'We could not read any text in this file. Upload a PDF made from text, not a scan, or a Word or text file.'
    expect(applyErrorMessage({ response: { status: 422, data: { detail } } })).toBe(detail)
  })

  it('says the server could not be reached when there was no response', () => {
    expect(applyErrorMessage(new Error('Network Error'))).toMatch(/could not reach/i)
  })
})

describe('placeLabel', () => {
  it('keeps real places and drops a bare Remote that the remote tag already says', () => {
    expect(placeLabel('Dubai, UAE', true)).toBe('Dubai, UAE')
    expect(placeLabel('  Remote ', true)).toBe('')
    expect(placeLabel('remote', false)).toBe('remote')
    expect(placeLabel(null, true)).toBe('')
  })
})
