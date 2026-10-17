import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { platformApi } from '../../lib/api'
import type { ClientRow, EntityStatus } from '../../lib/platformTypes'
import { INVITE_NOT_SENT } from './CompanyDialogs'
import NewClientModal from './NewClientModal'
import { AsOf, EmptyState, ErrorState, LoadingState, SortHeader, StatusBadge, useToast } from './PlatformUi'
import { fmtInt, fmtMb, fmtUsd, fmtWhen } from './format'
import { nextSort, sortRows, type SortState } from './tableSort'
import { useArrivalNotice, useForceRefresh, useLoaded } from './usePlatformData'
import './PlatformClientsPage.css'

const activityOf = (c: ClientRow) => Object.values(c.usage ?? {}).reduce((sum, n) => sum + n, 0)

function valueOf(c: ClientRow, key: string): number | string | null {
  switch (key) {
    case 'name': return c.name
    case 'status': return c.status
    case 'companies': return c.companies
    case 'users': return c.users
    case 'activity': return activityOf(c)
    case 'spend': return c.total_cost_usd
    case 'storage': return c.storage_mb ?? null
    case 'last_active': return c.last_active_at ? new Date(c.last_active_at).getTime() : null
    case 'top_feature': return c.top_feature?.label ?? null
    default: return null
  }
}

export default function PlatformClientsPage() {
  const navigate = useNavigate()
  const { toast, showToast } = useToast()
  useArrivalNotice(showToast)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'' | EntityStatus>('')
  const [sort, setSort] = useState<SortState | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 250)
    return () => clearTimeout(t)
  }, [search])

  const { take, mark } = useForceRefresh()
  const { data: list, loading, error, reload } = useLoaded(
    () => {
      const params = { ...(query ? { search: query } : {}), ...(status ? { status } : {}) }
      const args = Object.keys(params).length > 0 ? params : undefined
      const fresh = take()
      return (fresh ? platformApi.listClients(args, fresh) : platformApi.listClients(args)).then(r => r.data)
    },
    [query, status],
    'Could not load the clients.',
  )
  const data = list ? list.clients : null

  const rows = useMemo(() => sortRows(data ?? [], sort, valueOf), [data, sort])
  const filtered = query !== '' || status !== ''

  const onSort = (key: string, numeric: boolean) => setSort(current => nextSort(current, key, numeric))

  function open(e: React.MouseEvent, clientId: string) {
    if ((e.target as HTMLElement).closest('a, button')) return
    navigate(`/platform/clients/${encodeURIComponent(clientId)}`)
  }

  return (
    <div className="pco-page" aria-busy={loading}>
      {toast}
      <div className="pco-header">
        <div className="pco-header-actions">
          <h1 className="pco-title">Clients</h1>
          {data && <span className="pco-count">{fmtInt(data.length)} {data.length === 1 ? 'client' : 'clients'}</span>}
        </div>
        <div className="pco-header-actions">
          <AsOf at={list?.computed_at} loading={loading} onRefresh={() => { mark(); reload() }} />
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>New client</button>
        </div>
      </div>

      <section className="pco-card">
        <div className="pco-filters">
          <input
            className="form-input pco-search"
            type="search"
            placeholder="Search clients"
            aria-label="Search clients"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select
            className="form-input pco-select"
            aria-label="Filter by status"
            value={status}
            onChange={e => setStatus(e.target.value as '' | EntityStatus)}
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>

        {!data && loading && <LoadingState label="Loading the clients…" />}
        {!data && !loading && error && <ErrorState message={error} onRetry={reload} />}
        {data && error && <ErrorState message={error} onRetry={reload} />}

        {data && data.length === 0 && (
          <EmptyState>{filtered ? 'No clients match these filters.' : 'No clients yet. Create the first one.'}</EmptyState>
        )}

        {data && data.length > 0 && (
          <div className="pco-table-wrap">
            <table className="pco-table pco-clients-table">
              <thead>
                <tr>
                  <SortHeader label="Client" sortKey="name" sort={sort} onSort={onSort} />
                  <SortHeader label="Status" sortKey="status" sort={sort} onSort={onSort} />
                  <SortHeader label="Companies" sortKey="companies" numeric sort={sort} onSort={onSort} />
                  <SortHeader label="Users" sortKey="users" numeric sort={sort} onSort={onSort} />
                  <SortHeader label="Activity" sortKey="activity" numeric sort={sort} onSort={onSort} />
                  <SortHeader label="Total cost" sortKey="spend" numeric sort={sort} onSort={onSort} />
                  <SortHeader label="Storage" sortKey="storage" numeric sort={sort} onSort={onSort} />
                  <SortHeader label="Last active" sortKey="last_active" numeric sort={sort} onSort={onSort} />
                  <SortHeader label="Top feature" sortKey="top_feature" sort={sort} onSort={onSort} />
                </tr>
              </thead>
              <tbody>
                {rows.map(c => (
                  <tr key={c.client_id} className="pco-row-link" onClick={e => open(e, c.client_id)}>
                    <th scope="row">
                      <Link to={`/platform/clients/${encodeURIComponent(c.client_id)}`} className="pco-name">{c.name}</Link>
                      <span className="pco-cell-meta">{c.contact_email || c.slug}</span>
                    </th>
                    <td>
                      <StatusBadge status={c.status} />
                      {c.status !== 'active' && c.suspended_reason && (
                        <span className="pco-cell-meta pco-reason">{c.suspended_reason}</span>
                      )}
                    </td>
                    <td className="pco-num">{fmtInt(c.companies)}</td>
                    <td className="pco-num">{fmtInt(c.users)}</td>
                    <td className="pco-num">{fmtInt(activityOf(c))}</td>
                    <td className="pco-num">{fmtUsd(c.total_cost_usd)}</td>
                    <td className="pco-num">
                      {fmtMb(c.storage_mb)}
                      {c.storage_mb != null && (
                        <span className="pco-cell-meta">{c.storage_limit_mb == null ? 'No cap' : `Cap ${fmtMb(c.storage_limit_mb)} each`}</span>
                      )}
                    </td>
                    <td className="pco-num">{fmtWhen(c.last_active_at)}</td>
                    <td>
                      {c.top_feature
                        ? <span className="pco-chip">{c.top_feature.label}<b>{fmtInt(c.top_feature.count)}</b></span>
                        : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {creating && (
        <NewClientModal
          onClose={() => setCreating(false)}
          onCreated={(client, invitation) => {
            setCreating(false)
            if (invitation === 'not_sent') showToast(INVITE_NOT_SENT, 'warn')
            else showToast(invitation === 'sent' ? `Client ${client.name} created, invitation sent` : `Client ${client.name} created`)
            reload()
          }}
        />
      )}
    </div>
  )
}
