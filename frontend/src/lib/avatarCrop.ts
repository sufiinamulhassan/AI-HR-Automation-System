export const STAGE = 280
export const MIN_ZOOM = 1
export const MAX_ZOOM = 3
export const OUTPUT_MAX = 512
export const OUTPUT_MIN = 128

export interface Crop {
  zoom: number
  x: number
  y: number
}

export interface SourceRect {
  x: number
  y: number
  size: number
}

export const START_CROP: Crop = { zoom: 1, x: 0, y: 0 }

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

export function scaleFor(width: number, height: number, zoom: number, stage = STAGE): number {
  return (stage / Math.min(width, height)) * zoom
}

export function reach(width: number, height: number, zoom: number, stage = STAGE): { x: number; y: number } {
  const scale = scaleFor(width, height, zoom, stage)
  return {
    x: Math.max(0, (width * scale - stage) / 2),
    y: Math.max(0, (height * scale - stage) / 2),
  }
}

export function settle(crop: Crop, width: number, height: number, stage = STAGE): Crop {
  const zoom = clamp(crop.zoom, MIN_ZOOM, MAX_ZOOM)
  const limit = reach(width, height, zoom, stage)
  return {
    zoom,
    x: clamp(crop.x, -limit.x, limit.x),
    y: clamp(crop.y, -limit.y, limit.y),
  }
}

export function zoomTo(crop: Crop, zoom: number, width: number, height: number, stage = STAGE): Crop {
  const next = clamp(zoom, MIN_ZOOM, MAX_ZOOM)
  const ratio = next / crop.zoom
  return settle({ zoom: next, x: crop.x * ratio, y: crop.y * ratio }, width, height, stage)
}

export function shareOf(offset: number, limit: number): number {
  if (limit === 0) return 0.5
  return (limit - offset) / (2 * limit)
}

export function offsetFor(share: number, limit: number): number {
  return limit * (1 - 2 * clamp(share, 0, 1))
}

export function sourceRect(crop: Crop, width: number, height: number, stage = STAGE): SourceRect {
  const scale = scaleFor(width, height, crop.zoom, stage)
  const left = stage / 2 + crop.x - (width * scale) / 2
  const top = stage / 2 + crop.y - (height * scale) / 2
  return { x: -left / scale, y: -top / scale, size: stage / scale }
}

export function outputSize(source: number): number {
  return clamp(Math.round(source), OUTPUT_MIN, OUTPUT_MAX)
}

export async function cropToBlob(
  image: CanvasImageSource & { naturalWidth: number; naturalHeight: number },
  crop: Crop,
  type: string,
): Promise<Blob> {
  const width = image.naturalWidth
  const height = image.naturalHeight
  const rect = sourceRect(settle(crop, width, height), width, height)
  const size = outputSize(rect.size)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is not available')
  if (type === 'image/jpeg') {
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, size, size)
  }
  context.drawImage(image, rect.x, rect.y, rect.size, rect.size, 0, 0, size, size)
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('The photo could not be prepared'))), type, 0.92)
  })
}
