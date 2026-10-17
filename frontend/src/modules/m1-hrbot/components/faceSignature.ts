export interface FaceLandmarkPoint {
  x: number
  y: number
  z: number
}

const L_EYE_OUTER = 33
const L_EYE_INNER = 133
const R_EYE_INNER = 362
const R_EYE_OUTER = 263
const NOSE_BRIDGE = 168
const NOSE_TIP = 1
const FOREHEAD = 10
const L_CHEEK = 234
const R_CHEEK = 454

const SIGNATURE_PAIRS: Array<[number, number]> = [
  [L_EYE_INNER, R_EYE_INNER],
  [L_EYE_OUTER, L_EYE_INNER],
  [R_EYE_INNER, R_EYE_OUTER],
  [NOSE_BRIDGE, NOSE_TIP],
  [L_CHEEK, R_CHEEK],
  [FOREHEAD, NOSE_TIP],
  [L_EYE_OUTER, NOSE_TIP],
  [R_EYE_OUTER, NOSE_TIP],
]

const MAX_LANDMARK_INDEX = Math.max(...SIGNATURE_PAIRS.flat(), L_EYE_OUTER, R_EYE_OUTER)

export function computeFaceSignature(
  landmarks: FaceLandmarkPoint[] | null | undefined,
  width: number,
  height: number
): number[] | null {
  if (!Array.isArray(landmarks) || landmarks.length <= MAX_LANDMARK_INDEX || width <= 0 || height <= 0) return null
  const point = (i: number) => {
    const l = landmarks[i]
    if (!l || typeof l.x !== 'number' || typeof l.y !== 'number' || typeof l.z !== 'number') return null
    return { x: l.x * width, y: l.y * height, z: l.z * width }
  }
  const distance = (a: number, b: number) => {
    const pa = point(a)
    const pb = point(b)
    if (!pa || !pb) return null
    return Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z)
  }
  const interOcular = distance(L_EYE_OUTER, R_EYE_OUTER)
  if (!interOcular || !(interOcular > 1e-6)) return null
  const result: number[] = []
  for (const [a, b] of SIGNATURE_PAIRS) {
    const d = distance(a, b)
    if (d === null) return null
    result.push(d / interOcular)
  }
  return result
}

export function averageFaceSignatures(samples: number[][]): number[] | null {
  if (!samples.length) return null
  const length = samples[0].length
  return Array.from(
    { length },
    (_, i) => samples.reduce((sum, sample) => sum + sample[i], 0) / samples.length
  )
}

export function faceSignatureDistance(a: number[] | null, b: number[] | null): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0
  let total = 0
  for (let i = 0; i < a.length; i++) {
    total += Math.abs(a[i] - b[i]) / Math.max(Math.abs(b[i]), 1e-6)
  }
  return total / a.length
}
