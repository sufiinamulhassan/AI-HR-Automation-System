import { useState } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const savedList = vi.fn()

vi.mock('../../../lib/api', () => ({
  savedFiltersApi: {
    list: (...a: unknown[]) => savedList(...a),
    create: vi.fn(),
    delete: vi.fn(),
  },
}))

const { default: ResumeFilters } = await import('./ResumeFilters')
const { EMPTY_FILTERS, EMPTY_OPTIONS, normalizeOptions } = await import('./resumeFilterModel')
import type { ResumeFilterOptions, ResumeFilterValues, ViewMode } from './resumeFilterModel'

const OPTIONS = normalizeOptions({
  business_domains: [
    { value: 'it_software', label: 'IT & Software', count: 40 },
    { value: 'marketing', label: 'Marketing', count: 5 },
  ],
  skills: [{ value: 'Java', count: 9 }, { value: 'Kafka', count: 4 }],
  seniorities: [
    { value: 'director', count: 1 }, { value: 'senior', count: 9 }, { value: 'junior', count: 2 },
    { value: 'principal', count: 1 }, { value: 'mid', count: 5 }, { value: 'lead', count: 3 },
  ],
  education_levels: [{ value: 'master', label: "Master's degree", count: 3 }],
  industries: [{ value: 'fintech', label: 'Fintech', count: 5 }],
  roles: [{ value: 'Java Developer', count: 9 }],
})

interface Spies {
  onChange: ReturnType<typeof vi.fn>
  onClearAll: ReturnType<typeof vi.fn>
  onSemanticChange: ReturnType<typeof vi.fn>
  onViewChange: ReturnType<typeof vi.fn>
  onApplySaved: ReturnType<typeof vi.fn>
  onNotice: ReturnType<typeof vi.fn>
}

interface HarnessProps extends Partial<Spies> {
  initial?: Partial<ResumeFilterValues>
  options?: ResumeFilterOptions
  optionsLoading?: boolean
  semantic?: boolean
  view?: ViewMode
}

function Harness({ initial, options = OPTIONS, optionsLoading = false, semantic = false, view = 'all', ...spies }: HarnessProps) {
  const [filters, setFilters] = useState<ResumeFilterValues>({ ...EMPTY_FILTERS, ...initial })
  return (
    <ResumeFilters
      filters={filters}
      options={options}
      optionsLoading={optionsLoading}
      semantic={semantic}
      view={view}
      onChange={patch => { spies.onChange?.(patch); setFilters(prev => ({ ...prev, ...patch })) }}
      onClearAll={() => { spies.onClearAll?.(); setFilters(EMPTY_FILTERS) }}
      onSemanticChange={on => spies.onSemanticChange?.(on)}
      onViewChange={v => spies.onViewChange?.(v)}
      onApplySaved={f => spies.onApplySaved?.(f)}
      onNotice={n => spies.onNotice?.(n)}
    />
  )
}

function setup(props: HarnessProps = {}) {
  const spies = {
    onChange: vi.fn(),
    onClearAll: vi.fn(),
    onSemanticChange: vi.fn(),
    onViewChange: vi.fn(),
    onApplySaved: vi.fn(),
    onNotice: vi.fn(),
  }
  const utils = render(<Harness {...spies} {...props} />)
  return { ...utils, ...spies }
}

function typeFast(element: Element, text: string) {
  return userEvent.setup({ delay: null }).type(element, text)
}

function nameOf(el: Element): string {
  return el.getAttribute('aria-label')
    ?? ((el as HTMLInputElement).placeholder || (el.textContent ?? '').replace(/\s+/g, ' ').trim())
}

function controlNames(root: Element): string[] {
  return Array.from(root.querySelectorAll('input, button')).map(nameOf)
}

async function openMore() {
  await userEvent.click(screen.getByRole('button', { name: /More filters/ }))
}

beforeEach(() => {
  savedList.mockReset().mockResolvedValue({ data: { templates: [] } })
})

describe('ResumeFilters layout and labels', () => {
  it('has the search row in this order: search, Semantic Search, the view switch, Saved Searches, Save this search', async () => {
    setup()
    const row = screen.getByRole('group', { name: 'Search' })
    await waitFor(() => expect(savedList).toHaveBeenCalled())
    expect(controlNames(row)).toEqual([
      'Search résumés',
      'Semantic Search OFF',
      'Domain Folders',
      'All Candidates',
      'Saved Searches',
      'Save this search',
    ])
  })

  it('uses the exact search placeholder', () => {
    setup()
    expect(screen.getByPlaceholderText('Search skills or names, e.g. Java, Spring Boot')).toBe(
      screen.getByRole('searchbox', { name: 'Search résumés' }),
    )
  })

  it('shows Semantic Search with an OFF badge and the view switch as Domain Folders then All Candidates', () => {
    setup()
    const semantic = screen.getByRole('button', { name: /Semantic Search/ })
    expect(semantic).toHaveTextContent(/^Semantic Search\s*OFF$/)
    const view = screen.getByRole('group', { name: 'View' })
    expect(within(view).getAllByRole('button').map(b => b.textContent)).toEqual(['Domain Folders', 'All Candidates'])
  })

  it('has the filter row in this order: FILTERS, DOMAIN, SKILL, SENIORITY, STATUS, Min yrs, Max yrs, More filters', () => {
    setup()
    const panel = screen.getByText('FILTERS').closest('.rf-panel') as HTMLElement
    expect(panel.textContent?.startsWith('FILTERS')).toBe(true)
    const row = screen.getByRole('group', { name: 'Main filters' })
    expect(controlNames(row)).toEqual(['DOMAIN', 'SKILL', 'SENIORITY', 'STATUS', 'Min yrs', 'Max yrs', 'More filters'])
  })

  it('puts a dash between Min yrs and Max yrs', () => {
    setup()
    const range = screen.getByRole('group', { name: 'Years of experience' })
    expect(range.textContent).toBe('-')
    expect(range.querySelectorAll('input[type="number"]')).toHaveLength(2)
  })

  it('shows the labels in upper case exactly as written', () => {
    setup()
    for (const label of ['DOMAIN', 'SKILL', 'SENIORITY', 'STATUS']) {
      expect(screen.getByRole('button', { name: label })).toHaveTextContent(new RegExp(`^${label}$`))
    }
  })

  it('has the More filters panel in this order: ROLE, EDUCATION, INDUSTRY, Min salary, Max salary, Worked At', async () => {
    setup()
    await openMore()
    const panel = screen.getByRole('group', { name: 'More filters' })
    expect(controlNames(panel)).toEqual([
      'ROLE', 'EDUCATION', 'INDUSTRY',
      'Min salary', 'Max salary', 'Worked At, searches career history',
    ])
    expect(within(panel).getByPlaceholderText('Worked At, searches career history')).toBeInTheDocument()
  })

  it('has no CERTIFICATION, JOB FAMILY or AVAILABILITY filter anywhere in the toolbar', async () => {
    const { container } = setup()
    await openMore()
    for (const label of ['CERTIFICATION', 'JOB FAMILY', 'AVAILABILITY']) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument()
    }
    const text = container.textContent?.toLowerCase() ?? ''
    for (const word of ['certification', 'job family', 'availability']) expect(text).not.toContain(word)
  })

  it('keeps the whole toolbar in one reading and tab order from the search box down to Worked At', async () => {
    const { container } = setup()
    await openMore()
    const root = container.querySelector('.rf') as HTMLElement
    expect(controlNames(root)).toEqual([
      'Search résumés', 'Semantic Search OFF', 'Domain Folders', 'All Candidates', 'Saved Searches', 'Save this search',
      'DOMAIN', 'SKILL', 'SENIORITY', 'STATUS', 'Min yrs', 'Max yrs', 'More filters',
      'ROLE', 'EDUCATION', 'INDUSTRY',
      'Min salary', 'Max salary', 'Worked At, searches career history',
    ])
    expect(root.querySelectorAll('[tabindex]:not([tabindex="-1"])')).toHaveLength(0)
  })

  it('lists SENIORITY as All levels, Junior, Mid, Senior, Lead, Principal, Director whatever order the server sends', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'SENIORITY' }))
    const list = screen.getByRole('listbox', { name: 'SENIORITY' })
    const labels = within(list).getAllByRole('option').map(o => o.querySelector('.fd-opt-label')?.textContent)
    expect(labels).toEqual(['All levels', 'Junior', 'Mid', 'Senior', 'Lead', 'Principal', 'Director'])
  })

  it('lists STATUS as All statuses, Processed, Processing, Failed', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'STATUS' }))
    const labels = within(screen.getByRole('listbox', { name: 'STATUS' })).getAllByRole('option').map(o => o.textContent)
    expect(labels).toEqual(['All statuses', 'Processed', 'Processing', 'Failed'])
  })

  it('marks the toolbar as the compact size', () => {
    const { container } = setup()
    expect(container.querySelector('.rf')).toHaveAttribute('data-density', 'compact')
  })

  it('uses small icons: 14px on the buttons and 12px for the chevrons', () => {
    const { container } = setup()
    const width = (el: Element | null) => el?.querySelector('svg')?.getAttribute('width')
    expect(width(screen.getByRole('button', { name: /Semantic Search/ }))).toBe('14')
    expect(width(screen.getByRole('button', { name: 'Domain Folders' }))).toBe('14')
    expect(width(screen.getByRole('button', { name: 'All Candidates' }))).toBe('14')
    expect(width(screen.getByRole('button', { name: 'Save this search' }))).toBe('14')
    expect(width(container.querySelector('.rf-panel-head'))).toBe('14')
    expect(width(container.querySelector('.rf-search-icon'))).toBe('14')
    expect(width(screen.getByRole('button', { name: 'DOMAIN' }))).toBe('12')
    expect(container.querySelector('.rf-more .rf-more-chevron svg')).toHaveAttribute('width', '12')
    expect(container.querySelector('.ss-chevron svg')).toHaveAttribute('width', '12')
  })

  it('flips the More filters chevron when the panel opens', async () => {
    const { container } = setup()
    const chevron = container.querySelector('.rf-more-chevron') as HTMLElement
    expect(chevron).not.toHaveClass('rf-more-chevron-open')
    await openMore()
    expect(chevron).toHaveClass('rf-more-chevron-open')
  })

  it('renders no em dash anywhere', async () => {
    const { container } = setup({ initial: { skills: ['Java'], businessDomain: 'it_software', experienceMin: '2', workedAt: 'Acme' } })
    await openMore()
    expect(container.textContent).not.toContain(String.fromCharCode(0x2014))
  })
})

describe('ResumeFilters controls', () => {
  it('sends the chosen domain', async () => {
    const { onChange } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'DOMAIN' }))
    await userEvent.click(screen.getByRole('option', { name: /IT & Software/ }))
    expect(onChange).toHaveBeenCalledWith({ businessDomain: 'it_software' })
    expect(screen.getByRole('button', { name: /^DOMAIN/ })).toHaveTextContent('IT & Software')
  })

  it('sends several skills one change at a time and shows the count', async () => {
    const { onChange } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'SKILL' }))
    await userEvent.click(screen.getByRole('option', { name: /Java/ }))
    await userEvent.click(screen.getByRole('option', { name: /Kafka/ }))
    expect(onChange).toHaveBeenNthCalledWith(1, { skills: ['Java'] })
    expect(onChange).toHaveBeenNthCalledWith(2, { skills: ['Java', 'Kafka'] })
    expect(screen.getByRole('button', { name: /SKILL \(2\)/ })).toBeInTheDocument()
  })

  it('sends the chosen seniority', async () => {
    const { onChange } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'SENIORITY' }))
    await userEvent.click(screen.getByRole('option', { name: /^Lead/ }))
    expect(onChange).toHaveBeenCalledWith({ seniority: 'lead' })
  })

  it('sends the chosen status and clears it with All statuses', async () => {
    const { onChange } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'STATUS' }))
    await userEvent.click(screen.getByRole('option', { name: 'Failed' }))
    expect(onChange).toHaveBeenLastCalledWith({ status: 'failed' })
    await userEvent.click(screen.getByRole('button', { name: /^STATUS/ }))
    await userEvent.click(screen.getByRole('option', { name: 'All statuses' }))
    expect(onChange).toHaveBeenLastCalledWith({ status: '' })
  })

  it.each([
    ['ROLE', /Java Developer/, { role: 'Java Developer' }],
    ['EDUCATION', /Master's degree/, { educationLevel: 'master' }],
    ['INDUSTRY', /Fintech/, { industry: 'fintech' }],
  ])('sends the %s choice from the More filters panel', async (label, option, patch) => {
    const { onChange } = setup()
    await openMore()
    await userEvent.click(screen.getByRole('button', { name: label }))
    await userEvent.click(screen.getByRole('option', { name: option }))
    expect(onChange).toHaveBeenCalledWith(patch)
  })

  it('waits for a pause in typing before sending the search, and sends one change', async () => {
    const { onChange } = setup()
    await typeFast(screen.getByRole('searchbox', { name: 'Search résumés' }), 'java')
    expect(onChange).not.toHaveBeenCalled()
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ search: 'java' }))
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('sends the search at once when Enter is pressed, trimmed', async () => {
    const { onChange } = setup()
    await typeFast(screen.getByRole('searchbox', { name: 'Search résumés' }), '  spring boot {Enter}')
    expect(onChange).toHaveBeenCalledWith({ search: 'spring boot' })
    await new Promise(r => setTimeout(r, 400))
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('has a clear button only when there is text, and clearing sends at once', async () => {
    const { onChange } = setup()
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument()
    await typeFast(screen.getByRole('searchbox', { name: 'Search résumés' }), 'go{Enter}')
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(onChange).toHaveBeenLastCalledWith({ search: '' })
    expect(screen.getByRole('searchbox', { name: 'Search résumés' })).toHaveValue('')
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument()
  })

  it('shows the search that was applied from outside, such as a saved search', () => {
    setup({ initial: { search: 'kubernetes' } })
    expect(screen.getByRole('searchbox', { name: 'Search résumés' })).toHaveValue('kubernetes')
  })

  it('sends the experience range after a pause, as text the page turns into numbers', async () => {
    const { onChange } = setup()
    await typeFast(screen.getByRole('spinbutton', { name: 'Min yrs' }), '3')
    await typeFast(screen.getByRole('spinbutton', { name: 'Max yrs' }), '8')
    expect(onChange).not.toHaveBeenCalled()
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ experienceMin: '3' }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ experienceMax: '8' }))
  })

  it('has number inputs that start at zero', () => {
    setup()
    for (const name of ['Min yrs', 'Max yrs']) {
      const input = screen.getByRole('spinbutton', { name })
      expect(input).toHaveAttribute('min', '0')
      expect(input).toHaveAttribute('type', 'number')
    }
  })

  it('shows both inputs as invalid, with a reason, when the maximum is below the minimum', async () => {
    setup()
    await typeFast(screen.getByRole('spinbutton', { name: 'Min yrs' }), '9')
    await typeFast(screen.getByRole('spinbutton', { name: 'Max yrs' }), '2')

    expect(screen.getByRole('spinbutton', { name: 'Min yrs' })).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('spinbutton', { name: 'Max yrs' })).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('The maximum must not be below the minimum.')
    expect(screen.getByRole('spinbutton', { name: 'Max yrs' })).toHaveAccessibleDescription('The maximum must not be below the minimum.')

    await userEvent.clear(screen.getByRole('spinbutton', { name: 'Max yrs' }))
    await typeFast(screen.getByRole('spinbutton', { name: 'Max yrs' }), '12')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Min yrs' })).toHaveAttribute('aria-invalid', 'false')
  })

  it('asks for a number of zero or more when the input is negative', async () => {
    setup()
    await typeFast(screen.getByRole('spinbutton', { name: 'Min yrs' }), '-4')
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a number of 0 or more.')
  })

  it('sends the salary range and the career history text after a pause', async () => {
    const { onChange } = setup()
    await openMore()
    await typeFast(screen.getByRole('spinbutton', { name: 'Min salary' }), '50000')
    await typeFast(screen.getByRole('spinbutton', { name: 'Max salary' }), '90000')
    await typeFast(screen.getByRole('textbox', { name: 'Worked At, searches career history' }), 'Acme')
    expect(onChange).not.toHaveBeenCalled()
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ salaryMin: '50000' }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ salaryMax: '90000' }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ workedAt: 'Acme' }))
  })

  it('sends the career history text at once on Enter', async () => {
    const { onChange } = setup()
    await openMore()
    await typeFast(screen.getByRole('textbox', { name: 'Worked At, searches career history' }), 'Globex{Enter}')
    expect(onChange).toHaveBeenCalledWith({ workedAt: 'Globex' })
  })
})

describe('More filters', () => {
  it('collapses and expands, controlling the panel it names', async () => {
    setup()
    const button = screen.getByRole('button', { name: /More filters/ })
    const panel = document.getElementById(button.getAttribute('aria-controls') ?? '') as HTMLElement
    expect(panel).toHaveAttribute('role', 'group')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveAttribute('aria-controls', panel.id)
    expect(panel).toHaveAttribute('hidden')
    expect(screen.queryByRole('button', { name: 'ROLE' })).not.toBeInTheDocument()

    await userEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(button).toHaveClass('rf-more-on')
    expect(panel).not.toHaveAttribute('hidden')
    expect(screen.getByRole('button', { name: 'ROLE' })).toBeInTheDocument()

    await userEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).not.toHaveClass('rf-more-on')
    expect(panel).toHaveAttribute('hidden')
  })

  it('shows no badge with nothing applied, and a count of the extra filters that are', () => {
    const { unmount } = setup()
    expect(screen.getByRole('button', { name: 'More filters' })).toBeInTheDocument()
    expect(document.querySelector('.rf-badge')).toBeNull()
    unmount()

    setup({ initial: { role: 'Java Developer', industry: 'fintech', salaryMin: '10', seniority: 'mid' } })
    const button = screen.getByRole('button', { name: /More filters/ })
    expect(button.querySelector('.rf-badge')).toHaveTextContent('3')
    expect(button).toHaveAccessibleName('More filters 3 active')
  })

  it('keeps what was typed in the panel while it is collapsed', async () => {
    setup()
    await openMore()
    await typeFast(screen.getByRole('textbox', { name: 'Worked At, searches career history' }), 'Acme')
    await userEvent.click(screen.getByRole('button', { name: /More filters/ }))
    await userEvent.click(screen.getByRole('button', { name: /More filters/ }))
    expect(screen.getByRole('textbox', { name: 'Worked At, searches career history' })).toHaveValue('Acme')
  })
})

describe('active filter chips', () => {
  it('shows none and no Clear all when nothing is applied', () => {
    setup()
    expect(screen.queryByRole('list', { name: 'Active filters' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear all' })).not.toBeInTheDocument()
  })

  it('shows one chip per applied filter, each with a remove button', () => {
    setup({ initial: { skills: ['Java', 'Kafka'], seniority: 'senior', experienceMin: '2', experienceMax: '6' } })
    const list = screen.getByRole('list', { name: 'Active filters' })
    expect(within(list).getAllByRole('listitem').map(li => li.querySelector('.rf-chip-text')?.textContent)).toEqual([
      'Skill: Java', 'Skill: Kafka', 'Seniority: Senior', 'Experience: 2 to 6 yrs',
    ])
    expect(within(list).getByRole('button', { name: 'Remove Skill: Java' })).toBeInTheDocument()
  })

  it('removes a single skill, a seniority or a whole range from its chip', async () => {
    const { onChange } = setup({ initial: { skills: ['Java', 'Kafka'], seniority: 'senior', experienceMin: '2', experienceMax: '6' } })
    await userEvent.click(screen.getByRole('button', { name: 'Remove Skill: Java' }))
    expect(onChange).toHaveBeenLastCalledWith({ skills: ['Kafka'] })
    await userEvent.click(screen.getByRole('button', { name: 'Remove Seniority: Senior' }))
    expect(onChange).toHaveBeenLastCalledWith({ seniority: '' })
    await userEvent.click(screen.getByRole('button', { name: 'Remove Experience: 2 to 6 yrs' }))
    expect(onChange).toHaveBeenLastCalledWith({ experienceMin: '', experienceMax: '' })
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Active filters' })).toBeInTheDocument())
    expect(screen.getByRole('spinbutton', { name: 'Min yrs' })).toHaveValue(null)
  })

  it('clears everything with Clear all and the chips go away', async () => {
    const { onClearAll } = setup({ initial: { skills: ['Java'], status: 'failed', workedAt: 'Acme' } })
    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(onClearAll).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('list', { name: 'Active filters' })).not.toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Search résumés' })).toHaveValue('')
  })

  it('uses the option labels in the chips', () => {
    setup({ initial: { businessDomain: 'it_software', educationLevel: 'master' } })
    expect(screen.getByText('Domain: IT & Software')).toBeInTheDocument()
    expect(screen.getByText("Education: Master's degree")).toBeInTheDocument()
  })
})

describe('Semantic Search and the view switch', () => {
  it('shows OFF, is not pressed, and asks to switch on when clicked', async () => {
    const { onSemanticChange } = setup()
    const button = screen.getByRole('button', { name: /Semantic Search/ })
    expect(button).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(button)
    expect(onSemanticChange).toHaveBeenCalledWith(true)
  })

  it('shows ON, is pressed, and asks to switch off when clicked', async () => {
    const { onSemanticChange } = setup({ semantic: true, initial: { search: 'java developer' } })
    const button = screen.getByRole('button', { name: /Semantic Search/ })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(button).toHaveTextContent(/ON$/)
    expect(button).toHaveClass('rf-pill-on')
    await userEvent.click(button)
    expect(onSemanticChange).toHaveBeenCalledWith(false)
  })

  it('explains when semantic search is on but there are too few characters', () => {
    const { unmount } = setup({ semantic: true })
    expect(screen.getByRole('status')).toHaveTextContent('Type at least 2 characters')
    unmount()
    setup({ semantic: true, initial: { search: 'go' } })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('does not talk about semantic search when it is off', () => {
    setup()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows which view is current and asks for the other one', async () => {
    const { onViewChange } = setup({ view: 'all' })
    const folders = screen.getByRole('button', { name: 'Domain Folders' })
    const all = screen.getByRole('button', { name: 'All Candidates' })
    expect(folders).toHaveAttribute('aria-pressed', 'false')
    expect(all).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(folders)
    expect(onViewChange).toHaveBeenCalledWith('folders')
    await userEvent.click(all)
    expect(onViewChange).toHaveBeenLastCalledWith('all')
  })

  it('presses Domain Folders when the folders are showing', () => {
    setup({ view: 'folders' })
    expect(screen.getByRole('button', { name: 'Domain Folders' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'All Candidates' })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('options loading', () => {
  it('shows the option controls disabled while the lists load, but not Status', async () => {
    setup({ optionsLoading: true })
    await openMore()
    for (const label of ['DOMAIN', 'SKILL', 'SENIORITY', 'ROLE', 'EDUCATION', 'INDUSTRY']) {
      expect(screen.getByRole('button', { name: label })).toBeDisabled()
    }
    expect(screen.getByRole('button', { name: 'STATUS' })).toBeEnabled()
  })

  it('shows empty lists as disabled with the title No values yet', async () => {
    setup({ options: EMPTY_OPTIONS })
    await openMore()
    for (const label of ['DOMAIN', 'SKILL', 'SENIORITY', 'ROLE', 'EDUCATION', 'INDUSTRY']) {
      const button = screen.getByRole('button', { name: label })
      expect(button).toBeDisabled()
      expect(button).toHaveAttribute('title', 'No values yet')
    }
    expect(screen.getByRole('searchbox', { name: 'Search résumés' })).toBeEnabled()
    expect(screen.getByRole('spinbutton', { name: 'Min yrs' })).toBeEnabled()
  })
})
