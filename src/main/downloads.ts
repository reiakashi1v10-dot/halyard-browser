import { app, shell, type DownloadItem, type Session, type WebContents } from 'electron'
import { createReadStream, existsSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { DownloadInfo } from '@shared/types'
import { deleteFile, isRiskyFile, markOfTheWeb, scanFile } from './scanner'
import { inspectZip } from './archive'

export interface DownloadHooks {
  onChange(list: DownloadInfo[]): void
  /** Bytes started flowing (after the user agreed, for risky files): show the progress. */
  began(info: DownloadInfo): void
  /** The file comes from a host on a malware list: refuse it outright. */
  isDangerous(url: string): boolean
  /** Ask the user before downloading a file that can run code, or one the site started on its own. */
  confirm(info: DownloadInfo, source: WebContents | undefined, unprompted: boolean): Promise<boolean>
  /** Show the "save as" window for every download. */
  askWhere(): boolean
  /**
   * The site started this download without the user clicking or typing anything
   * (a "drive-by" download). Unknown sources count as the user's own.
   */
  unprompted(source: WebContents | undefined, chain: string[]): boolean
  /** The user chose to refuse this kind of file outright (programs and scripts). */
  refuse(filename: string): boolean
  /** Report the antivirus verdict to the user. */
  scanned(info: DownloadInfo): void
}

/**
 * Tracks downloads from every session. By default the user picks where each file goes;
 * otherwise it is saved straight to the Downloads folder.
 * Files that can run code (installers, scripts, archives) and files a site starts on its
 * own are paused until the user confirms; code is then scanned with Microsoft Defender
 * before it can be opened. Every finished file gets the Mark of the Web and a SHA-256.
 */
export class Downloads {
  private items = new Map<string, { info: DownloadInfo; item: DownloadItem | null }>()
  private sessions = new WeakSet<Session>()
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly hooks: DownloadHooks) {}

  attach(session: Session): void {
    if (this.sessions.has(session)) return
    this.sessions.add(session)
    session.on('will-download', (_event, item, webContents) => this.track(item, webContents))
  }

  private track(item: DownloadItem, source: WebContents | undefined): void {
    const chain = [item.getURL(), ...item.getURLChain()]
    if (chain.some((u) => this.hooks.isDangerous(u))) {
      item.cancel()
      return
    }

    // BIDI tricks are removed first so "fatura‮fdp.exe" is judged as the .exe it is
    if (this.hooks.refuse(item.getFilename().replace(BIDI, '').trim())) {
      item.cancel()
      return
    }

    const referrer = source && !source.isDestroyed() ? source.getURL() : undefined
    const unprompted = this.hooks.unprompted(source, chain)
    const deceptive = deceptiveName(item.getFilename())
    // a download the site forced on you is held in the Downloads folder until you agree
    const ask = this.hooks.askWhere() && !unprompted
    const path = uniquePath(app.getPath('downloads'), item.getFilename() || 'download')
    if (ask) item.setSaveDialogOptions({ defaultPath: path })
    else item.setSavePath(path)
    const info: DownloadInfo = {
      id: randomUUID(),
      filename: basename(path),
      path,
      url: item.getURL(),
      source: sourceHost(item, source),
      received: 0,
      total: item.getTotalBytes(),
      status: 'progressing',
      startedAt: Date.now(),
      speed: 0,
      risky: isRiskyFile(path),
      scan: 'none',
      deceptive: deceptive || undefined
    }
    // with "ask where to save", the entry appears once a place is chosen
    let shown = !ask
    let gated = false
    if (shown) this.items.set(info.id, { info, item })

    /** The user's answer for a held file (null: nothing was asked). */
    let decision: Promise<boolean> | null = null

    /** Hold risky or unprompted files until the user agrees. Runs once the save path is known. */
    const gate = (): void => {
      if (gated) return
      gated = true
      const needsOk = info.risky || unprompted || deceptive
      if (!needsOk) {
        this.hooks.began(info)
        return
      }
      info.scan = 'awaiting-confirmation'
      item.pause()
      decision = this.hooks.confirm(info, source, unprompted)
      void decision.then((ok) => {
        // small files can finish before the answer: see 'done'
        if (item.getState() !== 'progressing') return
        if (!ok) {
          info.scan = 'none'
          item.cancel()
          return
        }
        info.scan = info.risky ? 'pending' : 'none'
        item.resume()
        this.emitNow()
        this.hooks.began(info)
      })
    }

    /** The user picked a place in the save window. */
    const adopt = (): boolean => {
      const chosen = item.getSavePath()
      if (!chosen) return false
      if (chosen !== info.path) {
        info.path = chosen
        info.filename = basename(chosen)
        info.risky = isRiskyFile(chosen)
      }
      if (!shown) {
        shown = true
        this.items.set(info.id, { info, item })
      }
      return true
    }

    let lastBytes = 0
    let lastTime = Date.now()
    item.on('updated', (_e, state) => {
      if (ask && !adopt()) return
      if (!gated) gate()
      info.received = item.getReceivedBytes()
      const now = Date.now()
      if (now - lastTime >= 400) {
        const rate = ((info.received - lastBytes) * 1000) / (now - lastTime)
        info.speed = info.speed ? info.speed * 0.6 + rate * 0.4 : rate
        lastBytes = info.received
        lastTime = now
      }
      info.total = item.getTotalBytes()
      info.status = state === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'progressing'
      this.emitSoon()
    })
    item.once('done', (_e, state) => {
      if (ask) adopt()
      if (!shown) return // the save window was cancelled
      info.received = item.getReceivedBytes()
      info.speed = 0
      info.status = state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'interrupted'
      const entry = this.items.get(info.id)
      if (entry) entry.item = null
      if (info.status === 'completed') {
        // tiny files can finish before any progress event: they were chosen in the save window
        if (!gated) {
          gated = true
          this.hooks.began(info)
        }
        const url = item.getURL()
        if (info.scan === 'awaiting-confirmation' && decision) {
          // it arrived before the user answered: mark it as from the internet now, keep it closed,
          // and delete it if the answer is no
          void markOfTheWeb(info.path, url, referrer)
          void decision.then(async (ok) => {
            if (!ok) {
              await deleteFile(info.path)
              info.scan = 'none'
              info.status = 'cancelled'
              this.emitNow()
              return
            }
            info.scan = info.risky ? 'pending' : 'none'
            this.hooks.began(info)
            void this.afterComplete(info, url, referrer)
          })
        } else {
          if (info.risky && info.scan === 'none') info.scan = 'pending'
          void this.afterComplete(info, url, referrer)
        }
      } else if (info.scan === 'awaiting-confirmation') info.scan = 'none'
      this.emitNow()
    })

    if (!ask) {
      gate()
      this.emitNow()
    }
  }

  private async afterComplete(info: DownloadInfo, url: string, referrer?: string): Promise<void> {
    // Windows then treats the file as "from the internet" (SmartScreen, Office Protected View)
    await markOfTheWeb(info.path, url, referrer)
    info.sha256 = await sha256(info.path).catch(() => undefined)
    this.emitNow()
    if (!info.risky) return
    if (/\.zip$/i.test(info.path)) {
      const inside = await inspectZip(info.path)
      if (inside && (inside.riskyCount || inside.encrypted)) info.inside = inside
    }
    info.scan = 'scanning'
    this.emitNow()
    const result = await scanFile(info.path)
    info.scan = result
    if (result === 'infected') await deleteFile(info.path)
    this.emitNow()
    this.hooks.scanned(info)
  }

  list(): DownloadInfo[] {
    return [...this.items.values()].map((e) => ({ ...e.info })).sort((a, b) => b.startedAt - a.startedAt)
  }

  get activeCount(): number {
    return [...this.items.values()].filter((e) => e.info.status === 'progressing').length
  }

  /** Files that were not cleared by the scan stay closed. */
  private openable(info: DownloadInfo): boolean {
    return (
      info.status === 'completed' &&
      !['scanning', 'pending', 'infected', 'awaiting-confirmation'].includes(info.scan) &&
      existsSync(info.path)
    )
  }

  open(id: string): void {
    const entry = this.items.get(id)
    if (entry && this.openable(entry.info)) void shell.openPath(entry.info.path)
  }

  show(id: string): void {
    const entry = this.items.get(id)
    if (entry && entry.info.scan !== 'infected' && existsSync(entry.info.path)) shell.showItemInFolder(entry.info.path)
  }

  cancel(id: string): void {
    this.items.get(id)?.item?.cancel()
  }

  clearFinished(): void {
    for (const [id, e] of this.items) if (e.info.status !== 'progressing' && e.info.status !== 'paused') this.items.delete(id)
    this.emitNow()
  }

  private emitSoon(): void {
    if (this.timer) return
    this.timer = setTimeout(() => this.emitNow(), 250)
  }

  private emitNow(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.hooks.onChange(this.list())
  }
}

function sourceHost(item: DownloadItem, source: WebContents | undefined): string {
  const candidates = [source && !source.isDestroyed() ? source.getURL() : '', item.getURL()]
  for (const c of candidates) {
    try {
      const u = new URL(c)
      if (u.protocol === 'http:' || u.protocol === 'https:') return u.hostname.replace(/^www\./, '')
    } catch {
      /* try the next one */
    }
  }
  return ''
}

/** Characters that flip how text is shown: "fatura\u202Efdp.exe" looks like "faturaexe.pdf". */
const BIDI = /[\u202a-\u202e\u2066-\u2069\u200e\u200f\u061c]/g
const LOOKS_SAFE = /\.(pdf|docx?|xlsx?|pptx?|odt|rtf|txt|csv|jpe?g|png|gif|webp|heic|mp3|mp4|avi|mov|mkv|wav|zip|rar|7z|html?)\s*\.(exe|scr|com|bat|cmd|pif|js|jse|vbs|vbe|wsf|wsh|hta|msi|msp|lnk|ps1|psm1|cpl|jar|reg|iso|img|vhdx?)$/i

/**
 * A name built to hide what the file really is: reversed text, a second extension
 * ("boleto.pdf.exe") or a long run of spaces pushing the real one out of sight.
 */
export function deceptiveName(name: string): boolean {
  BIDI.lastIndex = 0
  return BIDI.test(name) || LOOKS_SAFE.test(name) || /\s{4,}\.[a-z0-9]{2,5}$/i.test(name)
}

function uniquePath(dir: string, filename: string): string {
  // reversed-text tricks are removed so the real extension shows
  let safe = filename.replace(BIDI, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s{2,}/g, ' ').slice(0, 200)
  // "..", ".hidden", "name. " and names Windows reserves (CON, NUL, COM1...) never reach the disk as-is
  safe = safe.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '')
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(safe)) safe = `_${safe}`
  if (!safe) safe = 'download'
  const ext = extname(safe)
  const stem = safe.slice(0, safe.length - ext.length)
  let candidate = join(dir, safe)
  for (let i = 1; existsSync(candidate); i++) candidate = join(dir, `${stem} (${i})${ext}`)
  return candidate
}

/** Fingerprint of the file, so it can be checked against the one the publisher lists. */
async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}
