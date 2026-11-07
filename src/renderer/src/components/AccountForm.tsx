import { useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, CircleCheck, Eye, EyeOff, LockKeyhole, MailCheck, TriangleAlert, UserRound } from 'lucide-react'
import type { AccountError, AccountResult, AccountState, Settings } from '@shared/types'
import { ui } from '@/lib/api'
import { t, type I18nKey } from '@/lib/i18n'
import { cls } from './bits'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

type Mode = 'signup' | 'signin' | 'sent'

interface Props {
  account: AccountState | null
  settings: Settings
  backLabel: string
  onBack: () => void
  /** Signed in, or the user chose to go on without an account. */
  onDone: () => void
}

/** Create an account or sign in. The password only lives in this form until it is sent to main. */
export function AccountForm({ account, settings, backLabel, onBack, onDone }: Props) {
  const [mode, setMode] = useState<Mode>('signup')
  const [name, setName] = useState(settings.userName)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<AccountError | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const saveName = () => {
    if (name.trim() && name.trim() !== settings.userName) void ui().invoke('settings:set', { userName: name.trim() })
  }

  if (!account?.configured) {
    return (
      <Shell icon={<UserRound size={20} />} title={t('acct.offTitle')} hint={t('acct.off')}>
        <form
          className="wl-form"
          onSubmit={(e) => {
            e.preventDefault()
            saveName()
            onDone()
          }}
        >
          <label className="wl-field">
            <span>{t('welcome.name')}</span>
            <input value={name} maxLength={40} autoComplete="name" onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
          <Nav backLabel={backLabel} onBack={onBack}>
            <button type="submit" className="wl-btn wl-btn-primary">
              {t('common.continue')} <ArrowRight size={15} />
            </button>
          </Nav>
        </form>
      </Shell>
    )
  }

  if (account.user) {
    return (
      <Shell icon={<CircleCheck size={20} />} title={t('acct.title')} hint={t('acct.synced')}>
        <div className="wl-signed">
          <span className="wl-avatar">{(settings.userName || account.user.email).slice(0, 1).toUpperCase()}</span>
          <span className="wl-option-text">
            <strong>{settings.userName || account.user.email}</strong>
            <small>{t('acct.signedAs', { email: account.user.email })}</small>
          </span>
        </div>
        <Nav backLabel={backLabel} onBack={onBack}>
          <button type="button" className="wl-btn wl-btn-primary" onClick={onDone} autoFocus>
            {t('common.continue')} <ArrowRight size={15} />
          </button>
        </Nav>
      </Shell>
    )
  }

  const run = async (call: () => Promise<AccountResult>) => {
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const r = await call()
      if (!r.ok) {
        setError(r.error)
        if (r.error === 'email-exists') setMode('signin')
        return r
      }
      return r
    } catch {
      setError('unknown')
      return null
    } finally {
      setBusy(false)
    }
  }

  const submit = async () => {
    const e = email.trim()
    if (!EMAIL.test(e)) return setError('invalid-email')
    if (password.length < 8) return setError('weak-password')
    if (mode === 'signup') {
      const r = await run(() => ui().invoke('account:sign-up', e, password, name.trim()))
      if (r?.ok) {
        setPassword('')
        if (r.status === 'check-email') setMode('sent')
        else onDone()
      }
    } else {
      const r = await run(() => ui().invoke('account:sign-in', e, password))
      if (r?.ok) {
        setPassword('')
        onDone()
      }
    }
  }

  if (mode === 'sent') {
    return (
      <Shell icon={<MailCheck size={20} />} title={t('acct.sentTitle')} hint={t('acct.sent', { email: email.trim() })}>
        <p className="wl-small">{t('acct.sentSpam')}</p>
        {note && <p className="wl-note">{note}</p>}
        {error && <Alert error={error} />}
        <Nav backLabel={t('common.back')} onBack={() => setMode('signup')}>
          <button
            type="button"
            className="wl-btn"
            disabled={busy}
            onClick={async () => {
              const r = await run(() => ui().invoke('account:resend', email.trim()))
              if (r?.ok) setNote(t('acct.resent'))
            }}
          >
            {t('acct.resend')}
          </button>
          <button
            type="button"
            className="wl-btn wl-btn-primary"
            onClick={() => {
              setError(null)
              setNote(null)
              setMode('signin')
            }}
            autoFocus
          >
            {t('acct.confirmed')} <ArrowRight size={15} />
          </button>
        </Nav>
      </Shell>
    )
  }

  return (
    <Shell icon={<LockKeyhole size={20} />} title={t('acct.title')} hint={t('acct.hint')}>
      <div className="wl-tabs" role="tablist">
        {(['signup', 'signin'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            className={cls('wl-tab', mode === m && 'is-on')}
            onClick={() => {
              setMode(m)
              setError(null)
            }}
          >
            {m === 'signup' ? t('acct.signupTab') : t('acct.signinTab')}
          </button>
        ))}
      </div>
      <form
        className="wl-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (!busy) void submit()
        }}
      >
        {mode === 'signup' && (
          <label className="wl-field">
            <span>{t('welcome.name')}</span>
            <input value={name} maxLength={40} autoComplete="name" onChange={(e) => setName(e.target.value)} />
          </label>
        )}
        <label className={cls('wl-field', error === 'invalid-email' && 'is-invalid')}>
          <span>{t('welcome.email')}</span>
          <input
            type="email"
            value={email}
            maxLength={254}
            autoComplete="email"
            placeholder={t('set.emailPh')}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
        </label>
        <label className={cls('wl-field', error === 'weak-password' && 'is-invalid')}>
          <span>{t('acct.password')}</span>
          <span className="wl-pass">
            <input
              type={show ? 'text' : 'password'}
              value={password}
              maxLength={72}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              placeholder={mode === 'signup' ? t('acct.passwordHint') : ''}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="button" className="wl-eye" aria-label={show ? t('acct.hide') : t('acct.show')} title={show ? t('acct.hide') : t('acct.show')} onClick={() => setShow(!show)}>
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </span>
        </label>
        {error && <Alert error={error} />}
        <p className="wl-small">{t('acct.privacy')}</p>
        <Nav backLabel={backLabel} onBack={onBack}>
          <button
            type="button"
            className="wl-btn"
            onClick={() => {
              saveName()
              onDone()
            }}
          >
            {t('welcome.skip')}
          </button>
          <button type="submit" className="wl-btn wl-btn-primary" disabled={busy}>
            {busy ? t('acct.working') : mode === 'signup' ? t('acct.create') : t('acct.enter')}
            {!busy && <ArrowRight size={15} />}
          </button>
        </Nav>
      </form>
    </Shell>
  )
}

function Shell({ icon, title, hint, children }: { icon: ReactNode; title: string; hint: string; children: ReactNode }) {
  return (
    <div className="wl-panel">
      <span className="wl-panel-icon">{icon}</span>
      <h2 className="wl-title">{title}</h2>
      <p className="wl-hint">{hint}</p>
      {children}
    </div>
  )
}

function Nav({ backLabel, onBack, children }: { backLabel: string; onBack: () => void; children: ReactNode }) {
  return (
    <div className="wl-nav">
      <button type="button" className="wl-btn wl-btn-ghost" onClick={onBack}>
        <ArrowLeft size={15} /> {backLabel}
      </button>
      <span className="grow" />
      {children}
    </div>
  )
}

function Alert({ error }: { error: AccountError }) {
  return (
    <p className="wl-alert" role="alert">
      <TriangleAlert size={15} /> {t(`acct.err.${error}` as I18nKey)}
    </p>
  )
}
