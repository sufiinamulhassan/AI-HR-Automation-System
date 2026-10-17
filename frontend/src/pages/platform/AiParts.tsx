import type { AiJobKind, AiJobRow, AiKey, AiUsedRow } from '../../lib/platformTypes'
import { fmtInt, fmtUsd } from './format'
import './PlatformAi.css'

export function providerLabel(keys: AiKey[], id: string): string {
  return keys.find(k => k.id === id)?.label ?? id
}

const KIND_LABELS: Record<AiJobKind, string> = {
  chat: 'Chat',
  embedding: 'Embeddings',
  speech: 'Speech',
  transcription: 'Transcription',
}

export const kindLabel = (kind: AiJobKind): string => KIND_LABELS[kind] ?? kind

export function AiKeyCards({ keys, showCompanies = true, nested = false }: {
  keys: AiKey[]
  showCompanies?: boolean
  nested?: boolean
}) {
  const Heading = nested ? 'h3' : 'h2'
  return (
    <div className="pai-keys">
      {keys.map(k => (
        <section key={k.id} className="pco-card pai-key" aria-label={`${k.label} key`}>
          <div className="pco-card-head">
            <Heading className="pco-card-title">{k.label}</Heading>
            <span className={`badge ${k.configured ? 'badge-green' : 'badge-red'}`}>{k.configured ? 'Key set' : 'No key'}</span>
          </div>
          <p className="pai-key-id">
            <span>Platform key</span>
            <code className="pai-code">{k.env_var}</code>
            {k.mask && <code className="pai-code pai-mask">{k.mask}</code>}
          </p>
          <div className="pai-key-stats">
            {showCompanies && <Stat label="Companies" value={fmtInt(k.companies)} />}
            <Stat label="Calls" value={fmtInt(k.calls)} />
            <Stat label="Spend" value={fmtUsd(k.cost_usd)} />
          </div>
          {k.models.length > 0 && (
            <div className="pai-key-models">
              <span className="pco-kpi-label">Models</span>
              <ul className="pai-chips">
                {k.models.map(m => (
                  <li key={`${m.kind}:${m.model ?? m.name}`}>
                    <span className="pco-chip" title={`${kindLabel(m.kind)}, ${fmtUsd(m.cost_usd)}`}>
                      {m.name} <b>{fmtInt(m.calls)}</b>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      ))}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="pai-stat">
      <span className="pco-kpi-label">{label}</span>
      <span className="pai-stat-value">{value}</span>
    </div>
  )
}

const rowKey = (r: AiUsedRow) => `${r.kind}:${r.model ?? r.name}`

export function UsedChips({ rows, keys }: { rows: AiUsedRow[]; keys: AiKey[] }) {
  if (rows.length === 0) return <span className="pai-none">-</span>
  return (
    <ul className="pai-chips">
      {rows.map(r => (
        <li key={rowKey(r)}>
          <span className="pco-chip" title={`${providerLabel(keys, r.provider)}, ${kindLabel(r.kind)}, ${fmtUsd(r.cost_usd)}`}>
            {r.name} <b>{fmtInt(r.calls)}</b>
          </span>
        </li>
      ))}
    </ul>
  )
}

export function AiJobsTable({ jobs, keys, label }: { jobs: AiJobRow[]; keys: AiKey[]; label: string }) {
  const maskOf = (job: AiJobRow) => keys.find(k => k.id === job.provider)?.mask ?? null
  return (
    <div className="pco-table-wrap">
      <table className="pco-table pai-table" aria-label={label}>
        <thead>
          <tr>
            <th scope="col">Job</th>
            <th scope="col">Model</th>
            <th scope="col">Provider</th>
            <th scope="col">Key</th>
            <th scope="col">Chosen by</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map(job => (
            <tr key={job.key}>
              <th scope="row">{job.label}</th>
              <td>{job.model_name}</td>
              <td>{providerLabel(keys, job.provider)}</td>
              <td>
                {job.key_env ? <code className="pai-code">{job.key_env}</code> : '-'}
                {maskOf(job) && <code className="pai-code pai-mask pai-code-cell">{maskOf(job)}</code>}
                {!job.ready && <span className="badge badge-red pai-flag">No key</span>}
              </td>
              <td>
                {job.custom
                  ? <span className="pco-chip">Company</span>
                  : <span className="pai-none">Default</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function AiUsedTable({ used, keys, label }: { used: AiUsedRow[]; keys: AiKey[]; label: string }) {
  return (
    <div className="pco-table-wrap">
      <table className="pco-table" aria-label={label}>
        <thead>
          <tr>
            <th scope="col">Model</th>
            <th scope="col">Type</th>
            <th scope="col">Provider</th>
            <th scope="col" className="pco-num">Calls</th>
            <th scope="col" className="pco-num">Tokens in</th>
            <th scope="col" className="pco-num">Tokens out</th>
            <th scope="col" className="pco-num">Spend</th>
          </tr>
        </thead>
        <tbody>
          {used.map(row => (
            <tr key={rowKey(row)}>
              <th scope="row">{row.name}</th>
              <td>{kindLabel(row.kind)}</td>
              <td>{providerLabel(keys, row.provider)}</td>
              <td className="pco-num">{fmtInt(row.calls)}</td>
              <td className="pco-num">{row.tokens_in === null ? '-' : fmtInt(row.tokens_in)}</td>
              <td className="pco-num">{row.tokens_out === null ? '-' : fmtInt(row.tokens_out)}</td>
              <td className="pco-num">{fmtUsd(row.cost_usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
