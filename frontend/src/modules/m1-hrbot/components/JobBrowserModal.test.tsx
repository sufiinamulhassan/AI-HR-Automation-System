import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Job = Record<string, unknown>
type Params = { page?: number; limit?: number; search?: string; status?: string }
type Response = { data: { jobs: Job[]; total: number; page: number; limit: number; counts: Record<string, number> } }

const browse = vi.fn()

vi.mock('../../../lib/api', () => ({
  jobsApi: {
    browse: (...a: unknown[]) => browse(...a),
  },
}))

const { default: JobBrowserModal, PAGE_SIZE, SEARCH_DEBOUNCE_MS } = await import('./JobBrowserModal')
const { useAuthStore } = await import('../../../store/auth.store')

const PAST = '2000-01-01T00:00:00+00:00'
const FUTURE = '2999-01-01T00:00:00+00:00'
const isClosed = (j: Job) => typeof j.deadline_at === 'string' && j.deadline_at < new Date().toISOString()

const pad = (n: number) => String(n).padStart(2, '0')
const DAY = 86_400_000
const JOBS: Job[] = Array.from({ length: 45 }, (_, k) => {
  const i = k + 1
  return {
    job_id: `job-${i}`,
    title: `Role ${pad(i)}`,
    company_name: i % 2 ? 'Acme' : 'Globex',
    location: i % 2 ? 'Remote' : 'Austin',
    deadline_at: i % 3 === 0 ? PAST : i % 2 ? null : FUTURE,
    created_at: new Date(Date.UTC(2026, 5, 1, 12) - i * DAY).toISOString(),
  }
})

function serverResponse(params: Params, all: Job[] = JOBS): Response {
  const q = (params.search ?? '').toLowerCase()
  const matched = all.filter(j =>
    !q || String(j.title).toLowerCase().includes(q) || String(j.company_name).toLowerCase().includes(q))
  const inTab = params.status === 'closed' ? matched.filter(isClosed)
    : params.status === 'open' ? matched.filter(j => !isClosed(j))
    : matched
  const page = params.page ?? 1
  const limit = params.limit ?? PAGE_SIZE
  const closed = matched.filter(isClosed).length
  return {
    data: {
      jobs: inTab.slice((page - 1) * limit, page * limit),
      total: inTab.length,
      page,
      limit,
      counts: { open: matched.length - closed, closed, all: matched.length },
    },
  }
}

function serve(all: Job[] = JOBS) {
  browse.mockImplementation(async (params: Params) => serverResponse(params, all))
}

function manual() {
  const calls: {
    params: Params
    signal?: AbortSignal
    resolve: (r: unknown) => void
    reject: (e: unknown) => void
  }[] = []
  browse.mockImplementation((params: Params, signal?: AbortSignal) =>
    new Promise((resolve, reject) => { calls.push({ params, signal, resolve, reject }) }))
  return calls
}

const lastParams = (): Params => browse.mock.calls[browse.mock.calls.length - 1][0]
const tab = (name: string) => screen.getByRole('tab', { name: new RegExp(`^${name}`) })
const searchBox = () => screen.getByRole('searchbox', { name: 'Search jobs' })
const pageBtn = (name: 'Previous' | 'Next') => screen.getByRole('button', { name })

function renderModal() {
  const onSelect = vi.fn()
  const onClose = vi.fn()
  render(<JobBrowserModal onSelect={onSelect} onClose={onClose} />)
  return { onSelect, onClose }
}

describe('JobBrowserModal', () => {
  beforeEach(() => {
    browse.mockReset()
  })

  describe('first page', () => {
    it('asks for page 1 of every status and focuses the search box', async () => {
      serve()
      renderModal()
      await screen.findByText('Showing 1-20 of 45')

      expect(browse).toHaveBeenCalledTimes(1)
      expect(lastParams()).toEqual({ page: 1, limit: 20, status: 'all' })
      expect(browse.mock.calls[0][1]).toBeInstanceOf(AbortSignal)
      expect(searchBox()).toHaveFocus()
      expect(screen.getByRole('dialog', { name: 'Browse all jobs' })).toBeInTheDocument()
    })

    it('renders title, company, location, created date and status badge per job', async () => {
      serve()
      renderModal()
      await screen.findByText('Role 01')

      expect(screen.getAllByRole('listitem')).toHaveLength(20)

      const open = screen.getByRole('button', { name: /Role 01/ })
      const created = new Date(String(JOBS[0].created_at))
        .toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
      expect(within(open).getByText('Acme')).toBeInTheDocument()
      expect(within(open).getByText('Remote')).toBeInTheDocument()
      expect(within(open).getByText(`Created ${created}`)).toBeInTheDocument()
      expect(within(open).getByText('Open')).toBeInTheDocument()

      const closed = screen.getByRole('button', { name: /Role 03/ })
      expect(within(closed).getByText('Closed')).toBeInTheDocument()
    })

    it('badges a job Closed only when its deadline has passed', async () => {
      browse.mockResolvedValue({
        data: {
          jobs: [
            { job_id: 'a', title: 'Expired JD', deadline_at: PAST },
            { job_id: 'b', title: 'Live JD', deadline_at: FUTURE },
            { job_id: 'c', title: 'Undated JD' },
            { job_id: 'd', title: 'Null Deadline JD', deadline_at: null },
          ],
          total: 4, page: 1, limit: 20, counts: { open: 3, closed: 1, all: 4 },
        },
      })
      renderModal()
      await screen.findByText('Expired JD')

      expect(within(screen.getByRole('button', { name: /Expired JD/ })).getByText('Closed')).toBeInTheDocument()
      expect(within(screen.getByRole('button', { name: /Live JD/ })).getByText('Open')).toBeInTheDocument()
      expect(within(screen.getByRole('button', { name: /Undated JD/ })).getByText('Open')).toBeInTheDocument()
      expect(within(screen.getByRole('button', { name: /Null Deadline JD/ })).getByText('Open')).toBeInTheDocument()
    })

    it('shows a loading state until the first response lands', async () => {
      const calls = manual()
      renderModal()

      expect(screen.getByRole('status')).toHaveTextContent('Loading jobs…')
      expect(screen.queryByRole('listitem')).not.toBeInTheDocument()

      await act(async () => { calls[0].resolve(serverResponse(calls[0].params)) })
      await screen.findByText('Role 01')
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })
  })

  describe('search', () => {
    it('waits out the typing pause, sends one trimmed query and restarts at page 1', async () => {
      const user = userEvent.setup()
      serve()
      renderModal()
      await screen.findByText('Showing 1-20 of 45')

      await user.click(pageBtn('Next'))
      await screen.findByText('Showing 21-40 of 45')
      browse.mockClear()

      await user.type(searchBox(), 'globex ')
      expect(browse).not.toHaveBeenCalled()
      expect(SEARCH_DEBOUNCE_MS).toBe(300)

      await waitFor(() => expect(browse).toHaveBeenCalledTimes(1), { timeout: 1500 })
      expect(lastParams()).toEqual({ page: 1, limit: 20, status: 'all', search: 'globex' })
      await screen.findByText('Showing 1-20 of 22')
      expect(screen.queryByText('Role 01')).not.toBeInTheDocument()
    })

    it('drops the search parameter again once the box is cleared', async () => {
      const user = userEvent.setup()
      serve()
      renderModal()
      await screen.findByText('Showing 1-20 of 45')

      await user.type(searchBox(), 'globex')
      await screen.findByText('Showing 1-20 of 22', undefined, { timeout: 1500 })

      await user.clear(searchBox())
      await screen.findByText('Showing 1-20 of 45', undefined, { timeout: 1500 })
      expect(lastParams()).not.toHaveProperty('search')
    })

    it('does not bounce back to page 1 when the typed text ends up unchanged', async () => {
      const user = userEvent.setup()
      serve()
      renderModal()
      await screen.findByText('Showing 1-20 of 45')

      await user.type(searchBox(), 'x')
      await user.clear(searchBox())
      await user.click(pageBtn('Next'))
      await screen.findByText('Showing 21-40 of 45')

      await new Promise(r => setTimeout(r, SEARCH_DEBOUNCE_MS + 100))
      expect(screen.getByText('Showing 21-40 of 45')).toBeInTheDocument()
      expect(lastParams().page).toBe(2)
    })
  })

  describe('tabs', () => {
    it('shows a count badge on every tab and keeps it across tab switches', async () => {
      const user = userEvent.setup()
      serve()
      renderModal()
      await screen.findByText('Role 01')

      expect(within(tab('Open')).getByText('30')).toBeInTheDocument()
      expect(within(tab('Closed')).getByText('15')).toBeInTheDocument()
      expect(within(tab('All')).getByText('45')).toBeInTheDocument()
      expect(tab('All')).toHaveAttribute('aria-selected', 'true')

      await user.click(tab('Closed'))
      await screen.findByText('Showing 1-15 of 15')

      expect(lastParams()).toEqual({ page: 1, limit: 20, status: 'closed' })
      expect(tab('Closed')).toHaveAttribute('aria-selected', 'true')
      expect(tab('All')).toHaveAttribute('aria-selected', 'false')
      expect(within(tab('Open')).getByText('30')).toBeInTheDocument()
      expect(within(tab('All')).getByText('45')).toBeInTheDocument()
      for (const row of screen.getAllByRole('listitem')) {
        expect(within(row).getByText('Closed')).toBeInTheDocument()
      }

      await user.click(tab('Open'))
      await screen.findByText('Showing 1-20 of 30')
      expect(lastParams().status).toBe('open')
    })

    it('updates the badges to follow the search, and returns to page 1 on a tab change', async () => {
      const user = userEvent.setup()
      serve()
      renderModal()
      await screen.findByText('Showing 1-20 of 45')

      await user.type(searchBox(), 'globex')
      await screen.findByText('Showing 1-20 of 22', undefined, { timeout: 1500 })
      expect(within(tab('Open')).getByText('15')).toBeInTheDocument()
      expect(within(tab('Closed')).getByText('7')).toBeInTheDocument()
      expect(within(tab('All')).getByText('22')).toBeInTheDocument()

      await user.click(pageBtn('Next'))
      await screen.findByText('Showing 21-22 of 22')

      await user.click(tab('Open'))
      await screen.findByText('Showing 1-15 of 15')
      expect(lastParams()).toEqual({ page: 1, limit: 20, status: 'open', search: 'globex' })
    })
  })

  describe('pagination', () => {
    it('disables Previous on the first page and Next on the last', async () => {
      const user = userEvent.setup()
      serve()
      renderModal()
      await screen.findByText('Showing 1-20 of 45')

      expect(pageBtn('Previous')).toBeDisabled()
      expect(pageBtn('Next')).toBeEnabled()

      await user.click(pageBtn('Next'))
      await screen.findByText('Showing 21-40 of 45')
      expect(lastParams().page).toBe(2)
      expect(pageBtn('Previous')).toBeEnabled()
      expect(pageBtn('Next')).toBeEnabled()
      expect(screen.getByText('Role 21')).toBeInTheDocument()

      await user.click(pageBtn('Next'))
      await screen.findByText('Showing 41-45 of 45')
      expect(screen.getAllByRole('listitem')).toHaveLength(5)
      expect(pageBtn('Next')).toBeDisabled()
      expect(pageBtn('Previous')).toBeEnabled()

      await user.click(pageBtn('Previous'))
      await screen.findByText('Showing 21-40 of 45')
      expect(lastParams().page).toBe(2)
    })

    it('treats an exact multiple of the page size as a single page', async () => {
      serve(JOBS.slice(0, PAGE_SIZE))
      renderModal()
      await screen.findByText('Showing 1-20 of 20')

      expect(pageBtn('Previous')).toBeDisabled()
      expect(pageBtn('Next')).toBeDisabled()
    })

    it('locks the pager while a page is loading', async () => {
      const user = userEvent.setup()
      const calls = manual()
      renderModal()
      await act(async () => { calls[0].resolve(serverResponse(calls[0].params)) })
      await screen.findByText('Showing 1-20 of 45')

      await user.click(pageBtn('Next'))
      expect(pageBtn('Previous')).toBeDisabled()
      expect(pageBtn('Next')).toBeDisabled()
      expect(screen.getByRole('status')).toHaveTextContent('Loading jobs…')

      await act(async () => { calls[1].resolve(serverResponse(calls[1].params)) })
      await screen.findByText('Showing 21-40 of 45')
      expect(pageBtn('Previous')).toBeEnabled()
    })

    it('steps back to the last real page when the requested one has emptied out', async () => {
      const user = userEvent.setup()
      browse.mockImplementation(async (params: Params) =>
        params.page === 2
          ? { data: { jobs: [], total: 20, page: 2, limit: 20, counts: { open: 20, closed: 0, all: 20 } } }
          : serverResponse(params))
      renderModal()
      await screen.findByText('Showing 1-20 of 45')

      await user.click(pageBtn('Next'))
      await waitFor(() => expect(browse).toHaveBeenCalledTimes(3))

      expect(browse.mock.calls.map(c => c[0].page)).toEqual([1, 2, 1])
      expect(screen.queryByText('No jobs match')).not.toBeInTheDocument()
      await screen.findByText('Showing 1-20 of 45')
    })
  })

  describe('selection and dismissal', () => {
    it('hands the chosen job to onSelect and closes', async () => {
      const user = userEvent.setup()
      serve()
      const { onSelect, onClose } = renderModal()
      await screen.findByText('Role 05')

      await user.click(screen.getByRole('button', { name: /Role 05/ }))

      expect(onSelect).toHaveBeenCalledTimes(1)
      expect(onSelect).toHaveBeenCalledWith(JOBS[4])
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('selects a job from a later page too', async () => {
      const user = userEvent.setup()
      serve()
      const { onSelect } = renderModal()
      await screen.findByText('Showing 1-20 of 45')
      await user.click(pageBtn('Next'))
      await screen.findByText('Showing 21-40 of 45')

      await user.click(screen.getByRole('button', { name: /Role 33/ }))
      expect(onSelect).toHaveBeenCalledWith(JOBS[32])
    })

    it('closes on Escape without selecting anything', async () => {
      const user = userEvent.setup()
      serve()
      const { onSelect, onClose } = renderModal()
      await screen.findByText('Role 01')

      await user.keyboard('{Escape}')

      expect(onClose).toHaveBeenCalledTimes(1)
      expect(onSelect).not.toHaveBeenCalled()
    })

    it('closes on a backdrop press and on the close button, but not on a press inside', async () => {
      const user = userEvent.setup()
      serve()
      const { onClose } = renderModal()
      await screen.findByText('Role 01')
      const dialog = screen.getByRole('dialog')

      await user.click(dialog)
      expect(onClose).not.toHaveBeenCalled()

      await user.click(dialog.parentElement as HTMLElement)
      expect(onClose).toHaveBeenCalledTimes(1)

      await user.click(screen.getByRole('button', { name: 'Close' }))
      expect(onClose).toHaveBeenCalledTimes(2)
    })
  })

  describe('out-of-order responses', () => {
    it('keeps the latest tab when an earlier tab answers last, and cancels the earlier request', async () => {
      const user = userEvent.setup()
      const calls = manual()
      renderModal()
      await act(async () => { calls[0].resolve(serverResponse(calls[0].params)) })
      await screen.findByText('Showing 1-20 of 45')

      await user.click(tab('Closed'))
      await user.click(tab('Open'))
      expect(calls.map(c => c.params.status)).toEqual(['all', 'closed', 'open'])
      expect(calls[1].signal?.aborted).toBe(true)
      expect(calls[2].signal?.aborted).toBe(false)

      await act(async () => { calls[2].resolve(serverResponse(calls[2].params)) })
      await screen.findByText('Showing 1-20 of 30')

      await act(async () => { calls[1].resolve(serverResponse(calls[1].params)) })

      expect(screen.getByText('Showing 1-20 of 30')).toBeInTheDocument()
      expect(tab('Open')).toHaveAttribute('aria-selected', 'true')
      expect(screen.queryByText('Role 03')).not.toBeInTheDocument()
      expect(screen.getByText('Role 01')).toBeInTheDocument()
    })

    it('ignores a slow answer for an older search', async () => {
      const user = userEvent.setup()
      const calls = manual()
      renderModal()
      await act(async () => { calls[0].resolve(serverResponse(calls[0].params)) })
      await screen.findByText('Showing 1-20 of 45')

      await user.type(searchBox(), 'glo')
      await waitFor(() => expect(calls).toHaveLength(2), { timeout: 1500 })
      await user.type(searchBox(), 'bex')
      await waitFor(() => expect(calls).toHaveLength(3), { timeout: 1500 })
      expect(calls.map(c => c.params.search)).toEqual([undefined, 'glo', 'globex'])

      await act(async () => { calls[2].resolve(serverResponse(calls[2].params)) })
      await screen.findByText('Showing 1-20 of 22')

      await act(async () => {
        calls[1].resolve({
          data: {
            jobs: [{ job_id: 'late', title: 'Stale Result' }],
            total: 1, page: 1, limit: 20, counts: { open: 1, closed: 0, all: 1 },
          },
        })
      })
      expect(screen.queryByText('Stale Result')).not.toBeInTheDocument()
      expect(screen.getByText('Showing 1-20 of 22')).toBeInTheDocument()
      expect(within(tab('All')).getByText('22')).toBeInTheDocument()
    })

    it('does not surface the error of a request that was already replaced', async () => {
      const user = userEvent.setup()
      const calls = manual()
      renderModal()
      await act(async () => { calls[0].resolve(serverResponse(calls[0].params)) })
      await screen.findByText('Showing 1-20 of 45')

      await user.click(tab('Closed'))
      await user.click(tab('Open'))
      await act(async () => { calls[2].resolve(serverResponse(calls[2].params)) })
      await screen.findByText('Showing 1-20 of 30')

      await act(async () => { calls[1].reject(new Error('aborted')) })

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.getByText('Showing 1-20 of 30')).toBeInTheDocument()
    })
  })

  describe('failure and empty states', () => {
    it('shows an inline error with Retry, then recovers on retry', async () => {
      const user = userEvent.setup()
      serve()
      browse.mockRejectedValueOnce(new Error('network down'))
      renderModal()

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('Could not load jobs.')
      expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
      expect(pageBtn('Previous')).toBeDisabled()
      expect(pageBtn('Next')).toBeDisabled()

      await user.click(within(alert).getByRole('button', { name: 'Retry' }))

      await screen.findByText('Role 01')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(browse).toHaveBeenCalledTimes(2)
      expect(browse.mock.calls[1][0]).toEqual(browse.mock.calls[0][0])
    })

    it('stays in the error state when the retry fails as well', async () => {
      const user = userEvent.setup()
      browse.mockRejectedValue(new Error('still down'))
      renderModal()

      await user.click(await screen.findByRole('button', { name: 'Retry' }))

      await waitFor(() => expect(browse).toHaveBeenCalledTimes(2))
      expect(await screen.findByRole('alert')).toBeInTheDocument()
    })

    it('shows the empty state when nothing matches a search', async () => {
      const user = userEvent.setup()
      serve()
      renderModal()
      await screen.findByText('Showing 1-20 of 45')

      await user.type(searchBox(), 'zzzz')

      expect(await screen.findByText('No jobs match', undefined, { timeout: 1500 })).toBeInTheDocument()
      expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
      expect(screen.queryByText(/Showing/)).not.toBeInTheDocument()
      expect(pageBtn('Next')).toBeDisabled()
      expect(within(tab('All')).getByText('0')).toBeInTheDocument()
    })

    it('shows the empty state for a tab with no jobs', async () => {
      const user = userEvent.setup()
      serve(JOBS.filter(j => !isClosed(j)))
      renderModal()
      await screen.findByText('Showing 1-20 of 30')

      await user.click(tab('Closed'))

      expect(await screen.findByText('No jobs match')).toBeInTheDocument()
      expect(screen.getByText('There are no closed jobs right now.')).toBeInTheDocument()
    })

    it.each(['admin', 'superadmin'])('tells a %s to create a job when there are none at all', async role => {
      useAuthStore.setState({ token: 'tok', user: { role, email: `${role}@x.com` } })
      serve([])
      renderModal()
      expect(await screen.findByText('No jobs match')).toBeInTheDocument()
      expect(screen.getByText('Create a job description to get started.')).toBeInTheDocument()
    })

    it.each(['standard', 'recruiter'])('does not send a %s to create a job, which only an admin can do', async role => {
      useAuthStore.setState({ token: 'tok', user: { role, email: `${role}@x.com` } })
      serve([])
      renderModal()
      expect(await screen.findByText('No jobs match')).toBeInTheDocument()
      expect(screen.getByText('There are no jobs yet.')).toBeInTheDocument()
      expect(screen.queryByText(/Create a job description/)).not.toBeInTheDocument()
    })
  })
})
