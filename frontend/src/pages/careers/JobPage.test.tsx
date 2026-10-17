import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CareersJobDetail } from '../../lib/careersTypes'

const api = vi.hoisted(() => ({ job: vi.fn(), apply: vi.fn() }))

vi.mock('../../lib/api', () => ({
  careersApi: { job: api.job, apply: api.apply },
}))

const { default: JobPage } = await import('./JobPage')

const DESCRIPTION = 'Overview:\nWe build things.\n\nWhat you will do:\n- Write code\n- Review code\n\n<b>not bold</b>'

function makeJob(patch: Partial<CareersJobDetail> = {}): CareersJobDetail {
  return {
    job_id: 'job-1',
    title: 'Senior Engineer',
    summary: 'Build things.',
    location: 'London',
    employment_type: 'full-time',
    is_remote: true,
    skills: ['Python', 'SQL', 'Docker'],
    posted_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    deadline_at: '2099-11-03T12:00:00Z',
    description: DESCRIPTION,
    job_grade: 'Grade 5',
    experience_level: 'senior',
    industry: 'information_technology',
    accepting: true,
    company: {
      slug: 'acme',
      name: 'Acme',
      logo_url: null,
      website: 'https://acme.test',
      industry: null,
      privacy_url: 'https://acme.test/privacy',
      terms_url: null,
    },
    ...patch,
  }
}

function renderPage(id = 'job-1') {
  return render(
    <MemoryRouter initialEntries={[`/careers/${id}`]}>
      <Routes>
        <Route path="/careers/:jobId" element={<JobPage />} />
        <Route path="/careers" element={<div>All jobs page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  api.job.mockReset().mockResolvedValue({ data: makeJob() })
  api.apply.mockReset()
})

describe('JobPage: details', () => {
  it('loads the job named in the URL', async () => {
    renderPage('job-42')
    await screen.findByRole('heading', { level: 1, name: 'Senior Engineer' })
    expect(api.job).toHaveBeenCalledWith('job-42')
  })

  it('shows the company link, title and tags in the header', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'Senior Engineer' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Acme' })).toHaveAttribute('href', '/careers?company=acme')
    expect(screen.getByText('London')).toBeInTheDocument()
    expect(screen.getByText('Full time')).toBeInTheDocument()
    expect(screen.getByText('Remote')).toBeInTheDocument()
  })

  it('shows the description as headings, paragraphs and real bullet lists, never as HTML', async () => {
    const { container } = renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Senior Engineer' })
    const body = container.querySelector('.cr-job-desc') as HTMLElement
    expect(within(body).getByRole('heading', { level: 3, name: 'Overview' })).toBeInTheDocument()
    expect(within(body).getByRole('heading', { level: 3, name: 'What you will do' })).toBeInTheDocument()
    const items = within(within(body).getByRole('list')).getAllByRole('listitem')
    expect(items.map(li => li.textContent)).toEqual(['Write code', 'Review code'])
    expect(body.textContent).not.toMatch(/^- /m)
    expect(body.querySelector('b')).toBeNull()
    expect(body).toHaveTextContent('<b>not bold</b>')
    expect(screen.getByRole('heading', { level: 2, name: 'About the role' })).toBeInTheDocument()
  })

  it('does not repeat the section title when the description starts with the same heading', async () => {
    api.job.mockResolvedValue({ data: makeJob({ description: 'About the role:\nWe build things.\n\nDuties:\n- Ship' }) })
    const { container } = renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Senior Engineer' })
    const body = container.querySelector('.cr-job-desc') as HTMLElement
    expect(within(body).queryByRole('heading', { name: 'About the role' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('heading', { name: 'About the role' })).toHaveLength(1)
    expect(body).toHaveTextContent('We build things.')
    expect(within(body).getByRole('heading', { level: 3, name: 'Duties' })).toBeInTheDocument()
  })

  it('shows a plain description with no structure as one paragraph per line', async () => {
    api.job.mockResolvedValue({ data: makeJob({ description: 'Just one line of text.' }) })
    const { container } = renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Senior Engineer' })
    const body = container.querySelector('.cr-job-desc') as HTMLElement
    expect(body.querySelectorAll('p')).toHaveLength(1)
    expect(body.querySelector('ul')).toBeNull()
    expect(body).toHaveTextContent('Just one line of text.')
  })

  it('copes with a missing description', async () => {
    api.job.mockResolvedValue({ data: makeJob({ description: undefined as unknown as string }) })
    const { container } = renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Senior Engineer' })
    expect((container.querySelector('.cr-job-desc') as HTMLElement).children).toHaveLength(0)
  })

  it('shows the skills and the facts, cleaning up raw values', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Senior Engineer' })
    const skills = screen.getByRole('list', { name: 'Skills' })
    expect(within(skills).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Python', 'SQL', 'Docker'])

    const facts = screen.getByRole('region', { name: 'Role details' })
    expect(within(facts).getByText('Experience level').nextSibling).toHaveTextContent('Senior')
    expect(within(facts).getByText('Job grade').nextSibling).toHaveTextContent('Grade 5')
    expect(within(facts).getByText('Industry').nextSibling).toHaveTextContent('Information technology')
    expect(within(facts).getByText('Posted').nextSibling).toHaveTextContent('2 days ago')
    expect(within(facts).getByText('Closes').nextSibling).toHaveTextContent(/^Nov [34], 2099$/)
  })

  it('leaves out the facts and skills the job does not have', async () => {
    api.job.mockResolvedValue({
      data: makeJob({ job_grade: null, experience_level: null, industry: null, deadline_at: null, skills: [] }),
    })
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Senior Engineer' })
    expect(screen.queryByText('Job grade')).not.toBeInTheDocument()
    expect(screen.queryByText('Closes')).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Skills' })).not.toBeInTheDocument()
    expect(screen.getByText('Posted')).toBeInTheDocument()
  })

  it('has the apply form for this job, with the company links in its consent', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { level: 2, name: 'Apply for this role' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit application' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute('href', 'https://acme.test/privacy')
    expect(screen.queryByRole('link', { name: 'Terms' })).not.toBeInTheDocument()
  })

  it('links back to all jobs and offers a jump to the form', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Senior Engineer' })
    expect(screen.getByRole('link', { name: 'Back to all jobs' })).toHaveAttribute('href', '/careers')
    expect(screen.getByRole('link', { name: 'Apply now' })).toHaveAttribute('href', '#apply')
  })

  it('sets the page title to the job and the company', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Senior Engineer' })
    expect(document.title).toBe('Senior Engineer at Acme | Hirely.ai')
  })

  it('adds job posting data for search engines when the job accepts applications', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Senior Engineer' })
    await waitFor(() => expect(document.head.querySelector('script[type="application/ld+json"]')).not.toBeNull())
    const data = JSON.parse(document.head.querySelector('script[type="application/ld+json"]')?.textContent ?? '{}')
    expect(data['@type']).toBe('JobPosting')
    expect(data.title).toBe('Senior Engineer')
    expect(data.employmentType).toBe('FULL_TIME')
    expect(data.jobLocationType).toBe('TELECOMMUTE')
    expect(data.hiringOrganization).toEqual({ '@type': 'Organization', name: 'Acme', sameAs: 'https://acme.test' })
    expect(data.validThrough).toBe('2099-11-03T12:00:00Z')
  })

  it('leaves out job posting data once the job stops accepting applications', async () => {
    api.job.mockResolvedValue({ data: makeJob({ accepting: false }) })
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Senior Engineer' })
    expect(document.head.querySelector('script[type="application/ld+json"]')).toBeNull()
  })

  it('shows a busy skeleton while the job loads', async () => {
    let resolve!: (v: unknown) => void
    api.job.mockReturnValue(new Promise(r => { resolve = r }))
    const { container } = renderPage()
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    resolve({ data: makeJob() })
    expect(await screen.findByRole('heading', { level: 1, name: 'Senior Engineer' })).toBeInTheDocument()
  })
})

describe('JobPage: closed and failed', () => {
  it('shows the friendly closed state with a button back to all jobs when the job is gone', async () => {
    api.job.mockRejectedValue({ response: { status: 404, data: { detail: 'This job is no longer open.' } } })
    const u = userEvent.setup({ delay: null })
    renderPage('gone')
    expect(await screen.findByRole('heading', { level: 1, name: 'This job is no longer open' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Submit application' })).not.toBeInTheDocument()
    const back = screen.getByRole('link', { name: 'Browse all jobs' })
    expect(back).toHaveAttribute('href', '/careers')
    expect(back).toHaveClass('btn-primary')
    await u.click(back)
    expect(await screen.findByText('All jobs page')).toBeInTheDocument()
  })

  it('shows an error with Retry for any other failure and recovers on retry', async () => {
    api.job.mockRejectedValueOnce({ response: { status: 500, data: {} } })
    const u = userEvent.setup({ delay: null })
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not load this job')
    await u.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Senior Engineer' })).toBeInTheDocument()
    expect(api.job).toHaveBeenCalledTimes(2)
  })

  it('shows the error state when the network is down', async () => {
    api.job.mockRejectedValue(new Error('Network Error'))
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not load this job')
  })
})
