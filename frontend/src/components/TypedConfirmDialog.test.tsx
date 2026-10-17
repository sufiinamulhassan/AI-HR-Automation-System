import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import TypedConfirmDialog from './TypedConfirmDialog'

function renderDialog(over: Partial<React.ComponentProps<typeof TypedConfirmDialog>> = {}) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  render(
    <TypedConfirmDialog title="Erase it?" confirmWord="ERASE" confirmLabel="Erase" onConfirm={onConfirm} onCancel={onCancel} {...over}>
      <p>What this does.</p>
    </TypedConfirmDialog>,
  )
  return { onConfirm, onCancel, user: userEvent.setup({ delay: null }) }
}

describe('TypedConfirmDialog', () => {
  it('is a labelled modal dialog with the content above the typed box', () => {
    renderDialog()
    const dialog = screen.getByRole('dialog', { name: 'Erase it?' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText('What this does.')).toBeInTheDocument()
    expect(screen.getByLabelText('Type ERASE to confirm')).toBeInTheDocument()
  })

  it('does not confirm until the word is typed exactly', async () => {
    const { onConfirm, user } = renderDialog()
    const go = screen.getByRole('button', { name: 'Erase' })
    expect(go).toBeDisabled()
    for (const wrong of ['erase', 'ERAS', 'ERASE ', ' ERASE']) {
      await user.clear(screen.getByLabelText('Type ERASE to confirm'))
      await user.type(screen.getByLabelText('Type ERASE to confirm'), wrong)
      expect(go).toBeDisabled()
    }
    await user.clear(screen.getByLabelText('Type ERASE to confirm'))
    await user.type(screen.getByLabelText('Type ERASE to confirm'), 'ERASE')
    expect(go).toBeEnabled()
    await user.click(go)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('confirms with Enter once the word is typed, and not before', async () => {
    const { onConfirm, user } = renderDialog()
    await user.type(screen.getByLabelText('Type ERASE to confirm'), 'ERAS{Enter}')
    expect(onConfirm).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText('Type ERASE to confirm'), 'E{Enter}')
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('stays disabled while a further requirement is not met, even with the word typed', async () => {
    const { user } = renderDialog({ ready: false })
    await user.type(screen.getByLabelText('Type ERASE to confirm'), 'ERASE')
    expect(screen.getByRole('button', { name: 'Erase' })).toBeDisabled()
  })

  it('cannot be confirmed or dismissed while it works', async () => {
    const { onCancel, onConfirm, user } = renderDialog({ busy: true })
    expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByLabelText('Type ERASE to confirm')).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(onCancel).not.toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('closes on Cancel and on Escape', async () => {
    const { onCancel, user } = renderDialog()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  it('shows a refusal inside the dialog', () => {
    renderDialog({ error: 'Nope.' })
    expect(screen.getByRole('alert')).toHaveTextContent('Nope.')
  })

  it('uses whatever word it is given', async () => {
    const { user, onConfirm } = renderDialog({ confirmWord: 'DELETE' })
    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE')
    await user.click(screen.getByRole('button', { name: 'Erase' }))
    expect(onConfirm).toHaveBeenCalled()
  })
})
