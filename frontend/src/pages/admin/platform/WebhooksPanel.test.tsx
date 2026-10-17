import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const list = vi.fn()
const create = vi.fn()
const update = vi.fn()
const remove = vi.fn()
const test = vi.fn()
const eventTypes = vi.fn()
const deliveries = vi.fn()

vi.mock('../../../lib/api', () => ({
  webhooksApi: {
    list: (...a: unknown[]) => list(...a),
    create: (...a: unknown[]) => create(...a),
    update: (...a: unknown[]) => update(...a),
    delete: (...a: unknown[]) => remove(...a),
    test: (...a: unknown[]) => test(...a),
    eventTypes: (...a: unknown[]) => eventTypes(...a),
    deliveries: (...a: unknown[]) => deliveries(...a),
  },
}))

const { default: WebhooksPanel } = await import('./WebhooksPanel')

const showToast = vi.fn()

function renderPanel() {
  return render(<WebhooksPanel showToast={showToast} />)
}

function httpError(status: number, detail: unknown) {
  return { response: { status, data: { detail } } }
}

const WITH_SECRET = {
  webhook_id: 'w1', url: 'https://hooks.acme.test/a', event_types: ['candidate_invited'],
  is_active: true, format: 'raw', has_secret: true,
}
const WITHOUT_SECRET = {
  webhook_id: 'w2', url: 'https://hooks.acme.test/b', event_types: ['interview_completed'],
  is_active: true, format: 'slack', has_secret: false,
}

const EVENT_TYPES = [
  { key: 'candidate_invited', label: 'Candidate invited' },
  { key: 'interview_completed', label: 'Interview completed' },
  { key: 'offer_created', label: 'Offer created' },
]

beforeEach(() => {
  list.mockReset().mockResolvedValue({ data: { webhooks: [WITH_SECRET, WITHOUT_SECRET] } })
  create.mockReset().mockResolvedValue({ data: {} })
  update.mockReset().mockResolvedValue({ data: {} })
  remove.mockReset()
  test.mockReset()
  eventTypes.mockReset().mockResolvedValue({ data: { event_types: EVENT_TYPES } })
  deliveries.mockReset().mockResolvedValue({ data: [] })
  showToast.mockReset()
})

describe('webhook list', () => {
  it('marks only the webhooks that have a secret, and never shows one', async () => {
    renderPanel()

    const withSecret = (await screen.findByText(WITH_SECRET.url)).closest('tr') as HTMLElement
    const without = screen.getByText(WITHOUT_SECRET.url).closest('tr') as HTMLElement
    expect(within(withSecret).getByText('Secret set')).toBeInTheDocument()
    expect(within(without).queryByText('Secret set')).not.toBeInTheDocument()
  })

  it('shows the empty state for a list that loaded and is genuinely empty', async () => {
    list.mockResolvedValue({ data: { webhooks: [] } })
    renderPanel()

    expect(await screen.findByText('No webhooks configured yet.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows an error with Retry, not the empty state, when the list cannot be loaded', async () => {
    const user = userEvent.setup()
    list.mockRejectedValueOnce(httpError(500, 'Webhook store unavailable'))
    renderPanel()

    expect(await screen.findByRole('alert')).toHaveTextContent('Webhook store unavailable')
    expect(screen.queryByText('No webhooks configured yet.')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText(WITH_SECRET.url)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('falls back to a generic message when the failure carries no detail', async () => {
    list.mockRejectedValue(new Error('Network Error'))
    renderPanel()

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load webhooks.')
  })
})

describe('signing secret', () => {
  async function openCreate(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: '+ Add Webhook' }))
  }

  async function openEdit(user: ReturnType<typeof userEvent.setup>, url: string) {
    const row = (await screen.findByText(url)).closest('tr') as HTMLElement
    await user.click(within(row).getByRole('button', { name: 'Edit' }))
  }

  async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText('URL *'), 'https://hooks.acme.test/new')
    const group = await screen.findByRole('group', { name: /Event Types/ })
    await user.click(await within(group).findByRole('checkbox', { name: 'Candidate invited' }))
  }

  it('is optional on create and masked as it is typed', async () => {
    const user = userEvent.setup()
    renderPanel()
    await openCreate(user)

    const field = screen.getByLabelText('Signing secret')
    expect(field).toHaveAttribute('type', 'password')
    expect(field).toHaveValue('')
    expect(within(document.querySelector('.modal-box') as HTMLElement).queryByText('Secret set')).not.toBeInTheDocument()
  })

  it('creates without a secret key when the field is left empty', async () => {
    const user = userEvent.setup()
    renderPanel()
    await openCreate(user)
    await fillRequired(user)
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0][0]).not.toHaveProperty('secret')
  })

  it('sends the typed secret on create', async () => {
    const user = userEvent.setup()
    renderPanel()
    await openCreate(user)
    await fillRequired(user)
    await user.type(screen.getByLabelText('Signing secret'), 's3cret-value')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://hooks.acme.test/new', secret: 's3cret-value',
    })))
  })

  it('on edit shows that one is set, but starts empty and never reveals the value', async () => {
    const user = userEvent.setup()
    renderPanel()
    await openEdit(user, WITH_SECRET.url)

    const modal = within(document.querySelector('.modal-box') as HTMLElement)
    expect(modal.getByText('Secret set')).toBeInTheDocument()
    const field = modal.getByLabelText('Signing secret')
    expect(field).toHaveValue('')
    expect(field).toHaveAttribute('placeholder', 'Leave empty to keep the current secret')
  })

  it('keeps the stored secret when the field is left empty on edit', async () => {
    const user = userEvent.setup()
    renderPanel()
    await openEdit(user, WITH_SECRET.url)
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0][0]).toBe('w1')
    expect(update.mock.calls[0][1]).not.toHaveProperty('secret')
  })

  it('replaces the secret when a new one is typed on edit', async () => {
    const user = userEvent.setup()
    renderPanel()
    await openEdit(user, WITH_SECRET.url)
    await user.type(screen.getByLabelText('Signing secret'), 'rotated')
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(update).toHaveBeenCalledWith('w1', expect.objectContaining({ secret: 'rotated' })))
  })

  it('offers to set one on a webhook that has none', async () => {
    const user = userEvent.setup()
    renderPanel()
    await openEdit(user, WITHOUT_SECRET.url)

    const modal = within(document.querySelector('.modal-box') as HTMLElement)
    expect(modal.queryByText('Secret set')).not.toBeInTheDocument()
    expect(modal.getByLabelText('Signing secret')).toHaveAttribute('placeholder', 'Optional')
  })

  it('does not carry a typed secret into the next form that is opened', async () => {
    const user = userEvent.setup()
    renderPanel()
    await openEdit(user, WITH_SECRET.url)
    await user.type(screen.getByLabelText('Signing secret'), 'half-typed')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await openEdit(user, WITHOUT_SECRET.url)
    expect(screen.getByLabelText('Signing secret')).toHaveValue('')
  })

  it('shows the server detail when a save is rejected, and a plain message for a 422 list', async () => {
    const user = userEvent.setup()
    update.mockRejectedValueOnce(httpError(400, 'Secret is too short'))
    renderPanel()
    await openEdit(user, WITH_SECRET.url)
    await user.type(screen.getByLabelText('Signing secret'), 'x')
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Secret is too short'))

    update.mockRejectedValueOnce(httpError(422, [{ msg: 'bad' }]))
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Failed to save webhook'))
  })
})

const LEGACY = {
  webhook_id: 'w3', url: 'https://hooks.acme.test/legacy',
  event_types: ['candidate_invited', 'resume_processed'],
  is_active: true, format: 'raw', has_secret: false,
}

function rowFor(url: string) {
  return screen.getByText(url).closest('tr') as HTMLElement
}

describe('event types', () => {
  async function openCreate(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: '+ Add Webhook' }))
    const group = await screen.findByRole('group', { name: /Event Types/ })
    await within(group).findByRole('checkbox', { name: 'Offer created' })
    return group
  }

  async function openEdit(user: ReturnType<typeof userEvent.setup>, url: string) {
    await screen.findByText(url)
    await user.click(within(rowFor(url)).getByRole('button', { name: 'Edit' }))
    const group = await screen.findByRole('group', { name: /Event Types/ })
    await within(group).findByRole('checkbox', { name: 'Offer created' })
    return group
  }

  it('offers the catalog as a checklist and creates with the keys that were ticked', async () => {
    const user = userEvent.setup()
    renderPanel()
    const group = await openCreate(user)

    expect(within(group).getAllByRole('checkbox').map(c => c.parentElement?.textContent))
      .toEqual(['All events', 'Candidate invited', 'Interview completed', 'Offer created'])
    await user.type(screen.getByLabelText('URL *'), 'https://hooks.acme.test/new')
    await user.click(within(group).getByRole('checkbox', { name: 'Interview completed' }))
    await user.click(within(group).getByRole('checkbox', { name: 'Offer created' }))
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0][0]).toMatchObject({ event_types: ['interview_completed', 'offer_created'] })
  })

  it('keeps Create disabled until at least one event is chosen', async () => {
    const user = userEvent.setup()
    renderPanel()
    const group = await openCreate(user)
    await user.type(screen.getByLabelText('URL *'), 'https://hooks.acme.test/new')

    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
    await user.click(within(group).getByRole('checkbox', { name: 'Offer created' }))
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled()
  })

  it('"All events" ticks every entry in the catalog and clears them again', async () => {
    const user = userEvent.setup()
    renderPanel()
    const group = await openCreate(user)
    const all = within(group).getByRole('checkbox', { name: 'All events' })

    await user.click(all)
    for (const t of EVENT_TYPES) {
      expect(within(group).getByRole('checkbox', { name: t.label })).toBeChecked()
    }
    expect(all).toBeChecked()

    await user.click(within(group).getByRole('checkbox', { name: 'Offer created' }))
    expect(all).not.toBeChecked()

    await user.click(all)
    expect(within(group).getByRole('checkbox', { name: 'Offer created' })).toBeChecked()
    await user.click(all)
    for (const t of EVENT_TYPES) {
      expect(within(group).getByRole('checkbox', { name: t.label })).not.toBeChecked()
    }
  })

  it('shows catalog labels, not raw keys, in the list', async () => {
    renderPanel()

    const row = await screen.findByText(WITH_SECRET.url).then(el => el.closest('tr') as HTMLElement)
    expect(await within(row).findByText('Candidate invited')).toBeInTheDocument()
    expect(within(row).queryByText('candidate_invited')).not.toBeInTheDocument()
  })

  it('flags a legacy name that is not in the catalog, in the list and in the form', async () => {
    const user = userEvent.setup()
    list.mockResolvedValue({ data: { webhooks: [LEGACY] } })
    renderPanel()

    const flagged = await screen.findByText('resume_processed')
    expect(flagged).toHaveAttribute('title', 'Unknown event type')
    expect(screen.getByText('Candidate invited')).not.toHaveAttribute('title')

    const group = await openEdit(user, LEGACY.url)
    expect(within(group).getByText('resume_processed')).toBeInTheDocument()
    expect(within(group).getByText('Unknown')).toBeInTheDocument()
    expect(within(group).getByRole('checkbox', { name: 'Candidate invited' })).toBeChecked()
  })

  it('removes a legacy name with its chip and saves without it', async () => {
    const user = userEvent.setup()
    list.mockResolvedValue({ data: { webhooks: [LEGACY] } })
    renderPanel()
    const group = await openEdit(user, LEGACY.url)

    await user.click(within(group).getByRole('button', { name: 'Remove resume_processed' }))
    expect(within(group).queryByText('resume_processed')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0][1]).toMatchObject({ event_types: ['candidate_invited'] })
  })

  it('shows a 422 detail inline in the form, keeps it open and keeps Save usable', async () => {
    const user = userEvent.setup()
    list.mockResolvedValue({ data: { webhooks: [LEGACY] } })
    update.mockRejectedValueOnce(httpError(422, 'Unknown event type(s): resume_processed'))
    renderPanel()
    await openEdit(user, LEGACY.url)
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    const modal = document.querySelector('.modal-box') as HTMLElement
    expect(await within(modal).findByRole('alert')).toHaveTextContent('Unknown event type(s): resume_processed')
    expect(showToast).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled()

    await user.click(within(modal).getByRole('button', { name: 'Remove resume_processed' }))
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(document.querySelector('.modal-box')).toBeNull())
  })

  it('says so, with Retry, when the catalog cannot be loaded', async () => {
    const user = userEvent.setup()
    eventTypes.mockRejectedValueOnce(httpError(500, 'Catalog unavailable'))
    renderPanel()
    await user.click(await screen.findByRole('button', { name: '+ Add Webhook' }))

    const modal = document.querySelector('.modal-box') as HTMLElement
    expect(await within(modal).findByRole('alert')).toHaveTextContent('Catalog unavailable')
    expect(within(modal).queryByText('Unknown')).not.toBeInTheDocument()

    await user.click(within(modal).getByRole('button', { name: 'Retry' }))
    expect(await within(modal).findByRole('checkbox', { name: 'Offer created' })).toBeInTheDocument()
    expect(eventTypes).toHaveBeenCalledTimes(2)
  })
})

describe('send test', () => {
  async function sendTest(user: ReturnType<typeof userEvent.setup>, url: string) {
    await screen.findByText(url)
    await user.click(within(rowFor(url)).getByRole('button', { name: 'Send test' }))
  }

  it('shows delivered, the HTTP status and the detail on that webhook only', async () => {
    const user = userEvent.setup()
    test.mockResolvedValue({ data: { delivered: true, http_status: 200, detail: 'Receiver answered 200' } })
    renderPanel()
    await sendTest(user, WITH_SECRET.url)

    const row = rowFor(WITH_SECRET.url)
    expect(await within(row).findByText('Delivered')).toBeInTheDocument()
    expect(within(row).getByText('HTTP 200')).toBeInTheDocument()
    expect(within(row).getByText('Receiver answered 200')).toBeInTheDocument()
    expect(test).toHaveBeenCalledWith('w1')
    expect(within(rowFor(WITHOUT_SECRET.url)).queryByText('Delivered')).not.toBeInTheDocument()
  })

  it('shows failed with the detail when the receiver did not take it', async () => {
    const user = userEvent.setup()
    test.mockResolvedValue({ data: { delivered: false, http_status: 503, detail: 'Receiver answered 503' } })
    renderPanel()
    await sendTest(user, WITH_SECRET.url)

    const row = rowFor(WITH_SECRET.url)
    expect(await within(row).findByText('Failed')).toBeInTheDocument()
    expect(within(row).getByText('HTTP 503')).toBeInTheDocument()
    expect(within(row).getByText('Receiver answered 503')).toBeInTheDocument()
  })

  it('omits the HTTP status when the request never got a response', async () => {
    const user = userEvent.setup()
    test.mockResolvedValue({ data: { delivered: false, http_status: null, detail: 'Connection refused' } })
    renderPanel()
    await sendTest(user, WITH_SECRET.url)

    const row = rowFor(WITH_SECRET.url)
    expect(await within(row).findByText('Connection refused')).toBeInTheDocument()
    expect(within(row).queryByText(/^HTTP/)).not.toBeInTheDocument()
  })

  it('reports a failed request as failed, with the server reason when there is one', async () => {
    const user = userEvent.setup()
    test.mockRejectedValue(httpError(404, 'Webhook not found'))
    renderPanel()
    await sendTest(user, WITH_SECRET.url)

    const row = rowFor(WITH_SECRET.url)
    expect(await within(row).findByText('Failed')).toBeInTheDocument()
    expect(within(row).getByText('Webhook not found')).toBeInTheDocument()
  })

  it('replaces the previous result when sent again', async () => {
    const user = userEvent.setup()
    test.mockResolvedValueOnce({ data: { delivered: false, http_status: 500, detail: 'First try failed' } })
    test.mockResolvedValueOnce({ data: { delivered: true, http_status: 204, detail: 'Second try worked' } })
    renderPanel()
    await sendTest(user, WITH_SECRET.url)
    await within(rowFor(WITH_SECRET.url)).findByText('First try failed')

    await user.click(within(rowFor(WITH_SECRET.url)).getByRole('button', { name: 'Send test' }))

    const row = rowFor(WITH_SECRET.url)
    expect(await within(row).findByText('Second try worked')).toBeInTheDocument()
    expect(within(row).queryByText('First try failed')).not.toBeInTheDocument()
  })
})

describe('deliveries', () => {
  const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()
  const makeRows = () => [
    {
      delivery_id: 'd1', event: 'candidate_invited', status: 'sent', http_status: 200,
      duration_ms: 120, error: null, created_at: minutesAgo(5),
    },
    {
      delivery_id: 'd2', event: 'offer_created', status: 'failed', http_status: 500,
      duration_ms: 3012, error: 'Receiver answered 500', created_at: minutesAgo(125),
    },
    {
      delivery_id: 'd3', event: 'legacy_event', status: 'failed', http_status: null,
      duration_ms: 10000, error: 'Timed out', created_at: minutesAgo(60 * 24 * 3),
    },
  ]
  let ROWS = makeRows()
  beforeEach(() => { ROWS = makeRows() })

  async function openDrawer(user: ReturnType<typeof userEvent.setup>, url: string) {
    await screen.findByText(url)
    await user.click(within(rowFor(url)).getByRole('button', { name: 'Deliveries' }))
    return screen.findByRole('dialog', { name: 'Deliveries' })
  }

  it('asks for the last 50 deliveries of that webhook and lists them', async () => {
    const user = userEvent.setup()
    deliveries.mockResolvedValue({ data: ROWS })
    renderPanel()
    const drawer = await openDrawer(user, WITH_SECRET.url)

    await within(drawer).findByText('Receiver answered 500')
    expect(deliveries).toHaveBeenCalledWith('w1', 50)

    const rows = within(drawer).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(3)

    const [sent, failed, noResponse] = rows
    expect(within(sent).getByText('Sent')).toBeInTheDocument()
    expect(within(sent).getByText('Candidate invited')).toBeInTheDocument()
    expect(within(sent).getByText('200')).toBeInTheDocument()
    expect(within(sent).getByText('120 ms')).toBeInTheDocument()
    expect(within(sent).getByText('5 min ago')).toBeInTheDocument()

    expect(within(failed).getByText('Failed')).toBeInTheDocument()
    expect(within(failed).getByText('Offer created')).toBeInTheDocument()
    expect(within(failed).getByText('500')).toBeInTheDocument()
    expect(within(failed).getByText('2 h ago')).toBeInTheDocument()

    expect(within(noResponse).getByText('legacy_event')).toBeInTheDocument()
    expect(within(noResponse).getByText('Timed out')).toBeInTheDocument()
    expect(within(noResponse).getByText('3 d ago')).toBeInTheDocument()
    expect(within(noResponse).getAllByText('-')).toHaveLength(1)
  })

  it('shows the empty state when there is no history', async () => {
    const user = userEvent.setup()
    renderPanel()
    const drawer = await openDrawer(user, WITH_SECRET.url)

    expect(await within(drawer).findByText('No deliveries yet.')).toBeInTheDocument()
  })

  it('shows the error, not the empty state, when the history cannot be read', async () => {
    const user = userEvent.setup()
    deliveries.mockRejectedValue(httpError(500, 'Delivery log unavailable'))
    renderPanel()
    const drawer = await openDrawer(user, WITH_SECRET.url)

    expect(await within(drawer).findByRole('alert')).toHaveTextContent('Delivery log unavailable')
    expect(within(drawer).queryByText('No deliveries yet.')).not.toBeInTheDocument()
  })

  it('Refresh reads the history again', async () => {
    const user = userEvent.setup()
    deliveries.mockResolvedValueOnce({ data: [ROWS[0]] })
    deliveries.mockResolvedValueOnce({ data: ROWS })
    renderPanel()
    const drawer = await openDrawer(user, WITH_SECRET.url)
    await waitFor(() => expect(within(drawer).getAllByRole('row')).toHaveLength(2))

    await user.click(within(drawer).getByRole('button', { name: 'Refresh' }))

    await waitFor(() => expect(within(drawer).getAllByRole('row')).toHaveLength(4))
    expect(deliveries).toHaveBeenCalledTimes(2)
  })

  it('closes from the close button and from Escape', async () => {
    const user = userEvent.setup()
    renderPanel()
    let drawer = await openDrawer(user, WITH_SECRET.url)

    await user.click(within(drawer).getByRole('button', { name: 'Close deliveries' }))
    expect(screen.queryByRole('dialog', { name: 'Deliveries' })).not.toBeInTheDocument()

    drawer = await openDrawer(user, WITHOUT_SECRET.url)
    expect(drawer).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Deliveries' })).not.toBeInTheDocument()
  })

  it('ignores a slow answer for a drawer that has since been closed and reopened', async () => {
    const user = userEvent.setup()
    let resolveFirst: (v: unknown) => void = () => {}
    deliveries.mockReturnValueOnce(new Promise(res => { resolveFirst = res }))
    deliveries.mockResolvedValueOnce({ data: [ROWS[1]] })
    renderPanel()
    let drawer = await openDrawer(user, WITH_SECRET.url)
    await user.click(within(drawer).getByRole('button', { name: 'Close deliveries' }))

    drawer = await openDrawer(user, WITHOUT_SECRET.url)
    await within(drawer).findByText('Receiver answered 500')
    resolveFirst({ data: [ROWS[0]] })

    await waitFor(() => expect(deliveries).toHaveBeenCalledTimes(2))
    expect(within(drawer).getAllByRole('row')).toHaveLength(2)
    expect(within(drawer).queryByText('5 min ago')).not.toBeInTheDocument()
  })
})
