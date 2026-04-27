import fs from 'node:fs'
import path from 'node:path'
import * as cheerio from 'cheerio'
import { decodeBig5 } from '../src/iccf/encoding'

// Chrome's "Save Page As → Webpage Complete" wraps the original source in a
// view-source table. Each line of original HTML lives in a
// <td class="line-content"> cell with HTML entities and span markup.
// We reconstruct the original by reading each cell's text() (which decodes
// entities and strips spans) and joining with newlines.

function extract(filePath: string): string {
  const raw = fs.readFileSync(filePath)
  const html = decodeBig5(raw)
  const $ = cheerio.load(html)

  const cells = $('td.line-content')
  if (cells.length === 0) {
    // Not a view-source dump — return decoded HTML as-is.
    return html
  }

  const lines: string[] = []
  cells.each((_, el) => {
    lines.push($(el).text())
  })
  return lines.join('\n')
}

const root = path.resolve(__dirname, '../..')
const targets = [
  'iccf-add-form.html',
  'iccf-search-found.html',
  'iccf-search-notfound.html',
]

for (const name of targets) {
  const src = path.join(root, name)
  const out = path.join(root, name.replace('.html', '.clean.html'))
  if (!fs.existsSync(src)) {
    console.error(`MISSING: ${src}`)
    continue
  }
  const clean = extract(src)
  fs.writeFileSync(out, clean, 'utf-8')
  console.log(`✓ ${name} → ${path.basename(out)} (${clean.length} chars)`)
}
