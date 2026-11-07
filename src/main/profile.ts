import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { JsonStore } from './store'
import { defaultSpaceNames, isLang, t, translateIn, type Lang } from '@shared/i18n'
import { DEFAULT_SETTINGS, SEARCH_ENGINES, type Bookmark, type HistoryEntry, type Settings, type Space } from '@shared/types'

export interface SavedTab {
  url: string
  title: string
  favicon: string | null
  spaceId: string
  pinned: boolean
}

export interface SavedWindow {
  tabs: SavedTab[]
  /** Index into `tabs` of the active tab of each space. */
  activeBySpace: Record<string, number>
  activeSpaceId: string
  bounds?: { x: number; y: number; width: number; height: number }
  maximized?: boolean
}

type Decision = 'allow' | 'deny'

const DEFAULT_SPACES: Space[] = [
  { id: 'pessoal', name: 'Personal', hue: 262, icon: '✦' },
  { id: 'trabalho', name: 'Work', hue: 196, icon: '◆' }
]

const HISTORY_LIMIT = 10_000

interface ProfileEvents {
  settings: [Settings]
  spaces: [Space[]]
  bookmarks: [Bookmark[]]
}

/** Everything the browser remembers between runs. One instance per app. */
export class Profile extends EventEmitter<ProfileEvents> {
  private settingsStore = new JsonStore<Settings>('settings', DEFAULT_SETTINGS)
  private spacesStore = new JsonStore<Space[]>('spaces', DEFAULT_SPACES)
  private historyStore = new JsonStore<HistoryEntry[]>('history', [], 2000)
  private bookmarksStore = new JsonStore<Bookmark[]>('bookmarks', [])
  private permissionsStore = new JsonStore<Record<string, Record<string, Decision>>>('permissions', {})
  private sessionStore = new JsonStore<{ windows: SavedWindow[] }>('session', { windows: [] }, 1500)
  private statsStore = new JsonStore<{ blocked: number; threats: number }>('stats', { blocked: 0, threats: 0 }, 5000)
  private trustedStore = new JsonStore<string[]>('trusted-hosts', [])
  private interactionStore = new JsonStore<Record<string, number>>('interactions', {}, 5000)
  private visitedHosts: Set<string> | null = null
  private closedTabs: SavedTab[] = []

  // ---- settings
  get settings(): Settings {
    return this.settingsStore.get()
  }

  updateSettings(patch: Partial<Settings>): Settings {
    const clean: Partial<Settings> = {}
    for (const [key, value] of Object.entries(patch) as [keyof Settings, unknown][]) {
      if (!(key in DEFAULT_SETTINGS)) continue
      if (typeof value !== typeof DEFAULT_SETTINGS[key] && !(Array.isArray(value) && Array.isArray(DEFAULT_SETTINGS[key]))) continue
      ;(clean as Record<string, unknown>)[key] = value
    }
    if ('language' in clean && !isLang(clean.language)) delete clean.language
    if ('secureDns' in clean && !['cloudflare', 'quad9', 'google', 'system', 'off'].includes(clean.secureDns as string)) delete clean.secureDns
    if ('searchEngine' in clean && !Object.hasOwn(SEARCH_ENGINES, clean.searchEngine as string)) delete clean.searchEngine
    if ('theme' in clean && !['system', 'dark', 'light'].includes(clean.theme as string)) delete clean.theme
    for (const key of ['allowlist', 'scriptSites'] as const)
      if (key in clean) clean[key] = (clean[key] as unknown[]).filter((h): h is string => typeof h === 'string').map((h) => h.slice(0, 253)).slice(0, 1000)
    if (typeof clean.email === 'string') clean.email = clean.email.trim().slice(0, 254)
    const next = this.settingsStore.update((s) => ({ ...s, ...clean }))
    next.sidebarWidth = clamp(next.sidebarWidth, 200, 420)
    next.sleepAfterMinutes = clamp(next.sleepAfterMinutes, 0, 24 * 60)
    next.memoryLimitMB = clamp(next.memoryLimitMB, 0, 64_000)
    this.emit('settings', next)
    return next
  }

  // ---- spaces
  get spaces(): Space[] {
    return this.spacesStore.get()
  }

  /** The two starter spaces follow the language until the user renames them. */
  localizeSpaces(lang: Lang): void {
    let changed = false
    const next = this.spaces.map((s) => {
      if (s.id !== 'pessoal' && s.id !== 'trabalho') return s
      if (!defaultSpaceNames(s.id).includes(s.name)) return s
      const name = translateIn(lang, s.id === 'pessoal' ? 'space.personal' : 'space.work')
      if (name === s.name) return s
      changed = true
      return { ...s, name }
    })
    if (!changed) return
    this.spacesStore.update(() => next)
    this.emit('spaces', next)
  }

  createSpace(): Space {
    const used = new Set(this.spaces.map((s) => s.hue))
    const palette = [262, 196, 150, 28, 340, 50, 220, 0, 100, 300]
    const hue = palette.find((h) => !used.has(h)) ?? Math.floor(Math.random() * 360)
    const space: Space = { id: randomUUID().slice(0, 8), name: t('space.n', { n: this.spaces.length + 1 }), hue, icon: '●' }
    this.spacesStore.update((list) => [...list, space])
    this.emit('spaces', this.spaces)
    return space
  }

  updateSpace(id: string, patch: Partial<Omit<Space, 'id'>>): void {
    this.spacesStore.update((list) =>
      list.map((s) =>
        s.id === id
          ? {
              ...s,
              name: typeof patch.name === 'string' ? patch.name.slice(0, 40) || s.name : s.name,
              hue: typeof patch.hue === 'number' ? clamp(Math.round(patch.hue), 0, 360) : s.hue,
              icon: typeof patch.icon === 'string' ? [...patch.icon].slice(0, 2).join('') || s.icon : s.icon
            }
          : s
      )
    )
    this.emit('spaces', this.spaces)
  }

  deleteSpace(id: string): boolean {
    if (this.spaces.length <= 1) return false
    this.spacesStore.update((list) => list.filter((s) => s.id !== id))
    this.emit('spaces', this.spaces)
    return true
  }

  // ---- history
  addVisit(url: string, title: string, favicon: string | null): void {
    if (!/^https?:/.test(url)) return
    try {
      this.visitedHosts?.add(new URL(url).hostname)
    } catch {
      /* skip */
    }
    this.historyStore.update((list) => {
      const idx = list.findIndex((e) => e.url === url)
      const prev = idx >= 0 ? list[idx] : null
      const entry: HistoryEntry = {
        url,
        title: title || prev?.title || url,
        favicon: favicon ?? prev?.favicon ?? null,
        visitedAt: Date.now(),
        visits: (prev?.visits ?? 0) + 1
      }
      const rest = idx >= 0 ? [...list.slice(0, idx), ...list.slice(idx + 1)] : list
      return [entry, ...rest].slice(0, HISTORY_LIMIT)
    })
  }

  /** Title and favicon arrive after the navigation; patch the newest entry. */
  touchVisit(url: string, patch: { title?: string; favicon?: string | null }): void {
    const list = this.historyStore.get()
    const entry = list.find((e) => e.url === url)
    if (!entry) return
    if (patch.title) entry.title = patch.title
    if (patch.favicon) entry.favicon = patch.favicon
    this.historyStore.set(list)
  }

  searchHistory(query: string, limit = 200): HistoryEntry[] {
    const list = this.historyStore.get()
    const q = query.trim().toLowerCase()
    if (!q) return list.slice(0, limit)
    const out: HistoryEntry[] = []
    for (const e of list) {
      if (e.url.toLowerCase().includes(q) || e.title.toLowerCase().includes(q)) out.push(e)
      if (out.length >= limit) break
    }
    return out
  }

  topSites(limit = 8): HistoryEntry[] {
    const byHost = new Map<string, HistoryEntry & { score: number }>()
    const now = Date.now()
    for (const e of this.historyStore.get().slice(0, 3000)) {
      let host: string
      try {
        host = new URL(e.url).hostname
      } catch {
        continue
      }
      const ageDays = (now - e.visitedAt) / 86_400_000
      const score = e.visits / (1 + ageDays / 7)
      const cur = byHost.get(host)
      if (cur) cur.score += score
      else byHost.set(host, { ...e, url: new URL(e.url).origin + '/', score })
    }
    return [...byHost.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ score: _score, ...e }) => e)
  }

  deleteHistory(url: string | null): void {
    this.historyStore.set(url ? this.historyStore.get().filter((e) => e.url !== url) : [])
    this.visitedHosts = null
  }

  // ---- bookmarks
  get bookmarks(): Bookmark[] {
    return this.bookmarksStore.get()
  }

  isBookmarked(url: string): boolean {
    return this.bookmarks.some((b) => b.url === url)
  }

  toggleBookmark(url: string, title: string, favicon: string | null): boolean {
    const exists = this.isBookmarked(url)
    this.bookmarksStore.update((list) =>
      exists
        ? list.filter((b) => b.url !== url)
        : [{ id: randomUUID(), url, title: title || url, favicon, createdAt: Date.now() }, ...list]
    )
    this.emit('bookmarks', this.bookmarks)
    return !exists
  }

  removeBookmark(id: string): void {
    this.bookmarksStore.update((list) => list.filter((b) => b.id !== id))
    this.emit('bookmarks', this.bookmarks)
  }

  renameBookmark(id: string, title: string): void {
    this.bookmarksStore.update((list) => list.map((b) => (b.id === id ? { ...b, title: title.slice(0, 300) || b.title } : b)))
    this.emit('bookmarks', this.bookmarks)
  }

  // ---- site permissions
  permissionFor(origin: string, permission: string): Decision | undefined {
    return this.permissionsStore.get()[origin]?.[permission]
  }

  setPermission(origin: string, permission: string, decision: Decision | null): void {
    this.permissionsStore.update((all) => {
      const next = { ...all, [origin]: { ...(all[origin] ?? {}) } }
      if (decision) next[origin][permission] = decision
      else delete next[origin][permission]
      if (Object.keys(next[origin]).length === 0) delete next[origin]
      return next
    })
  }

  listPermissions(): { origin: string; permission: string; decision: Decision }[] {
    return Object.entries(this.permissionsStore.get()).flatMap(([origin, perms]) =>
      Object.entries(perms).map(([permission, decision]) => ({ origin, permission, decision }))
    )
  }

  // ---- session
  get savedSession(): SavedWindow[] {
    return this.sessionStore.get().windows
  }

  saveSession(windows: SavedWindow[]): void {
    this.sessionStore.set({ windows })
  }

  pushClosedTab(tab: SavedTab): void {
    this.closedTabs.push(tab)
    if (this.closedTabs.length > 30) this.closedTabs.shift()
  }

  /** "Clear everything": forget closed tabs, sites used, saved permissions and history. */
  forgetAll(): void {
    this.closedTabs = []
    this.interactionStore.set({})
    for (const p of this.listPermissions()) this.setPermission(p.origin, p.permission, null)
    this.deleteHistory(null)
  }

  popClosedTab(): SavedTab | undefined {
    return this.closedTabs.pop()
  }

  // ---- stats
  get totalBlocked(): number {
    return this.statsStore.get().blocked
  }

  get threatsBlocked(): number {
    return this.statsStore.get().threats ?? 0
  }

  addThreat(): void {
    const s = this.statsStore.get()
    s.threats = (s.threats ?? 0) + 1
    this.statsStore.set(s)
  }

  // ---- safe browsing trust
  /** Hosts the user said are fine, plus hosts already in their history. */
  isTrustedHost(host: string): boolean {
    if (this.trustedStore.get().includes(host)) return true
    return this.hosts().has(host)
  }

  private hosts(): Set<string> {
    if (!this.visitedHosts) {
      this.visitedHosts = new Set()
      for (const e of this.historyStore.get()) {
        try {
          this.visitedHosts.add(new URL(e.url).hostname)
        } catch {
          /* skip */
        }
      }
    }
    return this.visitedHosts
  }

  /** Any page of this site ("example.com") is in the history. */
  hasVisitedSite(site: string): boolean {
    for (const h of this.hosts()) if (h === site || h.endsWith(`.${site}`)) return true
    return false
  }

  // ---- bounce tracking: sites the user really used (clicked or typed on)
  get interactions(): Record<string, number> {
    return this.interactionStore.get()
  }

  saveInteraction(site: string, at: number): void {
    this.interactionStore.update((all) => {
      const next = { ...all, [site]: at }
      const keys = Object.keys(next)
      if (keys.length > 5000) for (const k of keys.sort((a, b) => next[a] - next[b]).slice(0, keys.length - 5000)) delete next[k]
      return next
    })
  }

  trustHost(host: string): void {
    if (!this.trustedStore.get().includes(host)) this.trustedStore.update((l) => [...l, host].slice(-2000))
  }

  addBlocked(n = 1): void {
    this.statsStore.get().blocked += n
    this.statsStore.set(this.statsStore.get())
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(n) ? n : min))
}
