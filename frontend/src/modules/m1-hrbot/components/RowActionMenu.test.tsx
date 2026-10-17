import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RowActionMenu, { type MenuItem } from './RowActionMenu'

const onFirst = vi.fn()
const onSecond = vi.fn()
const onThird = vi.fn()

function items(): MenuItem[] {
  return [
    { id: 'first', label: 'First', onSelect: onFirst },
    { id: 'second', label: 'Second', onSelect: onSecond, disabled: true },
    { id: 'third', label: 'Third', onSelect: onThird, tone: 'danger' },
  ]
}

function setup() {
  render(
    <div>
      <RowActionMenu label="More actions for Ada" getItems={items} />
      <button type="button">elsewhere</button>
    </div>,
  )
  return { user: userEvent.setup(), trigger: screen.getByRole('button', { name: 'More actions for Ada' }) }
}

describe('RowActionMenu', () => {
  beforeEach(() => {
    onFirst.mockReset()
    onSecond.mockReset()
    onThird.mockReset()
  })

  it('renders only the trigger until opened, and builds no items while closed', () => {
    const getItems = vi.fn(items)
    render(<RowActionMenu label="More" getItems={getItems} />)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(getItems).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'More' })).toHaveAttribute('aria-expanded', 'false')
  })

  it.each([['Enter', '{Enter}'], ['Space', ' ']])('opens with %s on the focused trigger and focuses the first item', async (_name, keys) => {
    const { user, trigger } = setup()
    trigger.focus()
    await user.keyboard(keys)

    const menu = screen.getByRole('menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(within(menu).getAllByRole('menuitem').map(i => i.textContent)).toEqual(['First', 'Second', 'Third'])
    expect(within(menu).getByRole('menuitem', { name: 'First' })).toHaveFocus()
  })

  it('opens with ArrowDown on the trigger', async () => {
    const { user, trigger } = setup()
    trigger.focus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('moves focus with the arrow keys, skipping disabled items and wrapping', async () => {
    const { user, trigger } = setup()
    await user.click(trigger)
    const menu = screen.getByRole('menu')
    const first = within(menu).getByRole('menuitem', { name: 'First' })
    const third = within(menu).getByRole('menuitem', { name: 'Third' })

    expect(first).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(third).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(first).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(third).toHaveFocus()
    await user.keyboard('{Home}')
    expect(first).toHaveFocus()
    await user.keyboard('{End}')
    expect(third).toHaveFocus()
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    const { user, trigger } = setup()
    await user.click(trigger)
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes on an outside click without selecting anything', async () => {
    const { user, trigger } = setup()
    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'elsewhere' }))

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(onFirst).not.toHaveBeenCalled()
  })

  it('toggles closed when the trigger is clicked again', async () => {
    const { user, trigger } = setup()
    await user.click(trigger)
    await user.click(trigger)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('runs the chosen item once, then closes and refocuses the trigger', async () => {
    const { user, trigger } = setup()
    await user.click(trigger)
    await user.click(screen.getByRole('menuitem', { name: 'Third' }))

    expect(onThird).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('runs the focused item on Enter', async () => {
    const { user, trigger } = setup()
    await user.click(trigger)
    await user.keyboard('{Enter}')
    expect(onFirst).toHaveBeenCalledTimes(1)
  })

  it('does not run a disabled item', async () => {
    const { user, trigger } = setup()
    await user.click(trigger)
    const second = screen.getByRole('menuitem', { name: 'Second' })
    expect(second).toBeDisabled()
    await user.click(second)
    expect(onSecond).not.toHaveBeenCalled()
  })

  it('closes on Tab instead of leaving a floating menu behind', async () => {
    const { user, trigger } = setup()
    await user.click(trigger)
    await user.keyboard('{Tab}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
