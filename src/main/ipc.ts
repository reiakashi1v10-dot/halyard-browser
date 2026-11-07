import { app, BrowserWindow, dialog, ipcMain, nativeImage, session as electronSession, type IpcMainInvokeEvent } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { InternalApi, Result, UiApi } from '@shared/ipc'
import { COMMANDS } from '@shared/commands'
import type { Command, Settings } from '@shared/types'
import { BrowserController, type Services } from './window'
import { Tab } from './tab'
import { resolveInput } from './url'
import { MODEL } from './ai'
import { openRansomwareSettings, ransomwareStatus } from './ransomware'
import { openWindowsSecurity, quickScan, windowsSecurity } from './winsec'
import { allowHttp } from './privacy'
import { analyzeLink } from './linkcheck'
import { copyPng } from './clip'

type Handler<F> = F extends (...args: infer A) => infer R ? (ctl: BrowserController, ...args: A) => R | Promise<Awaited<R>> : never

function wrap<T>(fn: () => T | Promise<T>): Promise<Result<T>> {
  return Promise.resolve()
    .then(fn)
    .then((data) => ({ ok: true as const, data }))
    .catch((err: unknown) => {
      console.error('[ipc]', err)
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    })
}

/** The browser UI: only the chrome webContents of a known window may call these. */
function controllerForChrome(event: IpcMainInvokeEvent): BrowserController {
  const win = BrowserWindow.fromWebContents(event.sender)
  const ctl = win ? BrowserController.all.get(win.id) : undefined
  if (!ctl || ctl.win.webContents !== event.sender) throw new Error('Remetente não autorizado')
  return ctl
}

/** halyard:// pages: the main frame of a tab whose document is an internal page. */
function controllerForInternal(event: IpcMainInvokeEvent): BrowserController {
  const frame = event.senderFrame
  if (!frame || frame !== event.sender.mainFrame || !frame.url.startsWith('halyard://')) throw new Error('Remetente não autorizado')
  const tab = Tab.fromWebContents(event.sender.id)
  if (!tab) throw new Error('Remetente não autorizado')
  for (const ctl of BrowserController.all.values()) if (ctl.allTabs().includes(tab)) return ctl
  throw new Error('Remetente não autorizado')
}

const str = (v: unknown, max = 8192): string => {
  if (typeof v !== 'string') throw new Error('Argumento inválido')
  return v.slice(0, max)
}
const num = (v: unknown): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('Argumento inválido')
  return v
}
const bool = (v: unknown): boolean => v === true
/** Passwords: a string of sane length. Too long is rejected, not cut, so it never silently changes. */
const secret = (v: unknown): string => {
  if (typeof v !== 'string' || v.length > 1024) throw new Error('Argumento inválido')
  return v
}

// The internal handler being served right now (handlers run synchronously up to their first await).
let currentInternalEvent: IpcMainInvokeEvent | null = null

export function registerIpc(svc: Services): void {
  const ui: { [K in keyof UiApi]: Handler<UiApi[K]> } = {
    'state:get': (ctl) => ctl.state(),
    'cmd:run': (ctl, command) => {
      if (!(command in COMMANDS)) throw new Error('Comando desconhecido')
      ctl.run(command as Command)
    },
    'tab:create': (ctl, url, opts) =>
      ctl.createTab(url ? resolveInput(str(url), svc.profile.settings.searchEngine) : undefined, {
        background: bool(opts?.background),
        spaceId: typeof opts?.spaceId === 'string' ? opts.spaceId : undefined
      }).id,
    'tab:activate': (ctl, id) => ctl.activate(num(id)),
    'tab:close': (ctl, id) => ctl.closeTab(num(id)),
    'tab:move': (ctl, id, to, pinned) => ctl.moveTab(num(id), num(to), bool(pinned)),
    'tab:menu': (ctl, id) => ctl.showTabMenu(num(id)),
    'tab:mute': (ctl, id) => {
      const tab = ctl.allTabs().find((t) => t.id === num(id))
      tab?.setMuted(!tab.muted)
    },
    'tab:wake': (ctl, id) => ctl.allTabs().find((t) => t.id === num(id))?.wake(),
    'tab:sleep': (ctl, id) => {
      const tab = ctl.allTabs().find((t) => t.id === num(id))
      if (tab) ctl.sleepTab(tab)
    },
    'nav:go': (ctl, input, where) => ctl.navigate(str(input), where === 'new' ? 'new' : 'current'),
    'palette:query': (ctl, q, withSuggestions) => ctl.paletteQuery(str(q, 500), bool(withSuggestions)),
    'space:create': (ctl) => {
      if (ctl.isPrivate) throw new Error('Janelas privadas têm um único espaço')
      const space = svc.profile.createSpace()
      ctl.activateSpace(space.id)
      return space
    },
    'space:update': (_ctl, id, patch) => svc.profile.updateSpace(str(id), patch ?? {}),
    'space:delete': (_ctl, id) => {
      const target = svc.profile.spaces.find((s) => s.id !== id)
      if (!target) return
      for (const c of BrowserController.all.values()) c.moveSpaceTabs(str(id), target.id)
      svc.profile.deleteSpace(str(id))
    },
    'space:activate': (ctl, id) => ctl.activateSpace(str(id)),
    'space:menu': (ctl, id) => ctl.showSpaceMenu(str(id)),
    'split:ratio': (ctl, r) => ctl.setSplitRatio(num(r)),
    'split:close': (ctl) => ctl.toggleSplit(),
    'split:swap': (ctl) => ctl.swapSplit(),
    'ui:bounds': (ctl, insets) =>
      ctl.setInsets({ left: num(insets.left), top: num(insets.top), right: num(insets.right), bottom: num(insets.bottom) }),
    'ui:freeze': (ctl) => ctl.freeze(),
    'ui:hide-views': (ctl, hidden) => ctl.setViewsHidden(bool(hidden)),
    'ui:chrome-colors': (ctl, bg, fg) => {
      const color = /^#[0-9a-f]{6}$/i
      if (process.platform !== 'darwin' && color.test(str(bg)) && color.test(str(fg))) {
        ctl.win.setTitleBarOverlay({ color: bg, symbolColor: fg, height: 36 })
        ctl.win.setBackgroundColor(bg)
      }
    },
    'ui:sidebar-width': (_ctl, w) => void svc.profile.updateSettings({ sidebarWidth: Math.round(num(w)) }),
    'find:query': (ctl, text, opts) => ctl.findInPage(str(text, 500), { forward: opts?.forward !== false, findNext: bool(opts?.findNext) }),
    'find:close': (ctl) => ctl.closeFind(),
    'site:info': (ctl) => ctl.siteInfo(),
    'site:toggle-adblock': (ctl) => ctl.toggleSiteAdblock(),
    'site:toggle-scripts': (ctl) => ctl.toggleSiteScripts(),
    'site:clear-permission': (ctl, p) => ctl.clearSitePermission(str(p)),
    'prompt:respond': (ctl, id, allow, remember) => ctl.respondPrompt(num(id), bool(allow), bool(remember)),
    'downloads:list': () => svc.downloads.list(),
    'downloads:open': (_c, id) => svc.downloads.open(str(id)),
    'downloads:show': (_c, id) => svc.downloads.show(str(id)),
    'downloads:cancel': (_c, id) => svc.downloads.cancel(str(id)),
    'downloads:clear': () => svc.downloads.clearFinished(),
    'perf:report': () => perfReport(svc),
    'perf:set-limit': (_c, mb) => void svc.profile.updateSettings({ memoryLimitMB: Math.round(num(mb)) }),
    'bookmark:toggle': (ctl) => ctl.toggleBookmark(),
    'bookmark:is': (_c, url) => svc.profile.isBookmarked(str(url)),
    'settings:get': () => svc.profile.settings,
    'win:minimize': (ctl) => ctl.win.minimize(),
    'win:maximize': (ctl) => (ctl.win.isMaximized() ? ctl.win.unmaximize() : ctl.win.maximize()),
    'win:close': (ctl) => ctl.win.close(),
    'app:menu': (ctl, x, y) => ctl.showAppMenu(num(x), num(y)),
    'tab:translate-menu': (ctl, x, y) => ctl.showTranslateMenu(num(x), num(y)),
    'menu:pick': (ctl, menuId, itemId) => ctl.pickMenu(num(menuId), itemId === null ? null : str(itemId, 20)),
    'download:decide': (ctl, id, ok) => ctl.decideDownload(num(id), bool(ok)),
    'settings:set': (_ctl, patch) => svc.profile.updateSettings(sanitizeSettings(patch)),
    'account:get': () => svc.account.state(),
    'account:sign-in': (_c, email, password) => svc.account.signIn(str(email, 254), secret(password)),
    'account:sign-up': (_c, email, password, name) => svc.account.signUp(str(email, 254), secret(password), str(name ?? '', 40)),
    'account:resend': (_c, email) => svc.account.resend(str(email, 254)),
    'account:sign-out': () => svc.account.signOut(),
    'agent:get': (ctl) => ctl.agent.state(),
    'agent:download': () => void svc.ai.startDownload(),
    'agent:cancel-download': () => svc.ai.cancelDownload(),
    'agent:retry': () => svc.ai.refresh(),
    // the run takes minutes: answer now, progress arrives as 'agent' events
    'agent:run': (ctl, goal) => void ctl.agent.run(str(goal, 1000)),
    'agent:stop': (ctl) => ctl.agent.stop(),
    'agent:confirm': (ctl, id, allow) => ctl.agent.answer(num(id), bool(allow)),
    'agent:clear': (ctl) => ctl.agent.clear(),
    'qr:analyze': (_c, text) => analyzeLink(str(text, 4096), svc.guard),
    'qr:open': (ctl, url, disposable) => {
      const u = new URL(str(url, 4096))
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Argumento inválido')
      if (bool(disposable) && !ctl.isPrivate) ctl.createContainerTab(u.href)
      else ctl.createTab(u.href)
    },
    'qr:copy-image': (_c, dataUrl) => copyPng(pngImage(dataUrl).toPNG()),
    'qr:save-image': async (ctl, dataUrl, name) => {
      const img = pngImage(dataUrl)
      const safe = str(name, 80).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'QR Code'
      const res = await dialog.showSaveDialog(ctl.win, {
        defaultPath: join(app.getPath('downloads'), `${safe}.png`),
        filters: [{ name: 'PNG', extensions: ['png'] }]
      })
      if (res.canceled || !res.filePath) return false
      await writeFile(res.filePath, img.toPNG())
      return true
    }
  }

  for (const [channel, handler] of Object.entries(ui)) {
    ipcMain.handle(channel, (event, ...args: unknown[]) =>
      wrap(() => (handler as (ctl: BrowserController, ...a: unknown[]) => unknown)(controllerForChrome(event), ...args))
    )
  }

  const internal: { [K in keyof InternalApi]: Handler<InternalApi[K]> } = {
    'internal:settings': () => svc.profile.settings,
    'internal:set-settings': (_c, patch) => svc.profile.updateSettings(sanitizeSettings(patch)),
    'internal:history': (ctl, q, limit) => (ctl.isPrivate ? [] : svc.profile.searchHistory(str(q, 500), Math.min(2000, num(limit)))),
    'internal:history-delete': (_c, url) => svc.profile.deleteHistory(url === null ? null : str(url)),
    'internal:bookmarks': () => svc.profile.bookmarks,
    'internal:bookmark-remove': (_c, id) => svc.profile.removeBookmark(str(id)),
    'internal:bookmark-rename': (_c, id, title) => svc.profile.renameBookmark(str(id), str(title, 300)),
    'internal:top-sites': (ctl) => (ctl.isPrivate ? [] : svc.profile.topSites(8)),
    'internal:resolve': (_c, input) => resolveInput(str(input, 2000), svc.profile.settings.searchEngine, svc.profile.settings.httpsOnly),
    'internal:stats': () => {
      const tabs = [...BrowserController.all.values()].flatMap((c) => c.allTabs())
      const g = svc.guard.stats
      return {
        blocked: svc.profile.totalBlocked,
        sleepingTabs: tabs.filter((t) => t.sleeping).length,
        openTabs: tabs.length,
        threatHosts: g.malware + g.phishing,
        threatsBlocked: svc.profile.threatsBlocked
      }
    },
    'internal:clear-data': async (_c, what) => {
      if (what?.history) svc.profile.deleteHistory(null)
      const ses = electronSession.defaultSession
      if (what?.cache) await ses.clearCache()
      if (what?.cookies) await ses.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'] })
    },
    'internal:guard-proceed': (_c, url, remember) => {
      const host = new URL(str(url)).hostname
      // only look-alike warnings can be remembered; malware and phishing ask again next run
      const verdict = svc.guard.check(str(url))
      svc.guard.allow(host, bool(remember) && (verdict?.kind === 'typo' || verdict?.kind === 'homograph'))
    },
    'internal:allow-http': (_c, url) => {
      const u = new URL(str(url))
      if (u.protocol !== 'http:') throw new Error('Argumento inválido')
      allowHttp(u.hostname)
    },
    'internal:permissions': () => svc.profile.listPermissions(),
    'internal:permission-remove': (_c, origin, permission) => svc.profile.setPermission(str(origin), str(permission), null),
    'internal:downloads': () => svc.downloads.list(),
    'internal:open-download': (_c, id) => svc.downloads.open(str(id)),
    'internal:show-download': (_c, id) => svc.downloads.show(str(id)),
    'internal:theme': (ctl) => {
      const event = currentInternalEvent
      const tab = event ? Tab.fromWebContents(event.sender.id) : undefined
      const space = ctl.spaces().find((s) => s.id === tab?.spaceId) ?? ctl.spaces()[0]
      return { hue: space?.hue ?? 262, isPrivate: ctl.isPrivate }
    },
    'internal:account': () => svc.account.state(),
    'internal:account-open': (ctl) => ctl.uiAction({ action: 'account' }),
    'internal:sign-out': () => svc.account.signOut(),
    'internal:ai': () => ({ status: svc.ai.state(), size: MODEL.size }),
    'internal:ai-remove': () => svc.ai.remove(),
    'internal:ransomware': () => ransomwareStatus(),
    'internal:open-ransomware': () => openRansomwareSettings(),
    'internal:winsec': () => windowsSecurity(),
    'internal:open-winsec': (_ctl, id) => openWindowsSecurity(str(id)),
    'internal:quick-scan': () => quickScan(),
    'internal:update': () => svc.updater.current,
    'internal:update-check': () => svc.updater.check(),
    'internal:update-install': () => svc.updater.install(),
    'internal:open-legal': (ctl, doc) => {
      const name = str(doc)
      if (['privacy', 'terms', 'licenses'].includes(name)) ctl.createTab(`halyard://legal/?doc=${name}`)
    },
    'internal:open-lab': () => svc.openLab(),
    // answers right away; the confirmation window then takes over
    'internal:panic': (ctl) => void svc.panic(ctl),
    'internal:version': () => ({
      app: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node
    })
  }

  for (const [channel, handler] of Object.entries(internal)) {
    ipcMain.handle(channel, (event, ...args: unknown[]) =>
      wrap(() => {
        const ctl = controllerForInternal(event)
        currentInternalEvent = event
        try {
          return (handler as (ctl: BrowserController, ...a: unknown[]) => unknown)(ctl, ...args)
        } finally {
          currentInternalEvent = null
        }
      })
    )
  }
}

/** A PNG the window UI drew (QR Codes): nothing else is accepted. */
function pngImage(v: unknown) {
  const url = str(v, 4 * 1024 * 1024)
  if (!url.startsWith('data:image/png;base64,')) throw new Error('Argumento inválido')
  const img = nativeImage.createFromDataURL(url)
  if (img.isEmpty()) throw new Error('Argumento inválido')
  return img
}

function sanitizeSettings(patch: unknown): Partial<Settings> {
  if (typeof patch !== 'object' || patch === null) return {}
  const p = { ...(patch as Partial<Settings>) }
  if (p.allowlist) p.allowlist = p.allowlist.filter((h) => typeof h === 'string').map((h) => h.slice(0, 253)).slice(0, 1000)
  if (p.scriptSites) p.scriptSites = p.scriptSites.filter((h) => typeof h === 'string').map((h) => h.slice(0, 253)).slice(0, 1000)
  if (p.userName != null) p.userName = String(p.userName).slice(0, 40)
  // the account email is set by the sign-in flow only
  delete p.email
  return p
}

export function perfReport(svc: Services) {
  const metrics = app.getAppMetrics()
  const byPid = new Map(metrics.map((m) => [m.pid, m]))
  const tabs = [...BrowserController.all.values()].flatMap((c) => c.allTabs())
  const tabPids = new Set<number>()
  const rows = tabs.map((t) => {
    const pid = t.wc?.getOSProcessId()
    if (pid) tabPids.add(pid)
    const m = pid ? byPid.get(pid) : undefined
    const info = t.info()
    return {
      tabId: t.id,
      title: info.title,
      favicon: info.favicon,
      memoryKB: m?.memory.workingSetSize ?? 0,
      cpu: m ? Math.round(m.cpu.percentCPUUsage * 10) / 10 : 0,
      sleeping: t.sleeping
    }
  })
  const totalKB = metrics.reduce((sum, m) => sum + m.memory.workingSetSize, 0)
  const browserKB = metrics.filter((m) => !tabPids.has(m.pid)).reduce((sum, m) => sum + m.memory.workingSetSize, 0)
  return {
    totalKB,
    browserKB,
    tabs: rows.sort((a, b) => b.memoryKB - a.memoryKB),
    sleepingCount: rows.filter((r) => r.sleeping).length,
    limitMB: svc.profile.settings.memoryLimitMB
  }
}
