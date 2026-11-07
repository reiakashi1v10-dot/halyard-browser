import { app, BrowserWindow, clipboard, dialog, ipcMain, net, protocol, session as electronSession, webContents as allWebContents, type Session, type WebContents } from 'electron'
import type { DownloadInfo } from '@shared/types'
import { BRAND, locale, setLang, t } from '@shared/i18n'
import { dirname, join, normalize, sep } from 'node:path'
import { existsSync, renameSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { pathToFileURL } from 'node:url'
import { Profile } from './profile'
import { Account } from './account'
import { AiEngine } from './ai'
import { Downloads } from './downloads'
import { Shield } from './adblock'
import { Guard } from './guard'
import { BrowserController, type Services } from './window'
import { Tab } from './tab'
import { registerIpc, perfReport } from './ipc'
import { flushAllStores } from './store'
import { fileKind } from './scanner'
import { Updater } from './updater'
import { hostOf, isNavigable, originOf, resolveInput } from './url'
import { applySecureDns, applyTls, BounceGuard, BreachCheck, isPrivateHost, siteOf } from './privacy'
import { labSettingsChanged, openLab, registerLabIpc, type LabDeps } from './lab'

// keeps the existing user data folder (%APPDATA%\Halyard)
app.setName('Halyard')
migrateOldDataFolder()
app.setAppUserModelId('app.halyard.browser')

protocol.registerSchemesAsPrivileged([
  { scheme: 'halyard', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

// Sites treat "Electron" user agents as embedded webviews (Google sign-in refuses them).
const USER_AGENT = app.userAgentFallback.replace(/\s?Electron\/\S+/i, '').replace(/\s?halyard(-browser)?\/\S+/i, '')
app.userAgentFallback = USER_AGENT

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const url = argv.slice(1).find((a) => /^(https?|file):/i.test(a))
    const ctl = BrowserController.lastFocused
    if (!ctl) return void openWindow({ isPrivate: false, url })
    if (ctl.win.isMinimized()) ctl.win.restore()
    ctl.win.focus()
    if (url) ctl.createTab(url)
  })
  void app.whenReady().then(start)
}

const RENDERER_DIR = join(__dirname, '../renderer')
const DEV_URL = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined

const ALWAYS_ALLOWED = new Set(['fullscreen', 'pointerLock', 'mediaKeySystem'])
/** Only asked for, and only work, while the tab is on screen; "only this time" by default. */
const SENSITIVE = new Set(['camera', 'microphone', 'camera+microphone', 'geolocation', 'display-capture', 'clipboard-read', 'hid', 'serial', 'usb', 'midiSysex'])
/** Device pickers open only right after a click on a tab that is on screen. */
const DEVICES = new Set(['hid', 'serial', 'usb'])
const ASK = new Set([
  'media', 'geolocation', 'notifications', 'midi', 'midiSysex', 'clipboard-read', 'idle-detection',
  'hid', 'serial', 'usb', 'display-capture', 'speaker-selection', 'storage-access', 'top-level-storage-access', 'keyboardLock'
])

let profile: Profile
let account: Account
let ai: AiEngine
let downloads: Downloads
let shield: Shield
let guard: Guard
let bounce: BounceGuard
let updater: Updater
const breach = new BreachCheck()
/** Every session in use (default, private windows, containers), for settings that apply to all. */
const sessions: Session[] = []
let quitting = false
let sessionTimer: NodeJS.Timeout | null = null

const services: Services = {
  get profile() {
    return profile
  },
  get account() {
    return account
  },
  get ai() {
    return ai
  },
  get downloads() {
    return downloads
  },
  get shield() {
    return shield
  },
  get guard() {
    return guard
  },
  get bounce() {
    return bounce
  },
  get updater() {
    return updater
  },
  openWindow: (opts) => openWindow(opts),
  sessionChanged,
  windowClosing,
  loadChrome,
  prepareSession,
  openLab: () => openLab(labDeps),
  panic
}

const labDeps: LabDeps = {
  get svc() {
    return services
  },
  breach,
  get devUrl() {
    return DEV_URL
  },
  get rendererDir() {
    return RENDERER_DIR
  }
}

/** "Clear everything", after the user confirms: history, site data, cache, permissions, open tabs. */
async function panic(from: BrowserController): Promise<void> {
  const { response } = await dialog.showMessageBox(from.win, {
    type: 'warning',
    title: t('panic.title'),
    message: t('panic.title'),
    detail: t('panic.detail'),
    buttons: [t('common.cancel'), t('panic.confirm')],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  })
  if (response !== 1) return
  profile.forgetAll()
  downloads.clearFinished()
  for (const ctl of [...BrowserController.all.values()]) ctl.resetTabs()
  for (const ses of new Set([electronSession.defaultSession, ...sessions])) {
    await ses.clearStorageData().catch(() => undefined)
    await ses.clearCache().catch(() => undefined)
    await ses.clearAuthCache().catch(() => undefined)
    await ses.clearHostResolverCache().catch(() => undefined)
  }
  await clipboard.clear()
  saveSession()
  from.toast(t('panic.done'))
}

function start(): void {
  profile = new Profile()
  setLang(profile.settings.language)
  account = new Account(profile)
  ai = new AiEngine()
  ai.on('change', () => {
    for (const tab of BrowserController.all.values()) for (const t of tab.allTabs()) if (t.url.startsWith('halyard://settings')) t.wc?.send('ai', ai.state())
  })
  account.on('change', (state) => {
    for (const ctl of BrowserController.all.values()) {
      ctl.send('account', state)
      for (const tab of ctl.allTabs()) if (tab.url.startsWith('halyard://')) tab.wc?.send('account', state)
    }
  })
  bounce = new BounceGuard(
    {
      interactions: () => profile.interactions,
      saveInteraction: (site, at) => profile.saveInteraction(site, at),
      hasVisited: (site) => profile.hasVisitedSite(site)
    },
    () => new Set([...BrowserController.all.values()].flatMap((c) => c.allTabs().map((t) => siteOf(t.url))))
  )
  applySecureDns(profile.settings)
  guard = new Guard(
    (host) => profile.isTrustedHost(host),
    (host) => profile.trustHost(host)
  )
  downloads = new Downloads({
    onChange: (list) => {
      for (const ctl of BrowserController.all.values()) {
        ctl.send('downloads', list)
        for (const tab of ctl.allTabs()) if (tab.url.startsWith('halyard://')) tab.wc?.send('downloads', list)
      }
    },
    // open the downloads panel right away, with progress and a cancel button
    began: () => BrowserController.lastFocused?.uiAction({ action: 'downloads', open: true }),
    isDangerous: (url) => {
      if (!profile.settings.safeBrowsing) return false
      try {
        const listed = guard.listed(new URL(url).hostname) !== null
        if (listed) BrowserController.lastFocused?.toast(t('toast.dlBlocked'))
        return listed
      } catch {
        return false
      }
    },
    confirm: (info, source, unprompted) => confirmDownload(info, source, unprompted),
    askWhere: () => profile.settings.askWhereToSave,
    refuse: (filename) => {
      if (!profile.settings.blockExecutables) return false
      const kind = fileKind(filename)
      if (kind !== 'program' && kind !== 'script') return false
      BrowserController.lastFocused?.toast(t('toast.exeBlocked', { file: filename }))
      return true
    },
    unprompted: (source, chain) => {
      if (!profile.settings.blockDriveBy || !source || source.isDestroyed()) return false
      const tab = Tab.fromWebContents(source.id)
      if (!tab) return false
      return !tab.startedByUser(chain)
    },
    scanned: (info) => {
      const ctl = BrowserController.lastFocused
      if (info.scan === 'clean') ctl?.toast(t('toast.clean', { file: info.filename }))
      else if (info.scan === 'infected') {
        ctl?.toast(t('toast.infected', { file: info.filename }))
        ctl?.uiAction({ action: 'downloads', open: true })
      } else ctl?.toast(t('toast.unscanned', { file: info.filename }))
      if (info.scan !== 'infected' && info.inside) {
        const inside = info.inside
        ctl?.toast(
          inside.encrypted && !inside.riskyCount
            ? t('toast.zipLocked', { file: info.filename })
            : t('toast.zipRisky', { file: info.filename, n: inside.riskyCount, name: inside.risky[0] ?? '' })
        )
      }
    }
  })
  shield = new Shield(profile, guard, (id) => {
    const tab = Tab.fromWebContents(id)
    if (!tab) return null
    return {
      url: tab.url,
      onThreat: (verdict) => tab.showThreat(verdict),
      onBlocked: () => {
        tab.blocked++
        for (const ctl of BrowserController.all.values()) if (ctl.allTabs().includes(tab)) ctl.scheduleState()
      }
    }
  })

  updater = new Updater((kind, version) => {
    BrowserController.lastFocused?.toast(t(kind === 'ready' ? 'toast.updateReady' : 'toast.updatePortable', { version }))
  })
  updater.on('change', (state) => {
    for (const ctl of BrowserController.all.values()) for (const tab of ctl.allTabs()) if (tab.url.startsWith('halyard://')) tab.wc?.send('update', state)
  })

  prepareSession(electronSession.defaultSession)
  registerIpc(services)
  registerLabIpc(labDeps)

  let lang = profile.settings.language
  let net0 = netKey(profile.settings)
  profile.on('settings', (settings) => {
    labSettingsChanged()
    const nk = netKey(settings)
    if (nk !== net0) {
      net0 = nk
      applySecureDns(settings)
      for (const ses of sessions) applyTls(ses, settings.strictTls)
      for (const ctl of BrowserController.all.values()) for (const tab of ctl.allTabs()) tab.applyPrivacy()
    }
    setLang(settings.language)
    account.settingsChanged(settings)
    if (settings.language !== lang) {
      lang = settings.language
      profile.localizeSpaces(lang)
    }
    for (const ctl of BrowserController.all.values()) {
      ctl.send('settings', settings)
      ctl.scheduleState()
      for (const tab of ctl.allTabs()) if (tab.url.startsWith('halyard://')) tab.wc?.send('settings', settings)
    }
  })
  profile.on('spaces', () => {
    for (const ctl of BrowserController.all.values()) ctl.spacesChanged()
  })

  profile.localizeSpaces(profile.settings.language)

  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', (e) => e.preventDefault())
  })

  const url = process.argv.slice(1).find((a) => /^(https?|file):/i.test(a))
  const saved = profile.settings.restoreSession ? profile.savedSession : []
  if (saved.length) {
    saved.forEach((w, i) => new BrowserController(services, { isPrivate: false, saved: w, url: i === 0 ? url : undefined }))
  } else {
    openWindow({ isPrivate: false, url })
  }

  setInterval(sleepIdleTabs, 60_000)
  setInterval(watchCpu, 10_000)
  wirePageBridge()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow({ isPrivate: false })
  })
}

function openWindow(opts: { isPrivate: boolean; url?: string }): BrowserController {
  const url = opts.url && isNavigable(opts.url) ? opts.url : opts.url ? resolveInput(opts.url, profile.settings.searchEngine) : undefined
  return new BrowserController(services, { isPrivate: opts.isPrivate, url })
}

const prepared = new WeakSet<Session>()

/** Wire a session (the default one or a private partition) to the browser's services. */
export function prepareSession(ses: Session): void {
  if (prepared.has(ses)) return
  prepared.add(ses)
  ses.setUserAgent(USER_AGENT)
  try {
    ses.setSpellCheckerLanguages(['en-US', 'pt-BR', 'es-ES', 'es'].filter((l) => ses.availableSpellCheckerLanguages.includes(l)))
  } catch {
    /* spellchecker languages are optional */
  }

  ses.protocol.handle('halyard', async (request) => {
    const url = new URL(request.url)
    let path = decodeURIComponent(url.pathname)
    if (path === '/' || path === '') path = '/internal.html'
    if (DEV_URL) return net.fetch(`${DEV_URL}${path}${url.search}`)
    const file = normalize(join(RENDERER_DIR, path))
    if (!file.startsWith(RENDERER_DIR + sep)) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })

  applyTls(ses, profile.settings.strictTls)
  sessions.push(ses)

  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const requesting = details.requestingUrl || wc.getURL()
    const tab = Tab.fromWebContents(wc.id)
    // clipboard isolation: a site may only write to the clipboard right after you click or type
    if (permission === 'clipboard-sanitized-write') {
      const ok = !tab || tab.gestureWithin(5000)
      if (ok && tab) checkClipboard(tab)
      return callback(ok)
    }
    if (requesting.startsWith('halyard://')) return callback(false)
    if (ALWAYS_ALLOWED.has(permission)) return callback(true)
    if (!ASK.has(permission)) return callback(false)
    const origin = originOf(requesting)
    const key = permission === 'media' ? mediaKey((details as Electron.MediaAccessPermissionRequest).mediaTypes ?? []) : permission
    const ctl = tab && controllerOf(tab)
    if (!tab || !ctl) return callback(false)
    // camera, microphone, location...: only for the tab you are looking at
    if (SENSITIVE.has(key) && !ctl.tabShown(tab)) return callback(false)
    const reply = (ok: boolean): void => {
      if (ok && permission === 'media') tab.markCapture(key)
      callback(ok)
    }
    if (hasGrant(tab, origin, key)) return reply(true)
    const saved = tab.container ? null : profile.permissionFor(origin, key)
    if (saved) return reply(saved === 'allow')
    // quiet notifications: a site may only ask right after you click something on it
    if (permission === 'notifications' && profile.settings.quietNotifications && !tab.gestureWithin(5000)) return callback(false)
    ctl.requestPermission(tab, key, origin, reply)
  })

  ses.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
    const tab = wc ? Tab.fromWebContents(wc.id) : undefined
    if (permission === 'clipboard-sanitized-write') return !tab || tab.gestureWithin(5000)
    if (ALWAYS_ALLOWED.has(permission)) return true
    const origin = originOf(requestingOrigin)
    if (DEVICES.has(permission)) {
      // lets the page ask; the user still picks the device in Halyard's own window
      const ctl = tab && controllerOf(tab)
      return !!tab && !!ctl && ctl.tabShown(tab) && tab.gestureWithin(5000)
    }
    const saved = (key: string): boolean => (tab ? hasGrant(tab, origin, key) : false) || (!tab?.container && profile.permissionFor(origin, key) === 'allow')
    if (permission === 'media') {
      const kind = details.mediaType === 'video' ? 'camera' : 'microphone'
      return saved(kind) || saved('camera+microphone')
    }
    return saved(permission)
  })

  // WebUSB, WebHID and Web Serial: the user picks the device, nothing is chosen for them
  ses.on('select-hid-device', (event, details, callback) => {
    event.preventDefault()
    const list = details.deviceList.map((d) => ({ id: d.deviceId, label: d.name || `HID ${d.vendorId}:${d.productId}` }))
    void pickDevice(details.frame ? allWebContents.fromFrame(details.frame) : undefined, 'hid', list).then((id) => callback(id))
  })
  ses.on('select-usb-device', (event, details, callback) => {
    event.preventDefault()
    const list = details.deviceList.map((d) => ({ id: d.deviceId, label: [d.manufacturerName, d.productName].filter(Boolean).join(' ') || `USB ${d.vendorId}:${d.productId}` }))
    void pickDevice(details.frame ? allWebContents.fromFrame(details.frame) : undefined, 'usb', list).then((id) => (id ? callback(id) : callback()))
  })
  ses.on('select-serial-port', (event, ports, wc, callback) => {
    event.preventDefault()
    const list = ports.map((p) => ({ id: p.portId, label: p.displayName || p.portName || p.portId }))
    void pickDevice(wc, 'serial', list).then((id) => callback(id ?? ''))
  })

  downloads.attach(ses)
  void shield.attach(ses)
}

function humanSize(bytes: number): string {
  const fmt = (n: number): string => n.toLocaleString(locale(), { maximumFractionDigits: 1 })
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${fmt(bytes / 1024)} KB`
  if (bytes < 1024 ** 3) return `${fmt(bytes / 1024 / 1024)} MB`
  return `${fmt(bytes / 1024 ** 3)} GB`
}

function controllerOf(tab: Tab): BrowserController | undefined {
  return [...BrowserController.all.values()].find((c) => c.allTabs().includes(tab))
}

function hasGrant(tab: Tab, origin: string, key: string): boolean {
  if (tab.grants.has(`${origin}|${key}`)) return true
  return (key === 'camera' || key === 'microphone') && tab.grants.has(`${origin}|camera+microphone`)
}

async function pickDevice(wc: WebContents | null | undefined, kind: 'usb' | 'hid' | 'serial', list: { id: string; label: string }[]): Promise<string | null> {
  const tab = wc ? Tab.fromWebContents(wc.id) : undefined
  const ctl = tab && controllerOf(tab)
  if (!tab || !ctl || !ctl.tabShown(tab)) return null
  return ctl.chooseDevice(tab, kind, list)
}

/** Settings that need the network stack reconfigured. */
function netKey(s: { secureDns: string; secureDnsStrict: boolean; strictTls: boolean; webrtcProtection: boolean }): string {
  return [s.secureDns, s.secureDnsStrict, s.strictTls, s.webrtcProtection].join('|')
}

/**
 * Bridge for web pages (in the preload's isolated world, never the page's own JavaScript):
 * the Global Privacy Control flag and the leaked-password check.
 */
/** One random number per site while the browser runs: the fingerprint noise stays the same on a site, differs between sites. */
const fpSeeds = new Map<string, number>()

function wirePageBridge(): void {
  ipcMain.on('halyard:config', (e) => {
    const tab = Tab.fromWebContents(e.sender.id)
    const s = profile.settings
    let seed: number | null = null
    if (tab && s.fingerprintProtection) {
      const site = siteOf(e.senderFrame?.url ?? '') || 'x'
      seed = fpSeeds.get(site) ?? (Math.random() * 0xffffffff) >>> 0
      if (fpSeeds.size > 2000) fpSeeds.clear()
      fpSeeds.set(site, seed)
    }
    e.returnValue = { gpc: !!tab && s.doNotTrack, fp: seed, login: !!tab && s.insecureLoginWarn, clip: !!tab && s.antiClickFix }
  })
  ipcMain.on('halyard:copy', (e) => {
    const tab = Tab.fromWebContents(e.sender.id)
    if (tab) checkClipboard(tab)
  })
  ipcMain.on('halyard:insecure-login', (e, kind: unknown) => {
    const tab = Tab.fromWebContents(e.sender.id)
    const url = e.senderFrame?.url ?? ''
    if (!tab || !profile.settings.insecureLoginWarn || (kind !== 'page' && kind !== 'form')) return
    let host = ''
    try {
      host = new URL(url).hostname
    } catch {
      return
    }
    if (isPrivateHost(host) || warnedLogins.has(`${kind}|${host}`)) return
    warnedLogins.add(`${kind}|${host}`)
    controllerOf(tab)?.toast(t(kind === 'page' ? 'toast.insecureLogin' : 'toast.insecureForm', { host }), true)
  })
  ipcMain.on('halyard:pw', (e, hash: unknown) => {
    const tab = Tab.fromWebContents(e.sender.id)
    if (!tab || !profile.settings.breachCheck || typeof hash !== 'string' || !/^[0-9a-fA-F]{40}$/.test(hash)) return
    const url = e.senderFrame?.url ?? ''
    // secure pages only (localhost counts as secure, like in Chromium)
    if (!/^https:|^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url)) return
    void breach
      .count(hash)
      .then((n) => {
        if (n <= 0) return
        const ctl = controllerOf(tab)
        ctl?.toast(t('toast.breach', { host: hostOf(url), n: n.toLocaleString(locale()) }), true)
      })
      .catch((err) => console.warn('[breach] check failed:', err instanceof Error ? err.message : err))
  })
}

// ---------------------------------------------------------------- ClickFix

const warnedLogins = new Set<string>()

/**
 * "ClickFix" scams show a fake check ("I'm not a robot"), copy a hidden command and
 * ask you to paste it in Win+R or PowerShell. Right after a page copies something,
 * Halyard looks at the clipboard: a system command that is not shown on the page is wiped.
 */
const COMMAND = new RegExp(
  [
    '\\b(powershell|pwsh)(\\.exe)?\\b',
    '\\bmshta(\\.exe)?\\b',
    '\\bcmd(\\.exe)?\\s+/[ckr]\\b',
    '\\b(iex|iwr|irm)\\b',
    'invoke-(expression|webrequest|restmethod)',
    'frombase64string',
    '\\s-e(nc|ncodedcommand)?\\s+[a-z0-9+/=]{24,}',
    '\\b(bitsadmin|rundll32|regsvr32|wscript|cscript|conhost)(\\.exe)?\\b',
    '\\bcertutil(\\.exe)?\\s+-(urlcache|decode)',
    '\\bmsiexec(\\.exe)?\\b.*https?:',
    '\\b(curl|wget)\\b[^|\\n]*\\|\\s*(ba|z)?sh\\b',
    'start-process',
    'osascript\\s+-e'
  ].join('|'),
  'i'
)
const clipTimers = new Map<number, NodeJS.Timeout>()

function checkClipboard(tab: Tab): void {
  if (!profile.settings.antiClickFix) return
  clearTimeout(clipTimers.get(tab.id))
  clipTimers.set(
    tab.id,
    setTimeout(() => {
      clipTimers.delete(tab.id)
      void (async () => {
        const text = (await clipboard.readText().catch(() => '')).trim()
        if (!text || text.length > 20_000 || !COMMAND.test(text)) return
        // a command shown on the page (a tutorial, documentation) is the user's choice to copy
        const line = text.split(/\r?\n/).find((l) => l.trim())?.trim().slice(0, 60) ?? ''
        const wc = tab.wc
        if (!wc || wc.isDestroyed()) return
        const shown = await wc
          .executeJavaScriptInIsolatedWorld(1014, [{ code: `(document.body?.innerText ?? '').replace(/\\s+/g, ' ').includes(${JSON.stringify(line.replace(/\s+/g, ' '))})` }])
          .catch(() => false)
        if (shown === true) return
        await clipboard.writeText('').catch(() => undefined)
        clipboard.clear()
        controllerOf(tab)?.toast(t('toast.clickfix', { host: hostOf(tab.url) }), true)
      })()
    }, 150)
  )
}

// ---------------------------------------------------------------- crypto mining

const hot = new Map<number, number>()
const warned = new Set<number>()

/**
 * A page that keeps the processor near full for 40 s is likely mining crypto (or stuck).
 * Background tabs doing it are put to sleep; the tab on screen gets one warning.
 */
function watchCpu(): void {
  if (!profile.settings.cryptoGuard) return
  // Electron reports CPU as a share of the whole machine; one busy core = 100 here
  const cores = availableParallelism()
  const metrics = new Map(app.getAppMetrics().map((m) => [m.pid, m.cpu.percentCPUUsage * cores]))
  for (const ctl of BrowserController.all.values()) {
    for (const tab of ctl.allTabs()) {
      const pid = tab.wc?.getOSProcessId()
      const cpu = pid ? (metrics.get(pid) ?? 0) : 0
      if (cpu < 85 || tab.audible || !/^https?:/.test(tab.url)) {
        hot.delete(tab.id)
        continue
      }
      const n = (hot.get(tab.id) ?? 0) + 1
      hot.set(tab.id, n)
      if (n < 4) continue
      hot.delete(tab.id)
      const host = hostOf(tab.url)
      if (!ctl.tabShown(tab)) {
        ctl.sleepTab(tab)
        ctl.toast(t('toast.cpuSlept', { host }), true)
      } else if (!warned.has(tab.id)) {
        warned.add(tab.id)
        ctl.toast(t('toast.cpuHot', { host }), true)
      }
    }
  }
}

/** Ask before downloading anything that can run code, or anything a site starts on its own. Cancel is the default. */
async function confirmDownload(info: DownloadInfo, source: WebContents | undefined, unprompted: boolean): Promise<boolean> {
  const tab = source ? Tab.fromWebContents(source.id) : undefined
  const ctl = (tab && controllerOf(tab)) || BrowserController.lastFocused
  if (ctl && !ctl.win.isDestroyed()) {
    return ctl.confirmDownload({
      filename: info.filename,
      source: info.source,
      size: info.total,
      kind: fileKind(info.filename),
      unprompted,
      deceptive: info.deceptive
    })
  }
  // no window to ask in (rare): fall back to the system dialog
  const size = info.total > 0 ? ` (${humanSize(info.total)})` : ''
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: BRAND,
    message: `${t('dlc.title')} ${info.filename}${size}`,
    detail: `${t('dlc.body', { source: info.source || t('dlc.internet') })}\n\n${t('dlc.advice')} ${t('dlc.steps')}`,
    buttons: [t('dlc.confirm'), t('common.cancel')],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  })
  return response === 0
}

function mediaKey(types: string[]): string {
  const video = types.includes('video')
  const audio = types.includes('audio')
  if (video && audio) return 'camera+microphone'
  if (video) return 'camera'
  return 'microphone'
}

function loadChrome(win: BrowserWindow): void {
  if (DEV_URL) void win.loadURL(`${DEV_URL}/index.html`)
  else void win.loadFile(join(RENDERER_DIR, 'index.html'))
}

// ---------------------------------------------------------------- session restore

function sessionChanged(): void {
  if (quitting || sessionTimer) return
  sessionTimer = setTimeout(() => {
    sessionTimer = null
    saveSession()
  }, 1000)
}

function saveSession(exclude?: BrowserController): void {
  const windows = [...BrowserController.all.values()].filter((c) => !c.isPrivate && c !== exclude && !c.win.isDestroyed())
  profile.saveSession(windows.map((c) => c.serialize()))
}

/**
 * Closing one of several windows forgets it; closing the last one keeps it so the
 * next launch picks up where the user left off.
 */
function windowClosing(ctl: BrowserController): void {
  if (quitting || ctl.isPrivate) return
  const others = [...BrowserController.all.values()].filter((c) => c !== ctl && !c.isPrivate)
  if (others.length) saveSession(ctl)
  else {
    saveSession()
    quitting = true
  }
}

app.on('before-quit', () => {
  ai?.dispose()
  if (!quitting) saveSession()
  quitting = true
  flushAllStores()
})

app.on('window-all-closed', () => {
  flushAllStores()
  if (process.platform !== 'darwin') app.quit()
  else quitting = false
})

// ---------------------------------------------------------------- tab sleeping

function sleepIdleTabs(): void {
  const settings = profile.settings
  const now = Date.now()
  const controllers = [...BrowserController.all.values()]

  if (settings.sleepAfterMinutes > 0) {
    const limit = settings.sleepAfterMinutes * 60_000
    for (const ctl of controllers) for (const tab of ctl.sleepCandidates()) if (now - tab.lastActive > limit) ctl.sleepTab(tab)
  }

  if (settings.memoryLimitMB > 0) {
    const report = perfReport(services)
    let overKB = report.totalKB - settings.memoryLimitMB * 1024
    if (overKB <= 0) return
    const memory = new Map(report.tabs.map((t) => [t.tabId, t.memoryKB]))
    const candidates = controllers
      .flatMap((ctl) => ctl.sleepCandidates().map((tab) => ({ ctl, tab })))
      .sort((a, b) => a.tab.lastActive - b.tab.lastActive)
    for (const { ctl, tab } of candidates) {
      if (overKB <= 0) break
      overKB -= memory.get(tab.id) ?? 0
      ctl.sleepTab(tab)
    }
  }
}

/** The browser was called Vela before: carry its data (bookmarks, history, AI model) over once. */
function migrateOldDataFolder(): void {
  const current = app.getPath('userData')
  const old = join(dirname(current), 'Vela')
  if (existsSync(current) || !existsSync(old)) return
  try {
    renameSync(old, current)
  } catch (err) {
    // another copy of the old app may still be running: start fresh and leave its folder alone
    console.warn('[migrate] could not move the old data folder', err)
  }
}
