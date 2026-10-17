import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SelfIdScreen from './SelfIdScreen'

const TOKEN = 'tok_abc123'

describe('SelfIdScreen', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('states plainly that this is voluntary, never affects evaluation, and can be skipped', () => {
    render(<SelfIdScreen token={TOKEN} onDone={vi.fn()} />)

    expect(screen.getByText(/voluntary/i)).toBeInTheDocument()
    expect(screen.getByText(/never affect your evaluation or hiring decision/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /skip.*prefer not to answer/i })).toBeInTheDocument()
  })

  it('calls onDone without ever hitting the network when skipped', async () => {
    const user = userEvent.setup()
    const onDone = vi.fn()
    render(<SelfIdScreen token={TOKEN} onDone={onDone} />)

    await user.click(screen.getByRole('button', { name: /skip.*prefer not to answer/i }))

    expect(onDone).toHaveBeenCalledTimes(1)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('submits gender and location to the contract endpoint, then calls onDone', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }))
    const user = userEvent.setup()
    const onDone = vi.fn()
    render(<SelfIdScreen token={TOKEN} onDone={onDone} />)

    await user.selectOptions(screen.getByRole('combobox'), 'Female')
    await user.type(screen.getByPlaceholderText(/city, country/i), 'London, UK')
    await user.click(screen.getByRole('button', { name: /^submit$/i }))

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))

    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(String(url).endsWith(`/interview/${TOKEN}/demographics`)).toBe(true)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ gender: 'Female', location: 'London, UK' })
  })

  it('submitting with both fields left at their defaults still submits once, with nulls', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }))
    const user = userEvent.setup()
    const onDone = vi.fn()
    render(<SelfIdScreen token={TOKEN} onDone={onDone} />)

    await user.click(screen.getByRole('button', { name: /^submit$/i }))

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ gender: null, location: null })
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('lets the candidate retry or skip if the submit call fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    const user = userEvent.setup()
    const onDone = vi.fn()
    render(<SelfIdScreen token={TOKEN} onDone={onDone} />)

    await user.click(screen.getByRole('button', { name: /^submit$/i }))

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument()
    expect(onDone).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /skip.*prefer not to answer/i }))
    expect(onDone).toHaveBeenCalledTimes(1)
  })
})
