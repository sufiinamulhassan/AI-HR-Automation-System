import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const list = vi.fn()
const pdf = vi.fn()
const send = vi.fn()
const draftLetter = vi.fn()
const approveLetter = vi.fn()
const myPermissions = vi.fn()

vi.mock('../../../lib/api', () => ({
  authApi: {
    myPermissions: (...a: unknown[]) => myPermissions(...a),
  },
  offersApi: {
    list: (...a: unknown[]) => list(...a),
    create: vi.fn(),
    approve: vi.fn(),
    send: (...a: unknown[]) => send(...a),
    withdraw: vi.fn(),
    pdf: (...a: unknown[]) => pdf(...a),
    draftLetter: (...a: unknown[]) => draftLetter(...a),
    approveLetter: (...a: unknown[]) => approveLetter(...a),
  },
}))

const { default: OfferModal } = await import('./OfferModal')
const { useAuthStore } = await import('../../../store/auth.store')

function baseOffer(overrides: Record<string, unknown> = {}) {
  return {
    offer_id: 'off_1',
    candidate_id: 'cand_1',
    job_id: 'job_1',
    salary: '£70,000',
    status: 'sent',
    ...overrides,
  }
}

describe('OfferModal', () => {
  beforeEach(() => {
    list.mockReset()
    pdf.mockReset()
    send.mockReset()
    draftLetter.mockReset()
    approveLetter.mockReset()
    myPermissions.mockReset().mockResolvedValue({
      data: { permissions: ['offers:draft_letter', 'offers:approve_letter'] },
    })
    useAuthStore.setState({ token: 'test-token', user: { role: 'admin', email: 'admin@x.com' } })
  })

  it('offers a PDF download button that triggers an authenticated blob download', async () => {
    list.mockResolvedValue({ data: { offers: [baseOffer()] } })
    pdf.mockResolvedValue({ data: new Blob(['%PDF-1.4'], { type: 'application/pdf' }) })

    const createObjectURL = vi.fn(() => 'blob:mock-url')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })

    const user = userEvent.setup()
    render(<OfferModal candidateId="cand_1" onClose={() => {}} />)

    const pdfBtn = await screen.findByRole('button', { name: /pdf/i })
    await user.click(pdfBtn)

    await waitFor(() => expect(pdf).toHaveBeenCalledWith('off_1'))
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')

    vi.unstubAllGlobals()
  })

  it('renders the signature block, typed name and signed-at visible, IP/user-agent tucked behind a disclosure', async () => {
    list.mockResolvedValue({
      data: {
        offers: [baseOffer({
          status: 'accepted',
          responded_at: '2026-06-10T10:00:00Z',
          signature: {
            typed_name: 'Jane Doe',
            consented: true,
            ip_address: '203.0.113.4',
            user_agent: 'Mozilla/5.0 Test',
            signed_at: '2026-06-10T10:00:00Z',
            document_hash: 'abc123',
          },
        })],
      },
    })

    const user = userEvent.setup()
    render(<OfferModal candidateId="cand_1" onClose={() => {}} />)

    expect(await screen.findByText('Jane Doe')).toBeInTheDocument()
    expect(screen.getByText(/signed at/i)).toBeInTheDocument()

    expect(screen.getByText('203.0.113.4')).not.toBeVisible()
    expect(screen.getByText('Mozilla/5.0 Test')).not.toBeVisible()
    expect(screen.getByText('abc123')).not.toBeVisible()

    await user.click(screen.getByText(/signature details/i))
    expect(screen.getByText('203.0.113.4')).toBeVisible()
    expect(screen.getByText('Mozilla/5.0 Test')).toBeVisible()
    expect(screen.getByText('abc123')).toBeVisible()
  })

  it('renders no signature block for an offer that has not been signed', async () => {
    list.mockResolvedValue({ data: { offers: [baseOffer({ status: 'sent' })] } })

    render(<OfferModal candidateId="cand_1" onClose={() => {}} />)

    await screen.findByText('£70,000')
    expect(screen.queryByText(/signed by/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/signature details/i)).not.toBeInTheDocument()
  })

  it('hides admin-only actions (PDF download, approve/send/withdraw) for a non-admin role', async () => {
    useAuthStore.setState({ token: 'test-token', user: { role: 'standard', email: 'user@x.com' } })
    list.mockResolvedValue({ data: { offers: [baseOffer({ status: 'draft' })] } })

    render(<OfferModal candidateId="cand_1" onClose={() => {}} />)

    await screen.findByText('£70,000')
    expect(screen.queryByRole('button', { name: /pdf/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /draft ai letter/i })).not.toBeInTheDocument()
    expect(myPermissions).not.toHaveBeenCalled()
  })

  describe('AI-drafted letter', () => {
    it('drafts an AI letter and shows it awaiting approval', async () => {
      const user = userEvent.setup()
      list
        .mockResolvedValueOnce({ data: { offers: [baseOffer({ status: 'approved' })] } })
        .mockResolvedValueOnce({
          data: {
            offers: [baseOffer({
              status: 'approved', ai_letter_body: 'Welcome aboard, Jane!',
              ai_letter_source: 'ai', ai_letter_approved: false,
            })],
          },
        })
      draftLetter.mockResolvedValue({ data: {} })

      render(<OfferModal candidateId="cand_1" onClose={() => {}} />)

      const draftBtn = await screen.findByRole('button', { name: /draft ai letter/i })
      await user.click(draftBtn)

      await waitFor(() => expect(draftLetter).toHaveBeenCalledWith('off_1'))
      expect(await screen.findByText('Welcome aboard, Jane!')).toBeInTheDocument()
      expect(screen.getByText('Needs approval')).toBeInTheDocument()
    })

    it('approves a drafted letter, the action is only enabled while unapproved', async () => {
      const user = userEvent.setup()
      list
        .mockResolvedValueOnce({
          data: {
            offers: [baseOffer({
              status: 'approved', ai_letter_body: 'Welcome aboard, Jane!', ai_letter_approved: false,
            })],
          },
        })
        .mockResolvedValueOnce({
          data: {
            offers: [baseOffer({
              status: 'approved', ai_letter_body: 'Welcome aboard, Jane!', ai_letter_approved: true,
            })],
          },
        })
      approveLetter.mockResolvedValue({ data: {} })

      render(<OfferModal candidateId="cand_1" onClose={() => {}} />)

      const approveLetterBtn = await screen.findByRole('button', { name: /approve letter/i })
      expect(approveLetterBtn).not.toBeDisabled()
      await user.click(approveLetterBtn)

      await waitFor(() => expect(approveLetter).toHaveBeenCalledWith('off_1'))
      expect(await screen.findByRole('button', { name: /^approved$/i })).toBeDisabled()
      expect(screen.getAllByText('Approved')).toHaveLength(2)
    })

    it('does not offer AI-letter actions to an admin missing the specific permission', async () => {
      myPermissions.mockResolvedValue({ data: { permissions: [] } })
      list.mockResolvedValue({
        data: { offers: [baseOffer({ status: 'approved', ai_letter_body: 'Welcome aboard, Jane!' })] },
      })

      render(<OfferModal candidateId="cand_1" onClose={() => {}} />)

      expect(await screen.findByText('Welcome aboard, Jane!')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /draft ai letter/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /approve letter/i })).not.toBeInTheDocument()
    })

    it('surfaces the blocked-send 400 detail clearly instead of a generic failure toast', async () => {
      const user = userEvent.setup()
      list.mockResolvedValue({
        data: {
          offers: [baseOffer({
            status: 'approved', ai_letter_body: 'Welcome aboard, Jane!', ai_letter_approved: false,
          })],
        },
      })
      send.mockRejectedValue({
        response: { status: 400, data: { detail: 'AI-drafted letter content must be approved before sending' } },
      })

      render(<OfferModal candidateId="cand_1" onClose={() => {}} />)

      const sendBtn = await screen.findByRole('button', { name: /^send$/i })
      await user.click(sendBtn)

      await waitFor(() => expect(send).toHaveBeenCalledWith('off_1'))
      expect(await screen.findByText('AI-drafted letter content must be approved before sending')).toBeInTheDocument()
    })
  })
})
