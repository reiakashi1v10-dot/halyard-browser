/*
 * The second set of Halyard Lab tools. Everything here runs in the Lab window and never
 * touches the network: scam messages, boletos, CPF/CNPJ, photo metadata, hidden characters,
 * e-mail headers, text encryption, random tokens, link cleaning and disguised files.
 */
import { getDomain } from 'tldts'
import { isTrackingParam } from '@shared/tracking'

export type Level = 'safe' | 'caution' | 'danger'

// ------------------------------------------------------------------ scam messages

export type ScamSignal =
  | 'urgency'
  | 'money'
  | 'prize'
  | 'credentials'
  | 'brand'
  | 'threat'
  | 'family'
  | 'job'
  | 'package'
  | 'shortlink'
  | 'link'
  | 'caps'

export interface ScamReport {
  level: Level
  score: number
  signals: ScamSignal[]
  brands: string[]
  links: string[]
}

const SCAM_PATTERNS: [ScamSignal, RegExp, number][] = [
  ['urgency', /\b(urgente|imediatamente|agora mesmo|[uú]ltim[ao]s? (horas?|chance|dia)|ainda hoje|hoje mesmo|expira|vence hoje|prazo final|urgent|immediately|right now|last chance|expires? today|act now|urgente|inmediatamente|ahora mismo|[uú]ltima oportunidad|caduca hoy)\b/i, 2],
  ['money', /\b(pix|transfer[eêií]ncia|transfira|deposit[eao]|boleto|pague|pagamento|taxa|tarifa|liberar? (o )?valor|wire transfer|gift ?cards?|bitcoin|cripto|pay now|send money|transferencia|pago|cuota|env[ií]a dinero)\b/i, 2],
  ['prize', /\b(parab[eé]ns|voc[eê] ganhou|foi sortead[oa]|pr[eê]mio|brinde|resgat[ea]r?|cashback liberado|you('ve)? won|congratulations|winner|claim your|prize|ganaste|felicidades|has sido seleccionad[oa]|premio)\b/i, 3],
  ['credentials', /\b(senha|c[oó]digo (de )?(verifica[cç][aã]o|seguran[cç]a|acesso|sms)|token|cvv|confirm[ea] (seus|os) dados|atualiz[ea] (seus|o) (dados|cadastro)|validar? (sua )?conta|password|verification code|confirm your (account|details)|verify your account|contrase[nñ]a|c[oó]digo de verificaci[oó]n|confirma tus datos)\b/i, 3],
  ['threat', /\b(bloquead[oa]|suspens[oa]|cancelad[oa]|multa|processo judicial|intima[cç][aã]o|pol[ií]cia|receita federal|cpf (irregular|bloqueado|suspenso)|nome (sujo|negativado)|negativa[cç][aã]o|d[ií]vida|blocked|suspended|legal action|arrest|irs|overdue|bloquead[oa]|suspendid[oa]|deuda|demanda)\b/i, 2],
  ['family', /\b(troquei de n[uú]mero|meu (n[uú]mero|celular) novo|esse [eé] meu novo n[uú]mero|salva (esse|este) n[uú]mero|m[aã]e,|pai,|new number|this is my new number|cambi[eé] de n[uú]mero|mi nuevo n[uú]mero)\b/i, 3],
  ['job', /\b(renda extra|trabalh[eo] (de|em) casa|ganhe (at[eé] )?r\$|curtir (v[ií]deos|posts)|tarefas? (simples|online)|vaga (de )?home office|work from home|easy money|earn \$|trabajo desde casa|gana dinero)\b/i, 2],
  ['package', /\b(encomenda|entrega (pendente|n[aã]o realizada)|correios|taxa de (importa[cç][aã]o|libera[cç][aã]o)|objeto retido|rastreio|package|delivery (failed|attempt)|customs fee|paquete|entrega fallida|aduana)\b/i, 2]
]

const BRANDS = [
  'nubank', 'itaú', 'itau', 'bradesco', 'santander', 'caixa econômica', 'banco do brasil', 'banco inter', 'c6 bank', 'picpay', 'mercado pago',
  'mercado livre', 'correios', 'receita federal', 'serasa', 'gov.br', 'detran', 'inss', 'whatsapp', 'instagram', 'netflix',
  'amazon', 'shopee', 'magalu', 'americanas', 'paypal', 'apple', 'microsoft', 'google', 'sabesp', 'enel', 'cemig', 'sicredi', 'sicoob', 'bbva', 'caixabank', 'bizum', 'chase', 'wells fargo', 'bank of america', 'usps', 'fedex', 'dhl'
]

/** Display form of a brand from the list: "banco do brasil" -> "Banco do Brasil". */
const BRAND_NAMES: Record<string, string> = {
  itau: 'Itaú', itaú: 'Itaú', 'gov.br': 'gov.br', inss: 'INSS', 'c6 bank': 'C6 Bank', picpay: 'PicPay', whatsapp: 'WhatsApp',
  paypal: 'PayPal', caixabank: 'CaixaBank', bbva: 'BBVA', usps: 'USPS', fedex: 'FedEx', dhl: 'DHL', detran: 'Detran'
}
function brandName(b: string): string {
  return BRAND_NAMES[b] ?? b.replace(/(^|\s)(\p{L})/gu, (_m, sp: string, c: string) => sp + c.toUpperCase()).replace(/ (Do|Da|Of) /g, (m) => m.toLowerCase())
}

const SHORTENERS = ['bit.ly', 'tinyurl.com', 'cutt.ly', 'is.gd', 't.co', 'ow.ly', 'rebrand.ly', 'encurtador.com.br', 'shorturl.at', 'rb.gy', 'tiny.cc', 'bl.ink', 'short.io', 'l.ead.me', 'abre.ai', 'surl.li']

export function linksIn(text: string): string[] {
  const found = text.match(/\b((https?:\/\/|www\.)[^\s<>"']+|[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|net|org|br|me|ly|io|co|xyz|top|site|online|app|link|info|shop|club|live|vip)(\/[^\s<>"']*)?)/gi) ?? []
  return [...new Set(found.map((l) => l.replace(/[).,;!?]+$/, '')))].slice(0, 10)
}

export function analyzeMessage(text: string): ScamReport {
  const signals: ScamSignal[] = []
  let score = 0
  for (const [signal, re, weight] of SCAM_PATTERNS) {
    if (re.test(text)) {
      signals.push(signal)
      score += weight
    }
  }
  const lower = text.toLowerCase()
  const brands = BRANDS.filter((b) => new RegExp(`(^|[^a-z])${b.replace('.', '\\.')}([^a-z]|$)`, 'i').test(lower))
  if (brands.length) {
    signals.push('brand')
    score += 1
  }
  const links = linksIn(text)
  if (links.length) {
    signals.push('link')
    score += 1
    if (links.some((l) => SHORTENERS.some((s) => l.toLowerCase().replace(/^https?:\/\//, '').startsWith(s)))) {
      signals.push('shortlink')
      score += 2
    }
  }
  const letters = text.replace(/[^a-zA-ZÀ-ÿ]/g, '')
  if (letters.length > 30 && letters.replace(/[^A-ZÀ-Þ]/g, '').length / letters.length > 0.6) {
    signals.push('caps')
    score += 1
  }
  // asking for money or a code while pretending to be family or a company is the classic combo
  if (signals.includes('family') && signals.includes('money')) score += 3
  if (brands.length && (signals.includes('credentials') || signals.includes('threat')) && links.length) score += 2
  const level: Level = score >= 6 ? 'danger' : score >= 3 ? 'caution' : 'safe'
  return { level, score, signals, brands: [...new Set(brands.map(brandName))], links }
}

// ------------------------------------------------------------------ boletos

export interface BoletoReport {
  kind: 'bank' | 'utility'
  valid: boolean
  /** Which check failed, when not valid. */
  problem: 'length' | 'field' | 'general' | null
  bank: string | null
  bankCode: string | null
  segment: string | null
  value: number | null
  due: Date | null
  barcode: string
}

const BANKS: Record<string, string> = {
  '001': 'Banco do Brasil', '033': 'Santander', '041': 'Banrisul', '070': 'BRB', '077': 'Banco Inter', '104': 'Caixa',
  '208': 'BTG Pactual', '212': 'Banco Original', '237': 'Bradesco', '260': 'Nubank', '290': 'PagSeguro', '323': 'Mercado Pago',
  '336': 'C6 Bank', '341': 'Itaú', '380': 'PicPay', '422': 'Safra', '655': 'Votorantim', '745': 'Citibank', '748': 'Sicredi',
  '756': 'Sicoob', '403': 'Cora', '197': 'Stone', '536': 'Neon', '102': 'XP', '623': 'Pan', '318': 'BMG', '633': 'Rendimento'
}

/** Utility bills: the second digit says who receives the money. */
const SEGMENTS: Record<string, string> = {
  '1': 'seg.city', '2': 'seg.water', '3': 'seg.energy', '4': 'seg.phone', '5': 'seg.gov', '6': 'seg.other', '7': 'seg.traffic', '9': 'seg.bank'
}

function mod10(digits: string): number {
  let sum = 0
  let weight = 2
  for (let i = digits.length - 1; i >= 0; i--) {
    let p = Number(digits[i]) * weight
    if (p > 9) p = Math.floor(p / 10) + (p % 10)
    sum += p
    weight = weight === 2 ? 1 : 2
  }
  return (10 - (sum % 10)) % 10
}

function mod11Bank(digits: string): number {
  let sum = 0
  let weight = 2
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += Number(digits[i]) * weight
    weight = weight === 9 ? 2 : weight + 1
  }
  const dv = 11 - (sum % 11)
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv
}

function mod11Utility(digits: string): number {
  let sum = 0
  let weight = 2
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += Number(digits[i]) * weight
    weight = weight === 9 ? 2 : weight + 1
  }
  const r = sum % 11
  return r === 0 || r === 1 ? 0 : r === 10 ? 1 : 11 - r
}

/** The due-date factor restarted at 1000 on 22 Feb 2025; pick the reading closest to today. */
function dueFromFactor(factor: number): Date | null {
  if (!factor) return null
  const day = 86_400_000
  const old = Date.UTC(1997, 9, 7) + factor * day
  const fresh = Date.UTC(2025, 1, 22) + (factor - 1000) * day
  const now = Date.now()
  return new Date(Math.abs(old - now) < Math.abs(fresh - now) ? old : fresh)
}

export function checkBoleto(raw: string): BoletoReport {
  const d = raw.replace(/\D/g, '')
  const empty: BoletoReport = { kind: 'bank', valid: false, problem: 'length', bank: null, bankCode: null, segment: null, value: null, due: null, barcode: '' }

  if (d.startsWith('8')) {
    // utility bill: 48 digits typed (4 blocks of 11 + check digit) or the 44-digit barcode
    let bar = d
    if (d.length === 48) {
      const refDigit = d[2]
      const fn = refDigit === '6' || refDigit === '7' ? mod10 : mod11Utility
      for (let b = 0; b < 4; b++) {
        const block = d.slice(b * 12, b * 12 + 11)
        if (fn(block) !== Number(d[b * 12 + 11])) return { ...empty, kind: 'utility', problem: 'field' }
      }
      bar = [0, 1, 2, 3].map((b) => d.slice(b * 12, b * 12 + 11)).join('')
    }
    if (bar.length !== 44) return { ...empty, kind: 'utility' }
    const refDigit = bar[2]
    const fn = refDigit === '6' || refDigit === '7' ? mod10 : mod11Utility
    const valid = fn(bar.slice(0, 3) + bar.slice(4)) === Number(bar[3])
    const hasValue = refDigit === '6' || refDigit === '8'
    return {
      kind: 'utility',
      valid,
      problem: valid ? null : 'general',
      bank: null,
      bankCode: null,
      segment: SEGMENTS[bar[1]] ?? 'seg.other',
      value: hasValue ? Number(bar.slice(4, 15)) / 100 : null,
      due: null,
      barcode: bar
    }
  }

  let bar = d
  if (d.length === 47) {
    const fields = [
      [d.slice(0, 9), d[9]],
      [d.slice(10, 20), d[20]],
      [d.slice(21, 31), d[31]]
    ]
    for (const [body, dv] of fields) if (mod10(body) !== Number(dv)) return { ...empty, problem: 'field', bankCode: d.slice(0, 3), bank: BANKS[d.slice(0, 3)] ?? null }
    bar = d.slice(0, 4) + d[32] + d.slice(33, 47) + d.slice(4, 9) + d.slice(10, 20) + d.slice(21, 31)
  }
  if (bar.length !== 44) return empty
  const valid = mod11Bank(bar.slice(0, 4) + bar.slice(5)) === Number(bar[4])
  const code = bar.slice(0, 3)
  const value = Number(bar.slice(9, 19)) / 100
  return {
    kind: 'bank',
    valid,
    problem: valid ? null : 'general',
    bank: BANKS[code] ?? null,
    bankCode: code,
    segment: null,
    value: value || null,
    due: dueFromFactor(Number(bar.slice(5, 9))),
    barcode: bar
  }
}

// ------------------------------------------------------------------ CPF / CNPJ

export interface DocReport {
  kind: 'cpf' | 'cnpj' | null
  valid: boolean
  formatted: string
  /** CPF: the region where it was issued (9th digit). */
  region: number | null
  /** CNPJ: "0001" is the head office; anything else is a branch. */
  branch: boolean | null
}

function cpfDigit(digits: number[], start: number): number {
  const sum = digits.reduce((acc, d, i) => acc + d * (start - i), 0)
  const r = (sum * 10) % 11
  return r === 10 ? 0 : r
}

/** CNPJ digits; since July 2026 the first 12 characters may also be letters (value = char code − 48). */
function cnpjDigit(chars: string): number {
  const weights = chars.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const sum = [...chars].reduce((acc, c, i) => acc + (c.charCodeAt(0) - 48) * weights[i], 0)
  const r = sum % 11
  return r < 2 ? 0 : 11 - r
}

export function checkDoc(raw: string): DocReport {
  const clean = raw.toUpperCase().replace(/[^0-9A-Z]/g, '')
  if (/^\d{11}$/.test(clean)) {
    const digits = [...clean].map(Number)
    const valid =
      !/^(\d)\1{10}$/.test(clean) && cpfDigit(digits.slice(0, 9), 10) === digits[9] && cpfDigit(digits.slice(0, 10), 11) === digits[10]
    return {
      kind: 'cpf',
      valid,
      formatted: `${clean.slice(0, 3)}.${clean.slice(3, 6)}.${clean.slice(6, 9)}-${clean.slice(9)}`,
      region: digits[8],
      branch: null
    }
  }
  if (/^[0-9A-Z]{12}\d{2}$/.test(clean)) {
    const valid =
      !/^(\d)\1{13}$/.test(clean) &&
      cnpjDigit(clean.slice(0, 12)) === Number(clean[12]) &&
      cnpjDigit(clean.slice(0, 13)) === Number(clean[13])
    return {
      kind: 'cnpj',
      valid,
      formatted: `${clean.slice(0, 2)}.${clean.slice(2, 5)}.${clean.slice(5, 8)}/${clean.slice(8, 12)}-${clean.slice(12)}`,
      region: null,
      branch: clean.slice(8, 12) !== '0001'
    }
  }
  return { kind: null, valid: false, formatted: '', region: null, branch: null }
}

// ------------------------------------------------------------------ photo metadata

export interface PhotoInfo {
  gps: { lat: number; lon: number } | null
  camera: string | null
  taken: string | null
  software: string | null
  /** Any metadata block at all (EXIF, XMP, text chunks...). */
  hasMetadata: boolean
}

/** Reads the EXIF block of a JPEG (camera, date, GPS). PNG/WebP only report whether metadata exists. */
export function readPhotoInfo(buf: ArrayBuffer): PhotoInfo {
  const info: PhotoInfo = { gps: null, camera: null, taken: null, software: null, hasMetadata: false }
  const v = new DataView(buf)
  const ascii = (at: number, len: number) => String.fromCharCode(...new Uint8Array(buf, at, Math.min(len, buf.byteLength - at)))
  if (v.byteLength < 4) return info

  if (v.getUint16(0) !== 0xffd8) {
    // PNG text/EXIF chunks, WebP EXIF/XMP: report presence only
    const head = ascii(0, Math.min(buf.byteLength, 1 << 20))
    info.hasMetadata = /eXIf|tEXt|iTXt|zTXt|EXIF|XMP |<x:xmpmeta/.test(head)
    return info
  }

  let off = 2
  while (off + 4 < v.byteLength) {
    if (v.getUint8(off) !== 0xff) break
    const marker = v.getUint8(off + 1)
    const size = v.getUint16(off + 2)
    if (marker === 0xda) break // image data starts
    if (marker === 0xe1 || marker === 0xed || marker === 0xe2) info.hasMetadata = true
    if (marker === 0xe1 && ascii(off + 4, 4) === 'Exif') {
      try {
        readExif(v, off + 10, info)
      } catch {
        /* damaged EXIF: presence is still reported */
      }
    }
    off += 2 + size
  }
  return info
}

function readExif(v: DataView, tiff: number, info: PhotoInfo): void {
  const little = v.getUint16(tiff) === 0x4949
  const u16 = (o: number) => v.getUint16(o, little)
  const u32 = (o: number) => v.getUint32(o, little)
  const str = (o: number, n: number) => {
    let s = ''
    for (let i = 0; i < n && o + i < v.byteLength; i++) {
      const c = v.getUint8(o + i)
      if (!c) break
      s += String.fromCharCode(c)
    }
    return s.trim()
  }
  type Entry = { tag: number; type: number; count: number; at: number }
  const ifd = (start: number): Entry[] => {
    const n = u16(start)
    const out: Entry[] = []
    for (let i = 0; i < Math.min(n, 200); i++) {
      const e = start + 2 + i * 12
      out.push({ tag: u16(e), type: u16(e + 2), count: u32(e + 4), at: e + 8 })
    }
    return out
  }
  const text = (e: Entry) => (e.count <= 4 ? str(e.at, e.count) : str(tiff + u32(e.at), e.count))
  const rationals = (e: Entry) => {
    const base = tiff + u32(e.at)
    return Array.from({ length: e.count }, (_, i) => u32(base + i * 8) / (u32(base + i * 8 + 4) || 1))
  }

  const ifd0 = ifd(tiff + u32(tiff + 4))
  let make = ''
  let model = ''
  for (const e of ifd0) {
    if (e.tag === 0x010f) make = text(e)
    if (e.tag === 0x0110) model = text(e)
    if (e.tag === 0x0131) info.software = text(e) || null
    if (e.tag === 0x0132) info.taken = text(e) || null
    if (e.tag === 0x8769) {
      for (const x of ifd(tiff + u32(e.at))) if (x.tag === 0x9003) info.taken = text(x) || info.taken
    }
    if (e.tag === 0x8825) {
      const g = ifd(tiff + u32(e.at))
      const get = (t: number) => g.find((x) => x.tag === t)
      const latE = get(2)
      const lonE = get(4)
      if (latE && lonE) {
        const toDeg = (r: number[]) => r[0] + (r[1] ?? 0) / 60 + (r[2] ?? 0) / 3600
        let lat = toDeg(rationals(latE))
        let lon = toDeg(rationals(lonE))
        const latRef = get(1)
        const lonRef = get(3)
        if (latRef && str(latRef.at, 1) === 'S') lat = -lat
        if (lonRef && str(lonRef.at, 1) === 'W') lon = -lon
        if (Number.isFinite(lat) && Number.isFinite(lon) && (lat || lon)) info.gps = { lat, lon }
      }
    }
  }
  info.camera = [make, model.startsWith(make) ? model.slice(make.length).trim() : model].filter(Boolean).join(' ') || null
}

/** Draws the photo again (upright) without any metadata. */
export async function cleanPhoto(file: Blob, type: string): Promise<string> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const canvas = document.createElement('canvas')
  canvas.width = bmp.width
  canvas.height = bmp.height
  canvas.getContext('2d')!.drawImage(bmp, 0, 0)
  bmp.close()
  const out = type === 'image/png' ? 'image/png' : 'image/jpeg'
  return canvas.toDataURL(out, 0.92)
}

// ------------------------------------------------------------------ hidden characters

export interface HiddenReport {
  invisible: number
  bidi: number
  tags: number
  /** Latin-looking letters from other alphabets mixed into words. */
  lookalikes: number
  /** Text smuggled in Unicode "tag" characters (used to trick AI assistants). */
  smuggled: string
  cleaned: string
  /** The text with each odd character replaced by a visible marker. */
  marked: { text: string; odd: boolean }[]
}

const INVISIBLE = /[­͏؜ᅟᅠ឴឵᠋-᠎​-‍⁠-⁤ㅤ﻿ﾠ]/
const BIDI = /[‎‏‪-‮⁦-⁩]/
const LOOKALIKE = /[Α-ωЀ-ӿ]/
/** Cyrillic and Greek letters that look exactly like Latin ones, for the clean copy. */
const TO_LATIN: Record<string, string> = Object.fromEntries(
  [...'аеорсухіјѕԁԛԝАВЕКМНОРСТХІЈЅΑΒΕΖΗΙΚΜΝΟΡΤΥΧον'].map((c, i) => [c, 'aeopcyxijsdqwABEKMHOPCTXIJSABEZHIKMNOPTYXov'[i]])
)

export function scanHidden(text: string): HiddenReport {
  const r: HiddenReport = { invisible: 0, bidi: 0, tags: 0, lookalikes: 0, smuggled: '', cleaned: '', marked: [] }
  let plain = ''
  const push = (s: string, odd: boolean) => {
    const last = r.marked[r.marked.length - 1]
    if (last && last.odd === odd && !odd) last.text += s
    else r.marked.push({ text: s, odd })
  }
  const words = text.split(/(\s+)/)
  for (const word of words) {
    const latin = /[a-zA-Z]/.test(word)
    for (const ch of word) {
      const cp = ch.codePointAt(0)!
      if (cp >= 0xe0000 && cp <= 0xe007f) {
        r.tags++
        if (cp >= 0xe0020 && cp <= 0xe007e) r.smuggled += String.fromCharCode(cp - 0xe0000)
        push('⟦tag⟧', true)
      } else if (INVISIBLE.test(ch)) {
        r.invisible++
        push(`⟦U+${cp.toString(16).toUpperCase().padStart(4, '0')}⟧`, true)
      } else if (BIDI.test(ch)) {
        r.bidi++
        push(`⟦U+${cp.toString(16).toUpperCase().padStart(4, '0')}⟧`, true)
      } else if (latin && LOOKALIKE.test(ch)) {
        r.lookalikes++
        push(ch, true)
        plain += TO_LATIN[ch] ?? ch
      } else {
        push(ch, false)
        plain += ch
      }
    }
  }
  r.cleaned = plain
  r.smuggled = r.smuggled.trim()
  return r
}

// ------------------------------------------------------------------ e-mail headers

export type MailFlag =
  | 'spf-fail'
  | 'dkim-fail'
  | 'dmarc-fail'
  | 'no-auth'
  | 'reply-to'
  | 'return-path'
  | 'display-email'
  | 'free-mail-brand'
  | 'auth-ok'

export interface MailReport {
  level: Level
  from: string
  fromDomain: string
  replyTo: string | null
  returnPath: string | null
  subject: string | null
  date: string | null
  spf: string | null
  dkim: string | null
  dmarc: string | null
  hops: number
  originIp: string | null
  flags: MailFlag[]
}

const FREE_MAIL = ['gmail.com', 'hotmail.com', 'outlook.com', 'live.com', 'yahoo.com', 'yahoo.com.br', 'bol.com.br', 'uol.com.br', 'icloud.com', 'proton.me', 'protonmail.com', 'aol.com', 'gmx.com', 'mail.com', 'terra.com.br', 'ig.com.br']

function domainOf(addr: string): string {
  const m = /@([a-z0-9.-]+)/i.exec(addr)
  return m ? (getDomain(m[1].toLowerCase()) ?? m[1].toLowerCase()) : ''
}

function addressIn(header: string): string {
  return (/<([^>]+)>/.exec(header)?.[1] ?? header).trim()
}

export function parseHeaders(raw: string): MailReport | null {
  // headers may be folded over several lines that start with a space
  const lines = raw.replace(/\r\n/g, '\n').split('\n\n')[0].replace(/\n[ \t]+/g, ' ').split('\n')
  const all: [string, string][] = []
  for (const line of lines) {
    const m = /^([A-Za-z0-9-]+):\s*(.*)$/.exec(line)
    if (m) all.push([m[1].toLowerCase(), m[2]])
  }
  const get = (name: string) => all.find(([k]) => k === name)?.[1] ?? null
  const fromRaw = get('from')
  if (!fromRaw) return null

  const auth = all
    .filter(([k]) => k === 'authentication-results' || k === 'arc-authentication-results')
    .map(([, v]) => v)
    .join(' ')
  const result = (what: string) => new RegExp(`\\b${what}=([a-z]+)`, 'i').exec(auth)?.[1]?.toLowerCase() ?? null
  const spf = result('spf') ?? (/^\s*([a-z]+)/i.exec(get('received-spf') ?? '')?.[1]?.toLowerCase() ?? null)
  const dkim = result('dkim')
  const dmarc = result('dmarc')

  const from = addressIn(fromRaw)
  const fromDomain = domainOf(from)
  const replyTo = get('reply-to')
  const returnPath = get('return-path')
  const received = all.filter(([k]) => k === 'received').map(([, v]) => v)
  // the last Received header is the first server that took the message
  const first = received[received.length - 1] ?? ''
  const originIp = /\[(\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f:]{3,})\]/i.exec(first)?.[1] ?? null

  const flags: MailFlag[] = []
  const bad = (v: string | null) => !!v && ['fail', 'softfail', 'permerror', 'temperror'].includes(v)
  if (bad(spf)) flags.push('spf-fail')
  if (bad(dkim)) flags.push('dkim-fail')
  if (bad(dmarc)) flags.push('dmarc-fail')
  if (!spf && !dkim && !dmarc) flags.push('no-auth')
  if (replyTo && domainOf(addressIn(replyTo)) && domainOf(addressIn(replyTo)) !== fromDomain) flags.push('reply-to')
  if (returnPath && domainOf(addressIn(returnPath)) && domainOf(addressIn(returnPath)) !== fromDomain) flags.push('return-path')
  const display = fromRaw.replace(/<[^>]*>/, '')
  const shown = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.exec(display)?.[0]
  if (shown && shown.toLowerCase() !== from.toLowerCase()) flags.push('display-email')
  if (FREE_MAIL.includes(fromDomain) && BRANDS.some((b) => display.toLowerCase().includes(b))) flags.push('free-mail-brand')
  if (!flags.length && spf === 'pass' && (dkim === 'pass' || dmarc === 'pass')) flags.push('auth-ok')

  const danger = flags.some((f) => ['dmarc-fail', 'display-email', 'free-mail-brand'].includes(f)) || (flags.includes('spf-fail') && flags.includes('dkim-fail'))
  const caution = flags.some((f) => ['spf-fail', 'dkim-fail', 'no-auth', 'reply-to'].includes(f))
  return {
    level: danger ? 'danger' : caution ? 'caution' : 'safe',
    from: fromRaw,
    fromDomain,
    replyTo,
    returnPath,
    subject: get('subject'),
    date: get('date'),
    spf,
    dkim,
    dmarc,
    hops: received.length,
    originIp,
    flags
  }
}

// ------------------------------------------------------------------ text vault (AES-GCM)

const VAULT_PREFIX = 'HALYARD1:'
const ITERATIONS = 600_000

async function vaultKey(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt'
  ])
}

const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))
const fromB64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

export async function lockText(text: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await vaultKey(password, salt)
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)))
  const out = new Uint8Array(salt.length + iv.length + sealed.length)
  out.set(salt)
  out.set(iv, 16)
  out.set(sealed, 28)
  return VAULT_PREFIX + toB64(out)
}

export function isLocked(text: string): boolean {
  return text.trim().startsWith(VAULT_PREFIX)
}

/** Throws when the password is wrong or the text was changed. */
export async function unlockText(sealed: string, password: string): Promise<string> {
  const bytes = fromB64(sealed.trim().slice(VAULT_PREFIX.length).replace(/\s+/g, ''))
  if (bytes.length < 29) throw new Error('vault')
  const key = await vaultKey(password, bytes.slice(0, 16))
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(16, 28) }, key, bytes.slice(28))
  return new TextDecoder().decode(plain)
}

// ------------------------------------------------------------------ tokens

export type TokenKind = 'uuid' | 'hex' | 'base64url' | 'pin' | 'words'

const WORDS = [
  'vela', 'mar', 'farol', 'onda', 'porto', 'brisa', 'rumo', 'ilha', 'norte', 'astro', 'coral', 'remo', 'corda', 'ancora', 'mapa', 'nuvem',
  'sol', 'lua', 'raio', 'pedra', 'folha', 'trilha', 'ponte', 'rio', 'vale', 'serra', 'chuva', 'neve', 'fogo', 'vento', 'areia', 'cais',
  'baleia', 'gaivota', 'concha', 'tinta', 'livro', 'chave', 'trevo', 'cedro', 'ipe', 'jasmim', 'canela', 'cravo', 'limao', 'figo', 'caju', 'manga'
]

function randomBelow(max: number): number {
  const limit = Math.floor(0x100000000 / max) * max
  const buf = new Uint32Array(1)
  for (;;) {
    crypto.getRandomValues(buf)
    if (buf[0] < limit) return buf[0] % max
  }
}

export function makeToken(kind: TokenKind, size: number): string {
  switch (kind) {
    case 'uuid':
      return crypto.randomUUID()
    case 'hex':
      return [...crypto.getRandomValues(new Uint8Array(size))].map((b) => b.toString(16).padStart(2, '0')).join('')
    case 'base64url':
      return toB64(crypto.getRandomValues(new Uint8Array(size))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    case 'pin':
      return Array.from({ length: size }, () => randomBelow(10)).join('')
    case 'words':
      return Array.from({ length: size }, () => WORDS[randomBelow(WORDS.length)]).join('-')
  }
}

/** Strength of a token in bits, to show next to it. */
export function tokenBits(kind: TokenKind, size: number): number {
  switch (kind) {
    case 'uuid':
      return 122
    case 'hex':
    case 'base64url':
      return size * 8
    case 'pin':
      return Math.round(size * Math.log2(10))
    case 'words':
      return Math.round(size * Math.log2(WORDS.length))
  }
}

// ------------------------------------------------------------------ link cleaning

export interface CleanedLink {
  input: string
  output: string
  removed: string[]
  /** The link was a redirect wrapper (Google, Facebook...) and was unwrapped. */
  unwrapped: string | null
}

/** Redirect wrappers that hide the real address in a parameter. */
const WRAPPERS: [RegExp, string][] = [
  [/(^|\.)google\.[a-z.]+$/, 'q'],
  [/(^|\.)google\.[a-z.]+$/, 'url'],
  [/^l\.facebook\.com$|^lm\.facebook\.com$/, 'u'],
  [/^l\.instagram\.com$/, 'u'],
  [/^(www\.)?youtube\.com$/, 'q'],
  [/^out\.reddit\.com$/, 'url'],
  [/^(www\.)?linkedin\.com$/, 'url'],
  [/^t\.umblr\.com$/, 'z'],
  [/^(www\.)?bing\.com$/, 'u']
]

export function cleanLink(raw: string): CleanedLink | null {
  let input = raw.trim()
  if (!input) return null
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
    // without a scheme, only take things that look like an address ("site.com/x")
    if (!/^[^\s/]+\.[a-z]{2,}([/:?#]|$)/i.test(input)) return null
    input = `https://${input}`
  }
  let u: URL
  try {
    u = new URL(input)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  let unwrapped: string | null = null
  for (const [host, param] of WRAPPERS) {
    const target = u.searchParams.get(param)
    if (host.test(u.hostname) && target && /^https?:\/\//i.test(target) && /^\/(url|l\.php|redirect|safety\/go)?\/?$/.test(u.pathname)) {
      try {
        unwrapped = u.hostname
        u = new URL(target)
      } catch {
        /* keep the wrapper */
      }
      break
    }
  }
  const site = getDomain(u.hostname) ?? u.hostname
  const removed: string[] = []
  for (const key of [...u.searchParams.keys()]) {
    if (isTrackingParam(key, site)) {
      removed.push(key)
      u.searchParams.delete(key)
    }
  }
  return { input: raw.trim(), output: u.href.replace(/\?(#|$)/, '$1'), removed: [...new Set(removed)], unwrapped }
}

// ------------------------------------------------------------------ disguised files

export type RealType =
  | 'exe'
  | 'shortcut'
  | 'msi-office'
  | 'script'
  | 'zip'
  | 'rar'
  | '7z'
  | 'pdf'
  | 'png'
  | 'jpeg'
  | 'gif'
  | 'webp'
  | 'iso'
  | 'elf'
  | 'html'
  | 'text'
  | 'unknown'

export type FileFlag = 'mismatch' | 'double-ext' | 'rtl-name' | 'spaces-name' | 'executable' | 'zip-exe' | 'zip-locked' | 'macro-office'

export interface FileReport {
  level: Level
  name: string
  size: number
  ext: string
  real: RealType
  flags: FileFlag[]
  /** Names inside a .zip (first 300). */
  entries: { name: string; locked: boolean; risky: boolean }[]
}

const EXEC_EXT = ['exe', 'scr', 'com', 'pif', 'bat', 'cmd', 'ps1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'hta', 'msi', 'msix', 'lnk', 'jar', 'reg', 'cpl', 'dll', 'iso', 'img', 'vhd', 'appx', 'appinstaller', 'url', 'scf', 'chm']

/** Extensions each real type is allowed to wear. */
const EXPECTED: Record<RealType, string[]> = {
  exe: ['exe', 'dll', 'scr', 'com', 'cpl', 'sys', 'ocx', 'efi', 'mui'],
  shortcut: ['lnk'],
  'msi-office': ['msi', 'doc', 'xls', 'ppt', 'msg', 'pub', 'vsd', 'msp'],
  script: ['bat', 'cmd', 'ps1', 'vbs', 'js', 'sh', 'py', 'hta', 'wsf', 'txt'],
  zip: ['zip', 'docx', 'xlsx', 'pptx', 'docm', 'xlsm', 'pptm', 'odt', 'ods', 'odp', 'jar', 'apk', 'epub', 'xpi', 'crx', 'nupkg', 'msix', 'appx', 'kmz', 'cbz', 'whl', '3mf'],
  rar: ['rar', 'cbr'],
  '7z': ['7z'],
  pdf: ['pdf', 'ai'],
  png: ['png'],
  jpeg: ['jpg', 'jpeg', 'jfif', 'jpe'],
  gif: ['gif'],
  webp: ['webp'],
  iso: ['iso', 'img'],
  elf: ['so', 'elf', 'bin', 'run', ''],
  html: ['html', 'htm', 'svg', 'xml', 'xhtml', 'mht'],
  text: ['txt', 'csv', 'json', 'md', 'log', 'xml', 'ini', 'cfg', 'yml', 'yaml', 'srt', 'svg', 'html', 'htm', 'css', 'tsv', 'eml', 'ics', 'vcf'],
  unknown: []
}

const DANGEROUS_REAL: RealType[] = ['exe', 'shortcut', 'script', 'html', 'iso']

function sniff(b: Uint8Array, all: ArrayBuffer): RealType {
  const at = (i: number, ...bytes: number[]) => bytes.every((x, k) => b[i + k] === x)
  if (at(0, 0x4d, 0x5a)) return 'exe'
  if (at(0, 0x4c, 0x00, 0x00, 0x00, 0x01, 0x14, 0x02, 0x00)) return 'shortcut'
  if (at(0, 0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)) return 'msi-office'
  if (at(0, 0x50, 0x4b, 0x03, 0x04) || at(0, 0x50, 0x4b, 0x05, 0x06)) return 'zip'
  if (at(0, 0x52, 0x61, 0x72, 0x21)) return 'rar'
  if (at(0, 0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c)) return '7z'
  if (at(0, 0x25, 0x50, 0x44, 0x46)) return 'pdf'
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'png'
  if (at(0, 0xff, 0xd8, 0xff)) return 'jpeg'
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'gif'
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'webp'
  if (at(0, 0x7f, 0x45, 0x4c, 0x46)) return 'elf'
  if (all.byteLength > 0x8006 && new TextDecoder().decode(new Uint8Array(all, 0x8001, 5)) === 'CD001') return 'iso'
  const head = new TextDecoder('utf-8', { fatal: false }).decode(b.slice(0, 512)).replace(/^﻿/, '').trimStart().toLowerCase()
  if (/^(@echo|::|rem |#!|powershell|\$[a-z]+\s*=|set-|invoke-|function |dim |set objshell|wscript|cscript|mshta|var |const |<job|<package)/.test(head)) return 'script'
  if (/^(<!doctype html|<html|<script|<svg|<\?xml)/.test(head)) return 'html'
  // mostly printable: plain text
  let printable = 0
  for (const x of b.slice(0, 512)) if (x === 9 || x === 10 || x === 13 || (x >= 32 && x < 127) || x >= 0xc2) printable++
  if (b.length && printable / Math.min(b.length, 512) > 0.95) return 'text'
  return 'unknown'
}

function zipEntries(buf: ArrayBuffer): FileReport['entries'] {
  const v = new DataView(buf)
  const out: FileReport['entries'] = []
  // the central directory's end record is in the last 64 KB
  let eocd = -1
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65_557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return out
  const count = v.getUint16(eocd + 10, true)
  let p = v.getUint32(eocd + 16, true)
  const dec = new TextDecoder()
  for (let n = 0; n < Math.min(count, 300) && p + 46 <= buf.byteLength; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) break
    const flags = v.getUint16(p + 8, true)
    const nameLen = v.getUint16(p + 28, true)
    const extraLen = v.getUint16(p + 30, true)
    const commentLen = v.getUint16(p + 32, true)
    const name = dec.decode(new Uint8Array(buf, p + 46, Math.min(nameLen, buf.byteLength - p - 46)))
    const ext = name.toLowerCase().split('.').pop() ?? ''
    if (!name.endsWith('/')) out.push({ name, locked: (flags & 1) === 1, risky: EXEC_EXT.includes(ext) })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

/** Reads the start of the file (and a .zip's index) to tell what it really is. */
export async function inspectFile(file: File): Promise<FileReport> {
  const name = file.name
  const lowerName = name.toLowerCase()
  const parts = lowerName.split('.')
  const ext = parts.length > 1 ? parts[parts.length - 1].trim() : ''
  const isZip = file.size < 400 * 1024 * 1024
  // the whole file only for archives we can list; otherwise the first 64 KB (plus the ISO marker)
  const buf = await (isZip && /\.(zip|docx|xlsx|pptx|docm|xlsm|pptm|jar|apk)$/i.test(name) ? file.arrayBuffer() : file.slice(0, 0x8100).arrayBuffer())
  let real = sniff(new Uint8Array(buf, 0, Math.min(buf.byteLength, 4096)), buf)
  let entries: FileReport['entries'] = []
  if (real === 'zip') {
    const full = buf.byteLength === file.size ? buf : isZip ? await file.arrayBuffer() : null
    if (full) entries = zipEntries(full)
  }

  const flags: FileFlag[] = []
  if (real !== 'unknown' && real !== 'text' && !EXPECTED[real].includes(ext)) flags.push('mismatch')
  if (real === 'text' && EXEC_EXT.includes(ext)) real = 'script'
  if (parts.length > 2 && EXEC_EXT.includes(ext) && /^(pdf|doc|docx|xls|xlsx|jpg|jpeg|png|txt|mp3|mp4|zip|rar)$/.test(parts[parts.length - 2])) flags.push('double-ext')
  if (/[‪-‮⁦-⁩]/.test(name)) flags.push('rtl-name')
  if (/\s{5,}/.test(name)) flags.push('spaces-name')
  if (EXEC_EXT.includes(ext) || DANGEROUS_REAL.includes(real)) flags.push('executable')
  if (entries.some((e) => e.risky)) flags.push('zip-exe')
  if (entries.some((e) => e.locked)) flags.push('zip-locked')
  if (/^(docm|xlsm|pptm)$/.test(ext) || entries.some((e) => /vbaproject\.bin$/i.test(e.name))) flags.push('macro-office')

  const danger =
    flags.includes('rtl-name') ||
    flags.includes('double-ext') ||
    (flags.includes('mismatch') && DANGEROUS_REAL.includes(real)) ||
    (flags.includes('zip-exe') && flags.includes('zip-locked'))
  const caution = flags.length > 0
  return { level: danger ? 'danger' : caution ? 'caution' : 'safe', name, size: file.size, ext, real, flags, entries }
}
