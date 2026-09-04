
const CANDIDATE_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/ogg;codecs=opus',
]

export const ANSWER_BITRATE = 64_000

export function pickAudioMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  return CANDIDATE_MIME_TYPES.find(t => MediaRecorder.isTypeSupported(t)) ?? null
}

export function supportedAudioMimeTypes(): string[] {
  if (typeof MediaRecorder === 'undefined') return []
  return CANDIDATE_MIME_TYPES.filter(t => MediaRecorder.isTypeSupported(t))
}

export function extensionForMimeType(mimeType: string): string {
  if (mimeType.includes('webm')) return 'webm'
  if (mimeType.includes('mp4')) return 'mp4'
  if (mimeType.includes('ogg')) return 'ogg'
  return 'webm'
}

export function describeMediaError(err: unknown): string {
  const name = (err as { name?: string } | null)?.name ?? ''
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera and microphone access was blocked. Click the camera icon in your browser\'s address bar, allow both, then press Retry.'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No camera or microphone was found. Connect both devices and press Retry.'
    case 'NotReadableError':
    case 'TrackStartError':
      return 'Your camera or microphone is already in use by another application. Close any other video-call or recording app, then press Retry.'
    case 'OverconstrainedError':
      return 'Your camera does not support the required settings. Try a different camera and press Retry.'
    default:
      return 'Could not start your camera and microphone. Check your device settings and press Retry.'
  }
}

export async function requestInterviewMedia(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(
      new Error(
        window.isSecureContext
          ? 'This browser does not support camera and microphone capture. Please use Google Chrome.'
          : 'Camera and microphone access requires a secure (HTTPS) connection. Please open this link over HTTPS.',
      ),
      { name: 'UnsupportedError' },
    )
  }
  return navigator.mediaDevices.getUserMedia({
    video: { width: 320, height: 240, facingMode: 'user' },
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  })
}
