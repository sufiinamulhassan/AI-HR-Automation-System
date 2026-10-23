import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ScrollToTop from './ScrollToTop'

let scrollTo: ReturnType<typeof vi.spyOn>

function scrollPage(y: number) {
  act(() => {
    Object.defineProperty(window, 'scrollY', { value: y, configurable: true })
    window.dispatchEvent(new Event('scroll'))
  })
}

beforeEach(() => {
  scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ScrollToTop', () => {
  it('stays hidden near the top of the page', () => {
    render(<ScrollToTop />)
    expect(screen.queryByRole('button', { name: 'Scroll to top' })).not.toBeInTheDocument()
    scrollPage(200)
    expect(screen.queryByRole('button', { name: 'Scroll to top' })).not.toBeInTheDocument()
  })

  it('appears after scrolling down and hides again at the top', () => {
    render(<ScrollToTop />)
    scrollPage(800)
    const button = screen.getByRole('button', { name: 'Scroll to top' })
    expect(button).toHaveClass('xv-to-top-on')
    expect(button).toHaveAttribute('tabindex', '0')
    scrollPage(0)
    expect(screen.queryByRole('button', { name: 'Scroll to top' })).not.toBeInTheDocument()
  })

  it('scrolls the window back to the top when clicked', () => {
    render(<ScrollToTop />)
    scrollPage(1200)
    fireEvent.click(screen.getByRole('button', { name: 'Scroll to top' }))
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }))
  })
})
