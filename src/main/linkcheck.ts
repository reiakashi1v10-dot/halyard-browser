import { net, session as electronSession } from 'electron'
import { lookup } from 'node:dns/promises'
import { domainToUnicode } from 'node:url'
import { parse } from 'tldts'
import type { LinkReason, LinkReport } from '@shared/types'
import type { Guard } from './guard'
import { isPrivateHost } from './privacy'

/*
 * Where does this link (or QR Code) really go? Static checks first, then the redirects are
 * followed one by one in a throw-away session: no cookies, no JavaScript, nothing saved.
 * Each hop is checked against the malware and phishing lists before it is contacted.
 */

const SHORTENERS = new Set([
  'bit.ly', 'bitly.com', 'tinyurl.com', 't.co', 'goo.gl', 'is.gd', 'v.gd', 'cutt.ly', 'rb.gy', 'ow.ly', 'shorturl.at',
  'tiny.cc', 's.id', 'rebrand.ly', 'bl.ink', 'short.io', 'shorte.st', 'adf.ly', 'qrco.de', 'qr.codes', 'qrs.ly',
  'encurtador.com.br', 'encr.pw', 'l1nk.dev', 'urlz.fr', 'lnkd.in', 'buff.ly', 'surl.li', 'gg.gg', 'tr.ee', 'shor.by', 'me-qr.com'
])

/** TLDs that are cheap, rarely used by real businesses and common in scams (or look like file names). */
const RISKY_TLDS = new Set([
  'zip', 'mov', 'top', 'xyz', 'click', 'icu', 'cfd', 'sbs', 'monster', 'rest', 'loan', 'work', 'support', 'country',
  'gq', 'tk', 'ml', 'cf', 'ga', 'buzz', 'cam', 'quest', 'bond', 'lol', 'mom', 'beauty', 'hair', 'skin', 'autos'
])

const MAX_HOPS = 8
const HOP_TIMEOUT = 6000

export async function analyzeLink(raw: string, guard: Guard): Promise<LinkReport> {
  const input = raw.trim().slice(0, 4096)
  const reasons: LinkReason[] = []
  let url: URL
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `https://${input}`)
  } catch {
    return { kind: 'text', input, level: 'safe', reasons: [], chain: [] }
  }

  const scheme = url.protocol.replace(':', '').toLowerCase()
  if (['javascript', 'data', 'file', 'vbscript', 'blob'].includes(scheme)) {
    return { kind: 'url', input, level: 'danger', reasons: [{ code: 'scheme', value: scheme }], chain: [] }
  }
  if (scheme !== 'http' && scheme !== 'https') return { kind: 'text', input, level: 'safe', reasons: [], chain: [] }

  staticChecks(url, guard, reasons)
  const chain: LinkReport['chain'] = []
  let finalUrl = url.href

  // the link is already known to be dangerous: do not contact it at all
  if (!reasons.some((r) => r.code === 'malware' || r.code === 'phishing')) {
    const result = await unwind(url.href, guard)
    chain.push(...result.chain)
    finalUrl = result.final
    if (result.error) reasons.push({ code: 'unreachable' })
    if (chain.length > 1) {
      const fin = new URL(finalUrl)
      if (siteOfHost(fin.hostname) !== siteOfHost(url.hostname)) {
        reasons.push({ code: 'redirects', value: String(chain.length - 1) })
        // the final address gets the same checks as the first one
        staticChecks(fin, guard, reasons)
      }
    }
  }

  const unique = dedupe(reasons)
  return {
    kind: 'url',
    input,
    host: url.hostname,
    displayHost: unicodeHost(url.hostname),
    finalUrl,
    finalHost: unicodeHost(new URL(finalUrl).hostname),
    level: levelOf(unique),
    reasons: unique,
    chain
  }
}

function staticChecks(url: URL, guard: Guard, reasons: LinkReason[]): void {
  const host = url.hostname.toLowerCase()
  const verdict = guard.check(url.href)
  if (verdict) reasons.push({ code: verdict.kind, value: verdict.suggestion?.replace(/^https?:\/\//, '') ?? host })
  const decoy = guard.brandDecoy(host)
  if (decoy) reasons.push({ code: 'decoy', value: decoy })
  if (url.username || url.password) reasons.push({ code: 'credentials', value: host })
  const parsed = parse(host)
  if (parsed.isIp) reasons.push({ code: isPrivateHost(host) ? 'local' : 'ip', value: host })
  if (host.includes('xn--')) reasons.push({ code: 'punycode', value: unicodeHost(host) })
  if (parsed.publicSuffix && RISKY_TLDS.has(parsed.publicSuffix.split('.').pop() ?? '')) reasons.push({ code: 'tld', value: `.${parsed.publicSuffix}` })
  if (SHORTENERS.has(host) || SHORTENERS.has(parsed.domain ?? '')) reasons.push({ code: 'shortener', value: host })
  if (url.protocol === 'http:' && !isPrivateHost(host)) reasons.push({ code: 'http' })
  if ((parsed.subdomain ?? '').split('.').length >= 4) reasons.push({ code: 'deep', value: host })
  if (url.href.length > 300) reasons.push({ code: 'long' })
  if (/[?&](redirect|url|next|goto|dest|continue|return)=https?%3A/i.test(url.search)) reasons.push({ code: 'open-redirect' })
}

/**
 * Offline check of an address the tab just opened: look-alike brand names, scam-prone endings,
 * bare IP addresses, punycode. No network, no redirects followed.
 */
export function quickRisk(raw: string, guard: Guard): LinkReason | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  const reasons: LinkReason[] = []
  staticChecks(url, guard, reasons)
  const order: LinkReason['code'][] = ['decoy', 'credentials', 'punycode', 'ip', 'tld']
  for (const code of order) {
    const r = reasons.find((x) => x.code === code)
    if (r) return r
  }
  return null
}

const DANGER = new Set(['malware', 'phishing', 'homograph', 'typo', 'decoy', 'credentials', 'scheme'])
const CAUTION = new Set(['ip', 'punycode', 'tld', 'http', 'deep', 'unreachable', 'open-redirect', 'redirects', 'long', 'shortener'])

function levelOf(reasons: LinkReason[]): LinkReport['level'] {
  if (reasons.some((r) => DANGER.has(r.code))) return 'danger'
  // a short link alone is fine once its destination is known and clean
  const caution = reasons.filter((r) => CAUTION.has(r.code) && r.code !== 'shortener' && r.code !== 'redirects')
  if (caution.length) return 'caution'
  return 'safe'
}

function dedupe(reasons: LinkReason[]): LinkReason[] {
  const seen = new Set<string>()
  return reasons.filter((r) => {
    const k = `${r.code}|${r.value ?? ''}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

function unicodeHost(host: string): string {
  try {
    return domainToUnicode(host) || host
  } catch {
    return host
  }
}

function siteOfHost(host: string): string {
  return parse(host).domain ?? host
}

/** Follow redirects by hand (HTTP 3xx and instant meta refresh), checking every hop. */
async function unwind(start: string, guard: Guard): Promise<{ chain: LinkReport['chain']; final: string; error: boolean }> {
  const ses = electronSession.fromPartition('halyard-linkcheck')
  const chain: LinkReport['chain'] = []
  let current = start
  try {
    for (let i = 0; i < MAX_HOPS; i++) {
      let host = ''
      try {
        host = new URL(current).hostname
      } catch {
        break
      }
      if (guard.listed(host)) {
        chain.push({ url: current, status: 0 })
        break
      }
      // never let a link (or a QR Code) make this PC call the router or other devices at home
      if (await pointsInside(host)) {
        chain.push({ url: current, status: 0 })
        break
      }
      const res = await hop(ses, current)
      chain.push({ url: current, status: res.status })
      if (res.location) {
        current = new URL(res.location, current).href
        if (!/^https?:/.test(current)) {
          chain.push({ url: current, status: 0 })
          break
        }
        continue
      }
      // pages that bounce right away with <meta http-equiv="refresh">
      const next = res.html ? metaRefresh(res.html, current) : null
      if (next && next !== current) {
        current = next
        continue
      }
      break
    }
    return { chain, final: current, error: false }
  } catch {
    return { chain, final: current, error: chain.length === 0 }
  } finally {
    void ses.clearStorageData().catch(() => undefined)
  }
}

/** The host is on the local network, or a public name that resolves to a local address. */
async function pointsInside(host: string): Promise<boolean> {
  if (isPrivateHost(host)) return true
  try {
    const addresses = await lookup(host.replace(/^\[|\]$/g, ''), { all: true })
    return addresses.some((a) => isPrivateHost(a.address))
  } catch {
    return false // unknown name: the request itself will fail
  }
}

interface Hop {
  status: number
  location: string | null
  html: string | null
}

/*
 * One request, redirects not followed. session.fetch() with redirect 'manual' throws in
 * Electron instead of returning the 3xx, so this uses net.request and its 'redirect' event.
 */
function hop(ses: Electron.Session, url: string): Promise<Hop> {
  return new Promise((resolve, reject) => {
    let done = false
    const finish = (fn: () => void): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      fn()
    }
    const req = net.request({ url, session: ses, redirect: 'manual', credentials: 'omit', cache: 'no-store' })
    req.setHeader('Accept', 'text/html,*/*;q=0.8')
    const timer = setTimeout(() => finish(() => (req.abort(), reject(new Error('timeout')))), HOP_TIMEOUT)
    req.on('redirect', (status, _method, redirectUrl) => {
      finish(() => {
        req.abort()
        resolve({ status, location: redirectUrl, html: null })
      })
    })
    req.on('response', (res) => {
      const type = String(res.headers['content-type'] ?? '')
      const location = res.statusCode >= 300 && res.statusCode < 400 ? String(res.headers.location ?? '') || null : null
      if (location || !type.includes('html')) {
        finish(() => (req.abort(), resolve({ status: res.statusCode, location, html: null })))
        return
      }
      // read just the start of the page: enough to find an instant meta refresh
      let text = ''
      const decoder = new TextDecoder()
      const end = (): void => finish(() => (req.abort(), resolve({ status: res.statusCode, location: null, html: text })))
      res.on('data', (chunk: Buffer) => {
        text += decoder.decode(chunk, { stream: true })
        if (text.length >= 65536) end()
      })
      res.on('end', end)
      res.on('error', end)
    })
    req.on('error', (err) => finish(() => reject(err)))
    req.end()
  })
}

function metaRefresh(text: string, base: string): string | null {
  const m = /<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["']?\s*(\d+)\s*;\s*url=([^"'>\s]+)/i.exec(text)
  if (!m || Number(m[1]) > 5) return null
  try {
    return new URL(m[2], base).href
  } catch {
    return null
  }
}
