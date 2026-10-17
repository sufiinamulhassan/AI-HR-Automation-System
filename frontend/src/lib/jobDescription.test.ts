import { describe, expect, it } from 'vitest'
import { parseDescription, withoutLeadingHeading } from './jobDescription'

const EN_DASH = String.fromCharCode(0x2013)
const EM_DASH = String.fromCharCode(0x2014)

describe('parseDescription', () => {
  it('returns nothing for empty or blank text', () => {
    expect(parseDescription('')).toEqual([])
    expect(parseDescription('  \n \r\n\t')).toEqual([])
  })

  it('turns a short line ending in a colon into a heading', () => {
    expect(parseDescription('What you will do:')).toEqual([{ type: 'heading', text: 'What you will do' }])
  })

  it('turns a markdown style second level heading into a heading', () => {
    expect(parseDescription('## Benefits')).toEqual([{ type: 'heading', text: 'Benefits' }])
  })

  it('turns a short all caps line into a heading', () => {
    expect(parseDescription('REQUIREMENTS')).toEqual([{ type: 'heading', text: 'REQUIREMENTS' }])
  })

  it('keeps a long line or a sentence that ends in a colon as a paragraph', () => {
    const long = 'This sentence is far too long to be a heading even though it ends with a colon, so it stays text:'
    expect(parseDescription(long)).toEqual([{ type: 'para', text: long }])
    expect(parseDescription('Note that this is a sentence.:')).toEqual([{ type: 'para', text: 'Note that this is a sentence.:' }])
  })

  it('groups consecutive bullet lines into one list', () => {
    expect(parseDescription('- one\n- two\n- three')).toEqual([{ type: 'list', items: ['one', 'two', 'three'] }])
  })

  it.each([
    ['a hyphen', '-'],
    ['an asterisk', '*'],
    ['a bullet dot', '•'],
    ['a middle dot', '·'],
    ['an en dash', EN_DASH],
    ['an em dash', EM_DASH],
  ])('treats %s as a bullet marker', (_name, marker) => {
    expect(parseDescription(`${marker} first\n${marker} second`)).toEqual([{ type: 'list', items: ['first', 'second'] }])
  })

  it('does not treat a hyphen inside a word as a bullet', () => {
    expect(parseDescription('well-known tools')).toEqual([{ type: 'para', text: 'well-known tools' }])
    expect(parseDescription('-no-space')).toEqual([{ type: 'para', text: '-no-space' }])
  })

  it('ignores a bullet with no text', () => {
    expect(parseDescription('- \n- real')).toEqual([{ type: 'para', text: '-' }, { type: 'list', items: ['real'] }])
  })

  it('ends a list at a blank line and starts a new one afterwards', () => {
    expect(parseDescription('- a\n- b\n\n- c')).toEqual([
      { type: 'list', items: ['a', 'b'] },
      { type: 'list', items: ['c'] },
    ])
  })

  it('ends a list at a heading or a paragraph', () => {
    expect(parseDescription('- a\nNext part:\n- b\nThen some text.')).toEqual([
      { type: 'list', items: ['a'] },
      { type: 'heading', text: 'Next part' },
      { type: 'list', items: ['b'] },
      { type: 'para', text: 'Then some text.' },
    ])
  })

  it('reads windows line endings', () => {
    expect(parseDescription('Duties:\r\n- one\r\n- two\r\n')).toEqual([
      { type: 'heading', text: 'Duties' },
      { type: 'list', items: ['one', 'two'] },
    ])
  })

  it('keeps html as plain text', () => {
    expect(parseDescription('<b>bold</b>')).toEqual([{ type: 'para', text: '<b>bold</b>' }])
  })

  it('reads a whole job description the way it is written', () => {
    const text = [
      'About the role:',
      'You will build agents.',
      '',
      'Second paragraph.',
      '',
      'What you will do:',
      '- Design workflows',
      '- Write tests',
      '',
      'What you bring:',
      '- Python',
      '',
      'We welcome applicants of every background.',
    ].join('\n')
    expect(parseDescription(text)).toEqual([
      { type: 'heading', text: 'About the role' },
      { type: 'para', text: 'You will build agents.' },
      { type: 'para', text: 'Second paragraph.' },
      { type: 'heading', text: 'What you will do' },
      { type: 'list', items: ['Design workflows', 'Write tests'] },
      { type: 'heading', text: 'What you bring' },
      { type: 'list', items: ['Python'] },
      { type: 'para', text: 'We welcome applicants of every background.' },
    ])
  })
})

describe('withoutLeadingHeading', () => {
  const blocks = parseDescription('About the role:\nText.\n\nAbout the role:\nAgain.')

  it('drops a first heading that matches the title, ignoring case and spacing', () => {
    expect(withoutLeadingHeading(blocks, '  about THE role ')[0]).toEqual({ type: 'para', text: 'Text.' })
  })

  it('only drops the first heading, not a later one', () => {
    const rest = withoutLeadingHeading(blocks, 'About the role')
    expect(rest.filter(b => b.type === 'heading')).toHaveLength(1)
  })

  it('keeps a first heading with a different name', () => {
    expect(withoutLeadingHeading(blocks, 'Overview')).toEqual(blocks)
  })

  it('keeps text that merely starts with the title and handles empty input', () => {
    const para = parseDescription('About the role is a sentence that is long enough to be text, not a heading.')
    expect(withoutLeadingHeading(para, 'About the role')).toEqual(para)
    expect(withoutLeadingHeading([], 'About the role')).toEqual([])
  })
})
