import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_ZOOM, MIN_ZOOM, OUTPUT_MAX, OUTPUT_MIN, STAGE, START_CROP, cropToBlob, offsetFor, outputSize, reach, scaleFor,
  settle, shareOf, sourceRect, zoomTo,
} from './avatarCrop'

afterEach(() => vi.restoreAllMocks())

describe('scale and reach', () => {
  it('covers the stage on the short side and grows with zoom', () => {
    expect(scaleFor(800, 600, 1)).toBeCloseTo(STAGE / 600, 6)
    expect(scaleFor(800, 600, 2)).toBeCloseTo((STAGE / 600) * 2, 6)
    expect(scaleFor(300, 900, 1)).toBeCloseTo(STAGE / 300, 6)
  })

  it('lets a wide photo move sideways but not up and down until it is zoomed', () => {
    const flat = reach(800, 600, 1)
    expect(flat.y).toBe(0)
    expect(flat.x).toBeCloseTo((800 * (STAGE / 600) - STAGE) / 2, 6)
    const zoomed = reach(800, 600, 2)
    expect(zoomed.y).toBeCloseTo((600 * (STAGE / 600) * 2 - STAGE) / 2, 6)
  })

  it('gives a square photo no room at all at the start', () => {
    expect(reach(500, 500, 1)).toEqual({ x: 0, y: 0 })
  })
})

describe('settle', () => {
  it('keeps the zoom between the minimum and the maximum', () => {
    expect(settle({ zoom: 0.2, x: 0, y: 0 }, 800, 600).zoom).toBe(MIN_ZOOM)
    expect(settle({ zoom: 9, x: 0, y: 0 }, 800, 600).zoom).toBe(MAX_ZOOM)
  })

  it('keeps the photo covering the whole stage', () => {
    const limit = reach(800, 600, 2)
    const far = settle({ zoom: 2, x: 5000, y: -5000 }, 800, 600)
    expect(far.x).toBeCloseTo(limit.x, 6)
    expect(far.y).toBeCloseTo(-limit.y, 6)
    expect(settle({ zoom: 1, x: 40, y: 40 }, 500, 500)).toEqual({ zoom: 1, x: 0, y: 0 })
  })
})

describe('zoomTo', () => {
  it('keeps the same part of the photo in view while zooming', () => {
    const next = zoomTo({ zoom: 1, x: 20, y: 0 }, 2, 800, 600)
    expect(next.zoom).toBe(2)
    expect(next.x).toBeCloseTo(40, 6)
  })

  it('pulls the photo back inside the stage when zooming out', () => {
    const out = zoomTo({ zoom: 3, x: 300, y: 300 }, 1, 800, 600)
    expect(out.zoom).toBe(1)
    expect(out.y).toBe(0)
    expect(out.x).toBeLessThanOrEqual(reach(800, 600, 1).x + 1e-9)
  })
})

describe('up and down share', () => {
  it('maps the top of the photo to 0 and the bottom to 1', () => {
    expect(shareOf(100, 100)).toBe(0)
    expect(shareOf(-100, 100)).toBe(1)
    expect(shareOf(0, 100)).toBe(0.5)
  })

  it('says the middle when there is nothing to move', () => {
    expect(shareOf(0, 0)).toBe(0.5)
  })

  it('turns a share back into the offset it came from', () => {
    for (const share of [0, 0.25, 0.5, 0.8, 1]) {
      expect(shareOf(offsetFor(share, 140), 140)).toBeCloseTo(share, 9)
    }
    expect(offsetFor(0, 100)).toBe(100)
    expect(offsetFor(1, 100)).toBe(-100)
    expect(offsetFor(2, 100)).toBe(-100)
    expect(offsetFor(-1, 100)).toBe(100)
  })
})

describe('sourceRect', () => {
  it('takes the middle square of a wide photo at the start', () => {
    const rect = sourceRect(START_CROP, 800, 600)
    expect(rect.size).toBeCloseTo(600, 6)
    expect(rect.x).toBeCloseTo(100, 6)
    expect(rect.y).toBeCloseTo(0, 6)
  })

  it('takes all of a square photo at the start', () => {
    const rect = sourceRect(START_CROP, 500, 500)
    expect(rect.x).toBeCloseTo(0, 6)
    expect(rect.y).toBeCloseTo(0, 6)
    expect(rect.size).toBeCloseTo(500, 6)
  })

  it('shows the top of the photo when it is zoomed and moved all the way down', () => {
    const limit = reach(800, 600, 2)
    const rect = sourceRect({ zoom: 2, x: 0, y: limit.y }, 800, 600)
    expect(rect.y).toBeCloseTo(0, 6)
    expect(rect.size).toBeCloseTo(300, 6)
  })

  it('shows the bottom of the photo when it is zoomed and moved all the way up', () => {
    const limit = reach(800, 600, 2)
    const rect = sourceRect({ zoom: 2, x: 0, y: -limit.y }, 800, 600)
    expect(rect.y + rect.size).toBeCloseTo(600, 6)
  })
})

describe('outputSize', () => {
  it('never upscales a small crop by much and never exceeds the largest size', () => {
    expect(outputSize(50)).toBe(OUTPUT_MIN)
    expect(outputSize(300.4)).toBe(300)
    expect(outputSize(900)).toBe(OUTPUT_MAX)
  })
})

describe('cropToBlob', () => {
  function fakeImage(width: number, height: number) {
    return { naturalWidth: width, naturalHeight: height } as unknown as HTMLImageElement
  }

  function stubCanvas(blob: Blob | null) {
    const context = { drawImage: vi.fn(), fillRect: vi.fn(), fillStyle: '' }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback: BlobCallback) {
      callback(blob)
    })
    return { context, toBlob }
  }

  it('draws the chosen square into a square canvas and returns the encoded photo', async () => {
    const png = new Blob(['x'], { type: 'image/png' })
    const { context, toBlob } = stubCanvas(png)
    const result = await cropToBlob(fakeImage(800, 600), START_CROP, 'image/png')
    expect(result).toBe(png)
    expect(context.drawImage).toHaveBeenCalledTimes(1)
    const call = context.drawImage.mock.calls[0]
    expect(call[1]).toBeCloseTo(100, 6)
    expect(call[2]).toBeCloseTo(0, 6)
    expect(call[3]).toBeCloseTo(600, 6)
    expect(call[4]).toBeCloseTo(600, 6)
    expect(call[5]).toBe(0)
    expect(call[6]).toBe(0)
    expect(call[7]).toBe(OUTPUT_MAX)
    expect(call[8]).toBe(OUTPUT_MAX)
    expect(toBlob.mock.calls[0][1]).toBe('image/png')
    expect(context.fillRect).not.toHaveBeenCalled()
  })

  it('puts a white background behind a JPEG so transparent areas do not turn black', async () => {
    const { context } = stubCanvas(new Blob(['x'], { type: 'image/jpeg' }))
    await cropToBlob(fakeImage(400, 400), START_CROP, 'image/jpeg')
    expect(context.fillStyle).toBe('#ffffff')
    expect(context.fillRect).toHaveBeenCalled()
  })

  it('keeps a crop that was dragged too far inside the photo', async () => {
    const { context } = stubCanvas(new Blob(['x'], { type: 'image/png' }))
    await cropToBlob(fakeImage(800, 600), { zoom: 2, x: 9999, y: 9999 }, 'image/png')
    const call = context.drawImage.mock.calls[0]
    expect(call[1]).toBeGreaterThanOrEqual(0)
    expect(call[2]).toBeGreaterThanOrEqual(0)
    expect(call[1] + call[3]).toBeLessThanOrEqual(800 + 1e-6)
    expect(call[2] + call[4]).toBeLessThanOrEqual(600 + 1e-6)
  })

  it('says so when the browser cannot encode the photo', async () => {
    stubCanvas(null)
    await expect(cropToBlob(fakeImage(400, 400), START_CROP, 'image/png')).rejects.toThrow('could not be prepared')
  })

  it('says so when there is no canvas', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    await expect(cropToBlob(fakeImage(400, 400), START_CROP, 'image/png')).rejects.toThrow('Canvas is not available')
  })
})
