import { describe, expect, it } from 'vitest'
import { fillPreview } from './emailPreview'

const VALUES = { candidate_name: 'Priya <b>S</b>', job_title: 'Engineer & Lead', interview_url: 'https://app.example.com/i/1', accept_url: 'javascript:alert(1)' }

describe('fillPreview', () => {
  it('fills each known placeholder, whitespace inside the braces allowed', () => {
    expect(fillPreview('Hi {{candidate_name}} / {{ job_title }}', VALUES, false)).toBe('Hi Priya <b>S</b> / Engineer & Lead')
  })

  it('escapes a value written into HTML so it cannot add markup', () => {
    expect(fillPreview('<p>{{candidate_name}} - {{job_title}}</p>', VALUES, true))
      .toBe('<p>Priya &lt;b&gt;S&lt;/b&gt; - Engineer &amp; Lead</p>')
  })

  it('keeps a link only when it is http or https, as the sender does', () => {
    expect(fillPreview('<a href="{{interview_url}}">x</a>', VALUES, true)).toBe('<a href="https://app.example.com/i/1">x</a>')
    expect(fillPreview('<a href="{{accept_url}}">x</a>', VALUES, true)).toBe('<a href="">x</a>')
  })

  it('keeps the logo placeholder as markup but escapes the other brand values', () => {
    const values = { brand_logo_html: '<span style="color:#111">Acme</span>', brand_color: '#4778f3" onload="x' }
    expect(fillPreview('<td style="background:{{brand_color}}">{{brand_logo_html}}</td>', values, true))
      .toBe('<td style="background:#4778f3&quot; onload=&quot;x"><span style="color:#111">Acme</span></td>')
    expect(fillPreview('{{brand_logo_html}}', values, false)).toBe('<span style="color:#111">Acme</span>')
  })

  it('leaves a placeholder it does not know exactly as written', () => {
    expect(fillPreview('{{candidate_nme}} and {{ job_title }}', VALUES, true)).toBe('{{candidate_nme}} and Engineer &amp; Lead')
  })

  it('fills every occurrence and handles text with none', () => {
    expect(fillPreview('{{job_title}} {{job_title}}', { job_title: 'A' }, false)).toBe('A A')
    expect(fillPreview('plain', VALUES, true)).toBe('plain')
    expect(fillPreview('', VALUES, true)).toBe('')
  })
})
