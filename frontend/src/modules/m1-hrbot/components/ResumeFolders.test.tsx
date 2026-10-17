import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const domains = vi.fn()

vi.mock('../../../lib/api', () => ({
  resumesApi: { domains: (...a: unknown[]) => domains(...a) },
}))

const { default: ResumeFolders } = await import('./ResumeFolders')

const FOLDERS = [
  {
    value: 'it_software',
    label: 'IT & Software',
    count: 12,
    roles: [
      { value: 'Java Developer', count: 5 },
      { value: 'QA Engineer', count: 3 },
      { value: 'DevOps Engineer', count: 2 },
      { value: 'Data Engineer', count: 1 },
      { value: 'Designer', count: 1 },
    ],
  },
  { value: 'legal', label: 'Legal', count: 1, roles: [{ value: 'Paralegal', count: 1 }] },
  { value: 'other', label: 'Other', count: 1200, roles: [] },
]

function setup(props: Partial<{ params: Record<string, unknown>; reloadKey: number; hasFilters: boolean }> = {}) {
  const onOpen = vi.fn()
  const utils = render(<ResumeFolders params={{}} reloadKey={0} hasFilters={false} onOpen={onOpen} {...props} />)
  return { ...utils, onOpen }
}

beforeEach(() => {
  domains.mockReset().mockResolvedValue({ data: { folders: FOLDERS, total: 1213 } })
})

describe('ResumeFolders', () => {
  it('asks for the folders with exactly the filters it is given', async () => {
    setup({ params: { search: 'java', status: 'processed', skill: 'Java,Kafka' } })
    await screen.findByRole('list', { name: 'Domain folders' })
    expect(domains).toHaveBeenCalledTimes(1)
    expect(domains).toHaveBeenCalledWith({ search: 'java', status: 'processed', skill: 'Java,Kafka' })
  })

  it('shows a busy placeholder while loading', () => {
    domains.mockReturnValue(new Promise(() => {}))
    const { container } = setup()
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(screen.getByText('Loading folders')).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('shows a tile per folder with its name and a big count', async () => {
    setup()
    const list = await screen.findByRole('list', { name: 'Domain folders' })
    const tiles = within(list).getAllByRole('button')
    expect(tiles).toHaveLength(3)
    expect(tiles[0]).toHaveAccessibleName('Open IT & Software: 12 résumés')
    expect(tiles[0].querySelector('.rfo-name')).toHaveTextContent('IT & Software')
    expect(tiles[0].querySelector('.rfo-count')).toHaveTextContent('12')
    expect(tiles[1]).toHaveAccessibleName('Open Legal: 1 résumé')
    expect(tiles[2].querySelector('.rfo-count')).toHaveTextContent((1200).toLocaleString())
  })

  it('shows at most three top roles', async () => {
    setup()
    const list = await screen.findByRole('list', { name: 'Domain folders' })
    const [first, second, third] = within(list).getAllByRole('button')
    expect(Array.from(first.querySelectorAll('.rfo-role')).map(r => r.textContent)).toEqual([
      'Java Developer', 'QA Engineer', 'DevOps Engineer',
    ])
    expect(Array.from(second.querySelectorAll('.rfo-role')).map(r => r.textContent)).toEqual(['Paralegal'])
    expect(third.querySelectorAll('.rfo-role')).toHaveLength(0)
  })

  it('accepts roles sent as plain names', async () => {
    domains.mockResolvedValue({ data: { folders: [{ value: 'legal', label: 'Legal', count: 2, roles: ['Paralegal', 'Counsel'] }], total: 2 } })
    setup()
    const list = await screen.findByRole('list', { name: 'Domain folders' })
    expect(Array.from(list.querySelectorAll('.rfo-role')).map(r => r.textContent)).toEqual(['Paralegal', 'Counsel'])
  })

  it('opens the folder it is given when its tile is clicked', async () => {
    const { onOpen } = setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Open Legal: 1 résumé' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith('legal')
  })

  it('opens a folder from the keyboard', async () => {
    const { onOpen } = setup()
    const tile = await screen.findByRole('button', { name: 'Open IT & Software: 12 résumés' })
    tile.focus()
    await userEvent.keyboard('{Enter}')
    expect(onOpen).toHaveBeenCalledWith('it_software')
  })

  it('marks the grid as the compact size', async () => {
    setup()
    expect(await screen.findByRole('list', { name: 'Domain folders' })).toHaveAttribute('data-density', 'compact')
  })

  it('says there are no résumés yet when there are no folders and no filters', async () => {
    domains.mockResolvedValue({ data: { folders: [], total: 0 } })
    setup()
    expect(await screen.findByText('No résumés yet')).toBeInTheDocument()
  })

  it('says no folders match when filters are applied', async () => {
    domains.mockResolvedValue({ data: { folders: [], total: 0 } })
    setup({ hasFilters: true, params: { search: 'zzz' } })
    expect(await screen.findByText('No folders match these filters')).toBeInTheDocument()
    expect(screen.queryByText('No résumés yet')).not.toBeInTheDocument()
  })

  it('treats an odd answer as empty, and skips folders without a value', async () => {
    domains.mockResolvedValue({ data: { folders: [{ label: 'Nameless', count: 4 }, null, { value: 'legal', count: 'many' }] } })
    setup()
    const list = await screen.findByRole('list', { name: 'Domain folders' })
    const tiles = within(list).getAllByRole('button')
    expect(tiles).toHaveLength(1)
    expect(tiles[0]).toHaveAccessibleName('Open legal: 0 résumés')
  })

  it('shows an error with Retry, and Retry loads the folders', async () => {
    domains.mockRejectedValueOnce(new Error('boom'))
    setup()
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load folders.")
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('list', { name: 'Domain folders' })).toBeInTheDocument()
    expect(domains).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('loads again when the filters change', async () => {
    const onOpen = vi.fn()
    const { rerender } = render(<ResumeFolders params={{}} reloadKey={0} hasFilters={false} onOpen={onOpen} />)
    await screen.findByRole('list', { name: 'Domain folders' })
    rerender(<ResumeFolders params={{ seniority: 'senior' }} reloadKey={0} hasFilters onOpen={onOpen} />)
    await waitFor(() => expect(domains).toHaveBeenLastCalledWith({ seniority: 'senior' }))
    expect(domains).toHaveBeenCalledTimes(2)
  })

  it('does not load again for the same filters in a new object', async () => {
    const onOpen = vi.fn()
    const { rerender } = render(<ResumeFolders params={{ search: 'a' }} reloadKey={0} hasFilters onOpen={onOpen} />)
    await screen.findByRole('list', { name: 'Domain folders' })
    rerender(<ResumeFolders params={{ search: 'a' }} reloadKey={0} hasFilters onOpen={onOpen} />)
    expect(domains).toHaveBeenCalledTimes(1)
  })

  it('loads again when the page asks for a refresh', async () => {
    const onOpen = vi.fn()
    const { rerender } = render(<ResumeFolders params={{}} reloadKey={0} hasFilters={false} onOpen={onOpen} />)
    await screen.findByRole('list', { name: 'Domain folders' })
    rerender(<ResumeFolders params={{}} reloadKey={1} hasFilters={false} onOpen={onOpen} />)
    await waitFor(() => expect(domains).toHaveBeenCalledTimes(2))
  })

  it('ignores an answer that arrives after a newer request', async () => {
    let late: (v: unknown) => void = () => {}
    domains
      .mockReturnValueOnce(new Promise(resolve => { late = resolve }))
      .mockResolvedValueOnce({ data: { folders: [{ value: 'legal', label: 'Legal', count: 7, roles: [] }], total: 7 } })
    const onOpen = vi.fn()
    const { rerender } = render(<ResumeFolders params={{}} reloadKey={0} hasFilters={false} onOpen={onOpen} />)
    rerender(<ResumeFolders params={{ search: 'x' }} reloadKey={0} hasFilters onOpen={onOpen} />)
    expect(await screen.findByRole('button', { name: 'Open Legal: 7 résumés' })).toBeInTheDocument()
    late({ data: { folders: FOLDERS, total: 1213 } })
    await new Promise(r => setTimeout(r, 20))
    expect(screen.queryByRole('button', { name: /IT & Software/ })).not.toBeInTheDocument()
  })

  it('renders no em dash', async () => {
    const { container } = setup()
    await screen.findByRole('list', { name: 'Domain folders' })
    expect(container.textContent).not.toContain(String.fromCharCode(0x2014))
  })
})
