import { describe, expect, it } from 'vitest'
import {
  COMPANY_MAX, MESSAGE_MAX, MESSAGE_MIN, NAME_MAX, TOPIC_HINTS, collapseSpaces, contactErrorMessage, topicFromParam,
  validateContact, validateField, type ContactValues,
} from './contactForm'
import { CONTACT_TOPICS } from '../../lib/site'

const GOOD: ContactValues = {
  name: 'Sara Khan',
  email: 'sara@example.com',
  company: 'Globex',
  topic: 'sales',
  message: 'We would like to see the platform with our team.',
  consent: true,
}

describe('validateField', () => {
  it('asks for a name of a sensible length', () => {
    expect(validateField('name', { ...GOOD, name: ' S ' })).toBe('Enter your name.')
    expect(validateField('name', { ...GOOD, name: 'x'.repeat(NAME_MAX + 1) })).toBe(`Your name must be at most ${NAME_MAX} characters.`)
    expect(validateField('name', { ...GOOD, name: '  Sara    Khan ' })).toBe('')
  })

  it('wants a real looking email address', () => {
    ;['', 'sara', 'sara@', 'sara@example', 'sara @example.com'].forEach(email => {
      expect(validateField('email', { ...GOOD, email })).toBe('Enter a valid email address.')
    })
    expect(validateField('email', { ...GOOD, email: ' sara@example.com ' })).toBe('')
  })

  it('treats the company as optional but bounded', () => {
    expect(validateField('company', { ...GOOD, company: '' })).toBe('')
    expect(validateField('company', { ...GOOD, company: 'c'.repeat(COMPANY_MAX + 1) })).toBe(`The company name must be at most ${COMPANY_MAX} characters.`)
  })

  it('needs a message that is neither too short nor too long', () => {
    expect(validateField('message', { ...GOOD, message: 'short' })).toBe(`Write at least ${MESSAGE_MIN} characters so we can help.`)
    expect(validateField('message', { ...GOOD, message: 'm'.repeat(MESSAGE_MAX + 1) })).toBe(`Your message must be at most ${MESSAGE_MAX} characters.`)
    expect(validateField('message', { ...GOOD, message: 'm'.repeat(MESSAGE_MAX) })).toBe('')
  })

  it('needs consent to reply', () => {
    expect(validateField('consent', { ...GOOD, consent: false })).toBe('Please agree that we may use your details to reply.')
    expect(validateField('consent', GOOD)).toBe('')
  })
})

describe('validateContact', () => {
  it('passes a good form and reports every bad field at once', () => {
    expect(validateContact(GOOD)).toEqual({})
    expect(Object.keys(validateContact({ ...GOOD, name: '', email: 'x', message: '', consent: false })).sort())
      .toEqual(['consent', 'email', 'message', 'name'])
  })
})

describe('helpers', () => {
  it('collapses runs of spaces', () => {
    expect(collapseSpaces('  a   b \n c ')).toBe('a b c')
  })

  it('reads a topic from the address, ignoring unknown ones', () => {
    expect(topicFromParam('privacy')).toBe('privacy')
    expect(topicFromParam(' SALES ')).toBe('sales')
    expect(topicFromParam('nonsense')).toBeNull()
    expect(topicFromParam(null)).toBeNull()
  })

  it('has a hint for every topic', () => {
    CONTACT_TOPICS.forEach(topic => expect(TOPIC_HINTS).toHaveProperty(topic.value))
  })
})

describe('contactErrorMessage', () => {
  it('uses the server wording when there is some', () => {
    expect(contactErrorMessage({ response: { status: 400, data: { detail: ' Enter a valid email address. ' } } })).toBe('Enter a valid email address.')
  })

  it('explains the common failures', () => {
    expect(contactErrorMessage({})).toMatch(/could not reach the server/i)
    expect(contactErrorMessage({ response: { status: 429, data: {} } })).toMatch(/several messages/i)
    expect(contactErrorMessage({ response: { status: 503, data: {} } })).toMatch(/unavailable/i)
    expect(contactErrorMessage({ response: { status: 500, data: {} } })).toMatch(/could not send/i)
  })
})
