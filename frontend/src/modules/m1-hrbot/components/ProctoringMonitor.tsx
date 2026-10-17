import { useEffect, useRef, useState } from 'react'
import { FaceLandmarker, FilesetResolver, ObjectDetector } from '@mediapipe/tasks-vision'
import { averageFaceSignatures, computeFaceSignature, faceSignatureDistance } from './faceSignature'
import './ProctoringMonitor.css'

const WASM_PATH = '/mediapipe/wasm'
const MODEL_PATH = '/models/face_landmarker.task'
const OBJECT_MODEL_PATH = '/models/object_detector.tflite'

export const DETECT_INTERVAL_MS = 2500
export const NO_FACE_DEBOUNCE_CHECKS = 5
export const MULTI_FACE_DEBOUNCE_CHECKS = 5
export const GAZE_DEBOUNCE_CHECKS = 6
export const PHONE_DEBOUNCE_CHECKS = 2
export const PHONE_CLEAR_CHECKS = 2
export const PHONE_SCORE_THRESHOLD = 0.5

export const IDENTITY_REFERENCE_SAMPLE_TICKS = 3
export const IDENTITY_MISMATCH_DEBOUNCE_CHECKS = 6
export const IDENTITY_MISMATCH_CLEAR_CHECKS = 3
export const IDENTITY_MISMATCH_THRESHOLD = 0.08

const HEAD_YAW_LIMIT = 0.44
const HEAD_PITCH_LIMIT = 0.44
const EYE_LOOK_LIMIT = 0.55

type FaceState = 'ok' | 'no_face' | 'multiple'
export type MonitorState = 'initializing' | 'ready' | 'unavailable' | 'disabled'

interface ProctoringMonitorProps {
  stream: MediaStream | null
  onFlag: (event: string) => void
  headless?: boolean
  enabled?: boolean
  onStatusChange?: (state: MonitorState) => void
}

function headAngles(matrix: number[]): { yaw: number; pitch: number } {
  const r02 = matrix[8]
  const r12 = matrix[9]
  const r22 = matrix[10]
  const yaw = Math.atan2(r02, r22)
  const pitch = Math.atan2(-r12, Math.hypot(r02, r22))
  return { yaw, pitch }
}

export default function ProctoringMonitor({ stream, onFlag, headless = false, enabled = true, onStatusChange }: ProctoringMonitorProps) {
  const [monitorState, setMonitorState] = useState<MonitorState>('initializing')

  const onStatusChangeRef = useRef(onStatusChange)
  onStatusChangeRef.current = onStatusChange
  useEffect(() => {
    onStatusChangeRef.current?.(monitorState)
  }, [monitorState])

  const videoRef = useRef<HTMLVideoElement>(null)
  const landmarkerRef = useRef<FaceLandmarker | null>(null)
  const objectDetectorRef = useRef<ObjectDetector | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const noFaceStreakRef = useRef(0)
  const multiFaceStreakRef = useRef(0)
  const gazeStreakRef = useRef(0)
  const onScreenStreakRef = useRef(0)
  const faceStateRef = useRef<FaceState>('ok')
  const gazeOffRef = useRef(false)
  const phoneStreakRef = useRef(0)
  const phoneClearStreakRef = useRef(0)
  const phoneFlaggedRef = useRef(false)
  const identitySamplesRef = useRef<number[][]>([])
  const identityReferenceRef = useRef<number[] | null>(null)
  const identityMismatchStreakRef = useRef(0)
  const identityMatchStreakRef = useRef(0)
  const identityMismatchFlaggedRef = useRef(false)
  const detectingRef = useRef(false)
  const mountedRef = useRef(true)
  const onFlagRef = useRef(onFlag)
  onFlagRef.current = onFlag

  const hasVideo = Boolean(stream && stream.getVideoTracks().length > 0)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    if (!enabled || !hasVideo) {
      setMonitorState('disabled')
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const fileset = await FilesetResolver.forVisionTasks(WASM_PATH)

        const [landmarkerResult, detectorResult] = await Promise.allSettled([
          FaceLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
            runningMode: 'VIDEO',
            numFaces: 2,
            outputFaceBlendshapes: true,
            outputFacialTransformationMatrixes: true,
          }),
          ObjectDetector.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: OBJECT_MODEL_PATH, delegate: 'GPU' },
            runningMode: 'VIDEO',
            scoreThreshold: PHONE_SCORE_THRESHOLD,
            categoryAllowlist: ['cell phone'],
            maxResults: 1,
          }),
        ])

        if (cancelled || !mountedRef.current) {
          if (landmarkerResult.status === 'fulfilled') landmarkerResult.value.close()
          if (detectorResult.status === 'fulfilled') detectorResult.value.close()
          return
        }

        if (landmarkerResult.status === 'fulfilled') landmarkerRef.current = landmarkerResult.value
        if (detectorResult.status === 'fulfilled') objectDetectorRef.current = detectorResult.value

        setMonitorState(landmarkerRef.current || objectDetectorRef.current ? 'ready' : 'unavailable')
      } catch {
        if (!cancelled && mountedRef.current) setMonitorState('unavailable')
      }
    })()
    return () => {
      cancelled = true
      landmarkerRef.current?.close()
      landmarkerRef.current = null
      objectDetectorRef.current?.close()
      objectDetectorRef.current = null
    }
  }, [enabled, hasVideo])

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream
  }, [stream])

  useEffect(() => {
    if (monitorState !== 'ready' || !stream) return

    function tick() {
      if (detectingRef.current) return
      const video = videoRef.current
      const landmarker = landmarkerRef.current
      const detector = objectDetectorRef.current
      if (!video || (!landmarker && !detector) || video.readyState < 2) return
      detectingRef.current = true
      try {
        const now = performance.now()
        const flag = onFlagRef.current

        if (landmarker) {
          const result = landmarker.detectForVideo(video, now)
          const count = result.faceLandmarks?.length ?? 0

          if (count === 0) {
            noFaceStreakRef.current += 1
            multiFaceStreakRef.current = 0
            if (noFaceStreakRef.current >= NO_FACE_DEBOUNCE_CHECKS && faceStateRef.current !== 'no_face') {
              faceStateRef.current = 'no_face'
              flag('no_face_detected')
            }
          } else if (count === 1) {
            noFaceStreakRef.current = 0
            multiFaceStreakRef.current = 0
            if (faceStateRef.current !== 'ok') {
              faceStateRef.current = 'ok'
              flag('face_detected')
            }
          } else {
            noFaceStreakRef.current = 0
            multiFaceStreakRef.current += 1
            if (multiFaceStreakRef.current >= MULTI_FACE_DEBOUNCE_CHECKS && faceStateRef.current !== 'multiple') {
              faceStateRef.current = 'multiple'
              flag('multiple_faces_detected')
            }
          }

          if (count === 1) {
            const shapes = result.faceBlendshapes?.[0]?.categories ?? []
            const shapeScore = (name: string) =>
              shapes.find(c => c.categoryName === name)?.score ?? 0

            const eyesAside = Math.max(
              Math.min(shapeScore('eyeLookOutLeft'), shapeScore('eyeLookInRight')),
              Math.min(shapeScore('eyeLookInLeft'), shapeScore('eyeLookOutRight')),
              Math.min(shapeScore('eyeLookUpLeft'), shapeScore('eyeLookUpRight')),
              Math.min(shapeScore('eyeLookDownLeft'), shapeScore('eyeLookDownRight')),
            )

            const matrix = result.facialTransformationMatrixes?.[0]?.data
            let headTurned = false
            if (matrix && matrix.length >= 16) {
              const { yaw, pitch } = headAngles(Array.from(matrix))
              headTurned = Math.abs(yaw) > HEAD_YAW_LIMIT || Math.abs(pitch) > HEAD_PITCH_LIMIT
            }

            if (headTurned || eyesAside > EYE_LOOK_LIMIT) {
              gazeStreakRef.current += 1
              onScreenStreakRef.current = 0
              if (gazeStreakRef.current >= GAZE_DEBOUNCE_CHECKS && !gazeOffRef.current) {
                gazeOffRef.current = true
                flag('gaze_off_screen')
              }
            } else {
              gazeStreakRef.current = 0
              onScreenStreakRef.current += 1
              if (onScreenStreakRef.current >= 2 && gazeOffRef.current) {
                gazeOffRef.current = false
                flag('gaze_on_screen')
              }
            }
          }

          if (count === 1) {
            const points = result.faceLandmarks[0]
            const signature = computeFaceSignature(points, video.videoWidth, video.videoHeight)
            if (signature) {
              if (!identityReferenceRef.current) {
                identitySamplesRef.current.push(signature)
                if (identitySamplesRef.current.length >= IDENTITY_REFERENCE_SAMPLE_TICKS) {
                  identityReferenceRef.current = averageFaceSignatures(identitySamplesRef.current)
                  identitySamplesRef.current = []
                }
              } else {
                const mismatchAmount = faceSignatureDistance(signature, identityReferenceRef.current)
                if (mismatchAmount > IDENTITY_MISMATCH_THRESHOLD) {
                  identityMismatchStreakRef.current += 1
                  identityMatchStreakRef.current = 0
                  if (
                    identityMismatchStreakRef.current >= IDENTITY_MISMATCH_DEBOUNCE_CHECKS &&
                    !identityMismatchFlaggedRef.current
                  ) {
                    identityMismatchFlaggedRef.current = true
                    flag('identity_mismatch')
                  }
                } else {
                  identityMismatchStreakRef.current = 0
                  identityMatchStreakRef.current += 1
                  if (identityMatchStreakRef.current >= IDENTITY_MISMATCH_CLEAR_CHECKS) {
                    identityMismatchFlaggedRef.current = false
                  }
                }
              }
            }
          }
        }

        if (detector) {
          const objResult = detector.detectForVideo(video, now)
          const phoneVisible = (objResult.detections?.length ?? 0) > 0

          if (phoneVisible) {
            phoneStreakRef.current += 1
            phoneClearStreakRef.current = 0
            if (phoneStreakRef.current >= PHONE_DEBOUNCE_CHECKS && !phoneFlaggedRef.current) {
              phoneFlaggedRef.current = true
              flag('phone_detected')
            }
          } else {
            phoneStreakRef.current = 0
            phoneClearStreakRef.current += 1
            if (phoneClearStreakRef.current >= PHONE_CLEAR_CHECKS) {
              phoneFlaggedRef.current = false
            }
          }
        }
      } catch {
      } finally {
        detectingRef.current = false
      }
    }

    intervalRef.current = setInterval(tick, DETECT_INTERVAL_MS)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [monitorState, stream])

  if (monitorState === 'disabled' || monitorState === 'unavailable') {
    if (headless) return null
    return (
      <div className="proctor-monitor proctor-notice">
        <span className="proctor-notice-icon">📷</span>
        <span className="proctor-notice-text">
          {monitorState === 'disabled'
            ? 'Camera-based integrity monitoring is off. Your interview continues normally.'
            : 'Proctoring monitor unavailable in this browser. Your interview continues normally.'}
        </span>
      </div>
    )
  }

  return (
    <div className={`proctor-monitor${headless ? ' proctor-monitor-headless' : ''}`}>
      <video ref={videoRef} className="proctor-video" autoPlay playsInline muted />
      {!headless && (
        <div className="proctor-label">
          {monitorState === 'initializing' ? 'Starting monitor…' : 'Proctoring active'}
        </div>
      )}
    </div>
  )
}
