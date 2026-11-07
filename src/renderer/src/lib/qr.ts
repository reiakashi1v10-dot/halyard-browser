import jsQR from 'jsqr'
import qrcode from 'qrcode-generator'

/* Reading and drawing QR Codes, all inside the window: images never leave the computer. */

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image'))
    img.src = src
  })
}

function scan(img: HTMLImageElement, scale: number): string | null {
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  // transparent PNGs: QR Codes are dark on light, so paint a white floor first
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  ctx.imageSmoothingEnabled = scale < 1
  ctx.drawImage(img, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h)
  return jsQR(data.data, w, h, { inversionAttempts: 'attemptBoth' })?.data ?? null
}

/** Find a QR Code in an image. Tries a few sizes: tiny codes read better enlarged, huge screenshots reduced. */
export async function decodeQr(src: string): Promise<string | null> {
  const img = await loadImage(src)
  const longest = Math.max(img.naturalWidth, img.naturalHeight)
  const scales = longest < 360 ? [3, 1.5, 1] : longest > 2200 ? [1200 / longest, 1, 0.5] : [1, 0.6, 1.6]
  for (const s of scales) {
    const found = scan(img, s)
    if (found) return found
  }
  return null
}

export function readFile(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('file'))
    r.readAsDataURL(file)
  })
}

/** The first image in a paste or drop. */
export function imageFrom(data: DataTransfer | null): File | null {
  if (!data) return null
  const fromItems = [...(data.items ?? [])].find((i) => i.kind === 'file' && i.type.startsWith('image/'))?.getAsFile()
  return fromItems ?? [...(data.files ?? [])].find((f) => f.type.startsWith('image/')) ?? null
}

type Factory = typeof qrcode & { stringToBytesFuncs?: Record<string, (s: string) => number[]>; stringToBytes: (s: string) => number[] }

/** Draw a QR Code: black on white with a quiet zone, the way every camera reads best. */
export function qrDataUrl(text: string, size = 8): string {
  const factory = qrcode as Factory
  if (factory.stringToBytesFuncs?.['UTF-8']) factory.stringToBytes = factory.stringToBytesFuncs['UTF-8']
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  const n = qr.getModuleCount()
  const margin = 4
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = (n + margin * 2) * size
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#111'
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect((c + margin) * size, (r + margin) * size, size, size)
  return canvas.toDataURL('image/png')
}

/** "WIFI:" text that phones understand, with the special characters escaped. */
export function wifiPayload(ssid: string, password: string, security: 'WPA' | 'WEP' | 'nopass', hidden: boolean): string {
  const esc = (s: string) => s.replace(/([\\;,:"])/g, '\\$1')
  return `WIFI:T:${security};S:${esc(ssid)};${security === 'nopass' ? '' : `P:${esc(password)};`}${hidden ? 'H:true;' : ''};`
}
