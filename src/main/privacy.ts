import { app, session as electronSession, type Session } from 'electron'
import { isTrackingParam } from '@shared/tracking'
import { getDomain } from 'tldts'
import type { SecureDns, Settings } from '@shared/types'

/*
 * Network and tracking protections that do not belong to the ad blocker:
 * encrypted DNS, TLS hardening, HTTPS-only fallbacks, link cleaning,
 * bounce-tracking cleanup and the leaked-password check.
 */

// ---------------------------------------------------------------- hosts

/** Hosts on the user's own network: never upgraded to HTTPS, never treated as trackers. */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  if (!h || !h.includes('.')) return true // "router", "nas", "localhost"
  if (/\.(local|lan|home|internal|localhost|test|invalid|home\.arpa)$/.test(h)) return true
  if (h === '::1' || h === '::' || /^f[cd][0-9a-f]{2}:/.test(h) || h.startsWith('fe80:')) return true
  // IPv4 written as IPv6 ([::ffff:127.0.0.1] becomes [::ffff:7f00:1]): never needed by a public site
  if (h.startsWith('::ffff:')) return true
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(h)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  return a === 0 || a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)
}

/** "news.example.co.uk" → "example.co.uk". */
export function siteOf(urlOrHost: string): string {
  let host = urlOrHost
  try {
    if (urlOrHost.includes('://')) host = new URL(urlOrHost).hostname
  } catch {
    return ''
  }
  return getDomain(host) ?? host
}

// ---------------------------------------------------------------- JavaScript per site

function inList(list: string[], host: string): boolean {
  return list.some((h) => host === h || host.endsWith(`.${h}`))
}

/** Does JavaScript run on pages of this host? (NoScript-style: default plus per-site exceptions.) */
export function scriptsAllowed(settings: Settings, host: string): boolean {
  if (!host) return true
  const flipped = inList(settings.scriptSites, host)
  return settings.scriptsOffByDefault ? flipped : !flipped
}

// ---------------------------------------------------------------- HTTPS-only

/** https:// URLs Halyard produced by upgrading http:// ones, so a failure can offer the original. */
const upgraded = new Map<string, string>()
/** Hosts the user chose to open without HTTPS (until the browser closes). */
const httpAllowed = new Set<string>()

export function upgradeToHttps(url: string): string | null {
  if (!url.startsWith('http:')) return null
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (isPrivateHost(u.hostname) || httpAllowed.has(u.hostname)) return null
  u.protocol = 'https:'
  if (u.port === '80') u.port = ''
  const next = u.href
  if (upgraded.size > 500) upgraded.clear()
  upgraded.set(next, url)
  return next
}

/** The http:// address this https:// one was upgraded from, if any. */
export function upgradedFrom(url: string): string | null {
  return upgraded.get(url) ?? null
}

export function allowHttp(host: string): void {
  if (host) httpAllowed.add(host.toLowerCase())
}

// ---------------------------------------------------------------- link cleaning

/** Remove click-tracking parameters (fbclid, gclid, utm_*...) from a page address. */
export function stripTracking(url: string): string | null {
  if (!url.startsWith('http') || !url.includes('?')) return null
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const site = siteOf(u.hostname)
  let changed = false
  for (const key of [...u.searchParams.keys()]) {
    if (!isTrackingParam(key, site)) continue
    u.searchParams.delete(key)
    changed = true
  }
  if (!changed) return null
  // keep "?" off when nothing is left
  return u.href.replace(/\?(#|$)/, '$1')
}

// ---------------------------------------------------------------- encrypted DNS

const DOH: Record<Exclude<SecureDns, 'system' | 'off'>, string[]> = {
  // malware-blocking variants of each provider
  cloudflare: ['https://security.cloudflare-dns.com/dns-query'],
  quad9: ['https://dns.quad9.net/dns-query'],
  google: ['https://dns.google/dns-query']
}

/** DNS over HTTPS for the whole browser. Strict mode never falls back to plain DNS. */
export function applySecureDns(settings: Settings): void {
  if (!app.isReady()) return
  const choice = settings.secureDns
  try {
    if (choice === 'off') app.configureHostResolver({ secureDnsMode: 'off' })
    else if (choice === 'system') app.configureHostResolver({ secureDnsMode: 'automatic', secureDnsServers: [] })
    else
      app.configureHostResolver({
        secureDnsMode: settings.secureDnsStrict ? 'secure' : 'automatic',
        secureDnsServers: DOH[choice] ?? DOH.cloudflare,
        // HTTPS records carry the keys that let Encrypted Client Hello hide the site name
        enableAdditionalDnsQueryTypes: true
      })
  } catch (err) {
    console.warn('[dns] could not configure DNS over HTTPS:', err)
  }
}

// ---------------------------------------------------------------- TLS

/** Cipher suites that are broken or have no forward secrecy (IANA numbers). */
const WEAK_CIPHERS = [
  0x000a, // RSA 3DES (Sweet32)
  0x002f, 0x0035, 0x009c, 0x009d, // RSA key exchange: no forward secrecy
  0xc012, // ECDHE 3DES
  0xc009, 0xc00a, 0xc013, 0xc014 // CBC with SHA-1 (Lucky13, padding oracles)
]

export function applyTls(ses: Session, strict: boolean): void {
  try {
    ses.setSSLConfig({
      minVersion: 'tls1.2',
      disabledCipherSuites: strict ? WEAK_CIPHERS : WEAK_CIPHERS.slice(0, 5)
    })
  } catch (err) {
    console.warn('[tls] setSSLConfig failed:', err)
  }
}

// ---------------------------------------------------------------- bounce tracking

const INTERACTION_TTL = 45 * 24 * 60 * 60 * 1000

export interface BounceStore {
  /** Sites the user clicked or typed on, with the time. */
  interactions(): Record<string, number>
  saveInteraction(site: string, at: number): void
  /** Sites the user opened as a page (history). */
  hasVisited(site: string): boolean
}

/**
 * Bounce trackers send you through their own site for a split second (a redirect) to
 * set or read a cookie. Sites you only "bounced" through, and never used yourself,
 * get their cookies and storage wiped shortly after.
 */
export class BounceGuard {
  private pending = new Map<string, { at: number; sessions: Set<Session> }>()
  private timer: NodeJS.Timeout | null = null
  /** Interactions in sessions that are not saved (private windows, containers). */
  private volatile = new Set<string>()
  cleared = 0

  constructor(private readonly store: BounceStore, private readonly openSites: () => Set<string>) {}

  interacted(url: string, persist: boolean): void {
    const site = siteOf(url)
    if (!site) return
    this.pending.delete(site)
    if (!persist) {
      this.volatile.add(site)
      return
    }
    const last = this.store.interactions()[site] ?? 0
    // one write per site per hour is plenty
    if (Date.now() - last > 60 * 60 * 1000) this.store.saveInteraction(site, Date.now())
  }

  /** `chain`: every address the navigation passed through, the final page last. */
  bounced(chain: string[], ses: Session): void {
    if (chain.length < 2) return
    const final = siteOf(chain[chain.length - 1])
    for (const url of chain.slice(0, -1)) {
      if (!/^https?:/.test(url)) continue
      const site = siteOf(url)
      let host = ''
      try {
        host = new URL(url).hostname
      } catch {
        continue
      }
      if (!site || site === final || isPrivateHost(host)) continue
      const entry = this.pending.get(site) ?? { at: Date.now(), sessions: new Set<Session>() }
      entry.sessions.add(ses)
      this.pending.set(site, entry)
    }
    if (this.pending.size && !this.timer) this.timer = setTimeout(() => void this.sweep(), 30_000)
  }

  private isUsed(site: string): boolean {
    if (this.volatile.has(site)) return true
    const at = this.store.interactions()[site]
    if (at && Date.now() - at < INTERACTION_TTL) return true
    return this.store.hasVisited(site)
  }

  private async sweep(): Promise<void> {
    this.timer = null
    const open = this.openSites()
    const due = [...this.pending].filter(([, e]) => Date.now() - e.at >= 25_000)
    for (const [site, entry] of due) {
      this.pending.delete(site)
      if (this.isUsed(site) || open.has(site)) continue
      for (const ses of entry.sessions) await wipeSite(ses, site)
      this.cleared++
    }
    if (this.pending.size) this.timer = setTimeout(() => void this.sweep(), 30_000)
  }
}

async function wipeSite(ses: Session, site: string): Promise<void> {
  try {
    const cookies = await ses.cookies.get({ domain: site })
    for (const c of cookies) {
      const host = (c.domain ?? site).replace(/^\./, '')
      await ses.cookies.remove(`${c.secure ? 'https' : 'http'}://${host}${c.path ?? '/'}`, c.name).catch(() => undefined)
    }
    const origins = [`https://${site}`, `https://www.${site}`, `http://${site}`, `http://www.${site}`]
    for (const origin of origins)
      await ses
        .clearStorageData({ origin, storages: ['localstorage', 'indexdb', 'serviceworkers', 'cachestorage', 'filesystem', 'shadercache'] })
        .catch(() => undefined)
  } catch (err) {
    console.warn('[bounce] could not clear', site, err)
  }
}

// ---------------------------------------------------------------- leaked passwords

/** Development builds only: a local stand-in for the service (never in the .exe). */
function hibpBase(): string {
  const test = app.isPackaged ? undefined : process.env.HALYARD_TEST_HIBP
  return test && /^http:\/\/127\.0\.0\.1:\d+$/.test(test) ? test : 'https://api.pwnedpasswords.com'
}

/**
 * Checks a password against Have I Been Pwned's list of leaked passwords using
 * k-anonymity: only the first 5 characters of its SHA-1 leave this computer, and the
 * answer is padded so its size gives nothing away. The password itself is never stored.
 */
export class BreachCheck {
  private ranges = new Map<string, Map<string, number>>()
  /** Hashes already checked in this run (memory only), so the same login is not re-checked. */
  private seen = new Map<string, number>()

  async count(sha1: string): Promise<number> {
    const hash = sha1.toUpperCase()
    if (!/^[0-9A-F]{40}$/.test(hash)) return 0
    const known = this.seen.get(hash)
    if (known !== undefined) return -1 // already reported or clean: stay quiet
    const count = await this.lookup(hash)
    if (this.seen.size > 500) this.seen.clear()
    this.seen.set(hash, count)
    return count
  }

  /** How many times this password (its SHA-1) appears in known leaks. Only 5 characters leave the computer. */
  async lookup(sha1: string): Promise<number> {
    const hash = sha1.toUpperCase()
    if (!/^[0-9A-F]{40}$/.test(hash)) return 0
    const prefix = hash.slice(0, 5)
    let range = this.ranges.get(prefix)
    if (!range) {
      const ses = electronSession.fromPartition('halyard-hibp')
      const res = await ses.fetch(`${hibpBase()}/range/${prefix}`, {
        headers: { 'Add-Padding': 'true' },
        cache: 'no-store',
        credentials: 'omit'
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      range = new Map()
      for (const line of text.split('\n')) {
        const [suffix, n] = line.trim().split(':')
        const count = Number(n)
        if (suffix && count > 0) range.set(suffix.toUpperCase(), count)
      }
      if (this.ranges.size > 200) this.ranges.clear()
      this.ranges.set(prefix, range)
    }
    return range.get(hash.slice(5)) ?? 0
  }
}
