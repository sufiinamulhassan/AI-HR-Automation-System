import { CONTACT_TOPICS, type ContactTopic } from '../../lib/site'

export const NAME_MIN = 2
export const NAME_MAX = 120
export const COMPANY_MAX = 160
export const MESSAGE_MIN = 10
export const MESSAGE_MAX = 4000

export type ContactField = 'name' | 'email' | 'company' | 'message' | 'consent'

export interface ContactValues {
  name: string
  email: string
  company: string
  topic: ContactTopic
  message: string
  consent: boolean
}

export type ContactErrors = Partial<Record<ContactField, string>>

export const CONTACT_FIELDS: ContactField[] = ['name', 'email', 'company', 'message', 'consent']

export const DEFAULT_TOPIC: ContactTopic = 'other'

export const TOPIC_HINTS: Record<ContactTopic, string> = {
  sales: 'Ask about plans, limits or a custom arrangement.',
  support: 'Say which page you were on and what you expected to happen.',
  privacy: 'Say which employer or job you applied to and what you would like us to do. We pass candidate requests on to the employer.',
  security: 'Describe the issue and how to reproduce it. Do not include other people\'s data.',
  other: '',
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function collapseSpaces(value: string): string {
  return value.split(/\s+/).filter(Boolean).join(' ')
}

export function topicFromParam(value: string | null | undefined): ContactTopic | null {
  const found = CONTACT_TOPICS.find(topic => topic.value === (value ?? '').trim().toLowerCase())
  return found ? found.value : null
}

export function validateField(field: ContactField, values: ContactValues): string {
  switch (field) {
    case 'name': {
      const name = collapseSpaces(values.name)
      if (name.length < NAME_MIN) return 'Enter your name.'
      if (name.length > NAME_MAX) return `Your name must be at most ${NAME_MAX} characters.`
      return ''
    }
    case 'email':
      return EMAIL.test(values.email.trim()) ? '' : 'Enter a valid email address.'
    case 'company':
      return collapseSpaces(values.company).length > COMPANY_MAX ? `The company name must be at most ${COMPANY_MAX} characters.` : ''
    case 'message': {
      const length = values.message.trim().length
      if (length < MESSAGE_MIN) return `Write at least ${MESSAGE_MIN} characters so we can help.`
      if (length > MESSAGE_MAX) return `Your message must be at most ${MESSAGE_MAX} characters.`
      return ''
    }
    case 'consent':
      return values.consent ? '' : 'Please agree that we may use your details to reply.'
  }
}

export function validateContact(values: ContactValues): ContactErrors {
  const errors: ContactErrors = {}
  for (const field of CONTACT_FIELDS) {
    const message = validateField(field, values)
    if (message) errors[field] = message
  }
  return errors
}

export function contactErrorMessage(error: unknown): string {
  const failure = error as { response?: { status?: number; data?: { detail?: unknown } } }
  const response = failure?.response
  if (!response) return 'We could not reach the server. Check your connection and try again.'
  const detail = response.data?.detail
  if (typeof detail === 'string' && detail.trim()) return detail.trim()
  if (response.status === 429) return 'You have sent several messages already. Please wait a while and try again.'
  if (response.status === 503) return 'The service is unavailable right now. Please try again shortly.'
  return 'We could not send your message. Please try again.'
}
