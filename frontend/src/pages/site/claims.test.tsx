import { describe, expect, it } from 'vitest'
import Landing from '../Landing'
import FeaturesPage from './FeaturesPage'
import ResponsibleAiPage from './ResponsibleAiPage'
import SecurityPage from './SecurityPage'
import { renderPage } from './siteTestKit'

const PAGES: [string, () => JSX.Element][] = [
  ['features', () => <FeaturesPage />],
  ['responsible AI', () => <ResponsibleAiPage />],
  ['security', () => <SecurityPage />],
  ['home', () => <Landing />],
]

describe('claims that must match the product', () => {
  PAGES.forEach(([name, page]) => {
    it(`${name}: auto-invite is not described as an admin control and is called off by default`, () => {
      const { container } = renderPage(page())
      const text = container.textContent ?? ''
      const blocks = Array.from(container.querySelectorAll('p, li, article, summary, aside')).map(block => block.textContent ?? '')
      const sentences = blocks.flatMap(block => block.split(/(?<=[.!?])\s*/)).filter(sentence => /auto-invite|automatic invit/i.test(sentence))
      sentences.forEach(sentence => expect(sentence).not.toMatch(/\badmin/i))
      if (name !== 'security') expect(text).toMatch(/off by default/i)
    })

    it(`${name}: nobody is said to set score thresholds except the platform operator`, () => {
      const { container } = renderPage(page())
      const text = container.textContent ?? ''
      expect(text).not.toMatch(/admins?\s+(edit|set|adjust|change)[^.]*thresholds/i)
      expect(text).not.toMatch(/thresholds set by your admins/i)
    })
  })

  it('features and responsible AI say the integrity score adjusts the interview score', () => {
    const features = renderPage(<FeaturesPage />)
    expect(features.container.textContent).toMatch(/integrity score[\s\S]{0,80}adjusts the interview score/i)
    features.unmount()
    const responsible = renderPage(<ResponsibleAiPage />)
    expect(responsible.container.textContent).toMatch(/integrity score adjusts the interview score/i)
  })
})
