import './DeadlineBar.css'

function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) }
  catch { return iso }
}

export default function DeadlineBar({ createdAt, deadlineAt, compact }: {
  createdAt?: string
  deadlineAt?: string | null
  compact?: boolean
}) {
  if (!deadlineAt) {
    return (
      <div className={`dl-bar dl-open${compact ? ' dl-compact' : ''}`}>
        <span className="dl-label dl-label-open">● Open · no deadline</span>
      </div>
    )
  }

  const start = createdAt ? new Date(createdAt).getTime() : Date.now()
  const end = new Date(deadlineAt).getTime()
  const now = Date.now()
  const total = Math.max(end - start, 1)
  const pct = Math.max(0, Math.min(1, (now - start) / total))
  const daysLeft = Math.ceil((end - now) / 86_400_000)
  const closed = now >= end
  const hue = Math.round(120 * (1 - pct))
  const color = closed ? '#dc2626' : `hsl(${hue}, 72%, 42%)`
  const label = closed
    ? 'Closed - not accepting candidates'
    : daysLeft <= 0 ? 'Closes today'
    : `${daysLeft} day${daysLeft !== 1 ? 's' : ''} left`

  return (
    <div className={`dl-bar${compact ? ' dl-compact' : ''}`}>
      <div className="dl-head">
        <span className="dl-label" style={{ color }}>{closed ? '⏱' : '⏳'} {label}</span>
        {!compact && <span className="dl-dates">Closes {fmtDate(deadlineAt)}</span>}
      </div>
      <div className="dl-track">
        <div className="dl-fill" style={{ width: `${Math.round((closed ? 1 : pct) * 100)}%`, background: color }} />
      </div>
    </div>
  )
}
