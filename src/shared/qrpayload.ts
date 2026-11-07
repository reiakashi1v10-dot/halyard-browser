/*
 * What is inside a QR Code? Turns the raw text into something people can read:
 * a link, a Pix payment, a Wi-Fi network, a phone number... and flags what deserves care.
 * Pure functions, shared by the browser window and Halyard Lab.
 */

export type QrPayload =
  | { type: 'url'; url: string }
  | {
      type: 'pix'
      name: string
      city: string
      amount: string | null
      key: string | null
      description: string | null
      /** Dynamic Pix: the bank server that holds the charge. */
      location: string | null
      txid: string | null
      /** The checksum at the end matches: the code was not edited by hand. */
      crcOk: boolean
    }
  | { type: 'wifi'; ssid: string; security: string; password: string | null; hidden: boolean }
  | { type: 'tel'; number: string }
  | { type: 'sms'; number: string; body: string }
  | { type: 'email'; to: string; subject: string; body: string }
  | { type: 'otp'; issuer: string; account: string }
  | { type: 'crypto'; coin: string; address: string; amount: string | null }
  | { type: 'contact'; name: string; phone: string | null; email: string | null; url: string | null }
  | { type: 'geo'; lat: number; lon: number }
  | { type: 'text'; text: string }

export function parseQrPayload(raw: string): QrPayload {
  const text = raw.trim()
  if (!text) return { type: 'text', text: '' }
  const lower = text.toLowerCase()

  if (/^000201/.test(text)) {
    const pix = parsePix(text)
    if (pix) return pix
  }
  if (lower.startsWith('wifi:')) return parseWifi(text)
  if (lower.startsWith('tel:')) return { type: 'tel', number: decode(text.slice(4)) }
  if (lower.startsWith('smsto:') || lower.startsWith('sms:')) {
    const rest = text.slice(text.indexOf(':') + 1)
    const [number, ...body] = rest.split(/[:?]/)
    return { type: 'sms', number: decode(number), body: decode(body.join(':').replace(/^body=/i, '')) }
  }
  if (lower.startsWith('mailto:')) {
    try {
      const u = new URL(text)
      return { type: 'email', to: decode(u.pathname), subject: u.searchParams.get('subject') ?? '', body: u.searchParams.get('body') ?? '' }
    } catch {
      return { type: 'email', to: text.slice(7), subject: '', body: '' }
    }
  }
  if (lower.startsWith('matmsg:')) {
    const f = fields(text.slice(7))
    return { type: 'email', to: f.TO ?? '', subject: f.SUB ?? '', body: f.BODY ?? '' }
  }
  if (lower.startsWith('otpauth://')) {
    try {
      const u = new URL(text)
      const label = decode(u.pathname.replace(/^\/+/, ''))
      const [maybeIssuer, account] = label.includes(':') ? label.split(':', 2) : ['', label]
      return { type: 'otp', issuer: u.searchParams.get('issuer') ?? maybeIssuer, account: account.trim() }
    } catch {
      return { type: 'otp', issuer: '', account: '' }
    }
  }
  const coin = /^(bitcoin|ethereum|litecoin|dogecoin|monero|bitcoincash|tron|solana|usdt):([^?]+)(\?.*)?$/i.exec(text)
  if (coin) {
    const params = new URLSearchParams(coin[3]?.slice(1) ?? '')
    return { type: 'crypto', coin: coin[1].toLowerCase(), address: coin[2], amount: params.get('amount') ?? params.get('value') }
  }
  if (lower.startsWith('begin:vcard')) return parseVcard(text)
  if (lower.startsWith('mecard:')) {
    const f = fields(text.slice(7))
    return { type: 'contact', name: (f.N ?? '').replace(',', ' ').trim(), phone: f.TEL ?? null, email: f.EMAIL ?? null, url: f.URL ?? null }
  }
  const geo = /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i.exec(text)
  if (geo) return { type: 'geo', lat: Number(geo[1]), lon: Number(geo[2]) }
  if (/^https?:\/\//i.test(text)) return { type: 'url', url: text }
  // "www.site.com/x" or "site.com.br/pagina": a link without the scheme
  if (!/\s/.test(text) && /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(text)) return { type: 'url', url: `https://${text}` }
  // other schemes (javascript:, data:, intent:, file:) go to the link check, which flags them
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[a-z]+:\s/i.test(text)) return { type: 'url', url: text }
  return { type: 'text', text }
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** "KEY:value;KEY:value;;" (MECARD, MATMSG, WIFI) with backslash escapes. */
function fields(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  let key = ''
  let value = ''
  let inValue = false
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c === '\\' && i + 1 < body.length) {
      i++
      if (inValue) value += body[i]
      else key += body[i]
      continue
    }
    if (!inValue && c === ':') {
      inValue = true
      continue
    }
    if (inValue && c === ';') {
      if (key) out[key.toUpperCase()] = value
      key = ''
      value = ''
      inValue = false
      continue
    }
    if (inValue) value += c
    else key += c
  }
  if (key && inValue) out[key.toUpperCase()] = value
  return out
}

function parseWifi(text: string): QrPayload {
  const f = fields(text.slice(5))
  const security = (f.T ?? 'nopass').toUpperCase()
  return {
    type: 'wifi',
    ssid: f.S ?? '',
    security: security === '' ? 'NOPASS' : security,
    password: f.P ? f.P : null,
    hidden: (f.H ?? '').toLowerCase() === 'true'
  }
}

function parseVcard(text: string): QrPayload {
  const line = (name: string): string | null => {
    const m = new RegExp(`^${name}(?:;[^:\\r\\n]*)?:(.*)$`, 'im').exec(text)
    return m ? m[1].trim() : null
  }
  return {
    type: 'contact',
    name: line('FN') ?? (line('N') ?? '').split(';').filter(Boolean).reverse().join(' '),
    phone: line('TEL'),
    email: line('EMAIL'),
    url: line('URL')
  }
}

// ------------------------------------------------------------------ Pix (BR Code / EMV)

/** Reads "ID(2) LENGTH(2) VALUE" records. Returns null if the layout is broken. */
function tlv(s: string): Map<string, string> | null {
  const out = new Map<string, string>()
  let i = 0
  while (i < s.length) {
    if (i + 4 > s.length) return null
    const id = s.slice(i, i + 2)
    const len = Number(s.slice(i + 2, i + 4))
    if (!Number.isInteger(len) || i + 4 + len > s.length) return null
    out.set(id, s.slice(i + 4, i + 4 + len))
    i += 4 + len
  }
  return out
}

/** CRC16-CCITT (polynomial 0x1021, start 0xFFFF), as the Pix standard asks. */
export function crc16(s: string): string {
  let crc = 0xffff
  const bytes = new TextEncoder().encode(s)
  for (const b of bytes) {
    crc ^= b << 8
    for (let k = 0; k < 8; k++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

function parsePix(text: string): QrPayload | null {
  const top = tlv(text)
  if (!top) return null
  // the merchant account can sit in any slot from 26 to 51; Pix uses the "br.gov.bcb.pix" one
  let account: Map<string, string> | null = null
  for (let id = 26; id <= 51; id++) {
    const v = top.get(String(id))
    if (!v) continue
    const sub = tlv(v)
    if (sub && (sub.get('00') ?? '').toLowerCase() === 'br.gov.bcb.pix') {
      account = sub
      break
    }
  }
  if (!account) return null
  const crcAt = text.lastIndexOf('6304')
  const crcOk = crcAt >= 0 && crcAt + 8 === text.length && crc16(text.slice(0, crcAt + 4)) === text.slice(crcAt + 4).toUpperCase()
  const extra = tlv(top.get('62') ?? '')
  const location = account.get('25') ?? null
  return {
    type: 'pix',
    name: top.get('59') ?? '',
    city: top.get('60') ?? '',
    amount: top.get('54') ?? null,
    key: account.get('01') ?? null,
    description: account.get('02') ?? null,
    location: location ? (/^https?:\/\//i.test(location) ? location : `https://${location}`) : null,
    txid: extra?.get('05') ?? null,
    crcOk
  }
}

/** Pix key kind, so the person can see if "the bank's" key is actually someone's phone or CPF. */
export function pixKeyKind(key: string): 'email' | 'phone' | 'cpf' | 'cnpj' | 'random' | 'other' {
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(key)) return 'email'
  if (/^\+\d{10,15}$/.test(key)) return 'phone'
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) return 'random'
  const digits = key.replace(/\D/g, '')
  if (digits.length === 11 && digits === key.replace(/[.-]/g, '')) return 'cpf'
  if (digits.length === 14 && digits === key.replace(/[./-]/g, '')) return 'cnpj'
  return 'other'
}
