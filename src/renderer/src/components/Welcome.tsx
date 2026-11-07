import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Check, Columns2, Monitor, Moon, ScanSearch, ShieldAlert, ShieldCheck, Sun } from 'lucide-react'
import type { Settings } from '@shared/types'
import { ui } from '@/lib/api'
import { BRAND, LANGUAGES, t, type Lang } from '@/lib/i18n'
import { useStore } from '@/lib/store'
import { cls } from './bits'
import { AccountForm } from './AccountForm'

const STEPS = ['welcome.stepLanguage', 'welcome.stepLook', 'welcome.stepAccount', 'welcome.stepReady'] as const

const save = (patch: Partial<Settings>) => void ui().invoke('settings:set', patch)

/**
 * First-run screen: language, dark or light, Halyard account, then a short tour of what protects you.
 * With `accountOnly` it shows just the account step (opened from the menu or Settings).
 */
export function Welcome({ settings, accountOnly = false }: { settings: Settings; accountOnly?: boolean }) {
  const [step, setStep] = useState(accountOnly ? 3 : 0)
  const account = useStore((s) => s.account)
  const close = () => useStore.getState().setOverlay(null)

  const next = () => setStep((s) => Math.min(4, s + 1))
  const back = () => setStep((s) => Math.max(0, s - 1))
  const finish = () => save({ onboarded: true })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && accountOnly) return close()
      // the account step is a real form and handles Enter itself
      if (e.key !== 'Enter' || e.target instanceof HTMLButtonElement || step === 3) return
      if (step === 4) finish()
      else next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const firstName = settings.userName.trim().split(/\s+/)[0]

  return (
    <div className={cls('welcome', `is-step-${step}`)}>
      <WelcomeDecor />
      <div className="wl-drag drag" />

      {step > 0 && !accountOnly && (
        <ol className="wl-progress" aria-label="Progress">
          {STEPS.map((key, i) => (
            <li key={key} className={cls(i + 1 === step && 'is-current', i + 1 < step && 'is-done')}>
              <span className="wl-progress-dot">{i + 1 < step ? <Check size={11} strokeWidth={3} /> : i + 1}</span>
              <span className="wl-progress-label">{t(key)}</span>
            </li>
          ))}
        </ol>
      )}

      <section key={step} className="wl-card" aria-live="polite">
        {step === 0 && (
          <div className="wl-intro">
            <SailLogo />
            <p className="wl-eyebrow">{t('welcome.hello')}</p>
            <h1 className="wl-brand">{BRAND}</h1>
            <p className="wl-tagline">{t('welcome.tagline')}</p>
            <button type="button" className="wl-btn wl-btn-primary wl-btn-lg" onClick={next} autoFocus>
              {t('welcome.start')} <ArrowRight size={16} />
            </button>
          </div>
        )}

        {step === 1 && (
          <Panel title={t('welcome.langTitle')} hint={t('welcome.langHint')}>
            <div className="wl-options" role="radiogroup">
              {LANGUAGES.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  role="radio"
                  aria-checked={settings.language === l.id}
                  className={cls('wl-option wl-lang', settings.language === l.id && 'is-on')}
                  onClick={() => save({ language: l.id as Lang })}
                >
                  <span className="wl-lang-code">{l.id === 'pt-BR' ? 'PT' : l.id.toUpperCase()}</span>
                  <span className="wl-option-text">
                    <strong>{l.name}</strong>
                    <small>{l.region}</small>
                  </span>
                  <span className="wl-tick">
                    <Check size={13} strokeWidth={3} />
                  </span>
                </button>
              ))}
            </div>
            <Nav onBack={back} onNext={next} />
          </Panel>
        )}

        {step === 2 && (
          <Panel title={t('welcome.lookTitle')} hint={t('welcome.lookHint')}>
            <div className="wl-themes" role="radiogroup">
              {(['dark', 'light'] as const).map((theme) => (
                <button
                  key={theme}
                  type="button"
                  role="radio"
                  aria-checked={settings.theme === theme}
                  className={cls('wl-theme', settings.theme === theme && 'is-on')}
                  onClick={() => save({ theme })}
                >
                  <MiniBrowser theme={theme} />
                  <span className="wl-theme-label">
                    {theme === 'dark' ? <Moon size={14} /> : <Sun size={14} />}
                    {theme === 'dark' ? t('welcome.lookDark') : t('welcome.lookLight')}
                    <span className="wl-tick">
                      <Check size={13} strokeWidth={3} />
                    </span>
                  </span>
                </button>
              ))}
            </div>
            <button
              type="button"
              role="radio"
              aria-checked={settings.theme === 'system'}
              className={cls('wl-system', settings.theme === 'system' && 'is-on')}
              onClick={() => save({ theme: 'system' })}
            >
              <Monitor size={14} /> {t('welcome.lookSystem')}
              {settings.theme === 'system' && <Check size={13} strokeWidth={3} />}
            </button>
            <Nav onBack={back} onNext={next} />
          </Panel>
        )}

        {step === 3 && (
          <AccountForm
            account={account}
            settings={settings}
            backLabel={accountOnly ? t('common.cancel') : t('common.back')}
            onBack={accountOnly ? close : back}
            onDone={accountOnly ? close : next}
          />
        )}

        {step === 4 && (
          <Panel
            title={firstName ? t('welcome.readyTitleName', { name: firstName }) : t('welcome.readyTitle')}
            hint={t('welcome.readyHint')}
          >
            <ul className="wl-features">
              <Feature icon={<ShieldCheck size={18} />} text={t('welcome.f1')} delay={0} />
              <Feature icon={<ShieldAlert size={18} />} text={t('welcome.f2')} delay={1} />
              <Feature icon={<ScanSearch size={18} />} text={t('welcome.f3')} delay={2} />
              <Feature icon={<Columns2 size={18} />} text={t('welcome.f4')} delay={3} />
            </ul>
            <div className="wl-nav">
              <button type="button" className="wl-btn wl-btn-ghost" onClick={back}>
                <ArrowLeft size={15} /> {t('common.back')}
              </button>
              <span className="grow" />
              <button type="button" className="wl-btn wl-btn-primary wl-btn-lg" onClick={finish} autoFocus>
                {t('welcome.go')} <ArrowRight size={16} />
              </button>
            </div>
          </Panel>
        )}
      </section>
    </div>
  )
}

function Panel({ title, hint, icon, children }: { title: string; hint: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="wl-panel">
      {icon && <span className="wl-panel-icon">{icon}</span>}
      <h2 className="wl-title">{title}</h2>
      <p className="wl-hint">{hint}</p>
      {children}
    </div>
  )
}

function Nav({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return (
    <div className="wl-nav">
      <button type="button" className="wl-btn wl-btn-ghost" onClick={onBack}>
        <ArrowLeft size={15} /> {t('common.back')}
      </button>
      <span className="grow" />
      <button ref={ref} type="button" className="wl-btn wl-btn-primary" onClick={onNext}>
        {t('common.continue')} <ArrowRight size={15} />
      </button>
    </div>
  )
}

function Feature({ icon, text, delay }: { icon: ReactNode; text: string; delay: number }) {
  return (
    <li style={{ ['--delay' as string]: `${delay * 90 + 120}ms` }}>
      <span className="wl-feature-icon">{icon}</span>
      {text}
    </li>
  )
}

/** A tiny browser drawn in fixed colours, so both previews show at once. */
function MiniBrowser({ theme }: { theme: 'dark' | 'light' }) {
  return (
    <span className={cls('mini', `is-${theme}`)} aria-hidden>
      <span className="mini-side">
        <i />
        <i className="is-on" />
        <i />
        <i />
      </span>
      <span className="mini-main">
        <span className="mini-bar" />
        <span className="mini-page">
          <b />
          <i />
          <i />
          <i className="short" />
        </span>
      </span>
    </span>
  )
}

export function SailLogo({ size = 96 }: { size?: number }) {
  return (
    <svg className="wl-logo" width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <defs>
        <linearGradient id="wl-logo-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="oklch(0.66 0.2 285)" />
          <stop offset="1" stopColor="oklch(0.6 0.19 255)" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="92" height="92" rx="24" fill="url(#wl-logo-bg)" />
      <path d="M46 20 C 64 34, 76 52, 77 70 L 46 70 Z" fill="white" />
      <path d="M42 29 L 42 70 L 21 70 Z" fill="white" opacity="0.82" />
      <rect x="28" y="75" width="47" height="5" rx="2.5" fill="white" />
    </svg>
  )
}

// Rough outline of the Halyard ("the sails") constellation.
const CONSTELLATION: [number, number][] = [
  [8, 62], [20, 48], [33, 54], [46, 38], [58, 44], [70, 30], [84, 36], [92, 20]
]

function WelcomeDecor() {
  const stars = useMemo(() => {
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    return Array.from({ length: 70 }, () => ({ x: rnd() * 100, y: rnd() * 100, r: rnd() * 1.4 + 0.4, d: rnd() * 6 }))
  }, [])
  return (
    <div className="wl-decor" aria-hidden>
      <span className="wl-orb wl-orb-a" />
      <span className="wl-orb wl-orb-b" />
      <span className="wl-orb wl-orb-c" />
      <svg className="wl-stars" viewBox="0 0 100 100" preserveAspectRatio="none">
        {stars.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r * 0.12} style={{ animationDelay: `${s.d}s` }} />
        ))}
      </svg>
      <svg className="wl-constellation" viewBox="0 0 100 80">
        <polyline points={CONSTELLATION.map(([x, y]) => `${x},${y}`).join(' ')} />
        {CONSTELLATION.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 1.5 : 1} style={{ animationDelay: `${i * 0.4}s` }} />
        ))}
      </svg>
      <svg className="wl-waves" viewBox="0 0 1440 220" preserveAspectRatio="none">
        <path className="wl-wave wl-wave-back" d="M0 120 C 240 60 480 180 720 120 C 960 60 1200 180 1440 120 L 1440 220 L 0 220 Z" />
        <path className="wl-wave wl-wave-front" d="M0 150 C 240 200 480 100 720 150 C 960 200 1200 100 1440 150 L 1440 220 L 0 220 Z" />
      </svg>
    </div>
  )
}
