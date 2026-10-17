export type DescriptionBlock =
  | { type: 'heading'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'para'; text: string }

const BULLET_MARKS = `-*\u2022\u00b7${String.fromCharCode(0x2013, 0x2014)}`
const BULLET_RE = new RegExp(`^\\s*[${BULLET_MARKS}]\\s+`)

export function parseDescription(raw: string): DescriptionBlock[] {
  const lines = raw.split(/\r?\n/)
  const blocks: DescriptionBlock[] = []
  let list: string[] | null = null

  const flushList = () => {
    if (list && list.length) blocks.push({ type: 'list', items: list })
    list = null
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) { flushList(); continue }

    if (line.startsWith('## ')) {
      flushList()
      blocks.push({ type: 'heading', text: line.slice(3).trim() })
      continue
    }

    if (BULLET_RE.test(line)) {
      const item = line.replace(BULLET_RE, '').trim()
      if (item) (list ??= []).push(item)
      continue
    }

    flushList()

    const noColon = line.replace(/:$/, '')
    const isColonHead = /:$/.test(line) && line.length <= 70 && !/[.!?]/.test(noColon)
    const isCapsHead = line.length <= 60 && /[A-Za-z]/.test(line) && /^[A-Z0-9][A-Z0-9 &/'’()-]+$/.test(line)
    blocks.push(isColonHead || isCapsHead ? { type: 'heading', text: noColon } : { type: 'para', text: line })
  }
  flushList()
  return blocks
}

export function withoutLeadingHeading(blocks: DescriptionBlock[], title: string): DescriptionBlock[] {
  const first = blocks[0]
  if (first && first.type === 'heading' && first.text.trim().toLowerCase() === title.trim().toLowerCase()) {
    return blocks.slice(1)
  }
  return blocks
}
