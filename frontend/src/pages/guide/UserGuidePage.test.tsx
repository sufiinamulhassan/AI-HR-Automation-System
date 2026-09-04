import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoleGuide } from './types'


const list = vi.fn()
vi.mock('../../lib/api', () => ({ userGuideApi: { list: (...a: unknown[]) => list(...a) } }))

function fixture(role: RoleGuide['role'], label: string, slug: string, unique: string): RoleGuide {
  return {
    role,
    label,
    tagline: `${label} tagline`,
    intro: [`${label} intro paragraph`],
    chapters: [{
      id: `${slug}-chapter`,
      title: `${label} Chapter`,
      sections: [
        {
          id: `${slug}-first`,
          title: `${label} First Screen`,
          path: '/dashboard/hrbot',
          summary: `${label} summary about ${unique}`,
          access: `${label} only`,
          subsections: [{
            id: 'controls',
            title: 'Controls',
            body: [`Body text mentioning ${unique}`],
            steps: ['Step one', 'Step two'],
            controls: [{ name: 'Min Score', kind: 'filter', what: 'Hides weak matches', how: 'Raise it', access: 'Admin only' }],
            tips: ['A tip'],
            warnings: ['A warning'],
            faqs: [{ q: 'Why?', a: 'Because.' }],
          }],
        },
        {
          id: `${slug}-second`,
          title: `${label} Second Screen`,
          summary: `${label} second summary`,
          subsections: [],
        },
      ],
    }],
  }
}

const SUPER = fixture('superadmin', 'Super Admin', 'sa', 'platypus')
const ADMIN = fixture('admin', 'HR Admin', 'hr', 'aardvark')
const RECRUITER = fixture('standard', 'Recruiter', 'rec', 'narwhal')

vi.mock('./content', () => ({ GUIDES: [SUPER, ADMIN, RECRUITER] }))

const { useAuthStore } = await import('../../store/auth.store')
const { default: UserGuidePage } = await import('./UserGuidePage')

function renderAs(role: string, path = '/dashboard/guide') {
  useAuthStore.setState({ token: 'test-token', user: { role, email: 'a@b.c' } })
  return render(
    <MemoryRouter initialEntries={[path]}>
      <UserGuidePage />
    </MemoryRouter>
  )
}

const tabs = () => within(screen.getByRole('group', { name: 'Guide audience' }))
const rail = () => within(screen.getByRole('complementary', { name: 'Guide contents' }))
const article = () => within(screen.getByRole('article'))

describe('UserGuidePage', () => {
  beforeEach(() => {
    list.mockReset().mockResolvedValue({ data: { guides: [] } })
  })

  it('shows a recruiter only their own guide', async () => {
    renderAs('standard')

    expect(await tabs().findByRole('button', { name: 'Recruiter' })).toBeInTheDocument()
    expect(tabs().queryByRole('button', { name: 'HR Admin' })).not.toBeInTheDocument()
    expect(tabs().queryByRole('button', { name: 'Super Admin' })).not.toBeInTheDocument()
    expect(article().getByText('Recruiter guide')).toBeInTheDocument()
  })

  it('shows an HR admin their own guide and the recruiter one, but not super admin', async () => {
    renderAs('admin')

    expect(await tabs().findByRole('button', { name: 'HR Admin' })).toBeInTheDocument()
    expect(tabs().getByRole('button', { name: 'Recruiter' })).toBeInTheDocument()
    expect(tabs().queryByRole('button', { name: 'Super Admin' })).not.toBeInTheDocument()
    expect(article().getByText('HR Admin guide')).toBeInTheDocument()
  })

  it('shows a super admin all three, widest access first', async () => {
    renderAs('superadmin')

    const labels = tabs().getAllByRole('button').map(b => b.textContent)
    expect(labels).toEqual(['Super Admin', 'HR Admin', 'Recruiter'])
    expect(article().getByText('Super Admin guide')).toBeInTheDocument()
  })

  it('falls back to the viewer’s own guide when the URL asks for one above their rank', async () => {
    renderAs('standard', '/dashboard/guide?role=superadmin&section=sa-chapter/sa-first')

    expect(tabs().getAllByRole('button')).toHaveLength(1)
    expect(article().getByText('Recruiter guide')).toBeInTheDocument()
    expect(screen.queryByText(/platypus/)).not.toBeInTheDocument()
  })

  it('opens the section named in the URL, by full key or bare section id', async () => {
    const { unmount } = renderAs('admin', '/dashboard/guide?role=admin&section=hr-chapter/hr-first')

    const a = article()
    expect(a.getByRole('heading', { name: 'HR Admin First Screen' })).toBeInTheDocument()
    expect(a.getByText('HR Admin only')).toBeInTheDocument()
    expect(a.getByText('HR Admin summary about aardvark')).toBeInTheDocument()
    expect(a.getByText('Body text mentioning aardvark')).toBeInTheDocument()
    expect(a.getByText('Step one')).toBeInTheDocument()
    expect(a.getByText('Min Score')).toBeInTheDocument()
    expect(a.getByText('Hides weak matches')).toBeInTheDocument()
    expect(a.getByText('Admin only')).toBeInTheDocument()
    expect(a.getByText('A tip')).toBeInTheDocument()
    expect(a.getByText('A warning')).toBeInTheDocument()
    expect(a.getByText('Because.')).toBeInTheDocument()
    expect(a.getByRole('link', { name: /\/dashboard\/hrbot/ })).toHaveAttribute('href', '/dashboard/hrbot')
    unmount()

    renderAs('admin', '/dashboard/guide?section=hr-first')
    expect(await article().findByRole('heading', { name: 'HR Admin First Screen' })).toBeInTheDocument()
  })

  it('renders the bundled guide when the guide API fails', async () => {
    list.mockRejectedValue(new Error('backend down'))
    renderAs('superadmin')

    expect(article().getByText('Super Admin guide')).toBeInTheDocument()
    expect(article().getByText('Super Admin intro paragraph')).toBeInTheDocument()
    await waitFor(() => expect(list).toHaveBeenCalled())
  })

  it('prefers the published copy over the bundle, per role', async () => {
    const published = { ...ADMIN, tagline: 'Published from the database' }
    list.mockResolvedValue({ data: { guides: [published] } })
    renderAs('admin')

    expect(await article().findByText('Published from the database')).toBeInTheDocument()
    await userEvent.click(tabs().getByRole('button', { name: 'Recruiter' }))
    expect(article().getByText('Recruiter tagline')).toBeInTheDocument()
  })

  it('ignores a malformed payload rather than blanking the page', async () => {
    list.mockResolvedValue({ data: { guides: [{ role: 'nonsense' }, null, 'x'] } })
    renderAs('standard')

    await waitFor(() => expect(list).toHaveBeenCalled())
    expect(article().getByText('Recruiter guide')).toBeInTheDocument()
  })

  it('filters the contents rail by search, and says so when nothing matches', async () => {
    const user = userEvent.setup()
    renderAs('standard')

    const box = screen.getByRole('searchbox', { name: 'Search this guide' })
    await user.type(box, 'narwhal')
    await waitFor(() => expect(rail().getByText('1 of 2 sections')).toBeInTheDocument())
    expect(rail().getByRole('button', { name: 'Recruiter First Screen' })).toBeInTheDocument()
    expect(rail().queryByRole('button', { name: 'Recruiter Second Screen' })).not.toBeInTheDocument()

    await user.clear(box)
    await user.type(box, 'zzzz')
    expect(await rail().findByText(/Nothing in the Recruiter guide matches/)).toBeInTheDocument()
  })

  it('navigates from the rail into a section', async () => {
    const user = userEvent.setup()
    renderAs('standard')

    await user.click(rail().getByRole('button', { name: 'Recruiter Second Screen' }))
    expect(await article().findByRole('heading', { name: 'Recruiter Second Screen' })).toBeInTheDocument()
    expect(article().getByText('Recruiter second summary')).toBeInTheDocument()
  })
})
