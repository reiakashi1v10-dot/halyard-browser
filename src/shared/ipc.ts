import type {
  AccountResult,
  AccountState,
  AgentState,
  AiModelStatus,
  Bookmark,
  Command,
  ContentInsets,
  DownloadInfo,
  FrozenFrame,
  HistoryEntry,
  LinkReport,
  PaletteItem,
  PerformanceReport,
  RansomwareStatus,
  Settings,
  SiteAudit,
  SiteInfo,
  WinScanResult,
  UpdateState,
  WinSecurityReport,
  SearchPage,
  Space,
  WindowState
} from './types'

/** Request/response channels used by the browser window UI. */
export interface UiApi {
  'state:get': () => WindowState
  'cmd:run': (command: Command) => void
  'tab:create': (url?: string, opts?: { background?: boolean; spaceId?: string }) => number
  'tab:activate': (tabId: number) => void
  'tab:close': (tabId: number) => void
  'tab:move': (tabId: number, toIndex: number, pinned: boolean) => void
  'tab:menu': (tabId: number) => void
  'tab:mute': (tabId: number) => void
  'tab:wake': (tabId: number) => void
  'tab:sleep': (tabId: number) => void
  'tab:translate-menu': (x: number, y: number) => void
  'nav:go': (input: string, where: 'current' | 'new') => void
  'palette:query': (query: string, withSuggestions: boolean) => PaletteItem[]
  'space:create': () => Space
  'space:update': (id: string, patch: Partial<Omit<Space, 'id'>>) => void
  'space:delete': (id: string) => void
  'space:activate': (id: string) => void
  'space:menu': (id: string) => void
  'split:ratio': (ratio: number) => void
  'split:close': () => void
  'split:swap': () => void
  'ui:bounds': (insets: ContentInsets) => void
  'ui:freeze': () => FrozenFrame[]
  'ui:hide-views': (hidden: boolean) => void
  'ui:chrome-colors': (bg: string, fg: string) => void
  'ui:sidebar-width': (width: number) => void
  'find:query': (text: string, opts: { forward: boolean; findNext: boolean }) => void
  'find:close': () => void
  'site:info': () => SiteInfo | null
  'site:toggle-adblock': () => void
  'site:toggle-scripts': () => void
  'site:clear-permission': (permission: string) => void
  'prompt:respond': (id: number, allow: boolean, remember: boolean) => void
  'downloads:list': () => DownloadInfo[]
  'downloads:open': (id: string) => void
  'downloads:show': (id: string) => void
  'downloads:cancel': (id: string) => void
  'downloads:clear': () => void
  'perf:report': () => PerformanceReport
  'perf:set-limit': (mb: number) => void
  'bookmark:toggle': () => boolean
  'bookmark:is': (url: string) => boolean
  'settings:get': () => Settings
  'win:minimize': () => void
  'win:maximize': () => void
  'win:close': () => void
  'app:menu': (x: number, y: number) => void
  'menu:pick': (menuId: number, itemId: string | null) => void
  'download:decide': (id: number, ok: boolean) => void
  'settings:set': (patch: Partial<Settings>) => Settings
  'account:get': () => AccountState
  'account:sign-in': (email: string, password: string) => AccountResult
  'account:sign-up': (email: string, password: string, name: string) => AccountResult
  'account:resend': (email: string) => AccountResult
  'account:sign-out': () => void
  'agent:get': () => AgentState
  'agent:download': () => void
  'agent:cancel-download': () => void
  'agent:retry': () => void
  'agent:run': (goal: string) => void
  'agent:stop': () => void
  'agent:confirm': (id: number, allow: boolean) => void
  'agent:clear': () => void
  /** Where does this link (from a QR Code or the page) really go? */
  'qr:analyze': (text: string) => LinkReport
  /** Open a checked link: in a new tab, or in a throw-away container tab. */
  'qr:open': (url: string, disposable: boolean) => void
  /** Copy a generated QR Code image (PNG data URL) to the clipboard. */
  'qr:copy-image': (dataUrl: string) => void
  /** Save a generated QR Code image (PNG data URL) where the user picks. */
  'qr:save-image': (dataUrl: string, name: string) => boolean
}

/** Channels available to the halyard:// internal pages only. */
export interface InternalApi {
  'internal:settings': () => Settings
  'internal:set-settings': (patch: Partial<Settings>) => Settings
  'internal:history': (query: string, limit: number) => HistoryEntry[]
  'internal:history-delete': (url: string | null) => void
  'internal:bookmarks': () => Bookmark[]
  'internal:bookmark-remove': (id: string) => void
  'internal:bookmark-rename': (id: string, title: string) => void
  'internal:top-sites': () => HistoryEntry[]
  'internal:resolve': (input: string) => string
  /** Halyard search results. `next` is the token from the previous page. */
  'internal:search': (query: string, next: string | null) => SearchPage
  'internal:stats': () => { blocked: number; sleepingTabs: number; openTabs: number; threatHosts: number; threatsBlocked: number }
  'internal:guard-proceed': (url: string, remember: boolean) => void
  /** HTTPS-only: open this site without HTTPS until the browser closes. */
  'internal:allow-http': (url: string) => void
  'internal:clear-data': (what: { history: boolean; cache: boolean; cookies: boolean }) => void
  'internal:permissions': () => { origin: string; permission: string; decision: 'allow' | 'deny' }[]
  'internal:permission-remove': (origin: string, permission: string) => void
  'internal:downloads': () => DownloadInfo[]
  'internal:open-download': (id: string) => void
  'internal:show-download': (id: string) => void
  'internal:version': () => { app: string; electron: string; chrome: string; node: string }
  'internal:theme': () => { hue: number; isPrivate: boolean }
  'internal:account': () => AccountState
  /** Show the sign-in screen in this window. */
  'internal:account-open': () => void
  'internal:sign-out': () => void
  'internal:ai': () => { status: AiModelStatus; size: number }
  'internal:ai-remove': () => void
  'internal:ransomware': () => RansomwareStatus
  'internal:open-ransomware': () => void
  'internal:winsec': () => WinSecurityReport
  'internal:open-winsec': (id: string) => void
  'internal:quick-scan': () => WinScanResult
  'internal:update': () => UpdateState
  'internal:update-check': () => UpdateState
  'internal:update-install': () => void
  'internal:open-legal': (doc: string) => void
  'internal:open-lab': () => void
  /** "Clear everything" (asks first). */
  'internal:panic': () => void
}

/** Channels of the Halyard Lab window (security tools). */
export interface LabApi {
  'lab:analyze': (text: string) => LinkReport
  /** The page in the browser window used last. */
  'lab:active': () => { url: string; title: string } | null
  /** Security check of a site (the active tab when no address is given). */
  'lab:audit': (url: string | null) => SiteAudit
  /** Times a password appears in leaks, by its SHA-1 (k-anonymity: only 5 characters are sent). */
  'lab:breach': (sha1: string) => number
  'lab:hash-file': (path: string) => { name: string; size: number; sha256: string; sha1: string; md5: string }
  'lab:dns': (host: string) => { addresses: { address: string; family: string }[]; listed: string | null }
  'lab:open': (url: string, disposable: boolean) => void
  'lab:copy-image': (dataUrl: string) => void
  'lab:save-image': (dataUrl: string, name: string) => boolean
  'lab:settings': () => Settings
  /** Save a photo re-encoded without metadata (JPEG or PNG data URL). */
  'lab:save-photo': (dataUrl: string, name: string) => boolean
}

export const LAB_CHANNELS = [
  'lab:analyze', 'lab:active', 'lab:audit', 'lab:breach', 'lab:hash-file', 'lab:dns', 'lab:open', 'lab:copy-image',
  'lab:save-image', 'lab:settings', 'lab:save-photo'
] as const satisfies readonly (keyof LabApi)[]

export const UI_CHANNELS = [
  'state:get', 'cmd:run', 'tab:create', 'tab:activate', 'tab:close', 'tab:move', 'tab:menu', 'tab:mute',
  'tab:wake', 'tab:sleep', 'tab:translate-menu', 'nav:go', 'palette:query', 'space:create', 'space:update', 'space:delete',
  'space:activate', 'space:menu', 'split:ratio', 'split:close', 'split:swap', 'ui:bounds', 'ui:freeze',
  'ui:hide-views', 'ui:chrome-colors', 'ui:sidebar-width', 'find:query', 'find:close', 'site:info',
  'site:toggle-adblock', 'site:toggle-scripts', 'site:clear-permission', 'prompt:respond', 'downloads:list', 'downloads:open',
  'downloads:show', 'downloads:cancel', 'downloads:clear', 'perf:report', 'perf:set-limit',
  'bookmark:toggle', 'bookmark:is', 'settings:get', 'win:minimize', 'win:maximize', 'win:close', 'app:menu',
  'menu:pick', 'download:decide', 'settings:set', 'account:get', 'account:sign-in', 'account:sign-up',
  'account:resend', 'account:sign-out', 'agent:get', 'agent:download', 'agent:cancel-download', 'agent:retry',
  'agent:run', 'agent:stop', 'agent:confirm', 'agent:clear', 'qr:analyze', 'qr:open', 'qr:copy-image', 'qr:save-image'
] as const satisfies readonly (keyof UiApi)[]

export const INTERNAL_CHANNELS = [
  'internal:settings', 'internal:set-settings', 'internal:history', 'internal:history-delete',
  'internal:bookmarks', 'internal:bookmark-remove', 'internal:bookmark-rename', 'internal:top-sites',
  'internal:resolve', 'internal:search', 'internal:stats', 'internal:clear-data', 'internal:permissions',
  'internal:permission-remove', 'internal:downloads', 'internal:open-download', 'internal:show-download',
  'internal:version', 'internal:theme', 'internal:guard-proceed', 'internal:account', 'internal:account-open',
  'internal:sign-out', 'internal:ai', 'internal:ai-remove', 'internal:ransomware', 'internal:open-ransomware',
  'internal:winsec', 'internal:open-winsec', 'internal:quick-scan',
  'internal:update', 'internal:update-check', 'internal:update-install', 'internal:open-legal',
  'internal:allow-http', 'internal:open-lab', 'internal:panic'
] as const satisfies readonly (keyof InternalApi)[]

export const UI_EVENTS = ['state', 'downloads', 'settings', 'ui-action', 'toast', 'account', 'agent'] as const
export const INTERNAL_EVENTS = ['settings', 'downloads', 'account', 'ai', 'update'] as const

export type Result<T> = { ok: true; data: T } | { ok: false; error: string }
