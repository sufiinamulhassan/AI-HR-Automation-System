import { Fragment } from 'react'
import { Link } from 'react-router-dom'
import { tokenizeInline, type Block } from './blockModel'

export function Inline({ text }: { text: string }) {
  return (
    <>
      {tokenizeInline(text).map((token, i) => {
        if (token.kind === 'bold') return <strong key={i}>{token.text}</strong>
        if (token.kind === 'code') return <code key={i}>{token.text}</code>
        if (token.kind === 'link') {
          if (token.href.startsWith('/')) return <Link key={i} to={token.href}>{token.text}</Link>
          const external = token.href.startsWith('https://')
          return (
            <a key={i} href={token.href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
              {token.text}
            </a>
          )
        }
        return <Fragment key={i}>{token.text}</Fragment>
      })}
    </>
  )
}

export function DataTable({ head, rows, caption }: { head: string[]; rows: string[][]; caption?: string }) {
  return (
    <div className="xv-table-wrap" tabIndex={0} role="region" aria-label={caption || 'Table'}>
      <table className="xv-table">
        {caption && <caption>{caption}</caption>}
        <thead>
          <tr>{head.map(cell => <th key={cell} scope="col"><Inline text={cell} /></th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (c === 0
                ? <th key={c} scope="row"><Inline text={cell} /></th>
                : <td key={c}><Inline text={cell} /></td>))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'p':
            return <p key={i}><Inline text={block.text} /></p>
          case 'h3':
            return <h3 key={i}>{block.text}</h3>
          case 'ul':
            return <ul key={i}>{block.items.map((item, n) => <li key={n}><Inline text={item} /></li>)}</ul>
          case 'ol':
            return <ol key={i}>{block.items.map((item, n) => <li key={n}><Inline text={item} /></li>)}</ol>
          case 'note':
            return <aside key={i} className="xv-note"><Inline text={block.text} /></aside>
          case 'table':
            return <DataTable key={i} head={block.head} rows={block.rows} caption={block.caption} />
        }
      })}
    </>
  )
}
