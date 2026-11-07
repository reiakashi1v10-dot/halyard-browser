import { session as electronSession, type Certificate } from 'electron'
import type { SiteAudit } from '@shared/types'
import type { Tab } from './tab'
import type { Profile } from './profile'
import { siteOf } from './privacy'

/*
 * Halyard Lab: how well does a site protect its visitors? Reads the security headers the
 * server sends, the certificate it presents and, for an open tab, which other sites the
 * page talks to. The page is fetched in a clean session: no cookies, nothing saved.
 */

const PARTITION = 'halyard-audit'
const TIMEOUT = 10_000
/** Certificates seen by the audit session, by host name. */
const certs = new Map<string, Certificate>()
let wired = false

function auditSession() {
  const ses = electronSession.fromPartition(PARTITION)
  if (!wired) {
    wired = true
    ses.setCertificateVerifyProc((request, callback) => {
      if (certs.size > 50) certs.clear()
      certs.set(request.hostname, request.certificate)
      // -3: keep Chromium's own verdict (an invalid certificate still fails)
      callback(-3)
    })
  }
  return ses
}

interface HeaderRule {
  name: string
  /** Counts toward the grade. */
  scored: boolean
  good(value: string | null, all: Headers): boolean
}

const RULES: HeaderRule[] = [
  {
    name: 'strict-transport-security',
    scored: true,
    // at least six months, the bar browsers use for the HSTS preload list
    good: (v) => !!v && Number(/max-age=(\d+)/i.exec(v)?.[1] ?? 0) >= 15_552_000
  },
  {
    name: 'content-security-policy',
    scored: true,
    good: (v) => {
      if (!v) return false
      const script = /(?:^|;)\s*script-src([^;]*)/i.exec(v)?.[1] ?? /(?:^|;)\s*default-src([^;]*)/i.exec(v)?.[1] ?? ''
      // 'unsafe-inline' without a nonce or hash lets injected scripts run
      return !(/'unsafe-inline'/.test(script) && !/'nonce-|'sha(256|384|512)-|'strict-dynamic'/.test(script))
    }
  },
  { name: 'x-content-type-options', scored: true, good: (v) => (v ?? '').toLowerCase().includes('nosniff') },
  {
    name: 'x-frame-options',
    scored: true,
    // frame-ancestors in the CSP does the same job
    good: (v, all) => /^(deny|sameorigin)$/i.test((v ?? '').trim()) || /frame-ancestors/i.test(all.get('content-security-policy') ?? '')
  },
  {
    name: 'referrer-policy',
    scored: true,
    good: (v) => !!v && !/unsafe-url|no-referrer-when-downgrade/i.test(v)
  },
  { name: 'permissions-policy', scored: true, good: (v) => !!v },
  { name: 'cross-origin-opener-policy', scored: false, good: (v) => !!v && !/unsafe-none/i.test(v) }
]

/** Headers that only tell attackers which software (and version) runs the site. */
const LEAKY = ['server', 'x-powered-by', 'x-aspnet-version', 'x-aspnetmvc-version', 'x-generator']

export interface AuditContext {
  profile: Profile
  /** The tab showing this site, when there is one: its requests and cookies are included. */
  tab?: Tab
}

export async function auditSite(raw: string, ctx: AuditContext): Promise<SiteAudit> {
  const start = new URL(raw)
  if (start.protocol !== 'https:' && start.protocol !== 'http:') throw new Error('Argumento inválido')

  const ses = auditSession()
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), TIMEOUT)
  let res: Response
  try {
    res = await ses.fetch(start.href, { signal: ac.signal, credentials: 'omit', cache: 'no-store', redirect: 'follow' })
    await res.body?.cancel().catch(() => undefined)
  } finally {
    clearTimeout(timer)
  }
  const final = new URL(res.url || start.href)
  const secure = final.protocol === 'https:'

  const headers: SiteAudit['headers'] = RULES.map((r) => {
    const value = res.headers.get(r.name)
    return { name: r.name, value, good: secure || r.name !== 'strict-transport-security' ? r.good(value, res.headers) : false }
  })
  for (const name of LEAKY) {
    const value = res.headers.get(name)
    // a bare "nginx" says little; a version number helps attackers find known holes
    if (value && /\d/.test(value)) headers.push({ name, value, good: false })
  }

  const scored = RULES.filter((r) => r.scored)
  const points = scored.filter((r) => headers.find((h) => h.name === r.name)?.good).length
  const grade: SiteAudit['grade'] = !secure ? 'F' : points >= 6 ? 'A' : points >= 5 ? 'B' : points >= 3 ? 'C' : points >= 1 ? 'D' : 'F'

  const cert = secure ? certs.get(final.hostname) : undefined
  const certificate = cert
    ? {
        issuer: cert.issuer?.organizations?.[0] || cert.issuerName,
        subject: cert.subjectName,
        validFrom: cert.validStart * 1000,
        validTo: cert.validExpiry * 1000,
        fingerprint: cert.fingerprint
      }
    : null
  void ses.clearStorageData().catch(() => undefined)

  const tab = ctx.tab && siteOf(ctx.tab.url) === siteOf(final.href) ? ctx.tab : undefined
  const thirdParties = tab ? await thirdPartiesOf(tab, final) : []
  const cookies = tab ? (await tab.session.cookies.get({ url: final.origin }).catch(() => [])).length : 0
  const permissions = ctx.profile
    .listPermissions()
    .filter((p) => p.origin === final.origin)
    .map((p) => ({ permission: p.permission, decision: p.decision }))

  return {
    url: final.href,
    host: final.hostname,
    secure,
    headers,
    grade,
    certificate,
    thirdParties,
    blocked: tab ? tab.blocked : 0,
    cookies,
    permissions
  }
}

/** Other sites the page loaded something from (scripts, images, fonts, trackers...). */
async function thirdPartiesOf(tab: Tab, page: URL): Promise<SiteAudit['thirdParties']> {
  const wc = tab.wc
  if (!wc || wc.isDestroyed()) return []
  // a separate world: the page's own scripts cannot see or fake this
  const names = (await wc
    .executeJavaScriptInIsolatedWorld(1013, [
      { code: `performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /^https?:/.test(n)).slice(0, 3000)` }
    ])
    .catch(() => [])) as unknown
  if (!Array.isArray(names)) return []
  const own = siteOf(page.href)
  const counts = new Map<string, number>()
  for (const n of names) {
    if (typeof n !== 'string') continue
    let host: string
    try {
      host = new URL(n).hostname
    } catch {
      continue
    }
    if (siteOf(host) === own) continue
    counts.set(host, (counts.get(host) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([host, count]) => ({ host, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 60)
}
