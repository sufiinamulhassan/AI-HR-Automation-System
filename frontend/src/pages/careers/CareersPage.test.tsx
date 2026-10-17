import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CareersFilters, CareersJobList, CareersJobSummary } from '../../lib/careersTypes'

const api = vi.hoisted(() => ({ jobs: vi.fn(), filters: vi.fn() }))

vi.mock('../../lib/api', () => ({
  careersApi: { jobs: api.jobs, filters: api.filters },
}))

const { default: CareersPage } = await import('./CareersPage')

const DAY = 86_400_000
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString()

function makeJob(n: number, patch: Partial<CareersJobSummary> = {}): CareersJobSummary {
  return {
    job_id: `job-${n}`,
    title: `Role number ${n}`,
    summary: `Summary of role ${n}.`,
    location: 'London',
    employment_type: 'full-time',
    is_remote: false,
    skills: ['Python', 'SQL'],
    posted_at: daysAgo(3),
    deadline_at: null,
    company: { slug: 'acme', name: 'Acme', logo_url: null },
    ...patch,
  }
}

function listOf(jobs: CareersJobSummary[], patch: Partial<CareersJobList> = {}): { data: CareersJobList } {
  return { data: { jobs, total: jobs.length, page: 1, limit: 12, pages: 1, ...patch } }
}

const FILTERS: CareersFilters = {
  companies: [
    { slug: 'acme', name: 'Acme', logo_url: null, open_jobs: 2 },
    { slug: 'globex', name: 'Globex', logo_url: '/api/v1/branding/logo/globex.png', open_jobs: 1 },
  ],
  locations: ['London', 'Remote'],
  employment_types: ['full-time', 'contract'],
  remote_jobs: 1,
  total_open: 3,
}

function Probe() {
  const location = useLocation()
  return <div data-testid="url">{location.pathname}{location.search}</div>
}

function renderPage(entry = '/careers') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Probe />
      <Routes>
        <Route path="/careers" element={<CareersPage />} />
        <Route path="/careers/:jobId" element={<div>Job page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

const user = () => userEvent.setup({ delay: null })
const url = () => screen.getByTestId('url')
const lastParams = () => api.jobs.mock.calls[api.jobs.mock.calls.length - 1][0]

beforeEach(() => {
  api.jobs.mockReset().mockResolvedValue(listOf([makeJob(1), makeJob(2)]))
  api.filters.mockReset().mockResolvedValue({ data: FILTERS })
})

describe('CareersPage: listing', () => {
  it('shows the headline, one supporting line and a card per job', async () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Find your next role' })).toBeInTheDocument()
    expect(await screen.findByText('Role number 1')).toBeInTheDocument()
    expect(screen.getByText('Role number 2')).toBeInTheDocument()
    expect(screen.getAllByRole('article')).toHaveLength(2)
    expect(await screen.findByText('2 open roles')).toBeInTheDocument()
  })

  it('puts company, tags, summary, skills and dates on a card', async () => {
    api.jobs.mockResolvedValue(listOf([
      makeJob(1, {
        title: 'Senior Engineer',
        is_remote: true,
        skills: ['Python', 'SQL', 'Docker', 'AWS', 'Redis', 'Kafka'],
        deadline_at: '2099-11-03T12:00:00Z',
      }),
    ]))
    renderPage()
    const card = (await screen.findByText('Senior Engineer')).closest('article') as HTMLElement
    expect(within(card).getByText('Acme')).toBeInTheDocument()
    expect(within(card).getByText('London')).toBeInTheDocument()
    expect(within(card).getByText('Full time')).toBeInTheDocument()
    expect(within(card).getByText('Remote')).toBeInTheDocument()
    expect(within(card).getByText('Summary of role 1.')).toBeInTheDocument()
    expect(within(card).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Python', 'SQL', 'Docker', 'AWS'])
    expect(within(card).getByText('Posted 3 days ago')).toBeInTheDocument()
    expect(within(card).getByText(/^Closes Nov [34], 2099$/)).toBeInTheDocument()
  })

  it('makes the whole card a link to the job through a View job button', async () => {
    api.jobs.mockResolvedValue(listOf([makeJob(7, { title: 'Senior Engineer' })]))
    const u = user()
    renderPage()
    const link = await screen.findByRole('link', { name: 'View job: Senior Engineer at Acme' })
    expect(link).toHaveAttribute('href', '/careers/job-7')
    expect(link).toHaveTextContent('View job')
    expect(link).toHaveClass('btn-primary')
    await u.click(link)
    expect(await screen.findByText('Job page')).toBeInTheDocument()
  })

  it('shows the first letter of the company when it has no logo and the logo when it has one', async () => {
    api.jobs.mockResolvedValue(listOf([
      makeJob(1, { title: 'No logo role' }),
      makeJob(2, { title: 'Logo role', company: { slug: 'globex', name: 'Globex', logo_url: '/api/v1/branding/logo/globex.png' } }),
    ]))
    renderPage()
    const plain = (await screen.findByText('No logo role')).closest('article') as HTMLElement
    expect(within(plain).getByText('A')).toBeInTheDocument()
    expect(plain.querySelector('img')).toBeNull()
    const withLogo = screen.getByText('Logo role').closest('article') as HTMLElement
    expect(withLogo.querySelector('img')?.getAttribute('src')).toContain('/api/v1/branding/logo/globex.png')
  })

  it('says 1 open role in the singular', async () => {
    api.jobs.mockResolvedValue(listOf([makeJob(1)]))
    renderPage()
    expect(await screen.findByText('1 open role')).toBeInTheDocument()
  })

  it('asks for the first page of 12 with no filters and loads the filter options once', async () => {
    renderPage()
    await screen.findByText('Role number 1')
    expect(api.jobs).toHaveBeenCalledTimes(1)
    expect(lastParams()).toEqual({ page: 1, limit: 12 })
    expect(api.filters).toHaveBeenCalledTimes(1)
  })

  it('shows skeleton cards and a busy region while the jobs load', async () => {
    let resolve!: (v: unknown) => void
    api.jobs.mockReturnValue(new Promise(r => { resolve = r }))
    const { container } = renderPage()
    expect(container.querySelectorAll('.cr-skel-card')).toHaveLength(6)
    expect(container.querySelector('.cr-results')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('Loading roles')
    resolve(listOf([makeJob(1)]))
    expect(await screen.findByText('Role number 1')).toBeInTheDocument()
    expect(container.querySelectorAll('.cr-skel-card')).toHaveLength(0)
  })
})

describe('CareersPage: quiet reloads', () => {
  beforeEach(() => {
    api.jobs.mockImplementation(async (params: { page: number }) =>
      listOf([makeJob(params.page)], { total: 30, pages: 3, page: params.page }))
  })

  it('keeps the current roles on screen while the next page loads', async () => {
    const u = user()
    const { container } = renderPage()
    await screen.findByText('Role number 1')
    let resolve!: (v: unknown) => void
    api.jobs.mockReturnValue(new Promise(r => { resolve = r }))
    await u.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Role number 1')).toBeInTheDocument()
    expect(container.querySelectorAll('.cr-skel-card')).toHaveLength(0)
    expect(screen.getByText('30 open roles')).toBeInTheDocument()
    resolve(listOf([makeJob(2)], { total: 30, pages: 3, page: 2 }))
    expect(await screen.findByText('Role number 2')).toBeInTheDocument()
  })

  it('shows placeholders only when the reload is slow', async () => {
    const u = user()
    const { container } = renderPage()
    await screen.findByText('Role number 1')
    api.jobs.mockReturnValue(new Promise(() => {}))
    await u.click(screen.getByRole('button', { name: 'Next' }))
    expect(container.querySelectorAll('.cr-skel-card')).toHaveLength(0)
    await waitFor(() => expect(container.querySelectorAll('.cr-skel-card')).toHaveLength(6), { timeout: 3000 })
    expect(screen.queryByText('Role number 1')).not.toBeInTheDocument()
  })
})

describe('CareersPage: filters', () => {
  it('builds the selects from the filter options, with job counts for companies', async () => {
    renderPage()
    const company = await screen.findByLabelText('Company')
    await waitFor(() => expect(within(company).getByRole('option', { name: 'Acme (2)' })).toBeInTheDocument())
    expect(within(company).getByRole('option', { name: 'Globex (1)' })).toBeInTheDocument()
    expect(within(company).getByRole('option', { name: 'All companies' })).toBeInTheDocument()
    const location = screen.getByLabelText('Location')
    expect(within(location).getAllByRole('option').map(o => o.textContent)).toEqual(['All locations', 'London', 'Remote'])
    const type = screen.getByLabelText('Employment type')
    expect(within(type).getAllByRole('option').map(o => o.textContent)).toEqual(['All types', 'Full time', 'Contract'])
    expect(screen.getByLabelText('Remote only')).not.toBeChecked()
    expect(await screen.findByText('Hiring now at 2 companies')).toBeInTheDocument()
  })

  it('writes the search to the URL after a pause and asks the server once', async () => {
    const u = user()
    renderPage()
    await screen.findByText('Role number 1')
    await u.type(screen.getByRole('searchbox', { name: 'Search jobs' }), 'react')
    expect(url()).toHaveTextContent('/careers')
    expect(url()).not.toHaveTextContent('q=react')
    await waitFor(() => expect(url()).toHaveTextContent('/careers?q=react'))
    await waitFor(() => expect(lastParams()).toEqual({ q: 'react', page: 1, limit: 12 }))
    expect(api.jobs.mock.calls.filter(([p]) => p.q)).toHaveLength(1)
  })

  it('searches at once when the search is submitted with Enter', async () => {
    const u = user()
    renderPage()
    await screen.findByText('Role number 1')
    await u.type(screen.getByRole('searchbox', { name: 'Search jobs' }), 'go{Enter}')
    expect(url()).toHaveTextContent('/careers?q=go')
  })

  it('writes company, location, type and remote to the URL and to the request', async () => {
    const u = user()
    renderPage()
    await screen.findByText('Role number 1')
    await waitFor(() => expect(within(screen.getByLabelText('Company')).getAllByRole('option').length).toBeGreaterThan(1))

    await u.selectOptions(screen.getByLabelText('Company'), 'globex')
    await waitFor(() => expect(url()).toHaveTextContent('company=globex'))
    await u.selectOptions(screen.getByLabelText('Location'), 'London')
    await u.selectOptions(screen.getByLabelText('Employment type'), 'contract')
    await u.click(screen.getByLabelText('Remote only'))

    await waitFor(() => expect(lastParams()).toEqual({
      company: 'globex', location: 'London', type: 'contract', remote: true, page: 1, limit: 12,
    }))
    expect(url()).toHaveTextContent('/careers?company=globex&location=London&type=contract&remote=true')
    expect(screen.getByLabelText('Remote only')).toBeChecked()
  })

  it('reads every filter from the URL on the first render', async () => {
    renderPage('/careers?q=go&company=acme&location=London&type=full-time&remote=true&page=2')
    await waitFor(() => expect(api.jobs).toHaveBeenCalled())
    expect(api.jobs.mock.calls[0][0]).toEqual({
      q: 'go', company: 'acme', location: 'London', type: 'full-time', remote: true, page: 2, limit: 12,
    })
    expect(screen.getByRole('searchbox', { name: 'Search jobs' })).toHaveValue('go')
    expect(screen.getByLabelText('Remote only')).toBeChecked()
    await waitFor(() => expect(screen.getByLabelText('Company')).toHaveValue('acme'))
    expect(screen.getByLabelText('Location')).toHaveValue('London')
    expect(screen.getByLabelText('Employment type')).toHaveValue('full-time')
  })

  it('keeps a company from the URL selectable even when it is not in the options', async () => {
    renderPage('/careers?company=mystery')
    await screen.findByText('Role number 1')
    expect(screen.getByLabelText('Company')).toHaveValue('mystery')
  })

  it('goes back to the first page when a filter changes', async () => {
    api.jobs.mockResolvedValue(listOf([makeJob(1)], { total: 30, pages: 3, page: 3 }))
    const u = user()
    renderPage('/careers?page=3')
    await screen.findByText('Role number 1')
    await u.click(screen.getByLabelText('Remote only'))
    await waitFor(() => expect(url()).toHaveTextContent('/careers?remote=true'))
    expect(url()).not.toHaveTextContent('page=')
  })

  it('shows Clear filters only when something is filtered and removes everything', async () => {
    const u = user()
    renderPage()
    await screen.findByText('Role number 1')
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()

    await u.click(screen.getByLabelText('Remote only'))
    await u.type(screen.getByRole('searchbox', { name: 'Search jobs' }), 'go{Enter}')
    await u.click(await screen.findByRole('button', { name: 'Clear filters' }))

    expect(url().textContent).toBe('/careers')
    expect(screen.getByRole('searchbox', { name: 'Search jobs' })).toHaveValue('')
    expect(screen.getByLabelText('Remote only')).not.toBeChecked()
    await waitFor(() => expect(lastParams()).toEqual({ page: 1, limit: 12 }))
  })
})

describe('CareersPage: pagination', () => {
  beforeEach(() => {
    api.jobs.mockImplementation(async (params: { page: number }) =>
      listOf([makeJob(params.page)], { total: 30, pages: 3, page: params.page }))
  })

  it('shows the page position and moves with Next and Previous through the URL', async () => {
    const u = user()
    renderPage()
    expect(await screen.findByText('Role number 1')).toBeInTheDocument()
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()

    await u.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Role number 2')).toBeInTheDocument()
    expect(url()).toHaveTextContent('/careers?page=2')
    expect(lastParams()).toEqual({ page: 2, limit: 12 })
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()

    await u.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Role number 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()

    await u.click(screen.getByRole('button', { name: 'Previous' }))
    expect(await screen.findByText('Role number 2')).toBeInTheDocument()
    expect(url()).toHaveTextContent('/careers?page=2')
  })

  it('drops the page from the URL when going back to the first page', async () => {
    const u = user()
    renderPage('/careers?page=2')
    await screen.findByText('Role number 2')
    await u.click(screen.getByRole('button', { name: 'Previous' }))
    await screen.findByText('Role number 1')
    expect(url().textContent).toBe('/careers')
  })

  it('has no pagination when everything fits on one page', async () => {
    api.jobs.mockReset().mockResolvedValue(listOf([makeJob(1)]))
    renderPage()
    await screen.findByText('Role number 1')
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument()
  })

  it('moves to the last page when the URL asks for one past the end', async () => {
    api.jobs.mockReset().mockImplementation(async (params: { page: number }) =>
      params.page > 3 ? listOf([], { total: 30, pages: 3, page: params.page }) : listOf([makeJob(params.page)], { total: 30, pages: 3, page: params.page }))
    renderPage('/careers?page=9')
    expect(await screen.findByText('Role number 3')).toBeInTheDocument()
    expect(url()).toHaveTextContent('/careers?page=3')
  })
})

describe('CareersPage: empty and error states', () => {
  it('says no jobs match and offers Clear filters when a search finds nothing', async () => {
    api.jobs.mockResolvedValue(listOf([]))
    const u = user()
    renderPage('/careers?q=zzz&remote=true')
    expect(await screen.findByText('No jobs match your search')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Clear filters' })).toHaveLength(1)

    api.jobs.mockResolvedValue(listOf([makeJob(1)]))
    await u.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(await screen.findByText('Role number 1')).toBeInTheDocument()
    expect(url().textContent).toBe('/careers')
  })

  it('says there are no open roles, without a button, when nothing is filtered', async () => {
    api.jobs.mockResolvedValue(listOf([]))
    renderPage()
    expect(await screen.findByText('No open roles right now')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
  })

  it('shows an error with Retry and recovers when the retry works', async () => {
    api.jobs.mockRejectedValueOnce(new Error('Network Error'))
    const u = user()
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not load the jobs')
    expect(screen.queryByText('Role number 1')).not.toBeInTheDocument()

    await u.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Role number 1')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(api.jobs).toHaveBeenCalledTimes(2)
  })

  it('still lists jobs when the filter options fail to load', async () => {
    api.filters.mockRejectedValue(new Error('Network Error'))
    renderPage()
    expect(await screen.findByText('Role number 1')).toBeInTheDocument()
    expect(within(screen.getByLabelText('Company')).getAllByRole('option')).toHaveLength(1)
  })
})
