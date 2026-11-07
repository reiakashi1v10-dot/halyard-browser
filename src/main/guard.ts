import { app } from 'electron'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { domainToUnicode } from 'node:url'
import { parse } from 'tldts'
import type { ThreatKind, ThreatVerdict } from '@shared/types'

/**
 * Safe-browsing guard. Three independent checks, all local:
 *  1. Malware hosts (URLhaus, abuse.ch) and phishing hosts (phishing-filter), refreshed every 12 h.
 *  2. Typosquatting: a domain one or two keystrokes away from a well-known site (tiktuk.com → tiktok.com).
 *  3. Look-alike characters: punycode domains that spell a known brand with Cyrillic/Greek letters.
 * Nothing about the pages you visit leaves the machine; only the lists are downloaded.
 */

const FEEDS: { kind: ThreatKind; url: string; file: string }[] = [
  { kind: 'malware', url: 'https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-hosts-online.txt', file: 'guard-malware.txt' },
  { kind: 'phishing', url: 'https://malware-filter.gitlab.io/malware-filter/phishing-filter-hosts.txt', file: 'guard-phishing.txt' }
]
const REFRESH_MS = 12 * 60 * 60 * 1000

/** Well-known sites people mistype or that scammers imitate. domain → brand label. */
const POPULAR_DOMAINS = [
  'google.com', 'google.com.br', 'youtube.com', 'facebook.com', 'instagram.com', 'whatsapp.com', 'tiktok.com',
  'twitter.com', 'x.com', 'netflix.com', 'amazon.com', 'amazon.com.br', 'mercadolivre.com.br', 'mercadopago.com.br',
  'nubank.com.br', 'itau.com.br', 'bradesco.com.br', 'santander.com.br', 'caixa.gov.br', 'bb.com.br', 'bancointer.com.br',
  'picpay.com', 'paypal.com', 'apple.com', 'icloud.com', 'microsoft.com', 'live.com', 'outlook.com', 'office.com',
  'hotmail.com', 'github.com', 'gmail.com', 'yahoo.com', 'linkedin.com', 'discord.com', 'twitch.tv', 'reddit.com',
  'wikipedia.org', 'globo.com', 'uol.com.br', 'americanas.com.br', 'magazineluiza.com.br', 'shopee.com.br',
  'aliexpress.com', 'steampowered.com', 'steamcommunity.com', 'epicgames.com', 'roblox.com', 'spotify.com',
  'binance.com', 'coinbase.com', 'gov.br', 'correios.com.br', 'ifood.com.br', 'uber.com', 'airbnb.com', 'booking.com',
  'dropbox.com', 'adobe.com', 'openai.com', 'chatgpt.com', 'claude.ai', 'anthropic.com', 'telegram.org', 'pinterest.com',
  'kwai.com', 'shein.com', 'olx.com.br', 'casasbahia.com.br', 'kabum.com.br', 'samsung.com', 'playstation.com',
  'xbox.com', 'nintendo.com', 'minecraft.net', 'riotgames.com', 'leagueoflegends.com', 'valorant.com', 'blizzard.com',
  'ea.com', 'disneyplus.com', 'primevideo.com', 'hbomax.com', 'max.com', 'globoplay.globo.com', 'deezer.com',
  'zoom.us', 'canva.com', 'notion.so', 'trello.com', 'slack.com', 'stackoverflow.com', 'cloudflare.com', 'vercel.com',
  'yandex.com', 'bing.com', 'duckduckgo.com', 'brave.com', 'mozilla.org', 'opera.com', 'wise.com', 'revolut.com',
  'c6bank.com.br', 'sicredi.com.br', 'sicoob.com.br', 'serasa.com.br', 'detran.sp.gov.br', 'netshoes.com.br',
  'submarino.com.br', 'temu.com', 'ebay.com', 'walmart.com', 'paypal.me', 'metamask.io', 'blockchain.com', 'kraken.com',
  'bet365.com', 'betano.com', 'onlyfans.com', 'patreon.com', 'gofundme.com', 'tinder.com', 'snapchat.com', 'threads.net',
  // official short links and CDNs that look like typos of their own brand
  'youtu.be', 'instagr.am', 'wa.me', 'fb.me', 'redd.it', 'discord.gg', 'amzn.to', 'git.io', 'twimg.com', 'ytimg.com'
]

/** Short or common-word labels where a one-letter difference is usually a different, real site. */
const FUZZY_EXEMPT = new Set(['x', 'bb', 'ea', 'max', 'uol', 'gov', 'live', 'zoom', 'kwai', 'uber', 'wise', 'bing', 'temu', 'ebay', 'olx', 'shein'])

/** Latin look-alikes for characters commonly used in homograph attacks. */
const CONFUSABLES: Record<string, string> = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', ј: 'j', ԁ: 'd', ѕ: 's', һ: 'h', ӏ: 'l', ɡ: 'g',
  ο: 'o', α: 'a', ε: 'e', ι: 'i', κ: 'k', ν: 'v', ρ: 'p', τ: 't', υ: 'u', χ: 'x', ʏ: 'y', ɑ: 'a', ı: 'i',
  à: 'a', á: 'a', â: 'a', ã: 'a', ä: 'a', å: 'a', è: 'e', é: 'e', ê: 'e', ë: 'e', ì: 'i', í: 'i', î: 'i', ï: 'i',
  ò: 'o', ó: 'o', ô: 'o', õ: 'o', ö: 'o', ù: 'u', ú: 'u', û: 'u', ü: 'u', ç: 'c', ñ: 'n', ý: 'y'
}

interface Brand {
  domain: string
  label: string
}

export class Guard {
  private lists = new Map<ThreatKind, Set<string>>()
  private brands: Brand[]
  private popular = new Set<string>()
  /** Hosts the user chose to open despite a warning (this run only for malware/phishing). */
  private allowed = new Set<string>()
  private ready: Promise<void>

  constructor(private readonly isTrusted: (host: string) => boolean, private readonly onTrust: (host: string) => void) {
    const seen = new Map<string, Brand>()
    for (const domain of POPULAR_DOMAINS) {
      this.popular.add(domain)
      const label = parse(domain).domainWithoutSuffix ?? domain
      if (!seen.has(label)) seen.set(label, { domain, label })
    }
    this.brands = [...seen.values()]
    this.ready = this.loadAll()
    setInterval(() => void this.loadAll(true), REFRESH_MS).unref()
  }

  get loaded(): Promise<void> {
    return this.ready
  }

  get stats(): { malware: number; phishing: number } {
    return { malware: this.lists.get('malware')?.size ?? 0, phishing: this.lists.get('phishing')?.size ?? 0 }
  }

  private async loadAll(force = false): Promise<void> {
    await Promise.all(FEEDS.map((feed) => this.loadFeed(feed, force)))
  }

  private async loadFeed(feed: (typeof FEEDS)[number], force: boolean): Promise<void> {
    const path = join(app.getPath('userData'), feed.file)
    let text: string | null = null
    try {
      const info = await stat(path)
      if (!force && Date.now() - info.mtimeMs < REFRESH_MS) text = await readFile(path, 'utf8')
    } catch {
      /* no cache yet */
    }
    if (text === null) {
      try {
        const res = await fetch(feed.url, { signal: AbortSignal.timeout(30_000) })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        text = await res.text()
        await writeFile(path, text)
      } catch (err) {
        console.warn(`[guard] não foi possível atualizar ${feed.kind}:`, err)
        text = await readFile(path, 'utf8').catch(() => null)
      }
    }
    if (text === null) return
    const hosts = new Set<string>()
    for (const line of text.split('\n')) {
      if (!line || line.startsWith('#')) continue
      const host = line.trim().split(/\s+/)[1]
      if (host && host !== '0.0.0.0' && host.includes('.')) hosts.add(host.toLowerCase())
    }
    // reserved test names (the .invalid TLD never resolves) so the warning can be tried safely
    hosts.add(feed.kind === 'malware' ? 'malware.halyard-teste.invalid' : 'phishing.halyard-teste.invalid')
    this.lists.set(feed.kind, hosts)
  }

  /** The user chose to continue to this host in this run. */
  isAllowed(host: string): boolean {
    return this.allowed.has(host)
  }

  allow(host: string, remember: boolean): void {
    this.allowed.add(host)
    if (remember) this.onTrust(host)
  }

  /** Is this host on a malware or phishing list (checking every parent domain)? */
  listed(hostname: string): ThreatKind | null {
    const host = hostname.toLowerCase().replace(/\.$/, '')
    const parts = host.split('.')
    for (let i = 0; i < parts.length - 1; i++) {
      const candidate = parts.slice(i).join('.')
      for (const [kind, set] of this.lists) if (set.has(candidate)) return kind
    }
    return null
  }

  /**
   * A known brand used as a sub-address of another site: "itau.com.br.acesso-seguro.xyz"
   * or "paypal-login.example.top". Returns the real site, or null.
   */
  brandDecoy(hostname: string): string | null {
    const parsed = parse(hostname.toLowerCase())
    if (!parsed.domain || parsed.isIp) return null
    if (this.popular.has(parsed.domain) || this.allowed.has(hostname)) return null
    // sites the user already uses are not questioned
    if (this.isTrusted(hostname) || this.isTrusted(parsed.domain)) return null
    const sub = parsed.subdomain ?? ''
    const labels = [...sub.split('.'), ...(parsed.domainWithoutSuffix ?? '').split('-')].filter((l) => l.length >= 4)
    const subLabels = new Set(sub.split(/[.-]/).filter((l) => l.length >= 4))
    for (const brand of this.brands) {
      if (brand.label.length < 4 || FUZZY_EXEMPT.has(brand.label)) continue
      // brand as a full label in the sub-address, or as "brand-something" in the site name
      if (subLabels.has(brand.label) || (labels.includes(brand.label) && (parsed.domainWithoutSuffix ?? '').includes('-'))) return brand.domain
    }
    return null
  }

  check(rawUrl: string): ThreatVerdict | null {
    let url: URL
    try {
      url = new URL(rawUrl)
    } catch {
      return null
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    const host = url.hostname.toLowerCase()
    if (this.allowed.has(host)) return null

    const listed = this.listed(host)
    if (listed) return { kind: listed, host, url: rawUrl }

    const parsed = parse(host)
    if (!parsed.domain || !parsed.domainWithoutSuffix || parsed.isIp) return null
    const domain = parsed.domain
    if (this.popular.has(domain) || this.popular.has(host)) return null
    const warn = (v: ThreatVerdict): ThreatVerdict | null => (this.isTrusted(host) || this.isTrusted(domain) ? null : v)

    const ascii = parsed.domainWithoutSuffix
    const unicode = ascii.includes('xn--') ? domainToUnicode(domain).split('.')[0] : ascii

    // look-alike letters: аpple.com written with a Cyrillic "а"
    if (unicode !== ascii) {
      const skeleton = toSkeleton(unicode)
      const brand = this.brands.find((b) => b.label === skeleton)
      if (brand) return warn({ kind: 'homograph', host, url: rawUrl, suggestion: `https://${brand.domain}` })
    }

    // one or two keystrokes away from a known site
    const label = normalizeDigits(unicode.toLowerCase())
    for (const brand of this.brands) {
      if (brand.label.length < 4 || FUZZY_EXEMPT.has(brand.label)) continue
      if (label === brand.label) {
        // same name, the user just typed a digit for a letter (g00gle) — or a different TLD, which is fine
        if (normalizeDigits(ascii) !== ascii) return warn({ kind: 'typo', host, url: rawUrl, suggestion: suggestionFor(brand.domain, url) })
        continue
      }
      if (Math.abs(label.length - brand.label.length) > 2) continue
      if (label[0] !== brand.label[0]) continue
      const limit = brand.label.length >= 9 ? 2 : 1
      if (label.length < 5 && limit === 1 && brand.label.length < 5) continue
      const d = editDistance(label, brand.label, limit)
      if (d > 0 && d <= limit) return warn({ kind: 'typo', host, url: rawUrl, suggestion: suggestionFor(brand.domain, url) })
    }
    return null
  }
}

function suggestionFor(domain: string, url: URL): string {
  return `https://${domain}${url.pathname === '/' ? '' : url.pathname}`
}

function toSkeleton(s: string): string {
  return [...s.toLowerCase()].map((ch) => CONFUSABLES[ch] ?? ch).join('')
}

function normalizeDigits(s: string): string {
  return s.replace(/0/g, 'o').replace(/1/g, 'l').replace(/3/g, 'e').replace(/5/g, 's').replace(/rn/g, 'm').replace(/vv/g, 'w')
}

/** Damerau–Levenshtein (optimal string alignment), stops early past `limit`. */
function editDistance(a: string, b: string, limit: number): number {
  const rows = a.length + 1
  const cols = b.length + 1
  const d: number[][] = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i < rows; i++) {
    let rowMin = Infinity
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 1)
      d[i][j] = v
      rowMin = Math.min(rowMin, v)
    }
    if (rowMin > limit) return limit + 1
  }
  return d[a.length][b.length]
}
