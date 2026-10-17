import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiOverview } from '../../lib/platformTypes'
import { AI_KEYS, AI_OVERVIEW, aiCompanyRow, httpError } from '../../test/platformFixtures'

const ai = vi.fn()

vi.mock('../../lib/api', () => ({
  platformApi: { ai: (...a: unknown[]) => ai(...a) },
}))

const { default: PlatformAiPage, OPEN_BY_DEFAULT } = await import('./PlatformAiPage')

function Where() {
  return <div data-testid="search">{useLocation().search}</div>
}

function renderPage(path = '/platform/ai') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PlatformAiPage />
      <Where />
    </MemoryRouter>,
  )
}

const findCompanies = () => screen.findByRole('table', { name: 'Companies' })
const companies = () => screen.getByRole('table', { name: 'Companies' })
const order = () => within(companies()).getAllByRole('link').map(a => a.textContent)
const rowOf = (name: string) => screen.getByRole('link', { name }).closest('tr')!
const toggleOf = (name: string) => screen.getByRole('button', { name: new RegExp(`the details of ${name}$`) })

beforeEach(() => {
  ai.mockReset().mockResolvedValue({ data: AI_OVERVIEW })
})

describe('PlatformAiPage', () => {
  it('shows a loading state, then the keys and a row per company', async () => {
    let resolve!: (v: unknown) => void
    ai.mockReturnValue(new Promise(r => { resolve = r }))
    renderPage()
    expect(screen.getByRole('status')).toHaveTextContent(/loading the AI models/i)

    resolve({ data: AI_OVERVIEW })
    expect(await screen.findByRole('heading', { level: 1, name: 'AI models and keys' })).toBeInTheDocument()
    expect(order()).toEqual(['Acme Corp', 'Zed Staffing', 'Midway Labs'])
    expect(screen.getByText('3 companies')).toBeInTheDocument()
  })

  it('names each platform key, masks it and counts the traffic through it', async () => {
    renderPage()
    const anthropic = await screen.findByRole('region', { name: 'Anthropic key' })
    expect(anthropic).toHaveTextContent('Key set')
    expect(anthropic).toHaveTextContent('Platform key')
    expect(within(anthropic).getByText('ANTHROPIC_API_KEY')).toBeInTheDocument()
    expect(within(anthropic).getByText('********FAAA')).toBeInTheDocument()
    expect(anthropic).toHaveTextContent('Companies2')
    expect(anthropic).toHaveTextContent('Calls310')
    expect(anthropic).toHaveTextContent('Spend$1.25')

    const openai = screen.getByRole('region', { name: 'OpenAI key' })
    expect(within(openai).getByText('OPENAI_API_KEY')).toBeInTheDocument()
    expect(openai).toHaveTextContent('Companies1')
    expect(openai).toHaveTextContent('Spend$0.0404')
  })

  it('lists the models behind each key, embeddings included', async () => {
    renderPage()
    const anthropic = await screen.findByRole('region', { name: 'Anthropic key' })
    expect(within(anthropic).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Claude Haiku 4.5 310'])

    const openai = screen.getByRole('region', { name: 'OpenAI key' })
    expect(within(openai).getAllByRole('listitem').map(li => li.textContent)).toEqual([
      'GPT-5 Mini 40', 'Text Embedding 3 Small 52',
    ])
    expect(within(openai).getByText('Text Embedding 3 Small', { exact: false })).toHaveAttribute('title', 'Embeddings, $0.0004')
  })

  it('never shows anything that looks like a key', async () => {
    renderPage()
    await findCompanies()
    expect(document.body.textContent).not.toMatch(/sk-/)
  })

  it('says so when a provider has no key, and lists no models for it', async () => {
    const keys = AI_KEYS.map(k => (k.id === 'openai' ? { ...k, configured: false, mask: null, models: [] } : k))
    ai.mockResolvedValue({ data: { ...AI_OVERVIEW, keys } satisfies AiOverview })
    renderPage()
    const openai = await screen.findByRole('region', { name: 'OpenAI key' })
    expect(openai).toHaveTextContent('No key')
    expect(within(openai).queryByText(/\*{8}/)).toBeNull()
    expect(within(openai).queryByText('Models')).toBeNull()
  })

  it('has a column for each key', async () => {
    renderPage()
    const table = await findCompanies()
    expect(within(table.querySelector('thead')!).getAllByRole('columnheader').map(h => h.textContent)).toEqual([
      'Company', 'Default model', 'Jobs on own model', 'Models used', 'Anthropic spend', 'OpenAI spend', 'Total spend',
    ])
  })

  it('shows a company\'s default model, its own-model jobs, what ran and what each key was charged', async () => {
    renderPage()
    await findCompanies()
    const row = rowOf('Acme Corp')
    const cells = within(row).getAllByRole('cell')

    expect(row).toHaveTextContent('Acme Holdings')
    expect(cells[0]).toHaveTextContent('Claude Haiku 4.5')
    expect(cells[1]).toHaveTextContent('2')
    expect(within(cells[2]).getAllByRole('listitem').map(li => li.textContent)).toEqual([
      'Claude Haiku 4.5 250', 'GPT-5 Mini 40', 'Text Embedding 3 Small 52',
    ])
    expect(cells[3]).toHaveTextContent('$1.10')
    expect(cells[3]).toHaveTextContent('250 calls')
    expect(cells[4]).toHaveTextContent('$0.0404')
    expect(cells[4]).toHaveTextContent('92 calls')
    expect(cells[5]).toHaveTextContent('$1.14')
  })

  it('tells a model\'s provider, type and spend in the chip\'s title', async () => {
    renderPage()
    await findCompanies()
    expect(within(rowOf('Acme Corp')).getByText('GPT-5 Mini', { exact: false })).toHaveAttribute('title', 'OpenAI, Chat, $0.0400')
  })

  it('shows a dash for a company that has run nothing', async () => {
    renderPage()
    await findCompanies()
    const cells = within(rowOf('Midway Labs')).getAllByRole('cell')
    expect(cells[2]).toHaveTextContent('-')
    expect(cells[5]).toHaveTextContent('$0.00')
  })

  it('flags a suspended company in words and links each company to its page', async () => {
    renderPage()
    await findCompanies()
    expect(screen.getByRole('link', { name: 'Zed Staffing' }).closest('th')).toHaveTextContent('Suspended')
    expect(screen.getByRole('link', { name: 'Acme Corp' }).closest('th')).not.toHaveTextContent('Suspended')
    expect(screen.getByRole('link', { name: 'Zed Staffing' })).toHaveAttribute('href', '/platform/companies/cmp_zed')
  })

  it('shows the order the server sent until a header is clicked', async () => {
    renderPage()
    const table = await findCompanies()
    const headers = within(table.querySelector('thead')!).getAllByRole('columnheader')
    for (const th of headers.filter(h => h.textContent !== 'Models used')) expect(th).toHaveAttribute('aria-sort', 'none')
  })

  it('sorts by each column, a count biggest first and a name from A to Z', async () => {
    const user = userEvent.setup({ delay: null })
    renderPage()
    await findCompanies()

    await user.click(screen.getByRole('button', { name: 'Jobs on own model' }))
    expect(order()).toEqual(['Midway Labs', 'Acme Corp', 'Zed Staffing'])

    await user.click(screen.getByRole('button', { name: 'Company' }))
    expect(order()).toEqual(['Acme Corp', 'Midway Labs', 'Zed Staffing'])
    await user.click(screen.getByRole('button', { name: /^Company/ }))
    expect(order()).toEqual(['Zed Staffing', 'Midway Labs', 'Acme Corp'])

    await user.click(screen.getByRole('button', { name: 'Default model' }))
    expect(order()).toEqual(['Acme Corp', 'Midway Labs', 'Zed Staffing'])

    await user.click(screen.getByRole('button', { name: 'OpenAI spend' }))
    expect(order()[0]).toBe('Acme Corp')
    expect(screen.getByRole('columnheader', { name: /OpenAI spend/ })).toHaveAttribute('aria-sort', 'descending')

    await user.click(screen.getByRole('button', { name: 'Total spend' }))
    expect(order()).toEqual(['Acme Corp', 'Zed Staffing', 'Midway Labs'])
  })

  it('keeps each company\'s details with it when the rows are re-sorted', async () => {
    const user = userEvent.setup({ delay: null })
    renderPage()
    await findCompanies()
    await user.click(screen.getByRole('button', { name: 'Company' }))
    const midway = rowOf('Midway Labs')
    expect(midway.nextElementSibling).toHaveAttribute('id', 'pai-detail-cmp_midway')
  })

  it('asks for the default window and offers 7, 30 and 90 days', async () => {
    renderPage()
    await findCompanies()
    expect(ai).toHaveBeenLastCalledWith(30)
    expect(within(screen.getByRole('radiogroup', { name: 'Time window' })).getAllByRole('radio').map(r => r.textContent)).toEqual(['7 days', '30 days', '90 days'])
  })

  it('reloads for another window and keeps it in the URL', async () => {
    const user = userEvent.setup({ delay: null })
    renderPage()
    await findCompanies()

    await user.click(screen.getByRole('radio', { name: '7 days' }))
    await waitFor(() => expect(ai).toHaveBeenLastCalledWith(7))
    expect(screen.getByTestId('search')).toHaveTextContent('?window=7')
  })

  it('opens on the month named in the URL', async () => {
    renderPage('/platform/ai?month=2026-09')
    await findCompanies()
    expect(ai).toHaveBeenLastCalledWith({ month: '2026-09' })
  })

  it('shows when the figures were worked out, and Refresh asks for fresh ones once', async () => {
    const user = userEvent.setup({ delay: null })
    renderPage()
    await findCompanies()
    expect(screen.getByText(/^As of /)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(ai).toHaveBeenLastCalledWith(30, { refresh: true }))

    await user.click(screen.getByRole('radio', { name: '90 days' }))
    await waitFor(() => expect(ai).toHaveBeenLastCalledWith(90))
  })

  it('says what is missing when there is no company, and still shows the keys', async () => {
    ai.mockResolvedValue({ data: { ...AI_OVERVIEW, companies: [] } })
    renderPage()
    expect(await screen.findByText('No companies yet.')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Anthropic key' })).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('reports a failure and retries', async () => {
    const user = userEvent.setup({ delay: null })
    ai.mockRejectedValueOnce(httpError(500, 'The database is busy.'))
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('The database is busy.')

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await findCompanies()).toBeInTheDocument()
    expect(ai).toHaveBeenCalledTimes(2)
  })
})

describe('the details under each company', () => {
  it('open for every company when there are only a few', async () => {
    renderPage()
    await findCompanies()
    for (const name of ['Acme Corp', 'Zed Staffing', 'Midway Labs']) {
      expect(toggleOf(name)).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByRole('table', { name: `Jobs of ${name}` })).toBeInTheDocument()
    }
  })

  it('list every job with its model, provider, key and who chose the model', async () => {
    renderPage()
    await findCompanies()
    const jobs = screen.getByRole('table', { name: 'Jobs of Acme Corp' })
    const row = (label: string) => within(within(jobs).getByRole('rowheader', { name: label }).closest('tr')!).getAllByRole('cell').map(c => c.textContent)

    expect(row('Interview questions, follow-ups and scoring')).toEqual(['GPT-5 Mini', 'OpenAI', 'OPENAI_API_KEY********Sv4A', 'Company'])
    expect(row('Job description parsing')).toEqual(['Claude Haiku 4.5', 'Anthropic', 'ANTHROPIC_API_KEY********FAAA', 'Default'])
    expect(row('Embeddings for CV and job matching')).toEqual(['Text Embedding 3 Large', 'OpenAI', 'OPENAI_API_KEY********Sv4A', 'Company'])
  })

  it('warn, in words, about a job whose provider has no key', async () => {
    renderPage()
    await findCompanies()
    const jobs = screen.getByRole('table', { name: 'Jobs of Zed Staffing' })
    expect(within(jobs).getByRole('rowheader', { name: 'Scenario answer scoring' }).closest('tr')).toHaveTextContent('No key')
  })

  it('show everything that ran, by type, provider, tokens and spend', async () => {
    renderPage()
    await findCompanies()
    const used = screen.getByRole('table', { name: 'Used by Acme Corp' })
    const rows = within(used).getAllByRole('row').slice(1).map(r => [
      within(r).getByRole('rowheader').textContent, ...within(r).getAllByRole('cell').map(c => c.textContent),
    ])
    expect(rows).toEqual([
      ['Claude Haiku 4.5', 'Chat', 'Anthropic', '250', '300,000', '90,000', '$1.10'],
      ['GPT-5 Mini', 'Chat', 'OpenAI', '40', '12,000', '8,000', '$0.0400'],
      ['Text Embedding 3 Small', 'Embeddings', 'OpenAI', '52', '20,000', '-', '$0.0004'],
    ])
  })

  it('say so for a company that has run nothing', async () => {
    renderPage()
    await findCompanies()
    expect(screen.queryByRole('table', { name: 'Used by Midway Labs' })).toBeNull()
    expect(document.getElementById('pai-detail-cmp_midway')).toHaveTextContent('No AI calls in this period.')
  })

  it('close and open again from the arrow beside the company', async () => {
    const user = userEvent.setup({ delay: null })
    renderPage()
    await findCompanies()

    await user.click(toggleOf('Acme Corp'))
    expect(toggleOf('Acme Corp')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('table', { name: 'Jobs of Acme Corp' })).toBeNull()
    expect(screen.getByRole('table', { name: 'Jobs of Zed Staffing' })).toBeInTheDocument()

    await user.click(toggleOf('Acme Corp'))
    expect(toggleOf('Acme Corp')).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById('pai-detail-cmp_acme')).not.toBeNull()
    expect(toggleOf('Acme Corp')).toHaveAttribute('aria-controls', 'pai-detail-cmp_acme')
  })

  it('all close and all open from one button', async () => {
    const user = userEvent.setup({ delay: null })
    renderPage()
    await findCompanies()

    await user.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(screen.queryByRole('table', { name: /^Jobs of/ })).toBeNull()
    for (const name of ['Acme Corp', 'Zed Staffing', 'Midway Labs']) expect(toggleOf(name)).toHaveAttribute('aria-expanded', 'false')

    await user.click(screen.getByRole('button', { name: 'Expand all' }))
    expect(screen.getAllByRole('table', { name: /^Jobs of/ })).toHaveLength(3)
  })

  it('start closed when there are many companies, and open one at a time', async () => {
    const many = Array.from({ length: OPEN_BY_DEFAULT + 1 }, (_, i) => aiCompanyRow({
      company_id: `cmp_${i}`, name: `Company ${i}`, slug: `c${i}`, cost_usd: 10 - i,
    }))
    ai.mockResolvedValue({ data: { ...AI_OVERVIEW, companies: many } })
    const user = userEvent.setup({ delay: null })
    renderPage()
    await findCompanies()

    expect(screen.queryByRole('table', { name: /^Jobs of/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Expand all' })).toBeInTheDocument()

    await user.click(toggleOf('Company 2'))
    expect(screen.getAllByRole('table', { name: /^Jobs of/ })).toHaveLength(1)
    expect(screen.getByRole('table', { name: 'Jobs of Company 2' })).toBeInTheDocument()
  })

  it('keep what was chosen when the period changes', async () => {
    const user = userEvent.setup({ delay: null })
    renderPage()
    await findCompanies()
    await user.click(toggleOf('Acme Corp'))

    await user.click(screen.getByRole('radio', { name: '7 days' }))
    await waitFor(() => expect(ai).toHaveBeenLastCalledWith(7))
    await findCompanies()
    expect(toggleOf('Acme Corp')).toHaveAttribute('aria-expanded', 'false')
    expect(toggleOf('Zed Staffing')).toHaveAttribute('aria-expanded', 'true')
  })
})
