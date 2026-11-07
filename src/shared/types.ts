// Types shared by the main process, the preload bridges and the UI.
import type { Lang } from './i18n'

export type SecurityState = 'secure' | 'insecure' | 'internal' | 'local' | 'dangerous'

export type ThreatKind = 'malware' | 'phishing' | 'typo' | 'homograph'

export interface ThreatVerdict {
  kind: ThreatKind
  host: string
  url: string
  /** For typos and look-alikes: the site the user probably meant. */
  suggestion?: string
}

export interface TabInfo {
  id: number
  spaceId: string
  url: string
  title: string
  favicon: string | null
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  pinned: boolean
  muted: boolean
  audible: boolean
  sleeping: boolean
  crashed: boolean
  zoom: number
  blocked: number
  security: SecurityState
  lastActive: number
  /** Shown through Google Translate right now. */
  translated: boolean
  /** The page declares a language other than the app's: offer to translate. */
  foreign: boolean
  /** Hue of the tab's container (its own cookies and storage), or null. */
  container: number | null
  /** Camera or microphone was given to this page (until it leaves the site). */
  capture: 'camera' | 'microphone' | 'both' | null
}

export interface Space {
  id: string
  name: string
  /** Hue (0-360) that tints the whole window while the space is active. */
  hue: number
  icon: string
}

export interface SplitState {
  left: number
  right: number
  /** Share of the width taken by the left pane (0.2 - 0.8). */
  ratio: number
}

export interface FindState {
  open: boolean
  matches: number
  active: number
}

export interface PermissionPrompt {
  id: number
  tabId: number
  origin: string
  permission: string
}

export interface WindowState {
  windowId: number
  isPrivate: boolean
  tabs: TabInfo[]
  spaces: Space[]
  activeSpaceId: string
  activeTabId: number | null
  split: SplitState | null
  sidebarCollapsed: boolean
  htmlFullscreen: boolean
  maximized: boolean
  find: FindState
  prompts: PermissionPrompt[]
  adblockEnabled: boolean
  /** Hosts where the blocker is off. */
  allowlist: string[]
  totalBlocked: number
}

export type SearchEngineId = 'duckduckgo' | 'google' | 'brave' | 'bing' | 'startpage' | 'ecosia'

export interface Settings {
  searchEngine: SearchEngineId
  suggestions: boolean
  theme: 'system' | 'dark' | 'light'
  adblock: boolean
  /** Warn before opening malware, phishing and look-alike sites. */
  safeBrowsing: boolean
  allowlist: string[]
  restoreSession: boolean
  /** Minutes before a background tab goes to sleep. 0 = never. */
  sleepAfterMinutes: number
  /** When total tab memory passes this many MB, the oldest tabs sleep. 0 = off. */
  memoryLimitMB: number
  sidebarWidth: number
  sidebarCollapsed: boolean
  httpsOnly: boolean
  doNotTrack: boolean
  /** Ask where to save every download. */
  askWhereToSave: boolean
  /** Downloads a site starts without a click or key press need the user's OK. */
  blockDriveBy: boolean
  /** DNS over HTTPS provider. */
  secureDns: SecureDns
  /** Never fall back to unencrypted DNS. */
  secureDnsStrict: boolean
  /** Refuse weak TLS cipher suites (CBC-SHA1, 3DES, RSA key exchange). */
  strictTls: boolean
  /** WebRTC may not reveal the computer's local IP addresses. */
  webrtcProtection: boolean
  /** Remove fbclid, gclid, utm_* and other click trackers from addresses. */
  stripTracking: boolean
  /** Wipe cookies of sites that only bounce you through redirects. */
  bounceProtection: boolean
  /** Block pop-ups and tab-unders that were not opened by a click. */
  blockPopups: boolean
  /** Warn when a password typed into a site is in a known data leak. */
  breachCheck: boolean
  /** Put background tabs to sleep when they burn the processor (crypto mining). */
  cryptoGuard: boolean
  /** Clear the clipboard when a site puts a system command in it ("ClickFix" scams). */
  antiClickFix: boolean
  /** Warn before typing a password on a page without HTTPS, or one that sends it elsewhere. */
  insecureLoginWarn: boolean
  /** Sites may only ask to show notifications right after a click. */
  quietNotifications: boolean
  /** Make the browser look like every other one (canvas noise, common hardware values). */
  fingerprintProtection: boolean
  /** Show the real site while a page is in full screen (fake browser and fake Windows screens). */
  fullscreenWarn: boolean
  /** Warn about addresses that disguise themselves as a known brand or use scam-prone endings. */
  riskyDomainWarn: boolean
  /** Public sites may not reach the router, printers or other devices on the user's network. */
  blockLocalNetwork: boolean
  /** JavaScript is off on every site unless it is in `scriptSites`. */
  scriptsOffByDefault: boolean
  /** Sites where the JavaScript default is flipped (allowed when off by default, blocked otherwise). */
  scriptSites: string[]
  /** Pages may not download their own fonts (icons can look wrong). */
  blockRemoteFonts: boolean
  /** Refuse programs and scripts (.exe, .msi, .bat, .ps1...) outright instead of asking. */
  blockExecutables: boolean
  userName: string
  /** Stored on this computer only, used to personalize the browser. */
  email: string
  language: Lang
  /** The welcome screen has been completed. */
  onboarded: boolean
}

export type SecureDns = 'cloudflare' | 'quad9' | 'google' | 'system' | 'off'

export interface HistoryEntry {
  url: string
  title: string
  favicon: string | null
  visitedAt: number
  visits: number
}

export interface Bookmark {
  id: string
  url: string
  title: string
  favicon: string | null
  createdAt: number
}

export type DownloadStatus = 'progressing' | 'paused' | 'completed' | 'cancelled' | 'interrupted'

export type ScanStatus = 'none' | 'awaiting-confirmation' | 'pending' | 'scanning' | 'clean' | 'infected' | 'unavailable'

export interface DownloadInfo {
  /** The name hid its real type (reversed text, "invoice.pdf.exe"...). */
  deceptive?: boolean
  id: string
  filename: string
  path: string
  url: string
  /** Site the download was started from. */
  source: string
  /** Installer, script or archive: confirmed and scanned before use. */
  risky: boolean
  scan: ScanStatus
  received: number
  total: number
  status: DownloadStatus
  startedAt: number
  /** Bytes per second while the file is coming in (smoothed). */
  speed: number
  /** SHA-256 of the finished file, to check it against the publisher's. */
  sha256?: string
  /** What a .zip holds (read from its table of contents, nothing is extracted). */
  inside?: ArchiveReport
}

export interface ArchiveReport {
  entries: number
  /** Up to 5 names inside that can run code (programs, scripts, shortcuts, disks, macro documents). */
  risky: string[]
  riskyCount: number
  /** Password-protected: antivirus scanners can't see inside. */
  encrypted: boolean
}

export interface TabMemory {
  tabId: number
  title: string
  favicon: string | null
  memoryKB: number
  cpu: number
  sleeping: boolean
}

export interface PerformanceReport {
  totalKB: number
  browserKB: number
  tabs: TabMemory[]
  sleepingCount: number
  limitMB: number
}

export type PaletteItemKind = 'tab' | 'bookmark' | 'history' | 'suggestion' | 'url' | 'search' | 'command'

export interface PaletteItem {
  kind: PaletteItemKind
  id: string
  title: string
  subtitle?: string
  url?: string
  favicon?: string | null
  tabId?: number
  command?: Command
}

export interface SiteInfo {
  host: string
  blocked: number
  adblockActive: boolean
  /** JavaScript runs on this site. */
  scriptsActive: boolean
  security: SecurityState
  permissions: { permission: string; decision: 'allow' | 'deny' }[]
}

export interface FrozenFrame {
  tabId: number
  dataUrl: string
}

/** Distance from each window edge to the page area, measured by the UI. */
export interface ContentInsets {
  left: number
  top: number
  right: number
  bottom: number
}

/** Every action that can be triggered by a shortcut, a menu or the UI. */
export type Command =
  | 'new-tab'
  | 'scan-qr'
  | 'open-lab'
  | 'page-qr'
  | 'screenshot'
  | 'panic'
  | 'new-container-tab'
  | 'close-tab'
  | 'reopen-closed-tab'
  | 'next-tab'
  | 'prev-tab'
  | 'reload'
  | 'hard-reload'
  | 'stop'
  | 'back'
  | 'forward'
  | 'focus-address'
  | 'open-palette'
  | 'find'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'toggle-sidebar'
  | 'toggle-split'
  | 'toggle-pin'
  | 'toggle-mute'
  | 'duplicate-tab'
  | 'bookmark'
  | 'new-window'
  | 'new-private-window'
  | 'open-history'
  | 'open-bookmarks'
  | 'open-downloads'
  | 'open-settings'
  | 'devtools'
  | 'print'
  | 'sleep-tab'
  | 'sleep-background-tabs'
  | 'translate-page'
  | 'toggle-agent'
  | 'next-space'
  | 'prev-space'
  | 'copy-url'
  | 'fullscreen'
  | 'select-tab-1'
  | 'select-tab-2'
  | 'select-tab-3'
  | 'select-tab-4'
  | 'select-tab-5'
  | 'select-tab-6'
  | 'select-tab-7'
  | 'select-tab-8'
  | 'select-last-tab'
  | 'toggle-theme'

/** One row of a Halyard-styled menu. The main process keeps the click handlers. */
export interface MenuEntry {
  id?: string
  label?: string
  keys?: string
  enabled?: boolean
  checked?: boolean
  danger?: boolean
  separator?: boolean
  /** Colour swatch (hue) shown before the label. */
  hue?: number
  /** Short glyph shown before the label (space icons). */
  glyph?: string
  icon?: string
  submenu?: MenuEntry[]
}

export type DownloadKind = 'program' | 'archive' | 'script' | 'disk' | 'document' | 'other'

export interface DownloadRequest {
  id: number
  filename: string
  source: string
  size: number
  kind: DownloadKind
  /** The site started it on its own, without a click or key press. */
  unprompted?: boolean
  /** The name hides its real type: "invoice.pdf.exe", or reversed text that flips the extension. */
  deceptive?: boolean
}

/** Halyard account (Supabase). Tokens never leave the main process. */
export interface AccountState {
  /** False when this build has no Supabase project configured. */
  configured: boolean
  /** The saved session has been read. */
  ready: boolean
  user: { email: string } | null
}

export type AccountError =
  | 'not-configured'
  | 'invalid-email'
  | 'weak-password'
  | 'invalid-credentials'
  | 'email-not-confirmed'
  | 'email-exists'
  | 'signup-disabled'
  | 'rate-limited'
  | 'network'
  | 'unknown'

export type AccountResult = { ok: true; status: 'signed-in' | 'check-email' } | { ok: false; error: AccountError }

/** Windows' own ransomware protection (Controlled folder access) and installed antivirus. */
export type WinSecurityId =
  | 'realtime' | 'behavior' | 'tamper' | 'cloud' | 'pua' | 'folders' | 'signatures' | 'scan'
  | 'firewall' | 'secureBoot' | 'memoryIntegrity' | 'driverBlocklist' | 'smartApp'

export interface WinSecurityItem {
  id: WinSecurityId
  /** warn: partly on (audit mode, evaluation, getting old). unknown: not readable or handled by another antivirus. */
  state: 'on' | 'off' | 'warn' | 'unknown'
  /** Days (definitions, last scan) or profiles off (firewall). */
  value?: number
}

export interface WinSecurityReport {
  supported: boolean
  /** Antivirus products other than Microsoft Defender. */
  otherAntivirus: string[]
  items: WinSecurityItem[]
}

export interface UpdateState {
  /** disabled: development build or no GitHub repository configured. */
  status: 'disabled' | 'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'ready' | 'error'
  current: string
  /** Newest version found. */
  version?: string
  percent?: number
  checkedAt?: number
  /** Portable copies can't replace themselves: the user downloads the new one. */
  portable: boolean
}

export type WinScanResult = 'clean' | 'threats' | 'unavailable'

export interface RansomwareStatus {
  folders: 'on' | 'off' | 'audit' | 'unknown' | 'unsupported'
  antivirus: string[]
}

// ---------------------------------------------------------------- local AI assistant

export type AiError = 'disk-full' | 'network' | 'corrupt' | 'engine'

/** The model file and the engine that runs it (shared by every window). */
export type AiModelStatus =
  | { kind: 'missing'; size: number; partial: number }
  | { kind: 'downloading'; received: number; total: number; speed: number }
  | { kind: 'verifying' }
  | { kind: 'loading' }
  | { kind: 'ready'; gpu: 'gpu' | 'cpu' | null }
  | { kind: 'error'; error: AiError }

export interface AgentEntry {
  id: number
  kind: 'goal' | 'step' | 'answer' | 'error' | 'info'
  text: string
  /** For steps: did the action work? */
  ok?: boolean
  /** For steps: the model's short reason. */
  note?: string
}

export interface AgentConfirm {
  id: number
  text: string
  host: string
}

export interface AgentState {
  model: AiModelStatus
  modelSize: number
  running: boolean
  /** Waiting for the model's next action. */
  thinking: boolean
  entries: AgentEntry[]
  /** The agent is waiting for the user to allow or refuse an action. */
  confirm: AgentConfirm | null
}

export type UiAction =
  | { action: 'palette'; mode: 'current' | 'new'; query?: string }
  | { action: 'find' }
  | { action: 'downloads'; open?: boolean }
  | { action: 'performance' }
  | { action: 'shield' }
  | { action: 'edit-space'; id: string }
  | { action: 'menu'; menuId: number; items: MenuEntry[]; x: number; y: number }
  | { action: 'confirm-download'; request: DownloadRequest }
  | { action: 'account' }
  | { action: 'agent'; open?: boolean }
  /** Check a QR Code (an image to decode) or a link before opening it. */
  | { action: 'qr'; image?: string; text?: string; source: 'image' | 'page' | 'link' | 'none' }
  /** Show a QR Code of this page, to open it on a phone. */
  | { action: 'page-qr'; url: string; title: string }

/** Events pushed from main to the window UI. */
export interface UiEvents {
  state: WindowState
  downloads: DownloadInfo[]
  settings: Settings
  /** Main asks the UI to show something (palette, find bar, etc.). */
  'ui-action': UiAction
  toast: { message: string; warn?: boolean }
  account: AccountState
  agent: AgentState
}

export const INTERNAL_SCHEME = 'halyard'
export const NEW_TAB_URL = 'halyard://newtab/'

export const SEARCH_ENGINES: Record<SearchEngineId, { name: string; search: string; suggest: string | null }> = {
  duckduckgo: {
    name: 'DuckDuckGo',
    search: 'https://duckduckgo.com/?q=%s',
    suggest: 'https://duckduckgo.com/ac/?q=%s&type=list'
  },
  google: {
    name: 'Google',
    search: 'https://www.google.com/search?q=%s',
    suggest: 'https://suggestqueries.google.com/complete/search?client=firefox&q=%s'
  },
  brave: {
    name: 'Brave Search',
    search: 'https://search.brave.com/search?q=%s',
    suggest: 'https://search.brave.com/api/suggest?q=%s'
  },
  bing: {
    name: 'Bing',
    search: 'https://www.bing.com/search?q=%s',
    suggest: 'https://api.bing.com/osjson.aspx?query=%s'
  },
  startpage: {
    name: 'Startpage',
    search: 'https://www.startpage.com/do/search?q=%s',
    suggest: null
  },
  ecosia: {
    name: 'Ecosia',
    search: 'https://www.ecosia.org/search?q=%s',
    suggest: 'https://ac.ecosia.org/autocomplete?q=%s&type=list'
  }
}

export const DEFAULT_SETTINGS: Settings = {
  searchEngine: 'duckduckgo',
  suggestions: true,
  theme: 'system',
  adblock: true,
  safeBrowsing: true,
  allowlist: [],
  restoreSession: true,
  sleepAfterMinutes: 30,
  memoryLimitMB: 0,
  sidebarWidth: 264,
  sidebarCollapsed: false,
  httpsOnly: true,
  doNotTrack: true,
  askWhereToSave: true,
  blockDriveBy: true,
  secureDns: 'cloudflare',
  secureDnsStrict: false,
  strictTls: true,
  webrtcProtection: true,
  stripTracking: true,
  bounceProtection: true,
  blockPopups: true,
  breachCheck: true,
  cryptoGuard: true,
  antiClickFix: true,
  insecureLoginWarn: true,
  quietNotifications: true,
  fingerprintProtection: true,
  fullscreenWarn: true,
  riskyDomainWarn: true,
  blockLocalNetwork: true,
  scriptsOffByDefault: false,
  scriptSites: [],
  blockRemoteFonts: false,
  blockExecutables: false,
  userName: '',
  email: '',
  language: 'en',
  onboarded: false
}

/** Why a link or QR Code looks risky (or just worth knowing). Rendered by the UI with `link.<code>`. */
export interface LinkReason {
  code:
    | 'malware' | 'phishing' | 'typo' | 'homograph' | 'decoy' | 'credentials' | 'scheme'
    | 'ip' | 'local' | 'punycode' | 'tld' | 'shortener' | 'http' | 'deep' | 'long' | 'open-redirect'
    | 'redirects' | 'unreachable'
  value?: string
}

export interface LinkReport {
  kind: 'url' | 'text'
  input: string
  level: 'safe' | 'caution' | 'danger'
  host?: string
  /** Host as people read it (punycode turned back into letters). */
  displayHost?: string
  /** Where the link ends up after its redirects. */
  finalUrl?: string
  finalHost?: string
  reasons: LinkReason[]
  /** Every address the link passed through, with the HTTP status (0: not contacted). */
  chain: { url: string; status: number }[]
}

/** Security check of the site in the active tab (Halyard Lab). */
export interface SiteAudit {
  url: string
  host: string
  secure: boolean
  /** Security headers the server sent with the page. */
  headers: { name: string; value: string | null; good: boolean }[]
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
  certificate: { issuer: string; subject: string; validFrom: number; validTo: number; fingerprint: string } | null
  /** Other sites the page talked to. */
  thirdParties: { host: string; count: number }[]
  blocked: number
  cookies: number
  permissions: { permission: string; decision: 'allow' | 'deny' }[]
}
