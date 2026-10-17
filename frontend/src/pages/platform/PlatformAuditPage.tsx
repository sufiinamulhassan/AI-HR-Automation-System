import { useCallback, useEffect, useRef, useState } from 'react'
import { platformApi } from '../../lib/api'
import type { PlatformActivityRow } from '../../lib/platformTypes'
import { EmptyState, ErrorState, LoadingState } from './PlatformUi'
import { actionLabel, errorDetail, fmtWhen } from './format'
import './PlatformAuditPage.css'

const PAGE_SIZE = 50

function detailText(details: PlatformActivityRow['details']): string {
  if (!details) return ''
  return Object.entries(details)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
    .join(', ')
}

export default function PlatformAuditPage() {
  const [entries, setEntries] = useState<PlatformActivityRow[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [failure, setFailure] = useState('')
  const [older, setOlder] = useState<'idle' | 'loading' | 'error'>('idle')
  const [olderFailure, setOlderFailure] = useState('')
  const latest = useRef(0)

  const loadFirst = useCallback(() => {
    const id = ++latest.current
    setState('loading')
    setOlder('idle')
    platformApi.audit({ limit: PAGE_SIZE })
      .then(r => {
        if (id !== latest.current) return
        setEntries(r.data.entries ?? [])
        setCursor(r.data.next_before ?? null)
        setState('ready')
      })
      .catch(e => {
        if (id !== latest.current) return
        setFailure(errorDetail(e, 'Could not load the audit log.'))
        setState('error')
      })
  }, [])

  useEffect(() => {
    loadFirst()
    return () => { latest.current += 1 }
  }, [loadFirst])

  function loadOlder() {
    if (!cursor || older === 'loading') return
    const id = ++latest.current
    setOlder('loading')
    setOlderFailure('')
    platformApi.audit({ limit: PAGE_SIZE, before: cursor })
      .then(r => {
        if (id !== latest.current) return
        setEntries(current => [...current, ...(r.data.entries ?? [])])
        setCursor(r.data.next_before ?? null)
        setOlder('idle')
      })
      .catch(e => {
        if (id !== latest.current) return
        setOlderFailure(errorDetail(e, 'Could not load older entries.'))
        setOlder('error')
      })
  }

  return (
    <div className="pco-page" aria-busy={state === 'loading'}>
      <div className="pco-header">
        <h1 className="pco-title">Platform audit</h1>
      </div>

      <section className="pco-card">
        {state === 'loading' && <LoadingState label="Loading the audit log…" />}
        {state === 'error' && <ErrorState message={failure} onRetry={loadFirst} />}
        {state === 'ready' && entries.length === 0 && <EmptyState>Nothing has been recorded yet.</EmptyState>}

        {state === 'ready' && entries.length > 0 && (
          <>
            <div className="pco-table-wrap">
              <table className="pco-table">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Action</th>
                    <th scope="col">By</th>
                    <th scope="col">Resource</th>
                    <th scope="col">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((row, i) => (
                    <tr key={`${row.at}-${i}`}>
                      <td><time dateTime={row.at} title={row.at}>{fmtWhen(row.at)}</time></td>
                      <th scope="row"><span className="pco-name">{actionLabel(row.action)}</span></th>
                      <td className="pco-au-wrap">{row.actor_email || '-'}</td>
                      <td className="pco-au-wrap">{[row.resource_type, row.resource_id].filter(Boolean).join(' ') || '-'}</td>
                      <td className="pco-au-wrap">{detailText(row.details) || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {(cursor || older === 'error') && (
              <div className="pco-au-more">
                {older === 'error' && <span className="pco-field-error" role="alert">{olderFailure}</span>}
                <button type="button" className="btn btn-ghost btn-sm" onClick={loadOlder} disabled={older === 'loading'}>
                  {older === 'loading' ? 'Loading…' : 'Load older'}
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}
