/*
 * Halyard Lab helpers that run entirely in the window: password strength and generation,
 * decoders and text hashes. Nothing here touches the network.
 */

// ------------------------------------------------------------------ passwords

const COMMON = [
  '123456', '123456789', '12345678', 'password', 'senha', 'qwerty', 'abc123', '111111', '000000', 'iloveyou', 'admin',
  'welcome', 'letmein', 'monkey', 'dragon', 'football', 'futebol', 'brasil', 'flamengo', 'corinthians', 'palmeiras',
  'saopaulo', 'gremio', 'familia', 'amor', 'deus', 'jesus', 'teste', 'master', 'princess', 'sunshine', 'qwertyuiop',
  'mudar123', 'trocar', 'contrasena', 'contraseña', 'hola', 'clave', 'batman', 'superman', 'pokemon', 'minecraft'
]

const KEYBOARD_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890']

export interface Strength {
  /** 0 (terrible) to 4 (excellent). */
  score: 0 | 1 | 2 | 3 | 4
  bits: number
  /** Seconds an attacker with a fast offline rig (10 billion guesses a second) would need, on average. */
  seconds: number
  warnings: ('common' | 'sequence' | 'repeat' | 'short' | 'only-digits' | 'only-letters' | 'date' | 'keyboard')[]
}

function charsetSize(pw: string): number {
  let n = 0
  if (/[a-z]/.test(pw)) n += 26
  if (/[A-Z]/.test(pw)) n += 26
  if (/\d/.test(pw)) n += 10
  if (/[^a-zA-Z0-9]/.test(pw)) n += 33
  if (/[^\u0000-\u007f]/.test(pw)) n += 60
  return Math.max(n, 1)
}

/** Rough but honest estimate: character variety, length, and penalties for patterns attackers try first. */
export function strengthOf(pw: string): Strength {
  const warnings: Strength['warnings'] = []
  if (!pw) return { score: 0, bits: 0, seconds: 0, warnings }
  const lower = pw.toLowerCase()
  let bits = pw.length * Math.log2(charsetSize(pw))

  const stripped = lower.replace(/[^a-z0-9ç]/g, '').replace(/[0-9]+$/, '')
  if (COMMON.some((w) => lower === w || stripped === w || (w.length >= 5 && lower.includes(w)))) {
    warnings.push('common')
    bits = Math.min(bits, 18)
  }
  if (/(.)\1{2,}/.test(pw)) {
    warnings.push('repeat')
    bits -= 8
  }
  let seq = 0
  for (let i = 2; i < lower.length; i++) {
    const a = lower.charCodeAt(i - 2)
    const b = lower.charCodeAt(i - 1)
    const c = lower.charCodeAt(i)
    if ((b - a === 1 && c - b === 1) || (a - b === 1 && b - c === 1)) seq++
  }
  if (seq >= 2) {
    warnings.push('sequence')
    bits -= seq * 3
  }
  if (KEYBOARD_ROWS.some((row) => [...Array(Math.max(0, row.length - 3))].some((_, i) => lower.includes(row.slice(i, i + 4))))) {
    warnings.push('keyboard')
    bits -= 8
  }
  if (/(19|20)\d{2}/.test(pw) || /\b\d{2}[/.-]?\d{2}[/.-]?\d{2,4}\b/.test(pw)) {
    warnings.push('date')
    bits -= 6
  }
  if (/^\d+$/.test(pw)) warnings.push('only-digits')
  else if (/^[a-zA-Z]+$/.test(pw)) warnings.push('only-letters')
  if (pw.length < 10) warnings.push('short')

  bits = Math.max(0, bits)
  const seconds = Math.pow(2, bits) / 2 / 1e10
  const score: Strength['score'] = bits < 28 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4
  return { score, bits: Math.round(bits), seconds, warnings }
}

/** A uniform random integer below `max`, from the system's secure random source. */
function randomBelow(max: number): number {
  const limit = Math.floor(0x100000000 / max) * max
  const buf = new Uint32Array(1)
  for (;;) {
    crypto.getRandomValues(buf)
    if (buf[0] < limit) return buf[0] % max
  }
}

const LOWER = 'abcdefghijkmnopqrstuvwxyz'
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const DIGITS = '23456789'
const SYMBOLS = '!@#$%&*+-=?_.:'

export interface GenOptions {
  length: number
  upper: boolean
  digits: boolean
  symbols: boolean
  /** Easy to read aloud and type: syllables joined by dashes, plus a number. */
  memorable: boolean
}

export function generatePassword(o: GenOptions): string {
  if (o.memorable) {
    const consonants = 'bcdfghjklmnprstvz'
    const vowels = 'aeiou'
    const words = Math.max(3, Math.round(o.length / 5))
    const parts: string[] = []
    for (let w = 0; w < words; w++) {
      let word = ''
      for (let s = 0; s < 2; s++) word += consonants[randomBelow(consonants.length)] + vowels[randomBelow(vowels.length)]
      parts.push(o.upper && w === randomBelow(words) ? word[0].toUpperCase() + word.slice(1) : word)
    }
    if (o.digits) parts.push(String(randomBelow(90) + 10))
    return parts.join(o.symbols ? '-' : '')
  }
  const sets = [LOWER, o.upper ? UPPER : '', o.digits ? DIGITS : '', o.symbols ? SYMBOLS : ''].filter(Boolean)
  const all = sets.join('')
  const length = Math.min(128, Math.max(6, o.length))
  for (;;) {
    let pw = ''
    for (let i = 0; i < length; i++) pw += all[randomBelow(all.length)]
    // every chosen kind of character appears at least once
    if (sets.every((set) => [...pw].some((c) => set.includes(c)))) return pw
  }
}

// ------------------------------------------------------------------ hashes

export async function digest(algo: 'SHA-1' | 'SHA-256' | 'SHA-512', text: string): Promise<string> {
  const buf = await crypto.subtle.digest(algo, new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ------------------------------------------------------------------ decoders

export type DecodeMode = 'base64-decode' | 'base64-encode' | 'url-decode' | 'url-encode' | 'hex-decode' | 'hex-encode' | 'html-decode' | 'jwt'

function bytesToText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4)
  const bin = atob(padded)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

export function convert(mode: Exclude<DecodeMode, 'jwt'>, input: string): string {
  switch (mode) {
    case 'base64-decode':
      return bytesToText(base64ToBytes(input))
    case 'base64-encode':
      return bytesToBase64(new TextEncoder().encode(input))
    case 'url-decode':
      return decodeURIComponent(input.replace(/\+/g, ' '))
    case 'url-encode':
      return encodeURIComponent(input)
    case 'hex-decode': {
      const hex = input.replace(/^0x/i, '').replace(/[\s:,-]/g, '')
      if (!/^([0-9a-f]{2})*$/i.test(hex)) throw new Error('hex')
      return bytesToText(Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16)))
    }
    case 'hex-encode':
      return [...new TextEncoder().encode(input)].map((b) => b.toString(16).padStart(2, '0')).join(' ')
    case 'html-decode': {
      // DOMParser builds an inert document: no scripts run, nothing loads
      const doc = new DOMParser().parseFromString(`<!doctype html><body>${input}`, 'text/html')
      return doc.body.textContent ?? ''
    }
  }
}

export interface Jwt {
  header: Record<string, unknown>
  payload: Record<string, unknown>
  signed: boolean
  warnings: ('alg-none' | 'expired' | 'not-yet' | 'no-exp')[]
  exp: number | null
  iat: number | null
}

export function decodeJwt(token: string): Jwt {
  const parts = token.trim().split('.')
  if (parts.length < 2 || parts.length > 3) throw new Error('jwt')
  const header = JSON.parse(bytesToText(base64ToBytes(parts[0]))) as Record<string, unknown>
  const payload = JSON.parse(bytesToText(base64ToBytes(parts[1]))) as Record<string, unknown>
  const warnings: Jwt['warnings'] = []
  const alg = String(header.alg ?? '').toLowerCase()
  if (alg === 'none' || !parts[2]) warnings.push('alg-none')
  const now = Date.now() / 1000
  const exp = typeof payload.exp === 'number' ? payload.exp : null
  const nbf = typeof payload.nbf === 'number' ? payload.nbf : null
  if (exp === null) warnings.push('no-exp')
  else if (exp < now) warnings.push('expired')
  if (nbf !== null && nbf > now) warnings.push('not-yet')
  return { header, payload, signed: !!parts[2], warnings, exp, iat: typeof payload.iat === 'number' ? payload.iat : null }
}

/** Guess what a pasted blob is, to pick the right decoder for the user. */
export function guessMode(input: string): DecodeMode | null {
  const s = input.trim()
  if (/^eyJ[\w-]*\.eyJ[\w-]*\.?[\w-]*$/.test(s)) return 'jwt'
  if (/%[0-9a-f]{2}/i.test(s)) return 'url-decode'
  if (/&(#\d+|#x[0-9a-f]+|[a-z]+);/i.test(s)) return 'html-decode'
  if (/^(0x)?([0-9a-f]{2}[\s:]?){4,}$/i.test(s)) return 'hex-decode'
  if (s.length >= 8 && /^[A-Za-z0-9+/_-]+={0,2}$/.test(s) && s.length % 4 !== 1) return 'base64-decode'
  return null
}
