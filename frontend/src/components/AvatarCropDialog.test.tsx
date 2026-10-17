import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import AvatarCropDialog from './AvatarCropDialog'

const draw = vi.fn()
const fill = vi.fn()

class TestPointerEvent extends MouseEvent {
  pointerId: number

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 0
  }
}

beforeAll(() => {
  vi.stubGlobal('PointerEvent', TestPointerEvent)
})

afterAll(() => {
  vi.unstubAllGlobals()
})

beforeEach(() => {
  draw.mockReset()
  fill.mockReset()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: draw, fillRect: fill, fillStyle: '' } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback: BlobCallback, type?: string) {
    callback(new Blob(['cropped'], { type }))
  })
})

afterEach(() => vi.restoreAllMocks())

function open(props: Partial<React.ComponentProps<typeof AvatarCropDialog>> = {}) {
  const onSave = vi.fn()
  const onCancel = vi.fn()
  const view = render(<AvatarCropDialog src="data:image/png;base64,AAAA" type="image/png" onSave={onSave} onCancel={onCancel} {...props} />)
  return { onSave, onCancel, ...view }
}

function loadPhoto(width = 800, height = 600) {
  const img = screen.getByAltText('Photo being edited')
  Object.defineProperty(img, 'naturalWidth', { value: width, configurable: true })
  Object.defineProperty(img, 'naturalHeight', { value: height, configurable: true })
  fireEvent.load(img)
  return img
}

const stage = () => screen.getByRole('group', { name: /Photo position/ })
const slider = (name: string) => screen.getByLabelText(name) as HTMLInputElement

async function save() {
  await userEvent.click(screen.getByRole('button', { name: 'Save photo' }))
  await waitFor(() => expect(draw).toHaveBeenCalled())
  return draw.mock.calls[draw.mock.calls.length - 1] as number[]
}

describe('AvatarCropDialog', () => {
  it('is a labelled dialog that holds the photo, the three sliders and the buttons', () => {
    open()
    const dialog = screen.getByRole('dialog', { name: 'Edit your photo' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByAltText('Photo being edited')).toHaveAttribute('src', 'data:image/png;base64,AAAA')
    ;['Zoom', 'Up and down', 'Left and right'].forEach(name => expect(slider(name)).toBeInTheDocument())
    ;['Reset', 'Cancel', 'Save photo'].forEach(name => expect(screen.getByRole('button', { name })).toBeInTheDocument())
  })

  it('is attached to the page body so no card around it can clip it', () => {
    const { container } = open()
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()
  })

  it('cannot be saved until the photo has loaded', () => {
    open()
    expect(screen.getByRole('button', { name: 'Save photo' })).toBeDisabled()
    expect(slider('Zoom')).toBeDisabled()
    loadPhoto()
    expect(screen.getByRole('button', { name: 'Save photo' })).toBeEnabled()
    expect(slider('Zoom')).toBeEnabled()
  })

  it('says so when the photo cannot be read', () => {
    open()
    loadPhoto(0, 0)
    expect(screen.getByRole('alert')).toHaveTextContent('could not be read')
    expect(screen.getByRole('button', { name: 'Save photo' })).toBeDisabled()
  })

  it('saves the middle square of the photo when nothing was moved', async () => {
    const { onSave } = open()
    loadPhoto()
    const call = await save()
    expect(call[1]).toBeCloseTo(100, 4)
    expect(call[2]).toBeCloseTo(0, 4)
    expect(call[3]).toBeCloseTo(600, 4)
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    const file = onSave.mock.calls[0][0] as File
    expect(file).toBeInstanceOf(File)
    expect(file.name).toBe('avatar.png')
    expect(file.type).toBe('image/png')
  })

  it('names a JPEG photo as a JPEG', async () => {
    const { onSave } = open({ type: 'image/jpeg' })
    loadPhoto()
    await save()
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    const file = onSave.mock.calls[0][0] as File
    expect(file.name).toBe('avatar.jpg')
    expect(file.type).toBe('image/jpeg')
  })

  it('treats any other type as PNG', async () => {
    const { onSave } = open({ type: 'image/gif' })
    loadPhoto()
    await save()
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect((onSave.mock.calls[0][0] as File).type).toBe('image/png')
  })

  it('offers up and down only once the photo is zoomed in, when it is wider than tall', () => {
    open()
    loadPhoto(800, 600)
    expect(slider('Up and down')).toBeDisabled()
    expect(slider('Left and right')).toBeEnabled()
    fireEvent.change(slider('Zoom'), { target: { value: '2' } })
    expect(slider('Up and down')).toBeEnabled()
    expect(slider('Up and down').value).toBe('50')
  })

  it('moves the crop to the top of the photo with the up and down slider', async () => {
    open()
    loadPhoto(800, 600)
    fireEvent.change(slider('Zoom'), { target: { value: '2' } })
    fireEvent.change(slider('Up and down'), { target: { value: '0' } })
    const call = await save()
    expect(call[2]).toBeCloseTo(0, 4)
    expect(call[3]).toBeCloseTo(300, 4)
  })

  it('moves the crop to the bottom of the photo with the up and down slider', async () => {
    open()
    loadPhoto(800, 600)
    fireEvent.change(slider('Zoom'), { target: { value: '2' } })
    fireEvent.change(slider('Up and down'), { target: { value: '100' } })
    const call = await save()
    expect(call[2] + call[4]).toBeCloseTo(600, 4)
  })

  it('moves the crop sideways with the left and right slider', async () => {
    open()
    loadPhoto(800, 600)
    fireEvent.change(slider('Left and right'), { target: { value: '0' } })
    const call = await save()
    expect(call[1]).toBeCloseTo(0, 4)
  })

  it('zooms in on the middle of the photo', async () => {
    open()
    loadPhoto(800, 600)
    fireEvent.change(slider('Zoom'), { target: { value: '2' } })
    const call = await save()
    expect(call[3]).toBeCloseTo(300, 4)
    expect(call[1]).toBeCloseTo(250, 4)
    expect(call[2]).toBeCloseTo(150, 4)
  })

  it('moves the photo with the arrow keys and moves further with Shift', async () => {
    open()
    loadPhoto(800, 600)
    fireEvent.change(slider('Zoom'), { target: { value: '2' } })
    const before = slider('Up and down').value
    stage().focus()
    fireEvent.keyDown(stage(), { key: 'ArrowUp' })
    const afterOne = Number(slider('Up and down').value)
    expect(afterOne).toBeGreaterThan(Number(before))
    fireEvent.keyDown(stage(), { key: 'ArrowUp', shiftKey: true })
    expect(Number(slider('Up and down').value)).toBeGreaterThan(afterOne)
  })

  it('ignores other keys', () => {
    open()
    loadPhoto(800, 600)
    fireEvent.change(slider('Zoom'), { target: { value: '2' } })
    const before = slider('Up and down').value
    fireEvent.keyDown(stage(), { key: 'a' })
    expect(slider('Up and down').value).toBe(before)
  })

  it('moves the photo when it is dragged', async () => {
    open()
    loadPhoto(800, 600)
    fireEvent.change(slider('Zoom'), { target: { value: '2' } })
    fireEvent.pointerDown(stage(), { pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(stage(), { pointerId: 1, clientX: 100, clientY: 160 })
    fireEvent.pointerUp(stage(), { pointerId: 1, clientX: 100, clientY: 160 })
    expect(Number(slider('Up and down').value)).toBeLessThan(50)
    fireEvent.pointerMove(stage(), { pointerId: 1, clientX: 100, clientY: 300 })
    expect(Number(slider('Up and down').value)).toBeLessThan(50)
    const settled = slider('Up and down').value
    fireEvent.pointerMove(stage(), { pointerId: 1, clientX: 100, clientY: 400 })
    expect(slider('Up and down').value).toBe(settled)
  })

  it('does not let the photo be dragged off the stage', () => {
    open()
    loadPhoto(800, 600)
    fireEvent.change(slider('Zoom'), { target: { value: '2' } })
    fireEvent.pointerDown(stage(), { pointerId: 1, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(stage(), { pointerId: 1, clientX: 0, clientY: 5000 })
    expect(slider('Up and down').value).toBe('0')
    fireEvent.pointerMove(stage(), { pointerId: 1, clientX: 0, clientY: -5000 })
    expect(slider('Up and down').value).toBe('100')
  })

  it('puts the photo back in the middle with Reset', async () => {
    open()
    loadPhoto(800, 600)
    fireEvent.change(slider('Zoom'), { target: { value: '2' } })
    fireEvent.change(slider('Up and down'), { target: { value: '0' } })
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(slider('Zoom').value).toBe('1')
    const call = await save()
    expect(call[1]).toBeCloseTo(100, 4)
    expect(call[2]).toBeCloseTo(0, 4)
  })

  it('cancels with the button, with Escape and by pressing outside the box', async () => {
    const { onCancel } = open()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(2)
    const backdrop = screen.getByTestId('avatar-crop-backdrop')
    fireEvent.mouseDown(backdrop)
    fireEvent.click(backdrop)
    expect(onCancel).toHaveBeenCalledTimes(3)
  })

  it('does not close while a save is in progress, and shows that it is saving', async () => {
    const { onCancel } = open({ busy: true })
    loadPhoto()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(slider('Zoom')).toBeDisabled()
  })

  it('shows an error from the caller next to the buttons', () => {
    open({ error: 'The image is too large' })
    expect(screen.getByRole('alert')).toHaveTextContent('The image is too large')
  })

  it('says so when the browser cannot prepare the photo', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback: BlobCallback) {
      callback(null)
    })
    const { onSave } = open()
    loadPhoto()
    await userEvent.click(screen.getByRole('button', { name: 'Save photo' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be prepared')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('keeps focus inside the box when Tab is pressed on the last button', async () => {
    open()
    loadPhoto()
    const last = screen.getByRole('button', { name: 'Save photo' })
    last.focus()
    await userEvent.tab()
    expect(document.activeElement).not.toBe(document.body)
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
  })
})
