import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { careersApi } from '../../lib/api'
import type { CareersApplyResult } from '../../lib/careersTypes'
import {
  APPLICATION_FIELDS, MAX_RESUME_MB, NOTE_MAX, RESUME_ACCEPT, applyErrorMessage, collapseSpaces,
  formatFileSize, safeHttpUrl, validateApplication, validateField,
  type ApplicationErrors, type ApplicationField, type ApplicationValues,
} from './careersFormat'
import './ApplyForm.css'

interface Props {
  jobId: string
  jobTitle: string
  company: {
    name: string
    privacy_url?: string | null
    terms_url?: string | null
  }
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return <p className="cr-field-error" id={id}>{message}</p>
}

export default function ApplyForm({ jobId, jobTitle, company }: Props) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [consent, setConsent] = useState(false)
  const [resume, setResume] = useState<File | null>(null)
  const [errors, setErrors] = useState<ApplicationErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [done, setDone] = useState<CareersApplyResult | null>(null)

  const nameRef = useRef<HTMLInputElement | null>(null)
  const emailRef = useRef<HTMLInputElement | null>(null)
  const phoneRef = useRef<HTMLInputElement | null>(null)
  const noteRef = useRef<HTMLTextAreaElement | null>(null)
  const consentRef = useRef<HTMLInputElement | null>(null)
  const browseRef = useRef<HTMLButtonElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const refocusBrowse = useRef(false)

  const privacyUrl = safeHttpUrl(company.privacy_url)
  const termsUrl = safeHttpUrl(company.terms_url)

  useEffect(() => {
    if (done) headingRef.current?.focus()
  }, [done])

  useEffect(() => {
    if (!resume && refocusBrowse.current) {
      refocusBrowse.current = false
      browseRef.current?.focus()
    }
  }, [resume])

  function values(patch: Partial<ApplicationValues> = {}): ApplicationValues {
    return { name, email, phone, note, consent, resume, ...patch }
  }

  function revalidate(field: ApplicationField, patch: Partial<ApplicationValues> = {}) {
    const message = validateField(field, values(patch))
    setErrors(prev => {
      if (!message && !prev[field]) return prev
      const next = { ...prev }
      if (message) next[field] = message
      else delete next[field]
      return next
    })
  }

  function clearError(field: ApplicationField) {
    setErrors(prev => {
      if (!prev[field]) return prev
      const next = { ...prev }
      delete next[field]
      return next
    })
  }

  function focusField(field: ApplicationField) {
    const targets: Record<ApplicationField, HTMLElement | null> = {
      name: nameRef.current,
      email: emailRef.current,
      phone: phoneRef.current,
      note: noteRef.current,
      consent: consentRef.current,
      resume: browseRef.current,
    }
    targets[field]?.focus()
  }

  function pickFile(file: File | null | undefined) {
    if (!file) return
    const message = validateField('resume', values({ resume: file }))
    if (message) {
      setResume(null)
      setErrors(prev => ({ ...prev, resume: message }))
      return
    }
    setResume(file)
    clearError('resume')
  }

  function onFileInput(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    pickFile(file)
  }

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    if (!dragging) setDragging(true)
  }

  function onDragLeave(e: DragEvent<HTMLDivElement>) {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    setDragging(false)
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragging(false)
    pickFile(e.dataTransfer?.files?.[0])
  }

  function removeFile() {
    refocusBrowse.current = true
    setResume(null)
    clearError('resume')
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (submitting) return
    setSubmitError('')
    const found = validateApplication(values())
    setErrors(found)
    const first = APPLICATION_FIELDS.find(field => found[field])
    if (first) {
      focusField(first)
      return
    }

    const body = new FormData()
    body.append('name', collapseSpaces(name))
    body.append('email', email.trim())
    if (phone.trim()) body.append('phone', collapseSpaces(phone))
    if (note.trim()) body.append('cover_note', note.trim())
    body.append('consent', 'true')
    body.append('website', '')
    body.append('resume', resume as File)

    setSubmitting(true)
    try {
      const r = await careersApi.apply(jobId, body)
      setDone(r.data)
    } catch (err: unknown) {
      setSubmitError(applyErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    const role = done.job_title || jobTitle
    const at = done.company_name || company.name
    return (
      <section className="cr-apply cr-apply-done" id="apply" aria-labelledby="cr-apply-title">
        <div className="cr-success" role="status">
          <span className="cr-success-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 12.5 4.5 4.5L19 7.5" />
            </svg>
          </span>
          <h2 className="cr-apply-title" id="cr-apply-title" tabIndex={-1} ref={headingRef}>Application received</h2>
          <p className="cr-success-role">{role} at {at}</p>
          <p className="cr-success-text">
            The hiring team will review your résumé and get in touch if it is a match.
          </p>
          {done.reference && (
            <div className="cr-success-ref">
              <span className="cr-success-ref-label">Reference</span>
              <code className="cr-success-ref-code">{done.reference}</code>
            </div>
          )}
          <Link to="/careers" className="btn btn-primary cr-success-link">Browse more jobs</Link>
        </div>
      </section>
    )
  }

  const noteLength = note.length

  return (
    <section className="cr-apply" id="apply" aria-labelledby="cr-apply-title">
      <h2 className="cr-apply-title" id="cr-apply-title">Apply for this role</h2>
      <p className="cr-apply-sub">It takes about a minute. Your résumé goes straight to {company.name}.</p>

      <form className="cr-apply-form" onSubmit={handleSubmit} noValidate>
        <div className="cr-field">
          <label className="form-label" htmlFor="cr-apply-name">Full name</label>
          <input
            id="cr-apply-name"
            ref={nameRef}
            className="form-input"
            type="text"
            autoComplete="name"
            value={name}
            onChange={e => { setName(e.target.value); if (errors.name) revalidate('name', { name: e.target.value }) }}
            onBlur={() => revalidate('name')}
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? 'cr-apply-name-error' : undefined}
          />
          <FieldError id="cr-apply-name-error" message={errors.name} />
        </div>

        <div className="cr-field">
          <label className="form-label" htmlFor="cr-apply-email">Email address</label>
          <input
            id="cr-apply-email"
            ref={emailRef}
            className="form-input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={e => { setEmail(e.target.value); if (errors.email) revalidate('email', { email: e.target.value }) }}
            onBlur={() => revalidate('email')}
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? 'cr-apply-email-error' : undefined}
          />
          <FieldError id="cr-apply-email-error" message={errors.email} />
        </div>

        <div className="cr-field">
          <label className="form-label" htmlFor="cr-apply-phone">
            Phone <span className="cr-optional">(optional)</span>
          </label>
          <input
            id="cr-apply-phone"
            ref={phoneRef}
            className="form-input"
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={e => { setPhone(e.target.value); if (errors.phone) revalidate('phone', { phone: e.target.value }) }}
            onBlur={() => revalidate('phone')}
            aria-invalid={!!errors.phone}
            aria-describedby={errors.phone ? 'cr-apply-phone-error' : undefined}
          />
          <FieldError id="cr-apply-phone-error" message={errors.phone} />
        </div>

        <div className="cr-field">
          <span className="form-label" id="cr-apply-resume-label">Résumé</span>
          <div
            className={`cr-drop${dragging ? ' is-dragging' : ''}${errors.resume ? ' has-error' : ''}${resume ? ' has-file' : ''}`}
            onDragEnter={onDragOver}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            <input
              ref={fileInputRef}
              className="cr-visually-hidden"
              type="file"
              accept={RESUME_ACCEPT}
              tabIndex={-1}
              aria-hidden="true"
              aria-label="Résumé file"
              onChange={onFileInput}
            />
            {resume ? (
              <div className="cr-file">
                <span className="cr-file-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                    <path d="M14 3v5h5" />
                  </svg>
                </span>
                <span className="cr-file-meta">
                  <span className="cr-file-name">{resume.name}</span>
                  <span className="cr-file-size">{formatFileSize(resume.size)}</span>
                </span>
                <button type="button" className="cr-file-remove" onClick={removeFile}>Remove</button>
              </div>
            ) : (
              <button
                type="button"
                ref={browseRef}
                className="cr-drop-button"
                aria-labelledby="cr-apply-resume-label cr-apply-resume-action"
                aria-describedby={errors.resume ? 'cr-apply-resume-error' : 'cr-apply-resume-hint'}
                onClick={() => fileInputRef.current?.click()}
              >
                <span className="cr-drop-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 16V4" />
                    <path d="m7 9 5-5 5 5" />
                    <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
                  </svg>
                </span>
                <span className="cr-drop-text" id="cr-apply-resume-action">
                  Drop your résumé here or <span className="cr-drop-link">browse files</span>
                </span>
                <span className="cr-drop-hint" id="cr-apply-resume-hint">PDF, DOC, DOCX or TXT, up to {MAX_RESUME_MB} MB</span>
              </button>
            )}
          </div>
          <FieldError id="cr-apply-resume-error" message={errors.resume} />
        </div>

        <div className="cr-field">
          <label className="form-label" htmlFor="cr-apply-note">
            Note to the hiring team <span className="cr-optional">(optional)</span>
          </label>
          <textarea
            id="cr-apply-note"
            ref={noteRef}
            className="form-input cr-textarea"
            rows={4}
            value={note}
            onChange={e => { setNote(e.target.value); if (errors.note) revalidate('note', { note: e.target.value }) }}
            onBlur={() => revalidate('note')}
            aria-invalid={!!errors.note}
            aria-describedby={errors.note ? 'cr-apply-note-error cr-apply-note-count' : 'cr-apply-note-count'}
          />
          <div className="cr-note-foot">
            <FieldError id="cr-apply-note-error" message={errors.note} />
            <span className={`cr-counter${noteLength > NOTE_MAX ? ' is-over' : ''}`} id="cr-apply-note-count">
              {noteLength}/{NOTE_MAX}
            </span>
          </div>
        </div>

        <div className="cr-field">
          <label className="cr-consent" htmlFor="cr-apply-consent">
            <input
              id="cr-apply-consent"
              ref={consentRef}
              type="checkbox"
              checked={consent}
              onChange={e => { setConsent(e.target.checked); if (errors.consent) revalidate('consent', { consent: e.target.checked }) }}
              aria-invalid={!!errors.consent}
              aria-describedby={errors.consent ? 'cr-apply-consent-error' : undefined}
            />
            <span className="cr-consent-text">
              I agree that {company.name} may process my application and résumé to consider me for this role.
              {(privacyUrl || termsUrl) && (
                <span className="cr-consent-links">
                  {privacyUrl && <a href={privacyUrl} target="_blank" rel="noreferrer">Privacy policy</a>}
                  {termsUrl && <a href={termsUrl} target="_blank" rel="noreferrer">Terms</a>}
                </span>
              )}
            </span>
          </label>
          <FieldError id="cr-apply-consent-error" message={errors.consent} />
        </div>

        <div className="cr-hp" aria-hidden="true">
          <label>
            Website
            <input type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
          </label>
        </div>

        <div className="cr-submit">
          {submitError && <div className="cr-form-error" role="alert">{submitError}</div>}
          <button type="submit" className="btn btn-primary btn-lg cr-submit-button" disabled={submitting}>
            {submitting && <span className="cr-spinner" aria-hidden="true" />}
            {submitting ? 'Submitting' : 'Submit application'}
          </button>
        </div>
      </form>
    </section>
  )
}
