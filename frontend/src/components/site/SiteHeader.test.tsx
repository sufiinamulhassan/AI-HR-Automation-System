import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prefetchRoute } from '../../lib/prefetch'
import { NAV_MENUS } from '../../lib/siteNav'
import SiteHeader from './SiteHeader'

vi.mock('../../lib/prefetch', () => ({
  prefetchRoute: vi.fn(),
  prefetchChunksWhenIdle: vi.fn(() => () => {}),
}))

function header(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SiteHeader />
    </MemoryRouter>,
  )
}

function trigger(label: string) {
  const nav = screen.getByRole('navigation', { name: 'Primary' })
  return within(nav).getByRole('button', { name: label })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('SiteHeader menus', () => {
  it('lists the links of each menu in its panel', () => {
    header()
    NAV_MENUS.filter(menu => menu.items).forEach(menu => {
      const button = trigger(menu.label)
      const panel = document.getElementById(button.getAttribute('aria-controls') as string) as HTMLElement
      expect(panel).not.toBeNull()
      menu.items?.forEach(item => {
        const link = within(panel).getByRole('link', { name: new RegExp(`^${item.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) })
        expect(link).toHaveAttribute('href', item.to)
      })
    })
  })

  it('opens on click, and closes on a second click', () => {
    header()
    const menu = trigger('Resources')
    expect(menu).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(menu)
    expect(menu).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(menu)
    expect(menu).toHaveAttribute('aria-expanded', 'false')
  })

  it('shows one menu at a time', () => {
    header()
    fireEvent.click(trigger('Resources'))
    fireEvent.click(trigger('Trust'))
    expect(trigger('Resources')).toHaveAttribute('aria-expanded', 'false')
    expect(trigger('Trust')).toHaveAttribute('aria-expanded', 'true')
  })

  it('closes on Escape and returns focus to the trigger', () => {
    header()
    const menu = trigger('Resources')
    fireEvent.click(menu)
    const panel = document.getElementById(menu.getAttribute('aria-controls') as string) as HTMLElement
    const firstLink = within(panel).getAllByRole('link')[0]
    firstLink.focus()
    fireEvent.keyDown(firstLink, { key: 'Escape' })
    expect(menu).toHaveAttribute('aria-expanded', 'false')
    expect(menu).toHaveFocus()
  })

  it('closes when you press outside the header', () => {
    header()
    fireEvent.click(trigger('Resources'))
    fireEvent.mouseDown(document.body)
    expect(trigger('Resources')).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens on hover after a short delay and closes after leaving', () => {
    header()
    const menu = trigger('Resources')
    const wrapper = menu.closest('.xv-menu') as HTMLElement
    fireEvent.mouseEnter(wrapper)
    expect(menu).toHaveAttribute('aria-expanded', 'false')
    act(() => { vi.advanceTimersByTime(80) })
    expect(menu).toHaveAttribute('aria-expanded', 'true')
    fireEvent.mouseLeave(wrapper)
    act(() => { vi.advanceTimersByTime(60) })
    expect(menu).toHaveAttribute('aria-expanded', 'true')
    act(() => { vi.advanceTimersByTime(200) })
    expect(menu).toHaveAttribute('aria-expanded', 'false')
  })

  it('marks the menu that holds the current page', () => {
    header('/integrations/zoom')
    expect(trigger('Resources')).toHaveClass('is-current')
    expect(trigger('Trust')).not.toHaveClass('is-current')
  })

  it('warms the next page when you point at a link', () => {
    header()
    fireEvent.click(trigger('Resources'))
    const panel = document.getElementById(trigger('Resources').getAttribute('aria-controls') as string) as HTMLElement
    const link = within(panel).getAllByRole('link')[0]
    fireEvent.mouseEnter(link)
    expect(prefetchRoute).toHaveBeenCalledWith(link.getAttribute('href'))
  })
})

describe('SiteHeader featured boxes', () => {
  it('shows one box beside the Resources links and two beside the Trust links, each with its own link', () => {
    header()
    NAV_MENUS.filter(menu => menu.items).forEach(menu => {
      const button = trigger(menu.label)
      const panel = document.getElementById(button.getAttribute('aria-controls') as string) as HTMLElement
      const boxes = panel.querySelectorAll('.xv-panel-featured')
      expect(boxes, menu.label).toHaveLength(menu.label === 'Resources' ? 1 : 2)
      menu.featured?.forEach((card, i) => {
        const box = boxes[i] as HTMLElement
        expect(within(box).getByText(card.title)).toBeInTheDocument()
        expect(within(box).getByText(card.description)).toBeInTheDocument()
        expect(within(box).getByRole('link', { name: card.cta })).toHaveAttribute('href', card.to)
      })
    })
  })
})

describe('SiteHeader drawer', () => {
  it('starts with every group closed and opens one at a time', () => {
    header()
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    const drawer = document.getElementById('site-drawer') as HTMLElement
    const groups = NAV_MENUS.filter(menu => menu.items)
    groups.forEach(group => {
      expect(within(drawer).getByRole('button', { name: group.label })).toHaveAttribute('aria-expanded', 'false')
    })

    fireEvent.click(within(drawer).getByRole('button', { name: groups[0].label }))
    expect(within(drawer).getByRole('button', { name: groups[0].label })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(within(drawer).getByRole('button', { name: groups[1].label }))
    expect(within(drawer).getByRole('button', { name: groups[1].label })).toHaveAttribute('aria-expanded', 'true')
    expect(within(drawer).getByRole('button', { name: groups[0].label })).toHaveAttribute('aria-expanded', 'false')
  })

  it('lists the plain links in order and ends with a Login button', () => {
    header()
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    const drawer = document.getElementById('site-drawer') as HTMLElement
    const mobile = within(drawer).getByRole('navigation', { name: 'Mobile' })
    NAV_MENUS.filter(menu => !menu.items).forEach(menu => {
      expect(within(mobile).getByRole('link', { name: menu.label })).toHaveAttribute('href', menu.to)
    })
    const login = within(drawer).getByRole('link', { name: 'Login' })
    expect(login).toHaveAttribute('href', '/login')
    expect(login).toHaveClass('xv-btn')
  })

  it('hides the drawer from assistive technology while closed', () => {
    header()
    const drawer = document.getElementById('site-drawer') as HTMLElement
    expect(drawer).toHaveAttribute('aria-hidden', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    expect(drawer).toHaveAttribute('aria-hidden', 'false')
  })

  it('locks page scrolling while it is open', () => {
    header()
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    expect(document.body).toHaveClass('xv-locked')
    fireEvent.click(screen.getByRole('button', { name: 'Close menu' }))
    expect(document.body).not.toHaveClass('xv-locked')
  })
})
