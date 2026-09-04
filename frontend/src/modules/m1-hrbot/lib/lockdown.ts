
export async function enterFullscreen(): Promise<boolean> {
  const el = document.documentElement
  if (!el.requestFullscreen) return false
  try {
    await el.requestFullscreen({ navigationUI: 'hide' })
    return true
  } catch {
    return false
  }
}

export function isFullscreen(): boolean {
  return document.fullscreenElement !== null
}

export async function exitFullscreen(): Promise<void> {
  if (document.fullscreenElement && document.exitFullscreen) {
    try { await document.exitFullscreen() } catch {}
  }
}

export function hasMultipleDisplays(): boolean | null {
  const extended = (window.screen as Screen & { isExtended?: boolean }).isExtended
  return typeof extended === 'boolean' ? extended : null
}

export function watchScreenCapture(onDetected: () => void): () => void {
  const media = navigator.mediaDevices as MediaDevices & {
    getDisplayMedia?: (c?: DisplayMediaStreamOptions) => Promise<MediaStream>
  }
  const original = media?.getDisplayMedia
  if (!original) return () => {}

  media.getDisplayMedia = async function patched(this: MediaDevices, ...args) {
    onDetected()
    return original.apply(this, args as [DisplayMediaStreamOptions?])
  }
  return () => { media.getDisplayMedia = original }
}
