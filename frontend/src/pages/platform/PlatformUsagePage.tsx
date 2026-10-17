import { useMemo, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { platformApi } from '../../lib/api'
import type { UsageMatrix, UsageMatrixRow } from '../../lib/platformTypes'
import { AsOf, EmptyState, ErrorState, LoadingState, PeriodRange, PeriodSelect, SortHeader } from './PlatformUi'
import { fmtInt } from './format'
import { nextSort, sortRows, type SortState } from './tableSort'
import { useForceRefresh, useLoaded, usePlatformPeriod } from './usePlatformData'
import './PlatformUsagePage.css'

export function heatOf(count: number, columnMax: number): number {
  return columnMax > 0 ? Math.min(count / columnMax, 1) : 0
}

const rowTotal = (row: UsageMatrixRow) => Object.values(row.counts).reduce((sum, n) => sum + n, 0)

export default function PlatformUsagePage() {
  const [period, setPeriod] = usePlatformPeriod()
  const { take, mark } = useForceRefresh()
  const { data, loading, error, reload } = useLoaded(
    () => {
      const fresh = take()
      return (fresh ? platformApi.usage(period, fresh) : platformApi.usage(period)).then(r => r.data)
    },
    [period],
    'Could not load the usage matrix.',
  )

  return (
    <div className="pco-page" aria-busy={loading}>
      <div className="pco-header">
        <h1 className="pco-title">Usage by client</h1>
        <div className="pco-header-actions">
          <PeriodSelect value={period} onChange={setPeriod} />
          <AsOf at={data?.computed_at} loading={loading} onRefresh={() => { mark(); reload() }} />
        </div>
      </div>
      {data && <PeriodRange period={data.period} />}

      {!data && loading && <LoadingState label="Loading the usage matrix…" />}
      {!data && !loading && error && <ErrorState message={error} onRetry={reload} />}
      {data && error && <ErrorState message={error} onRetry={reload} />}

      {data && (
        <section className="pco-card">
          {data.rows.length === 0 || data.features.length === 0
            ? <EmptyState>No clients yet.</EmptyState>
            : <UsageTable data={data} />}
        </section>
      )}
    </div>
  )
}

function UsageTable({ data }: { data: UsageMatrix }) {
  const [sort, setSort] = useState<SortState | null>(null)

  const columnMax = useMemo(() => {
    const max: Record<string, number> = {}
    for (const f of data.features) max[f.key] = Math.max(0, ...data.rows.map(r => r.counts[f.key] ?? 0))
    return max
  }, [data])

  const rows = useMemo(
    () => sortRows(data.rows, sort, (row, key) => {
      if (key === 'name') return row.name
      if (key === 'total') return rowTotal(row)
      return row.counts[key] ?? 0
    }),
    [data.rows, sort],
  )

  const onSort = (key: string, numeric: boolean) => setSort(current => nextSort(current, key, numeric))

  return (
    <div className="pco-table-wrap">
      <table className="pco-table pco-matrix">
        <thead>
          <tr>
            <SortHeader label="Client" sortKey="name" sort={sort} onSort={onSort} />
            {data.features.map(f => (
              <SortHeader key={f.key} label={f.label} sortKey={f.key} sort={sort} onSort={onSort} numeric />
            ))}
            <SortHeader label="Total" sortKey="total" sort={sort} onSort={onSort} numeric />
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.client_id}>
              <th scope="row">
                <Link to={`/platform/clients/${encodeURIComponent(row.client_id)}`} className="pco-name">{row.name}</Link>
                {row.status !== 'active' && <span className="badge badge-red pco-matrix-flag">Suspended</span>}
              </th>
              {data.features.map(f => {
                const count = row.counts[f.key] ?? 0
                const heat = heatOf(count, columnMax[f.key])
                const isTop = row.top_feature === f.key
                return (
                  <td
                    key={f.key}
                    className={`pco-heat${isTop ? ' pco-heat-top' : ''}${count === 0 ? ' pco-heat-zero' : ''}`}
                    style={{ '--heat': heat } as CSSProperties}
                    data-feature={f.key}
                    data-heat={heat.toFixed(2)}
                  >
                    {fmtInt(count)}
                    {isTop && (
                      <>
                        <span className="pco-heat-flag" aria-hidden>★</span>
                        <span className="pco-sr"> (top feature)</span>
                      </>
                    )}
                  </td>
                )
              })}
              <td className="pco-num pco-matrix-total">{fmtInt(rowTotal(row))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
