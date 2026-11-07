// Halyard search: the results come from DuckDuckGo's lightweight HTML page, fetched by the
// browser itself in a throwaway session (no cookies, no history), stripped of ads and drawn
// by the halyard://search page. The page never talks to the search provider directly.
import { session, type Session } from 'electron'
import type { Lang } from '@shared/i18n'
import type { SearchAnswer, SearchPage, SearchResult } from '@shared/types'

const ENDPOINT = 'https://html.duckduckgo.com/html/'
const REGION: Record<Lang, { kl: string; accept: string }> = {
  'pt-BR': { kl: 'br-pt', accept: 'pt-BR,pt;q=0.9' },
  en: { kl: 'us-en', accept: 'en-US,en;q=0.9' },
  es: { kl: 'es-es', accept: 'es-ES,es;q=0.9' }
}
/** Only these form fields from the provider's "next page" form are sent back. */
const NEXT_FIELDS = ['s', 'dc', 'v', 'o', 'api', 'vqd', 'nextParams', 'kl']
const CACHE_MS = 5 * 60_000

let ses: Session | null = null
const cache = new Map<string, { at: number; page: SearchPage }>()

function searchSession(userAgent: string): Session {
  if (!ses) {
    // in memory only: nothing about the search is written to disk
    ses = session.fromPartition('halyard-search')
    ses.setUserAgent(userAgent)
    ses.setPermissionRequestHandler((_wc, _p, cb) => cb(false))
  }
  return ses
}

export async function search(query: string, next: string | null, lang: Lang, userAgent: string): Promise<SearchPage> {
  const q = query.trim().slice(0, 500)
  if (!q) return { query: q, results: [], answer: null, next: null }

  const region = REGION[lang] ?? REGION.en
  const form = new URLSearchParams({ q, kl: region.kl })
  if (next) {
    let extra: Record<string, unknown> = {}
    try {
      extra = JSON.parse(next) as Record<string, unknown>
    } catch {
      throw new Error('Argumento inválido')
    }
    for (const key of NEXT_FIELDS) {
      const v = extra[key]
      if (typeof v === 'string' && v.length < 200) form.set(key, v)
    }
  }

  const key = form.toString()
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.page

  const res = await searchSession(userAgent).fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept-Language': region.accept },
    body: key,
    signal: AbortSignal.timeout(10_000)
  })
  if (!res.ok) throw new Error(`search ${res.status}`)
  const html = await res.text()
  // the provider sometimes asks for a captcha instead of answering
  if (/anomaly-modal|class="anomaly/i.test(html)) throw new Error('search blocked')

  const page: SearchPage = { query: q, results: parseResults(html), answer: next ? null : parseAnswer(html), next: parseNext(html, form.get('s')) }
  cache.set(key, { at: Date.now(), page })
  if (cache.size > 40) cache.delete(cache.keys().next().value as string)
  return page
}

function parseResults(html: string): SearchResult[] {
  const out: SearchResult[] = []
  const seen = new Set<string>()
  // each result starts with this div; ads carry "result--ad" and are skipped
  for (const block of html.split(/<div class="result results_links/).slice(1)) {
    const head = block.slice(0, 200)
    if (/result--ad/.test(head)) continue
    const link = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block)
    if (!link) continue
    const url = realUrl(link[1])
    if (!url || seen.has(url)) continue
    seen.add(url)
    const snippet = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(block)
    const icon = /class="result__icon__img"[^>]*src="([^"]+)"/.exec(block)
    out.push({
      title: text(link[2]).slice(0, 300) || new URL(url).hostname,
      url,
      snippet: snippet ? text(snippet[1]).slice(0, 600) : '',
      icon: icon ? httpsUrl(decode(icon[1])) : null
    })
    if (out.length >= 30) break
  }
  return out
}

function parseAnswer(html: string): SearchAnswer | null {
  const zci = /<div class="zci">([\s\S]*?)<\/div>\s*<\/div>/.exec(html)
  if (!zci) return null
  const box = zci[1]
  const head = /class="zci__heading">\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(box)
  const body = /id="zero_click_abstract">([\s\S]*)/.exec(box)
  if (!head || !body) return null
  const url = realUrl(head[1])
  const source = /<q>([\s\S]*?)<\/q>/.exec(body[1])
  const image = /class="zci__image"[^>]*src="([^"]+)"/.exec(body[1])
  // the abstract is the loose text between the image link and the "More at" link
  const textOnly = text(body[1].replace(/<a[^>]*>[\s\S]*?<\/a>/g, ' '))
  if (!url || textOnly.length < 20) return null
  return {
    heading: text(head[2]).slice(0, 200),
    text: textOnly.slice(0, 900),
    url,
    source: source ? text(source[1]).slice(0, 60) : new URL(url).hostname,
    image: image ? httpsUrl(decode(image[1])) : null
  }
}

function parseNext(html: string, current: string | null): string | null {
  const at = Number(current ?? 0)
  for (const form of html.split('<div class="nav-link">').slice(1)) {
    const fields: Record<string, string> = {}
    for (const m of form.slice(0, 3000).matchAll(/<input type="hidden" name="([a-zA-Z]+)" value="([^"]*)"/g)) {
      if (NEXT_FIELDS.includes(m[1])) fields[m[1]] = decode(m[2])
    }
    // the "previous" form points backwards; take the one that moves forward
    if (Number(fields.s ?? -1) > at) return JSON.stringify(fields)
  }
  return null
}

/** Links come direct or wrapped in the provider's redirect; only http(s) is kept. */
function realUrl(raw: string): string | null {
  const href = decode(raw)
  try {
    const u = new URL(href, 'https://duckduckgo.com')
    if (u.hostname.endsWith('duckduckgo.com')) {
      if (u.pathname === '/y.js') return null // ad click
      const target = u.searchParams.get('uddg')
      return target ? realUrl(target) : null
    }
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
  } catch {
    return null
  }
}

function httpsUrl(raw: string): string | null {
  try {
    const u = new URL(raw, 'https://duckduckgo.com')
    u.protocol = 'https:'
    return u.href
  } catch {
    return null
  }
}

function text(html: string): string {
  return decode(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
}

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|#39);/gi, (_m, e: string) => {
    const k = e.toLowerCase()
    if (k === 'amp') return '&'
    if (k === 'lt') return '<'
    if (k === 'gt') return '>'
    if (k === 'quot') return '"'
    if (k === 'apos' || k === '#39') return "'"
    if (k === 'nbsp') return ' '
    const code = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10)
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ''
  })
}

/** What the AI assistant opens to search: a real web page it can read and click. */
export function agentSearchUrl(query: string): string {
  return `${ENDPOINT}?q=${encodeURIComponent(query)}`
}
