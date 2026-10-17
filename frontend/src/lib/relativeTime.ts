export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '-'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '-'

  const seconds = Math.round((now - then) / 1000)
  if (seconds < 45) return 'just now'

  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`

  const days = Math.round(hours / 24)
  if (days < 30) return `${days} d ago`

  return new Date(then).toLocaleDateString()
}
