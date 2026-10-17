import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clientRow, companyRow, httpError } from '../../test/platformFixtures'

const deleteCompany = vi.fn()
const deleteClient = vi.fn()

vi.mock('../../lib/api', () => ({
  platformApi: {
    deleteCompany: (...a: unknown[]) => deleteCompany(...a),
    deleteClient: (...a: unknown[]) => deleteClient(...a),
  },
}))

const { DeleteClientDialog, DeleteCompanyDialog } = await import('./DeleteDialogs')

const COMPANY = companyRow()
const CLIENT = clientRow()

const user = () => userEvent.setup({ delay: null })
const round = (deleted: Record<string, number>, extra: { complete?: boolean; remaining?: number } = {}) => ({
  data: { complete: false, deleted, ...extra },
})

function renderCompany() {
  const onDone = vi.fn()
  const onClose = vi.fn()
  render(<DeleteCompanyDialog company={COMPANY} onClose={onClose} onDone={onDone} />)
  return { onDone, onClose }
}

async function confirmCompany(u: ReturnType<typeof user>, label = 'Delete company') {
  const dialog = screen.getByRole('dialog', { name: 'Delete Acme Corp?' })
  await u.type(within(dialog).getByLabelText('Type acme-corp to confirm'), 'acme-corp')
  await u.click(within(dialog).getByRole('button', { name: label }))
  return dialog
}

beforeEach(() => {
  deleteCompany.mockReset()
  deleteClient.mockReset()
})

describe('DeleteCompanyDialog', () => {
  it('says the deletion is permanent and asks for the slug', () => {
    renderCompany()
    const dialog = screen.getByRole('dialog', { name: 'Delete Acme Corp?' })
    expect(dialog).toHaveTextContent(/permanently deletes the company and everything in it/i)
    expect(dialog).toHaveTextContent(/cannot be undone/i)
    expect(within(dialog).getByLabelText('Type acme-corp to confirm')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Delete company' })).toBeDisabled()
  })

  it('keeps the button off until what is typed is the slug exactly', async () => {
    const u = user()
    renderCompany()
    const dialog = screen.getByRole('dialog')
    const field = within(dialog).getByLabelText('Type acme-corp to confirm')
    const button = within(dialog).getByRole('button', { name: 'Delete company' })

    await u.type(field, 'acme-cor')
    expect(button).toBeDisabled()
    await u.type(field, 'x')
    expect(button).toBeDisabled()
    await u.clear(field)
    await u.type(field, 'ACME-CORP')
    expect(button).toBeDisabled()
    await u.clear(field)
    await u.type(field, ' acme-corp ')
    expect(button).toBeEnabled()
  })

  it('does nothing without the slug, even from the keyboard', async () => {
    const u = user()
    renderCompany()
    await u.type(within(screen.getByRole('dialog')).getByLabelText('Type acme-corp to confirm'), 'nope{Enter}')
    expect(deleteCompany).not.toHaveBeenCalled()
  })

  it('deletes with the company\'s own slug and reports the rows once the server says it is done', async () => {
    const u = user()
    deleteCompany.mockResolvedValue({ data: { complete: true, deleted: { jobs: 4, resumes: 100 } } })
    const { onDone } = renderCompany()
    await confirmCompany(u)

    await waitFor(() => expect(onDone).toHaveBeenCalledWith(104))
    expect(deleteCompany).toHaveBeenCalledTimes(1)
    expect(deleteCompany).toHaveBeenCalledWith('cmp_acme', 'acme-corp')
  })

  it('asks again while the answer is not complete, shows the rows gone so far, and finishes on complete', async () => {
    const u = user()
    let release!: (v: unknown) => void
    deleteCompany
      .mockResolvedValueOnce(round({ jobs: 10, resumes: 5 }, { remaining: 100 }))
      .mockReturnValueOnce(new Promise(r => { release = r }))
      .mockResolvedValueOnce({ data: { complete: true, deleted: { jobs: 10, resumes: 45, users: 3 } } })
    const { onDone } = renderCompany()
    const dialog = await confirmCompany(u)

    expect(await within(dialog).findByRole('status')).toHaveTextContent('15 rows deleted, 100 left')
    expect(within(dialog).getByRole('button', { name: 'Deleting…' })).toBeDisabled()
    expect(onDone).not.toHaveBeenCalled()

    release(round({ jobs: 10, resumes: 45 }, { remaining: 60 }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(58))
    expect(deleteCompany).toHaveBeenCalledTimes(3)
    for (const call of deleteCompany.mock.calls) expect(call).toEqual(['cmp_acme', 'acme-corp'])
  })

  it('shows only the rows when the server does not say how many are left', async () => {
    const u = user()
    let release!: (v: unknown) => void
    deleteCompany
      .mockResolvedValueOnce(round({ jobs: 7 }))
      .mockReturnValueOnce(new Promise(r => { release = r }))
    renderCompany()
    const dialog = await confirmCompany(u)

    expect(await within(dialog).findByRole('status')).toHaveTextContent(/^7 rows deleted$/)
    release({ data: { complete: true, deleted: { jobs: 7 } } })
  })

  it('cannot be cancelled, closed or typed into while it is working', async () => {
    const u = user()
    deleteCompany.mockReturnValue(new Promise(() => {}))
    const { onClose } = renderCompany()
    const dialog = await confirmCompany(u)

    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(within(dialog).getByLabelText('Type acme-corp to confirm')).toBeDisabled()
    await u.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('stops on an error with the server message, keeps the count, and carries on from there when asked', async () => {
    const u = user()
    deleteCompany
      .mockResolvedValueOnce(round({ jobs: 10, resumes: 5 }, { remaining: 100 }))
      .mockRejectedValueOnce(httpError(502, 'Could not reach the search index.'))
      .mockResolvedValueOnce({ data: { complete: true, deleted: { jobs: 10, resumes: 5, users: 3 } } })
    const { onDone } = renderCompany()
    const dialog = await confirmCompany(u)

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Could not reach the search index.')
    expect(within(dialog).getByRole('status')).toHaveTextContent('15 rows deleted')
    expect(deleteCompany).toHaveBeenCalledTimes(2)
    expect(onDone).not.toHaveBeenCalled()

    await u.click(within(dialog).getByRole('button', { name: 'Continue deleting' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(18))
    expect(deleteCompany).toHaveBeenCalledTimes(3)
  })

  it('shows a plain message when the failure carries none', async () => {
    const u = user()
    deleteCompany.mockRejectedValue(new Error('Network Error'))
    renderCompany()
    const dialog = await confirmCompany(u)
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Could not delete the company.')
  })

  it('gives up when round after round removes nothing and is still not complete', async () => {
    const u = user()
    deleteCompany.mockResolvedValue(round({}, { remaining: 12 }))
    const { onDone } = renderCompany()
    const dialog = await confirmCompany(u)

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The deletion stopped making progress. Try again in a moment.')
    expect(deleteCompany).toHaveBeenCalledTimes(3)
    expect(onDone).not.toHaveBeenCalled()
  })

  it('does not give up on a slow round: a stalled one between busy ones resets the count', async () => {
    const u = user()
    deleteCompany
      .mockResolvedValueOnce(round({ a: 1 }))
      .mockResolvedValueOnce(round({ a: 1 }))
      .mockResolvedValueOnce(round({ a: 1 }))
      .mockResolvedValueOnce(round({ a: 2 }))
      .mockResolvedValueOnce(round({ a: 2 }))
      .mockResolvedValueOnce(round({ a: 2 }))
      .mockResolvedValueOnce({ data: { complete: true, deleted: { a: 2 } } })
    const { onDone } = renderCompany()
    await confirmCompany(u)
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(2))
    expect(deleteCompany).toHaveBeenCalledTimes(7)
  })

  it('stops after a fixed number of rounds so it can never loop for ever', async () => {
    const u = user()
    let n = 0
    deleteCompany.mockImplementation(async () => round({ a: ++n }))
    const { onDone } = renderCompany()
    const dialog = await confirmCompany(u)

    expect(await within(dialog).findByRole('alert', undefined, { timeout: 10000 })).toHaveTextContent('stopped making progress')
    expect(deleteCompany).toHaveBeenCalledTimes(200)
    expect(onDone).not.toHaveBeenCalled()
  }, 20000)

  it('closes on Cancel before anything is sent', async () => {
    const u = user()
    const { onClose } = renderCompany()
    await u.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(deleteCompany).not.toHaveBeenCalled()
  })
})

describe('DeleteClientDialog', () => {
  function renderClient() {
    const onDone = vi.fn()
    const onClose = vi.fn()
    render(<DeleteClientDialog client={CLIENT} onClose={onClose} onDone={onDone} />)
    return { onDone, onClose }
  }

  it('says the deletion is permanent and waits for the slug', async () => {
    const u = user()
    renderClient()
    const dialog = screen.getByRole('dialog', { name: 'Delete Acme Holdings?' })
    expect(dialog).toHaveTextContent(/permanently deletes the client/i)
    const button = within(dialog).getByRole('button', { name: 'Delete client' })
    expect(button).toBeDisabled()

    await u.type(within(dialog).getByLabelText('Type acme-holdings to confirm'), 'acme-holdings')
    expect(button).toBeEnabled()
  })

  it('deletes with the client\'s own slug, once, and reports it', async () => {
    const u = user()
    deleteClient.mockResolvedValue({ data: {} })
    const { onDone } = renderClient()
    await u.type(screen.getByLabelText('Type acme-holdings to confirm'), 'acme-holdings')
    await u.click(screen.getByRole('button', { name: 'Delete client' }))

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(deleteClient).toHaveBeenCalledTimes(1)
    expect(deleteClient).toHaveBeenCalledWith('cli_acme', 'acme-holdings')
  })

  it('shows the server\'s refusal when companies remain, and stays open for another try', async () => {
    const u = user()
    deleteClient.mockRejectedValue(httpError(409, 'This client still has 2 companies.'))
    const { onDone } = renderClient()
    await u.type(screen.getByLabelText('Type acme-holdings to confirm'), 'acme-holdings')
    await u.click(screen.getByRole('button', { name: 'Delete client' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('This client still has 2 companies.')
    expect(onDone).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Delete client' })).toBeEnabled()
  })
})
