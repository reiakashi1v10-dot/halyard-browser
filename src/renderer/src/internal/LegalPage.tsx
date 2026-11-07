import { Fragment, useMemo, useState, type ReactNode } from 'react'
import privacyPt from '../../../../legal/privacidade.md?raw'
import privacyEn from '../../../../legal/privacy.en.md?raw'
import termsPt from '../../../../legal/termos.md?raw'
import termsEn from '../../../../legal/terms.en.md?raw'
import privacyEs from '../../../../legal/privacy.es.md?raw'
import termsEs from '../../../../legal/terms.es.md?raw'
import licenses from '../../../../legal/licenses.json'
import { getLang, t } from '@/lib/i18n'

type Doc = 'privacy' | 'terms' | 'licenses'

const DOCS = {
  privacy: { 'pt-BR': privacyPt, en: privacyEn, es: privacyEs },
  terms: { 'pt-BR': termsPt, en: termsEn, es: termsEs }
}

/** Privacy policy, terms of use and third-party licenses (halyard://legal/?doc=...). */
export function LegalPage() {
  const doc = (new URLSearchParams(location.search).get('doc') ?? 'privacy') as Doc
  return (
    <main className="page legal-page">
      <nav className="legal-tabs" aria-label={t('page.legal')}>
        {(['privacy', 'terms', 'licenses'] as const).map((d) => (
          <a key={d} href={`halyard://legal/?doc=${d}`} className={d === doc ? 'is-on' : ''} aria-current={d === doc ? 'page' : undefined}>
            {t(`legal.${d}`)}
          </a>
        ))}
      </nav>
      {doc === 'licenses' ? <Licenses /> : <Markdown source={DOCS[doc === 'terms' ? 'terms' : 'privacy'][getLang()]} />}
    </main>
  )
}

function Licenses() {
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? licenses.filter((l) => `${l.name} ${l.license}`.toLowerCase().includes(s)) : licenses
  }, [q])
  return (
    <article className="legal-doc">
      <h1>{t('legal.licenses')}</h1>
      <p>{t('legal.licensesIntro', { n: licenses.length })}</p>
      <input className="input legal-search" type="search" value={q} placeholder={t('legal.search')} onChange={(e) => setQ(e.target.value)} />
      <table className="legal-table">
        <tbody>
          {list.map((l) => (
            <tr key={`${l.name}@${l.version}`}>
              <td>
                {l.url ? (
                  <a href={l.url} target="_blank" rel="noreferrer">
                    {l.name}
                  </a>
                ) : (
                  l.name
                )}
                {l.version && <span className="legal-version"> {l.version}</span>}
              </td>
              <td>{l.license}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  )
}

// ---------------------------------------------------------------- tiny Markdown (only what the legal files use)

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\*\*(.+?)\*\*|\[(.+?)\]\((https?:\/\/[^)\s]+)\)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(
      m[1] ? (
        <strong key={m.index}>{m[1]}</strong>
      ) : (
        <a key={m.index} href={m[3]} target="_blank" rel="noreferrer">
          {m[2]}
        </a>
      )
    )
    last = re.lastIndex
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function Markdown({ source }: { source: string }) {
  const blocks: ReactNode[] = []
  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; ) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line)
    if (h) {
      const Tag = `h${h[1].length}` as 'h1' | 'h2' | 'h3'
      blocks.push(<Tag key={i}>{inline(h[2])}</Tag>)
      i++
      continue
    }
    if (line.startsWith('|')) {
      const rows: string[][] = []
      while (i < lines.length && lines[i].startsWith('|')) {
        const cells = lines[i].split('|').slice(1, -1).map((c) => c.trim())
        if (!cells.every((c) => /^-+$/.test(c))) rows.push(cells)
        i++
      }
      const [head, ...body] = rows
      blocks.push(
        <table key={i} className="legal-table">
          <thead>
            <tr>{head.map((c, k) => <th key={k}>{inline(c)}</th>)}</tr>
          </thead>
          <tbody>
            {body.map((r, k) => (
              <tr key={k}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      )
      continue
    }
    if (line.startsWith('- ')) {
      const items: string[] = []
      while (i < lines.length && lines[i].startsWith('- ')) items.push(lines[i++].slice(2))
      blocks.push(
        <ul key={i}>
          {items.map((it, k) => (
            <li key={k}>{inline(it)}</li>
          ))}
        </ul>
      )
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !/^(#|\||- )/.test(lines[i])) para.push(lines[i++])
    blocks.push(
      <p key={i}>
        {para.map((p, k) => (
          <Fragment key={k}>
            {k > 0 && <br />}
            {inline(p)}
          </Fragment>
        ))}
      </p>
    )
  }
  return <article className="legal-doc">{blocks}</article>
}
