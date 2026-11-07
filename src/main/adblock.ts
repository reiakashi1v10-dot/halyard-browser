import { app, ipcMain, type Session } from 'electron'
import { readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ElectronBlocker } from '@ghostery/adblocker-electron'
import type { Profile } from './profile'
import type { Guard } from './guard'
import type { ThreatVerdict } from '@shared/types'
import { hostOf } from './url'
import { isPrivateHost, scriptsAllowed, stripTracking, upgradeToHttps } from './privacy'

type TabLookup = (webContentsId: number) => { url: string; onBlocked: () => void; onThreat: (v: ThreatVerdict) => void } | null

const REFRESH_MS = 24 * 60 * 60 * 1000

const GHOSTERY_CHANNELS = ['@ghostery/adblocker/inject-cosmetic-filters', '@ghostery/adblocker/is-mutation-observer-enabled']

/**
 * Ad, tracker and annoyance blocking (Ghostery engine, full lists, refreshed daily) plus the
 * request-level privacy features that share the same webRequest hook:
 * HTTPS-only upgrades, per-site allowlist and Do Not Track / GPC headers.
 */
export class Shield {
  private blocker: ElectronBlocker | null = null
  private ready: Promise<void>
  private sessions = new Set<Session>()

  constructor(private readonly profile: Profile, private readonly guard: Guard, private readonly lookup: TabLookup) {
    this.ready = this.load()
  }

  private async load(): Promise<void> {
    const dir = app.getPath('userData')
    const cache = join(dir, 'adblock-full.bin')
    // the old, smaller engine (ads + tracking only) is no longer used
    void rm(join(dir, 'adblock-engine.bin'), { force: true })
    try {
      const blocker = await this.engine(cache)
      this.blocker = blocker
      this.patch(blocker)
      blocker.on('request-blocked', (request) => {
        const tab = this.lookup(request.tabId)
        tab?.onBlocked()
        this.profile.addBlocked()
      })
    } catch (err) {
      console.error('[shield] listas de bloqueio indisponíveis (offline?):', err)
      this.blocker = null
    }
  }

  /**
   * Full Ghostery engine: ads, trackers, annoyances (cookie walls, pop-ups) and the
   * uBlock Origin scriptlets that defuse anti-adblock checks such as YouTube's.
   * Sites change those checks often, so the lists are refreshed once a day; the
   * saved copy is used offline or if the download fails.
   */
  private async engine(cache: string): Promise<ElectronBlocker> {
    const age = await stat(cache).then((s) => Date.now() - s.mtimeMs).catch(() => Infinity)
    if (age > REFRESH_MS) {
      try {
        const fresh = await ElectronBlocker.fromPrebuiltFull(globalThis.fetch)
        await writeFile(cache, fresh.serialize())
        return fresh
      } catch (err) {
        console.warn('[shield] could not refresh the block lists, using the saved copy:', err instanceof Error ? err.message : err)
      }
    }
    try {
      return ElectronBlocker.deserialize(new Uint8Array(await readFile(cache)))
    } catch {
      // missing or from an older engine version: build it again
      const fresh = await ElectronBlocker.fromPrebuiltFull(globalThis.fetch)
      await writeFile(cache, fresh.serialize())
      return fresh
    }
  }

  /** Should requests made by this tab skip the blocker? */
  private bypass(webContentsId: number | undefined, frameUrl?: string): boolean {
    const settings = this.profile.settings
    if (!settings.adblock) return true
    const tab = webContentsId != null ? this.lookup(webContentsId) : null
    const host = hostOf(tab?.url ?? frameUrl ?? '')
    if (!host) return false
    return settings.allowlist.some((h) => host === h || host.endsWith(`.${h}`))
  }

  /**
   * Strict HTTPS-only: every http:// request (pages, frames, scripts, images) is upgraded,
   * except on the user's own network. A page that has no HTTPS version shows a warning
   * with a button to open it anyway (see Tab).
   * Page addresses also lose click-tracking parameters (fbclid, gclid, utm_*...).
   */
  private upgrade(details: Electron.OnBeforeRequestListenerDetails): string | null {
    const s = this.profile.settings
    const page = details.resourceType === 'mainFrame'
    let url = details.url
    let changed = false
    if (s.httpsOnly && url.startsWith('http:') && details.method !== 'POST') {
      const up = upgradeToHttps(url)
      if (up) {
        url = up
        changed = true
      }
    }
    if (page && s.stripTracking) {
      const clean = stripTracking(url)
      if (clean) {
        url = clean
        changed = true
      }
    }
    return changed ? url : null
  }

  /**
   * Safe browsing runs before everything else and regardless of the ad blocker:
   * dangerous pages are cancelled before any byte is fetched and replaced by a warning.
   */
  private threat(details: Electron.OnBeforeRequestListenerDetails): boolean {
    if (!this.profile.settings.safeBrowsing) return false
    if (details.resourceType === 'mainFrame') {
      const verdict = this.guard.check(details.url)
      if (!verdict) return false
      const tab = details.webContentsId != null ? this.lookup(details.webContentsId) : null
      if (!tab) return false
      this.profile.addThreat()
      tab.onThreat(verdict)
      return true
    }
    // frames, scripts and downloads pulled from listed hosts are dropped silently
    try {
      return this.guard.listed(new URL(details.url).hostname) !== null
    } catch {
      return false
    }
  }

  /**
   * Requests the user's settings forbid no matter what the ad blocker says:
   *  - a public site reaching into the local network (router admin pages, printers,
   *    localhost services): the classic drive-by router attack. Opening such an address
   *    yourself still works; only pages, frames, scripts and fetches made by a site are dropped.
   *  - fonts downloaded by the page, when the user turned that off.
   */
  private forbidden(details: Electron.OnBeforeRequestListenerDetails): boolean {
    if (details.resourceType === 'mainFrame') return false
    const s = this.profile.settings
    if (s.blockRemoteFonts && details.resourceType === 'font' && /^https?:/.test(details.url)) return true
    if (!s.blockLocalNetwork) return false
    let target: string
    try {
      const u = new URL(details.url)
      if (!/^(https?|wss?):$/.test(u.protocol)) return false
      target = u.hostname
    } catch {
      return false
    }
    if (!isPrivateHost(target)) return false
    const tab = details.webContentsId != null ? this.lookup(details.webContentsId) : null
    const page = hostOf(tab?.url ?? '')
    // internal pages, blank pages and local sites may talk to the local network
    return !!page && !isPrivateHost(page)
  }

  /** Scripts are off for this page: add a Content-Security-Policy that forbids them. */
  private scriptHeaders(details: Electron.OnHeadersReceivedListenerDetails): Record<string, string[]> | null {
    if (details.resourceType !== 'mainFrame' && details.resourceType !== 'subFrame') return null
    if (!/^https?:/.test(details.url)) return null
    // frames follow the choice made for the page they are in
    const tab = details.resourceType === 'subFrame' && details.webContentsId != null ? this.lookup(details.webContentsId) : null
    const host = hostOf(tab?.url || details.url)
    if (scriptsAllowed(this.profile.settings, host)) return null
    const headers = { ...(details.responseHeaders ?? {}) }
    // several policies all apply, so adding one never loosens what the site already set
    headers['Content-Security-Policy'] = [...(headers['Content-Security-Policy'] ?? headers['content-security-policy'] ?? []), "script-src 'none'; worker-src 'none'"]
    delete headers['content-security-policy']
    return headers
  }

  private patch(blocker: ElectronBlocker): void {
    const beforeRequest = blocker.onBeforeRequest
    const headersReceived = blocker.onHeadersReceived
    const injectCosmetic = blocker.onInjectCosmeticFilters
    blocker.onBeforeRequest = (details, callback) => {
      if (this.threat(details) || this.forbidden(details)) return callback({ cancel: true })
      const redirect = this.upgrade(details)
      if (redirect) return callback({ redirectURL: redirect })
      if (details.resourceType === 'mainFrame' || this.bypass(details.webContentsId)) return callback({})
      beforeRequest(details, callback)
    }
    blocker.onHeadersReceived = (details, callback) => {
      const scripts = this.scriptHeaders(details)
      if (this.bypass(details.webContentsId)) return callback(scripts ? { responseHeaders: scripts } : {})
      if (!scripts) return headersReceived(details, callback)
      // let the blocker add its own headers first, then add the script policy on top
      headersReceived({ ...details, responseHeaders: scripts }, (res) => {
        if (res.cancel) return callback(res)
        callback({ ...res, responseHeaders: res.responseHeaders ?? scripts })
      })
    }
    blocker.onInjectCosmeticFilters = async (event, url, msg) => {
      if (this.bypass(event.sender.id, url)) return
      return injectCosmetic(event, url, msg)
    }
  }

  async attach(session: Session): Promise<void> {
    if (this.sessions.has(session)) return
    this.sessions.add(session)

    session.webRequest.onBeforeSendHeaders((details, callback) => {
      const headers = details.requestHeaders
      if (this.profile.settings.doNotTrack) {
        headers['DNT'] = '1'
        headers['Sec-GPC'] = '1'
      }
      callback({ requestHeaders: headers })
    })

    await this.ready
    if (this.blocker) {
      // Ghostery registers its IPC handlers once per enabled session; they are identical,
      // so drop the previous ones before enabling a second session (private windows).
      for (const ch of GHOSTERY_CHANNELS) ipcMain.removeHandler(ch)
      this.blocker.enableBlockingInSession(session)
    } else {
      session.webRequest.onBeforeRequest((details, callback) => {
        if (this.threat(details) || this.forbidden(details)) return callback({ cancel: true })
        const redirect = this.upgrade(details)
        callback(redirect ? { redirectURL: redirect } : {})
      })
      session.webRequest.onHeadersReceived((details, callback) => {
        const scripts = this.scriptHeaders(details)
        callback(scripts ? { responseHeaders: scripts } : {})
      })
    }
  }

  get loaded(): boolean {
    return this.blocker !== null
  }
}
