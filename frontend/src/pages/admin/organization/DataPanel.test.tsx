import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getRetention = vi.fn()
const updateRetention = vi.fn()
const eraseByEmail = vi.fn()

vi.mock('../../../lib/api', () => ({
  companySettingsApi: {
    getRetention: (...a: unknown[]) => getRetention(...a),
    updateRetention: (...a: unknown[]) => updateRetention(...a),
  },
  candidatesApi: { eraseByEmail: (...a: unknown[]) => eraseByEmail(...a) },
}))

const { default: DataPanel } = await import('./DataPanel')

const FOREVER = { candidate_days: null, resume_days: null, updated_at: null, updated_by: null, last_purge: null }
const KEPT = {
  candidate_days: 365, resume_days: 90, updated_at: '2026-10-01T10:00:00Z', updated_by: 'sam@acme.test',
  last_purge: { at: '2026-10-10T03:00:00Z', candidates_erased: 4, resumes_erased: 11 },
}

function httpError(status: number, detail: unknown) {
  return { response: { status, data: { detail } } }
}

const showToast = vi.fn()
const user = () => userEvent.setup({ delay: null })
const retention = () => screen.getByText('Retention', { selector: '.card-title' }).closest('.card') as HTMLElement
const eraser = () => screen.getByText('Erase a person by email', { selector: '.card-title' }).closest('.card') as HTMLElement

async function renderPanel() {
  render(<DataPanel showToast={showToast} />)
  await screen.findByLabelText('Erase candidates after (days)')
}

beforeEach(() => {
  for (const fn of [getRetention, updateRetention, eraseByEmail, showToast]) fn.mockReset()
  getRetention.mockResolvedValue({ data: FOREVER })
  updateRetention.mockImplementation(async (d: object) => ({ data: { ...FOREVER, ...d } }))
  eraseByEmail.mockResolvedValue({ data: { matched: 2, candidate_ids: ['c1', 'c2'], counts: { resumes: 3, transcripts: 1, notes: 0 }, vectors_failed: 0 } })
})

describe('retention', () => {
  it('keeps everything for ever by default, with both switches on and the day boxes empty', async () => {
    await renderPanel()
    const r = within(retention())
    expect(r.getAllByLabelText('Keep for ever')).toHaveLength(2)
    for (const box of r.getAllByLabelText('Keep for ever')) expect(box).toBeChecked()
    expect(r.getByLabelText('Erase candidates after (days)')).toBeDisabled()
    expect(r.getByLabelText('Erase résumés with no candidate after (days)')).toBeDisabled()
    expect(r.getByText('No purge has run yet')).toBeInTheDocument()
  })

  it('shows the periods that are set and when the last purge ran, with what it erased', async () => {
    getRetention.mockResolvedValue({ data: KEPT })
    await renderPanel()
    const r = within(retention())
    expect(r.getByLabelText('Erase candidates after (days)')).toHaveValue('365')
    expect(r.getByLabelText('Erase résumés with no candidate after (days)')).toHaveValue('90')
    expect(r.getAllByLabelText('Keep for ever').every(b => !(b as HTMLInputElement).checked)).toBe(true)
    expect(r.getByText(/Last purge .*: 4 candidates and 11 résumés erased/)).toBeInTheDocument()
  })

  it('keeps Save disabled until something changes', async () => {
    await renderPanel()
    expect(within(retention()).getByRole('button', { name: 'Save Changes' })).toBeDisabled()
  })

  it('turns a period on with the switch and sends the days, leaving the other alone', async () => {
    const u = user()
    await renderPanel()
    const r = within(retention())
    await u.click(r.getAllByLabelText('Keep for ever')[0])
    const days = r.getByLabelText('Erase candidates after (days)')
    expect(days).toBeEnabled()
    await u.clear(days)
    await u.type(days, '180')
    await u.click(r.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(updateRetention).toHaveBeenCalledWith({ candidate_days: 180 }))
    expect(showToast).toHaveBeenCalledWith('Retention saved')
  })

  it('sends null when a period goes back to keep for ever', async () => {
    getRetention.mockResolvedValue({ data: KEPT })
    const u = user()
    await renderPanel()
    const r = within(retention())
    await u.click(r.getAllByLabelText('Keep for ever')[1])
    await u.click(r.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(updateRetention).toHaveBeenCalledWith({ resume_days: null }))
  })

  it.each(['29', '0', '12.5', 'abc', ''])('refuses %j days before asking the server, saying the minimum', async value => {
    getRetention.mockResolvedValue({ data: KEPT })
    const u = user()
    await renderPanel()
    const r = within(retention())
    const days = r.getByLabelText('Erase candidates after (days)')
    await u.clear(days)
    if (value) await u.type(days, value)
    await u.click(r.getByRole('button', { name: 'Save Changes' }))

    expect(await r.findByRole('alert')).toHaveTextContent('Use a whole number of days, 30 or more.')
    expect(updateRetention).not.toHaveBeenCalled()
  })

  it('refuses more than 36,500 days', async () => {
    getRetention.mockResolvedValue({ data: KEPT })
    const u = user()
    await renderPanel()
    const r = within(retention())
    const days = r.getByLabelText('Erase candidates after (days)')
    await u.clear(days)
    await u.type(days, '40000')
    await u.click(r.getByRole('button', { name: 'Save Changes' }))
    expect(await r.findByRole('alert')).toHaveTextContent('Use at most 36,500 days.')
  })

  it('accepts exactly 30 days', async () => {
    const u = user()
    await renderPanel()
    const r = within(retention())
    await u.click(r.getAllByLabelText('Keep for ever')[0])
    await u.clear(r.getByLabelText('Erase candidates after (days)'))
    await u.type(r.getByLabelText('Erase candidates after (days)'), '30')
    await u.click(r.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(updateRetention).toHaveBeenCalledWith({ candidate_days: 30 }))
  })

  it('shows the server sentence for a refused save', async () => {
    updateRetention.mockRejectedValue(httpError(422, 'candidate_days must be at least 30'))
    getRetention.mockResolvedValue({ data: KEPT })
    const u = user()
    await renderPanel()
    const r = within(retention())
    await u.clear(r.getByLabelText('Erase candidates after (days)'))
    await u.type(r.getByLabelText('Erase candidates after (days)'), '31')
    await u.click(r.getByRole('button', { name: 'Save Changes' }))
    expect(await r.findByText('candidate_days must be at least 30')).toBeInTheDocument()
  })

  it('shows a failed read with a retry', async () => {
    getRetention.mockRejectedValueOnce(new Error('Network Error')).mockResolvedValueOnce({ data: FOREVER })
    render(<DataPanel showToast={showToast} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the retention settings.')
    await user().click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByLabelText('Erase candidates after (days)')).toBeInTheDocument()
  })
})

describe('erasing a person by email', () => {
  async function fill(u: ReturnType<typeof user>, email = 'ann@example.com', reason = 'Asked to be forgotten') {
    const e = within(eraser())
    await u.type(e.getByLabelText('Email address'), email)
    await u.type(e.getByLabelText('Reason'), reason)
  }

  it('needs an email address and a reason of at least three characters before Erase is enabled', async () => {
    const u = user()
    await renderPanel()
    const e = within(eraser())
    const erase = e.getByRole('button', { name: 'Erase' })
    expect(erase).toBeDisabled()
    await u.type(e.getByLabelText('Email address'), 'ann@example.com')
    expect(erase).toBeDisabled()
    await u.type(e.getByLabelText('Reason'), 'ab')
    expect(erase).toBeDisabled()
    await u.type(e.getByLabelText('Reason'), 'c')
    expect(erase).toBeEnabled()
  })

  it('does not offer the employment choice before the server asks for it', async () => {
    await renderPanel()
    expect(screen.queryByLabelText('Also erase their offer and employee records')).not.toBeInTheDocument()
  })

  it('asks for ERASE to be typed, and sends nothing until it is', async () => {
    const u = user()
    await renderPanel()
    await fill(u)
    await u.click(within(eraser()).getByRole('button', { name: 'Erase' }))

    const dialog = await screen.findByRole('dialog', { name: 'Erase ann@example.com?' })
    const go = within(dialog).getByRole('button', { name: 'Erase everything' })
    expect(go).toBeDisabled()
    await u.type(within(dialog).getByLabelText('Type ERASE to confirm'), 'erase')
    expect(go).toBeDisabled()
    await u.clear(within(dialog).getByLabelText('Type ERASE to confirm'))
    await u.type(within(dialog).getByLabelText('Type ERASE to confirm'), 'ERASE')
    expect(go).toBeEnabled()
    expect(eraseByEmail).not.toHaveBeenCalled()
  })

  it('does nothing when the dialog is cancelled', async () => {
    const u = user()
    await renderPanel()
    await fill(u)
    await u.click(within(eraser()).getByRole('button', { name: 'Erase' }))
    const dialog = await screen.findByRole('dialog')
    await u.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(eraseByEmail).not.toHaveBeenCalled()
    expect(within(eraser()).getByLabelText('Email address')).toHaveValue('ann@example.com')
  })

  it('erases with the trimmed email and reason, then shows how many and what was removed, and clears the form', async () => {
    const u = user()
    await renderPanel()
    await fill(u, ' ann@example.com ', '  Asked to be forgotten  ')
    await u.click(within(eraser()).getByRole('button', { name: 'Erase' }))
    const dialog = await screen.findByRole('dialog')
    await u.type(within(dialog).getByLabelText('Type ERASE to confirm'), 'ERASE')
    await u.click(within(dialog).getByRole('button', { name: 'Erase everything' }))

    await waitFor(() => expect(eraseByEmail).toHaveBeenCalledWith({ email: 'ann@example.com', reason: 'Asked to be forgotten' }))
    const result = await within(eraser()).findByRole('status')
    expect(result).toHaveTextContent('Erased 2 candidate records.')
    expect(result).toHaveTextContent('resumes 3, transcripts 1')
    expect(result).not.toHaveTextContent('notes')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(within(eraser()).getByLabelText('Email address')).toHaveValue('')
  })

  it('says one record in the singular', async () => {
    eraseByEmail.mockResolvedValue({ data: { matched: 1, counts: { resumes: 1 }, vectors_failed: 0 } })
    const u = user()
    await renderPanel()
    await fill(u)
    await u.click(within(eraser()).getByRole('button', { name: 'Erase' }))
    await u.type(await screen.findByLabelText('Type ERASE to confirm'), 'ERASE')
    await u.click(screen.getByRole('button', { name: 'Erase everything' }))
    expect(await within(eraser()).findByRole('status')).toHaveTextContent('Erased 1 candidate record.')
  })

  it('says no candidate has that email when none matched', async () => {
    eraseByEmail.mockResolvedValue({ data: { matched: 0, candidate_ids: [], counts: {}, vectors_failed: 0 } })
    const u = user()
    await renderPanel()
    await fill(u)
    await u.click(within(eraser()).getByRole('button', { name: 'Erase' }))
    await u.type(await screen.findByLabelText('Type ERASE to confirm'), 'ERASE')
    await u.click(screen.getByRole('button', { name: 'Erase everything' }))
    expect(await within(eraser()).findByRole('status')).toHaveTextContent('No candidate has that email address.')
  })

  it('warns when some search entries could not be removed', async () => {
    eraseByEmail.mockResolvedValue({ data: { matched: 1, counts: { resumes: 1 }, vectors_failed: 3 } })
    const u = user()
    await renderPanel()
    await fill(u)
    await u.click(within(eraser()).getByRole('button', { name: 'Erase' }))
    await u.type(await screen.findByLabelText('Type ERASE to confirm'), 'ERASE')
    await u.click(screen.getByRole('button', { name: 'Erase everything' }))
    expect(await within(eraser()).findByText(/search entries could not be removed yet/)).toBeInTheDocument()
  })

  it('after a 409 shows the server sentence and the employment choice, and retries with it ticked', async () => {
    const sentence = 'This person has an accepted offer or an employee record. Confirm that employment records may be erased as well to continue.'
    eraseByEmail.mockRejectedValueOnce(httpError(409, sentence))
    const u = user()
    await renderPanel()
    await fill(u)
    await u.click(within(eraser()).getByRole('button', { name: 'Erase' }))
    await u.type(await screen.findByLabelText('Type ERASE to confirm'), 'ERASE')
    await u.click(screen.getByRole('button', { name: 'Erase everything' }))

    expect(await within(eraser()).findByText(sentence)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const box = within(eraser()).getByLabelText('Also erase their offer and employee records')
    expect(box).not.toBeChecked()
    expect(within(eraser()).getByLabelText('Email address')).toHaveValue('ann@example.com')

    await u.click(box)
    await u.click(within(eraser()).getByRole('button', { name: 'Erase' }))
    await u.type(await screen.findByLabelText('Type ERASE to confirm'), 'ERASE')
    await u.click(screen.getByRole('button', { name: 'Erase everything' }))
    await waitFor(() => expect(eraseByEmail).toHaveBeenLastCalledWith({
      email: 'ann@example.com', reason: 'Asked to be forgotten', include_employment: true,
    }))
    expect(await within(eraser()).findByRole('status')).toHaveTextContent('Erased 2 candidate records.')
    expect(within(eraser()).queryByLabelText('Also erase their offer and employee records')).not.toBeInTheDocument()
  })

  it('keeps the dialog open with the sentence for any other refusal', async () => {
    eraseByEmail.mockRejectedValue(httpError(403, 'You do not have permission to do this'))
    const u = user()
    await renderPanel()
    await fill(u)
    await u.click(within(eraser()).getByRole('button', { name: 'Erase' }))
    await u.type(await screen.findByLabelText('Type ERASE to confirm'), 'ERASE')
    await u.click(screen.getByRole('button', { name: 'Erase everything' }))
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('You do not have permission to do this')
    expect(screen.queryByLabelText('Also erase their offer and employee records')).not.toBeInTheDocument()
  })
})
