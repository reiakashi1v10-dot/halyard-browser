// Bridge for halyard:// pages (new tab, settings, history...). Web pages get nothing:
// the API is only exposed when the document itself is served from the internal scheme,
// and the main process checks the sender URL again before answering.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { INTERNAL_CHANNELS, INTERNAL_EVENTS, type Result } from '@shared/ipc'

if (location.protocol === 'halyard:') {
  const channels = new Set<string>(INTERNAL_CHANNELS)
  const events = new Set<string>(INTERNAL_EVENTS)

  contextBridge.exposeInMainWorld('halyardInternal', {
    async invoke(channel: string, ...args: unknown[]) {
      if (!channels.has(channel)) throw new Error(`Canal bloqueado: ${channel}`)
      const res = (await ipcRenderer.invoke(channel, ...args)) as Result<unknown>
      if (!res.ok) throw new Error(res.error)
      return res.data
    },
    on(event: string, callback: (payload: unknown) => void) {
      if (!events.has(event)) throw new Error(`Evento bloqueado: ${event}`)
      const handler = (_e: IpcRendererEvent, payload: unknown) => callback(payload)
      ipcRenderer.on(event, handler)
      return () => ipcRenderer.removeListener(event, handler)
    }
  })
} else if (location.protocol === 'https:' || location.protocol === 'http:') {
  webPage()
}

/*
 * Web pages. This code runs in the preload's isolated world: the page cannot see it,
 * call it or read what it holds. Nothing is exposed to the page except the GPC flag.
 */
function webPage(): void {
  let config: { gpc: boolean; fp: number | null; login: boolean; clip: boolean } = { gpc: false, fp: null, login: false, clip: false }
  try {
    config = { ...config, ...(ipcRenderer.sendSync('halyard:config') as typeof config) }
  } catch {
    /* keep everything off */
  }

  // Global Privacy Control: tells the site not to sell or share your data (legally binding in some places)
  if (config.gpc) {
    try {
      contextBridge.executeInMainWorld({
        func: () => {
          Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true, configurable: true, enumerable: true })
        }
      })
    } catch {
      /* not fatal */
    }
  }

  if (config.fp !== null) antiFingerprint(config.fp)

  // anti-ClickFix: after the page copies something, the browser checks what landed in the clipboard
  if (config.clip) {
    const copied = (): void => ipcRenderer.send('halyard:copy')
    document.addEventListener('copy', copied, true)
    document.addEventListener('cut', copied, true)
  }

  // passwords typed on a page without HTTPS, or sent to one, can be read on the way
  if (config.login) {
    let warned = false
    document.addEventListener(
      'focusin',
      (e) => {
        const el = e.target
        if (warned || !(el instanceof HTMLInputElement) || el.type !== 'password') return
        let kind: 'page' | 'form' | null = location.protocol === 'http:' ? 'page' : null
        if (!kind && el.form) {
          try {
            if (new URL(el.form.action, location.href).protocol === 'http:') kind = 'form'
          } catch {
            /* odd action: ignore */
          }
        }
        if (!kind) return
        warned = true
        ipcRenderer.send('halyard:insecure-login', kind)
      },
      true
    )
  }

  // Leaked-password check: when you sign in or sign up, the password is hashed here and
  // only the hash goes to the browser, which asks Have I Been Pwned with its first 5 characters.
  if (!window.isSecureContext || !crypto.subtle) return
  const sent = new Set<string>()
  const check = async (value: string): Promise<void> => {
    if (value.length < 4 || value.length > 256) return
    const bytes = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(value))
    const hex = Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('')
    if (sent.has(hex)) return
    sent.add(hex)
    ipcRenderer.send('halyard:pw', hex)
  }
  const passwordsIn = (scope: ParentNode): string[] =>
    Array.from(scope.querySelectorAll<HTMLInputElement>('input[type=password]'))
      .map((i) => i.value)
      .filter(Boolean)
  const checkScope = (scope: ParentNode): void => {
    for (const v of passwordsIn(scope).slice(0, 3)) void check(v).catch(() => undefined)
  }
  document.addEventListener('submit', (e) => {
    if (e.target instanceof HTMLFormElement) checkScope(e.target)
  }, true)
  document.addEventListener('keydown', (e) => {
    const el = e.target
    if (e.key === 'Enter' && el instanceof HTMLInputElement && el.type === 'password' && el.value) void check(el.value).catch(() => undefined)
  }, true)
  document.addEventListener('click', (e) => {
    const el = e.target instanceof Element ? e.target.closest('button, input[type=submit], [role=button]') : null
    if (!el) return
    checkScope(el.closest('form') ?? document)
  }, true)
}

/*
 * Fingerprinting protection: trackers recognise browsers by tiny differences in how they draw
 * a canvas and by hardware details. Halyard adds an invisible, per-site noise to canvas reads and
 * reports common hardware values, so the fingerprint changes from site to site and run to run.
 */
function antiFingerprint(seed: number): void {
  try {
    contextBridge.executeInMainWorld({
      args: [seed],
      func: (s: number) => {
        const rand = (n: number): number => {
          let x = (s + Math.imul(n, 0x6d2b79f5)) >>> 0
          x = Math.imul(x ^ (x >>> 15), x | 1)
          x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
          return ((x ^ (x >>> 14)) >>> 0) / 4294967296
        }
        const getter = (proto: object, prop: string, value: unknown): void => {
          try {
            Object.defineProperty(proto, prop, { get: () => value, configurable: true, enumerable: true })
          } catch {
            /* leave it */
          }
        }
        getter(Navigator.prototype, 'hardwareConcurrency', 8)
        if ('deviceMemory' in Navigator.prototype) getter(Navigator.prototype, 'deviceMemory', 8)

        const getImageData = CanvasRenderingContext2D.prototype.getImageData
        const noisify = (data: Uint8ClampedArray): void => {
          for (let i = 0; i < data.length; i += 4 * 61) data[i + Math.floor(rand(i) * 3)] ^= 1
        }
        CanvasRenderingContext2D.prototype.getImageData = function (this: CanvasRenderingContext2D, ...a: Parameters<typeof getImageData>) {
          const img = getImageData.apply(this, a)
          noisify(img.data)
          return img
        }
        const withNoise = <T,>(canvas: HTMLCanvasElement, run: (c: HTMLCanvasElement) => T): T => {
          const { width: w, height: h } = canvas
          if (!w || !h || w * h > 4_000_000) return run(canvas)
          const copy = document.createElement('canvas')
          copy.width = w
          copy.height = h
          const ctx = copy.getContext('2d')
          if (!ctx) return run(canvas)
          ctx.drawImage(canvas, 0, 0)
          const img = getImageData.call(ctx, 0, 0, w, h)
          noisify(img.data)
          ctx.putImageData(img, 0, 0)
          return run(copy)
        }
        const toDataURL = HTMLCanvasElement.prototype.toDataURL
        HTMLCanvasElement.prototype.toDataURL = function (this: HTMLCanvasElement, ...a: Parameters<typeof toDataURL>) {
          return withNoise(this, (c) => toDataURL.apply(c, a))
        }
        const toBlob = HTMLCanvasElement.prototype.toBlob
        HTMLCanvasElement.prototype.toBlob = function (this: HTMLCanvasElement, ...a: Parameters<typeof toBlob>) {
          return withNoise(this, (c) => toBlob.apply(c, a))
        }
        // the graphics card's exact model is a strong identifier
        const protos = [window.WebGLRenderingContext?.prototype, window.WebGL2RenderingContext?.prototype].filter(Boolean) as WebGLRenderingContext[]
        for (const proto of protos) {
          const getParameter = proto.getParameter
          proto.getParameter = function (this: WebGLRenderingContext, p: number) {
            if (p === 0x9245) return 'Google Inc.'
            if (p === 0x9246) return 'ANGLE (Generic GPU)'
            return getParameter.call(this, p)
          }
        }
      }
    })
  } catch {
    /* not fatal */
  }
}
