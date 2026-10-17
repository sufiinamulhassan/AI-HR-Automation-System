import { useCallback, useEffect, useRef, useState } from 'react'
import { platformApi } from '../../lib/api'
import { CONTACT_TOPICS, type ContactTopic } from '../../lib/site'
import type { ContactRequest, ContactRequestList, ContactRequestStatus } from '../../lib/siteTypes'
import { EmptyState, ErrorState, LoadingState } from './PlatformUi'
import { errorDetail, fmtWhen } from './format'
import './PlatformInboxPage.css'

const PAGE_SIZE = 20
const SEARCH_DELAY_MS = 300

const STATUS_LABEL: Record<ContactRequestStatus, string> = {
  new: 'New',
  in_progress: 'In progress',
  done: 'Done',
  spam: 'Spam',
}

const STATUS_ORDER: ContactRequestStatus[] = ['new', 'in_progress', 'done', 'spam']

const topicLabel = (topic: string) => CONTACT_TOPICS.find(t => t.value === topic)?.label ?? topic

interface ItemProps {
  item: ContactRequest
  onChange: () => void
}

function InboxItem({ item, onChange }: ItemProps) {
  const [note, setNote] = useState(item.note)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [failure, setFailure] = useState('')

  useEffect(() => setNote(item.note), [item.note])

  async function run(work: () => Promise<unknown>, fallback: string) {
    setBusy(true)
    setFailure('')
    try {
      await work()
      onChange()
    } catch (e) {
      setFailure(errorDetail(e, fallback))
    } finally {
      setBusy(false)
    }
  }

  const noteChanged = note.trim() !== item.note

  return (
    <li className="pco-inbox-item">
      <div className="pco-inbox-head">
        <div className="pco-inbox-who">
          <span className="pco-name">{item.name}</span>
          <a href={`mailto:${item.email}`} className="pco-inbox-email">{item.email}</a>
          {item.company && <span className="pco-cell-meta">{item.company}</span>}
        </div>
        <div className="pco-inbox-meta">
          <span className="pco-chip">{topicLabel(item.topic)}</span>
          <time dateTime={item.created_at} title={item.created_at}>{fmtWhen(item.created_at)}</time>
        </div>
      </div>

      <p className="pco-inbox-message">{item.message}</p>

      <div className="pco-inbox-controls">
        <label className="pco-inbox-field">
          <span>Status</span>
          <select
            className="form-input pco-select"
            value={item.status}
            disabled={busy}
            onChange={e => run(
              () => platformApi.updateContactRequest(item.request_id, { status: e.target.value as ContactRequestStatus }),
              'Could not change the status.',
            )}
          >
            {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>

        <label className="pco-inbox-field pco-inbox-note">
          <span>Internal note</span>
          <textarea
            className="form-input"
            rows={2}
            maxLength={1000}
            value={note}
            disabled={busy}
            onChange={e => setNote(e.target.value)}
          />
        </label>

        <div className="pco-inbox-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy || !noteChanged}
            onClick={() => run(() => platformApi.updateContactRequest(item.request_id, { note: note.trim() }), 'Could not save the note.')}
          >
            Save note
          </button>
          {confirming ? (
            <>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={busy}
                onClick={() => run(() => platformApi.deleteContactRequest(item.request_id), 'Could not delete the message.')}
              >
                Confirm delete
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>Cancel</button>
            </>
          ) : (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setConfirming(true)}>Delete</button>
          )}
        </div>
      </div>

      {item.handled_by && <p className="pco-hint">Last handled by {item.handled_by}</p>}
      {failure && <p className="pco-field-error" role="alert">{failure}</p>}
    </li>
  )
}

export default function PlatformInboxPage() {
  const [status, setStatus] = useState<'' | ContactRequestStatus>('')
  const [topic, setTopic] = useState<'' | ContactTopic>('')
  const [search, setSearch] = useState('')
  const [term, setTerm] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<ContactRequestList | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [failure, setFailure] = useState('')
  const latest = useRef(0)

  useEffect(() => {
    const timer = setTimeout(() => {
      setTerm(search.trim())
      setPage(1)
    }, SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [search])

  const load = useCallback(() => {
    const id = ++latest.current
    platformApi.contactRequests({
      status: status || undefined, topic: topic || undefined, q: term || undefined, page, limit: PAGE_SIZE,
    })
      .then(r => {
        if (id !== latest.current) return
        setData(r.data)
        setState('ready')
      })
      .catch(e => {
        if (id !== latest.current) return
        setFailure(errorDetail(e, 'Could not load the inbox.'))
        setState('error')
      })
  }, [status, topic, term, page])

  useEffect(() => {
    load()
    return () => { latest.current += 1 }
  }, [load])

  function pick(next: '' | ContactRequestStatus) {
    setStatus(next)
    setPage(1)
  }

  const counts = data?.counts
  const all = counts ? STATUS_ORDER.reduce((sum, s) => sum + counts[s], 0) : 0

  return (
    <div className="pco-page" aria-busy={state === 'loading'}>
      <div className="pco-header">
        <h1 className="pco-title">Inbox</h1>
      </div>

      <section className="pco-card">
        <div className="pco-inbox-tabs" role="group" aria-label="Filter by status">
          <button type="button" className="pco-inbox-tab" aria-pressed={status === ''} onClick={() => pick('')}>
            All {counts && <b>{all}</b>}
          </button>
          {STATUS_ORDER.map(s => (
            <button key={s} type="button" className="pco-inbox-tab" aria-pressed={status === s} onClick={() => pick(s)}>
              {STATUS_LABEL[s]} {counts && <b>{counts[s]}</b>}
            </button>
          ))}
        </div>

        <div className="pco-filters">
          <input
            className="form-input pco-search"
            type="search"
            placeholder="Search name, email, company or message"
            aria-label="Search messages"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select
            className="form-input pco-select"
            aria-label="Filter by topic"
            value={topic}
            onChange={e => { setTopic(e.target.value as '' | ContactTopic); setPage(1) }}
          >
            <option value="">All topics</option>
            {CONTACT_TOPICS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>

        {state === 'loading' && <LoadingState label="Loading messages…" />}
        {state === 'error' && <ErrorState message={failure} onRetry={load} />}
        {state === 'ready' && data && data.items.length === 0 && (
          <EmptyState>{status || topic || term ? 'No messages match these filters.' : 'No messages yet.'}</EmptyState>
        )}

        {state === 'ready' && data && data.items.length > 0 && (
          <>
            <ul className="pco-inbox-list">
              {data.items.map(item => <InboxItem key={item.request_id} item={item} onChange={load} />)}
            </ul>
            {data.pages > 1 && (
              <div className="pco-inbox-pager">
                <button type="button" className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
                <span>Page {data.page} of {data.pages}</span>
                <button type="button" className="btn btn-ghost btn-sm" disabled={page >= data.pages} onClick={() => setPage(p => p + 1)}>Next</button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}
