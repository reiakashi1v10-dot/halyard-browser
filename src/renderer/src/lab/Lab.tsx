import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import {
  Barcode,
  Binary,
  Eraser,
  FileWarning,
  IdCard,
  LockKeyhole,
  Mail,
  MapPinOff,
  MessageSquareWarning,
  TextSearch,
  Check,
  ChevronRight,
  Copy,
  Dices,
  Download,
  Eye,
  EyeOff,
  FileSearch,
  FlaskConical,
  Globe,
  ImageUp,
  KeyRound,
  LayoutGrid,
  Link2,
  Loader2,
  Lock,
  LockOpen,
  QrCode,
  ScanSearch,
  Search,
  Server,
  ShieldCheck,
  ShieldX,
  Wifi,
  type LucideIcon
} from 'lucide-react'
import type { LinkReport, Settings, SiteAudit } from '@shared/types'
import { parseQrPayload } from '@shared/qrpayload'
import { lab } from '@/lib/api'
import { BRAND, locale, setLang, t, type I18nKey } from '@/lib/i18n'
import { decodeQr, imageFrom, qrDataUrl, readFile, wifiPayload } from '@/lib/qr'
import { LEVEL_ICON, linkOf, PayloadDetails, payloadNotes, reasonLevel, TYPE_ICON, worst, type Level } from '@/components/QrCheck'
import { Busy, cls, CopyBtn, Err, errorText, Mono } from './ui'
import { BoletoTool, CleanTool, DocTool, FileTool, HiddenTool, MailTool, PhotoTool, ScamTool, TokenTool, VaultTool } from './MoreTools'
import { convert, decodeJwt, digest, generatePassword, guessMode, strengthOf, type DecodeMode, type GenOptions, type Jwt } from './tools'

type ToolId =
  | 'link'
  | 'audit'
  | 'password'
  | 'hash'
  | 'decode'
  | 'dns'
  | 'qrgen'
  | 'scam'
  | 'boleto'
  | 'doc'
  | 'photo'
  | 'hidden'
  | 'mail'
  | 'vault'
  | 'token'
  | 'clean'
  | 'file'

type GroupId = 'web' | 'scams' | 'files' | 'secrets'

const GROUPS: { id: GroupId; tools: { id: ToolId; icon: LucideIcon }[] }[] = [
  {
    id: 'web',
    tools: [
      { id: 'link', icon: ScanSearch },
      { id: 'audit', icon: ShieldCheck },
      { id: 'clean', icon: Eraser },
      { id: 'dns', icon: Server }
    ]
  },
  {
    id: 'scams',
    tools: [
      { id: 'scam', icon: MessageSquareWarning },
      { id: 'mail', icon: Mail },
      { id: 'boleto', icon: Barcode },
      { id: 'doc', icon: IdCard }
    ]
  },
  {
    id: 'files',
    tools: [
      { id: 'file', icon: FileWarning },
      { id: 'photo', icon: MapPinOff },
      { id: 'hash', icon: FileSearch },
      { id: 'hidden', icon: TextSearch }
    ]
  },
  {
    id: 'secrets',
    tools: [
      { id: 'password', icon: KeyRound },
      { id: 'vault', icon: LockKeyhole },
      { id: 'token', icon: Dices },
      { id: 'decode', icon: Binary },
      { id: 'qrgen', icon: QrCode }
    ]
  }
]

const ALL_TOOLS = GROUPS.flatMap((g) => g.tools.map((x) => ({ ...x, group: g.id })))
const LAST_TOOL = 'halyard-lab-tool'

function savedTool(): ToolId | 'home' {
  try {
    const id = localStorage.getItem(LAST_TOOL)
    return ALL_TOOLS.some((x) => x.id === id) ? (id as ToolId) : 'home'
  } catch {
    return 'home'
  }
}

/** Matches without caring about accents or case ("seguranca" finds "segurança"). */
function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

function ToolIcon({ group, icon: Icon, size = 17 }: { group: GroupId; icon: LucideIcon; size?: number }) {
  return (
    <span className="lab-ticon" data-group={group}>
      <Icon size={size} />
    </span>
  )
}

function Home({ open }: { open: (id: ToolId) => void }) {
  return (
    <section className="lab-tool lab-home">
      <header className="lab-hero">
        <span className="lab-hero-logo">
          <FlaskConical size={26} />
        </span>
        <div>
          <h1>{t('lab.home.title')}</h1>
          <p>{t('lab.home.intro')}</p>
        </div>
      </header>
      {GROUPS.map((g) => (
        <div key={g.id} className="lab-home-group" data-group={g.id}>
          <h2>{t(`lab.group.${g.id}` as I18nKey)}</h2>
          <div className="lab-home-grid">
            {g.tools.map((x) => (
              <button key={x.id} type="button" className="lab-home-card" onClick={() => open(x.id)}>
                <ToolIcon group={g.id} icon={x.icon} size={18} />
                <strong>{t(`lab.tool.${x.id}` as I18nKey)}</strong>
                <span>{t(`lab.hint.${x.id}` as I18nKey)}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="lab-home-note">
        <ShieldCheck size={14} />
        <span>{t('lab.ethics')}</span>
      </p>
    </section>
  )
}

export function Lab() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [tool, setTool] = useState<ToolId | 'home'>(savedTool)
  const [query, setQuery] = useState('')
  const search = useRef<HTMLInputElement>(null)
  const main = useRef<HTMLElement>(null)

  setLang(settings?.language)

  useEffect(() => {
    const load = () => void lab().invoke('lab:settings').then(setSettings)
    load()
    return lab().onSettings(load)
  }, [])

  useEffect(() => {
    document.title = `${BRAND} Lab`
    document.documentElement.lang = settings?.language ?? 'en'
  }, [settings?.language])

  // Ctrl+K (or "/" outside a text field) jumps to the tool search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
      if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) {
        e.preventDefault()
        search.current?.focus()
        search.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const open = (id: ToolId | 'home') => {
    setTool(id)
    setQuery('')
    main.current?.scrollTo({ top: 0 })
    try {
      localStorage.setItem(LAST_TOOL, id)
    } catch {
      // storage can be unavailable; the Lab just opens on the home screen next time
    }
  }

  const q = fold(query.trim())
  const groups = q
    ? GROUPS.map((g) => ({ ...g, tools: g.tools.filter((x) => fold(`${t(`lab.tool.${x.id}` as I18nKey)} ${t(`lab.hint.${x.id}` as I18nKey)}`).includes(q)) })).filter(
        (g) => g.tools.length
      )
    : GROUPS
  const current = ALL_TOOLS.find((x) => x.id === tool)

  return (
    <div className="lab">
      <aside className="lab-side">
        <button type="button" className="lab-brand" onClick={() => open('home')}>
          <span className="lab-logo">
            <FlaskConical size={18} />
          </span>
          <span>
            <strong>Halyard Lab</strong>
            <small>{t('lab.tagline')}</small>
          </span>
        </button>
        <label className="lab-find">
          <Search size={15} />
          <input
            ref={search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && groups[0]) open(groups[0].tools[0].id)
              if (e.key === 'Escape') setQuery('')
            }}
            placeholder={t('lab.find')}
            aria-label={t('lab.find')}
            spellCheck={false}
          />
          <kbd>Ctrl K</kbd>
        </label>
        <nav className="lab-nav" aria-label={t('lab.tools')}>
          {!q && (
            <button type="button" className={cls('lab-nav-item', tool === 'home' && 'is-on')} onClick={() => open('home')}>
              <LayoutGrid size={17} />
              <span>{t('lab.home')}</span>
            </button>
          )}
          {groups.map((g) => (
            <div key={g.id} className="lab-nav-group" data-group={g.id}>
              <span className="lab-nav-label">{t(`lab.group.${g.id}` as I18nKey)}</span>
              {g.tools.map((x) => (
                <button key={x.id} type="button" className={cls('lab-nav-item', tool === x.id && 'is-on')} onClick={() => open(x.id)}>
                  <x.icon size={17} />
                  <span>{t(`lab.tool.${x.id}` as I18nKey)}</span>
                </button>
              ))}
            </div>
          ))}
          {!groups.length && <p className="lab-nav-empty">{t('lab.noMatch')}</p>}
        </nav>
      </aside>
      <main className="lab-main" ref={main}>
        <div className="lab-titlebar" />
        {tool === 'home' || !current ? (
          <Home open={open} />
        ) : (
          <section className="lab-tool" key={tool} data-group={current.group}>
            <header className="lab-tool-head">
              <ToolIcon group={current.group} icon={current.icon} size={22} />
              <div>
                <span className="lab-crumb">
                  <button type="button" onClick={() => open('home')}>
                    {t('lab.home')}
                  </button>
                  <ChevronRight size={12} />
                  {t(`lab.group.${current.group}` as I18nKey)}
                </span>
                <h1>{t(`lab.tool.${tool}` as I18nKey)}</h1>
                <p>{t(`lab.hint.${tool}` as I18nKey)}</p>
              </div>
            </header>
            {tool === 'link' && <LinkTool />}
            {tool === 'audit' && <AuditTool />}
            {tool === 'password' && <PasswordTool />}
            {tool === 'hash' && <HashTool />}
            {tool === 'decode' && <DecodeTool />}
            {tool === 'dns' && <DnsTool secureDns={settings?.secureDns ?? 'cloudflare'} />}
            {tool === 'qrgen' && <QrGenTool />}
            {tool === 'scam' && <ScamTool />}
            {tool === 'boleto' && <BoletoTool />}
            {tool === 'doc' && <DocTool />}
            {tool === 'photo' && <PhotoTool />}
            {tool === 'hidden' && <HiddenTool />}
            {tool === 'mail' && <MailTool />}
            {tool === 'vault' && <VaultTool />}
            {tool === 'token' && <TokenTool />}
            {tool === 'clean' && <CleanTool />}
            {tool === 'file' && <FileTool />}
          </section>
        )}
      </main>
    </div>
  )
}

// ------------------------------------------------------------------ links and QR Codes

function LinkTool() {
  const [input, setInput] = useState('')
  const [raw, setRaw] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [report, setReport] = useState<LinkReport | null>(null)
  const [busy, setBusy] = useState<'decode' | 'check' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const run = (text: string) => {
    const value = text.trim()
    if (!value) return
    setRaw(value)
    setReport(null)
    setError(null)
    const link = linkOf(parseQrPayload(value))
    if (!link) return
    setBusy('check')
    void lab()
      .invoke('lab:analyze', link)
      .then(setReport)
      .catch((e) => setError(errorText(e)))
      .finally(() => setBusy(null))
  }

  const fromImage = (src: string) => {
    setPreview(src)
    setBusy('decode')
    setError(null)
    setRaw(null)
    setReport(null)
    void decodeQr(src)
      .then((found) => {
        setBusy(null)
        if (!found) return setError(t('qr.notFound'))
        setInput(found)
        run(found)
      })
      .catch(() => {
        setBusy(null)
        setError(t('qr.notFound'))
      })
  }

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = imageFrom(e.clipboardData)
      if (!file) return
      e.preventDefault()
      void readFile(file).then(fromImage)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    const file = imageFrom(e.dataTransfer)
    if (file) void readFile(file).then(fromImage)
    else {
      const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')
      if (text) {
        setInput(text)
        run(text)
      }
    }
  }

  const payload = raw ? parseQrPayload(raw) : null
  const notes = payload ? payloadNotes(payload) : []
  let level: Level = payload?.type === 'url' ? 'safe' : 'info'
  for (const n of notes) level = worst(level, n.level)
  if (report) level = worst(level, report.level)
  const link = payload ? linkOf(payload) : null
  const openable = payload?.type === 'url' && report?.kind === 'url'

  return (
    <div className="lab-stack" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <div className="lab-card">
        <div className="lab-inputrow">
          <input
            className="lab-input is-mono"
            placeholder={t('lab.link.placeholder')}
            value={input}
            spellCheck={false}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && run(input)}
            autoFocus
          />
          <button type="button" className="lab-btn is-primary" disabled={!input.trim() || !!busy} onClick={() => run(input)}>
            <ScanSearch size={15} /> <span>{t('lab.analyze')}</span>
          </button>
        </div>
        <div className="lab-drop" role="button" tabIndex={0} onClick={() => fileInput.current?.click()}>
          {preview ? <img src={preview} alt="" className="lab-drop-img" /> : <ImageUp size={22} />}
          <span>{t('lab.link.drop')}</span>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void readFile(f).then(fromImage)
              e.target.value = ''
            }}
          />
        </div>
      </div>

      {busy === 'decode' && <Busy label={t('qr.reading')} />}
      {busy === 'check' && <Busy label={t('qr.checking')} />}
      <Err text={error} />

      {payload && busy !== 'check' && (
        <div className={cls('lab-card lab-verdict', `is-${level}`)}>
          <div className="lab-verdict-top">
            <span className="lab-verdict-icon">{LEVEL_ICON[level]}</span>
            <span>
              <strong>{t(`qr.level.${level}` as I18nKey)}</strong>
              <small>
                {TYPE_ICON[payload.type]} {t(`qr.type.${payload.type}` as I18nKey)}
              </small>
            </span>
          </div>

          {payload.type === 'url' && report && (
            <dl className="lab-dl">
              <dt>{t('lab.link.host')}</dt>
              <dd>
                <Mono>{report.displayHost ?? report.host}</Mono>
                {report.displayHost && report.host && report.displayHost !== report.host && <small> ({report.host})</small>}
              </dd>
              <dt>{t('lab.link.final')}</dt>
              <dd>
                <Mono>{report.finalUrl ?? report.input}</Mono>
              </dd>
            </dl>
          )}
          {payload.type !== 'url' && (
            <div className="qr-details">
              <PayloadDetails p={payload} />
            </div>
          )}

          {(report?.reasons.length || notes.length) > 0 && (
            <ul className="qr-reasons">
              {report?.reasons.map((r) => (
                <li key={`${r.code}|${r.value ?? ''}`} className={`is-${reasonLevel(r.code)}`}>
                  {t(`link.${r.code}` as I18nKey, { value: r.value ?? '' })}
                </li>
              ))}
              {notes.map((n) => (
                <li key={n.text} className={`is-${n.level}`}>
                  {n.text}
                </li>
              ))}
            </ul>
          )}
          {report && report.reasons.length === 0 && payload.type === 'url' && <p className="lab-muted">{t('lab.link.clean')}</p>}

          {report && report.chain.length > 0 && (
            <table className="lab-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t('lab.link.status')}</th>
                  <th>{t('lab.link.address')}</th>
                </tr>
              </thead>
              <tbody>
                {report.chain.map((hop, i) => (
                  <tr key={`${i}:${hop.url}`}>
                    <td>{i + 1}</td>
                    <td className={cls(hop.status >= 300 && hop.status < 400 && 'is-warn', hop.status >= 400 && 'is-bad')}>{hop.status || '—'}</td>
                    <td>
                      <Mono>{hop.url}</Mono>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="lab-actions">
            <CopyBtn text={raw ?? ''} label={t('lab.copyRaw')} />
            <span className="grow" />
            {openable && link && (
              <>
                <button type="button" className="lab-btn" onClick={() => void lab().invoke('lab:open', link, true)}>
                  <Lock size={14} /> <span>{t('qr.openDisposable')}</span>
                </button>
                {level !== 'danger' && (
                  <button type="button" className="lab-btn is-primary" onClick={() => void lab().invoke('lab:open', link, false)}>
                    <Link2 size={14} /> <span>{t('qr.open')}</span>
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ site audit

const HEADER_KEYS: Record<string, string> = {
  'strict-transport-security': 'hsts',
  'content-security-policy': 'csp',
  'x-content-type-options': 'xcto',
  'x-frame-options': 'xfo',
  'referrer-policy': 'referrer',
  'permissions-policy': 'permissions',
  'cross-origin-opener-policy': 'coop'
}

function AuditTool() {
  const [active, setActive] = useState<{ url: string; title: string } | null>(null)
  const [url, setUrl] = useState('')
  const [audit, setAudit] = useState<SiteAudit | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void lab()
      .invoke('lab:active')
      .then((a) => {
        setActive(a)
        if (a) setUrl(a.url)
      })
  }, [])

  const run = (target: string | null) => {
    setBusy(true)
    setError(null)
    setAudit(null)
    void lab()
      .invoke('lab:audit', target)
      .then(setAudit)
      .catch((e) => setError(errorText(e)))
      .finally(() => setBusy(false))
  }

  const days = audit?.certificate ? Math.floor((audit.certificate.validTo - Date.now()) / 86_400_000) : null
  const dateFmt = (ms: number) => new Date(ms).toLocaleDateString(locale(), { day: '2-digit', month: 'short', year: 'numeric' })

  return (
    <div className="lab-stack">
      <div className="lab-card">
        <div className="lab-inputrow">
          <input
            className="lab-input is-mono"
            placeholder="https://exemplo.com.br"
            value={url}
            spellCheck={false}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && url.trim() && run(active && url === active.url ? null : url.trim())}
          />
          <button
            type="button"
            className="lab-btn is-primary"
            disabled={busy || !url.trim()}
            onClick={() => run(active && url === active.url ? null : url.trim())}
          >
            <ShieldCheck size={15} /> <span>{t('lab.audit.run')}</span>
          </button>
        </div>
        {active && (
          <p className="lab-muted">
            {t('lab.audit.active')} <strong>{active.title}</strong>
          </p>
        )}
      </div>

      {busy && <Busy label={t('lab.audit.busy')} />}
      <Err text={error} />

      {audit && (
        <>
          <div className="lab-card lab-grade-card">
            <span className={cls('lab-grade', `is-${audit.grade}`)}>{audit.grade}</span>
            <span className="lab-grade-text">
              <strong>
                {audit.secure ? <Lock size={15} /> : <LockOpen size={15} />} {audit.host}
              </strong>
              <small>{t(`lab.audit.grade.${audit.grade}` as I18nKey)}</small>
            </span>
          </div>

          <div className="lab-card">
            <h2>{t('lab.audit.headers')}</h2>
            <table className="lab-table">
              <tbody>
                {audit.headers.map((h) => (
                  <tr key={h.name}>
                    <td className={h.good ? 'is-good' : 'is-bad'}>{h.good ? <Check size={14} /> : <ShieldX size={14} />}</td>
                    <td>
                      <Mono>{h.name}</Mono>
                      <small className="lab-why">
                        {HEADER_KEYS[h.name] ? t(`lab.h.${HEADER_KEYS[h.name]}` as I18nKey) : t('lab.h.leak', { value: h.value ?? '' })}
                      </small>
                    </td>
                    <td className="lab-val">{h.value ? <Mono>{h.value.length > 140 ? `${h.value.slice(0, 140)}…` : h.value}</Mono> : <span className="lab-muted">{t('lab.audit.missing')}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="lab-grid2">
            <div className="lab-card">
              <h2>{t('lab.audit.cert')}</h2>
              {audit.certificate ? (
                <dl className="lab-dl">
                  <dt>{t('lab.audit.issuer')}</dt>
                  <dd>{audit.certificate.issuer}</dd>
                  <dt>{t('lab.audit.subject')}</dt>
                  <dd>
                    <Mono>{audit.certificate.subject}</Mono>
                  </dd>
                  <dt>{t('lab.audit.valid')}</dt>
                  <dd className={cls(days !== null && days < 0 && 'is-bad', days !== null && days >= 0 && days < 14 && 'is-warn')}>
                    {dateFmt(audit.certificate.validFrom)} → {dateFmt(audit.certificate.validTo)}{' '}
                    <small>({days !== null && days < 0 ? t('lab.audit.expired') : t('lab.audit.daysLeft', { n: days ?? 0 })})</small>
                  </dd>
                  <dt>{t('lab.audit.fingerprint')}</dt>
                  <dd>
                    <Mono>{audit.certificate.fingerprint}</Mono>
                  </dd>
                </dl>
              ) : (
                <p className="lab-muted">{audit.secure ? t('lab.audit.noCert') : t('lab.audit.noHttps')}</p>
              )}
            </div>

            <div className="lab-card">
              <h2>{t('lab.audit.page')}</h2>
              <dl className="lab-dl">
                <dt>{t('lab.audit.blocked')}</dt>
                <dd>{audit.blocked}</dd>
                <dt>{t('lab.audit.cookies')}</dt>
                <dd>{audit.cookies}</dd>
                <dt>{t('lab.audit.perms')}</dt>
                <dd>
                  {audit.permissions.length
                    ? audit.permissions.map((p) => `${p.permission} (${t(p.decision === 'allow' ? 'lab.audit.allowed' : 'lab.audit.denied')})`).join(', ')
                    : t('lab.audit.none')}
                </dd>
              </dl>
            </div>
          </div>

          <div className="lab-card">
            <h2>
              {t('lab.audit.third')} <small>({audit.thirdParties.length})</small>
            </h2>
            {audit.thirdParties.length ? (
              <ul className="lab-hosts">
                {audit.thirdParties.map((p) => (
                  <li key={p.host}>
                    <Globe size={13} />
                    <Mono>{p.host}</Mono>
                    <small>{p.count}</small>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="lab-muted">{active && url === active.url ? t('lab.audit.noThird') : t('lab.audit.openTab')}</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ passwords

function humanTime(seconds: number): string {
  if (seconds < 1) return t('lab.pw.t.instant')
  const units: [number, I18nKey][] = [
    [60, 'lab.pw.t.seconds'],
    [3600, 'lab.pw.t.minutes'],
    [86400, 'lab.pw.t.hours'],
    [31_557_600, 'lab.pw.t.days'],
    [3_155_760_000, 'lab.pw.t.years']
  ]
  const divisors = [1, 60, 3600, 86400, 31_557_600]
  for (let i = 0; i < units.length; i++) {
    if (seconds < units[i][0]) return t(units[i][1], { n: Math.max(1, Math.floor(seconds / divisors[i])).toLocaleString(locale()) })
  }
  return t('lab.pw.t.centuries')
}

function PasswordTool() {
  const [pw, setPw] = useState('')
  const [show, setShow] = useState(false)
  const [leak, setLeak] = useState<{ pw: string; count: number } | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [opts, setOpts] = useState<GenOptions>({ length: 18, upper: true, digits: true, symbols: true, memorable: false })
  const [generated, setGenerated] = useState(() => generatePassword({ length: 18, upper: true, digits: true, symbols: true, memorable: false }))

  const strength = useMemo(() => strengthOf(pw), [pw])
  const genStrength = useMemo(() => strengthOf(generated), [generated])

  const check = async () => {
    if (!pw) return
    setChecking(true)
    setError(null)
    try {
      const hash = await digest('SHA-1', pw)
      const count = await lab().invoke('lab:breach', hash)
      setLeak({ pw, count })
    } catch (e) {
      setError(t('lab.pw.leakError', { error: errorText(e) }))
    } finally {
      setChecking(false)
    }
  }

  const regen = (next: GenOptions) => {
    setOpts(next)
    setGenerated(generatePassword(next))
  }

  return (
    <div className="lab-stack">
      <div className="lab-card">
        <h2>{t('lab.pw.test')}</h2>
        <div className="lab-inputrow">
          <input
            className="lab-input is-mono"
            type={show ? 'text' : 'password'}
            value={pw}
            placeholder={t('lab.pw.placeholder')}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              setPw(e.target.value)
              setLeak(null)
            }}
            onKeyDown={(e) => e.key === 'Enter' && void check()}
          />
          <button type="button" className="lab-btn is-icon" aria-label={show ? t('acct.hide') : t('acct.show')} onClick={() => setShow(!show)}>
            {show ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
          <button type="button" className="lab-btn is-primary" disabled={!pw || checking} onClick={() => void check()}>
            {checking ? <Loader2 size={15} className="spin" /> : <ShieldCheck size={15} />} <span>{t('lab.pw.leak')}</span>
          </button>
        </div>
        {pw && (
          <>
            <div className={cls('lab-meter', `is-${strength.score}`)} aria-hidden>
              {[0, 1, 2, 3, 4].map((i) => (
                <span key={i} className={i <= strength.score ? 'is-on' : ''} />
              ))}
            </div>
            <p className="lab-meter-label">
              <strong>{t(`lab.pw.score.${strength.score}` as I18nKey)}</strong> · {t('lab.pw.crack', { time: humanTime(strength.seconds) })} ·{' '}
              {t('lab.pw.bits', { n: strength.bits })}
            </p>
            {strength.warnings.length > 0 && (
              <ul className="qr-reasons">
                {strength.warnings.map((w) => (
                  <li key={w} className="is-caution">
                    {t(`lab.pw.w.${w}` as I18nKey)}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        {leak && leak.pw === pw && (
          <p className={cls('lab-banner', leak.count > 0 ? 'is-danger' : 'is-safe')}>
            {leak.count > 0 ? <ShieldX size={16} /> : <ShieldCheck size={16} />}
            {leak.count > 0 ? t('lab.pw.leaked', { n: leak.count.toLocaleString(locale()) }) : t('lab.pw.notLeaked')}
          </p>
        )}
        <Err text={error} />
        <p className="lab-muted lab-small">{t('lab.pw.privacy')}</p>
      </div>

      <div className="lab-card">
        <h2>{t('lab.pw.gen')}</h2>
        <div className="lab-generated">
          <Mono>{generated}</Mono>
          <button type="button" className="lab-btn is-icon" aria-label={t('lab.pw.again')} title={t('lab.pw.again')} onClick={() => regen(opts)}>
            <Dices size={15} />
          </button>
          <CopyBtn text={generated} />
        </div>
        <p className="lab-meter-label">
          <strong>{t(`lab.pw.score.${genStrength.score}` as I18nKey)}</strong> · {t('lab.pw.crack', { time: humanTime(genStrength.seconds) })}
        </p>
        <div className="lab-options">
          <label className="lab-range">
            <span>{t('lab.pw.length', { n: opts.length })}</span>
            <input type="range" min={8} max={64} value={opts.length} onChange={(e) => regen({ ...opts, length: Number(e.target.value) })} />
          </label>
          {(['upper', 'digits', 'symbols', 'memorable'] as const).map((k) => (
            <label key={k} className="lab-check">
              <input type="checkbox" checked={opts[k]} onChange={(e) => regen({ ...opts, [k]: e.target.checked })} />
              <span>{t(`lab.pw.opt.${k}` as I18nKey)}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ file hashes

function HashTool() {
  const [file, setFile] = useState<{ name: string; size: number; sha256: string; sha1: string; md5: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expected, setExpected] = useState('')
  const [text, setText] = useState('')
  const [textHash, setTextHash] = useState<{ sha256: string; sha1: string } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const hash = (f: File) => {
    const path = lab().pathForFile(f)
    if (!path) return setError(t('lab.notFile'))
    setBusy(true)
    setError(null)
    setFile(null)
    void lab()
      .invoke('lab:hash-file', path)
      .then(setFile)
      .catch((e) => setError(errorText(e)))
      .finally(() => setBusy(false))
  }

  useEffect(() => {
    if (!text) return setTextHash(null)
    let alive = true
    void Promise.all([digest('SHA-256', text), digest('SHA-1', text)]).then(([sha256, sha1]) => alive && setTextHash({ sha256, sha1 }))
    return () => {
      alive = false
    }
  }, [text])

  const want = expected.trim().toLowerCase().replace(/\s/g, '')
  const match = file && want ? [file.sha256, file.sha1, file.md5].includes(want) : null

  return (
    <div className="lab-stack">
      <div
        className="lab-card lab-drop is-big"
        role="button"
        tabIndex={0}
        onClick={() => fileInput.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const f = e.dataTransfer.files[0]
          if (f) hash(f)
        }}
      >
        <FileSearch size={26} />
        <strong>{t('lab.hash.drop')}</strong>
        <span>{t('lab.hash.dropHint')}</span>
        <input
          ref={fileInput}
          type="file"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) hash(f)
            e.target.value = ''
          }}
        />
      </div>
      {busy && <Busy label={t('lab.hash.busy')} />}
      <Err text={error} />
      {file && (
        <div className="lab-card">
          <h2>
            {file.name} <small>({formatSize(file.size)})</small>
          </h2>
          <dl className="lab-dl">
            {(['sha256', 'sha1', 'md5'] as const).map((k) => (
              <div key={k} className={cls('lab-dl-row', want && file[k] === want && 'is-match')}>
                <dt>{k.toUpperCase().replace('SHA', 'SHA-')}</dt>
                <dd>
                  <Mono>{file[k]}</Mono> <CopyBtn text={file[k]} />
                </dd>
              </div>
            ))}
          </dl>
          <div className="lab-inputrow">
            <input
              className="lab-input is-mono"
              placeholder={t('lab.hash.compare')}
              value={expected}
              spellCheck={false}
              onChange={(e) => setExpected(e.target.value)}
            />
          </div>
          {match !== null && (
            <p className={cls('lab-banner', match ? 'is-safe' : 'is-danger')}>
              {match ? <ShieldCheck size={16} /> : <ShieldX size={16} />}
              {match ? t('lab.hash.match') : t('lab.hash.noMatch')}
            </p>
          )}
        </div>
      )}
      <div className="lab-card">
        <h2>{t('lab.hash.text')}</h2>
        <textarea className="lab-input lab-area is-mono" value={text} spellCheck={false} onChange={(e) => setText(e.target.value)} placeholder={t('lab.hash.textHint')} />
        {textHash && (
          <dl className="lab-dl">
            <dt>SHA-256</dt>
            <dd>
              <Mono>{textHash.sha256}</Mono> <CopyBtn text={textHash.sha256} />
            </dd>
            <dt>SHA-1</dt>
            <dd>
              <Mono>{textHash.sha1}</Mono> <CopyBtn text={textHash.sha1} />
            </dd>
          </dl>
        )}
      </div>
    </div>
  )
}

function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toLocaleString(locale(), { maximumFractionDigits: 1 })} ${units[i]}`
}

// ------------------------------------------------------------------ decoders

const MODES: DecodeMode[] = ['jwt', 'base64-decode', 'base64-encode', 'url-decode', 'url-encode', 'hex-decode', 'hex-encode', 'html-decode']

function DecodeTool() {
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<DecodeMode>('base64-decode')
  const [auto, setAuto] = useState(true)

  useEffect(() => {
    if (!auto) return
    const g = guessMode(input)
    if (g) setMode(g)
  }, [input, auto])

  const result = useMemo((): { text?: string; jwt?: Jwt; error?: boolean } => {
    if (!input.trim()) return {}
    try {
      if (mode === 'jwt') return { jwt: decodeJwt(input) }
      return { text: convert(mode, input) }
    } catch {
      return { error: true }
    }
  }, [input, mode])

  const when = (s: number | null) => (s === null ? '—' : new Date(s * 1000).toLocaleString(locale()))

  return (
    <div className="lab-stack">
      <div className="lab-card">
        <div className="lab-chips" role="radiogroup">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              className={cls('lab-chip', mode === m && 'is-on')}
              onClick={() => {
                setAuto(false)
                setMode(m)
              }}
            >
              {t(`lab.dec.${m}` as I18nKey)}
            </button>
          ))}
        </div>
        <textarea
          className="lab-input lab-area is-mono"
          value={input}
          spellCheck={false}
          placeholder={t('lab.dec.placeholder')}
          onChange={(e) => setInput(e.target.value)}
          autoFocus
        />
        <p className="lab-muted lab-small">{t('lab.dec.local')}</p>
      </div>
      {result.error && <Err text={t('lab.dec.error')} />}
      {result.text !== undefined && (
        <div className="lab-card">
          <div className="lab-card-head">
            <h2>{t('lab.dec.result')}</h2>
            <CopyBtn text={result.text} label={t('lab.copy')} />
          </div>
          <pre className="lab-pre">{result.text}</pre>
        </div>
      )}
      {result.jwt && (
        <div className="lab-card">
          {result.jwt.warnings.length > 0 && (
            <ul className="qr-reasons">
              {result.jwt.warnings.map((w) => (
                <li key={w} className={w === 'alg-none' || w === 'expired' ? 'is-danger' : 'is-caution'}>
                  {t(`lab.jwt.${w}` as I18nKey)}
                </li>
              ))}
            </ul>
          )}
          <dl className="lab-dl">
            <dt>{t('lab.jwt.issued')}</dt>
            <dd>{when(result.jwt.iat)}</dd>
            <dt>{t('lab.jwt.expires')}</dt>
            <dd>{when(result.jwt.exp)}</dd>
          </dl>
          <h2>Header</h2>
          <pre className="lab-pre">{JSON.stringify(result.jwt.header, null, 2)}</pre>
          <h2>Payload</h2>
          <pre className="lab-pre">{JSON.stringify(result.jwt.payload, null, 2)}</pre>
          <p className="lab-muted lab-small">{t('lab.jwt.note')}</p>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ DNS

function DnsTool({ secureDns }: { secureDns: Settings['secureDns'] }) {
  const [host, setHost] = useState('')
  const [res, setRes] = useState<{ host: string; addresses: { address: string; family: string }[]; listed: string | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = () => {
    const h = host.trim()
    if (!h) return
    setBusy(true)
    setError(null)
    setRes(null)
    void lab()
      .invoke('lab:dns', h)
      .then((r) => setRes({ host: h, ...r }))
      .catch((e) => setError(errorText(e)))
      .finally(() => setBusy(false))
  }

  return (
    <div className="lab-stack">
      <div className="lab-card">
        <div className="lab-inputrow">
          <input
            className="lab-input is-mono"
            placeholder="exemplo.com.br"
            value={host}
            spellCheck={false}
            onChange={(e) => setHost(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && run()}
            autoFocus
          />
          <button type="button" className="lab-btn is-primary" disabled={busy || !host.trim()} onClick={run}>
            <Server size={15} /> <span>{t('lab.dns.run')}</span>
          </button>
        </div>
        <p className="lab-muted lab-small">{t(secureDns === 'off' || secureDns === 'system' ? 'lab.dns.plain' : 'lab.dns.secure')}</p>
      </div>
      {busy && <Busy label={t('lab.dns.busy')} />}
      <Err text={error} />
      {res && (
        <div className="lab-card">
          {res.listed && (
            <p className={cls('lab-banner', res.listed === 'malware' || res.listed === 'phishing' ? 'is-danger' : 'is-warn')}>
              <ShieldX size={16} /> {t(`lab.dns.listed.${res.listed}` as I18nKey)}
            </p>
          )}
          {res.addresses.length ? (
            <table className="lab-table">
              <thead>
                <tr>
                  <th>{t('lab.dns.type')}</th>
                  <th>{t('lab.dns.address')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {res.addresses.map((a) => (
                  <tr key={a.address}>
                    <td>{a.family === 'ipv6' ? 'AAAA' : 'A'}</td>
                    <td>
                      <Mono>{a.address}</Mono>
                    </td>
                    <td className="lab-val">
                      <CopyBtn text={a.address} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            !res.listed && <p className="lab-muted">{t('lab.dns.none')}</p>
          )}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ QR generator

function QrGenTool() {
  const [kind, setKind] = useState<'text' | 'wifi'>('text')
  const [text, setText] = useState('')
  const [ssid, setSsid] = useState('')
  const [pass, setPass] = useState('')
  const [sec, setSec] = useState<'WPA' | 'WEP' | 'nopass'>('WPA')
  const [hidden, setHidden] = useState(false)
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void lab()
      .invoke('lab:active')
      .then((a) => a && setText((cur) => cur || a.url))
  }, [])

  const payload = kind === 'text' ? text.trim() : ssid ? wifiPayload(ssid, pass, sec, hidden) : ''
  const src = useMemo(() => {
    if (!payload) return ''
    try {
      return qrDataUrl(payload)
    } catch {
      return ''
    }
  }, [payload])

  useEffect(() => {
    setSaved(false)
    setCopied(false)
  }, [payload])

  return (
    <div className="lab-grid2 is-qr">
      <div className="lab-card">
        <div className="lab-chips" role="radiogroup">
          <button type="button" role="radio" aria-checked={kind === 'text'} className={cls('lab-chip', kind === 'text' && 'is-on')} onClick={() => setKind('text')}>
            <Link2 size={13} /> {t('lab.qr.text')}
          </button>
          <button type="button" role="radio" aria-checked={kind === 'wifi'} className={cls('lab-chip', kind === 'wifi' && 'is-on')} onClick={() => setKind('wifi')}>
            <Wifi size={13} /> {t('lab.qr.wifi')}
          </button>
        </div>
        {kind === 'text' ? (
          <textarea
            className="lab-input lab-area is-mono"
            value={text}
            spellCheck={false}
            placeholder={t('lab.qr.textHint')}
            onChange={(e) => setText(e.target.value)}
          />
        ) : (
          <div className="lab-form">
            <label>
              <span>{t('qr.wifi.ssid')}</span>
              <input className="lab-input" value={ssid} onChange={(e) => setSsid(e.target.value)} />
            </label>
            <label>
              <span>{t('qr.wifi.password')}</span>
              <input className="lab-input is-mono" value={pass} disabled={sec === 'nopass'} onChange={(e) => setPass(e.target.value)} />
            </label>
            <label>
              <span>{t('qr.wifi.security')}</span>
              <select className="lab-input" value={sec} onChange={(e) => setSec(e.target.value as typeof sec)}>
                <option value="WPA">WPA / WPA2 / WPA3</option>
                <option value="WEP">WEP</option>
                <option value="nopass">{t('qr.wifi.none')}</option>
              </select>
            </label>
            <label className="lab-check">
              <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
              <span>{t('lab.qr.hidden')}</span>
            </label>
          </div>
        )}
        <p className="lab-muted lab-small">{t('lab.qr.local')}</p>
      </div>
      <div className="lab-card lab-qr-out">
        {src ? <img src={src} alt="QR Code" /> : <QrCode size={64} className="lab-qr-empty" />}
        <div className="lab-actions">
          <button
            type="button"
            className="lab-btn"
            disabled={!src}
            onClick={() => void lab().invoke('lab:save-image', src, kind === 'wifi' ? `Wi-Fi ${ssid}` : 'QR Code').then((ok) => ok && setSaved(true))}
          >
            {saved ? <Check size={14} /> : <Download size={14} />} <span>{t('qr.save')}</span>
          </button>
          <button type="button" className="lab-btn is-primary" disabled={!src} onClick={() => void lab().invoke('lab:copy-image', src).then(() => setCopied(true))}>
            {copied ? <Check size={14} /> : <Copy size={14} />} <span>{t('qr.copyImage')}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
