import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const list = vi.fn()
const options = vi.fn()
const domains = vi.fn()
const semantic = vi.fn()
const bulkDelete = vi.fn()
const savedList = vi.fn()
const savedCreate = vi.fn()
const savedDelete = vi.fn()

vi.mock('../../../lib/api', () => ({
  resumesApi: {
    list: (...a: unknown[]) => list(...a),
    options: (...a: unknown[]) => options(...a),
    domains: (...a: unknown[]) => domains(...a),
    semantic: (...a: unknown[]) => semantic(...a),
    bulkDelete: (...a: unknown[]) => bulkDelete(...a),
    download: vi.fn(),
    get: vi.fn().mockResolvedValue({ data: {} }),
  },
  savedFiltersApi: {
    list: (...a: unknown[]) => savedList(...a),
    create: (...a: unknown[]) => savedCreate(...a),
    delete: (...a: unknown[]) => savedDelete(...a),
  },
}))

vi.mock('docx-preview', () => ({ renderAsync: vi.fn() }))

const { default: ResumesPage } = await import('./ResumesPage')
const { useAuthStore } = await import('../../../store/auth.store')

const JANE = {
  resume_id: 'r-jane', filename: 'jane.pdf', candidate_name: 'Jane Doe', candidate_email: 'jane@x.com',
  processing_status: 'processed', created_at: '2026-09-01T10:00:00+00:00', location: 'Berlin',
  headline: 'Senior Java engineer',
  classification: { job_domain: 'software_engineering', seniority_level: 'senior', years_experience: 8, skills: ['python', 'sql'] },
}
const BOB = {
  resume_id: 'r-bob', filename: 'bob.docx', candidate_name: 'Bob Roe', processing_status: 'failed',
  created_at: '2026-09-02T10:00:00+00:00',
}

const OPTIONS = {
  business_domains: [
    { value: 'it_software', label: 'IT & Software', count: 40 },
    { value: 'banking_financial_services', label: 'Banking & Financial Services', count: 12 },
  ],
  skills: [{ value: 'Java', count: 9 }, { value: 'Kafka', count: 4 }, { value: 'Python', count: 3 }],
  seniorities: [{ value: 'mid', label: 'Mid', count: 5 }, { value: 'senior', label: 'Senior', count: 9 }],
  statuses: [{ value: 'processed', count: 40 }],
  education_levels: [{ value: 'master', label: "Master's degree", count: 3 }],
  industries: [{ value: 'fintech', label: 'Fintech', count: 5 }],
  roles: [{ value: 'Java Developer', count: 9 }],
  total: 77,
}

const FOLDERS = [
  { value: 'it_software', label: 'IT & Software', count: 40, roles: [{ value: 'Java Developer', count: 9 }] },
  { value: 'banking_financial_services', label: 'Banking & Financial Services', count: 12, roles: [] },
]

function typeFast(element: Element, text: string) {
  return userEvent.setup({ delay: null }).type(element, text)
}

function Probe() {
  const location = useLocation()
  return <output data-testid="search">{location.search}</output>
}

function renderPage(url = '/dashboard/resumes', { folders = false } = {}) {
  const utils = render(
    <MemoryRouter initialEntries={[url]}>
      <Probe />
      <ResumesPage />
    </MemoryRouter>,
  )
  if (!folders) {
    const all = screen.getByRole('button', { name: 'All Candidates' })
    if (all.getAttribute('aria-pressed') !== 'true') fireEvent.click(all)
  }
  return utils
}

const pageOf = (resumes: unknown[], total = resumes.length) => ({ data: { resumes, total, page: 1, limit: 20 } })

function lastParams(fn: ReturnType<typeof vi.fn> = list): Record<string, unknown> {
  return fn.mock.calls[fn.mock.calls.length - 1][0] as Record<string, unknown>
}

function url(): string {
  return screen.getByTestId('search').textContent ?? ''
}

async function ready() {
  await screen.findByText('Jane Doe')
  await waitFor(() => expect(screen.getByRole('button', { name: 'DOMAIN' })).toBeEnabled())
}

async function pick(label: string, option: RegExp | string) {
  await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}`) }))
  await userEvent.click(screen.getByRole('option', { name: option }))
}

async function openMore() {
  await userEvent.click(screen.getByRole('button', { name: /More filters/ }))
}

beforeEach(() => {
  list.mockReset().mockResolvedValue(pageOf([JANE, BOB]))
  options.mockReset().mockResolvedValue({ data: OPTIONS })
  domains.mockReset().mockResolvedValue({ data: { folders: FOLDERS, total: 52 } })
  semantic.mockReset()
  bulkDelete.mockReset()
  savedList.mockReset().mockResolvedValue({ data: { templates: [] } })
  savedCreate.mockReset().mockResolvedValue({ data: {} })
  savedDelete.mockReset().mockResolvedValue({ data: {} })
  useAuthStore.setState({ token: 'tok', user: { role: 'admin', email: 'a@x.com', name: 'admin' } })
})

describe('ResumesPage filters send the right parameters', () => {
  it('asks for the first page with no filters, and loads the options once', async () => {
    renderPage()
    await ready()
    expect(list).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledWith({ page: 1, limit: 20 })
    expect(options).toHaveBeenCalledTimes(1)
  })

  it('sends the domain as business_domain', async () => {
    renderPage()
    await ready()
    await pick('DOMAIN', /IT & Software/)
    await waitFor(() => expect(lastParams()).toEqual({ page: 1, limit: 20, business_domain: 'it_software' }))
  })

  it('sends several skills as one comma separated list', async () => {
    renderPage()
    await ready()
    await userEvent.click(screen.getByRole('button', { name: 'SKILL' }))
    await userEvent.click(screen.getByRole('option', { name: /Java/ }))
    await userEvent.click(screen.getByRole('option', { name: /Kafka/ }))
    await waitFor(() => expect(lastParams()).toEqual({ page: 1, limit: 20, skill: 'Java,Kafka' }))
    expect(screen.getByRole('button', { name: /SKILL \(2\)/ })).toBeInTheDocument()
  })

  it('sends the seniority', async () => {
    renderPage()
    await ready()
    await pick('SENIORITY', /Senior/)
    await waitFor(() => expect(lastParams()).toEqual({ page: 1, limit: 20, seniority: 'senior' }))
  })

  it('sends the experience range as numbers, after a pause', async () => {
    renderPage()
    await ready()
    await typeFast(screen.getByRole('spinbutton', { name: 'Min yrs' }), '3')
    await typeFast(screen.getByRole('spinbutton', { name: 'Max yrs' }), '8')
    await waitFor(() => expect(lastParams()).toEqual({ page: 1, limit: 20, experience_min: 3, experience_max: 8 }))
  })

  it('never sends a maximum below the minimum and shows the inputs as invalid instead', async () => {
    renderPage()
    await ready()
    await typeFast(screen.getByRole('spinbutton', { name: 'Min yrs' }), '9')
    await typeFast(screen.getByRole('spinbutton', { name: 'Max yrs' }), '2')
    await waitFor(() => expect(lastParams()).toEqual({ page: 1, limit: 20, experience_min: 9 }))
    expect(list.mock.calls.some(c => (c[0] as Record<string, unknown>).experience_max !== undefined)).toBe(false)
    expect(screen.getByRole('spinbutton', { name: 'Max yrs' })).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('spinbutton', { name: 'Min yrs' })).toHaveAttribute('aria-invalid', 'true')
  })

  it('ignores a number that is not a number', async () => {
    renderPage()
    await ready()
    await typeFast(screen.getByRole('spinbutton', { name: 'Min yrs' }), 'abc')
    await new Promise(r => setTimeout(r, 450))
    expect(list).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['ROLE', /Java Developer/, { department: 'Java Developer' }],
    ['EDUCATION', /Master's degree/, { education_level: 'master' }],
    ['INDUSTRY', /Fintech/, { industry: 'fintech' }],
  ])('sends the %s filter under its API name', async (label, option, expected) => {
    renderPage()
    await ready()
    await openMore()
    await pick(label, option)
    await waitFor(() => expect(lastParams()).toEqual({ page: 1, limit: 20, ...expected }))
  })

  it('sends the salary range as numbers and the career history text', async () => {
    renderPage()
    await ready()
    await openMore()
    await typeFast(screen.getByRole('spinbutton', { name: 'Min salary' }), '50000')
    await typeFast(screen.getByRole('spinbutton', { name: 'Max salary' }), '90000')
    await typeFast(screen.getByRole('textbox', { name: 'Worked At, searches career history' }), 'Acme')
    await waitFor(() => expect(lastParams()).toEqual({
      page: 1, limit: 20, salary_expectation_min: 50000, salary_expectation_max: 90000, worked_at_company: 'Acme',
    }))
  })

  it('sends the search after a pause, trimmed, and not once per key', async () => {
    renderPage()
    await ready()
    await typeFast(screen.getByRole('searchbox', { name: 'Search résumés' }), ' jane ')
    expect(list).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(lastParams()).toEqual({ page: 1, limit: 20, search: 'jane' }))
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('combines every filter in one request', async () => {
    renderPage('/dashboard/resumes?status=failed')
    await ready()
    await pick('DOMAIN', /IT & Software/)
    await pick('SENIORITY', /Mid/)
    await typeFast(screen.getByRole('spinbutton', { name: 'Min yrs' }), '2')
    await openMore()
    await pick('INDUSTRY', /Fintech/)
    await waitFor(() => expect(lastParams()).toEqual({
      page: 1, limit: 20, status: 'failed', business_domain: 'it_software', seniority: 'mid', experience_min: 2, industry: 'fintech',
    }))
  })
})

describe('ResumesPage paging and selection under filters', () => {
  it('shows the result summary and goes back to page 1 when a filter changes', async () => {
    list.mockResolvedValue(pageOf([JANE, BOB], 77))
    renderPage()
    await ready()
    expect(screen.getByText('Showing 1–20 of 77 résumés')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(lastParams()).toEqual({ page: 2, limit: 20 }))
    expect(await screen.findByText('Showing 21–40 of 77 résumés')).toBeInTheDocument()

    await pick('SENIORITY', /Senior/)
    await waitFor(() => expect(lastParams()).toEqual({ page: 1, limit: 20, seniority: 'senior' }))
  })

  it('clears the row selection when a filter changes', async () => {
    renderPage()
    await ready()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all résumés on this page' }))
    expect(screen.getByText('2 selected')).toBeInTheDocument()
    await pick('SENIORITY', /Senior/)
    await waitFor(() => expect(screen.queryByText('2 selected')).not.toBeInTheDocument())
  })

  it('shows the filtered empty state for a filter of the More panel, with a way out', async () => {
    renderPage()
    await ready()
    list.mockResolvedValue(pageOf([]))
    await openMore()
    await pick('INDUSTRY', /Fintech/)
    expect(await screen.findByText('No résumés match your filters.')).toBeInTheDocument()
    expect(screen.queryByText('No résumés yet.')).not.toBeInTheDocument()

    list.mockResolvedValue(pageOf([JANE]))
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    await waitFor(() => expect(lastParams()).toEqual({ page: 1, limit: 20 }))
  })

  it('shows the plain empty state when nothing is filtered', async () => {
    list.mockResolvedValue(pageOf([]))
    renderPage()
    expect(await screen.findByText('No résumés yet.')).toBeInTheDocument()
  })

  it('shows the latest job title and the location of a résumé when the server sends them', async () => {
    renderPage()
    await ready()
    const table = within(screen.getByRole('table'))
    expect(table.getByText('Senior Java engineer')).toBeInTheDocument()
    expect(table.getByText('Berlin')).toBeInTheDocument()
    expect(table.queryByText('Available')).not.toBeInTheDocument()
    expect(table.queryByText('Unknown')).not.toBeInTheDocument()
  })

  it('refreshes the options after a delete, along with the list', async () => {
    bulkDelete.mockResolvedValue({ data: { deleted: ['r-jane'], in_progress: [], not_found: [] } })
    renderPage()
    await ready()
    await userEvent.click(screen.getByRole('button', { name: 'Delete Jane Doe' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(options).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
  })
})

describe('ResumesPage chips and Clear all', () => {
  it('shows a chip per applied filter and removes one with its x button', async () => {
    renderPage()
    await ready()
    await pick('SENIORITY', /Senior/)
    await pick('DOMAIN', /IT & Software/)
    const chips = await screen.findByRole('list', { name: 'Active filters' })
    expect(within(chips).getAllByRole('listitem').map(li => li.querySelector('.rf-chip-text')?.textContent))
      .toEqual(['Domain: IT & Software', 'Seniority: Senior'])

    await userEvent.click(within(chips).getByRole('button', { name: 'Remove Domain: IT & Software' }))
    await waitFor(() => expect(lastParams()).toEqual({ page: 1, limit: 20, seniority: 'senior' }))
    expect(screen.queryByText('Domain: IT & Software')).not.toBeInTheDocument()
  })

  it('removes one skill at a time', async () => {
    renderPage()
    await ready()
    await userEvent.click(screen.getByRole('button', { name: 'SKILL' }))
    await userEvent.click(screen.getByRole('option', { name: /Java/ }))
    await userEvent.click(screen.getByRole('option', { name: /Kafka/ }))
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'Remove Skill: Java' }))
    await waitFor(() => expect(lastParams()).toEqual({ page: 1, limit: 20, skill: 'Kafka' }))
  })

  it('clears every filter, the search box and the status in the address', async () => {
    renderPage('/dashboard/resumes?status=processed')
    await ready()
    await pick('SENIORITY', /Senior/)
    await typeFast(screen.getByRole('searchbox', { name: 'Search résumés' }), 'jane{Enter}')
    await openMore()
    await typeFast(screen.getByRole('textbox', { name: 'Worked At, searches career history' }), 'Acme{Enter}')
    await waitFor(() => expect(lastParams()).toEqual({
      page: 1, limit: 20, status: 'processed', seniority: 'senior', search: 'jane', worked_at_company: 'Acme',
    }))

    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    await waitFor(() => expect(lastParams()).toEqual({ page: 1, limit: 20 }))
    expect(screen.getByRole('searchbox', { name: 'Search résumés' })).toHaveValue('')
    expect(screen.getByRole('textbox', { name: 'Worked At, searches career history' })).toHaveValue('')
    expect(screen.queryByRole('list', { name: 'Active filters' })).not.toBeInTheDocument()
    expect(url()).toBe('')
  })

  it('counts the extra filters on the More filters button', async () => {
    renderPage()
    await ready()
    await openMore()
    await pick('INDUSTRY', /Fintech/)
    await pick('ROLE', /Java Developer/)
    const button = screen.getByRole('button', { name: /More filters/ })
    await waitFor(() => expect(button.querySelector('.rf-badge')).toHaveTextContent('2'))
  })
})

describe('ResumesPage status and the address', () => {
  it('opens on the status in the address, as the dashboard link sends it', async () => {
    renderPage('/dashboard/resumes?status=processed')
    await ready()
    expect(lastParams()).toEqual({ page: 1, limit: 20, status: 'processed' })
    expect(screen.getByRole('button', { name: /^STATUS/ })).toHaveTextContent('Processed')
    expect(within(screen.getByRole('list', { name: 'Active filters' })).getByText('Status: Processed')).toBeInTheDocument()
  })

  it('writes the chosen status to the address and removes it again', async () => {
    renderPage()
    await ready()
    await pick('STATUS', 'Failed')
    expect(url()).toBe('?status=failed')
    await waitFor(() => expect(lastParams()).toEqual({ page: 1, limit: 20, status: 'failed' }))
    await pick('STATUS', 'All statuses')
    expect(url()).toBe('')
    await waitFor(() => expect(lastParams()).toEqual({ page: 1, limit: 20 }))
  })

  it('ignores a status it does not know', async () => {
    renderPage('/dashboard/resumes?status=archived')
    await ready()
    expect(lastParams()).toEqual({ page: 1, limit: 20 })
  })

  it('clears the status from its chip', async () => {
    renderPage('/dashboard/resumes?status=failed')
    await ready()
    await userEvent.click(screen.getByRole('button', { name: 'Remove Status: Failed' }))
    expect(url()).toBe('')
    await waitFor(() => expect(lastParams()).toEqual({ page: 1, limit: 20 }))
  })
})

describe('ResumesPage options', () => {
  it('shows the lists disabled while they load and enabled when they arrive', async () => {
    let arrive: (v: unknown) => void = () => {}
    options.mockReturnValue(new Promise(resolve => { arrive = resolve }))
    renderPage()
    await screen.findByText('Jane Doe')
    expect(screen.getByRole('button', { name: 'DOMAIN' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'SKILL' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'STATUS' })).toBeEnabled()
    arrive({ data: OPTIONS })
    await waitFor(() => expect(screen.getByRole('button', { name: 'DOMAIN' })).toBeEnabled())
  })

  it('still works when the options cannot be loaded: lists empty, no error, résumés shown', async () => {
    options.mockRejectedValue(new Error('down'))
    renderPage()
    await screen.findByText('Jane Doe')
    await waitFor(() => expect(screen.getByRole('button', { name: 'DOMAIN' })).toHaveAttribute('title', 'No values yet'))
    expect(screen.getByRole('button', { name: 'SENIORITY' })).toBeDisabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await typeFast(screen.getByRole('searchbox', { name: 'Search résumés' }), 'jane{Enter}')
    await waitFor(() => expect(lastParams()).toEqual({ page: 1, limit: 20, search: 'jane' }))
    await pick('STATUS', 'Failed')
    await waitFor(() => expect(lastParams()).toEqual({ page: 1, limit: 20, search: 'jane', status: 'failed' }))
  })

  it('copes with an options answer that has nothing in it', async () => {
    options.mockResolvedValue({ data: {} })
    renderPage()
    await screen.findByText('Jane Doe')
    await waitFor(() => expect(screen.getByRole('button', { name: 'DOMAIN' })).toHaveAttribute('title', 'No values yet'))
  })
})

describe('ResumesPage semantic search', () => {
  const MATCHES = [
    { ...BOB, match_score: 0.923 },
    { ...JANE, match_score: 0.8 },
  ]

  it('starts off, with the list unchanged', async () => {
    renderPage()
    await ready()
    const toggle = screen.getByRole('button', { name: /Semantic Search/ })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(toggle).toHaveTextContent('OFF')
    expect(semantic).not.toHaveBeenCalled()
  })

  it('keeps using the normal list while the search text is under two characters', async () => {
    renderPage()
    await ready()
    await userEvent.click(screen.getByRole('button', { name: /Semantic Search/ }))
    expect(screen.getByRole('button', { name: /Semantic Search/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Semantic Search/ })).toHaveTextContent('ON')
    await typeFast(screen.getByRole('searchbox', { name: 'Search résumés' }), 'j{Enter}')
    await waitFor(() => expect(lastParams()).toEqual({ page: 1, limit: 20, search: 'j' }))
    expect(semantic).not.toHaveBeenCalled()
    expect(screen.queryByRole('columnheader', { name: 'Match' })).not.toBeInTheDocument()
  })

  it('searches by meaning with the filters, shows a Match column and keeps the order it is given', async () => {
    semantic.mockResolvedValue({ data: { resumes: MATCHES, total: 2, query: 'java backend' } })
    renderPage()
    await ready()
    await pick('SENIORITY', /Senior/)
    await userEvent.click(screen.getByRole('button', { name: /Semantic Search/ }))
    await typeFast(screen.getByRole('searchbox', { name: 'Search résumés' }), 'java backend{Enter}')

    await waitFor(() => expect(semantic).toHaveBeenCalledWith({ q: 'java backend', seniority: 'senior', limit: 50 }))
    expect(await screen.findByRole('columnheader', { name: 'Match' })).toBeInTheDocument()
    const names = within(screen.getByRole('table')).getAllByRole('row').slice(1).map(r => r.querySelector('.rs-name')?.textContent)
    expect(names).toEqual(['Bob Roe', 'Jane Doe'])
    expect(screen.getByText('92%')).toBeInTheDocument()
    expect(screen.getByText('80%')).toBeInTheDocument()
    expect(list.mock.calls.some(c => (c[0] as Record<string, unknown>).search === 'java backend')).toBe(false)
  })

  it('has no pager for semantic results, only the count of closest matches', async () => {
    semantic.mockResolvedValue({ data: { resumes: MATCHES, total: 2, query: 'q' } })
    renderPage()
    await ready()
    await userEvent.click(screen.getByRole('button', { name: /Semantic Search/ }))
    await typeFast(screen.getByRole('searchbox', { name: 'Search résumés' }), 'java{Enter}')
    expect(await screen.findByText('Showing the 2 closest matches')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Page 1 of/)).not.toBeInTheDocument()
  })

  it('shows the server message and falls back to the normal list when the search is unavailable', async () => {
    semantic.mockRejectedValue({ response: { status: 503, data: { detail: 'Semantic search is not available right now' } } })
    renderPage()
    await ready()
    await userEvent.click(screen.getByRole('button', { name: /Semantic Search/ }))
    await typeFast(screen.getByRole('searchbox', { name: 'Search résumés' }), 'java{Enter}')

    expect(await screen.findByRole('alert')).toHaveTextContent('Semantic search is not available right now')
    await waitFor(() => expect(lastParams()).toEqual({ page: 1, limit: 20, search: 'java' }))
    expect(await screen.findByText('Jane Doe')).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Match' })).not.toBeInTheDocument()
    expect(screen.getByText(/Showing 1–2 of 2 résumés/)).toBeInTheDocument()
  })

  it('uses the server detail whatever it says', async () => {
    semantic.mockRejectedValue({ response: { status: 500, data: { detail: 'Embedding model is loading' } } })
    renderPage()
    await ready()
    await userEvent.click(screen.getByRole('button', { name: /Semantic Search/ }))
    await typeFast(screen.getByRole('searchbox', { name: 'Search résumés' }), 'java{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('Embedding model is loading')
  })

  it('uses a plain message for any other error', async () => {
    semantic.mockRejectedValue(new Error('network'))
    renderPage()
    await ready()
    await userEvent.click(screen.getByRole('button', { name: /Semantic Search/ }))
    await typeFast(screen.getByRole('searchbox', { name: 'Search résumés' }), 'java{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('Semantic search is not available right now')
    await waitFor(() => expect(lastParams()).toEqual({ page: 1, limit: 20, search: 'java' }))
  })

  it('goes back to the keyword list when it is switched off', async () => {
    semantic.mockResolvedValue({ data: { resumes: MATCHES, total: 2, query: 'q' } })
    renderPage()
    await ready()
    await userEvent.click(screen.getByRole('button', { name: /Semantic Search/ }))
    await typeFast(screen.getByRole('searchbox', { name: 'Search résumés' }), 'java{Enter}')
    await screen.findByRole('columnheader', { name: 'Match' })

    await userEvent.click(screen.getByRole('button', { name: /Semantic Search/ }))
    await waitFor(() => expect(lastParams()).toEqual({ page: 1, limit: 20, search: 'java' }))
    await waitFor(() => expect(screen.queryByRole('columnheader', { name: 'Match' })).not.toBeInTheDocument())
  })

  it('shows the filtered empty state when nothing is close', async () => {
    semantic.mockResolvedValue({ data: { resumes: [], total: 0, query: 'q' } })
    renderPage()
    await ready()
    await userEvent.click(screen.getByRole('button', { name: /Semantic Search/ }))
    await typeFast(screen.getByRole('searchbox', { name: 'Search résumés' }), 'zzzz{Enter}')
    expect(await screen.findByText('No résumés match your filters.')).toBeInTheDocument()
  })

  it('shows a dash for a match without a score and clamps the scores', async () => {
    semantic.mockResolvedValue({ data: { resumes: [{ ...BOB }, { ...JANE, match_score: 1.7 }], total: 2, query: 'q' } })
    renderPage()
    await ready()
    await userEvent.click(screen.getByRole('button', { name: /Semantic Search/ }))
    await typeFast(screen.getByRole('searchbox', { name: 'Search résumés' }), 'java{Enter}')
    expect(await screen.findByText('100%')).toBeInTheDocument()
    const cells = Array.from(document.querySelectorAll('.rs-match')).map(c => c.textContent)
    expect(cells).toEqual(['-', '100%'])
  })
})

describe('ResumesPage domain folders', () => {
  it('opens on the Domain Folders, not the table', async () => {
    renderPage('/dashboard/resumes', { folders: true })
    expect(await screen.findByRole('list', { name: 'Domain folders' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Domain Folders' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'All Candidates' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(list).not.toHaveBeenCalled()
    expect(url()).toBe('')
  })

  it('shows All Candidates as the table when it is chosen', async () => {
    renderPage()
    await ready()
    expect(screen.getByRole('button', { name: 'All Candidates' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Domain Folders' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('table')).toBeInTheDocument()
  })

  it('shows the folders in place of the table, without asking for the list again', async () => {
    renderPage()
    await ready()
    await userEvent.click(screen.getByRole('button', { name: 'Domain Folders' }))

    expect(await screen.findByRole('list', { name: 'Domain folders' })).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText(/Showing 1/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Domain Folders' })).toHaveAttribute('aria-pressed', 'true')
    expect(url()).toBe('')
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('ignores and removes a view in the address, and opens on the folders', async () => {
    renderPage('/dashboard/resumes?view=folders', { folders: true })
    expect(await screen.findByRole('list', { name: 'Domain folders' })).toBeInTheDocument()
    await waitFor(() => expect(url()).toBe(''))
    expect(list).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Domain Folders' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps only the status in the address when switching view', async () => {
    renderPage('/dashboard/resumes?status=processed')
    await ready()
    await userEvent.click(screen.getByRole('button', { name: 'Domain Folders' }))
    expect(url()).toBe('?status=processed')
    await userEvent.click(screen.getByRole('button', { name: 'All Candidates' }))
    expect(url()).toBe('?status=processed')
  })

  it('never writes a view to the address while filtering, opening a folder or searching by meaning', async () => {
    renderPage('/dashboard/resumes', { folders: true })
    await screen.findByRole('list', { name: 'Domain folders' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'SENIORITY' })).toBeEnabled())
    await pick('SENIORITY', /Senior/)
    expect(url()).toBe('')
    await userEvent.click(await screen.findByRole('button', { name: 'Open IT & Software: 40 résumés' }))
    expect(url()).toBe('')
    await userEvent.click(screen.getByRole('button', { name: 'Domain Folders' }))
    expect(url()).toBe('')
    await userEvent.click(screen.getByRole('button', { name: /Semantic Search/ }))
    expect(url()).toBe('')
    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(url()).toBe('')
  })

  it('stays on the list when everything is cleared', async () => {
    renderPage()
    await ready()
    await pick('SENIORITY', /Senior/)
    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    await waitFor(() => expect(lastParams()).toEqual({ page: 1, limit: 20 }))
    expect(screen.getByRole('button', { name: 'All Candidates' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('table')).toBeInTheDocument()
  })

  it('counts the folders under the current filters and search, leaving out the domain ones', async () => {
    renderPage()
    await ready()
    await pick('SENIORITY', /Senior/)
    await pick('STATUS', 'Processed')
    await typeFast(screen.getByRole('searchbox', { name: 'Search résumés' }), 'java{Enter}')
    await openMore()
    await pick('ROLE', /Java Developer/)
    await pick('DOMAIN', /IT & Software/)
    await userEvent.click(screen.getByRole('button', { name: 'Domain Folders' }))

    await screen.findByRole('list', { name: 'Domain folders' })
    expect(lastParams(domains)).toEqual({ search: 'java', seniority: 'senior', status: 'processed' })
  })

  it('shows each folder with its name, count and top roles', async () => {
    renderPage('/dashboard/resumes', { folders: true })
    const tile = await screen.findByRole('button', { name: 'Open IT & Software: 40 résumés' })
    expect(tile).toHaveTextContent('IT & Software')
    expect(tile).toHaveTextContent('40')
    expect(tile).toHaveTextContent('Java Developer')
  })

  it('sets the domain filter and switches to the list when a tile is clicked', async () => {
    renderPage('/dashboard/resumes', { folders: true })
    await userEvent.click(await screen.findByRole('button', { name: 'Open Banking & Financial Services: 12 résumés' }))

    await waitFor(() => expect(lastParams()).toEqual({ page: 1, limit: 20, business_domain: 'banking_financial_services' }))
    expect(screen.getByRole('button', { name: 'All Candidates' })).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(url()).toBe('')
    expect(screen.getByRole('button', { name: /^DOMAIN/ })).toHaveTextContent('Banking & Financial Services')
    expect(screen.getByText('Domain: Banking & Financial Services')).toBeInTheDocument()
  })

  it('opening a folder drops a role that belonged to another one', async () => {
    renderPage()
    await ready()
    await openMore()
    await pick('ROLE', /Java Developer/)
    await userEvent.click(screen.getByRole('button', { name: 'Domain Folders' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Open IT & Software: 40 résumés' }))
    await waitFor(() => expect(lastParams()).toEqual({ page: 1, limit: 20, business_domain: 'it_software' }))
  })

  it('leaves the folders for the list when a domain or a role is chosen', async () => {
    renderPage('/dashboard/resumes', { folders: true })
    await screen.findByRole('list', { name: 'Domain folders' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'DOMAIN' })).toBeEnabled())
    await pick('DOMAIN', /IT & Software/)
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(lastParams()).toEqual({ page: 1, limit: 20, business_domain: 'it_software' })
  })

  it('stays on the folders when another filter changes, and counts again', async () => {
    renderPage('/dashboard/resumes', { folders: true })
    await screen.findByRole('list', { name: 'Domain folders' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'SENIORITY' })).toBeEnabled())
    await pick('SENIORITY', /Senior/)
    await waitFor(() => expect(lastParams(domains)).toEqual({ seniority: 'senior' }))
    expect(screen.getByRole('list', { name: 'Domain folders' })).toBeInTheDocument()
    expect(list).not.toHaveBeenCalled()
  })

  it('shows a loading state, then the folders', async () => {
    let arrive: (v: unknown) => void = () => {}
    domains.mockReturnValue(new Promise(resolve => { arrive = resolve }))
    renderPage('/dashboard/resumes', { folders: true })
    expect(await screen.findByText('Loading folders')).toBeInTheDocument()
    arrive({ data: { folders: FOLDERS, total: 52 } })
    expect(await screen.findByRole('list', { name: 'Domain folders' })).toBeInTheDocument()
  })

  it('shows an error with Retry', async () => {
    domains.mockRejectedValueOnce(new Error('boom'))
    renderPage('/dashboard/resumes', { folders: true })
    expect(await screen.findByText("Couldn't load folders.")).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('list', { name: 'Domain folders' })).toBeInTheDocument()
  })

  it('says there are no résumés yet, or that no folders match the filters', async () => {
    domains.mockResolvedValue({ data: { folders: [], total: 0 } })
    renderPage('/dashboard/resumes', { folders: true })
    expect(await screen.findByText('No résumés yet')).toBeInTheDocument()
  })

  it('says no folders match when filters are applied', async () => {
    domains.mockResolvedValue({ data: { folders: [], total: 0 } })
    renderPage('/dashboard/resumes?status=failed')
    await ready()
    await userEvent.click(screen.getByRole('button', { name: 'Domain Folders' }))
    expect(await screen.findByText('No folders match these filters')).toBeInTheDocument()
  })

  it('turns semantic search on by leaving the folders, and Domain Folders turns it off', async () => {
    renderPage('/dashboard/resumes', { folders: true })
    await screen.findByRole('list', { name: 'Domain folders' })
    await userEvent.click(screen.getByRole('button', { name: /Semantic Search/ }))
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Semantic Search/ })).toHaveAttribute('aria-pressed', 'true')
    expect(url()).toBe('')

    await userEvent.click(screen.getByRole('button', { name: 'Domain Folders' }))
    expect(screen.getByRole('button', { name: /Semantic Search/ })).toHaveAttribute('aria-pressed', 'false')
    expect(await screen.findByRole('list', { name: 'Domain folders' })).toBeInTheDocument()
  })
})

describe('ResumesPage saved searches', () => {
  const SAVED = [
    {
      template_id: 't1', name: 'Senior Java in fintech',
      filter_params: { skill: 'Java,Kafka', seniority: 'senior', industry: 'fintech', status: 'failed', experience_min: 5 },
    },
  ]

  it('applies a saved search to every filter and to the status in the address', async () => {
    savedList.mockResolvedValue({ data: { templates: SAVED } })
    renderPage('/dashboard/resumes', { folders: true })
    await screen.findByRole('list', { name: 'Domain folders' })
    await userEvent.click(await screen.findByRole('button', { name: 'Saved Searches (1)' }))
    await userEvent.click(screen.getByRole('button', { name: 'Senior Java in fintech' }))

    await waitFor(() => expect(lastParams()).toEqual({
      page: 1, limit: 20, skill: 'Java,Kafka', seniority: 'senior', industry: 'fintech', status: 'failed', experience_min: 5,
    }))
    expect(url()).toBe('?status=failed')
    expect(screen.getByRole('button', { name: /SKILL \(2\)/ })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Min yrs' })).toHaveValue(5)
    expect(screen.getByRole('button', { name: /^STATUS/ })).toHaveTextContent('Failed')
  })

  it('ignores certification, job family and availability in a search saved before those filters were removed', async () => {
    savedList.mockResolvedValue({
      data: {
        templates: [{
          template_id: 't3',
          name: 'Old one',
          filter_params: { certification: 'AWS Certified', domain: 'software_engineering', availability_status: 'available', seniority: 'senior' },
        }],
      },
    })
    renderPage()
    await ready()
    await userEvent.click(await screen.findByRole('button', { name: 'Saved Searches (1)' }))
    await userEvent.click(screen.getByRole('button', { name: 'Old one' }))
    await waitFor(() => expect(lastParams()).toEqual({ page: 1, limit: 20, seniority: 'senior' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('replaces the filters that were set before', async () => {
    savedList.mockResolvedValue({ data: { templates: [{ template_id: 't2', name: 'Just failed', filter_params: { status: 'failed' } }] } })
    renderPage()
    await ready()
    await pick('SENIORITY', /Senior/)
    await userEvent.click(await screen.findByRole('button', { name: 'Saved Searches (1)' }))
    await userEvent.click(screen.getByRole('button', { name: 'Just failed' }))
    await waitFor(() => expect(lastParams()).toEqual({ page: 1, limit: 20, status: 'failed' }))
  })

  it('saves the applied filters and tells you in the notice area', async () => {
    renderPage('/dashboard/resumes?status=processed')
    await ready()
    await pick('SENIORITY', /Senior/)
    await userEvent.click(screen.getByRole('button', { name: 'Save this search' }))
    await typeFast(screen.getByRole('textbox', { name: 'Name' }), 'My search')
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(savedCreate).toHaveBeenCalledWith({
      name: 'My search', filter_params: { status: 'processed', seniority: 'senior' }, scope: 'resumes',
    }))
    expect(await screen.findByText('Saved search "My search".')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('tells you in the notice area when a saved search is deleted, and when that fails', async () => {
    savedList.mockResolvedValue({ data: { templates: SAVED } })
    renderPage()
    await ready()
    await userEvent.click(await screen.findByRole('button', { name: 'Saved Searches (1)' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete saved search Senior Java in fintech' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Deleted saved search "Senior Java in fintech".')).toBeInTheDocument()
  })

  it('shows a delete failure as an alert', async () => {
    savedList.mockResolvedValue({ data: { templates: SAVED } })
    savedDelete.mockRejectedValue({ response: { data: { detail: 'Not your saved filter' } } })
    renderPage()
    await ready()
    await userEvent.click(await screen.findByRole('button', { name: 'Saved Searches (1)' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete saved search Senior Java in fintech' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Not your saved filter')
  })
})

describe('ResumesPage output', () => {
  it('renders no em dash anywhere, even with filters, chips and the folders open', async () => {
    renderPage()
    await ready()
    await pick('SENIORITY', /Senior/)
    await openMore()
    const dash = String.fromCharCode(0x2014)
    expect(document.body.textContent).not.toContain(dash)
    await userEvent.click(screen.getByRole('button', { name: 'Domain Folders' }))
    await screen.findByRole('list', { name: 'Domain folders' })
    expect(document.body.textContent).not.toContain(dash)
  })

  it('names every control the toolbar has', async () => {
    renderPage()
    await ready()
    await openMore()
    const root = document.querySelector('.rf') as HTMLElement
    const unnamed = Array.from(root.querySelectorAll('input, button')).filter(el => {
      const label = el.getAttribute('aria-label') ?? (el as HTMLInputElement).placeholder ?? el.textContent
      return !label || !label.trim()
    })
    expect(unnamed).toEqual([])
  })
})
