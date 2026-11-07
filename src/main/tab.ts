import { shell, WebContentsView, type ContextMenuParams, type Input, type NavigationEntry, type Session, type WebContents } from 'electron'
import { getLang, t } from '@shared/i18n'
import { join } from 'node:path'
import type { Settings, TabInfo, ThreatVerdict } from '@shared/types'
import { NEW_TAB_URL } from '@shared/types'
import { isInternalUrl, isNavigable, securityOf } from './url'
import { isTranslated, looksForeign } from './translate'
import { siteOf, upgradedFrom } from './privacy'

/** A tab with its own cookies, storage and cache, separate from every other tab. */
export interface Container {
  id: number
  hue: number
  session: Session
}

export interface TabHost {
  readonly session: Session
  readonly isPrivate: boolean
  tabChanged(tab: Tab): void
  openTab(url: string, opts: { background: boolean; opener: Tab }): void
  handleInput(input: Input, tab: Tab): boolean
  showPageMenu(tab: Tab, params: ContextMenuParams): void
  setHtmlFullscreen(tab: Tab, on: boolean): void
  foundInPage(tab: Tab, result: Electron.Result): void
  visited(tab: Tab): void
  titleChanged(tab: Tab): void
  zoomBy(tab: Tab, direction: 'in' | 'out'): void
  tabFocused(tab: Tab): void
  settings(): Settings
  /** The user clicked or typed on the page. */
  interacted(tab: Tab): void
  /** A pop-up or tab-under was stopped. */
  popupBlocked(tab: Tab, url: string, kind: 'popup' | 'tabunder'): void
  /** A navigation passed through these addresses (redirects); the last one is the page. */
  bounced(tab: Tab, chain: string[]): void
  chooseBluetooth(tab: Tab, devices: Electron.BluetoothDevice[], callback: (deviceId: string) => void): void
}

/** Input types that count as the user acting on the page. */
const GESTURES = new Set(['mouseDown', 'keyDown', 'rawKeyDown', 'touchStart', 'gestureTap', 'char'])

const INTERNAL_PRELOAD = join(__dirname, '../preload/internal.js')
const byWebContents = new Map<number, Tab>()
let nextId = 1

export interface TabInit {
  url: string
  spaceId: string
  pinned?: boolean
  title?: string
  favicon?: string | null
  /** Create without loading the page (session restore, background). */
  sleeping?: boolean
  container?: Container | null
}

export class Tab {
  readonly id = nextId++
  spaceId: string
  pinned: boolean
  url: string
  title: string
  favicon: string | null
  loading = false
  audible = false
  muted = false
  crashed = false
  zoom = 1
  blocked = 0
  popupsBlocked = 0
  lastActive = Date.now()
  view: WebContentsView | null = null
  private saved: { entries: NavigationEntry[]; index: number } | null = null
  /** Dangerous URL whose request was just cancelled; its failure must not show the generic error page. */
  private threatUrl: string | null = null
  /** <html lang> of the loaded page, read in an isolated world. */
  private pageLang: string | null = null
  /** JavaScript errors the current page logged (read by the AI assistant). */
  consoleErrors: { message: string; source: string; line: number }[] = []
  /** Last click, tap or key press on the page itself (like Chromium's user activation). */
  lastGesture = 0
  /** Address the user opened in this tab (typed, bookmark, link menu...). */
  private opened = { url: '', at: 0 }
  /** That gesture already opened a pop-up: the next one needs a new click. */
  private gestureSpent = false
  private popupAt = 0
  private popupGesture = 0
  /** Permissions granted "only this time": they end when the tab closes or leaves the site. */
  readonly grants = new Set<string>()
  /** Camera or microphone handed to the current site (shown on the tab). */
  private capture: TabInfo['capture'] = null
  readonly container: Container | null
  /** Addresses the current navigation went through (for bounce tracking). */
  private chain: string[] = []
  private committedAt = 0
  private gestureSinceCommit = false

  static fromWebContents(id: number): Tab | undefined {
    return byWebContents.get(id)
  }

  constructor(private readonly host: TabHost, init: TabInit) {
    this.spaceId = init.spaceId
    this.pinned = init.pinned ?? false
    this.url = init.url || NEW_TAB_URL
    this.title = init.title ?? ''
    this.favicon = init.favicon ?? null
    this.container = init.container ?? null
    if (!init.sleeping) this.wake()
  }

  get session(): Session {
    return this.container?.session ?? this.host.session
  }

  /** Settings that act on the page process directly. */
  applyPrivacy(): void {
    const wc = this.wc
    if (!wc) return
    // WebRTC (video calls) may only use the public address, never the local network ones
    wc.setWebRTCIPHandlingPolicy(this.host.settings().webrtcProtection ? 'default_public_interface_only' : 'default')
  }

  /** The user acted on the page within `ms`. */
  gestureWithin(ms: number): boolean {
    return Date.now() - this.lastGesture < ms
  }

  /**
   * A download is the user's own when they clicked or typed on the page in the last
   * 10 s, or opened the file's address themselves. Anything else is a drive-by download.
   */
  startedByUser(chain: string[]): boolean {
    if (Date.now() - this.lastGesture < 10_000) return true
    return Date.now() - this.opened.at < 30_000 && chain.includes(this.opened.url)
  }

  private gesture(): void {
    this.lastGesture = Date.now()
    this.gestureSpent = false
    this.gestureSinceCommit = true
    this.host.interacted(this)
  }

  get sleeping(): boolean {
    return this.view === null
  }

  get wc(): WebContents | null {
    return this.view && !this.view.webContents.isDestroyed() ? this.view.webContents : null
  }

  /** URL shown to the user: error pages display the address that failed. */
  get displayUrl(): string {
    if (this.url.startsWith('halyard://error/') || this.url.startsWith('halyard://blocked/')) {
      try {
        return new URL(this.url).searchParams.get('url') ?? this.url
      } catch {
        return this.url
      }
    }
    return this.url
  }

  wake(): void {
    if (this.view) return
    const view = new WebContentsView({
      webPreferences: {
        session: this.session,
        preload: INTERNAL_PRELOAD,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
        spellcheck: true,
        safeDialogs: true,
        autoplayPolicy: 'document-user-activation-required'
      }
    })
    view.setBorderRadius(10)
    this.view = view
    this.paintBackground(this.url)
    byWebContents.set(view.webContents.id, this)
    this.wire(view.webContents)
    view.webContents.setAudioMuted(this.muted)
    this.applyPrivacy()

    if (this.saved && this.saved.entries.length) {
      const { entries, index } = this.saved
      this.saved = null
      void view.webContents.navigationHistory.restore({ entries, index }).catch(() => this.load(this.url))
    } else {
      this.load(this.url)
    }
    this.host.tabChanged(this)
  }

  sleep(): void {
    const wc = this.wc
    if (!wc || !this.view) return
    try {
      this.saved = {
        entries: wc.navigationHistory.getAllEntries(),
        index: wc.navigationHistory.getActiveIndex()
      }
    } catch {
      this.saved = null
    }
    this.disposeView()
    this.loading = false
    this.audible = false
    this.host.tabChanged(this)
  }

  load(url: string): void {
    if (!isNavigable(url)) return
    this.url = url
    this.crashed = false
    // the user opened this address: a download it leads to is theirs (see startedByUser)
    this.opened = { url, at: Date.now() }
    if (!this.view) {
      this.wake()
      return
    }
    void this.view.webContents.loadURL(url).catch(() => {
      /* failures are handled by did-fail-load */
    })
  }

  /** The guard cancelled a navigation: show the warning page in its place. */
  showThreat(verdict: ThreatVerdict): void {
    this.threatUrl = verdict.url
    const params = new URLSearchParams({ kind: verdict.kind, url: verdict.url, host: verdict.host })
    if (verdict.suggestion) params.set('suggest', verdict.suggestion)
    setImmediate(() => this.wc && void this.wc.loadURL(`halyard://blocked/?${params}`).catch(() => undefined))
  }

  reload(hard = false): void {
    const wc = this.wc
    if (!wc) return this.wake()
    if (this.url.startsWith('halyard://blocked/')) return wc.reload()
    if (this.url.startsWith('halyard://error/') || this.crashed) return this.load(this.displayUrl)
    if (hard) wc.reloadIgnoringCache()
    else wc.reload()
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    this.wc?.setAudioMuted(muted)
    this.host.tabChanged(this)
  }

  info(): TabInfo {
    const wc = this.wc
    const history = wc?.navigationHistory
    return {
      id: this.id,
      spaceId: this.spaceId,
      url: this.displayUrl,
      title: this.title || this.fallbackTitle(),
      favicon: this.favicon,
      loading: this.loading,
      canGoBack: history ? history.canGoBack() : (this.saved?.index ?? 0) > 0,
      canGoForward: history ? history.canGoForward() : this.saved ? this.saved.index < this.saved.entries.length - 1 : false,
      pinned: this.pinned,
      muted: this.muted,
      audible: this.audible,
      sleeping: this.sleeping,
      crashed: this.crashed,
      zoom: this.zoom,
      blocked: this.blocked,
      security: this.url.startsWith('halyard://blocked/')
        ? 'dangerous'
        : securityOf(this.url.startsWith('halyard://error/') ? this.displayUrl : this.url),
      lastActive: this.lastActive,
      translated: isTranslated(this.url),
      foreign: /^https?:/.test(this.url) && !isTranslated(this.url) && looksForeign(this.pageLang, getLang()),
      container: this.container?.hue ?? null,
      capture: this.capture
    }
  }

  /** The page was given the camera and/or microphone: show it on the tab until it leaves the site. */
  markCapture(kind: string): void {
    const cam = kind.includes('camera') || this.capture === 'camera' || this.capture === 'both'
    const mic = kind.includes('microphone') || this.capture === 'microphone' || this.capture === 'both'
    const next: TabInfo['capture'] = cam && mic ? 'both' : cam ? 'camera' : mic ? 'microphone' : null
    if (next === this.capture) return
    this.capture = next
    this.host.tabChanged(this)
  }

  private fallbackTitle(): string {
    if (this.url === NEW_TAB_URL) return t('page.newtab')
    try {
      return new URL(this.displayUrl).hostname || this.displayUrl
    } catch {
      return this.displayUrl
    }
  }

  /** Internal pages draw their own themed background; web pages get Chromium's white. */
  private paintBackground(url: string): void {
    this.view?.setBackgroundColor(isInternalUrl(url) ? '#00000000' : '#ffffff')
  }

  destroy(): void {
    this.disposeView()
  }

  private disposeView(): void {
    const view = this.view
    if (!view) return
    this.view = null
    byWebContents.delete(view.webContents.id)
    view.removeAllListeners()
    if (!view.webContents.isDestroyed()) view.webContents.close()
  }

  private wire(wc: WebContents): void {
    const changed = (): void => this.host.tabChanged(this)

    wc.on('did-start-loading', () => {
      this.loading = true
      changed()
    })
    wc.on('did-stop-loading', () => {
      this.loading = false
      // a typed address that turned into a download leaves the page as it was
      const current = wc.getURL()
      if (current && current !== this.url && !this.threatUrl) this.url = current
      changed()
    })
    wc.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) {
        this.blocked = 0
        this.popupsBlocked = 0
        this.pageLang = null
        this.consoleErrors = []
        this.paintBackground(details.url)
        // a page that sends you on by itself, right away and untouched, was only a bounce
        const bounce = !!details.initiator && !this.gestureSinceCommit && Date.now() - this.committedAt < 5000 && /^https?:/.test(this.url)
        if (!bounce) this.chain = []
        else if (this.chain.at(-1) !== this.url) this.chain.push(this.url)
        this.chain.push(details.url)
      }
    })
    wc.on('did-redirect-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument && this.chain.length < 20) this.chain.push(details.url)
    })
    wc.on('did-navigate', (_e, url) => {
      const before = this.url
      this.url = url
      this.crashed = false
      this.committedAt = Date.now()
      this.gestureSinceCommit = false
      if (this.chain.at(-1) !== url) this.chain.push(url)
      if (this.chain.length >= 2 && /^https?:/.test(url)) this.host.bounced(this, [...this.chain])
      // "only this time" permissions end when the tab leaves the site
      if (siteOf(before) !== siteOf(url)) {
        this.grants.clear()
        this.capture = null
      }
      if (!isInternalUrl(url)) this.host.visited(this)
      if (isInternalUrl(url)) this.favicon = null
      changed()
    })
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (!isMainFrame) return
      this.url = url
      if (!isInternalUrl(url)) this.host.visited(this)
      changed()
    })
    wc.on('console-message', (details) => {
      if (details.level !== 'error' || this.consoleErrors.length >= 40) return
      this.consoleErrors.push({ message: String(details.message).slice(0, 600), source: String(details.sourceId).slice(0, 500), line: details.lineNumber })
    })
    wc.on('did-finish-load', () => {
      if (!/^https?:/.test(wc.getURL())) return
      // isolated world: the page's own scripts cannot see or tamper with this
      void wc
        .executeJavaScriptInIsolatedWorld(1001, [{ code: 'document.documentElement.lang || ""' }])
        .then((lang: unknown) => {
          this.pageLang = typeof lang === 'string' && lang ? lang.slice(0, 20) : null
          changed()
        })
        .catch(() => undefined)
    })
    wc.on('page-title-updated', (_e, title) => {
      this.title = title
      this.host.titleChanged(this)
      changed()
    })
    wc.on('page-favicon-updated', (_e, favicons) => {
      const icon = favicons.find((f) => /^(https?|data):/.test(f)) ?? null
      if (icon && icon !== this.favicon) {
        this.favicon = icon
        this.host.titleChanged(this)
        changed()
      }
    })
    wc.on('did-fail-load', (_e, code, description, validatedURL, isMainFrame) => {
      // -3 is ERR_ABORTED: the user stopped or replaced the navigation.
      if (!isMainFrame || code === -3 || isInternalUrl(validatedURL)) return
      if (validatedURL === this.threatUrl) {
        this.threatUrl = null
        return
      }
      // HTTPS-only: the secure version does not exist; offer the original address
      const plain = upgradedFrom(validatedURL)
      const params = new URLSearchParams({ code: String(code), desc: description, url: plain ?? validatedURL })
      if (plain) params.set('https', '1')
      void wc.loadURL(`halyard://error/?${params}`)
    })
    wc.on('render-process-gone', (_e, details) => {
      if (details.reason === 'clean-exit') return
      this.crashed = true
      this.loading = false
      changed()
    })
    wc.on('audio-state-changed', (e) => {
      this.audible = e.audible
      changed()
    })
    wc.on('zoom-changed', (_e, direction) => this.host.zoomBy(this, direction))
    wc.on('enter-html-full-screen', () => this.host.setHtmlFullscreen(this, true))
    wc.on('leave-html-full-screen', () => this.host.setHtmlFullscreen(this, false))
    wc.on('found-in-page', (_e, result) => this.host.foundInPage(this, result))
    wc.on('focus', () => this.host.tabFocused(this))
    wc.on('context-menu', (_e, params) => this.host.showPageMenu(this, params))
    wc.on('before-input-event', (e, input) => {
      if (this.host.handleInput(input, this)) e.preventDefault()
    })
    wc.on('input-event', (_e, input) => {
      if (GESTURES.has(input.type)) this.gesture()
    })
    // Web Bluetooth: Chromium would pick the first device on its own; the user chooses instead
    wc.on('select-bluetooth-device', (e, devices, callback) => {
      e.preventDefault()
      this.host.chooseBluetooth(this, devices, callback)
    })

    // Web pages may not navigate into halyard:// pages or embed them.
    wc.on('will-navigate', (e) => {
      if (!isNavigable(e.url)) {
        e.preventDefault()
        openExternalSafely(e.url)
        return
      }
      if (isInternalUrl(e.url) && !isInternalUrl(wc.getURL())) {
        e.preventDefault()
        return
      }
      // tab-under: the page opens a pop-up and swaps itself for another site behind your back
      if (this.host.settings().blockPopups && Date.now() - this.popupAt < 3000 && this.lastGesture === this.popupGesture && /^https?:/.test(e.url) && siteOf(e.url) !== siteOf(wc.getURL())) {
        e.preventDefault()
        this.host.popupBlocked(this, e.url, 'tabunder')
      }
    })
    wc.on('will-frame-navigate', (e) => {
      if (!e.isMainFrame && isInternalUrl(e.url)) e.preventDefault()
    })
    // ...nor get there through a server redirect (302 to halyard://settings)
    wc.on('will-redirect', (e) => {
      if (isInternalUrl(e.url) && !isInternalUrl(wc.getURL())) e.preventDefault()
    })

    wc.setWindowOpenHandler(({ url, disposition, features }) => {
      if (!isNavigable(url) || isInternalUrl(url)) {
        if (!isNavigable(url)) openExternalSafely(url)
        return { action: 'deny' }
      }
      // pop-ups need a fresh click or key press, and each one opens a single window
      if (this.host.settings().blockPopups) {
        if (!this.gestureWithin(5000) || this.gestureSpent) {
          this.host.popupBlocked(this, url, 'popup')
          return { action: 'deny' }
        }
        this.gestureSpent = true
        if (disposition === 'new-window' || disposition === 'foreground-tab') {
          this.popupAt = Date.now()
          this.popupGesture = this.lastGesture
        }
      }
      // Sized popups (OAuth, payment windows) keep their opener; links become tabs.
      if (disposition === 'new-window' && features.includes('width')) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            autoHideMenuBar: true,
            backgroundColor: '#ffffff',
            webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
          }
        }
      }
      this.host.openTab(url, { background: disposition === 'background-tab', opener: this })
      return { action: 'deny' }
    })
  }
}

/** mailto:, tel: and similar go to the system; anything else is ignored. */
function openExternalSafely(url: string): void {
  if (/^(mailto|tel|sms|magnet|zoommtg|msteams|spotify|steam):/i.test(url)) void shell.openExternal(url)
}
