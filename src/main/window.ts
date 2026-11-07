import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  nativeTheme,
  shell,
  screen,
  session as electronSession,
  WebContentsView,
  type ContextMenuParams,
  type Input,
  type Session
} from 'electron'
import { join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { Tab, type Container, type TabHost } from './tab'
import { scriptsAllowed, siteOf, type BounceGuard } from './privacy'
import { quickRisk } from './linkcheck'
import type { Profile, SavedWindow } from './profile'
import type { Account } from './account'
import type { Downloads } from './downloads'
import type { Shield } from './adblock'
import type { Updater } from './updater'
import type { Guard } from './guard'
import type { AiEngine } from './ai'
import { Agent } from './agent'
import { copyPng } from './clip'
import { hostOf, isInternalUrl, originOf, resolveInput } from './url'
import { COMMANDS, KEYMAP, commandLabel, normalizeKey } from '@shared/commands'
import { BRAND, getLang, locale, t, type I18nKey } from '@shared/i18n'
import { googleLang, isTranslated, originalUrl, TRANSLATE_TARGETS, translatable, translateUrl } from './translate'
import {
  NEW_TAB_URL,
  SEARCH_ENGINES,
  type Command,
  type ContentInsets,
  type DownloadRequest,
  type MenuEntry,
  type FindState,
  type FrozenFrame,
  type PaletteItem,
  type PermissionPrompt,
  type Settings,
  type SiteInfo,
  type Space,
  type SplitState,
  type UiAction,
  type UiEvents,
  type WindowState
} from '@shared/types'

export interface Services {
  profile: Profile
  account: Account
  ai: AiEngine
  downloads: Downloads
  shield: Shield
  guard: Guard
  bounce: BounceGuard
  updater: Updater
  openWindow(opts: { isPrivate: boolean; url?: string }): BrowserController
  sessionChanged(): void
  windowClosing(controller: BrowserController): void
  loadChrome(win: BrowserWindow): void
  prepareSession(session: Session): void
  /** Open (or focus) the Halyard Lab window. */
  openLab(): void
  /** "Clear everything" after the user confirms. */
  panic(from: BrowserController): Promise<void>
}

/** Largest image Halyard downloads to look for a QR Code. */
const QR_IMAGE_MAX = 10 * 1024 * 1024

const privateSpace = (): Space => ({ id: 'privado', name: t('page.private'), hue: 292, icon: '◐' })
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5]
const SPLIT_GAP = 8

let privateCounter = 0
let containerCounter = 0
/** Container colours, picked in turn. */
const CONTAINER_HUES = [200, 145, 28, 330, 50, 275, 0, 170]

export class BrowserController implements TabHost {
  static readonly all = new Map<number, BrowserController>()
  static lastFocused: BrowserController | null = null

  readonly win: BrowserWindow
  readonly session: Session
  readonly isPrivate: boolean
  readonly id: number

  private tabs = new Map<number, Tab>()
  private order: number[] = []
  private activeBySpace = new Map<string, number>()
  private activeSpaceId: string
  private split: SplitState | null = null
  private insets: ContentInsets = { left: 272, top: 48, right: 8, bottom: 8 }
  private viewsHidden = false
  /** What each tab showed when the views were last hidden behind a panel (capture returns nothing while hidden). */
  private lastFrames = new Map<number, Electron.NativeImage>()
  private attached = new Set<Tab>()
  private fullscreenTab: number | null = null
  private wasFullscreen = false
  private find: FindState = { open: false, matches: 0, active: 0 }
  private prompts: PermissionPrompt[] = []
  private promptCallbacks = new Map<number, (allow: boolean) => void>()
  private promptCounter = 1
  private stateTimer: NodeJS.Timeout | null = null
  private suggestCache = new Map<string, string[]>()
  private openedFrom = new Map<number, number>()
  /** The local AI assistant of this window. */
  readonly agent: Agent

  constructor(private readonly svc: Services, opts: { isPrivate: boolean; saved?: SavedWindow; url?: string }) {
    this.isPrivate = opts.isPrivate
    this.session = opts.isPrivate ? electronSession.fromPartition(`halyard-private-${++privateCounter}`) : electronSession.defaultSession
    this.activeSpaceId = opts.isPrivate ? 'privado' : (svc.profile.spaces[0]?.id ?? 'pessoal')
    svc.prepareSession(this.session)

    const bounds = this.initialBounds(opts.saved)
    this.win = new BrowserWindow({
      ...bounds,
      minWidth: 640,
      minHeight: 420,
      show: false,
      title: opts.isPrivate ? `${BRAND} — ${t('page.private')}` : BRAND,
      backgroundColor: '#16141d',
      titleBarStyle: 'hidden',
      titleBarOverlay: process.platform === 'darwin' ? undefined : { color: '#16141d', symbolColor: '#e9e6f2', height: 36 },
      trafficLightPosition: { x: 14, y: 13 },
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
        backgroundThrottling: false
      }
    })
    this.id = this.win.id
    this.agent = new Agent(
      {
        session: this.session,
        tabById: (id) => this.tabs.get(id),
        activeTab: () => this.activeTab(),
        isShown: (tab) => this.isVisible(tab) && !this.viewsHidden,
        searchUrl: (q) => SEARCH_ENGINES[svc.profile.settings.searchEngine].search.replace('%s', encodeURIComponent(q)),
        publish: (state) => this.send('agent', state),
        openPanel: () => this.send('ui-action', { action: 'agent', open: true })
      },
      svc.ai
    )
    BrowserController.all.set(this.id, this)
    BrowserController.lastFocused = this

    this.hardenChrome()
    this.wireWindow(opts.saved?.maximized ?? false)
    svc.loadChrome(this.win)

    if (opts.saved && opts.saved.tabs.length) this.restore(opts.saved)
    else this.createTab(opts.url ?? NEW_TAB_URL)
    if (opts.url && opts.saved) this.createTab(opts.url)
  }

  // ------------------------------------------------------------------ setup

  private initialBounds(saved?: SavedWindow): Electron.Rectangle {
    const area = screen.getPrimaryDisplay().workArea
    const fallback = {
      width: Math.min(1440, Math.round(area.width * 0.86)),
      height: Math.min(920, Math.round(area.height * 0.88)),
      x: 0,
      y: 0
    }
    fallback.x = area.x + Math.round((area.width - fallback.width) / 2)
    fallback.y = area.y + Math.round((area.height - fallback.height) / 2)
    const b = saved?.bounds
    if (!b) return fallback
    const visible = screen.getAllDisplays().some((d) => {
      const w = d.workArea
      return b.x < w.x + w.width - 80 && b.x + b.width > w.x + 80 && b.y >= w.y - 20 && b.y < w.y + w.height - 80
    })
    return visible ? b : fallback
  }

  private hardenChrome(): void {
    const wc = this.win.webContents
    wc.on('will-navigate', (e) => e.preventDefault())
    wc.setWindowOpenHandler(() => ({ action: 'deny' }))
    wc.on('before-input-event', (e, input) => {
      if (this.handleInput(input, null)) e.preventDefault()
    })
  }

  private wireWindow(maximize: boolean): void {
    const win = this.win
    win.once('ready-to-show', () => {
      if (maximize) win.maximize()
      win.show()
    })
    win.on('focus', () => (BrowserController.lastFocused = this))
    win.on('resize', () => this.layout())
    for (const ev of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'] as const) {
      win.on(ev as 'maximize', () => {
        this.layout()
        this.scheduleState()
      })
    }
    win.on('moved', () => this.svc.sessionChanged())
    win.on('close', () => this.svc.windowClosing(this))
    win.on('closed', () => {
      this.cancelPendingDownloads()
      this.agent.dispose()
      const containers = new Set([...this.tabs.values()].map((x) => x.container).filter((c): c is Container => !!c))
      for (const tab of this.tabs.values()) tab.destroy()
      this.tabs.clear()
      for (const c of containers) void c.session.clearStorageData().then(() => c.session.clearCache()).catch(() => undefined)
      BrowserController.all.delete(this.id)
      if (BrowserController.lastFocused === this) BrowserController.lastFocused = [...BrowserController.all.values()].at(-1) ?? null
      if (this.isPrivate) void this.session.clearStorageData().then(() => this.session.clearCache())
    })
    win.webContents.on('did-finish-load', () => {
      this.pushState()
      this.send('settings', this.svc.profile.settings)
      this.send('downloads', this.svc.downloads.list())
    })
  }

  private restore(saved: SavedWindow): void {
    const spaces = new Set(this.spaces().map((s) => s.id))
    if (spaces.has(saved.activeSpaceId)) this.activeSpaceId = saved.activeSpaceId
    const created: Tab[] = []
    for (const t of saved.tabs) {
      const spaceId = spaces.has(t.spaceId) ? t.spaceId : this.activeSpaceId
      const tab = new Tab(this, { url: t.url, spaceId, pinned: t.pinned, title: t.title, favicon: t.favicon, sleeping: true })
      this.tabs.set(tab.id, tab)
      this.order.push(tab.id)
      created.push(tab)
    }
    for (const [spaceId, index] of Object.entries(saved.activeBySpace)) {
      const tab = created[index]
      if (tab) this.activeBySpace.set(spaceId, tab.id)
    }
    const active = this.activeTab() ?? this.visibleTabs()[0]
    if (active) this.activate(active.id)
    else this.createTab(NEW_TAB_URL)
  }

  serialize(): SavedWindow {
    const ordered = this.order.map((id) => this.tabs.get(id)!).filter(Boolean)
    const activeBySpace: Record<string, number> = {}
    for (const [spaceId, tabId] of this.activeBySpace) {
      const idx = ordered.findIndex((t) => t.id === tabId)
      if (idx >= 0) activeBySpace[spaceId] = idx
    }
    return {
      tabs: ordered
        .map((t) => ({ url: t.displayUrl, title: t.title, favicon: t.favicon, spaceId: t.spaceId, pinned: t.pinned })),
      activeBySpace,
      activeSpaceId: this.activeSpaceId,
      bounds: this.win.isDestroyed() ? undefined : this.win.getNormalBounds(),
      maximized: this.win.isDestroyed() ? false : this.win.isMaximized()
    }
  }

  // ------------------------------------------------------------------ state

  spaces(): Space[] {
    return this.isPrivate ? [privateSpace()] : this.svc.profile.spaces
  }

  private orderedTabs(): Tab[] {
    return this.order.map((id) => this.tabs.get(id)).filter((t): t is Tab => !!t)
  }

  /** Pinned tabs live in every space; the rest belong to one. */
  private visibleTabs(): Tab[] {
    const all = this.orderedTabs()
    return [...all.filter((t) => t.pinned), ...all.filter((t) => !t.pinned && t.spaceId === this.activeSpaceId)]
  }

  activeTab(): Tab | null {
    const id = this.activeBySpace.get(this.activeSpaceId)
    const tab = id != null ? this.tabs.get(id) : undefined
    if (!tab) return null
    if (!tab.pinned && tab.spaceId !== this.activeSpaceId) return null
    return tab
  }

  state(): WindowState {
    const settings = this.svc.profile.settings
    const active = this.activeTab()
    return {
      windowId: this.id,
      isPrivate: this.isPrivate,
      tabs: this.orderedTabs().map((t) => t.info()),
      spaces: this.spaces(),
      activeSpaceId: this.activeSpaceId,
      activeTabId: active?.id ?? null,
      split: this.split,
      sidebarCollapsed: settings.sidebarCollapsed,
      htmlFullscreen: this.fullscreenTab !== null,
      maximized: this.win.isMaximized(),
      find: this.find,
      prompts: this.prompts.filter((p) => p.tabId === active?.id || p.tabId === this.split?.left || p.tabId === this.split?.right),
      adblockEnabled: settings.adblock,
      allowlist: settings.allowlist,
      totalBlocked: this.svc.profile.totalBlocked
    }
  }

  send<K extends keyof UiEvents>(event: K, payload: UiEvents[K]): void {
    if (!this.win.isDestroyed()) this.win.webContents.send(event, payload)
  }

  uiAction(action: UiAction): void {
    // keyboard focus must leave the page so the UI's input receives typing
    if (!this.win.isDestroyed()) this.win.webContents.focus()
    this.send('ui-action', action)
  }

  scheduleState(): void {
    if (this.stateTimer) return
    this.stateTimer = setTimeout(() => this.pushState(), 16)
  }

  private pushState(): void {
    if (this.stateTimer) clearTimeout(this.stateTimer)
    this.stateTimer = null
    if (this.win.isDestroyed()) return
    this.send('state', this.state())
    this.updateTitle()
    if (!this.isPrivate) this.svc.sessionChanged()
  }

  private updateTitle(): void {
    const tab = this.activeTab()
    const base = this.isPrivate ? `${BRAND} — ${t('page.private')}` : BRAND
    this.win.setTitle(tab ? `${tab.info().title} — ${base}` : base)
  }

  // ------------------------------------------------------------------ TabHost

  tabChanged(tab: Tab): void {
    if (tab.crashed && this.isVisible(tab)) this.layout()
    this.scheduleState()
  }

  openTab(url: string, opts: { background: boolean; opener: Tab }): void {
    // links from a container tab stay in the same container (logins keep working)
    this.createTab(url, {
      background: opts.background,
      after: opts.opener,
      spaceId: opts.opener.pinned ? undefined : opts.opener.spaceId,
      container: opts.opener.container
    })
  }

  settings(): Settings {
    return this.svc.profile.settings
  }

  interacted(tab: Tab): void {
    if (!/^https?:/.test(tab.url)) return
    this.svc.bounce.interacted(tab.url, !this.isPrivate && !tab.container)
  }

  private popupToastAt = new Map<number, number>()

  popupBlocked(tab: Tab, url: string, kind: 'popup' | 'tabunder'): void {
    tab.popupsBlocked++
    const last = this.popupToastAt.get(tab.id) ?? 0
    if (Date.now() - last > 8000) {
      this.popupToastAt.set(tab.id, Date.now())
      const host = hostOf(tab.url) || hostOf(url)
      this.toast(kind === 'popup' ? t('toast.popup', { host }) : t('toast.tabunder', { host }))
    }
    this.scheduleState()
  }

  bounced(tab: Tab, chain: string[]): void {
    if (!this.svc.profile.settings.bounceProtection) return
    this.svc.bounce.bounced(chain, tab.session)
  }

  private bluetooth = new Map<number, { devices: Electron.BluetoothDevice[]; callback: (id: string) => void; timer: NodeJS.Timeout | null }>()

  /** Chromium keeps reporting devices as it finds them: wait a moment, then let the user pick. */
  chooseBluetooth(tab: Tab, devices: Electron.BluetoothDevice[], callback: (deviceId: string) => void): void {
    const pending = this.bluetooth.get(tab.id)
    if (pending) {
      pending.devices = devices
      return
    }
    const entry = { devices, callback, timer: null as NodeJS.Timeout | null }
    this.bluetooth.set(tab.id, entry)
    entry.timer = setTimeout(() => {
      entry.timer = null
      const list = entry.devices.map((d) => ({ id: d.deviceId, label: d.deviceName || d.deviceId }))
      void this.chooseDevice(tab, 'bluetooth', list).then((id) => {
        this.bluetooth.delete(tab.id)
        entry.callback(id ?? '')
      })
    }, 2500)
  }

  /** Halyard's device picker (USB, HID, serial, Bluetooth). Cancel is the default. */
  async chooseDevice(tab: Tab, kind: 'usb' | 'hid' | 'serial' | 'bluetooth', devices: { id: string; label: string }[]): Promise<string | null> {
    if (this.win.isDestroyed()) return null
    const host = hostOf(tab.url) || tab.url
    const what = t(`dev.${kind}` as I18nKey)
    if (!devices.length) {
      this.toast(t('dev.none', { what }))
      return null
    }
    const shown = devices.slice(0, 8)
    const { response } = await dialog.showMessageBox(this.win, {
      type: 'question',
      title: BRAND,
      message: t('dev.title', { host, what }),
      detail: t('dev.detail'),
      buttons: [...shown.map((d) => d.label.slice(0, 60)), t('common.cancel')],
      cancelId: shown.length,
      defaultId: shown.length,
      noLink: true
    })
    return response < shown.length ? shown[response].id : null
  }

  /** The tab is on screen (not behind another tab or a menu). */
  tabShown(tab: Tab): boolean {
    return this.isVisible(tab) && !this.viewsHidden && !this.win.isMinimized()
  }

  /** New tab with its own cookies, logins and cache: nothing is shared with other tabs. */
  createContainerTab(url = NEW_TAB_URL): Tab {
    const id = ++containerCounter
    const ses = electronSession.fromPartition(`halyard-ctr-${id}`)
    this.svc.prepareSession(ses)
    const container: Container = { id, hue: CONTAINER_HUES[(id - 1) % CONTAINER_HUES.length], session: ses }
    return this.createTab(url, { container })
  }

  visited(tab: Tab): void {
    if (tab.wc) tab.zoom = tab.wc.getZoomFactor()
    this.warnRiskyDomain(tab)
    this.denyPrompts(tab.id)
    if (this.find.open && this.isVisible(tab)) this.closeFind()
    if (!this.isPrivate) this.svc.profile.addVisit(tab.url, tab.title, tab.favicon)
  }

  titleChanged(tab: Tab): void {
    if (!this.isPrivate) this.svc.profile.touchVisit(tab.url, { title: tab.title, favicon: tab.favicon })
  }

  zoomBy(tab: Tab, direction: 'in' | 'out' | 'reset'): void {
    const wc = tab.wc
    if (!wc) return
    const current = wc.getZoomFactor()
    let next = 1
    if (direction === 'in') next = ZOOM_STEPS.find((z) => z > current + 0.001) ?? current
    else if (direction === 'out') next = [...ZOOM_STEPS].reverse().find((z) => z < current - 0.001) ?? current
    wc.setZoomFactor(next)
    tab.zoom = next
    this.scheduleState()
  }

  setHtmlFullscreen(tab: Tab, on: boolean): void {
    if (on) {
      this.wasFullscreen = this.win.isFullScreen()
      this.fullscreenTab = tab.id
      if (!this.wasFullscreen) this.win.setFullScreen(true)
      if (this.svc.profile.settings.fullscreenWarn && /^https?:/.test(tab.url)) setTimeout(() => this.fullscreenBubble(hostOf(tab.url)), 250)
    } else if (this.fullscreenTab === tab.id) {
      this.fullscreenTab = null
      this.closeBubble()
      if (!this.wasFullscreen) this.win.setFullScreen(false)
    }
    this.layout()
    this.scheduleState()
  }

  /** In split view, clicking into a pane makes it the active tab. */
  tabFocused(tab: Tab): void {
    if (!this.split || this.activeTab() === tab) return
    if (this.split.left !== tab.id && this.split.right !== tab.id) return
    const prev = this.activeTab()
    if (prev) prev.lastActive = Date.now()
    if (this.find.open) this.closeFind()
    this.activeBySpace.set(this.activeSpaceId, tab.id)
    tab.lastActive = Date.now()
    this.scheduleState()
  }

  foundInPage(tab: Tab, result: Electron.Result): void {
    if (tab !== this.activeTab()) return
    this.find = { open: true, matches: result.matches, active: result.activeMatchOrdinal }
    this.scheduleState()
  }

  // ------------------------------------------------------------------ tabs

  createTab(
    url = NEW_TAB_URL,
    opts: { background?: boolean; after?: Tab; spaceId?: string; pinned?: boolean; container?: Container | null } = {}
  ): Tab {
    const spaceId = opts.spaceId && this.spaces().some((s) => s.id === opts.spaceId) ? opts.spaceId : this.activeSpaceId
    const tab = new Tab(this, { url, spaceId, pinned: opts.pinned ?? false, sleeping: false, container: opts.container ?? null })
    this.tabs.set(tab.id, tab)
    const afterIdx = opts.after ? this.order.indexOf(opts.after.id) : -1
    if (afterIdx >= 0) {
      // keep consecutive links from the same opener in click order
      let idx = afterIdx + 1
      while (idx < this.order.length && this.openedFrom.get(this.order[idx]) === opts.after!.id) idx++
      this.order.splice(idx, 0, tab.id)
      this.openedFrom.set(tab.id, opts.after!.id)
    } else {
      this.order.push(tab.id)
    }
    if (!opts.background || this.visibleTabs().length === 1) this.activate(tab.id)
    else this.scheduleState()
    return tab
  }


  activate(tabId: number): void {
    const tab = this.tabs.get(tabId)
    if (!tab) return
    if (!tab.pinned && tab.spaceId !== this.activeSpaceId) this.activeSpaceId = tab.spaceId
    const prev = this.activeTab()
    if (prev && prev !== tab) {
      prev.lastActive = Date.now()
      if (this.find.open) this.closeFind()
    }
    this.activeBySpace.set(this.activeSpaceId, tab.id)
    tab.lastActive = Date.now()
    if (this.split && this.split.left !== tab.id && this.split.right !== tab.id) this.split = null
    if (tab.sleeping) tab.wake()
    this.layout()
    if (!this.viewsHidden) tab.wc?.focus()
    this.scheduleState()
  }

  closeTab(tabId: number): void {
    const tab = this.tabs.get(tabId)
    if (!tab) return
    const wasActive = this.activeTab() === tab
    const visible = this.visibleTabs()
    const idx = visible.indexOf(tab)

    if (!this.isPrivate && !isInternalUrl(tab.url)) {
      this.svc.profile.pushClosedTab({ url: tab.displayUrl, title: tab.title, favicon: tab.favicon, spaceId: tab.spaceId, pinned: tab.pinned })
    }
    if (this.split && (this.split.left === tabId || this.split.right === tabId)) {
      const other = this.split.left === tabId ? this.split.right : this.split.left
      this.split = null
      if (wasActive) this.activeBySpace.set(this.activeSpaceId, other)
    }
    this.denyPrompts(tabId)
    this.attached.delete(tab)
    if (tab.view) this.win.contentView.removeChildView(tab.view)
    tab.destroy()
    tab.grants.clear()
    this.tabs.delete(tabId)
    this.popupToastAt.delete(tabId)
    // the last tab of a container takes its cookies and storage with it
    const ctr = tab.container
    if (ctr && ![...this.tabs.values()].some((x) => x.container === ctr)) {
      void ctr.session.clearStorageData().then(() => ctr.session.clearCache()).catch(() => undefined)
    }
    this.order = this.order.filter((id) => id !== tabId)
    this.openedFrom.delete(tabId)
    for (const [space, id] of this.activeBySpace) if (id === tabId) this.activeBySpace.delete(space)

    const remaining = this.visibleTabs()
    if (remaining.length === 0) {
      this.createTab(NEW_TAB_URL)
      return
    }
    if (wasActive || !this.activeTab()) {
      // prefer the tab that opened this one, then the neighbour below, then above
      const opener = this.openedFrom.get(tabId)
      const next = (opener && remaining.find((t) => t.id === opener)) || remaining[Math.min(idx, remaining.length - 1)]
      this.activate(next.id)
    } else {
      this.layout()
      this.scheduleState()
    }
  }

  moveTab(tabId: number, toIndex: number, pinned: boolean): void {
    const tab = this.tabs.get(tabId)
    if (!tab) return
    tab.pinned = pinned
    if (!pinned) tab.spaceId = this.activeSpaceId
    // toIndex is relative to the visible list of the destination group
    const group = this.visibleTabs().filter((t) => t.pinned === pinned && t !== tab)
    const anchor = group[Math.max(0, Math.min(toIndex, group.length))]
    this.order = this.order.filter((id) => id !== tabId)
    if (anchor) this.order.splice(this.order.indexOf(anchor.id), 0, tabId)
    else {
      const last = group.at(-1)
      if (last) this.order.splice(this.order.indexOf(last.id) + 1, 0, tabId)
      else this.order.push(tabId)
    }
    this.scheduleState()
  }

  duplicate(tab: Tab): void {
    this.createTab(tab.displayUrl, { after: tab, spaceId: tab.spaceId })
  }

  togglePin(tab: Tab): void {
    tab.pinned = !tab.pinned
    if (!tab.pinned) tab.spaceId = this.activeSpaceId
    this.moveTab(tab.id, tab.pinned ? Number.MAX_SAFE_INTEGER : 0, tab.pinned)
  }

  sleepTab(tab: Tab): void {
    if (this.isVisible(tab)) return
    if (tab.view) {
      this.attached.delete(tab)
      this.win.contentView.removeChildView(tab.view)
    }
    tab.sleep()
  }

  /** Tabs that may go to sleep: hidden, silent, idle, not waiting on a permission prompt. */
  sleepCandidates(): Tab[] {
    return this.orderedTabs().filter(
      (t) => !t.sleeping && !this.isVisible(t) && !t.audible && !t.loading && !this.prompts.some((p) => p.tabId === t.id)
    )
  }

  allTabs(): Tab[] {
    return this.orderedTabs()
  }

  private isVisible(tab: Tab): boolean {
    return this.visibleViewTabs().includes(tab)
  }

  // ------------------------------------------------------------------ spaces

  activateSpace(id: string): void {
    if (!this.spaces().some((s) => s.id === id) || id === this.activeSpaceId) return
    if (this.find.open) this.closeFind()
    this.activeSpaceId = id
    this.split = null
    const tab = this.activeTab() ?? this.visibleTabs().filter((t) => !t.pinned).at(-1)
    if (tab) this.activate(tab.id)
    else this.createTab(NEW_TAB_URL)
  }

  cycleSpace(step: 1 | -1): void {
    const spaces = this.spaces()
    const idx = spaces.findIndex((s) => s.id === this.activeSpaceId)
    const next = spaces[(idx + step + spaces.length) % spaces.length]
    if (next) this.activateSpace(next.id)
  }

  /** Called when the profile's space list changes (another window may have edited it). */
  spacesChanged(): void {
    if (this.isPrivate) return
    const ids = new Set(this.spaces().map((s) => s.id))
    const fallback = this.spaces()[0].id
    for (const tab of this.tabs.values()) if (!ids.has(tab.spaceId)) tab.spaceId = fallback
    if (!ids.has(this.activeSpaceId)) {
      this.activeSpaceId = fallback
      const tab = this.activeTab() ?? this.visibleTabs()[0]
      if (tab) this.activate(tab.id)
      else this.createTab()
    }
    this.scheduleState()
  }

  // ------------------------------------------------------------------ split view

  toggleSplit(withTabId?: number): void {
    if (this.split && withTabId == null) {
      this.split = null
      this.layout()
      this.scheduleState()
      return
    }
    const active = this.activeTab()
    if (!active) return
    let partner = withTabId != null ? this.tabs.get(withTabId) : undefined
    if (!partner || partner === active) {
      const others = this.visibleTabs().filter((t) => t !== active)
      partner = others.sort((a, b) => b.lastActive - a.lastActive)[0]
    }
    if (!partner) partner = this.createTab(NEW_TAB_URL, { background: true, after: active })
    if (partner.sleeping) partner.wake()
    this.split = { left: active.id, right: partner.id, ratio: 0.5 }
    this.layout()
    this.scheduleState()
  }

  setSplitRatio(ratio: number): void {
    if (!this.split) return
    this.split = { ...this.split, ratio: Math.min(0.8, Math.max(0.2, ratio)) }
    this.layout()
    this.scheduleState()
  }

  swapSplit(): void {
    if (!this.split) return
    this.split = { left: this.split.right, right: this.split.left, ratio: 1 - this.split.ratio }
    this.layout()
    this.scheduleState()
  }

  // ------------------------------------------------------------------ layout

  private visibleViewTabs(): Tab[] {
    if (this.split) {
      return [this.tabs.get(this.split.left), this.tabs.get(this.split.right)].filter((t): t is Tab => !!t)
    }
    const active = this.activeTab()
    return active ? [active] : []
  }

  setInsets(insets: ContentInsets): void {
    const ok = Object.values(insets).every((v) => Number.isFinite(v) && v >= 0 && v < 4000)
    if (!ok) return
    this.insets = insets
    this.layout()
  }

  setViewsHidden(hidden: boolean): void {
    this.viewsHidden = hidden
    if (!hidden) this.lastFrames.clear()
    if (hidden) this.win.webContents.focus()
    this.layout()
    if (!hidden) this.activeTab()?.wc?.focus()
  }

  layout(): void {
    if (this.win.isDestroyed()) return
    const visible = this.visibleViewTabs()
    for (const tab of [...this.attached]) {
      if (!visible.includes(tab) || !tab.view) {
        if (tab.view) this.win.contentView.removeChildView(tab.view)
        this.attached.delete(tab)
      }
    }
    const [width, height] = this.win.getContentSize()
    const fullscreen = this.fullscreenTab !== null ? this.tabs.get(this.fullscreenTab) : undefined

    const area = fullscreen
      ? { x: 0, y: 0, width, height }
      : {
          x: this.insets.left,
          y: this.insets.top,
          width: Math.max(0, width - this.insets.left - this.insets.right),
          height: Math.max(0, height - this.insets.top - this.insets.bottom)
        }

    const rects = new Map<Tab, Electron.Rectangle>()
    if (fullscreen) rects.set(fullscreen, area)
    else if (this.split && visible.length === 2) {
      const leftW = Math.round((area.width - SPLIT_GAP) * this.split.ratio)
      rects.set(visible[0], { ...area, width: leftW })
      rects.set(visible[1], { ...area, x: area.x + leftW + SPLIT_GAP, width: area.width - leftW - SPLIT_GAP })
    } else if (visible[0]) rects.set(visible[0], area)

    for (const [tab, rect] of rects) {
      if (tab.sleeping) tab.wake()
      const view = tab.view
      if (!view) continue
      if (!this.attached.has(tab)) {
        this.win.contentView.addChildView(view)
        this.attached.add(tab)
      }
      view.setBorderRadius(fullscreen ? 0 : 10)
      view.setBounds(rect)
      view.setVisible(!this.viewsHidden && !tab.crashed)
    }
  }

  async freeze(): Promise<FrozenFrame[]> {
    const frames: FrozenFrame[] = []
    for (const tab of this.visibleViewTabs()) {
      const wc = tab.wc
      if (!wc || tab.crashed || this.viewsHidden) continue
      try {
        const img = await wc.capturePage()
        if (!img.isEmpty()) this.lastFrames.set(tab.id, img)
        if (!img.isEmpty()) frames.push({ tabId: tab.id, dataUrl: `data:image/jpeg;base64,${img.toJPEG(82).toString('base64')}` })
      } catch {
        /* capture can fail while the page is navigating; the UI shows the blank card */
      }
    }
    return frames
  }

  // ------------------------------------------------------------------ navigation

  navigate(input: string, where: 'current' | 'new'): void {
    const s = this.svc.profile.settings
    const url = resolveInput(input, s.searchEngine, s.httpsOnly)
    const active = this.activeTab()
    if (where === 'new' || !active) this.createTab(url)
    else {
      active.load(url)
      this.layout()
      active.wc?.focus()
    }
  }

  openInternal(page: 'history' | 'bookmarks' | 'downloads' | 'settings'): void {
    const url = `halyard://${page}/`
    const existing = this.orderedTabs().find((t) => t.url.startsWith(url))
    if (existing) this.activate(existing.id)
    else this.createTab(url)
  }

  // ------------------------------------------------------------------ find in page

  findInPage(text: string, opts: { forward: boolean; findNext: boolean }): void {
    const wc = this.activeTab()?.wc
    if (!wc) return
    if (!text) {
      wc.stopFindInPage('clearSelection')
      this.find = { open: true, matches: 0, active: 0 }
      this.scheduleState()
      return
    }
    wc.findInPage(text, { forward: opts.forward, findNext: opts.findNext, matchCase: false })
  }

  closeFind(): void {
    this.activeTab()?.wc?.stopFindInPage('keepSelection')
    this.find = { open: false, matches: 0, active: 0 }
    this.scheduleState()
  }

  // ------------------------------------------------------------------ permissions

  requestPermission(tab: Tab, permission: string, origin: string, callback: (allow: boolean) => void): void {
    const id = this.promptCounter++
    this.prompts.push({ id, tabId: tab.id, origin, permission })
    this.promptCallbacks.set(id, callback)
    if (!this.isVisible(tab)) this.activate(tab.id)
    this.scheduleState()
  }

  respondPrompt(id: number, allow: boolean, remember: boolean): void {
    const prompt = this.prompts.find((p) => p.id === id)
    if (!prompt) return
    this.prompts = this.prompts.filter((p) => p.id !== id)
    const cb = this.promptCallbacks.get(id)
    this.promptCallbacks.delete(id)
    if (remember && !this.isPrivate && !this.tabs.get(prompt.tabId)?.container)
      this.svc.profile.setPermission(prompt.origin, prompt.permission, allow ? 'allow' : 'deny')
    // "only this time": lasts while the tab stays on this site
    else if (allow) this.tabs.get(prompt.tabId)?.grants.add(`${prompt.origin}|${prompt.permission}`)
    cb?.(allow)
    this.scheduleState()
  }

  private denyPrompts(tabId: number): void {
    for (const p of this.prompts.filter((x) => x.tabId === tabId)) {
      this.promptCallbacks.get(p.id)?.(false)
      this.promptCallbacks.delete(p.id)
    }
    const before = this.prompts.length
    this.prompts = this.prompts.filter((p) => p.tabId !== tabId)
    if (before !== this.prompts.length) this.scheduleState()
  }

  siteInfo(): SiteInfo | null {
    const tab = this.activeTab()
    if (!tab) return null
    const host = hostOf(tab.displayUrl)
    const origin = originOf(tab.displayUrl)
    const s = this.svc.profile.settings
    return {
      host: host || (isInternalUrl(tab.url) ? 'Halyard' : tab.displayUrl),
      blocked: tab.blocked,
      adblockActive: s.adblock && !s.allowlist.some((h) => host === h || host.endsWith(`.${h}`)),
      scriptsActive: scriptsAllowed(s, host),
      security: tab.info().security,
      permissions: this.svc.profile
        .listPermissions()
        .filter((p) => p.origin === origin)
        .map(({ permission, decision }) => ({ permission, decision }))
    }
  }

  toggleSiteAdblock(): void {
    const tab = this.activeTab()
    const host = tab ? hostOf(tab.displayUrl) : ''
    if (!host) return
    const s = this.svc.profile.settings
    const listed = s.allowlist.includes(host)
    this.svc.profile.updateSettings({ allowlist: listed ? s.allowlist.filter((h) => h !== host) : [...s.allowlist, host] })
    tab?.reload()
  }

  /** Turn JavaScript on or off for the site in the active tab (flips it against the default). */
  toggleSiteScripts(): void {
    const tab = this.activeTab()
    const host = tab && /^https?:/.test(tab.displayUrl) ? hostOf(tab.displayUrl) : ''
    if (!host) return
    const s = this.svc.profile.settings
    // the exception is stored for the whole site, so "www." and "m." follow along
    const site = siteOf(host) || host
    const covering = s.scriptSites.filter((h) => host === h || host.endsWith(`.${h}`))
    const scriptSites = covering.length ? s.scriptSites.filter((h) => !covering.includes(h)) : [...s.scriptSites, site]
    this.svc.profile.updateSettings({ scriptSites })
    tab?.reload()
  }

  clearSitePermission(permission: string): void {
    const tab = this.activeTab()
    if (tab) this.svc.profile.setPermission(originOf(tab.displayUrl), permission, null)
  }

  // ------------------------------------------------------------------ palette

  async paletteQuery(raw: string, withSuggestions = false): Promise<PaletteItem[]> {
    const query = raw.trim()
    const q = query.toLowerCase()
    const profile = this.svc.profile
    const items: PaletteItem[] = []
    const seen = new Set<string>()
    const push = (item: PaletteItem): void => {
      const key = item.url ?? item.id
      if (item.kind !== 'command' && item.kind !== 'suggestion' && seen.has(key)) return
      seen.add(key)
      items.push(item)
    }

    if (q.startsWith('>')) {
      const term = q.slice(1).trim()
      for (const [command, spec] of Object.entries(COMMANDS) as [Command, (typeof COMMANDS)[Command]][]) {
        if (!spec.palette) continue
        const label = commandLabel(command)
        if (term && !label.toLowerCase().includes(term)) continue
        push({ kind: 'command', id: `cmd:${command}`, title: label, subtitle: spec.keys, command })
      }
      return items
    }

    const tabs = this.orderedTabs()
    if (!q) {
      for (const t of [...tabs].sort((a, b) => b.lastActive - a.lastActive).slice(0, 7)) {
        const info = t.info()
        push({ kind: 'tab', id: `tab:${t.id}`, title: info.title, subtitle: info.url, url: info.url, favicon: info.favicon, tabId: t.id })
      }
      return items
    }

    const engine = SEARCH_ENGINES[profile.settings.searchEngine]
    const resolved = resolveInput(query, profile.settings.searchEngine, profile.settings.httpsOnly)
    const isSearch = resolved.startsWith(engine.search.split('%s')[0])
    if (isSearch) push({ kind: 'search', id: 'search', title: query, subtitle: t('palette.searchWith', { engine: engine.name }), url: resolved })
    else push({ kind: 'url', id: 'url', title: resolved, subtitle: t('palette.openAddress'), url: resolved })

    const match = (title: string, url: string): boolean => title.toLowerCase().includes(q) || url.toLowerCase().includes(q)

    for (const tab of tabs) {
      const info = tab.info()
      if (items.filter((i) => i.kind === 'tab').length >= 4) break
      if (match(info.title, info.url)) {
        push({ kind: 'tab', id: `tab:${tab.id}`, title: info.title, subtitle: t('palette.switch'), url: info.url, favicon: info.favicon, tabId: tab.id })
      }
    }
    let count = 0
    for (const b of profile.bookmarks) {
      if (count >= 4) break
      if (match(b.title, b.url)) {
        push({ kind: 'bookmark', id: `bm:${b.id}`, title: b.title, subtitle: b.url, url: b.url, favicon: b.favicon })
        count++
      }
    }
    if (!this.isPrivate) {
      count = 0
      for (const h of profile.searchHistory(query, 30)) {
        if (count >= 5) break
        if (seen.has(h.url)) continue
        push({ kind: 'history', id: `h:${h.url}`, title: h.title, subtitle: h.url, url: h.url, favicon: h.favicon })
        count++
      }
    }
    for (const [command, spec] of Object.entries(COMMANDS) as [Command, (typeof COMMANDS)[Command]][]) {
      if (items.filter((i) => i.kind === 'command').length >= 2) break
      if (spec.palette && q.length >= 3 && commandLabel(command).toLowerCase().includes(q)) {
        push({ kind: 'command', id: `cmd:${command}`, title: commandLabel(command), subtitle: spec.keys, command })
      }
    }
    if (withSuggestions && isSearch && profile.settings.suggestions && engine.suggest) {
      for (const s of (await this.suggest(query, engine.suggest)).slice(0, 5)) {
        if (s.toLowerCase() === q) continue
        push({
          kind: 'suggestion',
          id: `s:${s}`,
          title: s,
          url: engine.search.replace('%s', encodeURIComponent(s))
        })
      }
    }
    return items
  }

  private async suggest(query: string, template: string): Promise<string[]> {
    const key = query.toLowerCase()
    const cached = this.suggestCache.get(key)
    if (cached) return cached
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 900)
      const res = await this.session.fetch(template.replace('%s', encodeURIComponent(query)), {
        signal: controller.signal,
        headers: { Accept: 'application/json' }
      })
      clearTimeout(timer)
      const data = (await res.json()) as unknown
      const list = Array.isArray(data) && Array.isArray(data[1]) ? (data[1] as unknown[]).filter((x): x is string => typeof x === 'string') : []
      this.suggestCache.set(key, list)
      if (this.suggestCache.size > 200) this.suggestCache.delete(this.suggestCache.keys().next().value!)
      return list
    } catch {
      return []
    }
  }

  // ------------------------------------------------------------------ input & commands

  handleInput(input: Input, tab: Tab | null): boolean {
    if (input.type !== 'keyDown') return false
    if (input.key === 'Escape') {
      if (this.fullscreenTab !== null) {
        void this.tabs.get(this.fullscreenTab)?.wc?.executeJavaScript('document.exitFullscreen?.()', true)
        return true
      }
      if (this.find.open && tab) {
        this.closeFind()
        return false
      }
      return false
    }
    const combo = normalizeKey(input)
    const command = KEYMAP[combo]
    if (!command) return false
    // Let text fields in the chrome keep their own editing shortcuts.
    if (!tab && (combo === 'Ctrl+Shift+C' || combo === 'Alt+ArrowLeft' || combo === 'Alt+ArrowRight')) return false
    this.run(command)
    return true
  }

  run(command: Command): void {
    const tab = this.activeTab()
    const wc = tab?.wc
    switch (command) {
      case 'new-tab':
        this.uiAction({ action: 'palette', mode: 'new' })
        break
      case 'new-container-tab':
        this.createContainerTab()
        this.uiAction({ action: 'palette', mode: 'current', query: '' })
        break
      case 'focus-address':
      case 'open-palette':
        this.uiAction({ action: 'palette', mode: 'current', query: command === 'focus-address' ? this.addressFor(tab) : '' })
        break
      case 'close-tab':
        if (tab) this.closeTab(tab.id)
        break
      case 'reopen-closed-tab': {
        const saved = this.svc.profile.popClosedTab()
        if (saved) this.createTab(saved.url, { spaceId: saved.spaceId, pinned: saved.pinned })
        break
      }
      case 'next-tab':
      case 'prev-tab': {
        const list = this.visibleTabs()
        if (!tab || list.length < 2) break
        const idx = list.indexOf(tab)
        const step = command === 'next-tab' ? 1 : -1
        this.activate(list[(idx + step + list.length) % list.length].id)
        break
      }
      case 'reload':
        tab?.reload()
        break
      case 'hard-reload':
        tab?.reload(true)
        break
      case 'stop':
        wc?.stop()
        break
      case 'back':
        if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
        break
      case 'forward':
        if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
        break
      case 'find':
        if (!tab || !wc) break
        this.find = { ...this.find, open: true }
        this.scheduleState()
        this.uiAction({ action: 'find' })
        break
      case 'zoom-in':
      case 'zoom-out':
      case 'zoom-reset':
        if (tab) this.zoomBy(tab, command === 'zoom-in' ? 'in' : command === 'zoom-out' ? 'out' : 'reset')
        break
      case 'toggle-sidebar':
        this.svc.profile.updateSettings({ sidebarCollapsed: !this.svc.profile.settings.sidebarCollapsed })
        break
      case 'toggle-split':
        this.toggleSplit()
        break
      case 'toggle-pin':
        if (tab) this.togglePin(tab)
        break
      case 'toggle-mute':
        if (tab) tab.setMuted(!tab.muted)
        break
      case 'duplicate-tab':
        if (tab) this.duplicate(tab)
        break
      case 'bookmark':
        this.toggleBookmark()
        break
      case 'new-window':
        this.svc.openWindow({ isPrivate: false })
        break
      case 'new-private-window':
        this.svc.openWindow({ isPrivate: true })
        break
      case 'open-history':
        this.openInternal('history')
        break
      case 'open-bookmarks':
        this.openInternal('bookmarks')
        break
      case 'open-downloads':
        this.uiAction({ action: 'downloads' })
        break
      case 'open-settings':
        this.openInternal('settings')
        break
      case 'scan-qr':
        void this.scanQr(tab)
        break
      case 'page-qr':
        if (tab && /^https?:/.test(tab.url)) this.uiAction({ action: 'page-qr', url: tab.displayUrl, title: tab.info().title })
        else this.toast(t('qr.pageNone'))
        break
      case 'screenshot':
        if (tab) void this.screenshot(tab)
        break
      case 'open-lab':
        this.svc.openLab()
        break
      case 'panic':
        void this.svc.panic(this)
        break
      case 'devtools':
        if (wc) wc.isDevToolsOpened() ? wc.closeDevTools() : wc.openDevTools({ mode: 'detach' })
        break
      case 'print':
        wc?.print()
        break
      case 'sleep-tab':
        if (tab) {
          const others = this.visibleTabs().filter((t) => t !== tab)
          const next = others.sort((a, b) => b.lastActive - a.lastActive)[0]
          if (next) {
            this.activate(next.id)
            this.sleepTab(tab)
          }
        }
        break
      case 'sleep-background-tabs':
        for (const t of this.sleepCandidates()) this.sleepTab(t)
        this.toast(t('toast.slept'))
        break
      case 'next-space':
        this.cycleSpace(1)
        break
      case 'prev-space':
        this.cycleSpace(-1)
        break
      case 'copy-url':
        if (tab) {
          clipboard.writeText(tab.displayUrl)
          this.toast(t('toast.copied'))
        }
        break
      case 'toggle-agent':
        this.uiAction({ action: 'agent' })
        break
      case 'translate-page':
        if (tab) {
          if (isTranslated(tab.url)) this.showOriginal(tab)
          else this.translate(tab, googleLang(getLang()))
        }
        break
      case 'toggle-theme':
        this.svc.profile.updateSettings({ theme: this.isDarkTheme() ? 'light' : 'dark' })
        break
      case 'fullscreen':
        this.win.setFullScreen(!this.win.isFullScreen())
        break
      case 'select-last-tab': {
        const list = this.visibleTabs()
        const last = list.at(-1)
        if (last) this.activate(last.id)
        break
      }
      default:
        if (command.startsWith('select-tab-')) {
          const n = Number(command.slice('select-tab-'.length))
          const target = this.visibleTabs()[n - 1]
          if (target) this.activate(target.id)
        }
    }
  }

  private addressFor(tab: Tab | null): string {
    if (!tab || tab.url === NEW_TAB_URL) return ''
    return tab.displayUrl
  }

  toggleBookmark(): boolean {
    const tab = this.activeTab()
    if (!tab || isInternalUrl(tab.url)) return false
    const added = this.svc.profile.toggleBookmark(tab.displayUrl, tab.info().title, tab.favicon)
    this.toast(added ? t('toast.bmAdded') : t('toast.bmRemoved'))
    return added
  }

  /** `warn`: something the user should act on; shown longer, in a bar above the page. */
  toast(message: string, warn = false): void {
    this.send('toast', { message, warn })
  }

  /** Close every tab without remembering them, leaving one new tab ("clear everything"). */
  resetTabs(): void {
    const old = [...this.tabs.values()]
    this.split = null
    const fresh = this.createTab(NEW_TAB_URL)
    for (const tab of old) {
      this.denyPrompts(tab.id)
      this.attached.delete(tab)
      if (tab.view) this.win.contentView.removeChildView(tab.view)
      tab.destroy()
      this.tabs.delete(tab.id)
      this.order = this.order.filter((id) => id !== tab.id)
      this.openedFrom.delete(tab.id)
    }
    this.activeBySpace.clear()
    this.activate(fresh.id)
    this.layout()
    this.scheduleState()
  }

  private riskWarned = new Set<string>()

  /** A look-alike or scam-prone address the user has never visited: say so once, above the page. */
  private warnRiskyDomain(tab: Tab): void {
    if (!this.svc.profile.settings.riskyDomainWarn || !/^https?:/.test(tab.url)) return
    let host = ''
    try {
      host = new URL(tab.url).hostname
    } catch {
      return
    }
    if (this.riskWarned.has(host) || this.svc.profile.isTrustedHost(host) || this.svc.guard.isAllowed(host)) return
    const risk = quickRisk(tab.url, this.svc.guard)
    if (!risk) return
    // a site the user already used is not "new and suspicious"
    if (risk.code !== 'decoy' && this.svc.profile.hasVisitedSite(siteOf(tab.url))) return
    this.riskWarned.add(host)
    this.toast(t(`risk.${risk.code}` as I18nKey, { host, value: risk.value ?? '' }), true)
  }

  private bubble: WebContentsView | null = null
  private bubbleTimer: NodeJS.Timeout | null = null

  /** Pages in full screen can fake a whole browser or Windows screen: show the real site for a few seconds. */
  private fullscreenBubble(host: string): void {
    if (this.win.isDestroyed() || this.fullscreenTab === null) return
    this.closeBubble()
    const view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false } })
    view.setBackgroundColor('#00000000')
    const esc = (v: string): string => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
    const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent;overflow:hidden;font:600 14px/1.35 'Segoe UI',system-ui,sans-serif}div{margin:8px auto;width:max-content;max-width:calc(100% - 24px);padding:10px 16px;border-radius:12px;background:rgba(18,16,26,.94);color:#f2f0f7;box-shadow:0 8px 30px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.12);text-align:center}b{color:#b9a7ff}small{display:block;font-weight:400;opacity:.75}</style><div>${esc(
      t('fs.bubble', { host: '\u0000' })
    ).replace('\u0000', `<b>${esc(host)}</b>`)}<small>${esc(t('fs.exit'))}</small></div>`
    void view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    const b = this.win.getContentBounds()
    const width = Math.min(560, b.width)
    view.setBounds({ x: Math.round((b.width - width) / 2), y: 0, width, height: 76 })
    this.win.contentView.addChildView(view)
    this.bubble = view
    this.bubbleTimer = setTimeout(() => this.closeBubble(), 4500)
  }

  private closeBubble(): void {
    if (this.bubbleTimer) clearTimeout(this.bubbleTimer)
    this.bubbleTimer = null
    const view = this.bubble
    this.bubble = null
    if (!view) return
    if (!this.win.isDestroyed()) this.win.contentView.removeChildView(view)
    view.webContents.close()
  }

  // ------------------------------------------------------------------ QR Codes and captures

  /**
   * Look for a QR Code in an image on the page, or in what the tab shows right now.
   * The window UI decodes it and shows where it leads before anything is opened.
   */
  async scanQr(tab: Tab | null, src?: string): Promise<void> {
    const wc = tab?.wc
    if (!tab || !wc || wc.isDestroyed()) {
      this.uiAction({ action: 'qr', source: 'none' })
      return
    }
    let image: string | undefined
    let source: 'image' | 'page' = 'page'
    if (src) {
      image = await fetchImage(tab, src).catch(() => undefined)
      if (image) source = 'image'
    }
    if (!image) {
      const shot = await this.capture(tab)
      image = shot ? shot.toDataURL() : undefined
    }
    this.uiAction({ action: 'qr', image, source: image ? source : 'none' })
  }

  /** What the tab shows now; while a panel covers the page, the frame taken just before it opened. */
  private async capture(tab: Tab): Promise<Electron.NativeImage | null> {
    const wc = tab.wc
    if (wc && !wc.isDestroyed() && !this.viewsHidden) {
      // the compositor sometimes has no frame ready (window behind others, page just painted): ask for one and retry
      for (let i = 0; i < 4; i++) {
        if (wc.isDestroyed()) break
        const shot = await wc.capturePage().catch(() => null)
        if (shot && !shot.isEmpty()) return shot
        wc.invalidate()
        await new Promise((r) => setTimeout(r, 120 * (i + 1)))
      }
    }
    return this.lastFrames.get(tab.id) ?? null
  }

  /** Copy what the tab shows to the clipboard and save it in Pictures\Halyard. */
  async screenshot(tab: Tab): Promise<void> {
    const wc = tab.wc
    if (!wc || wc.isDestroyed()) return
    const shot = await this.capture(tab)
    if (!shot) return
    await copyPng(shot.toPNG()).catch(() => undefined)
    try {
      const dir = join(app.getPath('pictures'), BRAND)
      await mkdir(dir, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
      const file = join(dir, `${BRAND} ${stamp}.png`)
      await writeFile(file, shot.toPNG())
      this.toast(t('toast.screenshot', { folder: `${t('toast.pictures')}\\${BRAND}` }))
      this.lastShot = file
    } catch {
      this.toast(t('toast.screenshotCopied'))
    }
  }

  private lastShot: string | null = null

  /** Show the last saved capture in its folder. */
  revealScreenshot(): void {
    if (this.lastShot) shell.showItemInFolder(this.lastShot)
  }

  // ------------------------------------------------------------------ menus
  // Menus are drawn by the window UI in Halyard's style. Main keeps the click handlers
  // and hands the UI a plain description of the rows.

  private menuSeq = 0
  private openMenu: { id: number; handlers: Map<string, () => void> } | null = null

  private popup(nodes: MenuNode[], at?: { x: number; y: number }): void {
    if (this.win.isDestroyed()) return
    const handlers = new Map<string, () => void>()
    let n = 0
    const convert = (list: MenuNode[]): MenuEntry[] => {
      const out: MenuEntry[] = []
      for (const node of list) {
        if (node.separator) {
          if (out.length && !out.at(-1)?.separator) out.push({ separator: true })
          continue
        }
        const id = String(n++)
        if (node.click) handlers.set(id, node.click)
        out.push({
          id,
          label: node.label,
          keys: node.keys,
          enabled: node.enabled !== false,
          checked: node.checked,
          danger: node.danger,
          hue: node.hue,
          glyph: node.glyph,
          icon: node.icon,
          submenu: node.submenu ? convert(node.submenu) : undefined
        })
      }
      while (out.at(-1)?.separator) out.pop()
      return out
    }
    const items = convert(nodes)
    if (!items.length) return
    const menuId = ++this.menuSeq
    this.openMenu = { id: menuId, handlers }
    let pos = at
    if (!pos) {
      const cursor = screen.getCursorScreenPoint()
      const b = this.win.getContentBounds()
      pos = { x: cursor.x - b.x, y: cursor.y - b.y }
    }
    this.uiAction({ action: 'menu', menuId, items, x: Math.round(pos.x), y: Math.round(pos.y) })
  }

  pickMenu(menuId: number, itemId: string | null): void {
    const menu = this.openMenu
    if (!menu || menu.id !== menuId) return
    this.openMenu = null
    const handler = itemId ? menu.handlers.get(itemId) : undefined
    if (!handler) return
    // the page is visible again before the action runs (paste, print, etc. need it)
    if (this.viewsHidden) this.setViewsHidden(false)
    setImmediate(handler)
  }

  showPageMenu(tab: Tab, params: ContextMenuParams): void {
    const wc = tab.wc
    if (!wc) return
    const items: MenuNode[] = []
    const sep = (): void => void items.push({ separator: true })
    const engine = SEARCH_ENGINES[this.svc.profile.settings.searchEngine]
    const edit = (fn: () => void) => () => {
      wc.focus()
      fn()
    }

    if (params.misspelledWord) {
      for (const s of params.dictionarySuggestions.slice(0, 5)) items.push({ label: s, icon: 'spell', click: () => wc.replaceMisspelling(s) })
      if (!params.dictionarySuggestions.length) items.push({ label: t('menu.noSuggestions'), enabled: false })
      items.push({ label: t('menu.addDict'), icon: 'book', click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord) })
      sep()
    }
    if (params.linkURL) {
      const link = params.linkURL
      items.push(
        { label: t('menu.linkTab'), icon: 'external', click: () => this.createTab(link, { background: true, after: tab, spaceId: tab.spaceId }) },
        { label: t('menu.linkSplit'), icon: 'columns', click: () => this.openInSplit(link) },
        { label: t('menu.linkPrivate'), icon: 'private', click: () => this.svc.openWindow({ isPrivate: true, url: link }) },
        { label: t('menu.copyLink'), icon: 'link', click: () => clipboard.writeText(link) },
        { label: t('menu.checkLink'), icon: 'shield', click: () => this.uiAction({ action: 'qr', text: link, source: 'link' }) }
      )
      sep()
    }
    if (params.mediaType === 'image' && params.srcURL) {
      const src = params.srcURL
      items.push(
        { label: t('menu.imageTab'), icon: 'image', click: () => this.createTab(src, { background: true, after: tab, spaceId: tab.spaceId }) },
        { label: t('menu.saveImage'), icon: 'download', click: () => wc.downloadURL(src) },
        { label: t('menu.copyImage'), icon: 'copy', click: () => wc.copyImageAt(params.x, params.y) },
        { label: t('menu.copyImageUrl'), icon: 'link', click: () => clipboard.writeText(src) },
        { label: t('menu.scanQrImage'), icon: 'qr', click: () => void this.scanQr(tab, src) }
      )
      sep()
    }
    if (params.mediaType === 'video') {
      const { x, y } = params
      items.push(
        {
          label: t('menu.pip'),
          icon: 'pip',
          click: () =>
            void wc.executeJavaScript(
              `(() => { const v = document.elementFromPoint(${x}, ${y})?.closest('video') ?? document.querySelector('video'); if (v) document.pictureInPictureElement ? document.exitPictureInPicture() : v.requestPictureInPicture(); })()`,
              true
            )
        },
        { label: t('menu.saveVideo'), icon: 'download', enabled: /^https?:/.test(params.srcURL), click: () => wc.downloadURL(params.srcURL) }
      )
      sep()
    }
    if (params.isEditable) {
      const f = params.editFlags
      items.push(
        { label: t('menu.undo'), icon: 'undo', keys: 'Ctrl+Z', enabled: f.canUndo, click: edit(() => wc.undo()) },
        { label: t('menu.redo'), icon: 'redo', keys: 'Ctrl+Y', enabled: f.canRedo, click: edit(() => wc.redo()) },
        { separator: true },
        { label: t('menu.cut'), icon: 'cut', keys: 'Ctrl+X', enabled: f.canCut, click: edit(() => wc.cut()) },
        { label: t('menu.copy'), icon: 'copy', keys: 'Ctrl+C', enabled: f.canCopy, click: edit(() => wc.copy()) },
        { label: t('menu.paste'), icon: 'paste', keys: 'Ctrl+V', enabled: f.canPaste, click: edit(() => wc.paste()) },
        { label: t('menu.pastePlain'), icon: 'paste', keys: 'Ctrl+Shift+V', enabled: f.canPaste, click: edit(() => wc.pasteAndMatchStyle()) },
        { label: t('menu.selectAll'), icon: 'select', keys: 'Ctrl+A', click: edit(() => wc.selectAll()) }
      )
      sep()
    } else if (params.selectionText.trim()) {
      const text = params.selectionText.trim()
      const short = text.length > 28 ? `${text.slice(0, 28)}…` : text
      items.push(
        { label: t('menu.copy'), icon: 'copy', keys: 'Ctrl+C', click: edit(() => wc.copy()) },
        {
          label: t('menu.searchFor', { engine: engine.name, text: short }),
          icon: 'search',
          click: () => this.createTab(engine.search.replace('%s', encodeURIComponent(text)), { after: tab, spaceId: tab.spaceId })
        }
      )
      sep()
    }
    if (!params.linkURL && params.mediaType === 'none' && !params.isEditable && !params.selectionText.trim()) {
      items.push(
        { label: t('cmd.back'), icon: 'back', keys: 'Alt+←', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
        { label: t('cmd.forward'), icon: 'forward', keys: 'Alt+→', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
        { label: t('cmd.reload'), icon: 'reload', keys: 'Ctrl+R', click: () => tab.reload() },
        { separator: true },
        ...this.translateItems(tab),
        { label: t('cmd.scan-qr'), icon: 'qr', keys: COMMANDS['scan-qr'].keys, click: () => void this.scanQr(tab) },
        { label: t('cmd.page-qr'), icon: 'share', enabled: /^https?:/.test(tab.url), click: () => this.run('page-qr') },
        { label: t('cmd.screenshot'), icon: 'camera', keys: COMMANDS.screenshot.keys, click: () => void this.screenshot(tab) },
        { separator: true },
        { label: t('menu.print'), icon: 'print', keys: 'Ctrl+P', click: () => wc.print() },
        {
          label: t('menu.source'),
          icon: 'code',
          enabled: /^https?:/.test(tab.url),
          click: () => this.createTab(`view-source:${tab.url}`, { after: tab, spaceId: tab.spaceId })
        }
      )
      sep()
    }
    items.push({ label: t('menu.inspect'), icon: 'inspect', click: () => wc.inspectElement(params.x, params.y) })
    this.popup(items)
  }

  private openInSplit(url: string): void {
    const active = this.activeTab()
    if (!active) return
    const tab = this.createTab(url, { background: true, after: active, spaceId: active.spaceId })
    this.split = { left: active.id, right: tab.id, ratio: 0.5 }
    this.layout()
    this.scheduleState()
  }

  showTabMenu(tabId: number): void {
    const tab = this.tabs.get(tabId)
    if (!tab) return
    const active = this.activeTab()
    const spaces = this.spaces()
    const items: MenuNode[] = [
      { label: t('cmd.reload'), icon: 'reload', click: () => tab.reload() },
      { label: t('menu.duplicate'), icon: 'duplicate', click: () => this.duplicate(tab) },
      { label: tab.pinned ? t('menu.unpin') : t('menu.pin'), icon: tab.pinned ? 'unpin' : 'pin', click: () => this.togglePin(tab) },
      { label: tab.muted ? t('menu.unmute') : t('menu.mute'), icon: tab.muted ? 'sound' : 'mute', click: () => tab.setMuted(!tab.muted) },
      {
        label: t('menu.openSplit'),
        icon: 'columns',
        enabled: !!active && active !== tab,
        click: () => {
          if (!active) return
          this.split = { left: active.id, right: tab.id, ratio: 0.5 }
          if (tab.sleeping) tab.wake()
          this.layout()
          this.scheduleState()
        }
      },
      { label: t('menu.sleep'), icon: 'sleep', enabled: !tab.sleeping && !this.isVisible(tab), click: () => this.sleepTab(tab) },
      { label: t('menu.copyAddress'), icon: 'link', click: () => clipboard.writeText(tab.displayUrl) }
    ]
    if (!this.isPrivate && spaces.length > 1 && !tab.pinned) {
      items.push({
        label: t('menu.moveTo'),
        icon: 'move',
        submenu: spaces
          .filter((s) => s.id !== tab.spaceId)
          .map((s) => ({
            label: s.name,
            glyph: s.icon,
            hue: s.hue,
            click: () => {
              const wasActive = this.activeTab() === tab
              tab.spaceId = s.id
              if (this.split && (this.split.left === tab.id || this.split.right === tab.id)) this.split = null
              this.activeBySpace.set(s.id, tab.id)
              if (wasActive) {
                const next = this.visibleTabs().filter((x) => !x.pinned).at(-1)
                if (next) this.activate(next.id)
                else this.createTab()
              } else this.scheduleState()
            }
          }))
      })
    }
    items.push(
      { separator: true },
      {
        label: t('menu.closeOthers'),
        icon: 'close-others',
        click: () => {
          for (const x of this.visibleTabs()) if (x !== tab && !x.pinned) this.closeTab(x.id)
        }
      },
      {
        label: t('menu.closeBelow'),
        icon: 'close-below',
        click: () => {
          const list = this.visibleTabs().filter((x) => !x.pinned)
          for (const x of list.slice(list.indexOf(tab) + 1)) this.closeTab(x.id)
        }
      },
      { label: t('menu.close'), icon: 'close', danger: true, keys: tab === active ? 'Ctrl+W' : undefined, click: () => this.closeTab(tab.id) }
    )
    this.popup(items)
  }

  showSpaceMenu(id: string): void {
    if (this.isPrivate) return
    const space = this.spaces().find((s) => s.id === id)
    if (!space) return
    const hues: [I18nKey, number][] = [
      ['color.violet', 262], ['color.blue', 220], ['color.cyan', 196], ['color.green', 150], ['color.lime', 100],
      ['color.amber', 50], ['color.orange', 28], ['color.red', 0], ['color.pink', 340], ['color.magenta', 300]
    ]
    this.popup([
      { label: t('menu.editSpace'), icon: 'edit', click: () => this.uiAction({ action: 'edit-space', id }) },
      {
        label: t('menu.color'),
        icon: 'palette',
        submenu: hues.map(([key, hue]) => ({
          label: t(key),
          hue,
          checked: space.hue === hue,
          click: () => this.svc.profile.updateSpace(id, { hue })
        }))
      },
      { separator: true },
      {
        label: t('menu.deleteSpace'),
        icon: 'trash',
        danger: true,
        enabled: this.spaces().length > 1,
        click: () => {
          // tabs of a deleted space move to the first remaining one
          const target = this.spaces().find((s) => s.id !== id)
          if (!target) return
          for (const ctl of BrowserController.all.values()) ctl.moveSpaceTabs(id, target.id)
          this.svc.profile.deleteSpace(id)
        }
      }
    ])
  }

  moveSpaceTabs(from: string, to: string): void {
    for (const tab of this.tabs.values()) if (tab.spaceId === from) tab.spaceId = to
    if (this.activeSpaceId === from) this.activeSpaceId = to
    this.scheduleState()
  }

  showAppMenu(x: number, y: number): void {
    const tab = this.activeTab()
    const zoom = Math.round((tab?.zoom ?? 1) * 100)
    const item = (command: Command, icon: string, extra: Partial<MenuNode> = {}): MenuNode => ({
      label: commandLabel(command),
      keys: COMMANDS[command].keys,
      icon,
      click: () => this.run(command),
      ...extra
    })
    const dark = this.isDarkTheme()
    const account = this.svc.account.state()
    const accountItems: MenuNode[] =
      !account.configured || this.isPrivate
        ? []
        : account.user
          ? [{ label: account.user.email, icon: 'user', click: () => this.openInternal('settings') }, { separator: true }]
          : [{ label: t('acct.menuSignIn'), icon: 'user', click: () => this.uiAction({ action: 'account' }) }, { separator: true }]
    this.popup(
      [
        ...accountItems,
        item('new-tab', 'plus'),
        item('new-window', 'window'),
        item('new-private-window', 'private'),
        { separator: true },
        item('open-history', 'history'),
        item('open-bookmarks', 'star'),
        item('open-downloads', 'download'),
        { separator: true },
        {
          label: t('menu.zoom', { n: zoom }),
          icon: 'zoom',
          submenu: [item('zoom-in', 'zoom-in'), item('zoom-out', 'zoom-out'), item('zoom-reset', 'zoom')]
        },
        item('find', 'search', { enabled: !!tab }),
        item('print', 'print', { enabled: !!tab }),
        item('toggle-split', 'columns'),
        item('sleep-background-tabs', 'sleep'),
        item('scan-qr', 'qr', { enabled: !!tab }),
        item('open-lab', 'lab'),
        item('toggle-theme', dark ? 'sun' : 'moon', { label: dark ? t('menu.themeLight') : t('menu.themeDark') }),
        { separator: true },
        item('devtools', 'code', { enabled: !!tab }),
        item('open-settings', 'settings'),
        item('panic', 'eraser', { danger: true }),
        { separator: true },
        { label: t('menu.quit'), icon: 'quit', click: () => app.quit() }
      ],
      // right-aligned under the button
      { x: x - 236, y }
    )
  }

  // ---------------------------------------------------------------- translation

  private translate(tab: Tab, target: string): void {
    const url = originalUrl(tab.url) ?? tab.url
    if (translatable(url)) tab.load(translateUrl(url, target))
  }

  private showOriginal(tab: Tab): void {
    const url = originalUrl(tab.url)
    if (url) tab.load(url)
  }

  private translateItems(tab: Tab): MenuNode[] {
    if (isTranslated(tab.url)) return [{ label: t('tr.original'), icon: 'translate', click: () => this.showOriginal(tab) }]
    if (!translatable(tab.url)) return []
    const target = googleLang(getLang())
    return [{ label: t('tr.to', { lang: languageName(target) }), icon: 'translate', click: () => this.translate(tab, target) }]
  }

  showTranslateMenu(x: number, y: number): void {
    const tab = this.activeTab()
    if (!tab) return
    const translated = isTranslated(tab.url)
    if (!translated && !translatable(tab.url)) return
    const mine = googleLang(getLang())
    const others = TRANSLATE_TARGETS.filter((code) => code !== mine)
    this.popup(
      [
        { label: t('tr.to', { lang: languageName(mine) }), icon: 'translate', click: () => this.translate(tab, mine) },
        {
          label: t('tr.more'),
          icon: 'globe',
          submenu: others.map((code) => ({ label: languageName(code), click: () => this.translate(tab, code) }))
        },
        ...(translated ? [{ separator: true }, { label: t('tr.original'), icon: 'undo', click: () => this.showOriginal(tab) }] : []),
        { separator: true },
        { label: t('tr.by'), icon: 'info', enabled: false }
      ],
      { x: x - 260, y }
    )
  }

  private isDarkTheme(): boolean {
    const theme = this.svc.profile.settings.theme
    return theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors)
  }

  // ------------------------------------------------------------------ download confirmation

  private downloadSeq = 0
  private downloadWaits = new Map<number, (ok: boolean) => void>()

  /** Ask, in the window's own UI, before a file that can run code is downloaded. */
  confirmDownload(req: Omit<DownloadRequest, 'id'>): Promise<boolean> {
    if (this.win.isDestroyed()) return Promise.resolve(false)
    return new Promise((resolve) => {
      const id = ++this.downloadSeq
      this.downloadWaits.set(id, resolve)
      if (this.win.isMinimized()) this.win.restore()
      this.win.focus()
      this.uiAction({ action: 'confirm-download', request: { id, ...req } })
    })
  }

  decideDownload(id: number, ok: boolean): void {
    const resolve = this.downloadWaits.get(id)
    this.downloadWaits.delete(id)
    resolve?.(ok)
  }

  private cancelPendingDownloads(): void {
    for (const resolve of this.downloadWaits.values()) resolve(false)
    this.downloadWaits.clear()
  }
}

interface MenuNode {
  label?: string
  keys?: string
  enabled?: boolean
  checked?: boolean
  danger?: boolean
  separator?: boolean
  hue?: number
  glyph?: string
  icon?: string
  click?: () => void
  submenu?: MenuNode[]
}

/** "Português", "English"... in the app's language, capitalised. */
function languageName(code: string): string {
  let name = code
  try {
    name = new Intl.DisplayNames([locale()], { type: 'language' }).of(code) ?? code
  } catch {
    /* keep the code */
  }
  return name.charAt(0).toLocaleUpperCase(locale()) + name.slice(1)
}

/**
 * Get an image the page shows, as a data URL, through the tab's own session
 * (the same cookies that loaded it). Only images, at most 10 MB.
 */
async function fetchImage(tab: Tab, src: string): Promise<string | undefined> {
  if (src.startsWith('data:image/')) return src.length <= QR_IMAGE_MAX * 1.4 ? src : undefined
  if (!/^https?:/i.test(src)) return undefined
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 8000)
  try {
    const res = await tab.session.fetch(src, { signal: ac.signal })
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (!res.ok || !type.startsWith('image/')) return undefined
    if (Number(res.headers.get('content-length') ?? 0) > QR_IMAGE_MAX) return undefined
    const reader = res.body?.getReader()
    if (!reader) return undefined
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > QR_IMAGE_MAX) {
        await reader.cancel().catch(() => undefined)
        return undefined
      }
      chunks.push(value)
    }
    return `data:${type};base64,${Buffer.concat(chunks).toString('base64')}`
  } finally {
    clearTimeout(timer)
  }
}
