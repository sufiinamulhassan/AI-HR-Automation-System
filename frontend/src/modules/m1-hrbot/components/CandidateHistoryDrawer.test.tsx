import { useState, type ComponentProps } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import drawerTsx from './CandidateHistoryDrawer.tsx?raw'
import drawerCss from './CandidateHistoryDrawer.css?raw'

const api = vi.hoisted(() => ({
  get: vi.fn(),
  getTimeline: vi.fn(),
  getProfileByEmail: vi.fn(),
  updateNotes: vi.fn(),
  updateProfileNotes: vi.fn(),
  sharesList: vi.fn(),
  offersList: vi.fn(),
}))

vi.mock('../../../lib/api', () => ({
  candidatesApi: {
    get: api.get,
    getTimeline: api.getTimeline,
    getProfileByEmail: api.getProfileByEmail,
    updateNotes: api.updateNotes,
    updateProfileNotes: api.updateProfileNotes,
  },
  interviewApi: { shares: { list: api.sharesList } },
  offersApi: { list: api.offersList },
}))

const { default: CandidateHistoryDrawer } = await import('./CandidateHistoryDrawer')
const { useAuthStore } = await import('../../../store/auth.store')

const ADMIN = { role: 'admin', email: 'admin@x.com', name: 'Admin' }
const STANDARD = { role: 'standard', email: 'user@x.com', name: 'User' }

const CANDIDATE = {
  candidate_id: 'cand_1',
  email: 'ada@x.com',
  recruiter_notes: 'Strong on systems.',
  recruiter_notes_updated_at: '2026-02-01T10:00:00Z',
}
const PROFILE = { profile_id: 'prof_1', profile_notes: 'Referred by Sam.', updated_at: '2026-02-02T10:00:00Z' }
const TIMELINE = [
  { candidate_id: 'c2', job_id: 'job_a', job_title: 'Data Engineer', status: 'rejected', decision: 'reject', invite_type: 'auto', created_at: '2026-01-10T10:00:00Z', decided_at: '2026-01-20T10:00:00Z' },
  { candidate_id: 'c3', job_id: 'job_b', job_title: 'Platform Engineer', status: 'invited', created_at: '2026-03-01T10:00:00Z' },
]
const OFFERS = [
  { offer_id: 'o1', job_id: 'job_1', salary: '120000', joining_date: '2026-05-01', status: 'pending_approval', created_at: '2026-04-01T10:00:00Z' },
  { offer_id: 'o2', job_id: 'job_a', salary: '90000', status: 'declined', created_at: '2026-01-18T10:00:00Z' },
]
const SHARES = [
  { share_id: 's1', feedback: [{ feedback_id: 'f1', reviewer_name: 'Jane Hiring Manager', rating: 4, comment: 'Strong technically.', created_at: '2026-06-02T09:00:00Z' }] },
  { share_id: 's2', feedback: [{ feedback_id: 'f2', reviewer_name: null, rating: null, comment: 'Needs a follow-up on system design.', created_at: '2026-06-05T09:00:00Z' }] },
]

const denied = (status: number) => ({ response: { status, data: { detail: 'nope' } } })

const onClose = vi.fn()
const onOpenOffers = vi.fn()

function renderDrawer(props: Partial<ComponentProps<typeof CandidateHistoryDrawer>> = {}) {
  render(
    <CandidateHistoryDrawer
      candidateId="cand_1"
      candidateName="Ada Lovelace"
      initialTab="timeline"
      secureToken="tok_1"
      jobId="job_1"
      onOpenOffers={onOpenOffers}
      onClose={onClose}
      {...props}
    />,
  )
  return userEvent.setup()
}

const tab = (name: string) => screen.getByRole('tab', { name })
const panel = () => screen.getByRole('tabpanel')

beforeEach(() => {
  vi.restoreAllMocks()
  for (const fn of Object.values(api)) fn.mockReset()
  onClose.mockReset()
  onOpenOffers.mockReset()
  api.get.mockResolvedValue({ data: CANDIDATE })
  api.getTimeline.mockResolvedValue({ data: { timeline: TIMELINE } })
  api.getProfileByEmail.mockResolvedValue({ data: PROFILE })
  api.updateNotes.mockResolvedValue({ data: { updated_at: '2026-07-01T10:00:00Z' } })
  api.updateProfileNotes.mockResolvedValue({ data: { updated_at: '2026-07-02T10:00:00Z' } })
  api.sharesList.mockResolvedValue({ data: { shares: SHARES } })
  api.offersList.mockResolvedValue({ data: { offers: OFFERS } })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  useAuthStore.setState({ token: 'tok', user: ADMIN })
})

describe('shell', () => {
  it('is a modal dialog titled with the candidate name, with focus moved into it', async () => {
    renderDrawer()
    const dialog = screen.getByRole('dialog', { name: /Ada Lovelace/ })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(within(dialog).getByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument()
    expect(dialog).toHaveFocus()
    await within(panel()).findByText('Data Engineer')
  })

  it.each([['timeline', 'Timeline'], ['notes', 'Notes & Feedback'], ['jobs', 'Jobs & Offers']] as const)(
    'opens on the requested tab: %s',
    async (initialTab, label) => {
      renderDrawer({ initialTab })
      expect(tab(label)).toHaveAttribute('aria-selected', 'true')
      expect(screen.getAllByRole('tab').filter(t => t.getAttribute('aria-selected') === 'true')).toHaveLength(1)
      expect(panel()).toHaveAccessibleName(label)
      await waitFor(() => expect(within(panel()).queryByRole('status')).not.toBeInTheDocument())
    },
  )

  it('closes on Escape and hands focus back to whatever opened it', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>opener</button>
          {open && <CandidateHistoryDrawer candidateId="cand_1" candidateName="Ada Lovelace" onClose={() => setOpen(false)} />}
        </>
      )
    }
    const user = userEvent.setup()
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'opener' })

    await user.click(opener)
    expect(await screen.findByRole('dialog')).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('closes from the close button and from a backdrop click, but not from a click inside the drawer', async () => {
    const user = renderDrawer()
    await user.click(screen.getByRole('heading', { name: 'Ada Lovelace' }))
    expect(onClose).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Close candidate history' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    await user.click(screen.getByTestId('history-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('keeps Tab inside the drawer', async () => {
    const user = renderDrawer()
    await within(panel()).findByText('Data Engineer')

    screen.getByRole('button', { name: 'Close candidate history' }).focus()
    await user.tab({ shift: true })
    expect(tab('Jobs & Offers')).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('button', { name: 'Close candidate history' })).toHaveFocus()
  })

  it('moves between tabs with the arrow keys', async () => {
    const user = renderDrawer()
    await waitFor(() => expect(api.getTimeline).toHaveBeenCalled())
    tab('Timeline').focus()

    await user.keyboard('{ArrowRight}')
    expect(tab('Notes & Feedback')).toHaveAttribute('aria-selected', 'true')
    expect(tab('Notes & Feedback')).toHaveFocus()

    await user.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(tab('Jobs & Offers')).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{Home}')
    expect(tab('Timeline')).toHaveAttribute('aria-selected', 'true')
  })
})

describe('lazy loading', () => {
  it('fetches only the timeline until another tab is opened, and never refetches on a revisit', async () => {
    const user = renderDrawer()
    await within(panel()).findByText('Data Engineer')

    expect(api.getTimeline).toHaveBeenCalledTimes(1)
    for (const fn of [api.get, api.getProfileByEmail, api.sharesList, api.offersList]) expect(fn).not.toHaveBeenCalled()

    await user.click(tab('Notes & Feedback'))
    await within(panel()).findByRole('textbox', { name: 'Recruiter notes' })
    expect(api.get).toHaveBeenCalledTimes(1)
    expect(api.sharesList).toHaveBeenCalledWith('tok_1')
    expect(api.offersList).not.toHaveBeenCalled()

    await user.click(tab('Jobs & Offers'))
    await within(panel()).findByText('120000', { exact: false })
    expect(api.offersList).toHaveBeenCalledWith({ candidate_id: 'cand_1' })
    expect(api.getTimeline).toHaveBeenCalledTimes(1)

    await user.click(tab('Timeline'))
    await user.click(tab('Notes & Feedback'))
    await user.click(tab('Jobs & Offers'))
    expect(api.getTimeline).toHaveBeenCalledTimes(1)
    expect(api.get).toHaveBeenCalledTimes(1)
    expect(api.sharesList).toHaveBeenCalledTimes(1)
    expect(api.offersList).toHaveBeenCalledTimes(1)
  })

  it('opening straight on Notes fetches no timeline and no offers', async () => {
    renderDrawer({ initialTab: 'notes' })
    await within(panel()).findByRole('textbox', { name: 'Recruiter notes' })
    expect(api.getTimeline).not.toHaveBeenCalled()
    expect(api.offersList).not.toHaveBeenCalled()
  })

  it('opening Jobs & Offers loads the timeline and the offers, but not the notes', async () => {
    renderDrawer({ initialTab: 'jobs' })
    await within(panel()).findByText('Platform Engineer')
    expect(api.getTimeline).toHaveBeenCalledTimes(1)
    expect(api.offersList).toHaveBeenCalledTimes(1)
    expect(api.get).not.toHaveBeenCalled()
  })

  it('shows a loading state per tab while its request is pending', async () => {
    api.getTimeline.mockReturnValue(new Promise(() => {}))
    const user = renderDrawer()
    expect(within(panel()).getByRole('status')).toHaveTextContent('Loading history')

    await user.click(tab('Notes & Feedback'))
    expect(await within(panel()).findByRole('textbox', { name: 'Recruiter notes' })).toBeInTheDocument()
  })
})

describe('timeline tab', () => {
  it('lists the other applications with status, decision and dates', async () => {
    renderDrawer()
    const list = await within(panel()).findByRole('list')
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(2)

    expect(items[0]).toHaveTextContent('Data Engineer')
    expect(items[0]).toHaveTextContent('rejected')
    expect(items[0]).toHaveTextContent('auto invite')
    expect(items[0]).toHaveTextContent('Decision: reject')
    expect(items[0]).toHaveTextContent(/Applied/)
    expect(items[0]).toHaveTextContent(/Decided/)
    expect(items[1]).toHaveTextContent('Platform Engineer')
    expect(items[1]).toHaveTextContent('invited')
  })

  it('says so when the person has no other applications', async () => {
    api.getTimeline.mockResolvedValue({ data: { timeline: [] } })
    renderDrawer()
    expect(await within(panel()).findByText(/No other applications found/)).toBeInTheDocument()
  })

  it('shows an inline error with a working Retry', async () => {
    api.getTimeline.mockRejectedValueOnce(denied(500))
    const user = renderDrawer()
    expect(await within(panel()).findByRole('alert')).toHaveTextContent("Could not load this person's history.")

    await user.click(within(panel()).getByRole('button', { name: 'Retry' }))
    expect(await within(panel()).findByText('Data Engineer')).toBeInTheDocument()
    expect(within(panel()).queryByRole('alert')).not.toBeInTheDocument()
    expect(api.getTimeline).toHaveBeenCalledTimes(2)
  })
})

describe('independent error states', () => {
  it('a failed timeline leaves the notes tab and the offers list working', async () => {
    api.getTimeline.mockRejectedValue(denied(500))
    const user = renderDrawer()
    expect(await within(panel()).findByRole('alert')).toBeInTheDocument()

    await user.click(tab('Notes & Feedback'))
    expect(await within(panel()).findByRole('textbox', { name: 'Recruiter notes' })).toHaveValue('Strong on systems.')
    expect(within(panel()).queryByRole('alert')).not.toBeInTheDocument()

    await user.click(tab('Jobs & Offers'))
    expect(await within(panel()).findByText('Could not load the other jobs.')).toBeInTheDocument()
    expect(await within(panel()).findByText(/120000/)).toBeInTheDocument()
    expect(within(panel()).getByText('pending approval')).toBeInTheDocument()
  })

  it('failed offers leave the jobs list intact, and Retry reloads only the offers', async () => {
    api.offersList.mockRejectedValueOnce(denied(500))
    const user = renderDrawer({ initialTab: 'jobs' })
    expect(await within(panel()).findByText('Platform Engineer')).toBeInTheDocument()
    expect(await within(panel()).findByText("Could not load this candidate's offers.")).toBeInTheDocument()

    await user.click(within(panel()).getByRole('button', { name: 'Retry' }))
    expect(await within(panel()).findByText(/120000/)).toBeInTheDocument()
    expect(api.offersList).toHaveBeenCalledTimes(2)
    expect(api.getTimeline).toHaveBeenCalledTimes(1)
  })

  it('a failed candidate record leaves reviewer feedback visible', async () => {
    api.get.mockRejectedValue(denied(500))
    renderDrawer({ initialTab: 'notes' })
    expect(await within(panel()).findByText('Could not load the recruiter notes.')).toBeInTheDocument()
    expect(await within(panel()).findByText('Strong technically.')).toBeInTheDocument()
    expect(within(panel()).queryByRole('textbox')).not.toBeInTheDocument()
  })
})

describe('notes: admin', () => {
  it('edits and saves the recruiter notes, then reports it', async () => {
    const user = renderDrawer({ initialTab: 'notes' })
    const box = await within(panel()).findByRole('textbox', { name: 'Recruiter notes' })
    const save = within(panel()).getAllByRole('button', { name: 'Save notes' })[0]
    expect(save).toBeDisabled()

    await user.type(box, ' Follow up.')
    expect(save).toBeEnabled()
    await user.click(save)

    expect(api.updateNotes).toHaveBeenCalledWith('cand_1', 'Strong on systems. Follow up.')
    expect(await within(panel()).findByText('Notes saved')).toBeInTheDocument()
    expect(save).toBeDisabled()
    expect(within(panel()).queryByText('Only admins can edit notes.')).not.toBeInTheDocument()
  })

  it('keeps the typed text and says so when saving fails', async () => {
    api.updateNotes.mockRejectedValue(denied(500))
    const user = renderDrawer({ initialTab: 'notes' })
    const box = await within(panel()).findByRole('textbox', { name: 'Recruiter notes' })

    await user.type(box, '!')
    await user.click(within(panel()).getAllByRole('button', { name: 'Save notes' })[0])

    expect(await within(panel()).findByRole('alert')).toHaveTextContent('Could not save these notes')
    expect(box).toHaveValue('Strong on systems.!')
  })

  it('edits the person-level notes through the profile endpoint', async () => {
    const user = renderDrawer({ initialTab: 'notes' })
    const box = await within(panel()).findByRole('textbox', { name: 'Notes about this person' })
    expect(api.getProfileByEmail).toHaveBeenCalledWith('ada@x.com')
    expect(box).toHaveValue('Referred by Sam.')

    await user.type(box, ' Met at a meetup.')
    const saves = within(panel()).getAllByRole('button', { name: 'Save notes' })
    await user.click(saves[1])

    expect(api.updateProfileNotes).toHaveBeenCalledWith('prof_1', 'Referred by Sam. Met at a meetup.')
    expect(api.updateNotes).not.toHaveBeenCalled()
  })

  it('omits the person-level section when there is no profile, without an error', async () => {
    api.getProfileByEmail.mockRejectedValue(denied(404))
    renderDrawer({ initialTab: 'notes' })
    await within(panel()).findByRole('textbox', { name: 'Recruiter notes' })
    await waitFor(() => expect(api.getProfileByEmail).toHaveBeenCalled())
    expect(within(panel()).queryByRole('textbox', { name: 'Notes about this person' })).not.toBeInTheDocument()
    expect(within(panel()).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('asks before closing with unsaved notes, and closes only when confirmed', async () => {
    const user = renderDrawer({ initialTab: 'notes' })
    const box = await within(panel()).findByRole('textbox', { name: 'Recruiter notes' })
    await user.type(box, ' More.')

    vi.spyOn(window, 'confirm').mockReturnValueOnce(false)
    await user.keyboard('{Escape}')
    expect(window.confirm).toHaveBeenCalledWith('Discard your unsaved notes?')
    expect(onClose).not.toHaveBeenCalled()

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not ask once the notes are saved', async () => {
    const user = renderDrawer({ initialTab: 'notes' })
    const box = await within(panel()).findByRole('textbox', { name: 'Recruiter notes' })
    await user.type(box, ' More.')
    await user.click(within(panel()).getAllByRole('button', { name: 'Save notes' })[0])
    await within(panel()).findByText('Notes saved')

    await user.keyboard('{Escape}')
    expect(window.confirm).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps unsaved text when switching tabs and back', async () => {
    const user = renderDrawer({ initialTab: 'notes' })
    const box = await within(panel()).findByRole('textbox', { name: 'Recruiter notes' })
    await user.type(box, ' Draft.')

    await user.click(tab('Timeline'))
    await user.click(tab('Notes & Feedback'))
    expect(within(panel()).getByRole('textbox', { name: 'Recruiter notes' })).toHaveValue('Strong on systems. Draft.')
    expect(api.get).toHaveBeenCalledTimes(1)
  })
})

describe('notes: not an admin', () => {
  beforeEach(() => { useAuthStore.setState({ token: 'tok', user: STANDARD }) })

  it('shows the notes read-only with a message, and no editor or save button', async () => {
    renderDrawer({ initialTab: 'notes' })
    expect(await within(panel()).findByText('Strong on systems.')).toBeInTheDocument()
    expect(within(panel()).getAllByText('Only admins can edit notes.').length).toBeGreaterThan(0)
    expect(within(panel()).queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(panel()).queryByRole('button', { name: 'Save notes' })).not.toBeInTheDocument()
    expect(api.updateNotes).not.toHaveBeenCalled()
  })

  it('says so when there are no notes yet', async () => {
    api.get.mockResolvedValue({ data: { ...CANDIDATE, recruiter_notes: '' } })
    renderDrawer({ initialTab: 'notes' })
    expect(await within(panel()).findByText('No notes yet.')).toBeInTheDocument()
  })

  it('never asks for reviewer feedback and shows no such section', async () => {
    renderDrawer({ initialTab: 'notes' })
    await within(panel()).findByText('Strong on systems.')
    expect(api.sharesList).not.toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: 'Reviewer feedback' })).not.toBeInTheDocument()
  })

  it('still opens the timeline and the jobs tab', async () => {
    const user = renderDrawer()
    expect(await within(panel()).findByText('Data Engineer')).toBeInTheDocument()
    await user.click(tab('Jobs & Offers'))
    expect(await within(panel()).findByText(/120000/)).toBeInTheDocument()
  })
})

describe('reviewer feedback', () => {
  it('lists feedback from every share link, newest first, with rating and comment', async () => {
    renderDrawer({ initialTab: 'notes' })
    const region = await screen.findByRole('region', { name: 'Reviewer feedback' })
    const items = await within(region).findAllByRole('listitem')

    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Anonymous reviewer')
    expect(items[0]).toHaveTextContent('Needs a follow-up on system design.')
    expect(within(items[0]).queryByRole('img')).not.toBeInTheDocument()
    expect(items[1]).toHaveTextContent('Jane Hiring Manager')
    expect(items[1]).toHaveTextContent('Strong technically.')
    expect(within(items[1]).getByRole('img', { name: '4 out of 5 stars' })).toBeInTheDocument()
  })

  it('says so when no reviewer has left any', async () => {
    api.sharesList.mockResolvedValue({ data: { shares: [{ share_id: 's1', feedback: [] }] } })
    renderDrawer({ initialTab: 'notes' })
    expect(await within(panel()).findByText('No reviewer feedback yet.')).toBeInTheDocument()
  })

  it.each([403, 404])('hides the section silently on a %s and leaves the rest of the tab alone', async status => {
    api.sharesList.mockRejectedValue(denied(status))
    renderDrawer({ initialTab: 'notes' })

    expect(await within(panel()).findByRole('textbox', { name: 'Recruiter notes' })).toBeInTheDocument()
    await waitFor(() => expect(api.sharesList).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Reviewer feedback' })).not.toBeInTheDocument())
    expect(within(panel()).queryByText('Reviewer feedback')).not.toBeInTheDocument()
    expect(within(panel()).queryByRole('alert')).not.toBeInTheDocument()
    expect(await within(panel()).findByRole('textbox', { name: 'Notes about this person' })).toBeInTheDocument()
  })

  it('shows an inline error with Retry for any other failure, and the notes still work', async () => {
    api.sharesList.mockRejectedValueOnce(denied(500))
    const user = renderDrawer({ initialTab: 'notes' })

    const region = await screen.findByRole('region', { name: 'Reviewer feedback' })
    expect(await within(region).findByRole('alert')).toHaveTextContent('Could not load reviewer feedback.')
    expect(within(panel()).getByRole('textbox', { name: 'Recruiter notes' })).toBeInTheDocument()

    await user.click(within(region).getByRole('button', { name: 'Retry' }))
    expect(await within(region).findByText('Strong technically.')).toBeInTheDocument()
  })

  it('is not requested, and not shown, when the candidate has no interview token', async () => {
    renderDrawer({ initialTab: 'notes', secureToken: undefined })
    await within(panel()).findByRole('textbox', { name: 'Recruiter notes' })
    expect(api.sharesList).not.toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: 'Reviewer feedback' })).not.toBeInTheDocument()
  })
})

describe('jobs and offers tab', () => {
  it('lists other jobs once each, newest first, marking the job the drawer was opened from', async () => {
    api.getTimeline.mockResolvedValue({
      data: {
        timeline: [
          ...TIMELINE,
          { candidate_id: 'c4', job_id: 'job_a', job_title: 'Data Engineer', status: 'hired', created_at: '2026-02-01T10:00:00Z' },
          { candidate_id: 'c5', job_id: 'job_1', job_title: 'Backend Engineer', status: 'invited', created_at: '2026-02-15T10:00:00Z' },
        ],
      },
    })
    renderDrawer({ initialTab: 'jobs' })

    const region = await screen.findByRole('region', { name: 'Other jobs applied to' })
    const items = await within(region).findAllByRole('listitem')
    expect(items.map(i => i.querySelector('.chd-row-title')?.textContent)).toEqual([
      'Platform Engineer',
      'Backend EngineerThis job',
      'Data Engineer',
    ])
    expect(items[2]).toHaveTextContent('hired')
    expect(items[2]).not.toHaveTextContent('rejected')
  })

  it('lists the offers read-only with their status, and labels the one for this job', async () => {
    renderDrawer({ initialTab: 'jobs' })
    await within(await screen.findByRole('region', { name: 'Other jobs applied to' })).findAllByRole('listitem')
    const region = await screen.findByRole('region', { name: 'Offers' })
    const items = await within(region).findAllByRole('listitem')

    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('This job')
    expect(items[0]).toHaveTextContent('pending approval')
    expect(items[0]).toHaveTextContent('Salary 120000')
    expect(items[0]).toHaveTextContent(/Joining/)
    expect(items[1]).toHaveTextContent('Data Engineer')
    expect(items[1]).toHaveTextContent('declined')
    expect(within(region).queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('shows an empty state for each list', async () => {
    api.getTimeline.mockResolvedValue({ data: { timeline: [] } })
    api.offersList.mockResolvedValue({ data: { offers: [] } })
    renderDrawer({ initialTab: 'jobs' })
    expect(await within(panel()).findByText('This person has not applied to any other job.')).toBeInTheDocument()
    expect(await within(panel()).findByText('No offers have been made to this candidate.')).toBeInTheDocument()
  })

  it('hands off to the offers screen', async () => {
    const user = renderDrawer({ initialTab: 'jobs' })
    await user.click(await within(panel()).findByRole('button', { name: 'Open offers' }))
    expect(onOpenOffers).toHaveBeenCalledTimes(1)
  })

  it('offers no hand-off when none is wired', async () => {
    renderDrawer({ initialTab: 'jobs', onOpenOffers: undefined })
    await within(panel()).findByText(/120000/)
    expect(within(panel()).queryByRole('button', { name: 'Open offers' })).not.toBeInTheDocument()
  })
})

describe('an erased person', () => {
  it('is titled Erased candidate, says so, and fetches nothing', async () => {
    renderDrawer({ erased: true })

    const dialog = screen.getByRole('dialog', { name: /Erased candidate/ })
    expect(within(dialog).getByRole('heading', { name: 'Erased candidate' })).toBeInTheDocument()
    expect(within(dialog).queryByText('Ada Lovelace')).not.toBeInTheDocument()
    expect(within(dialog).getByText(/personal data has been erased/)).toBeInTheDocument()
    expect(within(dialog).queryByRole('tablist')).not.toBeInTheDocument()
    await Promise.resolve()
    expect(api.getTimeline).not.toHaveBeenCalled()
    expect(api.get).not.toHaveBeenCalled()
    expect(api.offersList).not.toHaveBeenCalled()
  })

  it('shows the same in place of the notes when the record turns out to be a tombstone', async () => {
    api.get.mockResolvedValue({ data: { candidate_id: 'cand_1', erased: true, erased_at: '2026-10-01T10:00:00Z' } })
    const user = renderDrawer()
    await within(panel()).findByText('Data Engineer')
    await user.click(tab('Notes & Feedback'))

    expect(await within(panel()).findByText(/personal data has been erased/)).toBeInTheDocument()
    expect(within(panel()).queryByRole('textbox')).not.toBeInTheDocument()
    expect(api.getProfileByEmail).not.toHaveBeenCalled()
    expect(screen.queryByText('Reviewer feedback')).not.toBeInTheDocument()
  })

  it('marks an application of an erased person in the timeline without crashing on the missing fields', async () => {
    api.getTimeline.mockResolvedValue({ data: { timeline: [{ candidate_id: 'c9', erased: true, status: 'rejected', created_at: '2026-01-10T10:00:00Z' }] } })
    renderDrawer()
    const item = (await within(panel()).findByText('Erased candidate')).closest('li')!
    expect(item).toHaveClass('chd-erased')
    expect(item).toHaveTextContent('rejected')
  })
})

describe('copy', () => {
  const banned = /\bwh[y]\b/i

  it('uses the banned word nowhere in the source or the styles', () => {
    expect(drawerTsx.match(banned), 'CandidateHistoryDrawer.tsx').toBeNull()
    expect(drawerCss.match(banned), 'CandidateHistoryDrawer.css').toBeNull()
  })

  it('renders none of it on any tab, including every state a request can land in', async () => {
    api.getProfileByEmail.mockResolvedValue({ data: PROFILE })
    const user = renderDrawer()
    await within(panel()).findByText('Data Engineer')
    await user.click(tab('Notes & Feedback'))
    await within(panel()).findByText('Strong technically.')
    await user.click(tab('Jobs & Offers'))
    await within(panel()).findByText(/120000/)

    expect(document.body.textContent ?? '').not.toMatch(banned)
    expect(document.body.innerHTML).not.toMatch(banned)
  })
})
