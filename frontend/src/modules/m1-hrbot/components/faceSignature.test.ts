import { describe, expect, it } from 'vitest'
import { averageFaceSignatures, computeFaceSignature, faceSignatureDistance, type FaceLandmarkPoint } from './faceSignature'

function mesh(points: Record<number, [number, number, number]>, shift = 0, scale = 1): FaceLandmarkPoint[] {
  const pts: FaceLandmarkPoint[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }))
  for (const [index, [x, y, z]] of Object.entries(points)) {
    pts[Number(index)] = { x: 0.5 + (x - 0.5) * scale + shift, y: 0.5 + (y - 0.5) * scale + shift, z: z * scale }
  }
  return pts
}

const PERSON_A: Record<number, [number, number, number]> = {
  33: [0.40, 0.45, 0], 133: [0.46, 0.45, 0], 362: [0.54, 0.45, 0], 263: [0.60, 0.45, 0],
  168: [0.50, 0.44, -0.02], 1: [0.50, 0.55, -0.05], 10: [0.50, 0.30, 0], 234: [0.35, 0.50, 0.03], 454: [0.65, 0.50, 0.03],
}
const PERSON_B: Record<number, [number, number, number]> = {
  33: [0.39, 0.45, 0], 133: [0.47, 0.45, 0], 362: [0.53, 0.45, 0], 263: [0.61, 0.45, 0],
  168: [0.50, 0.43, -0.02], 1: [0.50, 0.60, -0.06], 10: [0.50, 0.26, 0], 234: [0.37, 0.50, 0.03], 454: [0.63, 0.50, 0.03],
}
const PERSON_A_TALKING: Record<number, [number, number, number]> = {
  ...PERSON_A, 13: [0.5, 0.62, 0], 14: [0.5, 0.68, 0], 152: [0.5, 0.75, 0.01],
}

describe('computeFaceSignature', () => {
  it('is near-zero between two frames of the same synthetic face', () => {
    const a = computeFaceSignature(mesh(PERSON_A), 1280, 720)!
    const b = computeFaceSignature(mesh(PERSON_A), 1280, 720)!
    expect(faceSignatureDistance(a, b)).toBe(0)
  })

  it('ignores where the face sits in frame and how close it is to the camera', () => {
    const near = computeFaceSignature(mesh(PERSON_A, 0, 1.3), 1280, 720)!
    const far = computeFaceSignature(mesh(PERSON_A, 0.05, 0.7), 1280, 720)!
    expect(faceSignatureDistance(near, far)).toBeLessThan(0.01)
  })

  it('measures a large distance between two meaningfully different faces', () => {
    const a = computeFaceSignature(mesh(PERSON_A), 1280, 720)!
    const b = computeFaceSignature(mesh(PERSON_B), 1280, 720)!
    expect(faceSignatureDistance(b, a)).toBeGreaterThan(0.12)
  })

  it('is unaffected by mouth/chin movement alone (talking, smiling)', () => {
    const still = computeFaceSignature(mesh(PERSON_A), 1280, 720)!
    const talking = computeFaceSignature(mesh(PERSON_A_TALKING), 1280, 720)!
    expect(faceSignatureDistance(talking, still)).toBe(0)
  })

  it('returns null for incomplete landmarks, a missing face, or a degenerate frame size', () => {
    expect(computeFaceSignature([], 1280, 720)).toBeNull()
    expect(computeFaceSignature(null, 1280, 720)).toBeNull()
    expect(computeFaceSignature(mesh(PERSON_A), 0, 720)).toBeNull()
    expect(computeFaceSignature(mesh(PERSON_A), 1280, 0)).toBeNull()
  })
})

describe('averageFaceSignatures', () => {
  it('averages several samples element-wise', () => {
    expect(averageFaceSignatures([[1, 2], [3, 4]])).toEqual([2, 3])
  })

  it('returns null for an empty sample set', () => {
    expect(averageFaceSignatures([])).toBeNull()
  })
})

describe('faceSignatureDistance', () => {
  it('returns 0 for mismatched or empty inputs rather than throwing', () => {
    expect(faceSignatureDistance(null, [1])).toBe(0)
    expect(faceSignatureDistance([1], null)).toBe(0)
    expect(faceSignatureDistance([1, 2], [1])).toBe(0)
    expect(faceSignatureDistance([], [])).toBe(0)
  })
})
