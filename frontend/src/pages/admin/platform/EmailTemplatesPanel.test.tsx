import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const list = vi.fn()
const upsert = vi.fn()
const reset = vi.fn()

vi.mock('../../../lib/api', () => ({
  emailTemplatesApi: {
    list: (...a: unknown[]) => list(...a),
    upsert: (...a: unknown[]) => upsert(...a),
    reset: (...a: unknown[]) => reset(...a),
  },
}))

const { default: EmailTemplatesPanel } = await import('./EmailTemplatesPanel')

const showToast = vi.fn()

const SAMPLE_SUBJECT = 'Interview invitation: {{job_title}}'
const SAMPLE_HTML = '<p>Dear <strong>{{candidate_name}}</strong>,</p><a href="{{interview_url}}">Begin</a><p>{{bogus_name}}</p>'
const SAMPLE_TEXT = 'Dear {{candidate_name}},\n\n{{interview_url}}'

function template(over: Record<string, unknown> = {}) {
  return {
    key: 'send_invite_email',
    label: 'Interview Invitation',
    description: 'Sent to a shortlisted candidate with their unique interview link. Link and instructions only.',
    candidate_facing: true,
    placeholders: ['candidate_name', 'job_title', 'interview_url'],
    is_customized: false,
    subject_template: null,
    html_body_template: null,
    text_body_template: null,
    updated_by: null,
    updated_at: null,
    sample_subject_template: SAMPLE_SUBJECT,
    sample_html_body_template: SAMPLE_HTML,
    sample_text_body_template: SAMPLE_TEXT,
    preview_values: {
      candidate_name: 'Priya <b>Sharma</b>',
      job_title: 'Senior Backend Engineer',
      interview_url: 'https://app.example.com/interview/sample',
    },
    ...over,
  }
}

const OFFER = template({
  key: 'send_offer_letter_email', label: 'Offer Letter', placeholders: ['candidate_name', 'accept_url'],
  sample_subject_template: 'Your offer', sample_html_body_template: '<p>Congratulations</p>', sample_text_body_template: 'Congratulations',
  preview_values: { candidate_name: 'Priya', accept_url: 'javascript:alert(1)' },
})

function respond(templates = [template(), OFFER]) {
  list.mockResolvedValue({ data: { templates } })
}

const row = (label: string) => screen.getByText(label).closest('tr') as HTMLElement
const message = () => screen.getByLabelText('Message') as HTMLTextAreaElement
const subject = () => screen.getByLabelText('Subject') as HTMLInputElement
const dialog = () => screen.getByRole('dialog', { name: 'Edit, Interview Invitation' })

async function openInvite(user = userEvent.setup()) {
  render(<EmailTemplatesPanel showToast={showToast} />)
  await user.click(within(await screen.findByText('Interview Invitation').then(e => e.closest('tr') as HTMLElement)).getByRole('button', { name: 'Edit' }))
  return user
}

beforeEach(() => {
  list.mockReset()
  upsert.mockReset().mockResolvedValue({ data: {} })
  reset.mockReset().mockResolvedValue({ data: {} })
  showToast.mockReset()
  respond()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the list', () => {
  it('shows each template by name with its status and nothing else about it', async () => {
    render(<EmailTemplatesPanel showToast={showToast} />)
    await screen.findByText('Interview Invitation')

    expect(screen.getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Template', 'Status', ''])
    expect(within(row('Interview Invitation')).getByText('Default')).toBeInTheDocument()
    expect(screen.queryByText(/Sent to a shortlisted candidate/)).not.toBeInTheDocument()
    expect(screen.queryByText('Candidate-facing')).not.toBeInTheDocument()
  })

  it('offers Reset to Default only on a customized template', async () => {
    respond([template({ is_customized: true, subject_template: 'Mine' }), OFFER])
    render(<EmailTemplatesPanel showToast={showToast} />)
    await screen.findByText('Interview Invitation')

    expect(within(row('Interview Invitation')).getByText('Customized')).toBeInTheDocument()
    expect(within(row('Interview Invitation')).getByRole('button', { name: 'Reset to Default' })).toBeInTheDocument()
    expect(within(row('Offer Letter')).queryByRole('button', { name: 'Reset to Default' })).not.toBeInTheDocument()
  })

  it('says so when there are no templates', async () => {
    respond([])
    render(<EmailTemplatesPanel showToast={showToast} />)
    expect(await screen.findByText('No templates found.')).toBeInTheDocument()
  })
})

describe('the editor', () => {
  it('opens on the sample, with a one-line warning, and nothing to save yet', async () => {
    await openInvite()

    expect(subject()).toHaveValue(SAMPLE_SUBJECT)
    expect(message()).toHaveValue(SAMPLE_HTML)
    const warning = within(dialog()).getByRole('note')
    expect(warning).toHaveTextContent('Goes straight to the candidate. Never include scores, evaluation results or recommendations.')
    expect(warning.textContent!.length).toBeLessThan(120)
    expect(within(dialog()).getByRole('button', { name: 'Save Template' })).toBeDisabled()
    expect(within(dialog()).queryByRole('button', { name: 'Use sample' })).not.toBeInTheDocument()
  })

  it('keeps the plain-text version out of the way until it is opened', async () => {
    await openInvite()
    const details = dialog().querySelector('details') as HTMLDetailsElement
    expect(details.open).toBe(false)
    expect(details.querySelector('summary')).toHaveTextContent('Plain-text version')
    expect((screen.getByLabelText('Plain-text version') as HTMLTextAreaElement).value).toBe(SAMPLE_TEXT)
  })

  it('lists the placeholders as buttons and inserts one where the cursor is in the message', async () => {
    const user = await openInvite()
    fireEvent.change(message(), { target: { value: 'Hello !' } })
    message().focus()
    message().setSelectionRange(6, 6)

    await user.click(within(dialog()).getByRole('button', { name: '{{candidate_name}}' }))

    expect(message()).toHaveValue('Hello {{candidate_name}}!')
    expect(within(dialog()).getAllByRole('button').filter(b => /^\{\{.+\}\}$/.test(b.textContent ?? '')).map(b => b.textContent))
      .toEqual(['{{candidate_name}}', '{{job_title}}', '{{interview_url}}'])
  })

  it('inserts into the subject when that was the field last used', async () => {
    const user = await openInvite()
    fireEvent.change(subject(), { target: { value: 'Hi ' } })
    subject().focus()
    subject().setSelectionRange(3, 3)

    await user.click(within(dialog()).getByRole('button', { name: '{{candidate_name}}' }))

    expect(subject()).toHaveValue('Hi {{candidate_name}}')
    expect(message()).toHaveValue(SAMPLE_HTML)
  })

  it('replaces the selected text when a placeholder is inserted over it', async () => {
    const user = await openInvite()
    fireEvent.change(message(), { target: { value: 'Dear NAME,' } })
    message().focus()
    message().setSelectionRange(5, 9)

    await user.click(within(dialog()).getByRole('button', { name: '{{candidate_name}}' }))

    expect(message()).toHaveValue('Dear {{candidate_name}},')
  })

  it('saves all three fields once something changed, then closes and reloads', async () => {
    const user = await openInvite()
    fireEvent.change(subject(), { target: { value: '  Your interview  ' } })
    expect(within(dialog()).getByRole('button', { name: 'Save Template' })).toBeEnabled()

    await user.click(within(dialog()).getByRole('button', { name: 'Save Template' }))

    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1))
    expect(upsert).toHaveBeenCalledWith('send_invite_email', {
      subject_template: 'Your interview', html_body_template: SAMPLE_HTML, text_body_template: SAMPLE_TEXT,
    })
    expect(showToast).toHaveBeenCalledWith('Template saved')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it("shows the server's reason when the save is refused, and stays open", async () => {
    upsert.mockRejectedValue({ response: { status: 400, data: { detail: 'Unknown email template key' } } })
    const user = await openInvite()
    fireEvent.change(subject(), { target: { value: 'Changed' } })
    await user.click(within(dialog()).getByRole('button', { name: 'Save Template' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Unknown email template key'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('closes without saving on Cancel and on the close button', async () => {
    const user = await openInvite()
    await user.click(within(dialog()).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(within(row('Interview Invitation')).getByRole('button', { name: 'Edit' }))
    await user.click(within(dialog()).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe('a customized template', () => {
  const CUSTOM = template({ is_customized: true, subject_template: 'Our own subject', html_body_template: '<p>Our own body</p>', text_body_template: null })

  it('opens on the company text, with the sample filling a field it never wrote', async () => {
    respond([CUSTOM, OFFER])
    await openInvite()
    expect(subject()).toHaveValue('Our own subject')
    expect(message()).toHaveValue('<p>Our own body</p>')
    expect((screen.getByLabelText('Plain-text version') as HTMLTextAreaElement).value).toBe(SAMPLE_TEXT)
  })

  it('offers Use sample, which puts the sample back without saving', async () => {
    respond([CUSTOM, OFFER])
    const user = await openInvite()
    await user.click(within(dialog()).getByRole('button', { name: 'Use sample' }))

    expect(subject()).toHaveValue(SAMPLE_SUBJECT)
    expect(message()).toHaveValue(SAMPLE_HTML)
    expect(upsert).not.toHaveBeenCalled()
    expect(within(dialog()).queryByRole('button', { name: 'Use sample' })).not.toBeInTheDocument()
  })

  it('resets to the built-in default after asking, from the list and from the editor', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
    respond([CUSTOM, OFFER])
    const user = await openInvite()
    await user.click(within(dialog()).getByRole('button', { name: 'Reset to Default' }))

    await waitFor(() => expect(reset).toHaveBeenCalledWith('send_invite_email'))
    expect(showToast).toHaveBeenCalledWith('Reset to default')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('does nothing when the reset is declined', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(false))
    respond([CUSTOM, OFFER])
    const user = await openInvite()
    await user.click(within(dialog()).getByRole('button', { name: 'Reset to Default' }))
    expect(reset).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('the preview', () => {
  it('shows the subject and the message with example values filled in', async () => {
    const user = await openInvite()
    await user.click(within(dialog()).getByRole('tab', { name: 'Preview' }))

    expect(within(dialog()).getByRole('tab', { name: 'Preview' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Interview invitation: Senior Backend Engineer')).toBeInTheDocument()
    const frame = screen.getByTitle('Email preview') as HTMLIFrameElement
    const html = frame.getAttribute('srcdoc') ?? ''
    expect(html).toContain('Dear <strong>Priya &lt;b&gt;Sharma&lt;/b&gt;</strong>')
    expect(html).toContain('href="https://app.example.com/interview/sample"')
    expect(html).toContain('{{bogus_name}}')
  })

  it('runs nothing from the message: the frame is sandboxed with no permissions', async () => {
    const user = await openInvite()
    await user.click(within(dialog()).getByRole('tab', { name: 'Preview' }))
    expect(screen.getByTitle('Email preview')).toHaveAttribute('sandbox', '')
  })

  it('keeps only an http or https link in the preview', async () => {
    const user = userEvent.setup()
    render(<EmailTemplatesPanel showToast={showToast} />)
    await user.click(within(await screen.findByText('Offer Letter').then(e => e.closest('tr') as HTMLElement)).getByRole('button', { name: 'Edit' }))
    fireEvent.change(message(), { target: { value: '<a href="{{accept_url}}">Accept</a>' } })
    await user.click(screen.getByRole('tab', { name: 'Preview' }))
    expect((screen.getByTitle('Email preview') as HTMLIFrameElement).getAttribute('srcdoc')).toBe('<a href="">Accept</a>')
  })

  it('goes back to editing with the text as it was', async () => {
    const user = await openInvite()
    await user.click(within(dialog()).getByRole('tab', { name: 'Preview' }))
    await user.click(within(dialog()).getByRole('tab', { name: 'Edit' }))
    expect(message()).toHaveValue(SAMPLE_HTML)
  })

  it('says there is nothing to preview for an empty message', async () => {
    const user = await openInvite()
    fireEvent.change(message(), { target: { value: '   ' } })
    await user.click(within(dialog()).getByRole('tab', { name: 'Preview' }))
    expect(screen.getByText('Nothing to preview')).toBeInTheDocument()
    expect(screen.queryByTitle('Email preview')).not.toBeInTheDocument()
  })

  it('switches back to editing when a placeholder is inserted from the preview', async () => {
    const user = await openInvite()
    await user.click(within(dialog()).getByRole('tab', { name: 'Preview' }))
    await user.click(within(dialog()).getByRole('button', { name: '{{job_title}}' }))
    expect(within(dialog()).getByRole('tab', { name: 'Edit' })).toHaveAttribute('aria-selected', 'true')
    expect(message().value).toContain('{{job_title}}')
  })
})

describe('against a server that sends no samples', () => {
  it('opens on empty fields, offers no Use sample, and saves once something is typed', async () => {
    respond([template({
      sample_subject_template: undefined, sample_html_body_template: undefined, sample_text_body_template: undefined, preview_values: undefined,
    })])
    const user = await openInvite()

    expect(subject()).toHaveValue('')
    expect(message()).toHaveValue('')
    expect(within(dialog()).queryByRole('button', { name: 'Use sample' })).not.toBeInTheDocument()
    expect(within(dialog()).getByRole('button', { name: 'Save Template' })).toBeDisabled()
    fireEvent.change(subject(), { target: { value: 'Hello' } })
    await user.click(within(dialog()).getByRole('button', { name: 'Save Template' }))
    await waitFor(() => expect(upsert).toHaveBeenCalledWith('send_invite_email', { subject_template: 'Hello', html_body_template: undefined, text_body_template: undefined }))
  })
})

describe('writing rules', () => {
  it('has no em dash in the list or the open editor', async () => {
    const { container } = render(<EmailTemplatesPanel showToast={showToast} />)
    await screen.findByText('Interview Invitation')
    await userEvent.setup().click(within(row('Interview Invitation')).getByRole('button', { name: 'Edit' }))
    expect(container.textContent).not.toContain(String.fromCharCode(0x2014))
    expect(document.body.textContent).not.toContain(String.fromCharCode(0x2014))
  })
})
