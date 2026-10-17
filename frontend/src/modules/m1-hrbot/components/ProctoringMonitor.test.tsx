import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let faceLandmarks: unknown[] = [{}]
let faceBlendshapes: Array<{ categories: Array<{ categoryName: string; score: number }> }> = [{ categories: [] }]
let facialTransformationMatrixes: Array<{ data: number[] }> = []
let objectDetections: Array<{ categories: Array<{ categoryName: string; score: number }> }> = []

const fakeLandmarker = {
  detectForVideo: vi.fn(() => ({ faceLandmarks, faceBlendshapes, facialTransformationMatrixes })),
  close: vi.fn(),
}
const fakeDetector = {
  detectForVideo: vi.fn(() => ({ detections: objectDetections })),
  close: vi.fn(),
}

const forVisionTasks = vi.fn(async () => ({}))
const createFaceLandmarker = vi.fn(async () => fakeLandmarker)
const createObjectDetector = vi.fn(async () => fakeDetector)

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks },
  FaceLandmarker: { createFromOptions: createFaceLandmarker },
  ObjectDetector: { createFromOptions: createObjectDetector },
}))

const {
  default: ProctoringMonitor,
  DETECT_INTERVAL_MS,
  NO_FACE_DEBOUNCE_CHECKS,
  MULTI_FACE_DEBOUNCE_CHECKS,
  GAZE_DEBOUNCE_CHECKS,
  PHONE_DEBOUNCE_CHECKS,
  PHONE_CLEAR_CHECKS,
  IDENTITY_REFERENCE_SAMPLE_TICKS,
  IDENTITY_MISMATCH_DEBOUNCE_CHECKS,
  IDENTITY_MISMATCH_CLEAR_CHECKS,
} = await import('./ProctoringMonitor')

const KNOWN_EVENTS = [
  'face_detected', 'no_face_detected', 'multiple_faces_detected',
  'gaze_off_screen', 'gaze_on_screen', 'phone_detected', 'identity_mismatch',
]

function fakeStream(withVideo = true) {
  const videoTrack = { stop: vi.fn(), kind: 'video' } as unknown as MediaStreamTrack
  return {
    getTracks: () => (withVideo ? [videoTrack] : []),
    getVideoTracks: () => (withVideo ? [videoTrack] : []),
    getAudioTracks: () => [],
  } as unknown as MediaStream
}

function matrixWithYaw(yaw: number): number[] {
  const m = new Array(16).fill(0)
  m[8] = Math.sin(yaw)
  m[9] = 0
  m[10] = Math.cos(yaw)
  m[15] = 1
  return m
}

const PHONE_SEEN = [{ categories: [{ categoryName: 'cell phone', score: 0.9 }] }]

function faceMesh(face: Record<number, [number, number, number]>): Array<{ x: number; y: number; z: number }> {
  const pts = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }))
  for (const [i, [x, y, z]] of Object.entries(face)) pts[Number(i)] = { x, y, z }
  return pts
}

const REFERENCE_FACE: Record<number, [number, number, number]> = {
  33: [0.40, 0.45, 0], 133: [0.46, 0.45, 0], 362: [0.54, 0.45, 0], 263: [0.60, 0.45, 0],
  168: [0.50, 0.44, -0.02], 1: [0.50, 0.55, -0.05], 10: [0.50, 0.30, 0], 234: [0.35, 0.50, 0.03], 454: [0.65, 0.50, 0.03],
}
const DIFFERENT_FACE: Record<number, [number, number, number]> = {
  33: [0.39, 0.45, 0], 133: [0.47, 0.45, 0], 362: [0.53, 0.45, 0], 263: [0.61, 0.45, 0],
  168: [0.50, 0.43, -0.02], 1: [0.50, 0.60, -0.06], 10: [0.50, 0.26, 0], 234: [0.37, 0.50, 0.03], 454: [0.63, 0.50, 0.03],
}
const REFERENCE_FACE_TALKING: Record<number, [number, number, number]> = {
  ...REFERENCE_FACE, 13: [0.5, 0.62, 0], 14: [0.5, 0.68, 0], 152: [0.5, 0.75, 0.01],
}

async function flushLoad() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)
  })
}

async function tick(n = 1) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(DETECT_INTERVAL_MS * n)
  })
}

describe('ProctoringMonitor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
      configurable: true,
      get: () => 4,
    })
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
      configurable: true,
      get: () => 1280,
    })
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
      configurable: true,
      get: () => 720,
    })
    faceLandmarks = [{}]
    faceBlendshapes = [{ categories: [] }]
    facialTransformationMatrixes = []
    objectDetections = []
    fakeLandmarker.detectForVideo.mockClear()
    fakeDetector.detectForVideo.mockClear()
    createFaceLandmarker.mockClear()
    createObjectDetector.mockClear()
    forVisionTasks.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('flags no_face_detected only after its debounce window, exactly once', async () => {
    const onFlag = vi.fn()
    render(<ProctoringMonitor stream={fakeStream()} onFlag={onFlag} enabled headless />)
    await flushLoad()

    faceLandmarks = []
    await tick(NO_FACE_DEBOUNCE_CHECKS - 1)
    expect(onFlag).not.toHaveBeenCalledWith('no_face_detected')

    await tick(1)
    expect(onFlag.mock.calls.filter(c => c[0] === 'no_face_detected')).toHaveLength(1)

    await tick(5)
    expect(onFlag.mock.calls.filter(c => c[0] === 'no_face_detected')).toHaveLength(1)
  })

  it('does not flag a single momentary no-face blink below the debounce threshold', async () => {
    const onFlag = vi.fn()
    render(<ProctoringMonitor stream={fakeStream()} onFlag={onFlag} enabled headless />)
    await flushLoad()

    faceLandmarks = []
    await tick(1)
    faceLandmarks = [{}]
    await tick(NO_FACE_DEBOUNCE_CHECKS + 2)

    expect(onFlag).not.toHaveBeenCalledWith('no_face_detected')
  })

  it('flags face_detected once presence recovers after a real no-face incident', async () => {
    const onFlag = vi.fn()
    render(<ProctoringMonitor stream={fakeStream()} onFlag={onFlag} enabled headless />)
    await flushLoad()

    faceLandmarks = []
    await tick(NO_FACE_DEBOUNCE_CHECKS)
    onFlag.mockClear()

    faceLandmarks = [{}]
    await tick(1)
    expect(onFlag.mock.calls.filter(c => c[0] === 'face_detected')).toHaveLength(1)
  })

  it('flags multiple_faces_detected only after its debounce window, exactly once', async () => {
    const onFlag = vi.fn()
    render(<ProctoringMonitor stream={fakeStream()} onFlag={onFlag} enabled headless />)
    await flushLoad()

    faceLandmarks = [{}, {}]
    await tick(MULTI_FACE_DEBOUNCE_CHECKS - 1)
    expect(onFlag).not.toHaveBeenCalledWith('multiple_faces_detected')

    await tick(1)
    expect(onFlag.mock.calls.filter(c => c[0] === 'multiple_faces_detected')).toHaveLength(1)

    await tick(5)
    expect(onFlag.mock.calls.filter(c => c[0] === 'multiple_faces_detected')).toHaveLength(1)
  })

  it('flags gaze_off_screen only after its debounce window, then gaze_on_screen on recovery', async () => {
    const onFlag = vi.fn()
    render(<ProctoringMonitor stream={fakeStream()} onFlag={onFlag} enabled headless />)
    await flushLoad()

    faceLandmarks = [{}]
    facialTransformationMatrixes = [{ data: matrixWithYaw(1.0) }]
    await tick(GAZE_DEBOUNCE_CHECKS - 1)
    expect(onFlag).not.toHaveBeenCalledWith('gaze_off_screen')

    await tick(1)
    expect(onFlag.mock.calls.filter(c => c[0] === 'gaze_off_screen')).toHaveLength(1)

    facialTransformationMatrixes = [{ data: matrixWithYaw(0) }]
    await tick(2)
    expect(onFlag.mock.calls.filter(c => c[0] === 'gaze_on_screen')).toHaveLength(1)
  })

  it('flags phone_detected only after its debounce window, once per sustained incident, and re-arms for a later one', async () => {
    const onFlag = vi.fn()
    render(<ProctoringMonitor stream={fakeStream()} onFlag={onFlag} enabled headless />)
    await flushLoad()

    objectDetections = PHONE_SEEN
    await tick(PHONE_DEBOUNCE_CHECKS - 1)
    expect(onFlag).not.toHaveBeenCalledWith('phone_detected')

    await tick(1)
    expect(onFlag.mock.calls.filter(c => c[0] === 'phone_detected')).toHaveLength(1)

    await tick(5)
    expect(onFlag.mock.calls.filter(c => c[0] === 'phone_detected')).toHaveLength(1)

    objectDetections = []
    await tick(PHONE_CLEAR_CHECKS)
    objectDetections = PHONE_SEEN
    await tick(PHONE_DEBOUNCE_CHECKS)
    expect(onFlag.mock.calls.filter(c => c[0] === 'phone_detected')).toHaveLength(2)
  })

  it('does not flag a single momentary phone misdetection below the debounce threshold', async () => {
    const onFlag = vi.fn()
    render(<ProctoringMonitor stream={fakeStream()} onFlag={onFlag} enabled headless />)
    await flushLoad()

    objectDetections = PHONE_SEEN
    await tick(1)
    objectDetections = []
    await tick(PHONE_DEBOUNCE_CHECKS + 3)

    expect(onFlag).not.toHaveBeenCalledWith('phone_detected')
  })

  describe('identity_mismatch (face-geometry continuity check)', () => {
    it('captures a reference from a stable single face, then flags identity_mismatch only after sustained mismatch', async () => {
      const onFlag = vi.fn()
      render(<ProctoringMonitor stream={fakeStream()} onFlag={onFlag} enabled headless />)
      await flushLoad()

      faceLandmarks = [faceMesh(REFERENCE_FACE)]
      await tick(IDENTITY_REFERENCE_SAMPLE_TICKS)
      expect(onFlag).not.toHaveBeenCalledWith('identity_mismatch')

      faceLandmarks = [faceMesh(DIFFERENT_FACE)]
      await tick(IDENTITY_MISMATCH_DEBOUNCE_CHECKS - 1)
      expect(onFlag).not.toHaveBeenCalledWith('identity_mismatch')

      await tick(1)
      expect(onFlag.mock.calls.filter(c => c[0] === 'identity_mismatch')).toHaveLength(1)

      await tick(5)
      expect(onFlag.mock.calls.filter(c => c[0] === 'identity_mismatch')).toHaveLength(1)
    })

    it('does not flag a single momentary mismatched tick below the debounce threshold', async () => {
      const onFlag = vi.fn()
      render(<ProctoringMonitor stream={fakeStream()} onFlag={onFlag} enabled headless />)
      await flushLoad()

      faceLandmarks = [faceMesh(REFERENCE_FACE)]
      await tick(IDENTITY_REFERENCE_SAMPLE_TICKS)

      faceLandmarks = [faceMesh(DIFFERENT_FACE)]
      await tick(1)
      faceLandmarks = [faceMesh(REFERENCE_FACE)]
      await tick(IDENTITY_MISMATCH_DEBOUNCE_CHECKS + 2)

      expect(onFlag).not.toHaveBeenCalledWith('identity_mismatch')
    })

    it('re-arms after a sustained match, so a later, separate mismatch is reported again', async () => {
      const onFlag = vi.fn()
      render(<ProctoringMonitor stream={fakeStream()} onFlag={onFlag} enabled headless />)
      await flushLoad()

      faceLandmarks = [faceMesh(REFERENCE_FACE)]
      await tick(IDENTITY_REFERENCE_SAMPLE_TICKS)

      faceLandmarks = [faceMesh(DIFFERENT_FACE)]
      await tick(IDENTITY_MISMATCH_DEBOUNCE_CHECKS)
      expect(onFlag.mock.calls.filter(c => c[0] === 'identity_mismatch')).toHaveLength(1)

      faceLandmarks = [faceMesh(REFERENCE_FACE)]
      await tick(IDENTITY_MISMATCH_CLEAR_CHECKS)
      faceLandmarks = [faceMesh(DIFFERENT_FACE)]
      await tick(IDENTITY_MISMATCH_DEBOUNCE_CHECKS)
      expect(onFlag.mock.calls.filter(c => c[0] === 'identity_mismatch')).toHaveLength(2)
    })

    it('never flags a change in expression alone, mouth/chin movement is not part of the signature', async () => {
      const onFlag = vi.fn()
      render(<ProctoringMonitor stream={fakeStream()} onFlag={onFlag} enabled headless />)
      await flushLoad()

      faceLandmarks = [faceMesh(REFERENCE_FACE)]
      await tick(IDENTITY_REFERENCE_SAMPLE_TICKS)

      faceLandmarks = [faceMesh(REFERENCE_FACE_TALKING)]
      await tick(IDENTITY_MISMATCH_DEBOUNCE_CHECKS + 5)

      expect(onFlag).not.toHaveBeenCalledWith('identity_mismatch')
    })

    it('never flags anything when no stable single face is ever detected to build a reference from', async () => {
      const onFlag = vi.fn()
      render(<ProctoringMonitor stream={fakeStream()} onFlag={onFlag} enabled headless />)
      await flushLoad()

      await tick(20)

      expect(onFlag).not.toHaveBeenCalledWith('identity_mismatch')
    })
  })

  describe('consent, camera availability, and load-failure fallback', () => {
    it('never loads either model and never flags when consent is declined (enabled=false)', async () => {
      const onFlag = vi.fn()
      render(<ProctoringMonitor stream={fakeStream()} onFlag={onFlag} enabled={false} headless={false} />)
      await flushLoad()

      expect(forVisionTasks).not.toHaveBeenCalled()
      expect(createFaceLandmarker).not.toHaveBeenCalled()
      expect(createObjectDetector).not.toHaveBeenCalled()
      expect(screen.getByText(/monitoring is off/i)).toBeInTheDocument()

      faceLandmarks = []
      objectDetections = PHONE_SEEN
      await tick(20)
      expect(onFlag).not.toHaveBeenCalled()
    })

    it('renders nothing in headless mode when disabled, never a visible blocker', async () => {
      const { container } = render(
        <ProctoringMonitor stream={fakeStream()} onFlag={vi.fn()} enabled={false} headless />
      )
      await flushLoad()
      expect(container).toBeEmptyDOMElement()
    })

    it('treats a stream with no video track the same as declined, no models, no flags', async () => {
      const onFlag = vi.fn()
      render(<ProctoringMonitor stream={fakeStream(false)} onFlag={onFlag} enabled headless={false} />)
      await flushLoad()

      expect(forVisionTasks).not.toHaveBeenCalled()
      expect(screen.getByText(/monitoring is off/i)).toBeInTheDocument()
      await tick(20)
      expect(onFlag).not.toHaveBeenCalled()
    })

    it('a null stream never loads anything and never throws', async () => {
      const onFlag = vi.fn()
      expect(() =>
        render(<ProctoringMonitor stream={null} onFlag={onFlag} enabled headless={false} />)
      ).not.toThrow()
      await flushLoad()

      expect(forVisionTasks).not.toHaveBeenCalled()
      expect(onFlag).not.toHaveBeenCalled()
    })

    it('fails gracefully with an inert notice when MediaPipe cannot load at all, no throw, no flags', async () => {
      forVisionTasks.mockRejectedValueOnce(new Error('WASM blocked by network policy'))
      const onFlag = vi.fn()
      render(<ProctoringMonitor stream={fakeStream()} onFlag={onFlag} enabled headless={false} />)
      await flushLoad()

      expect(screen.getByText(/unavailable in this browser/i)).toBeInTheDocument()
      await tick(20)
      expect(onFlag).not.toHaveBeenCalled()
    })

    it('headless mode renders nothing (not a blocker) when MediaPipe fails to load', async () => {
      forVisionTasks.mockRejectedValueOnce(new Error('WASM blocked'))
      const { container } = render(
        <ProctoringMonitor stream={fakeStream()} onFlag={vi.fn()} enabled headless />
      )
      await flushLoad()
      expect(container).toBeEmptyDOMElement()
    })

    it('keeps face/gaze detection running even when only the object (phone) detector fails to load', async () => {
      createObjectDetector.mockRejectedValueOnce(new Error('object model 404'))
      const onFlag = vi.fn()
      render(<ProctoringMonitor stream={fakeStream()} onFlag={onFlag} enabled headless />)
      await flushLoad()

      faceLandmarks = []
      await tick(NO_FACE_DEBOUNCE_CHECKS)
      expect(onFlag.mock.calls.filter(c => c[0] === 'no_face_detected')).toHaveLength(1)

      objectDetections = PHONE_SEEN
      await tick(PHONE_DEBOUNCE_CHECKS + 3)
      expect(onFlag).not.toHaveBeenCalledWith('phone_detected')
    })

    it('keeps phone detection running even when only the face landmarker fails to load', async () => {
      createFaceLandmarker.mockRejectedValueOnce(new Error('face model 404'))
      const onFlag = vi.fn()
      render(<ProctoringMonitor stream={fakeStream()} onFlag={onFlag} enabled headless />)
      await flushLoad()

      objectDetections = PHONE_SEEN
      await tick(PHONE_DEBOUNCE_CHECKS)
      expect(onFlag.mock.calls.filter(c => c[0] === 'phone_detected')).toHaveLength(1)

      faceLandmarks = []
      await tick(NO_FACE_DEBOUNCE_CHECKS + 3)
      expect(onFlag).not.toHaveBeenCalledWith('no_face_detected')
    })
  })

  describe('onStatusChange, the host UI\'s hook for a loading indicator', () => {
    it('reports initializing immediately, then ready once both models load', async () => {
      const onStatusChange = vi.fn()
      render(<ProctoringMonitor stream={fakeStream()} onFlag={vi.fn()} enabled headless onStatusChange={onStatusChange} />)

      expect(onStatusChange).toHaveBeenCalledWith('initializing')
      await flushLoad()
      expect(onStatusChange).toHaveBeenLastCalledWith('ready')
    })

    it('reports disabled immediately when consent is declined, never stuck on initializing', async () => {
      const onStatusChange = vi.fn()
      render(<ProctoringMonitor stream={fakeStream()} onFlag={vi.fn()} enabled={false} headless onStatusChange={onStatusChange} />)
      await flushLoad()

      expect(onStatusChange).toHaveBeenLastCalledWith('disabled')
    })

    it('reports unavailable when MediaPipe fails to load entirely', async () => {
      forVisionTasks.mockRejectedValueOnce(new Error('WASM blocked'))
      const onStatusChange = vi.fn()
      render(<ProctoringMonitor stream={fakeStream()} onFlag={vi.fn()} enabled headless onStatusChange={onStatusChange} />)
      await flushLoad()

      expect(onStatusChange).toHaveBeenLastCalledWith('unavailable')
    })
  })

  describe('no video ever leaves the browser', () => {
    it('onFlag only ever receives one of the known short event-name strings, never a frame, never an object', async () => {
      const received: unknown[] = []
      render(<ProctoringMonitor stream={fakeStream()} onFlag={e => received.push(e)} enabled headless />)
      await flushLoad()

      faceLandmarks = []
      await tick(NO_FACE_DEBOUNCE_CHECKS)
      faceLandmarks = [{}, {}]
      await tick(MULTI_FACE_DEBOUNCE_CHECKS)
      faceLandmarks = [{}]
      facialTransformationMatrixes = [{ data: matrixWithYaw(1.0) }]
      await tick(GAZE_DEBOUNCE_CHECKS)
      objectDetections = PHONE_SEEN
      await tick(PHONE_DEBOUNCE_CHECKS)
      facialTransformationMatrixes = []
      faceLandmarks = [faceMesh(REFERENCE_FACE)]
      await tick(IDENTITY_REFERENCE_SAMPLE_TICKS)
      faceLandmarks = [faceMesh(DIFFERENT_FACE)]
      await tick(IDENTITY_MISMATCH_DEBOUNCE_CHECKS)

      expect(received.length).toBeGreaterThan(0)
      for (const event of received) {
        expect(typeof event).toBe('string')
        expect((event as string).length).toBeLessThan(40)
        expect(KNOWN_EVENTS).toContain(event)
      }
    })

    it('the request body a real flag POST would send is a short JSON string with no image/base64 payload', async () => {
      const sentBodies: string[] = []
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
      const postFlag = (event: string) => {
        const body = JSON.stringify({ event })
        sentBodies.push(body)
        return fetch('/api/v1/interview/session/tok_abc/flag', { method: 'POST', body })
      }

      render(<ProctoringMonitor stream={fakeStream()} onFlag={postFlag} enabled headless />)
      await flushLoad()

      faceLandmarks = []
      await tick(NO_FACE_DEBOUNCE_CHECKS)
      objectDetections = PHONE_SEEN
      await tick(PHONE_DEBOUNCE_CHECKS)
      faceLandmarks = [faceMesh(REFERENCE_FACE)]
      await tick(IDENTITY_REFERENCE_SAMPLE_TICKS)
      faceLandmarks = [faceMesh(DIFFERENT_FACE)]
      await tick(IDENTITY_MISMATCH_DEBOUNCE_CHECKS)

      expect(sentBodies.length).toBeGreaterThan(0)
      for (const body of sentBodies) {
        expect(body.length).toBeLessThan(100)
        expect(body).not.toMatch(/data:|base64/i)
        expect(body).not.toMatch(/[A-Za-z0-9+/]{64,}/)
        const parsed = JSON.parse(body)
        expect(Object.keys(parsed)).toEqual(['event'])
        expect(KNOWN_EVENTS).toContain(parsed.event)
      }
    })
  })
})
