import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const list = vi.fn()
const create = vi.fn()
const remove = vi.fn()

vi.mock('../../../lib/api', () => ({
  savedFiltersApi: {
    list: (...a: unknown[]) => list(...a),
    create: (...a: unknown[]) => create(...a),
    delete: (...a: unknown[]) => remove(...a),
  },
}))

const { default: SavedSearches } = await import('./SavedSearches')
const { EMPTY_FILTERS, toParams } = await import('./resumeFilterModel')
import type { ResumeFilterValues } from './resumeFilterModel'

const TEMPLATES = [
  {
    template_id: 't1',
    name: 'Senior Java in fintech',
    filter_params: { skill: 'Java,Kafka', seniority: 'senior', industry: 'fintech', experience_min: 5, hacked: 'x' },
  },
  { template_id: 't2', name: 'Failed uploads', filter_params: { status: 'failed' } },
]

function setup(filters: ResumeFilterValues = EMPTY_FILTERS) {
  const onApply = vi.fn()
  const onNotice = vi.fn()
  const utils = render(<SavedSearches filters={filters} onApply={onApply} onNotice={onNotice} />)
  return { ...utils, onApply, onNotice }
}

async function openList() {
  await userEvent.click(screen.getByRole('button', { name: /^Saved Searches/ }))
}

async function openDialog() {
  await userEvent.click(screen.getByRole('button', { name: 'Save this search' }))
  return screen.getByRole('dialog', { name: 'Save this search' })
}

beforeEach(() => {
  list.mockReset().mockResolvedValue({ data: { templates: TEMPLATES } })
  create.mockReset().mockResolvedValue({ data: {} })
  remove.mockReset().mockResolvedValue({ data: {} })
})

afterEach(() => { vi.restoreAllMocks() })

describe('Saved Searches list', () => {
  it('reads the resume scope and shows how many there are', async () => {
    setup()
    expect(await screen.findByRole('button', { name: 'Saved Searches (2)' })).toBeInTheDocument()
    expect(list).toHaveBeenCalledWith('resumes')
  })

  it('says Saved Searches with no count when there are none, and tells you so when opened', async () => {
    list.mockResolvedValue({ data: { templates: [] } })
    setup()
    await waitFor(() => expect(list).toHaveBeenCalled())
    await openList()
    expect(screen.getByRole('button', { name: 'Saved Searches' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('No saved searches yet')).toBeInTheDocument()
  })

  it('lists the names, each with a delete button that names it', async () => {
    setup()
    await screen.findByRole('button', { name: 'Saved Searches (2)' })
    await openList()
    const items = within(screen.getByRole('list', { name: 'Saved searches' })).getAllByRole('listitem')
    expect(items.map(li => li.querySelector('.ss-apply')?.textContent)).toEqual(['Senior Java in fintech', 'Failed uploads'])
    expect(screen.getByRole('button', { name: 'Delete saved search Failed uploads' })).toBeInTheDocument()
  })

  it('ignores entries that are not usable', async () => {
    list.mockResolvedValue({ data: { templates: [{ name: 'No id' }, { template_id: 'x', name: '  ' }, null, TEMPLATES[1]] } })
    setup()
    expect(await screen.findByRole('button', { name: 'Saved Searches (1)' })).toBeInTheDocument()
  })

  it('applies every filter of a saved search, ignoring unknown keys, and closes the list', async () => {
    const { onApply } = setup()
    await screen.findByRole('button', { name: 'Saved Searches (2)' })
    await openList()
    await userEvent.click(screen.getByRole('button', { name: 'Senior Java in fintech' }))

    expect(onApply).toHaveBeenCalledWith({
      ...EMPTY_FILTERS,
      skills: ['Java', 'Kafka'],
      seniority: 'senior',
      industry: 'fintech',
      experienceMin: '5',
    })
    expect(screen.queryByRole('list', { name: 'Saved searches' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Saved Searches (2)' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('checks the values it applies: an unknown status is dropped', async () => {
    list.mockResolvedValue({ data: { templates: [{ template_id: 't9', name: 'Odd', filter_params: { status: 'archived', seniority: 7 } }] } })
    const { onApply } = setup()
    await screen.findByRole('button', { name: 'Saved Searches (1)' })
    await openList()
    await userEvent.click(screen.getByRole('button', { name: 'Odd' }))
    expect(onApply).toHaveBeenCalledWith(EMPTY_FILTERS)
  })

  it('closes on Escape with focus back on the button, and on a click outside', async () => {
    render(<div><SavedSearches filters={EMPTY_FILTERS} onApply={vi.fn()} onNotice={vi.fn()} /><button type="button">elsewhere</button></div>)
    await screen.findByRole('button', { name: 'Saved Searches (2)' })
    await openList()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('list', { name: 'Saved searches' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Saved Searches (2)' })).toHaveFocus()

    await openList()
    await userEvent.click(screen.getByRole('button', { name: 'elsewhere' }))
    expect(screen.queryByRole('list', { name: 'Saved searches' })).not.toBeInTheDocument()
  })

  it('offers a retry when the list cannot be loaded', async () => {
    list.mockRejectedValueOnce(new Error('down'))
    setup()
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1))
    await openList()
    expect(await screen.findByText("Couldn't load saved searches.")).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('list', { name: 'Saved searches' })).toBeInTheDocument()
  })

  it('flips to the right edge when the list would run off the screen', async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(320)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 500, right: 640, top: 0, bottom: 30, width: 140, height: 30, x: 500, y: 0, toJSON: () => ({}),
    })
    Object.defineProperty(window, 'innerWidth', { value: 700, configurable: true })
    setup()
    await screen.findByRole('button', { name: 'Saved Searches (2)' })
    await openList()
    expect(document.querySelector('.ss-panel')).toHaveClass('ss-panel-end')
  })
})

describe('deleting a saved search', () => {
  async function askToDelete(name: string) {
    await screen.findByRole('button', { name: 'Saved Searches (2)' })
    await openList()
    await userEvent.click(screen.getByRole('button', { name: `Delete saved search ${name}` }))
  }

  it('asks first, and Keep puts the row back without deleting', async () => {
    setup()
    await askToDelete('Failed uploads')
    const confirm = screen.getByRole('group', { name: 'Delete Failed uploads?' })
    expect(within(confirm).getByText('Delete "Failed uploads"?')).toBeInTheDocument()
    expect(remove).not.toHaveBeenCalled()

    await userEvent.click(within(confirm).getByRole('button', { name: 'Keep' }))
    expect(screen.getByRole('button', { name: 'Failed uploads' })).toBeInTheDocument()
    expect(remove).not.toHaveBeenCalled()
  })

  it('deletes after confirmation, drops it from the list and the count, and says so', async () => {
    const { onNotice } = setup()
    await askToDelete('Failed uploads')
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(remove).toHaveBeenCalledWith('t2'))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Failed uploads' })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Saved Searches (1)' })).toBeInTheDocument()
    expect(onNotice).toHaveBeenCalledWith({ kind: 'ok', text: 'Deleted saved search "Failed uploads".' })
  })

  it('surfaces the server message when the delete fails and keeps the row', async () => {
    remove.mockRejectedValue({ response: { data: { detail: 'Not your saved filter' } } })
    const { onNotice } = setup()
    await askToDelete('Failed uploads')
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(onNotice).toHaveBeenCalledWith({ kind: 'error', text: 'Not your saved filter' }))
    expect(screen.getByRole('button', { name: 'Failed uploads' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Saved Searches (2)' })).toBeInTheDocument()
  })

  it('falls back to a plain message when the server gives none', async () => {
    remove.mockRejectedValue(new Error('network'))
    const { onNotice } = setup()
    await askToDelete('Failed uploads')
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith({ kind: 'error', text: 'Could not delete this saved search.' }))
  })
})

describe('Save this search dialog', () => {
  it('opens a labelled modal dialog with focus on the name box', async () => {
    setup()
    const dialog = await openDialog()
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveFocus()
    expect(within(dialog).getByText(/Saves the filters currently applied/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('limits the name to 80 characters and counts them', async () => {
    setup()
    const dialog = await openDialog()
    const input = within(dialog).getByRole('textbox', { name: 'Name' })
    expect(input).toHaveAttribute('maxlength', '80')
    await userEvent.type(input, 'Java')
    expect(within(dialog).getByText('4/80')).toBeInTheDocument()
  })

  it('warns that an empty search would be saved when nothing is applied', async () => {
    setup()
    const dialog = await openDialog()
    expect(within(dialog).getByText('No filters are applied right now, so this will save an empty search.')).toBeInTheDocument()
  })

  it('does not warn when filters are applied', async () => {
    setup({ ...EMPTY_FILTERS, skills: ['Java'] })
    const dialog = await openDialog()
    expect(within(dialog).queryByText(/No filters are applied/)).not.toBeInTheDocument()
  })

  it('closes on Escape, on Cancel and on the backdrop, returning focus to the button', async () => {
    setup()
    await openDialog()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save this search' })).toHaveFocus()

    const second = await openDialog()
    await userEvent.click(within(second).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    const third = await openDialog()
    await userEvent.click(third.parentElement as HTMLElement)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(create).not.toHaveBeenCalled()
  })

  it('stays open when the click is inside it', async () => {
    setup()
    const dialog = await openDialog()
    await userEvent.click(within(dialog).getByText('Saves the filters currently applied, so you can reapply them later from Saved Searches.'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('needs a name: an empty one shows a message and saves nothing', async () => {
    setup()
    const dialog = await openDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter a name for this search.')
    expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveAttribute('aria-invalid', 'true')
    expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveFocus()
    expect(create).not.toHaveBeenCalled()

    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), '   ')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(create).not.toHaveBeenCalled()
  })

  it('clears the message once you start typing', async () => {
    setup()
    const dialog = await openDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'a')
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('refuses a name over 80 characters', async () => {
    setup()
    const dialog = await openDialog()
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), { target: { value: 'x'.repeat(81) } })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Use 80 characters or fewer.')
    expect(create).not.toHaveBeenCalled()
  })

  it('saves the applied filters under the trimmed name, refreshes the list and says so', async () => {
    const filters: ResumeFilterValues = { ...EMPTY_FILTERS, skills: ['Java', 'Kafka'], seniority: 'senior', status: 'processed', workedAt: ' Acme ' }
    const { onNotice } = setup(filters)
    await screen.findByRole('button', { name: 'Saved Searches (2)' })
    const dialog = await openDialog()
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), '  Java people  ')
    list.mockResolvedValue({ data: { templates: [...TEMPLATES, { template_id: 't3', name: 'Java people', filter_params: {} }] } })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(create).toHaveBeenCalledWith({
      name: 'Java people',
      filter_params: toParams(filters),
      scope: 'resumes',
    }))
    expect(create.mock.calls[0][0].filter_params).toEqual({
      skill: 'Java,Kafka', seniority: 'senior', status: 'processed', worked_at_company: 'Acme',
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(onNotice).toHaveBeenCalledWith({ kind: 'ok', text: 'Saved search "Java people".' })
    expect(await screen.findByRole('button', { name: 'Saved Searches (3)' })).toBeInTheDocument()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('submits from the keyboard with Enter', async () => {
    setup()
    const dialog = await openDialog()
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Quick save{Enter}')
    await waitFor(() => expect(create).toHaveBeenCalledWith({ name: 'Quick save', filter_params: {}, scope: 'resumes' }))
  })

  it('allows saving an empty search when it has a name', async () => {
    setup()
    const dialog = await openDialog()
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Everything')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
  })

  it('shows the server message inside the dialog when saving fails, and keeps it open', async () => {
    create.mockRejectedValue({ response: { data: { detail: 'Database unavailable' } } })
    const { onNotice } = setup()
    const dialog = await openDialog()
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Java people')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Database unavailable')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveValue('Java people')
    expect(onNotice).not.toHaveBeenCalled()
  })

  it('falls back to a plain message when the server gives none', async () => {
    create.mockRejectedValue(new Error('network'))
    setup()
    const dialog = await openDialog()
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Java people')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Could not save this search. Please try again.')
  })

  it('shows Saving while it works, and will not close on Escape meanwhile', async () => {
    let finish: (v: unknown) => void = () => {}
    create.mockReturnValue(new Promise(resolve => { finish = resolve }))
    setup()
    const dialog = await openDialog()
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Slow one')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(within(dialog).getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    finish({ data: {} })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('keeps Tab inside the dialog', async () => {
    setup()
    const dialog = await openDialog()
    const input = within(dialog).getByRole('textbox', { name: 'Name' })
    const save = within(dialog).getByRole('button', { name: 'Save' })
    await userEvent.tab({ shift: true })
    expect(save).toHaveFocus()
    await userEvent.tab()
    expect(input).toHaveFocus()
  })

  it('renders no em dash', async () => {
    const { container } = setup()
    await screen.findByRole('button', { name: 'Saved Searches (2)' })
    await openList()
    await userEvent.click(screen.getByRole('button', { name: 'Save this search' }))
    expect(container.textContent).not.toContain(String.fromCharCode(0x2014))
    expect(screen.getByRole('dialog').textContent).not.toContain(String.fromCharCode(0x2014))
  })
})
