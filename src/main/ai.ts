import { app, session as electronSession, utilityProcess, type UtilityProcess } from 'electron'
import { createHash } from 'node:crypto'
import { EventEmitter, once } from 'node:events'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat, statfs } from 'node:fs/promises'
import { join } from 'node:path'
import type { AiModelStatus } from '@shared/types'
import type { WorkerReply, WorkerRequest } from './ai-worker'

/*
 * The local AI: one open model, downloaded once by the user from Hugging Face and checked
 * against a pinned SHA-256, then run on this computer by llama.cpp in a separate process.
 * Nothing the user browses is sent anywhere.
 */

const RELEASE_MODEL = {
  name: 'Qwen3 4B Instruct 2507',
  license: 'Apache-2.0',
  file: 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf',
  // pinned to one revision of the repository, so the file can never silently change
  url: 'https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/a06e946bb6b655725eafa393f4a9745d460374c9/Qwen3-4B-Instruct-2507-Q4_K_M.gguf',
  size: 2497281120,
  sha256: '3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597'
}

/** Development builds only: test the download with a small local file (never in the .exe). */
function testModel(): typeof RELEASE_MODEL | null {
  const raw = app.isPackaged ? undefined : process.env.HALYARD_TEST_MODEL
  if (!raw) return null
  try {
    const m = JSON.parse(raw) as Partial<typeof RELEASE_MODEL>
    if (typeof m.url === 'string' && /^http:\/\/127\.0\.0\.1:\d+\//.test(m.url) && typeof m.size === 'number' && typeof m.sha256 === 'string' && typeof m.file === 'string' && /^test-[\w.-]+$/.test(m.file))
      return { ...RELEASE_MODEL, ...m }
  } catch {
    /* ignore */
  }
  return null
}

export const MODEL: Readonly<typeof RELEASE_MODEL> = testModel() ?? RELEASE_MODEL

/** Unload the model after this long without use: it holds ~3 GB of memory. */
const IDLE_MS = 5 * 60 * 1000
const SPARE_DISK = 300 * 1024 * 1024

export interface CompleteRequest {
  system: string
  prompt: string
  schema: object
  maxTokens: number
}

export class AiEngine extends EventEmitter<{ change: [AiModelStatus] }> {
  private status: AiModelStatus = { kind: 'missing', size: MODEL.size, partial: 0 }
  private download: AbortController | null = null
  private worker: UtilityProcess | null = null
  private starting: Promise<void> | null = null
  private pending = new Map<number, { resolve: (text: string) => void; reject: (err: Error) => void }>()
  private seq = 1
  private idleTimer: NodeJS.Timeout | null = null

  constructor() {
    super()
    void this.refresh()
  }

  private get dir(): string {
    return join(app.getPath('userData'), 'ai')
  }

  private get path(): string {
    return join(this.dir, MODEL.file)
  }

  state(): AiModelStatus {
    return this.status
  }

  private set(status: AiModelStatus): void {
    this.status = status
    this.emit('change', status)
  }

  /** Look at what is on disk. */
  async refresh(): Promise<void> {
    if (this.download) return
    const full = await stat(this.path).catch(() => null)
    if (full?.size === MODEL.size) {
      if (this.status.kind !== 'ready' && this.status.kind !== 'loading') this.set({ kind: 'ready', gpu: null })
      return
    }
    const part = await stat(this.path + '.part').catch(() => null)
    if (this.status.kind !== 'error') this.set({ kind: 'missing', size: MODEL.size, partial: part?.size ?? 0 })
  }

  // ---------------------------------------------------------------- download

  async startDownload(): Promise<void> {
    if (this.download || this.status.kind === 'ready' || this.status.kind === 'loading') return
    const ac = new AbortController()
    this.download = ac
    const part = this.path + '.part'
    try {
      await mkdir(this.dir, { recursive: true })
      let have = (await stat(part).catch(() => null))?.size ?? 0
      if (have >= MODEL.size) {
        await rm(part, { force: true })
        have = 0
      }
      const disk = await statfs(this.dir).catch(() => null)
      if (disk && disk.bavail * disk.bsize < MODEL.size - have + SPARE_DISK) {
        this.set({ kind: 'error', error: 'disk-full' })
        return
      }
      this.set({ kind: 'downloading', received: have, total: MODEL.size, speed: 0 })

      const hash = createHash('sha256')
      if (have > 0) for await (const chunk of createReadStream(part)) hash.update(chunk as Buffer)

      // its own session: no cookies, no history, nothing shared with the user's browsing
      const ses = electronSession.fromPartition('halyard-ai-download')
      const res = await ses.fetch(MODEL.url, {
        headers: have > 0 ? { Range: `bytes=${have}-` } : {},
        signal: ac.signal,
        cache: 'no-store'
      })
      if (res.status === 200 && have > 0) {
        // the server ignored the resume request: start over
        have = 0
        hash.destroy()
        return this.restart(ac)
      }
      if (!(res.status === 200 || res.status === 206) || !res.body) throw new Error(`HTTP ${res.status}`)

      const out = createWriteStream(part, { flags: have > 0 ? 'a' : 'w' })
      const reader = res.body.getReader()
      let received = have
      let lastEmit = 0
      let lastBytes = have
      let lastTime = Date.now()
      let speed = 0
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          received += value.byteLength
          if (received > MODEL.size) throw new Error('too large')
          hash.update(value)
          if (!out.write(value)) await once(out, 'drain')
          const now = Date.now()
          if (now - lastEmit > 300) {
            const inst = ((received - lastBytes) * 1000) / Math.max(1, now - lastTime)
            speed = speed ? speed * 0.7 + inst * 0.3 : inst
            lastBytes = received
            lastTime = now
            lastEmit = now
            this.set({ kind: 'downloading', received, total: MODEL.size, speed })
          }
        }
      } finally {
        out.end()
        await once(out, 'close').catch(() => undefined)
      }
      if (received !== MODEL.size) throw new Error('incomplete')

      this.set({ kind: 'verifying' })
      if (hash.digest('hex') !== MODEL.sha256) {
        await rm(part, { force: true })
        this.set({ kind: 'error', error: 'corrupt' })
        return
      }
      await rename(part, this.path)
      this.set({ kind: 'ready', gpu: null })
    } catch (err) {
      if (ac.signal.aborted) {
        const left = (await stat(part).catch(() => null))?.size ?? 0
        this.set({ kind: 'missing', size: MODEL.size, partial: left })
      } else {
        console.warn('[ai] download failed:', err instanceof Error ? err.message : err)
        this.set({ kind: 'error', error: 'network' })
      }
    } finally {
      if (this.download === ac) this.download = null
    }
  }

  private async restart(ac: AbortController): Promise<void> {
    if (this.download === ac) this.download = null
    await rm(this.path + '.part', { force: true })
    return this.startDownload()
  }

  cancelDownload(): void {
    this.download?.abort()
  }

  /** Delete the model from disk (frees ~2.5 GB). */
  async remove(): Promise<void> {
    this.cancelDownload()
    this.stopWorker()
    await rm(this.path, { force: true })
    await rm(this.path + '.part', { force: true })
    this.set({ kind: 'missing', size: MODEL.size, partial: 0 })
  }

  // ---------------------------------------------------------------- running

  private ensureWorker(): Promise<void> {
    if (this.worker && !this.starting) return Promise.resolve()
    if (this.starting) return this.starting
    this.set({ kind: 'loading' })
    this.starting = new Promise<void>((resolve, reject) => {
      const worker = utilityProcess.fork(join(__dirname, 'ai-worker.js'), [], { serviceName: 'Halyard AI', stdio: 'ignore' })
      this.worker = worker
      worker.on('message', (msg: WorkerReply) => {
        if (msg.type === 'loaded') {
          this.starting = null
          this.set({ kind: 'ready', gpu: msg.gpu ? 'gpu' : 'cpu' })
          resolve()
        } else if (msg.type === 'result') {
          this.pending.get(msg.id)?.resolve(msg.text)
          this.pending.delete(msg.id)
        } else if (msg.type === 'error') {
          if (msg.id == null) {
            console.error('[ai] could not load the model:', msg.message)
            this.stopWorker()
            this.set({ kind: 'error', error: 'engine' })
            reject(new Error('engine'))
            return
          }
          this.pending.get(msg.id)?.reject(new Error(msg.message))
          this.pending.delete(msg.id)
        }
      })
      worker.on('exit', () => {
        if (this.worker !== worker) return
        this.worker = null
        const wasStarting = !!this.starting
        this.starting = null
        for (const p of this.pending.values()) p.reject(new Error('engine'))
        this.pending.clear()
        if (wasStarting) {
          this.set({ kind: 'error', error: 'engine' })
          reject(new Error('engine'))
        } else if (this.status.kind === 'ready') this.set({ kind: 'ready', gpu: null })
      })
      worker.postMessage({ type: 'load', path: this.path } satisfies WorkerRequest)
    })
    return this.starting
  }

  private stopWorker(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    const w = this.worker
    this.worker = null
    this.starting = null
    for (const p of this.pending.values()) p.reject(new Error('engine'))
    this.pending.clear()
    w?.kill()
  }

  /** Ask the model for one JSON answer that matches `schema`. */
  async complete(req: CompleteRequest, signal: AbortSignal): Promise<string> {
    if (this.status.kind !== 'ready' && this.status.kind !== 'loading') throw new Error('not-ready')
    if (this.idleTimer) clearTimeout(this.idleTimer)
    await this.ensureWorker()
    if (signal.aborted) throw new Error('aborted')
    const id = this.seq++
    const worker = this.worker!
    try {
      return await new Promise<string>((resolve, reject) => {
        this.pending.set(id, { resolve, reject })
        const onAbort = (): void => worker.postMessage({ type: 'abort', id } satisfies WorkerRequest)
        signal.addEventListener('abort', onAbort, { once: true })
        worker.postMessage({ type: 'run', id, ...req } satisfies WorkerRequest)
      })
    } finally {
      this.idleTimer = setTimeout(() => this.stopWorker(), IDLE_MS)
    }
  }

  dispose(): void {
    this.cancelDownload()
    this.stopWorker()
  }
}
