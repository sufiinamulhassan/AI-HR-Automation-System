const TOKEN = /\{\{\s*([a-z_]+)\s*\}\}/g

const RAW_HTML = new Set(['brand_logo_html'])

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

export function fillPreview(template: string, values: Record<string, string>, html: boolean): string {
  return template.replace(TOKEN, (match, name: string) => {
    if (!(name in values)) return match
    const value = values[name]
    if (!html) return value
    if (RAW_HTML.has(name)) return value
    if (name.endsWith('_url')) return /^https?:\/\//i.test(value) ? escapeHtml(value) : ''
    return escapeHtml(value)
  })
}
