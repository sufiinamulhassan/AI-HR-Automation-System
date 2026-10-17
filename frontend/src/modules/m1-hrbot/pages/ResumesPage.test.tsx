import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const list = vi.fn()
const bulkDelete = vi.fn()
const download = vi.fn()
const getResume = vi.fn()
const options = vi.fn()
const domains = vi.fn()
const semantic = vi.fn()
const savedList = vi.fn()
const renderAsync = vi.fn()

vi.mock('../../../lib/api', () => ({
  resumesApi: {
    list: (...a: unknown[]) => list(...a),
    bulkDelete: (...a: unknown[]) => bulkDelete(...a),
    download: (...a: unknown[]) => download(...a),
    get: (...a: unknown[]) => getResume(...a),
    options: (...a: unknown[]) => options(...a),
    domains: (...a: unknown[]) => domains(...a),
    semantic: (...a: unknown[]) => semantic(...a),
  },
  savedFiltersApi: {
    list: (...a: unknown[]) => savedList(...a),
    create: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('docx-preview', () => ({ renderAsync: (...a: unknown[]) => renderAsync(...a) }))

const { default: ResumesPage } = await import('./ResumesPage')
const { useAuthStore } = await import('../../../store/auth.store')

const JANE = {
  resume_id: 'r-jane', filename: 'jane.pdf', candidate_name: 'Jane Doe', candidate_email: 'jane@x.com',
  processing_status: 'processed', created_at: '2026-09-01T10:00:00+00:00', location: 'Berlin',
  classification: {
    job_domain: 'software_engineering', seniority_level: 'senior', years_experience: 8,
    skills: ['python', 'sql', 'go', 'rust', 'k8s'],
  },
}
const BOB = {
  resume_id: 'r-bob', filename: 'bob.docx', candidate_name: 'Bob Roe',
  processing_status: 'failed', created_at: '2026-09-02T10:00:00+00:00',
}

function signIn(role: string) {
  useAuthStore.setState({ token: 'tok', user: { role, email: `${role}@x.com`, name: role } })
}

function Probe() {
  const location = useLocation()
  return <output data-testid="search">{location.search}</output>
}

function renderFirstView(url = '/dashboard/resumes') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Probe />
      <ResumesPage />
    </MemoryRouter>
  )
}

function renderPage(url = '/dashboard/resumes') {
  const utils = renderFirstView(url)
  const all = screen.getByRole('button', { name: 'All Candidates' })
  if (all.getAttribute('aria-pressed') !== 'true') fireEvent.click(all)
  return utils
}

const page = (resumes: unknown[], total = resumes.length) => ({ data: { resumes, total, page: 1, limit: 20 } })

describe('ResumesPage', () => {
  beforeEach(() => {
    list.mockReset().mockResolvedValue(page([JANE, BOB]))
    bulkDelete.mockReset()
    download.mockReset()
    getResume.mockReset().mockResolvedValue({ data: {} })
    renderAsync.mockReset().mockResolvedValue(undefined)
    options.mockReset().mockResolvedValue({ data: {} })
    domains.mockReset().mockResolvedValue({ data: { folders: [], total: 0 } })
    semantic.mockReset()
    savedList.mockReset().mockResolvedValue({ data: { templates: [] } })
    signIn('admin')
  })

  it('lists résumés with name, email, profile and status', async () => {
    renderPage()
    expect(await screen.findByText('Jane Doe')).toBeInTheDocument()
    const table = within(screen.getByRole('table'))
    expect(table.getByText('jane@x.com')).toBeInTheDocument()
    expect(table.getByText('software engineering')).toBeInTheDocument()
    expect(table.getByText('8 yrs')).toBeInTheDocument()
    expect(table.getByText('Berlin')).toBeInTheDocument()
    expect(table.getByText('Processed')).toBeInTheDocument()
    expect(table.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText(/Showing 1–2 of 2 résumés/)).toBeInTheDocument()
  })

  it('shows the top three skills as chips and counts the rest', async () => {
    renderPage()
    await screen.findByText('Jane Doe')
    const table = within(screen.getByRole('table'))
    for (const s of ['python', 'sql', 'go']) expect(table.getByText(s)).toBeInTheDocument()
    expect(table.queryByText('rust')).not.toBeInTheDocument()
    expect(table.getByText('+2')).toBeInTheDocument()
  })

  it('shows a dash instead of empty details for a résumé with no experience or location', async () => {
    renderPage()
    await screen.findByText('Bob Roe')
    const bobRow = screen.getByRole('button', { name: 'Delete Bob Roe' }).closest('tr') as HTMLElement
    expect(within(bobRow).getAllByText('-').length).toBeGreaterThanOrEqual(2)
  })

  it('opens already filtered to processed résumés when deep-linked from the dashboard tile', async () => {
    renderPage('/dashboard/resumes?status=processed')
    await screen.findByText('Jane Doe')
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ status: 'processed', page: 1 }))
    expect(screen.getByRole('button', { name: /^STATUS/ })).toHaveTextContent('Processed')
  })

  it('sends a debounced search to the API', async () => {
    renderPage()
    await screen.findByText('Jane Doe')
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search résumés' }), 'jane')
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'jane', page: 1 })))
  })

  it('shows a filtered-empty state with a way out', async () => {
    list.mockResolvedValue(page([]))
    renderPage('/dashboard/resumes?status=failed')
    expect(await screen.findByText('No résumés match your filters.')).toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0])
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.not.objectContaining({ status: 'failed' })))
  })

  it('shows an error with Retry when the list fails to load', async () => {
    list.mockRejectedValueOnce(new Error('boom'))
    renderPage()
    expect(await screen.findByText("Couldn't load résumés.")).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Jane Doe')).toBeInTheDocument()
  })

  describe('delete', () => {
    it('confirms, deletes one résumé and refreshes the list', async () => {
      bulkDelete.mockResolvedValue({ data: { deleted: ['r-jane'], in_progress: [], not_found: [] } })
      renderPage()
      await screen.findByText('Jane Doe')

      await userEvent.click(screen.getByRole('button', { name: 'Delete Jane Doe' }))
      const dialog = screen.getByRole('dialog')
      expect(within(dialog).getByText('Delete this résumé?')).toBeInTheDocument()
      expect(within(dialog).getByText('Jane Doe')).toBeInTheDocument()
      expect(bulkDelete).not.toHaveBeenCalled()

      list.mockResolvedValue(page([BOB]))
      await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

      await waitFor(() => expect(bulkDelete).toHaveBeenCalledWith(['r-jane']))
      expect(await screen.findByText('Deleted 1 résumé.')).toBeInTheDocument()
      await waitFor(() => expect(screen.queryByText('Jane Doe')).not.toBeInTheDocument())
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('Cancel closes the dialog without deleting', async () => {
      renderPage()
      await screen.findByText('Jane Doe')
      await userEvent.click(screen.getByRole('button', { name: 'Delete Jane Doe' }))
      await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(bulkDelete).not.toHaveBeenCalled()
    })

    it('bulk-deletes the selected rows', async () => {
      bulkDelete.mockResolvedValue({ data: { deleted: ['r-jane', 'r-bob'], in_progress: [], not_found: [] } })
      renderPage()
      await screen.findByText('Jane Doe')

      await userEvent.click(screen.getByRole('checkbox', { name: 'Select all résumés on this page' }))
      expect(screen.getByText('2 selected')).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Delete selected' }))
      const dialog = screen.getByRole('dialog')
      expect(within(dialog).getByText('Delete 2 résumés?')).toBeInTheDocument()
      await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

      await waitFor(() => expect(bulkDelete).toHaveBeenCalledWith(['r-jane', 'r-bob']))
      expect(await screen.findByText('Deleted 2 résumés.')).toBeInTheDocument()
      expect(screen.queryByText('2 selected')).not.toBeInTheDocument()
    })

    it('reports résumés that were skipped because they are still processing', async () => {
      bulkDelete.mockResolvedValue({ data: { deleted: ['r-jane'], in_progress: ['r-bob'], not_found: [] } })
      renderPage()
      await screen.findByText('Jane Doe')
      await userEvent.click(screen.getByRole('checkbox', { name: 'Select all résumés on this page' }))
      await userEvent.click(screen.getByRole('button', { name: 'Delete selected' }))
      await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))

      expect(await screen.findByText('Deleted 1 résumé. 1 was still being processed and skipped.')).toBeInTheDocument()
    })

    it('says so plainly when nothing could be deleted', async () => {
      bulkDelete.mockResolvedValue({ data: { deleted: [], in_progress: ['r-bob'], not_found: [] } })
      renderPage()
      await screen.findByText('Jane Doe')
      await userEvent.click(screen.getByRole('button', { name: 'Delete Bob Roe' }))
      await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Nothing was deleted')
    })

    it('surfaces the server message when the request fails', async () => {
      bulkDelete.mockRejectedValue({ response: { data: { detail: 'Database unavailable' } } })
      renderPage()
      await screen.findByText('Jane Doe')
      await userEvent.click(screen.getByRole('button', { name: 'Delete Jane Doe' }))
      await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('hides delete, selection and upload from a non-admin recruiter', async () => {
    signIn('standard')
    renderPage()
    await screen.findByText('Jane Doe')

    expect(screen.queryByRole('button', { name: /^Delete / })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Upload Résumés' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View file for Jane Doe' })).toBeInTheDocument()
  })
})

function storedFile(body: string, contentType: string, status = 200) {
  const fetchMock = vi.fn(async () => new Response(body, { status, headers: { 'content-type': contentType } }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('ResumesPage View', () => {
  let createObjectURL: ReturnType<typeof vi.fn>
  let open: { mockRestore: () => void }
  let anchorClick: { mockRestore: () => void }

  beforeEach(() => {
    list.mockReset().mockResolvedValue(page([JANE, BOB]))
    getResume.mockReset().mockResolvedValue({ data: {} })
    renderAsync.mockReset().mockResolvedValue(undefined)
    options.mockReset().mockResolvedValue({ data: {} })
    savedList.mockReset().mockResolvedValue({ data: { templates: [] } })
    let n = 0
    createObjectURL = vi.fn(() => `blob:fake-${++n}`)
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() })
    open = vi.spyOn(window, 'open')
    anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    signIn('admin')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    open.mockRestore()
    anchorClick.mockRestore()
  })

  async function view(name: string) {
    renderPage()
    await screen.findByText(name)
    await userEvent.click(screen.getByRole('button', { name: `View file for ${name}` }))
    return screen.findByRole('dialog', { name: `Résumé of ${name}` })
  }

  it('opens a PDF in a popup with the browser frame: no download, no new tab', async () => {
    getResume.mockResolvedValue({ data: { filename: 'jane.pdf' } })
    const fetchMock = storedFile('%PDF-1.4', 'application/pdf')
    const dialog = await view('Jane Doe')

    const frame = await within(dialog).findByTitle('Resume preview')
    expect(frame.getAttribute('src')).toMatch(/^blob:fake-\d+#view=FitH/)
    expect(within(dialog).getByText('Jane Doe')).toBeInTheDocument()
    expect(within(dialog).getByText('jane.pdf')).toBeInTheDocument()
    expect(getResume).toHaveBeenCalledWith('r-jane', true)
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/resumes/r-jane/download'), { headers: { Authorization: 'Bearer tok' } })
    expect(open).not.toHaveBeenCalled()
    expect(anchorClick).not.toHaveBeenCalled()
    expect(download).not.toHaveBeenCalled()
  })

  it('draws a Word file as its pages in the popup', async () => {
    getResume.mockResolvedValue({ data: { filename: 'bob.docx' } })
    storedFile('PK', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    const dialog = await view('Bob Roe')

    await waitFor(() => expect(renderAsync).toHaveBeenCalledTimes(1))
    expect(renderAsync.mock.calls[0][1]).toBeInstanceOf(HTMLElement)
    expect(within(dialog).queryByTitle('Resume preview')).not.toBeInTheDocument()
    expect(within(dialog).queryByText(/Preview not available/)).not.toBeInTheDocument()
    expect(open).not.toHaveBeenCalled()
    expect(anchorClick).not.toHaveBeenCalled()
  })

  it('shows a text file as text in the popup', async () => {
    getResume.mockResolvedValue({ data: { filename: 'jane.txt' } })
    storedFile('Jane Doe\nSenior engineer, eight years', 'text/plain')
    const dialog = await view('Jane Doe')
    expect(await within(dialog).findByText(/Senior engineer, eight years/)).toBeInTheDocument()
    expect(within(dialog).queryByTitle('Resume preview')).not.toBeInTheDocument()
  })

  it('offers Download inside the popup, which is the only way a file is saved', async () => {
    getResume.mockResolvedValue({ data: { filename: 'jane.pdf' } })
    storedFile('%PDF-1.4', 'application/pdf')
    const dialog = await view('Jane Doe')
    await userEvent.click(await within(dialog).findByRole('button', { name: /Download/ }))
    expect(anchorClick).toHaveBeenCalledTimes(1)
  })

  it('falls back to the text read from the file when the file itself is gone', async () => {
    getResume.mockResolvedValue({ data: { filename: 'bob.docx', text: 'Bob Roe, designer, five years' } })
    storedFile('Not found', 'application/json', 404)
    const dialog = await view('Bob Roe')
    expect(await within(dialog).findByText(/Bob Roe, designer, five years/)).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /Download/ })).not.toBeInTheDocument()
  })

  it('says there is no preview when there is neither a file nor text', async () => {
    storedFile('Not found', 'application/json', 404)
    const dialog = await view('Bob Roe')
    expect(await within(dialog).findByText('Preview not available for this résumé.')).toBeInTheDocument()
  })

  it('closes from the close button, from Escape and from the backdrop', async () => {
    storedFile('Not found', 'application/json', 404)
    const dialog = await view('Bob Roe')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'View file for Bob Roe' }))
    await screen.findByRole('dialog', { name: 'Résumé of Bob Roe' })
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'View file for Bob Roe' }))
    const again = await screen.findByRole('dialog', { name: 'Résumé of Bob Roe' })
    await userEvent.click(again.parentElement as HTMLElement)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('stays open when the click is inside the popup', async () => {
    storedFile('Not found', 'application/json', 404)
    const dialog = await view('Bob Roe')
    await userEvent.click(within(dialog).getByText('Bob Roe'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('titles the popup with the file name when the résumé has no name', async () => {
    list.mockResolvedValue(page([{ resume_id: 'r-x', filename: 'cv_unknown.pdf', processing_status: 'processed' }]))
    storedFile('Not found', 'application/json', 404)
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'View file for cv_unknown.pdf' }))
    expect(await screen.findByRole('dialog', { name: 'Résumé of cv_unknown.pdf' })).toBeInTheDocument()
  })

  it('is open to a recruiter too, who cannot delete', async () => {
    signIn('standard')
    storedFile('Not found', 'application/json', 404)
    const dialog = await view('Jane Doe')
    expect(dialog).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Delete / })).not.toBeInTheDocument()
  })
})

describe('ResumesPage first view and the address', () => {
  const FOLDER = { value: 'it_software', label: 'IT & Software', count: 3, roles: [{ value: 'Java Developer', count: 2 }] }

  beforeEach(() => {
    domains.mockReset().mockResolvedValue({ data: { folders: [FOLDER], total: 3 } })
    options.mockReset().mockResolvedValue({ data: {} })
    savedList.mockReset().mockResolvedValue({ data: { templates: [] } })
    list.mockReset().mockResolvedValue(page([JANE, BOB]))
    signIn('admin')
  })

  const search = () => screen.getByTestId('search').textContent

  it('opens on the Domain Folders view when there is no query string', async () => {
    renderFirstView()
    expect(await screen.findByRole('list', { name: 'Domain folders' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Domain Folders' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'All Candidates' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(list).not.toHaveBeenCalled()
    expect(search()).toBe('')
  })

  it('opens on the list for the dashboard link, which means show me the résumés', async () => {
    renderFirstView('/dashboard/resumes?status=processed')
    expect(await screen.findByText('Jane Doe')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All Candidates' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('list', { name: 'Domain folders' })).not.toBeInTheDocument()
    expect(domains).not.toHaveBeenCalled()
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ status: 'processed', page: 1 }))
    expect(search()).toBe('?status=processed')
  })

  it.each(['pending', 'failed'])('opens on the list for any status filter, such as %s', async status => {
    renderFirstView(`/dashboard/resumes?status=${status}`)
    expect(await screen.findByText('Jane Doe')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All Candidates' })).toHaveAttribute('aria-pressed', 'true')
    expect(search()).toBe(`?status=${status}`)
  })

  it('does not count a status it does not know as a filter, so the folders come first', async () => {
    renderFirstView('/dashboard/resumes?status=archived')
    expect(await screen.findByRole('list', { name: 'Domain folders' })).toBeInTheDocument()
    expect(list).not.toHaveBeenCalled()
  })

  it('never puts a view in the address, whichever way the view changes', async () => {
    renderFirstView()
    await screen.findByRole('list', { name: 'Domain folders' })

    await userEvent.click(screen.getByRole('button', { name: 'All Candidates' }))
    expect(await screen.findByText('Jane Doe')).toBeInTheDocument()
    expect(search()).toBe('')

    await userEvent.click(screen.getByRole('button', { name: 'Domain Folders' }))
    expect(await screen.findByRole('list', { name: 'Domain folders' })).toBeInTheDocument()
    expect(search()).toBe('')

    await userEvent.click(screen.getByRole('button', { name: 'Open IT & Software: 3 résumés' }))
    expect(await screen.findByText('Jane Doe')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All Candidates' })).toHaveAttribute('aria-pressed', 'true')
    expect(search()).toBe('')

    await userEvent.click(screen.getByRole('button', { name: /Semantic Search/ }))
    expect(search()).toBe('')
  })

  it('keeps only the status in the address when the view changes', async () => {
    renderFirstView('/dashboard/resumes?status=processed')
    await screen.findByText('Jane Doe')
    await userEvent.click(screen.getByRole('button', { name: 'Domain Folders' }))
    expect(await screen.findByRole('list', { name: 'Domain folders' })).toBeInTheDocument()
    expect(search()).toBe('?status=processed')
    await userEvent.click(screen.getByRole('button', { name: 'All Candidates' }))
    expect(search()).toBe('?status=processed')
  })

  it('removes a stale view parameter from the address and ignores it', async () => {
    renderFirstView('/dashboard/resumes?view=folders')
    expect(await screen.findByRole('list', { name: 'Domain folders' })).toBeInTheDocument()
    await waitFor(() => expect(search()).toBe(''))
  })

  it('ignores view=all as well, and still opens on the folders', async () => {
    renderFirstView('/dashboard/resumes?view=all')
    expect(await screen.findByRole('list', { name: 'Domain folders' })).toBeInTheDocument()
    await waitFor(() => expect(search()).toBe(''))
    expect(list).not.toHaveBeenCalled()
  })

  it('keeps the status and drops the view when both are in the address', async () => {
    renderFirstView('/dashboard/resumes?view=folders&status=failed')
    expect(await screen.findByText('Jane Doe')).toBeInTheDocument()
    await waitFor(() => expect(search()).toBe('?status=failed'))
    expect(screen.getByRole('button', { name: 'All Candidates' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('clears every filter without sending you back to the folders', async () => {
    renderFirstView('/dashboard/resumes?status=failed')
    await screen.findByText('Jane Doe')
    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ page: 1, limit: 20 }))
    expect(screen.getByRole('button', { name: 'All Candidates' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(search()).toBe('')
  })

  it('opens the list with the domain filter set when a folder is clicked', async () => {
    renderFirstView()
    await userEvent.click(await screen.findByRole('button', { name: 'Open IT & Software: 3 résumés' }))
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ page: 1, limit: 20, business_domain: 'it_software' }))
    expect(await screen.findByText('Domain: IT & Software')).toBeInTheDocument()
  })
})
