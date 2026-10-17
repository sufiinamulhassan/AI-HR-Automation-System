import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const list = vi.fn()
const update = vi.fn()
const reset = vi.fn()

vi.mock('../../../lib/api', () => ({
  promptConfigApi: {
    list: (...a: unknown[]) => list(...a),
    update: (...a: unknown[]) => update(...a),
    reset: (...a: unknown[]) => reset(...a),
  },
}))

const { default: PromptConfigPanel } = await import('./PromptConfigPanel')

const showToast = vi.fn()

function httpError(status: number, detail: unknown) {
  return { response: { status, data: { detail } } }
}

const PROMPT = {
  key: 'jd_parse', label: 'JD parsing', description: 'Reads a job description',
  placeholders: ['jd_text'], is_customized: false,
  system_prompt: 'You parse JDs.', user_prompt_template: 'Parse {jd_text}',
  default_system_prompt: 'You parse JDs.', default_user_prompt_template: 'Parse {jd_text}',
  updated_by: null, updated_at: null,
}

beforeEach(() => {
  list.mockReset().mockResolvedValue({ data: { prompts: [PROMPT] } })
  update.mockReset().mockResolvedValue({ data: {} })
  reset.mockReset()
  showToast.mockReset()
})

describe('AI Prompts panel', () => {
  it('lists the prompts', async () => {
    render(<PromptConfigPanel showToast={showToast} />)

    expect(await screen.findByText('JD parsing')).toBeInTheDocument()
    expect(screen.getByText('Default')).toBeInTheDocument()
  })

  it('shows the empty state for a list that loaded and is genuinely empty', async () => {
    list.mockResolvedValue({ data: { prompts: [] } })
    render(<PromptConfigPanel showToast={showToast} />)

    expect(await screen.findByText('No prompt definitions found.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows an error with Retry, not the empty state, when the list cannot be loaded', async () => {
    const user = userEvent.setup()
    list.mockRejectedValueOnce(httpError(500, 'Prompt store unavailable'))
    render(<PromptConfigPanel showToast={showToast} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Prompt store unavailable')
    expect(screen.queryByText('No prompt definitions found.')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('JD parsing')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('falls back to a generic message when the failure carries no detail', async () => {
    list.mockRejectedValue(new Error('Network Error'))
    render(<PromptConfigPanel showToast={showToast} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the prompts.')
  })

  it('hands the toast a string even when a save is rejected with a validation list', async () => {
    const user = userEvent.setup()
    update.mockRejectedValue(httpError(422, [{ msg: 'too long' }]))
    render(<PromptConfigPanel showToast={showToast} />)

    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Save Override' }))

    await vi.waitFor(() => expect(showToast).toHaveBeenCalledWith('Failed to save prompt'))
  })

  it('shows a missing-placeholders 422 under the editor and leaves Save usable', async () => {
    const user = userEvent.setup()
    update.mockRejectedValueOnce(httpError(422, 'Missing placeholders: {jd_text}'))
    render(<PromptConfigPanel showToast={showToast} />)

    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    const modal = document.querySelector('.modal-box') as HTMLElement
    const template = within(modal).getByLabelText('User Prompt Template')
    await user.clear(template)
    await user.type(template, 'Parse the posting')
    await user.click(within(modal).getByRole('button', { name: 'Save Override' }))

    const alert = await within(modal).findByRole('alert')
    expect(alert).toHaveTextContent('Missing placeholders: {jd_text}')
    expect(template.closest('.pc-field')).toContainElement(alert)
    expect(showToast).not.toHaveBeenCalled()
    expect(within(modal).getByRole('button', { name: 'Save Override' })).toBeEnabled()
    expect(template).toHaveValue('Parse the posting')
  })

  it('clears the message once the template is edited, and saves the fix', async () => {
    const user = userEvent.setup()
    update.mockRejectedValueOnce(httpError(422, 'Missing placeholders: {jd_text}'))
    render(<PromptConfigPanel showToast={showToast} />)

    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    const modal = document.querySelector('.modal-box') as HTMLElement
    const template = within(modal).getByLabelText('User Prompt Template')
    await user.clear(template)
    await user.type(template, 'Parse the posting')
    await user.click(within(modal).getByRole('button', { name: 'Save Override' }))
    await within(modal).findByRole('alert')

    await user.type(template, ' {{jd_text}')
    expect(within(modal).queryByRole('alert')).not.toBeInTheDocument()
    await user.click(within(modal).getByRole('button', { name: 'Save Override' }))

    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(2))
    expect(update.mock.calls[1][1]).toMatchObject({ user_prompt_template: 'Parse the posting {jd_text}' })
    await vi.waitFor(() => expect(document.querySelector('.modal-box')).toBeNull())
    expect(showToast).toHaveBeenCalledWith('"JD parsing" prompt updated')
  })

  it('does not carry a previous error into the next editor that is opened', async () => {
    const user = userEvent.setup()
    update.mockRejectedValueOnce(httpError(422, 'Missing placeholders: {jd_text}'))
    render(<PromptConfigPanel showToast={showToast} />)

    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    let modal = document.querySelector('.modal-box') as HTMLElement
    await user.click(within(modal).getByRole('button', { name: 'Save Override' }))
    await within(modal).findByRole('alert')
    await user.click(within(modal).getByRole('button', { name: 'Cancel' }))

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    modal = document.querySelector('.modal-box') as HTMLElement
    expect(within(modal).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps other save failures as a toast', async () => {
    const user = userEvent.setup()
    update.mockRejectedValue(httpError(403, 'Not allowed'))
    render(<PromptConfigPanel showToast={showToast} />)

    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Save Override' }))

    await vi.waitFor(() => expect(showToast).toHaveBeenCalledWith('Not allowed'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
