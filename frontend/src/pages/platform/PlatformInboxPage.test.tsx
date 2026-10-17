import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { platformApi } from '../../lib/api'
import type { ContactRequest, ContactRequestList } from '../../lib/siteTypes'
import PlatformInboxPage from './PlatformInboxPage'

function item(over: Partial<ContactRequest> = {}): ContactRequest {
  return {
    request_id: 'req-1',
    name: 'Sara Khan',
    email: 'sara@example.com',
    company: 'Globex',
    topic: 'sales',
    message: 'We would like to see the platform.',
    status: 'new',
    note: '',
    source: 'website',
    created_at: '2026-10-15T09:00:00+00:00',
    updated_at: '2026-10-15T09:00:00+00:00',
    handled_by: null,
    ...over,
  }
}

function list(items: ContactRequest[], over: Partial<ContactRequestList> = {}): { data: ContactRequestList } {
  return {
    data: {
      items, total: items.length, page: 1, limit: 20, pages: 1,
      counts: { new: 1, in_progress: 1, done: 0, spam: 0 },
      ...over,
    },
  }
}

const A = item()
const B = item({ request_id: 'req-2', name: 'Alan Turing', email: 'alan@example.com', company: '', topic: 'security', message: 'I found an issue.', status: 'in_progress', handled_by: 'owner@hirely.test' })

const requests = vi.spyOn(platformApi, 'contactRequests')
const update = vi.spyOn(platformApi, 'updateContactRequest')
const remove = vi.spyOn(platformApi, 'deleteContactRequest')

const lastQuery = () => requests.mock.calls[requests.mock.calls.length - 1][0]

beforeEach(() => {
  requests.mockReset()
  update.mockReset()
  remove.mockReset()
  requests.mockResolvedValue(list([A, B]) as never)
  update.mockResolvedValue({ data: A } as never)
  remove.mockResolvedValue({ data: { status: 'deleted' } } as never)
})

const cardOf = (name: string) => screen.getByText(name).closest('li') as HTMLElement

describe('PlatformInboxPage: list', () => {
  it('shows each message with who sent it, what it is about and the text', async () => {
    render(<PlatformInboxPage />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Inbox' })).toBeInTheDocument()
    const first = await waitFor(() => cardOf('Sara Khan'))
    expect(within(first).getByRole('link', { name: 'sara@example.com' })).toHaveAttribute('href', 'mailto:sara@example.com')
    expect(within(first).getByText('Globex')).toBeInTheDocument()
    expect(within(first).getByText('Pricing and plans')).toBeInTheDocument()
    expect(within(first).getByText('We would like to see the platform.')).toBeInTheDocument()

    const second = cardOf('Alan Turing')
    expect(within(second).getByText('Security report')).toBeInTheDocument()
    expect(within(second).getByText('Last handled by owner@hirely.test')).toBeInTheDocument()
  })

  it('shows a count on every status tab', async () => {
    render(<PlatformInboxPage />)
    const tabs = await screen.findByRole('group', { name: 'Filter by status' })
    expect(within(tabs).getByRole('button', { name: /^All 2$/ })).toHaveAttribute('aria-pressed', 'true')
    expect(within(tabs).getByRole('button', { name: /^New 1$/ })).toBeInTheDocument()
    expect(within(tabs).getByRole('button', { name: /^In progress 1$/ })).toBeInTheDocument()
    expect(within(tabs).getByRole('button', { name: /^Done 0$/ })).toBeInTheDocument()
    expect(within(tabs).getByRole('button', { name: /^Spam 0$/ })).toBeInTheDocument()
  })

  it('asks for the first page with no filters to begin with', async () => {
    render(<PlatformInboxPage />)
    await screen.findByText('Sara Khan')
    expect(lastQuery()).toEqual({ status: undefined, topic: undefined, q: undefined, page: 1, limit: 20 })
  })
})

describe('PlatformInboxPage: filters', () => {
  it('filters by status', async () => {
    const u = userEvent.setup()
    render(<PlatformInboxPage />)
    await screen.findByText('Sara Khan')
    await u.click(screen.getByRole('button', { name: /^New/ }))
    await waitFor(() => expect(lastQuery()).toMatchObject({ status: 'new', page: 1 }))
    expect(screen.getByRole('button', { name: /^New/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('filters by topic', async () => {
    const u = userEvent.setup()
    render(<PlatformInboxPage />)
    await screen.findByText('Sara Khan')
    await u.selectOptions(screen.getByRole('combobox', { name: 'Filter by topic' }), 'privacy')
    await waitFor(() => expect(lastQuery()).toMatchObject({ topic: 'privacy', page: 1 }))
  })

  it('searches after a short pause and not on every key', async () => {
    const u = userEvent.setup()
    render(<PlatformInboxPage />)
    await screen.findByText('Sara Khan')
    const before = requests.mock.calls.length
    await u.type(screen.getByRole('searchbox', { name: 'Search messages' }), 'globex')
    expect(requests.mock.calls.length).toBe(before)
    await waitFor(() => expect(lastQuery()).toMatchObject({ q: 'globex', page: 1 }))
  })

  it('says so when nothing matches, and when the inbox is empty', async () => {
    const u = userEvent.setup()
    requests.mockResolvedValue(list([], { counts: { new: 0, in_progress: 0, done: 0, spam: 0 } }) as never)
    render(<PlatformInboxPage />)
    expect(await screen.findByText('No messages yet.')).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: /^Spam/ }))
    expect(await screen.findByText('No messages match these filters.')).toBeInTheDocument()
  })

  it('shows the failure and loads again on request', async () => {
    const u = userEvent.setup()
    requests.mockRejectedValueOnce({ response: { data: { detail: 'Platform owner access required' } } })
    render(<PlatformInboxPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Platform owner access required')
    await u.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Sara Khan')).toBeInTheDocument()
  })
})

describe('PlatformInboxPage: working a message', () => {
  it('changes the status and reloads', async () => {
    const u = userEvent.setup()
    render(<PlatformInboxPage />)
    await screen.findByText('Sara Khan')
    const calls = requests.mock.calls.length
    await u.selectOptions(within(cardOf('Sara Khan')).getByRole('combobox', { name: 'Status' }), 'done')
    await waitFor(() => expect(update).toHaveBeenCalledWith('req-1', { status: 'done' }))
    await waitFor(() => expect(requests.mock.calls.length).toBeGreaterThan(calls))
  })

  it('saves a note only once it has changed, trimmed', async () => {
    const u = userEvent.setup()
    render(<PlatformInboxPage />)
    await screen.findByText('Sara Khan')
    const card = cardOf('Sara Khan')
    const save = within(card).getByRole('button', { name: 'Save note' })
    expect(save).toBeDisabled()
    await u.type(within(card).getByRole('textbox', { name: 'Internal note' }), '  Called on Monday  ')
    expect(save).toBeEnabled()
    await u.click(save)
    await waitFor(() => expect(update).toHaveBeenCalledWith('req-1', { note: 'Called on Monday' }))
  })

  it('asks before deleting, and deletes only when confirmed', async () => {
    const u = userEvent.setup()
    render(<PlatformInboxPage />)
    await screen.findByText('Sara Khan')
    const card = cardOf('Sara Khan')

    await u.click(within(card).getByRole('button', { name: 'Delete' }))
    expect(remove).not.toHaveBeenCalled()
    await u.click(within(card).getByRole('button', { name: 'Cancel' }))
    expect(within(card).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(remove).not.toHaveBeenCalled()

    await u.click(within(card).getByRole('button', { name: 'Delete' }))
    await u.click(within(card).getByRole('button', { name: 'Confirm delete' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith('req-1'))
  })

  it('shows the server wording when a change is refused', async () => {
    const u = userEvent.setup()
    update.mockRejectedValueOnce({ response: { data: { detail: 'The note must be at most 1000 characters.' } } })
    render(<PlatformInboxPage />)
    await screen.findByText('Sara Khan')
    const card = cardOf('Sara Khan')
    await u.type(within(card).getByRole('textbox', { name: 'Internal note' }), 'x')
    await u.click(within(card).getByRole('button', { name: 'Save note' }))
    expect(await within(card).findByRole('alert')).toHaveTextContent('The note must be at most 1000 characters.')
  })
})

describe('PlatformInboxPage: pages', () => {
  it('moves between pages', async () => {
    const u = userEvent.setup()
    requests.mockResolvedValue(list([A], { total: 45, pages: 3, page: 1 }) as never)
    render(<PlatformInboxPage />)
    await screen.findByText('Sara Khan')
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()

    await u.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(lastQuery()).toMatchObject({ page: 2 }))
  })

  it('shows no pager when everything fits on one page', async () => {
    render(<PlatformInboxPage />)
    await screen.findByText('Sara Khan')
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
  })
})
