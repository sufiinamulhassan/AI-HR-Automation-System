import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import CodingWorkspace from './CodingWorkspace'
import type { CodingSessionData } from './useCodingSession'


const session: CodingSessionData = {
  question_id: 'q1',
  title: 'Reverse a linked list',
  description: 'Reverse it in place.',
  difficulty: 'medium',
  job_domain: null,
  language_templates: {
    python: '# python starter',
    javascript: '// js starter',
  },
  test_cases: [{ input: '[1,2]', expected_output: '[2,1]', is_hidden: false }],
}

function renderWorkspace(overrides: Partial<React.ComponentProps<typeof CodingWorkspace>> = {}) {
  const onSubmit = vi.fn()
  render(
    <CodingWorkspace
      session={session}
      status="active"
      errorMsg=""
      result={null}
      onSubmit={onSubmit}
      {...overrides}
    />,
  )
  return { onSubmit }
}

const editor = () => screen.getByRole('textbox', { name: /code editor/i })

describe('CodingWorkspace', () => {
  it('seeds the editor from the first language template', () => {
    renderWorkspace()
    expect(editor()).toHaveValue('# python starter')
  })

  it('keeps a separate draft per language', async () => {
    renderWorkspace()
    const select = screen.getByRole('combobox', { name: /programming language/i })

    await userEvent.clear(editor())
    await userEvent.type(editor(), 'print(1)')

    await userEvent.selectOptions(select, 'javascript')
    expect(editor()).toHaveValue('// js starter')

    await userEvent.selectOptions(select, 'python')
    expect(editor()).toHaveValue('print(1)')
  })

  it('inserts an indent on Tab instead of leaving the editor', async () => {
    renderWorkspace()
    await userEvent.clear(editor())
    await userEvent.type(editor(), 'x{Tab}')

    expect(editor()).toHaveValue('x    ')
    expect(editor()).toHaveFocus()
  })

  it('submits the current language, code, and a keystroke count', async () => {
    const { onSubmit } = renderWorkspace()
    await userEvent.clear(editor())
    await userEvent.type(editor(), 'print(1)')
    await userEvent.click(screen.getByRole('button', { name: /^run tests$/i }))

    expect(onSubmit).toHaveBeenCalledWith('python', 'print(1)', expect.any(Number))
    expect(onSubmit.mock.calls[0][2]).toBeGreaterThanOrEqual(8)
  })

  it('locks the editor once a submission is in flight or done', () => {
    renderWorkspace({ status: 'submitting' })
    expect(editor()).toBeDisabled()
    expect(screen.getByRole('button', { name: /running/i })).toBeDisabled()
  })

  it('blocks every paste - manual entry only - and reports it, but not ordinary typing', async () => {
    const onIntegrityEvent = vi.fn()
    renderWorkspace({ onIntegrityEvent })

    await userEvent.clear(editor())
    await userEvent.type(editor(), 'x = 1')
    expect(onIntegrityEvent).not.toHaveBeenCalled()

    await userEvent.click(editor())
    await userEvent.paste('y'.repeat(5))
    expect(editor()).toHaveValue('x = 1')
    expect(onIntegrityEvent).toHaveBeenCalledWith('paste_blocked')
  })

  it('blocks drag-and-drop text the same way', () => {
    const onIntegrityEvent = vi.fn()
    renderWorkspace({ onIntegrityEvent })

    fireEvent.drop(editor())
    expect(onIntegrityEvent).toHaveBeenCalledWith('drop_blocked')
  })

  it('flags a bulk text change that arrives with no matching keystrokes', () => {
    const onIntegrityEvent = vi.fn()
    renderWorkspace({ onIntegrityEvent })

    fireEvent.change(editor(), { target: { value: 'z'.repeat(200) } })
    expect(onIntegrityEvent).toHaveBeenCalledWith('paste_burst')
  })

  it('discards edits back to the starter template on Reset', async () => {
    renderWorkspace()
    await userEvent.clear(editor())
    await userEvent.type(editor(), 'print(1)')

    await userEvent.click(screen.getByRole('button', { name: /^reset$/i }))
    expect(editor()).toHaveValue('# python starter')
  })

  it('keeps Run code disabled when no run handler is provided', () => {
    renderWorkspace()
    expect(screen.getByRole('button', { name: /^run code$/i })).toBeDisabled()
  })

  it('runs the current language and code when a run handler is provided', async () => {
    const onRun = vi.fn()
    renderWorkspace({ onRun })
    await userEvent.clear(editor())
    await userEvent.type(editor(), 'print(1)')

    const runButton = screen.getByRole('button', { name: /^run code$/i })
    expect(runButton).not.toBeDisabled()
    await userEvent.click(runButton)

    expect(onRun).toHaveBeenCalledWith('python', 'print(1)')
  })

  it('shows stdout from a completed run in the Output tab', () => {
    renderWorkspace({
      runStatus: 'done',
      runResult: {
        stdin: '2 3', stdout: '5\n', stderr: '', compile_output: '',
        status: 'Accepted', time: '0.01', memory: 3600,
      },
    })
    expect(screen.getByText('5')).toBeInTheDocument()
  })
})
