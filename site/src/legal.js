import '@fontsource-variable/bricolage-grotesque'
import '@fontsource-variable/onest'
import '@fontsource-variable/jetbrains-mono'
import './legal.css'
import privacyEn from '../legal/privacy.en.md?raw'
import privacyPt from '../legal/privacidade.md?raw'
import privacyEs from '../legal/privacy.es.md?raw'
import termsEn from '../legal/terms.en.md?raw'
import termsPt from '../legal/termos.md?raw'
import termsEs from '../legal/terms.es.md?raw'
import licenses from '../legal/licenses.json'
import { LANG, S, rememberLanguageChoice } from './strings.js'

const DOCS = {
  privacy: { en: privacyEn, pt: privacyPt, es: privacyEs },
  terms: { en: termsEn, pt: termsPt, es: termsEs }
}

const docName = document.body.dataset.doc
const main = document.getElementById('doc')
rememberLanguageChoice()

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const inline = (s) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[(.+?)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" rel="noreferrer">$1</a>')

/** The small Markdown subset the legal files use: headings, paragraphs, lists, tables, bold, links. */
function markdown(src) {
  const out = []
  const lines = src.split(/\r?\n/)
  for (let i = 0; i < lines.length; ) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line)
    if (h) {
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`)
      i++
    } else if (line.startsWith('|')) {
      const rows = []
      while (i < lines.length && lines[i].startsWith('|')) {
        const cells = lines[i].split('|').slice(1, -1).map((c) => c.trim())
        if (!cells.every((c) => /^-+$/.test(c))) rows.push(cells)
        i++
      }
      const [head, ...body] = rows
      out.push(
        `<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table></div>`
      )
    } else if (line.startsWith('- ')) {
      const items = []
      while (i < lines.length && lines[i].startsWith('- ')) items.push(`<li>${inline(lines[i++].slice(2))}</li>`)
      out.push(`<ul>${items.join('')}</ul>`)
    } else {
      const para = []
      while (i < lines.length && lines[i].trim() && !/^(#|\||- )/.test(lines[i])) para.push(inline(lines[i++]))
      out.push(`<p>${para.join('<br>')}</p>`)
    }
  }
  return out.join('\n')
}

if (docName === 'licenses') {
  main.innerHTML = `<h1>${S.licensesTitle}</h1>
    <p>${S.licensesIntro.replace('{n}', licenses.length)}</p>
    <input class="search" type="search" placeholder="${S.licensesSearch}" aria-label="${S.licensesSearch}">
    <div class="table-wrap"><table class="lic"><thead><tr><th>${S.component}</th><th>${S.license}</th></tr></thead><tbody></tbody></table></div>`
  const tbody = main.querySelector('tbody')
  const draw = (q = '') => {
    const s = q.trim().toLowerCase()
    tbody.innerHTML = licenses
      .filter((l) => !s || `${l.name} ${l.license}`.toLowerCase().includes(s))
      .map(
        (l) =>
          `<tr><td>${/^https?:\/\//.test(l.url ?? '') ? `<a href="${esc(l.url)}" rel="noreferrer">${esc(l.name)}</a>` : esc(l.name)}${l.version ? ` <span class="ver">${esc(l.version)}</span>` : ''}${l.note ? `<br><span class="note">${esc(l.note)}</span>` : ''}</td><td>${esc(l.license)}</td></tr>`
      )
      .join('')
  }
  draw()
  main.querySelector('.search').addEventListener('input', (e) => draw(e.target.value))
} else {
  const docs = DOCS[docName === 'terms' ? 'terms' : 'privacy']
  main.innerHTML = markdown(docs[LANG] || docs.en)
}
