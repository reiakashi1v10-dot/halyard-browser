import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import { createClient, type AuthError, type SupabaseClient, type User } from '@supabase/supabase-js'
import { isLang } from '@shared/i18n'
import type { AccountError, AccountResult, AccountState, Settings } from '@shared/types'
import type { Profile } from './profile'

/*
 * Halyard accounts run on Supabase Auth, entirely in the main process: web pages and the
 * UI never see a token. Only the project's *publishable* key ships with the app; the
 * database is protected by row-level security (see supabase/schema.sql).
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const THEMES = new Set(['system', 'dark', 'light'])
const MIN_PASSWORD = 8
const MAX_PASSWORD = 72 // bcrypt only reads the first 72 bytes

interface SupabaseConfig {
  url: string
  key: string
}

/** Build-time config from .env. Refuses anything that is not a public client key. */
export function supabaseConfig(): SupabaseConfig | null {
  const url = (import.meta.env.MAIN_VITE_SUPABASE_URL ?? '').trim()
  const key = (import.meta.env.MAIN_VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim()
  // empty, or still the placeholders from .env.example
  if (!url || !key || url.includes('your-project-ref') || key.includes('xxxxxxxx')) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    console.error('[account] MAIN_VITE_SUPABASE_URL is not a valid URL')
    return null
  }
  const local = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost'
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) {
    console.error('[account] the Supabase URL must use https')
    return null
  }
  if (!isPublicKey(key)) {
    console.error('[account] refusing a secret Supabase key: use the publishable key (sb_publishable_...)')
    return null
  }
  return { url: parsed.origin, key }
}

/** Publishable keys, or the legacy anon JWT. Secret / service_role keys bypass RLS and must never ship. */
export function isPublicKey(key: string): boolean {
  if (key.startsWith('sb_publishable_')) return true
  if (key.startsWith('sb_secret_')) return false
  const parts = key.split('.')
  if (parts.length !== 3) return false
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { role?: unknown }
    return payload.role === 'anon'
  } catch {
    return false
  }
}

/** Session storage for supabase-js, encrypted with the Windows user's key (DPAPI). */
class SecureStore {
  private data: Record<string, string> = {}
  private readonly loaded: Promise<void>
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly file: string) {
    this.loaded = this.load()
  }

  private async load(): Promise<void> {
    try {
      if (!existsSync(this.file) || !(await safeStorage.isAsyncEncryptionAvailable())) return
      const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(await readFile(this.file))
      const parsed: unknown = JSON.parse(result)
      if (parsed && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed)) if (typeof v === 'string') this.data[k] = v
      }
      if (shouldReEncrypt) void this.queueSave()
    } catch {
      // unreadable (another Windows user, corrupted): start signed out
      this.data = {}
    }
  }

  async getItem(key: string): Promise<string | null> {
    await this.loaded
    return this.data[key] ?? null
  }

  async setItem(key: string, value: string): Promise<void> {
    await this.loaded
    this.data[key] = value
    await this.queueSave()
  }

  async removeItem(key: string): Promise<void> {
    await this.loaded
    delete this.data[key]
    await this.queueSave()
  }

  /** One write at a time, always with the latest data. */
  private queueSave(): Promise<void> {
    this.writing = this.writing.then(() => this.save()).catch((err: unknown) => console.error('[account] could not save the session', err))
    return this.writing
  }

  private async save(): Promise<void> {
    // without OS encryption the session only lives in memory: never write tokens in plain text
    if (!(await safeStorage.isAsyncEncryptionAvailable())) return
    if (Object.keys(this.data).length === 0) {
      await rm(this.file, { force: true })
      return
    }
    const tmp = `${this.file}.tmp`
    await writeFile(tmp, await safeStorage.encryptStringAsync(JSON.stringify(this.data)))
    await rename(tmp, this.file)
  }
}

type Synced = Pick<Settings, 'userName' | 'language' | 'theme'>

const snapshot = (s: Synced) => JSON.stringify([s.userName, s.language, s.theme])

export class Account extends EventEmitter<{ change: [AccountState] }> {
  private readonly client: SupabaseClient | null
  private user: User | null = null
  private ready = false
  private lastAttempt = 0
  private pushTimer: NodeJS.Timeout | null = null
  private synced = ''
  private pulling = false

  constructor(private readonly profile: Profile) {
    super()
    const config = supabaseConfig()
    if (!config) {
      this.client = null
      this.ready = true
      return
    }
    this.client = createClient(config.url, config.key, {
      auth: {
        storage: new SecureStore(join(app.getPath('userData'), 'account.bin')),
        storageKey: 'halyard-auth',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        // the confirmation link carries a one-time code, useless without this app's verifier
        flowType: 'pkce'
      }
    })
    this.client.auth.onAuthStateChange((_event, session) => {
      const before = this.user?.id
      this.user = session?.user ?? null
      this.ready = true
      // never await Supabase calls inside this callback: defer them
      setTimeout(() => {
        if (this.user && this.user.id !== before) void this.signedIn()
        if (!this.user && before) this.profile.updateSettings({ email: '' })
        this.emit('change', this.state())
      }, 0)
    })
    // outside a browser supabase-js does not refresh tokens on its own
    void this.client.auth.startAutoRefresh()
  }

  get configured(): boolean {
    return this.client !== null
  }

  state(): AccountState {
    return {
      configured: this.configured,
      ready: this.ready,
      user: this.user ? { email: this.user.email ?? '' } : null
    }
  }

  async signUp(email: string, password: string, name: string): Promise<AccountResult> {
    const check = this.precheck(email, password)
    if (check) return { ok: false, error: check }
    const { data, error } = await this.client!.auth.signUp({ email: email.trim(), password })
    if (error) return { ok: false, error: mapError(error) }
    if (name.trim()) this.profile.updateSettings({ userName: name.trim().slice(0, 40) })
    // with email confirmation on, Supabase answers the same way for new and existing
    // addresses (no account enumeration): always tell the user to check their inbox
    return { ok: true, status: data.session ? 'signed-in' : 'check-email' }
  }

  async signIn(email: string, password: string): Promise<AccountResult> {
    const check = this.precheck(email, password)
    if (check) return { ok: false, error: check }
    const { error } = await this.client!.auth.signInWithPassword({ email: email.trim(), password })
    if (error) return { ok: false, error: mapError(error) }
    return { ok: true, status: 'signed-in' }
  }

  async resend(email: string): Promise<AccountResult> {
    if (!this.client) return { ok: false, error: 'not-configured' }
    if (!EMAIL.test(email.trim())) return { ok: false, error: 'invalid-email' }
    if (this.throttled()) return { ok: false, error: 'rate-limited' }
    const { error } = await this.client.auth.resend({ type: 'signup', email: email.trim() })
    if (error) return { ok: false, error: mapError(error) }
    return { ok: true, status: 'check-email' }
  }

  async signOut(): Promise<void> {
    if (!this.client) return
    if (this.pushTimer) clearTimeout(this.pushTimer)
    this.pushTimer = null
    // only this computer: other devices stay signed in
    await this.client.auth.signOut({ scope: 'local' })
  }

  /** Local name, language or theme changed: send them to the profile shortly after. */
  settingsChanged(settings: Settings): void {
    if (!this.client || !this.user || this.pulling || snapshot(settings) === this.synced) return
    if (this.pushTimer) clearTimeout(this.pushTimer)
    this.pushTimer = setTimeout(() => void this.push(), 1500)
  }

  private precheck(email: string, password: string): AccountError | null {
    if (!this.client) return 'not-configured'
    const e = email.trim()
    if (e.length > 254 || !EMAIL.test(e)) return 'invalid-email'
    if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) return 'weak-password'
    if (this.throttled()) return 'rate-limited'
    return null
  }

  private throttled(): boolean {
    const now = Date.now()
    if (now - this.lastAttempt < 1500) return true
    this.lastAttempt = now
    return false
  }

  /** First pull wins: the account's saved name, language and theme replace the local ones. */
  private async signedIn(): Promise<void> {
    const user = this.user
    if (!this.client || !user) return
    this.pulling = true
    try {
      await this.pull(user)
    } finally {
      this.pulling = false
    }
  }

  private async pull(user: User): Promise<void> {
    if (!this.client) return
    this.profile.updateSettings({ email: user.email ?? '' })
    const { data, error } = await this.client.from('profiles').select('display_name, language, theme').eq('id', user.id).maybeSingle()
    if (error) {
      console.warn('[account] could not read the profile:', error.code, error.message)
      return
    }
    if (!data) {
      this.pulling = false
      await this.push()
      return
    }
    // rows come from the network: validate before using them
    const patch: Partial<Settings> = {}
    if (typeof data.display_name === 'string' && data.display_name) patch.userName = data.display_name.slice(0, 40)
    if (isLang(data.language)) patch.language = data.language
    if (typeof data.theme === 'string' && THEMES.has(data.theme)) patch.theme = data.theme as Settings['theme']
    this.synced = snapshot({ ...this.profile.settings, ...patch })
    this.profile.updateSettings(patch)
  }

  private async push(): Promise<void> {
    this.pushTimer = null
    const user = this.user
    if (!this.client || !user) return
    const s = this.profile.settings
    const { error } = await this.client.from('profiles').upsert(
      { id: user.id, display_name: s.userName.slice(0, 40), language: s.language, theme: s.theme, updated_at: new Date().toISOString() },
      { onConflict: 'id' }
    )
    if (error) console.warn('[account] could not save the profile:', error.code, error.message)
    else this.synced = snapshot(s)
  }
}

function mapError(err: AuthError): AccountError {
  const code = err.code ?? ''
  if (code === 'invalid_credentials') return 'invalid-credentials'
  if (code === 'email_not_confirmed') return 'email-not-confirmed'
  if (code === 'weak_password') return 'weak-password'
  if (code === 'user_already_exists' || code === 'email_exists') return 'email-exists'
  if (code === 'email_address_invalid' || code === 'validation_failed') return 'invalid-email'
  if (code === 'signup_disabled' || code === 'email_provider_disabled') return 'signup-disabled'
  if (code.startsWith('over_') || err.status === 429) return 'rate-limited'
  if (err.name === 'AuthRetryableFetchError' || !err.status) return 'network'
  console.warn('[account] auth error:', code || err.status)
  return 'unknown'
}
