import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { platformApi } from '../../lib/api'
import type { AiCompanyRow, AiKey, AiOverview } from '../../lib/platformTypes'
import { AiJobsTable, AiKeyCards, AiUsedTable, UsedChips } from './AiParts'
import { AsOf, EmptyState, ErrorState, LoadingState, PeriodRange, PeriodSelect, SortHeader } from './PlatformUi'
import { fmtInt, fmtUsd } from './format'
import { nextSort, sortRows, type SortState } from './tableSort'
import { useForceRefresh, useLoaded, usePlatformPeriod } from './usePlatformData'
import './PlatformAi.css'

export const OPEN_BY_DEFAULT = 5

export default function PlatformAiPage() {
  const [period, setPeriod] = usePlatformPeriod()
  const { take, mark } = useForceRefresh()
  const { data, loading, error, reload } = useLoaded(
    () => {
      const fresh = take()
      return (fresh ? platformApi.ai(period, fresh) : platformApi.ai(period)).then(r => r.data)
    },
    [period],
    'Could not load the AI models.',
  )

  return (
    <div className="pco-page" aria-busy={loading}>
      <div className="pco-header">
        <h1 className="pco-title">AI models and keys</h1>
        <div className="pco-header-actions">
          <PeriodSelect value={period} onChange={setPeriod} />
          <AsOf at={data?.computed_at} loading={loading} onRefresh={() => { mark(); reload() }} />
        </div>
      </div>
      {data && <PeriodRange period={data.period} />}

      {!data && loading && <LoadingState label="Loading the AI models…" />}
      {!data && !loading && error && <ErrorState message={error} onRetry={reload} />}
      {data && error && <ErrorState message={error} onRetry={reload} />}

      {data && (
        <>
          <AiKeyCards keys={data.keys} />
          <section className="pco-card" aria-labelledby="pai-companies">
            <div className="pco-card-head">
              <h2 className="pco-card-title" id="pai-companies">By company</h2>
              <span className="pco-count">{fmtInt(data.companies.length)} {data.companies.length === 1 ? 'company' : 'companies'}</span>
            </div>
            {data.companies.length === 0
              ? <EmptyState>No companies yet.</EmptyState>
              : <CompanyTable data={data} />}
          </section>
        </>
      )}
    </div>
  )
}

const spendOf = (row: AiCompanyRow, key: AiKey) => row.providers[key.id]?.cost_usd ?? 0

function CompanyTable({ data }: { data: AiOverview }) {
  const [sort, setSort] = useState<SortState | null>(null)
  const [chosen, setChosen] = useState<ReadonlySet<string> | null>(null)

  const rows = useMemo(
    () => sortRows(data.companies, sort, (row, key) => {
      if (key === 'name') return row.name
      if (key === 'default') return row.default_name
      if (key === 'custom') return row.custom_jobs
      if (key === 'cost') return row.cost_usd
      if (key.startsWith('key:')) return row.providers[key.slice(4)]?.cost_usd ?? 0
      return null
    }),
    [data.companies, sort],
  )

  const defaultOpen = useMemo<ReadonlySet<string>>(
    () => new Set(data.companies.length <= OPEN_BY_DEFAULT ? data.companies.map(c => c.company_id) : []),
    [data.companies],
  )
  const open = chosen ?? defaultOpen
  const allOpen = rows.every(r => open.has(r.company_id))

  const onSort = (key: string, numeric: boolean) => setSort(current => nextSort(current, key, numeric))
  const toggle = (id: string) => {
    const next = new Set(open)
    if (!next.delete(id)) next.add(id)
    setChosen(next)
  }
  const setAll = (on: boolean) => setChosen(new Set(on ? rows.map(r => r.company_id) : []))
  const columns = 5 + data.keys.length

  return (
    <>
      <div className="pai-toolbar">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAll(!allOpen)}>
          {allOpen ? 'Collapse all' : 'Expand all'}
        </button>
      </div>
      <div className="pco-table-wrap">
        <table className="pco-table pai-table" aria-label="Companies">
          <thead>
            <tr>
              <SortHeader label="Company" sortKey="name" sort={sort} onSort={onSort} />
              <SortHeader label="Default model" sortKey="default" sort={sort} onSort={onSort} />
              <SortHeader label="Jobs on own model" sortKey="custom" sort={sort} onSort={onSort} numeric />
              <th scope="col">Models used</th>
              {data.keys.map(k => (
                <SortHeader key={k.id} label={`${k.label} spend`} sortKey={`key:${k.id}`} sort={sort} onSort={onSort} numeric />
              ))}
              <SortHeader label="Total spend" sortKey="cost" sort={sort} onSort={onSort} numeric />
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const isOpen = open.has(row.company_id)
              const detailId = `pai-detail-${row.company_id}`
              return (
                <Fragment key={row.company_id}>
                  <tr className={isOpen ? 'pai-row-open' : undefined}>
                    <th scope="row">
                      <div className="pai-company">
                        <button
                          type="button"
                          className="pai-toggle"
                          aria-expanded={isOpen}
                          aria-controls={detailId}
                          aria-label={`${isOpen ? 'Hide' : 'Show'} the details of ${row.name}`}
                          onClick={() => toggle(row.company_id)}
                        >
                          <span aria-hidden>{isOpen ? '▾' : '▸'}</span>
                        </button>
                        <div>
                          <Link to={`/platform/companies/${encodeURIComponent(row.company_id)}`} className="pco-name">{row.name}</Link>
                          {row.status !== 'active' && <span className="badge badge-red pai-flag">Suspended</span>}
                          {row.client_name && <span className="pco-cell-meta">{row.client_name}</span>}
                        </div>
                      </div>
                    </th>
                    <td>{row.default_name}</td>
                    <td className="pco-num">{fmtInt(row.custom_jobs)}</td>
                    <td><UsedChips rows={row.used} keys={data.keys} /></td>
                    {data.keys.map(k => (
                      <td key={k.id} className="pco-num">
                        {fmtUsd(spendOf(row, k))}
                        <span className="pco-cell-meta">{fmtInt(row.providers[k.id]?.calls)} calls</span>
                      </td>
                    ))}
                    <td className="pco-num"><b>{fmtUsd(row.cost_usd)}</b></td>
                  </tr>
                  {isOpen && (
                    <tr id={detailId} className="pai-detail-row">
                      <td colSpan={columns}>
                        <CompanyDetails row={row} keys={data.keys} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

function CompanyDetails({ row, keys }: { row: AiCompanyRow; keys: AiKey[] }) {
  return (
    <div className="pai-detail">
      <div>
        <h3 className="pai-subhead">Jobs of {row.name}</h3>
        <AiJobsTable jobs={row.jobs} keys={keys} label={`Jobs of ${row.name}`} />
      </div>
      <div>
        <h3 className="pai-subhead">Used by {row.name} in this period</h3>
        {row.used.length === 0
          ? <EmptyState>No AI calls in this period.</EmptyState>
          : <AiUsedTable used={row.used} keys={keys} label={`Used by ${row.name}`} />}
      </div>
    </div>
  )
}
