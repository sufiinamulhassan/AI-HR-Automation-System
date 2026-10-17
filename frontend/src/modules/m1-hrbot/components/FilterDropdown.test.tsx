import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MultiSelectDropdown, SelectDropdown } from './FilterDropdown'
import type { FilterOption } from './resumeFilterModel'

const SENIORITY: FilterOption[] = [
  { value: 'junior', label: 'Junior', count: 4 },
  { value: 'mid', label: 'Mid', count: 7 },
  { value: 'senior', label: 'Senior', count: 9 },
]

const SKILLS: FilterOption[] = [
  { value: 'Java', label: 'Java', count: 9 },
  { value: 'Kafka', label: 'Kafka', count: 4 },
  { value: 'Spring Boot', label: 'Spring Boot', count: 3 },
]

function Single({ options = SENIORITY, loading = false, initial = '', onChange = () => {} }: {
  options?: FilterOption[]
  loading?: boolean
  initial?: string
  onChange?: (v: string) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <SelectDropdown
      label="SENIORITY"
      allLabel="All levels"
      value={value}
      options={options}
      loading={loading}
      onChange={v => { setValue(v); onChange(v) }}
    />
  )
}

function Multi({ options = SKILLS, initial = [], onChange = () => {} }: {
  options?: FilterOption[]
  initial?: string[]
  onChange?: (v: string[]) => void
}) {
  const [values, setValues] = useState(initial)
  return (
    <MultiSelectDropdown
      label="SKILL"
      values={values}
      options={options}
      hint="Résumés must match every selected skill."
      onChange={v => { setValues(v); onChange(v) }}
    />
  )
}

afterEach(() => { vi.restoreAllMocks() })

describe('SelectDropdown', () => {
  it('shows its label as the button text and starts closed', () => {
    render(<Single />)
    const button = screen.getByRole('button', { name: 'SENIORITY' })
    expect(button).toHaveAttribute('aria-haspopup', 'listbox')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).not.toHaveAttribute('aria-controls')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('opens a labelled listbox with the all option first and the options in the order given', async () => {
    render(<Single />)
    const button = screen.getByRole('button', { name: 'SENIORITY' })
    await userEvent.click(button)

    expect(button).toHaveAttribute('aria-expanded', 'true')
    const list = screen.getByRole('listbox', { name: 'SENIORITY' })
    expect(button).toHaveAttribute('aria-controls', list.id)
    const names = within(list).getAllByRole('option').map(o => o.textContent)
    expect(names).toEqual(['All levels', 'Junior4', 'Mid7', 'Senior9'])
    expect(within(list).getByRole('option', { name: 'All levels' })).toHaveAttribute('aria-selected', 'true')
  })

  it('applies the chosen option, closes, shows the value and looks selected', async () => {
    const onChange = vi.fn()
    render(<Single onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'SENIORITY' }))
    await userEvent.click(screen.getByRole('option', { name: /Senior/ }))

    expect(onChange).toHaveBeenCalledWith('senior')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    const button = screen.getByRole('button', { name: /^SENIORITY/ })
    expect(button).toHaveTextContent('Senior')
    expect(button).toHaveClass('fd-btn-active')
    expect(button).toHaveFocus()
  })

  it('clears with the all option', async () => {
    const onChange = vi.fn()
    render(<Single initial="mid" onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: /^SENIORITY/ }))
    expect(screen.getByRole('option', { name: /^Mid/ })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(screen.getByRole('option', { name: 'All levels' }))

    expect(onChange).toHaveBeenCalledWith('')
    expect(screen.getByRole('button', { name: 'SENIORITY' })).not.toHaveClass('fd-btn-active')
  })

  it('closes on Escape and gives focus back to the button', async () => {
    render(<Single />)
    await userEvent.click(screen.getByRole('button', { name: 'SENIORITY' }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'SENIORITY' })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'SENIORITY' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes on a click outside', async () => {
    render(<div><Single /><button type="button">elsewhere</button></div>)
    await userEvent.click(screen.getByRole('button', { name: 'SENIORITY' }))
    await userEvent.click(screen.getByRole('button', { name: 'elsewhere' }))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('toggles closed when the button is clicked again', async () => {
    render(<Single />)
    const button = screen.getByRole('button', { name: 'SENIORITY' })
    await userEvent.click(button)
    await userEvent.click(button)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('opens with the arrow keys and moves through the options with the keyboard', async () => {
    const onChange = vi.fn()
    render(<Single onChange={onChange} />)
    screen.getByRole('button', { name: 'SENIORITY' }).focus()
    await userEvent.keyboard('{ArrowDown}')

    expect(screen.getByRole('option', { name: 'All levels' })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('option', { name: /Junior/ })).toHaveFocus()
    await userEvent.keyboard('{End}')
    expect(screen.getByRole('option', { name: /Senior/ })).toHaveFocus()
    await userEvent.keyboard('{Home}')
    expect(screen.getByRole('option', { name: 'All levels' })).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}')
    expect(screen.getByRole('option', { name: /Senior/ })).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}{ArrowUp}')
    expect(screen.getByRole('option', { name: /Junior/ })).toHaveFocus()
    await userEvent.keyboard('{Enter}')

    expect(onChange).toHaveBeenCalledWith('junior')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('puts focus on the selected option when it opens', async () => {
    render(<Single initial="mid" />)
    await userEvent.click(screen.getByRole('button', { name: /^SENIORITY/ }))
    expect(screen.getByRole('option', { name: /^Mid/ })).toHaveFocus()
  })

  it('is disabled while the options load', () => {
    render(<Single loading />)
    const button = screen.getByRole('button', { name: 'SENIORITY' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', 'Loading options')
  })

  it('is disabled with the title No values yet when there is nothing to choose', () => {
    render(<Single options={[]} />)
    const button = screen.getByRole('button', { name: 'SENIORITY' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', 'No values yet')
  })

  it('stays usable when a value is set even though the list is empty, so it can be cleared', async () => {
    render(<Single options={[]} initial="senior" />)
    const button = screen.getByRole('button', { name: /^SENIORITY/ })
    expect(button).toBeEnabled()
    expect(button).toHaveTextContent('Senior')
    await userEvent.click(button)
    expect(screen.getByRole('option', { name: 'All levels' })).toBeInTheDocument()
  })

  it('closes the open list when another dropdown is opened', async () => {
    render(<div><Single /><Multi /></div>)
    await userEvent.click(screen.getByRole('button', { name: 'SENIORITY' }))
    await userEvent.click(screen.getByRole('button', { name: 'SKILL' }))
    expect(screen.queryByRole('listbox', { name: 'SENIORITY' })).not.toBeInTheDocument()
    expect(screen.getByRole('listbox', { name: 'SKILL' })).toBeInTheDocument()
  })

  it('flips to the right edge when the list would run off the screen', async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(300)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 400, right: 520, top: 0, bottom: 30, width: 120, height: 30, x: 400, y: 0, toJSON: () => ({}),
    })
    Object.defineProperty(window, 'innerWidth', { value: 600, configurable: true })
    render(<Single />)
    await userEvent.click(screen.getByRole('button', { name: 'SENIORITY' }))
    expect(screen.getByRole('listbox')).toHaveClass('fd-panel-end')
  })

  it('keeps to the left edge when there is room', async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(200)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 50, right: 170, top: 0, bottom: 30, width: 120, height: 30, x: 50, y: 0, toJSON: () => ({}),
    })
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true })
    render(<Single />)
    await userEvent.click(screen.getByRole('button', { name: 'SENIORITY' }))
    expect(screen.getByRole('listbox')).not.toHaveClass('fd-panel-end')
  })
})

describe('MultiSelectDropdown', () => {
  it('counts the chosen values in its label and lists them', () => {
    render(<Multi initial={['Java', 'Kafka']} />)
    const button = screen.getByRole('button', { name: /SKILL \(2\)/ })
    expect(button).toHaveTextContent('Java, Kafka')
    expect(button).toHaveClass('fd-btn-active')
    expect(button).toHaveAttribute('aria-haspopup', 'listbox')
  })

  it('opens a multi-select listbox with a type-to-filter box that has focus', async () => {
    render(<Multi />)
    await userEvent.click(screen.getByRole('button', { name: 'SKILL' }))

    const filter = screen.getByRole('textbox', { name: 'Filter skill list' })
    expect(filter).toHaveFocus()
    expect(screen.getByRole('listbox', { name: 'SKILL' })).toHaveAttribute('aria-multiselectable', 'true')
    expect(screen.getByText('Résumés must match every selected skill.')).toBeInTheDocument()
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['Java9', 'Kafka4', 'Spring Boot3'])
  })

  it('filters the list as you type and says when nothing is left to show', async () => {
    render(<Multi />)
    await userEvent.click(screen.getByRole('button', { name: 'SKILL' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Filter skill list' }), 'ka')
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['Kafka4'])

    await userEvent.clear(screen.getByRole('textbox', { name: 'Filter skill list' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Filter skill list' }), ',,')
    expect(screen.getByText('No matches')).toBeInTheDocument()
  })

  it('toggles skills on and off and stays open so several can be picked', async () => {
    const onChange = vi.fn()
    render(<Multi onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'SKILL' }))
    await userEvent.click(screen.getByRole('option', { name: /Java/ }))
    await userEvent.click(screen.getByRole('option', { name: /Kafka/ }))

    expect(onChange).toHaveBeenNthCalledWith(1, ['Java'])
    expect(onChange).toHaveBeenNthCalledWith(2, ['Java', 'Kafka'])
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Java/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: /SKILL \(2\)/ })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('option', { name: /Java/ }))
    expect(onChange).toHaveBeenLastCalledWith(['Kafka'])
    expect(screen.getByRole('button', { name: /SKILL \(1\)/ })).toBeInTheDocument()
  })

  it('toggles the first match when Enter is pressed in the filter box', async () => {
    const onChange = vi.fn()
    render(<Multi onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'SKILL' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Filter skill list' }), 'spr{Enter}')

    expect(onChange).toHaveBeenCalledWith(['Spring Boot'])
    expect(screen.getByRole('textbox', { name: 'Filter skill list' })).toHaveValue('')
  })

  it('adds a typed skill that is not in the list, without commas', async () => {
    const onChange = vi.fn()
    render(<Multi onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'SKILL' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Filter skill list' }), 'Rust, Go')

    expect(screen.getByRole('option', { name: 'Add "Rust Go"' })).toBeInTheDocument()
    await userEvent.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledWith(['Rust Go'])
  })

  it('keeps a chosen skill visible even when the options list does not have it', async () => {
    render(<Multi initial={['Haskell']} />)
    await userEvent.click(screen.getByRole('button', { name: /SKILL \(1\)/ }))
    expect(screen.getByRole('option', { name: 'Haskell' })).toHaveAttribute('aria-selected', 'true')
  })

  it('moves between the filter box and the options with the arrow keys', async () => {
    render(<Multi />)
    await userEvent.click(screen.getByRole('button', { name: 'SKILL' }))
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('option', { name: /Java/ })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('option', { name: /Kafka/ })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('option', { name: /Kafka/ })).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{ArrowUp}{ArrowUp}')
    expect(screen.getByRole('textbox', { name: 'Filter skill list' })).toHaveFocus()
  })

  it('closes on Escape with focus back on the button, and forgets the typed text', async () => {
    render(<Multi />)
    await userEvent.click(screen.getByRole('button', { name: 'SKILL' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Filter skill list' }), 'ka')
    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'SKILL' })).toHaveFocus()
    await userEvent.click(screen.getByRole('button', { name: 'SKILL' }))
    expect(screen.getByRole('textbox', { name: 'Filter skill list' })).toHaveValue('')
  })

  it('is disabled with No values yet when the list is empty and nothing is chosen', () => {
    render(<Multi options={[]} />)
    const button = screen.getByRole('button', { name: 'SKILL' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', 'No values yet')
  })
})
