import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const TOKEN = 'tok_abc123'

vi.mock('react-router-dom', () => ({ useParams: () => ({ token: TOKEN }) }))

const { default: OfferAcceptance } = await import('./OfferAcceptance')

const OFFER = {
  job_title: 'Senior Engineer',
  company_name: 'Acme Bank',
  salary: '£70,000',
  benefits: 'Private healthcare',
  joining_date: '2026-11-01',
  status: 'sent',
}

function mockFetch(opts: { acceptOk?: boolean; declineOk?: boolean } = {}) {
  const { acceptOk = true, declineOk = true } = opts
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    if (u.endsWith(`/offers/public/${TOKEN}/accept`)) {
      return { ok: acceptOk, status: acceptOk ? 200 : 500, json: async () => ({}) }
    }
    if (u.endsWith(`/offers/public/${TOKEN}/decline`)) {
      return { ok: declineOk, status: declineOk ? 200 : 500, json: async () => ({}) }
    }
    if (u.endsWith(`/offers/public/${TOKEN}`)) {
      return { ok: true, status: 200, json: async () => OFFER }
    }
    throw new Error(`Unexpected fetch call: ${u} ${JSON.stringify(init)}`)
  }))
}

describe('OfferAcceptance', () => {
  beforeEach(() => {
    mockFetch()
  })

  it('keeps Accept disabled until both a typed name and consent are given', async () => {
    const user = userEvent.setup()
    render(<OfferAcceptance />)

    const acceptBtn = await screen.findByRole('button', { name: /accept/i })
    expect(acceptBtn).toBeDisabled()

    await user.type(screen.getByLabelText(/type your full name/i), 'Jane Doe')
    expect(acceptBtn).toBeDisabled()

    await user.click(screen.getByRole('checkbox'))
    expect(acceptBtn).not.toBeDisabled()
  })

  it('treats a whitespace-only name as not provided', async () => {
    const user = userEvent.setup()
    render(<OfferAcceptance />)

    const acceptBtn = await screen.findByRole('button', { name: /accept/i })
    await user.type(screen.getByLabelText(/type your full name/i), '   ')
    await user.click(screen.getByRole('checkbox'))

    expect(acceptBtn).toBeDisabled()
  })

  it('submits typed_name and consent: true to the accept endpoint once both are provided', async () => {
    const user = userEvent.setup()
    render(<OfferAcceptance />)

    await user.type(await screen.findByLabelText(/type your full name/i), 'Jane Doe')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /accept/i }))

    await waitFor(() => expect(screen.getByText(/Offer Accepted/i)).toBeInTheDocument())

    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(([u]) => String(u).endsWith('/accept'))
    expect(call).toBeTruthy()
    const [, init] = call!
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ typed_name: 'Jane Doe', consent: true })
  })

  it('shows an error and stays on the offer if the signed accept request fails', async () => {
    mockFetch({ acceptOk: false })
    const user = userEvent.setup()
    render(<OfferAcceptance />)

    await user.type(await screen.findByLabelText(/type your full name/i), 'Jane Doe')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /accept/i }))

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument()
    expect(screen.queryByText(/Offer Accepted/i)).not.toBeInTheDocument()
  })

  it('leaves decline unaffected: no typed name/consent required, and no new fields sent', async () => {
    const user = userEvent.setup()
    render(<OfferAcceptance />)

    await user.click(await screen.findByRole('button', { name: /^decline$/i }))
    await user.click(screen.getByRole('button', { name: /confirm decline/i }))

    await waitFor(() => expect(screen.getByText(/Response Recorded/i)).toBeInTheDocument())

    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(([u]) => String(u).endsWith('/decline'))
    expect(call).toBeTruthy()
    const [, init] = call!
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({})
  })
})
