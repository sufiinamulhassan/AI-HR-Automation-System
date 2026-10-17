import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ResumeUpload from './ResumeUpload'

vi.mock('../../../lib/api', () => ({
  jobsApi: { list: vi.fn().mockResolvedValue({ data: { jobs: [] } }) },
  resumesApi: { upload: vi.fn() },
}))

vi.mock('../../../store/upload.store', () => ({
  useUploadStore: (select: (state: Record<string, unknown>) => unknown) =>
    select({ batch: null, uploading: false, error: null, startUpload: vi.fn() }),
}))

const pick = (name: string) => new File(['x'], name)

describe('ResumeUpload file filter', () => {
  it('says which formats it takes and offers them in the picker', () => {
    const { container } = render(<ResumeUpload />)
    expect(screen.getByText('PDF, DOC & DOCX supported')).toBeInTheDocument()
    expect(container.querySelector('input[type="file"]')).toHaveAttribute('accept', '.pdf,.doc,.docx')
  })

  it('takes PDF, DOC and DOCX files and ignores everything else', async () => {
    const { container } = render(<ResumeUpload />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, {
      target: {
        files: [
          pick('report.doc'), pick('cv.PDF'), pick('Resume.docx'),
          pick('notes.txt'), pick('~$report.doc'), pick('._report.doc'), pick('.hidden.docx'),
        ],
      },
    })
    expect(await screen.findByText('3 files selected')).toBeInTheDocument()
    expect(screen.getByText('report.doc')).toBeInTheDocument()
    expect(screen.getByText('cv.PDF')).toBeInTheDocument()
    expect(screen.getByText('Resume.docx')).toBeInTheDocument()
    expect(screen.queryByText('notes.txt')).not.toBeInTheDocument()
    expect(screen.queryByText('~$report.doc')).not.toBeInTheDocument()
  })
})
