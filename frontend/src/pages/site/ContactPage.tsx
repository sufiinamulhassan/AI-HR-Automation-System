import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Btn, CornerDots, PageHero } from '../../components/site/kit'
import { siteApi } from '../../lib/api'
import { CONTACT_TOPICS, SITE, type ContactTopic } from '../../lib/site'
import type { ContactResult } from '../../lib/siteTypes'
import { usePageMeta } from '../../lib/usePageMeta'
import {
  CONTACT_FIELDS, DEFAULT_TOPIC, MESSAGE_MAX, TOPIC_HINTS, collapseSpaces, contactErrorMessage, topicFromParam,
  validateContact, validateField, type ContactErrors, type ContactField, type ContactValues,
} from './contactForm'
import './ContactPage.css'

const NEXT_STEPS = [
  'A person reads your message. Nothing is answered by a bot.',
  'We reply to the email address you give us.',
  'Requests about a candidate record are passed to the employer that holds it.',
]

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return <p className="xv-error" id={id}>{message}</p>
}

export default function ContactPage() {
  usePageMeta({
    title: 'Contact',
    description: 'Ask about plans, get support, make a privacy request or report a security issue.',
  })

  const [params] = useSearchParams()
  const [values, setValues] = useState<ContactValues>(() => ({
    name: '', email: '', company: '', message: '', consent: false,
    topic: topicFromParam(params.get('topic')) ?? DEFAULT_TOPIC,
  }))
  const [errors, setErrors] = useState<ContactErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [done, setDone] = useState<ContactResult | null>(null)
  const spam = useRef<HTMLInputElement | null>(null)
  const refs = useRef<Partial<Record<ContactField, HTMLElement | null>>>({})
  const headingRef = useRef<HTMLHeadingElement | null>(null)

  const requested = params.get('topic')
  useEffect(() => {
    const topic = topicFromParam(requested)
    if (topic) setValues(v => (v.topic === topic ? v : { ...v, topic }))
  }, [requested])

  useEffect(() => {
    if (done) headingRef.current?.focus()
  }, [done])

  function change<K extends keyof ContactValues>(key: K, value: ContactValues[K]) {
    const next = { ...values, [key]: value }
    setValues(next)
    if (key in errors) {
      const field = key as ContactField
      setErrors(prev => {
        const message = validateField(field, next)
        const copy = { ...prev }
        if (message) copy[field] = message
        else delete copy[field]
        return copy
      })
    }
  }

  function blur(field: ContactField) {
    const message = validateField(field, values)
    setErrors(prev => {
      if (!message && !prev[field]) return prev
      const copy = { ...prev }
      if (message) copy[field] = message
      else delete copy[field]
      return copy
    })
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (submitting) return
    setSubmitError('')
    const found = validateContact(values)
    setErrors(found)
    const first = CONTACT_FIELDS.find(field => found[field])
    if (first) {
      refs.current[first]?.focus()
      return
    }
    setSubmitting(true)
    try {
      const r = await siteApi.contact({
        name: collapseSpaces(values.name),
        email: values.email.trim(),
        company: collapseSpaces(values.company),
        topic: values.topic,
        message: values.message.trim(),
        consent: true,
        website: spam.current?.value ?? '',
      })
      setDone(r.data)
    } catch (err) {
      setSubmitError(contactErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  const hint = TOPIC_HINTS[values.topic as ContactTopic]

  return (
    <>
      <PageHero
        eyebrow="Contact"
        title="Talk to us"
        lead="Ask about plans, get help, make a privacy request, or report a security issue."
      />

      <section className="xv-card-section">
        <div className="xv-card xv-card-padded">
          <CornerDots />
          <div className="xv-shell xv-contact-grid">
            {done ? (
              <div className="xv-contact-done" role="status">
                <span className="xv-contact-done-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m5 12.5 4.5 4.5L19 7.5" />
                  </svg>
                </span>
                <h2 className="xv-contact-done-title" tabIndex={-1} ref={headingRef}>Message received</h2>
                <p>Thank you. We will reply to {values.email.trim()}.</p>
                {done.reference && (
                  <p className="xv-contact-ref">
                    Reference <code>{done.reference}</code>
                  </p>
                )}
                <div className="xv-contact-done-actions">
                  <Btn to="/" variant="primary">Back to the home page</Btn>
                  <Btn to="/features" variant="outline">See features</Btn>
                </div>
              </div>
            ) : (
              <form className="xv-form" onSubmit={submit} noValidate aria-label="Contact form">
                <div className="xv-field">
                  <label className="xv-label" htmlFor="contact-topic">What is this about?</label>
                  <select
                    id="contact-topic"
                    className="xv-select"
                    value={values.topic}
                    onChange={e => change('topic', e.target.value as ContactTopic)}
                    aria-describedby={hint ? 'contact-topic-hint' : undefined}
                  >
                    {CONTACT_TOPICS.map(topic => <option key={topic.value} value={topic.value}>{topic.label}</option>)}
                  </select>
                  {hint && <p className="xv-help" id="contact-topic-hint">{hint}</p>}
                </div>

                <div className="xv-field-row">
                  <div className="xv-field">
                    <label className="xv-label" htmlFor="contact-name">Name</label>
                    <input
                      id="contact-name"
                      ref={el => { refs.current.name = el }}
                      className="xv-input"
                      type="text"
                      autoComplete="name"
                      value={values.name}
                      onChange={e => change('name', e.target.value)}
                      onBlur={() => blur('name')}
                      aria-invalid={!!errors.name}
                      aria-describedby={errors.name ? 'contact-name-error' : undefined}
                    />
                    <FieldError id="contact-name-error" message={errors.name} />
                  </div>

                  <div className="xv-field">
                    <label className="xv-label" htmlFor="contact-email">Email address</label>
                    <input
                      id="contact-email"
                      ref={el => { refs.current.email = el }}
                      className="xv-input"
                      type="email"
                      autoComplete="email"
                      value={values.email}
                      onChange={e => change('email', e.target.value)}
                      onBlur={() => blur('email')}
                      aria-invalid={!!errors.email}
                      aria-describedby={errors.email ? 'contact-email-error' : undefined}
                    />
                    <FieldError id="contact-email-error" message={errors.email} />
                  </div>
                </div>

                <div className="xv-field">
                  <label className="xv-label" htmlFor="contact-company">
                    Company <span className="xv-optional">(optional)</span>
                  </label>
                  <input
                    id="contact-company"
                    ref={el => { refs.current.company = el }}
                    className="xv-input"
                    type="text"
                    autoComplete="organization"
                    value={values.company}
                    onChange={e => change('company', e.target.value)}
                    onBlur={() => blur('company')}
                    aria-invalid={!!errors.company}
                    aria-describedby={errors.company ? 'contact-company-error' : undefined}
                  />
                  <FieldError id="contact-company-error" message={errors.company} />
                </div>

                <div className="xv-field">
                  <label className="xv-label" htmlFor="contact-message">Message</label>
                  <textarea
                    id="contact-message"
                    ref={el => { refs.current.message = el }}
                    className="xv-textarea"
                    rows={6}
                    value={values.message}
                    onChange={e => change('message', e.target.value)}
                    onBlur={() => blur('message')}
                    aria-invalid={!!errors.message}
                    aria-describedby={errors.message ? 'contact-message-error contact-message-count' : 'contact-message-count'}
                  />
                  <div className="xv-field-foot">
                    <FieldError id="contact-message-error" message={errors.message} />
                    <span className={`xv-counter${values.message.length > MESSAGE_MAX ? ' is-over' : ''}`} id="contact-message-count">
                      {values.message.length}/{MESSAGE_MAX}
                    </span>
                  </div>
                </div>

                <div className="xv-field">
                  <label className="xv-check" htmlFor="contact-consent">
                    <input
                      id="contact-consent"
                      ref={el => { refs.current.consent = el }}
                      type="checkbox"
                      checked={values.consent}
                      onChange={e => change('consent', e.target.checked)}
                      aria-invalid={!!errors.consent}
                      aria-describedby={errors.consent ? 'contact-consent-error' : undefined}
                    />
                    <span>
                      I agree that {SITE.entity} may use these details to reply to me. See the{' '}
                      <Link to="/privacy">Privacy Policy</Link>.
                    </span>
                  </label>
                  <FieldError id="contact-consent-error" message={errors.consent} />
                </div>

                <div className="xv-hp" aria-hidden="true">
                  <label>
                    Website
                    <input type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" ref={spam} />
                  </label>
                </div>

                {submitError && <p className="xv-form-error" role="alert">{submitError}</p>}

                <div className="xv-form-actions">
                  <Btn type="submit" variant="primary" size="lg" disabled={submitting}>
                    {submitting ? 'Sending' : 'Send message'}
                  </Btn>
                </div>
              </form>
            )}

            <aside className="xv-contact-side" aria-label="Other ways to reach us">
              <h2 className="xv-contact-side-title">What happens next</h2>
              <ol className="xv-contact-steps">
                {NEXT_STEPS.map(step => <li key={step}>{step}</li>)}
              </ol>

              <h2 className="xv-contact-side-title">Looking for something else?</h2>
              <ul className="xv-contact-links">
                <li><Link to="/careers">Open roles on the platform</Link></li>
                <li><Link to="/pricing">Plans and limits</Link></li>
                <li><Link to="/security">How we protect data</Link></li>
                <li><Link to="/candidate-privacy">Candidate privacy notice</Link></li>
              </ul>

              {(SITE.contactEmail || SITE.address) && (
                <>
                  <h2 className="xv-contact-side-title">Details</h2>
                  <address className="xv-contact-address">
                    {SITE.contactEmail && <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>}
                    {SITE.address && <span>{SITE.address}</span>}
                  </address>
                </>
              )}
            </aside>
          </div>
        </div>
      </section>
    </>
  )
}
