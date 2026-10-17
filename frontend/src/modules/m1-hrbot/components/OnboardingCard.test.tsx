import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const onboarding = vi.fn()
const dismissOnboarding = vi.fn()

vi.mock('../../../lib/api', () => ({
  companySettingsApi: {
    onboarding: (...a: unknown[]) => onboarding(...a),
    dismissOnboarding: (...a: unknown[]) => dismissOnboarding(...a),
  },
}))

const { default: OnboardingCard } = await import('./OnboardingCard')

const STEPS = [
  { key: 'profile', label: 'Complete the company profile', done: true },
  { key: 'branding', label: 'Add your logo and colours', done: true },
  { key: 'users', label: 'Invite your team', done: false },
  { key: 'job', label: 'Create your first job', done: false },
  { key: 'resume', label: 'Upload résumés', done: false },
]

function renderCard() {
  return render(
    <MemoryRouter>
      <OnboardingCard />
    </MemoryRouter>,
  )
}

const card = () => screen.findByRole('region', { name: 'Get started' })

beforeEach(() => {
  onboarding.mockReset().mockResolvedValue({ data: { steps: STEPS, dismissed: false } })
  dismissOnboarding.mockReset().mockResolvedValue({ data: { dismissed: true } })
})

describe('OnboardingCard', () => {
  it('shows nothing while it is loading', () => {
    onboarding.mockReturnValue(new Promise(() => {}))
    const { container } = renderCard()
    expect(container).toBeEmptyDOMElement()
  })

  it('lists every step with how many are done', async () => {
    renderCard()
    const c = within(await card())

    expect(c.getByRole('heading', { name: 'Get started' })).toBeInTheDocument()
    expect(c.getByText('2 of 5')).toBeInTheDocument()
    expect(c.getAllByRole('listitem').map(li => li.textContent)).toEqual([
      'Complete the company profileDone',
      'Add your logo and coloursDone',
      'Invite your teamTo do',
      'Create your first jobTo do',
      'Upload résumésTo do',
    ])
  })

  it('marks a finished step as done and the others as still to do', async () => {
    renderCard()
    const c = within(await card())
    const rows = c.getAllByRole('listitem')
    expect(rows[0]).toHaveClass('ob-row-done')
    expect(rows[2]).not.toHaveClass('ob-row-done')
  })

  it('links each step to the page where it is done', async () => {
    renderCard()
    const c = within(await card())

    expect(c.getByRole('link', { name: 'Complete the company profile' })).toHaveAttribute('href', '/dashboard/organization')
    expect(c.getByRole('link', { name: 'Add your logo and colours' })).toHaveAttribute('href', '/dashboard/organization?tab=branding')
    expect(c.getByRole('link', { name: 'Invite your team' })).toHaveAttribute('href', '/dashboard/users')
    expect(c.getByRole('link', { name: 'Create your first job' })).toHaveAttribute('href', '/dashboard/hrbot')
    expect(c.getByRole('link', { name: 'Upload résumés' })).toHaveAttribute('href', '/dashboard/resumes')
  })

  it('shows a step it has no page for as plain text', async () => {
    onboarding.mockResolvedValue({ data: { steps: [{ key: 'billing', label: 'Add a payment method', done: false }], dismissed: false } })
    renderCard()
    const c = within(await card())
    expect(c.getByText('Add a payment method')).toBeInTheDocument()
    expect(c.queryByRole('link')).not.toBeInTheDocument()
  })

  it('is hidden once it has been dismissed', async () => {
    onboarding.mockResolvedValue({ data: { steps: STEPS, dismissed: true } })
    const { container } = renderCard()
    await waitFor(() => expect(onboarding).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('is hidden once every step is done', async () => {
    onboarding.mockResolvedValue({ data: { steps: STEPS.map(s => ({ ...s, done: true })), dismissed: false } })
    const { container } = renderCard()
    await waitFor(() => expect(onboarding).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('is hidden when there are no steps', async () => {
    onboarding.mockResolvedValue({ data: { steps: [], dismissed: false } })
    const { container } = renderCard()
    await waitFor(() => expect(onboarding).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('puts nothing on the page when it cannot be read', async () => {
    onboarding.mockRejectedValue({ response: { status: 500, data: { detail: 'Settings unavailable' } } })
    const { container } = renderCard()
    await waitFor(() => expect(onboarding).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('dismisses with one request and goes away', async () => {
    const user = userEvent.setup()
    const { container } = renderCard()
    await card()

    await user.click(screen.getByRole('button', { name: 'Dismiss' }))

    await waitFor(() => expect(container).toBeEmptyDOMElement())
    expect(dismissOnboarding).toHaveBeenCalledTimes(1)
  })

  it('waits while the dismissal is out', async () => {
    const user = userEvent.setup()
    let resolve!: (v: unknown) => void
    dismissOnboarding.mockReturnValue(new Promise(r => { resolve = r }))
    renderCard()
    await card()

    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.getByRole('button', { name: 'Dismissing…' })).toBeDisabled()

    resolve({ data: { dismissed: true } })
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Get started' })).not.toBeInTheDocument())
  })

  it('stays, and says so, when the dismissal fails, then lets the admin try again', async () => {
    const user = userEvent.setup()
    dismissOnboarding.mockRejectedValueOnce(new Error('Network Error'))
    renderCard()
    await card()

    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not dismiss. Try again.')
    expect(screen.getByRole('region', { name: 'Get started' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Get started' })).not.toBeInTheDocument())
    expect(dismissOnboarding).toHaveBeenCalledTimes(2)
  })

  it('shows titles, labels and numbers only', async () => {
    renderCard()
    const c = await card()
    expect(c.querySelector('p')).toBeNull()
    expect(c.querySelector('[class*="-sub"]')).toBeNull()
    expect(c.querySelector('[class*="-note"]')).toBeNull()
    expect(c.textContent).not.toContain(String.fromCharCode(0x2014))
  })
})
