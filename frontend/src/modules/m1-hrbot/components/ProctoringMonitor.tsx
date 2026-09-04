import { useEffect, useRef, useState } from 'react'
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import './ProctoringMonitor.css'

const WASM_PATH = '/mediapipe/wasm'
const MODEL_PATH = '/models/face_landmarker.task'

const DETECT_INTERVAL_MS = 2500
const NO_FACE_DEBOUNCE_CHECKS = 5
const MULTI_FACE_DEBOUNCE_CHECKS = 5
const GAZE_DEBOUNCE_CHECKS = 6

const HEAD_YAW_LIMIT = 0.44
const HEAD_PITCH_LIMIT = 0.44
const EYE_LOOK_LIMIT = 0.55

type FaceState = 'ok' | 'no_face' | 'multiple'
type MonitorState = 'initializing' | 'ready' | 'unavailable'

interface ProctoringMonitorProps {
  stream: MediaStream | null
  onFlag: (event: string) => void
  headless?: boolean
}

function headAngles(matrix: number[]): { yaw: number; pitch: number } {
  const r02 = matrix[8]
  const r12 = matrix[9]
  const r22 = matrix[10]
  const yaw = Math.atan2(r02, r22)
  const pitch = Math.atan2(-r12, Math.hypot(r02, r22))
  return { yaw, pitch }
}

export default function ProctoringMonitor({ stream, onFlag, headless = false }: ProctoringMonitorProps) {
  const [monitorState, setMonitorState] = useState<MonitorState>('initializing')

  const videoRef = useRef<HTMLVideoElement>(null)
  const landmarkerRef = useRef<FaceLandmarker | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const noFaceStreakRef = useRef(0)
  const multiFaceStreakRef = useRef(0)
  const gazeStreakRef = useRef(0)
  const onScreenStreakRef = useRef(0)
  const faceStateRef = useRef<FaceState>('ok')
  const gazeOffRef = useRef(false)
  const detectingRef = useRef(false)
  const mountedRef = useRef(true)
  const onFlagRef = useRef(onFlag)
  onFlagRef.current = onFlag

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const fileset = await FilesetResolver.forVisionTasks(WASM_PATH)
        const landmarker = await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numFaces: 2,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        })
        if (cancelled || !mountedRef.current) {
          landmarker.close()
          return
        }
        landmarkerRef.current = landmarker
        setMonitorState('ready')
      } catch {
        if (!cancelled && mountedRef.current) setMonitorState('unavailable')
      }
    })()
    return () => {
      cancelled = true
      landmarkerRef.current?.close()
      landmarkerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream
  }, [stream])

  useEffect(() => {
    if (monitorState !== 'ready' || !stream) return

    function tick() {
      if (detectingRef.current) return
      const video = videoRef.current
      const landmarker = landmarkerRef.current
      if (!video || !landmarker || video.readyState < 2) return
      detectingRef.current = true
      try {
        const result = landmarker.detectForVideo(video, performance.now())
        const count = result.faceLandmarks?.length ?? 0
        const flag = onFlagRef.current

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

  if (monitorState === 'unavailable') {
    if (headless) return null
    return (
      <div className="proctor-monitor proctor-notice">
        <span className="proctor-notice-icon">📷</span>
        <span className="proctor-notice-text">
          Proctoring monitor unavailable in this browser - your interview continues normally.
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
