import { app, BrowserWindow, dialog, ipcMain, nativeImage, session as electronSession, type IpcMainInvokeEvent } from 'electron'
import { createReadStream } from 'node:fs'
import { stat, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'
import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { BRAND, t } from '@shared/i18n'
import { LAB_CHANNELS, type LabApi, type Result } from '@shared/ipc'
import { BrowserController, type Services } from './window'
import { analyzeLink } from './linkcheck'
import { auditSite } from './audit'
import { copyPng } from './clip'
import type { BreachCheck } from './privacy'

/*
 * Halyard Lab: a window of its own with security tools (link and QR analysis, site audit,
 * password and file checks, decoders). Everything is defensive and runs on the user's
 * own links, files and open tabs; nothing here attacks or scans other people's systems.
 */

const BG = '#06100b'
let win: BrowserWindow | null = null

export interface LabDeps {
  svc: Services
  breach: BreachCheck
  devUrl?: string
  rendererDir: string
}

export function openLab(deps: LabDeps): void {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    win.focus()
    return
  }
  win = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 760,
    minHeight: 520,
    show: false,
    title: `${BRAND} Lab`,
    backgroundColor: BG,
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? undefined : { color: BG, symbolColor: '#9cf5c0', height: 40 },
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: join(__dirname, '../preload/lab.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })
  const wc = win.webContents
  // the Lab only ever shows its own page; links open in the browser, never in here
  wc.on('will-navigate', (e) => e.preventDefault())
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => (win = null))
  if (deps.devUrl) void win.loadURL(`${deps.devUrl}/lab.html`)
  else void win.loadFile(join(deps.rendererDir, 'lab.html'))
}

function fromLab(event: IpcMainInvokeEvent): void {
  if (!win || win.isDestroyed() || event.sender !== win.webContents || event.senderFrame !== event.sender.mainFrame) {
    throw new Error('Remetente não autorizado')
  }
}

const str = (v: unknown, max = 8192): string => {
  if (typeof v !== 'string') throw new Error('Argumento inválido')
  return v.slice(0, max)
}

function pngFrom(v: unknown) {
  const url = str(v, 4 * 1024 * 1024)
  if (!url.startsWith('data:image/png;base64,')) throw new Error('Argumento inválido')
  const img = nativeImage.createFromDataURL(url)
  if (img.isEmpty()) throw new Error('Argumento inválido')
  return img
}

/** The browser window to show things in (the last one used), opening one if needed. */
function browser(svc: Services): BrowserController {
  const ctl = BrowserController.lastFocused ?? [...BrowserController.all.values()].find((c) => !c.isPrivate)
  return ctl ?? svc.openWindow({ isPrivate: false })
}

async function hashFile(path: string): Promise<{ name: string; size: number; sha256: string; sha1: string; md5: string }> {
  if (!isAbsolute(path)) throw new Error('Argumento inválido')
  const info = await stat(path)
  if (!info.isFile()) throw new Error(t('lab.notFile'))
  const sha256 = createHash('sha256')
  const sha1 = createHash('sha1')
  const md5 = createHash('md5')
  for await (const chunk of createReadStream(path)) {
    sha256.update(chunk as Buffer)
    sha1.update(chunk as Buffer)
    md5.update(chunk as Buffer)
  }
  return { name: basename(path), size: info.size, sha256: sha256.digest('hex'), sha1: sha1.digest('hex'), md5: md5.digest('hex') }
}

export function registerLabIpc(deps: LabDeps): void {
  const { svc } = deps
  type Handler<F> = F extends (...args: infer A) => infer R ? (...args: A) => R | Promise<Awaited<R>> : never
  const handlers: { [K in keyof LabApi]: Handler<LabApi[K]> } = {
    'lab:analyze': (text) => analyzeLink(str(text, 4096), svc.guard),
    'lab:active': () => {
      const tab = BrowserController.lastFocused?.activeTab()
      if (!tab || !/^https?:/.test(tab.url)) return null
      return { url: tab.displayUrl, title: tab.info().title }
    },
    'lab:audit': (url) => {
      const tab = BrowserController.lastFocused?.activeTab() ?? undefined
      const target = url === null ? tab?.url : str(url, 4096)
      if (!target) throw new Error(t('lab.noPage'))
      const href = /^[a-z][a-z0-9+.-]*:/i.test(target) ? target : `https://${target}`
      return auditSite(href, { profile: svc.profile, tab })
    },
    'lab:breach': (sha1) => deps.breach.lookup(str(sha1, 40)),
    'lab:hash-file': (path) => hashFile(str(path, 4096)),
    'lab:dns': async (raw) => {
      let host = str(raw, 300).trim().toLowerCase()
      try {
        if (/^[a-z][a-z0-9+.-]*:\/\//.test(host)) host = new URL(host).hostname
      } catch {
        /* keep what was typed */
      }
      host = host.replace(/^\[|\]$/g, '').replace(/\/.*$/, '')
      if (!host || (!isIP(host) && !/^[a-z0-9.-]+$/.test(host))) throw new Error(t('lab.badHost'))
      const verdict = svc.guard.check(`https://${host}/`)
      // a host on the malware or phishing lists is not even looked up
      if (verdict && (verdict.kind === 'malware' || verdict.kind === 'phishing')) return { addresses: [], listed: verdict.kind }
      const res = await electronSession.defaultSession.resolveHost(host)
      return { addresses: res.endpoints.map((e) => ({ address: e.address, family: e.family })), listed: verdict?.kind ?? null }
    },
    'lab:open': (url, disposable) => {
      const u = new URL(str(url, 4096))
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Argumento inválido')
      const ctl = browser(svc)
      if (disposable === true && !ctl.isPrivate) ctl.createContainerTab(u.href)
      else ctl.createTab(u.href)
      ctl.win.focus()
    },
    'lab:copy-image': (dataUrl) => copyPng(pngFrom(dataUrl).toPNG()),
    'lab:save-image': async (dataUrl, name) => {
      const img = pngFrom(dataUrl)
      const safe = str(name, 80).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'QR Code'
      const opts = { defaultPath: join(app.getPath('downloads'), `${safe}.png`), filters: [{ name: 'PNG', extensions: ['png'] }] }
      const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      if (res.canceled || !res.filePath) return false
      await writeFile(res.filePath, img.toPNG())
      return true
    },
    'lab:settings': () => svc.profile.settings
  }

  for (const channel of LAB_CHANNELS) {
    const handler = handlers[channel] as (...a: unknown[]) => unknown
    ipcMain.handle(channel, async (event, ...args: unknown[]): Promise<Result<unknown>> => {
      try {
        fromLab(event)
        return { ok: true, data: await handler(...args) }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    })
  }
}

/** Tell the Lab the language or theme changed. */
export function labSettingsChanged(): void {
  if (win && !win.isDestroyed()) win.webContents.send('lab-settings')
}
