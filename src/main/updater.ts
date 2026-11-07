import { app, shell } from 'electron'
import { EventEmitter } from 'node:events'
import electronUpdater from 'electron-updater'
import type { UpdateState } from '@shared/types'
import pkg from '../../package.json'

/*
 * Automatic updates from GitHub Releases (electron-updater).
 * - Installed copy (setup.exe): new versions download in the background and install
 *   when Halyard closes, or right away from Settings › About.
 * - Portable copy: it can't replace itself, so Halyard only tells the user a new version
 *   exists and opens the download page.
 * Every update file is checked against the SHA-512 listed in the release before it runs.
 * The repository comes from "repository" in package.json (electron-builder reads the same field).
 */

const { autoUpdater } = electronUpdater
const FIRST_CHECK_MS = 15_000
const EVERY_MS = 4 * 60 * 60 * 1000

/** "github:owner/repo" or "https://github.com/owner/repo(.git)" → page with the latest release. */
export function releasesPage(): string | null {
  const raw = typeof pkg.repository === 'string' ? pkg.repository : (pkg.repository as { url?: string } | undefined)?.url ?? ''
  const m = /github(?:\.com[/:]|:)([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(raw)
  if (!m || m[1] === 'SEU-USUARIO-GITHUB') return null
  return `https://github.com/${m[1]}/${m[2]}/releases/latest`
}

export class Updater extends EventEmitter {
  private state: UpdateState
  private readonly portable = !!process.env.PORTABLE_EXECUTABLE_DIR

  constructor(private readonly notify: (kind: 'ready' | 'portable', version: string) => void) {
    super()
    const configured = app.isPackaged && process.platform === 'win32' && releasesPage() !== null
    this.state = { status: configured ? 'idle' : 'disabled', current: app.getVersion(), portable: this.portable }
    if (!configured) return

    autoUpdater.autoDownload = !this.portable
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowPrerelease = false
    autoUpdater.allowDowngrade = false
    autoUpdater.logger = null

    autoUpdater.on('checking-for-update', () => this.set({ status: 'checking' }))
    autoUpdater.on('update-not-available', () => this.set({ status: 'latest', checkedAt: Date.now() }))
    autoUpdater.on('update-available', (info) => {
      this.set({ status: this.portable ? 'available' : 'downloading', version: info.version, percent: 0, checkedAt: Date.now() })
      if (this.portable) this.notify('portable', info.version)
    })
    autoUpdater.on('download-progress', (p) => this.set({ status: 'downloading', percent: Math.round(p.percent) }))
    autoUpdater.on('update-downloaded', (info) => {
      this.set({ status: 'ready', version: info.version, percent: 100 })
      this.notify('ready', info.version)
    })
    autoUpdater.on('error', (err) => {
      console.warn('[update]', err?.message ?? err)
      this.set({ status: 'error' })
    })

    setTimeout(() => void this.check(), FIRST_CHECK_MS).unref()
    setInterval(() => void this.check(), EVERY_MS).unref()
  }

  private set(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch }
    this.emit('change', this.state)
  }

  get current(): UpdateState {
    return this.state
  }

  async check(): Promise<UpdateState> {
    if (this.state.status === 'disabled' || this.state.status === 'downloading' || this.state.status === 'ready') return this.state
    try {
      await autoUpdater.checkForUpdates()
    } catch {
      /* reported through the 'error' event */
    }
    return this.state
  }

  /** Installed copy: restart into the new version. Portable copy: open the download page. */
  install(): void {
    if (this.state.status === 'ready' && !this.portable) {
      // silent install, then start Halyard again
      setImmediate(() => autoUpdater.quitAndInstall(true, true))
      return
    }
    const page = releasesPage()
    if (page) void shell.openExternal(page)
  }
}
