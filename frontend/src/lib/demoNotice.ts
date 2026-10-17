export const DEMO_NOTICE_EVENT = 'hirely:demo-notice'

export interface SimulatedResponse {
  demo: true
  message: string
}

export function isSimulatedResponse(data: unknown): data is SimulatedResponse {
  if (typeof data !== 'object' || data === null) return false
  const body = data as { demo?: unknown; message?: unknown }
  return body.demo === true && typeof body.message === 'string' && body.message.length > 0
}

export function announceSimulated(message: string): void {
  window.dispatchEvent(new CustomEvent<string>(DEMO_NOTICE_EVENT, { detail: message }))
}
