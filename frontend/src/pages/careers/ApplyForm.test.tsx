import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apply = vi.hoisted(() => vi.fn())

vi.mock('../../lib/api', () => ({
  careersApi: { apply },
}))

const { default: ApplyForm } = await import('./ApplyForm')

const COMPANY = { name: 'Acme', privacy_url: null, terms_url: null }
const KIND_MESSAGE = 'Upload a PDF, Word (.doc or .docx) or plain text (.txt) file.'

function renderForm(company: { name: string; privacy_url?: string | null; terms_url?: string | null } = COMPANY) {
  return render(
    <MemoryRouter initialEntries={['/careers/job-1']}>
      <Routes>
        <Route path="/careers/job-1" element={<ApplyForm jobId="job-1" jobTitle="Senior Engineer" company={company} />} />
        <Route path="/careers" element={<div>All jobs page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

const user = () => userEvent.setup({ delay: null })
const resumeInput = () => screen.getByLabelText('Résumé file') as HTMLInputElement
const pdf = (name = 'cv.pdf', size = 2048) => {
  const file = new File(['%PDF-1.4'], name, { type: 'application/pdf' })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

async function fillValid(u: ReturnType<typeof user>, file: File = pdf()) {
  await u.type(screen.getByLabelText('Full name'), 'Ada Lovelace')
  await u.type(screen.getByLabelText('Email address'), 'ada@acme.test')
  await u.upload(resumeInput(), file)
  await u.click(screen.getByLabelText(/I agree/))
}

function sent(): FormData {
  return apply.mock.calls[0][1] as FormData
}

beforeEach(() => {
  apply.mockReset().mockResolvedValue({
    data: { status: 'received', application_id: 'app-1', reference: 'APP-7K2Q9', job_title: 'Senior Engineer', company_name: 'Acme' },
  })
})

describe('ApplyForm: client validation', () => {
  it('names every missing field, focuses the first one and does not send anything', async () => {
    const u = user()
    renderForm()
    await u.click(screen.getByRole('button', { name: 'Submit application' }))

    expect(screen.getByText('Enter your full name.')).toBeInTheDocument()
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument()
    expect(screen.getByText('Attach your résumé as a file.')).toBeInTheDocument()
    expect(screen.getByText('Please agree to the processing of your application to continue.')).toBeInTheDocument()
    expect(screen.getByLabelText('Full name')).toHaveFocus()
    expect(screen.getByLabelText('Full name')).toHaveAttribute('aria-invalid', 'true')
    expect(apply).not.toHaveBeenCalled()
  })

  it('does not treat the optional phone and note as missing', async () => {
    const u = user()
    renderForm()
    await u.click(screen.getByRole('button', { name: 'Submit application' }))
    expect(screen.queryByText(/valid phone number/)).not.toBeInTheDocument()
    expect(screen.queryByText(/at most 2000/)).not.toBeInTheDocument()
  })

  it('rejects a bad email and a bad phone number and clears each message once fixed', async () => {
    const u = user()
    renderForm()
    await u.type(screen.getByLabelText('Full name'), 'Ada Lovelace')
    await u.type(screen.getByLabelText('Email address'), 'ada@')
    await u.type(screen.getByLabelText(/^Phone/), 'call me')
    await u.upload(resumeInput(), pdf())
    await u.click(screen.getByLabelText(/I agree/))
    await u.click(screen.getByRole('button', { name: 'Submit application' }))

    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument()
    expect(screen.getByText('Enter a valid phone number, or leave it empty.')).toBeInTheDocument()
    expect(apply).not.toHaveBeenCalled()

    await u.type(screen.getByLabelText('Email address'), 'acme.test')
    expect(screen.queryByText('Enter a valid email address.')).not.toBeInTheDocument()
    await u.clear(screen.getByLabelText(/^Phone/))
    await u.type(screen.getByLabelText(/^Phone/), '+44 20 7946 0958')
    expect(screen.queryByText('Enter a valid phone number, or leave it empty.')).not.toBeInTheDocument()
  })

  it('shows a field message on leaving a field that is wrong', async () => {
    const u = user()
    renderForm()
    await u.type(screen.getByLabelText('Email address'), 'nope')
    await u.tab()
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument()
  })

  it('counts the note live and flags a note over 2000 characters', async () => {
    const u = user()
    renderForm()
    expect(screen.getByText('0/2000')).toBeInTheDocument()
    await u.type(screen.getByLabelText(/Note to the hiring team/), 'Hello')
    expect(screen.getByText('5/2000')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/Note to the hiring team/), { target: { value: 'a'.repeat(2001) } })
    expect(screen.getByText('2001/2000')).toHaveClass('is-over')

    await u.type(screen.getByLabelText('Full name'), 'Ada Lovelace')
    await u.type(screen.getByLabelText('Email address'), 'ada@acme.test')
    await u.upload(resumeInput(), pdf())
    await u.click(screen.getByLabelText(/I agree/))
    await u.click(screen.getByRole('button', { name: 'Submit application' }))
    expect(screen.getByText('Your note must be at most 2000 characters.')).toBeInTheDocument()
    expect(apply).not.toHaveBeenCalled()
  })
})

describe('ApplyForm: résumé file', () => {
  it('only offers the allowed file types in the picker and says so', () => {
    renderForm()
    expect(resumeInput()).toHaveAttribute('accept', '.pdf,.doc,.docx,.txt')
    expect(screen.getByText('PDF, DOC, DOCX or TXT, up to 4 MB')).toBeInTheDocument()
  })

  it('opens the file picker from the real button', async () => {
    const u = user()
    renderForm()
    const click = vi.spyOn(resumeInput(), 'click')
    await u.click(screen.getByRole('button', { name: /Drop your résumé here or browse files/ }))
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('shows the name and size of the chosen file and lets you remove it', async () => {
    const u = user()
    renderForm()
    await u.upload(resumeInput(), pdf('ada-cv.pdf', 12.34 * 1024))
    expect(screen.getByText('ada-cv.pdf')).toBeInTheDocument()
    expect(screen.getByText('12.3 KB')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /browse files/ })).not.toBeInTheDocument()

    await u.click(screen.getByRole('button', { name: 'Remove' }))
    expect(screen.queryByText('ada-cv.pdf')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /browse files/ })).toHaveFocus()
  })

  it('accepts a file dropped on the zone', () => {
    const { container } = renderForm()
    const zone = container.querySelector('.cr-drop') as HTMLElement
    fireEvent.dragOver(zone)
    expect(zone).toHaveClass('is-dragging')
    fireEvent.drop(zone, { dataTransfer: { files: [pdf('dropped.pdf', 1024)] } })
    expect(zone).not.toHaveClass('is-dragging')
    expect(screen.getByText('dropped.pdf')).toBeInTheDocument()
    expect(screen.getByText('1 KB')).toBeInTheDocument()
  })

  it('rejects a file type that is not allowed and keeps no file', () => {
    renderForm()
    fireEvent.change(resumeInput(), { target: { files: [new File(['x'], 'photo.png', { type: 'image/png' })] } })
    expect(screen.getByText(KIND_MESSAGE)).toBeInTheDocument()
    expect(screen.queryByText('photo.png')).not.toBeInTheDocument()
  })

  it('accepts a Word 97 to 2003 .doc file', () => {
    renderForm()
    fireEvent.change(resumeInput(), { target: { files: [new File(['x'], 'old.doc', { type: 'application/msword' })] } })
    expect(screen.queryByText(KIND_MESSAGE)).not.toBeInTheDocument()
    expect(screen.getByText('old.doc')).toBeInTheDocument()
  })

  it('still rejects the Word macro and template types it cannot read', () => {
    renderForm()
    fireEvent.change(resumeInput(), { target: { files: [new File(['x'], 'macro.docm')] } })
    expect(screen.getByText(KIND_MESSAGE)).toBeInTheDocument()
    expect(screen.queryByText('macro.docm')).not.toBeInTheDocument()
  })

  it('rejects a dropped file of the wrong type too', () => {
    const { container } = renderForm()
    fireEvent.drop(container.querySelector('.cr-drop') as HTMLElement, {
      dataTransfer: { files: [new File(['x'], 'run.exe')] },
    })
    expect(screen.getByText(KIND_MESSAGE)).toBeInTheDocument()
  })

  it('rejects a file over 4 MB and an empty file', () => {
    renderForm()
    fireEvent.change(resumeInput(), { target: { files: [pdf('big.pdf', 4 * 1024 * 1024 + 1)] } })
    expect(screen.getByText('The file is too large. The limit is 4 MB.')).toBeInTheDocument()
    expect(screen.queryByText('big.pdf')).not.toBeInTheDocument()

    fireEvent.change(resumeInput(), { target: { files: [pdf('empty.pdf', 0)] } })
    expect(screen.getByText('That file is empty.')).toBeInTheDocument()
  })

  it('takes a valid file after a rejected one and drops the message', () => {
    renderForm()
    fireEvent.change(resumeInput(), { target: { files: [new File(['x'], 'photo.png')] } })
    expect(screen.getByText(KIND_MESSAGE)).toBeInTheDocument()
    fireEvent.change(resumeInput(), { target: { files: [pdf('good.pdf')] } })
    expect(screen.queryByText(KIND_MESSAGE)).not.toBeInTheDocument()
    expect(screen.getByText('good.pdf')).toBeInTheDocument()
  })
})

describe('ApplyForm: consent links', () => {
  it('links the privacy policy and the terms in the consent label, each in a new tab', () => {
    renderForm({ name: 'Acme', privacy_url: 'https://acme.test/privacy', terms_url: 'https://acme.test/terms' })
    const label = screen.getByLabelText(/I agree/)
    expect(label).toBeInTheDocument()
    const privacy = screen.getByRole('link', { name: 'Privacy policy' })
    const terms = screen.getByRole('link', { name: 'Terms' })
    expect(privacy).toHaveAttribute('href', 'https://acme.test/privacy')
    expect(terms).toHaveAttribute('href', 'https://acme.test/terms')
    for (const link of [privacy, terms]) {
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noreferrer')
    }
    expect(privacy.closest('label')).toBe(terms.closest('label'))
  })

  it('shows only the links the company has set and ignores unsafe addresses', () => {
    renderForm({ name: 'Acme', privacy_url: 'https://acme.test/privacy', terms_url: 'javascript:alert(1)' })
    expect(screen.getByRole('link', { name: 'Privacy policy' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Terms' })).not.toBeInTheDocument()
  })

  it('shows no links when the company has none', () => {
    renderForm()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('names the company in the consent sentence', () => {
    renderForm()
    expect(screen.getByLabelText(/Acme may process my application/)).toBeInTheDocument()
  })
})

describe('ApplyForm: honeypot', () => {
  it('has a hidden website field that keyboard users and screen readers skip', () => {
    const { container } = renderForm()
    const field = container.querySelector('input[name="website"]') as HTMLInputElement
    expect(field).toBeInTheDocument()
    expect(field).toHaveAttribute('tabindex', '-1')
    expect(field).toHaveAttribute('autocomplete', 'off')
    expect(field.closest('[aria-hidden="true"]')).not.toBeNull()
    expect(field.value).toBe('')
  })

  it('always sends the website field empty', async () => {
    const u = user()
    const { container } = renderForm()
    await fillValid(u)
    fireEvent.change(container.querySelector('input[name="website"]') as HTMLInputElement, { target: { value: 'https://spam.test' } })
    await u.click(screen.getByRole('button', { name: 'Submit application' }))
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1))
    expect(sent().has('website')).toBe(true)
    expect(sent().get('website')).toBe('')
  })
})

describe('ApplyForm: sending', () => {
  it('sends the trimmed fields, consent and the file as multipart form data', async () => {
    const u = user()
    renderForm()
    await u.type(screen.getByLabelText('Full name'), '  Ada   Lovelace ')
    await u.type(screen.getByLabelText('Email address'), ' ada@acme.test ')
    await u.type(screen.getByLabelText(/^Phone/), ' +44 20 7946 0958 ')
    await u.type(screen.getByLabelText(/Note to the hiring team/), '  Happy to relocate.  ')
    await u.upload(resumeInput(), pdf('ada-cv.pdf'))
    await u.click(screen.getByLabelText(/I agree/))
    await u.click(screen.getByRole('button', { name: 'Submit application' }))

    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1))
    expect(apply.mock.calls[0][0]).toBe('job-1')
    const body = sent()
    expect(body).toBeInstanceOf(FormData)
    expect(body.get('name')).toBe('Ada Lovelace')
    expect(body.get('email')).toBe('ada@acme.test')
    expect(body.get('phone')).toBe('+44 20 7946 0958')
    expect(body.get('cover_note')).toBe('Happy to relocate.')
    expect(body.get('consent')).toBe('true')
    const file = body.get('resume') as File
    expect(file).toBeInstanceOf(File)
    expect(file.name).toBe('ada-cv.pdf')
  })

  it('leaves out the phone and the note when they are empty', async () => {
    const u = user()
    renderForm()
    await fillValid(u)
    await u.click(screen.getByRole('button', { name: 'Submit application' }))
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1))
    expect(sent().has('phone')).toBe(false)
    expect(sent().has('cover_note')).toBe(false)
  })

  it('waits with a disabled button while sending and cannot be sent twice', async () => {
    const u = user()
    let resolve!: (v: unknown) => void
    apply.mockReturnValue(new Promise(r => { resolve = r }))
    const { container } = renderForm()
    await fillValid(u)
    await u.click(screen.getByRole('button', { name: 'Submit application' }))

    const busy = screen.getByRole('button', { name: 'Submitting' })
    expect(busy).toBeDisabled()
    expect(container.querySelector('.cr-spinner')).not.toBeNull()
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)
    expect(apply).toHaveBeenCalledTimes(1)

    resolve({ data: { status: 'received', application_id: 'a', reference: 'APP-1', job_title: 'Senior Engineer', company_name: 'Acme' } })
    expect(await screen.findByRole('heading', { name: 'Application received' })).toBeInTheDocument()
  })

  it('replaces the form with a success panel that names the job, the company and the reference', async () => {
    const u = user()
    renderForm()
    await fillValid(u)
    await u.click(screen.getByRole('button', { name: 'Submit application' }))

    const heading = await screen.findByRole('heading', { name: 'Application received' })
    expect(heading).toHaveFocus()
    const panel = screen.getByRole('status')
    expect(panel).toHaveTextContent('Senior Engineer at Acme')
    expect(within(panel).getByText('APP-7K2Q9')).toBeInTheDocument()
    expect(screen.queryByLabelText('Full name')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Submit application' })).not.toBeInTheDocument()

    const more = screen.getByRole('link', { name: 'Browse more jobs' })
    expect(more).toHaveAttribute('href', '/careers')
    await u.click(more)
    expect(await screen.findByText('All jobs page')).toBeInTheDocument()
  })

  it('falls back to the job and company it was given when the answer carries none', async () => {
    const u = user()
    apply.mockResolvedValue({ data: { status: 'received', application_id: '', reference: '', job_title: '', company_name: '' } })
    renderForm()
    await fillValid(u)
    await u.click(screen.getByRole('button', { name: 'Submit application' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Senior Engineer at Acme')
    expect(screen.queryByText('Reference')).not.toBeInTheDocument()
  })
})

describe('ApplyForm: server errors', () => {
  async function submitWith(error: unknown) {
    const u = user()
    apply.mockRejectedValue(error)
    renderForm()
    await fillValid(u)
    await u.click(screen.getByRole('button', { name: 'Submit application' }))
  }

  it('shows the text the server sent in an alert next to the button and keeps the form filled', async () => {
    await submitWith({ response: { status: 409, data: { detail: 'You have already applied to this job with this email address.' } } })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('You have already applied to this job with this email address.')
    expect(alert.parentElement).toContainElement(screen.getByRole('button', { name: 'Submit application' }))
    expect(screen.getByLabelText('Full name')).toHaveValue('Ada Lovelace')
    expect(screen.getByLabelText('Email address')).toHaveValue('ada@acme.test')
    expect(screen.getByText('cv.pdf')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit application' })).toBeEnabled())
  })

  it.each([
    [400, 'Enter a valid phone number, or leave it empty.'],
    [404, 'This job is no longer open.'],
    [413, 'The file is too large. The limit is 4 MB.'],
    [415, 'That file does not look like a valid PDF document.'],
    [422, 'We could not read any text in this file. Upload a PDF made from text, not a scan, or a Word or text file.'],
    [429, 'Too many applications from this connection. Try again later.'],
    [503, 'This company is not accepting applications right now. Please try again later.'],
  ])('shows the server text for a %i', async (status, detail) => {
    await submitWith({ response: { status, data: { detail } } })
    expect(await screen.findByRole('alert')).toHaveTextContent(detail)
  })

  it('says the server could not be reached when there is no answer', async () => {
    await submitWith(new Error('Network Error'))
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not reach the server')
  })

  it('clears the old error when the next send starts', async () => {
    const u = user()
    apply.mockRejectedValueOnce({ response: { status: 503, data: { detail: 'Closed for now.' } } })
    renderForm()
    await fillValid(u)
    await u.click(screen.getByRole('button', { name: 'Submit application' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Closed for now.')

    await u.click(screen.getByRole('button', { name: 'Submit application' }))
    expect(await screen.findByRole('heading', { name: 'Application received' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
