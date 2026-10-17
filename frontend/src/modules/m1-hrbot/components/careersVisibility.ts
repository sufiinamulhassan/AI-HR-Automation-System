export function isJobPublic(job: Record<string, unknown> | null | undefined): boolean {
  if (!job) return true
  if (job.is_public === true) return true
  if (job.is_public === false) return false
  return ((job.source as string | undefined) || 'manual') === 'manual'
}

export function careersJobUrl(jobId: string, origin: string = window.location.origin): string {
  return `${origin}/careers/${encodeURIComponent(jobId)}`
}
