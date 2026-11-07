import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Dices, FileWarning, ImageUp, Lock, LockOpen, MapPin } from 'lucide-react'
import type { LinkReport } from '@shared/types'
import { lab } from '@/lib/api'
import { locale, t, type I18nKey } from '@/lib/i18n'
import { LEVEL_ICON } from '@/components/QrCheck'
import { Busy, cls, CopyBtn, Err, Mono } from './ui'
import { strengthOf } from './tools'
import {
  analyzeMessage,
  checkBoleto,
  checkDoc,
  cleanLink,
  cleanPhoto,
  inspectFile,
  isLocked,
  lockText,
  makeToken,
  parseHeaders,
  readPhotoInfo,
  scanHidden,
  tokenBits,
  unlockText,
  type FileReport,
  type Level,
  type PhotoInfo,
  type TokenKind
} from './more'

const k = (key: string) => t(key as I18nKey)

function Verdict({ level, title, children }: { level: Level; title: string; children?: ReactNode }) {
  return (
    <div className={cls('lab-card lab-verdict', `is-${level}`)}>
      <div className="lab-verdict-top">
        <span className="lab-verdict-icon">{LEVEL_ICON[level]}</span>
        <span>
          <strong>{title}</strong>
        </span>
      </div>
      {children}
    </div>
  )
}

function Reasons({ items }: { items: { text: ReactNode; level: 'danger' | 'caution' | 'info' }[] }) {
  if (!items.length) return null
  return (
    <ul className="qr-reasons">
      {items.map((r, i) => (
        <li key={i} className={r.level === 'info' ? undefined : `is-${r.level}`}>
          {r.text}
        </li>
      ))}
    </ul>
  )
}

function bytes(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toLocaleString(locale(), { maximumFractionDigits: i ? 1 : 0 })} ${units[i]}`
}

/** A file picker that also accepts drag and drop. */
function DropZone({ icon, title, hint, accept, onFile }: { icon: ReactNode; title: string; hint: string; accept?: string; onFile: (f: File) => void }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <div
      className="lab-card lab-drop is-big"
      role="button"
      tabIndex={0}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        const f = e.dataTransfer.files[0]
        if (f) onFile(f)
      }}
    >
      {icon}
      <strong>{title}</strong>
      <span>{hint}</span>
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          e.target.value = ''
        }}
      />
    </div>
  )
}

// ------------------------------------------------------------------ scam message

export function ScamTool() {
  const [text, setText] = useState('')
  const [checked, setChecked] = useState('')
  const [links, setLinks] = useState<Record<string, LinkReport | 'busy' | 'error'>>({})
  const report = useMemo(() => (checked ? analyzeMessage(checked) : null), [checked])

  useEffect(() => {
    if (!report) return
    let alive = true
    setLinks(Object.fromEntries(report.links.map((l) => [l, 'busy' as const])))
    for (const l of report.links) {
      lab()
        .invoke('lab:analyze', l)
        .then((r) => alive && setLinks((prev) => ({ ...prev, [l]: r })))
        .catch(() => alive && setLinks((prev) => ({ ...prev, [l]: 'error' })))
    }
    return () => {
      alive = false
    }
  }, [report])

  // a dangerous link makes the whole message dangerous
  const linkWorst = Object.values(links).some((r) => typeof r === 'object' && r.level === 'danger')
  const level: Level = report ? (linkWorst ? 'danger' : report.level) : 'safe'

  return (
    <div className="lab-stack">
      <div className="lab-card">
        <textarea
          className="lab-input lab-area"
          value={text}
          placeholder={t('lab.scam.placeholder')}
          onChange={(e) => setText(e.target.value)}
          autoFocus
        />
        <div className="lab-actions">
          <button type="button" className="lab-btn is-primary" disabled={!text.trim()} onClick={() => setChecked(text)}>
            {t('lab.scam.check')}
          </button>
        </div>
      </div>
      {report && (
        <Verdict level={level} title={k(`lab.scam.level.${level}`)}>
          <Reasons
            items={report.signals.map((s) => ({
              text: s === 'brand' ? t('lab.scam.s.brand', { brands: report.brands.join(', ') }) : k(`lab.scam.s.${s}`),
              level: ['family', 'credentials', 'prize', 'shortlink'].includes(s) ? 'danger' : 'caution'
            }))}
          />
          {report.links.length > 0 && (
            <>
              <h2>{t('lab.scam.links')}</h2>
              <ul className="lab-tokens is-links">
                {report.links.map((l) => {
                  const r = links[l]
                  return (
                    <li key={l}>
                      <span>
                        <Mono>{l}</Mono>
                        <small className="lab-muted lab-small">
                          {r === 'busy' || !r
                            ? t('lab.scam.linkChecking')
                            : r === 'error'
                              ? '—'
                              : [
                                  // "safe" only means no blocklist hit: inside a scam warning, say exactly that
                                  r.level === 'safe' ? t('lab.scam.linkClean') : t(`qr.level.${r.level}` as I18nKey),
                                  r.finalHost && r.finalHost !== r.host ? t('lab.scam.linkGoes', { host: r.finalHost }) : ''
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                        </small>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
          <p className="lab-muted lab-small">{t('lab.scam.tip')}</p>
        </Verdict>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ boleto

export function BoletoTool() {
  const [text, setText] = useState('')
  const digits = text.replace(/\D/g, '')
  const r = useMemo(() => (digits.length >= 44 ? checkBoleto(digits) : null), [digits])
  const money = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

  return (
    <div className="lab-stack">
      <div className="lab-card">
        <input
          className="lab-input is-mono"
          value={text}
          placeholder={t('lab.bol.placeholder')}
          inputMode="numeric"
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          autoFocus
        />
        <p className="lab-muted lab-small">{t('lab.bol.count', { n: digits.length })}</p>
      </div>
      {r && (
        <Verdict level={r.valid ? 'safe' : 'danger'} title={r.valid ? t('lab.bol.valid') : t('lab.bol.invalid')}>
          {!r.valid && r.problem && <p className="lab-muted">{k(`lab.bol.p.${r.problem}`)}</p>}
          {r.valid && (
            <dl className="lab-dl">
              <dt>{t('lab.bol.kind')}</dt>
              <dd>{k(`lab.bol.kind.${r.kind}`)}</dd>
              {r.kind === 'bank' && (
                <>
                  <dt>{t('lab.bol.bank')}</dt>
                  <dd>{r.bank ? `${r.bank} (${r.bankCode})` : t('lab.bol.unknownBank', { code: r.bankCode ?? '' })}</dd>
                </>
              )}
              {r.segment && (
                <>
                  <dt>{t('lab.bol.segment')}</dt>
                  <dd>{k(`lab.bol.${r.segment}`)}</dd>
                </>
              )}
              <dt>{t('lab.bol.value')}</dt>
              <dd>
                <strong>{r.value ? money(r.value) : t('lab.bol.open')}</strong>
              </dd>
              {r.kind === 'bank' && (
                <>
                  <dt>{t('lab.bol.due')}</dt>
                  <dd>{r.due ? r.due.toLocaleDateString(locale(), { timeZone: 'UTC' }) : t('lab.bol.noDue')}</dd>
                </>
              )}
              <dt>{t('lab.bol.barcode')}</dt>
              <dd>
                <Mono>{r.barcode}</Mono> <CopyBtn text={r.barcode} />
              </dd>
            </dl>
          )}
          <p className="lab-muted lab-small">{t('lab.bol.tip')}</p>
        </Verdict>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ CPF / CNPJ

export function DocTool() {
  const [text, setText] = useState('')
  const r = useMemo(() => checkDoc(text), [text])
  const kind = r.kind === 'cpf' ? 'CPF' : 'CNPJ'
  return (
    <div className="lab-stack">
      <div className="lab-card">
        <input className="lab-input is-mono" value={text} placeholder={t('lab.doc.placeholder')} spellCheck={false} onChange={(e) => setText(e.target.value)} autoFocus />
        {text.trim() && !r.kind && <p className="lab-muted lab-small">{t('lab.doc.unknown')}</p>}
      </div>
      {r.kind && (
        <Verdict level={r.valid ? 'safe' : 'danger'} title={r.valid ? t('lab.doc.valid', { kind }) : t('lab.doc.invalid', { kind })}>
          <dl className="lab-dl">
            <dt>{kind}</dt>
            <dd>
              <Mono>{r.formatted}</Mono> <CopyBtn text={r.formatted} />
            </dd>
            {r.valid && r.region !== null && (
              <>
                <dt>{t('lab.doc.region')}</dt>
                <dd>{k(`lab.doc.r${r.region}`)}</dd>
              </>
            )}
            {r.valid && r.branch !== null && (
              <>
                <dt>{t('lab.doc.branch')}</dt>
                <dd>{r.branch ? t('lab.doc.branchYes') : t('lab.doc.head')}</dd>
              </>
            )}
          </dl>
          <p className="lab-muted lab-small">{t('lab.doc.note')}</p>
        </Verdict>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ photo metadata

export function PhotoTool() {
  const [file, setFile] = useState<File | null>(null)
  const [info, setInfo] = useState<PhotoInfo | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview])

  const open = (f: File) => {
    setError(null)
    setSaved(false)
    setInfo(null)
    if (!f.type.startsWith('image/')) return setError(t('lab.ph.error'))
    setFile(f)
    setPreview(URL.createObjectURL(f))
    void f
      .arrayBuffer()
      .then((b) => setInfo(readPhotoInfo(b)))
      .catch(() => setError(t('lab.ph.error')))
  }

  const save = async () => {
    if (!file) return
    try {
      const dataUrl = await cleanPhoto(file, file.type)
      const name = file.name.replace(/\.[^.]+$/, '') + '-clean'
      setSaved(await lab().invoke('lab:save-photo', dataUrl, name))
    } catch {
      setError(t('lab.ph.error'))
    }
  }

  const found = info && (info.gps || info.camera || info.taken || info.software || info.hasMetadata)
  const coords = info?.gps ? `${info.gps.lat.toFixed(5)}, ${info.gps.lon.toFixed(5)}` : ''

  return (
    <div className="lab-stack">
      <DropZone icon={<ImageUp size={26} />} title={t('lab.ph.drop')} hint={t('lab.ph.dropHint')} accept="image/jpeg,image/png,image/webp" onFile={open} />
      <Err text={error} />
      {info && (
        <Verdict level={info.gps ? 'danger' : found ? 'caution' : 'safe'} title={info.gps ? t('lab.ph.gps') : found ? t('lab.ph.found') : t('lab.ph.nothing')}>
          <div className="lab-photo">
            {preview && <img src={preview} alt="" />}
            <dl className="lab-dl">
              {info.gps && (
                <>
                  <dt>
                    <MapPin size={13} /> GPS
                  </dt>
                  <dd className="is-bad">
                    <Mono>{coords}</Mono>
                    <button
                      type="button"
                      className="lab-btn"
                      onClick={() => void lab().invoke('lab:open', `https://www.openstreetmap.org/?mlat=${info.gps!.lat}&mlon=${info.gps!.lon}#map=16/${info.gps!.lat}/${info.gps!.lon}`, true)}
                    >
                      {t('lab.ph.map')}
                    </button>
                  </dd>
                </>
              )}
              {info.camera && (
                <>
                  <dt>{t('lab.ph.camera')}</dt>
                  <dd>{info.camera}</dd>
                </>
              )}
              {info.taken && (
                <>
                  <dt>{t('lab.ph.taken')}</dt>
                  <dd>{info.taken}</dd>
                </>
              )}
              {info.software && (
                <>
                  <dt>{t('lab.ph.software')}</dt>
                  <dd>{info.software}</dd>
                </>
              )}
              <dt>{t('lab.ph.meta')}</dt>
              <dd>{info.hasMetadata ? t('lab.ph.hasMeta') : t('lab.ph.noMeta')}</dd>
            </dl>
          </div>
          <div className="lab-actions">
            <button type="button" className="lab-btn is-primary" onClick={() => void save()}>
              {t('lab.ph.clean')}
            </button>
            {saved && <span className="lab-muted lab-small">{t('lab.ph.saved')}</span>}
          </div>
        </Verdict>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ hidden characters

export function HiddenTool() {
  const [text, setText] = useState('')
  const r = useMemo(() => (text ? scanHidden(text) : null), [text])
  const total = r ? r.invisible + r.bidi + r.tags + r.lookalikes : 0
  return (
    <div className="lab-stack">
      <div className="lab-card">
        <textarea className="lab-input lab-area" value={text} placeholder={t('lab.hid.placeholder')} spellCheck={false} onChange={(e) => setText(e.target.value)} autoFocus />
      </div>
      {r && (
        <Verdict level={r.bidi || r.tags ? 'danger' : total ? 'caution' : 'safe'} title={total ? t('lab.hid.found', { n: total }) : t('lab.hid.none')}>
          <Reasons
            items={[
              r.invisible ? { text: t('lab.hid.invisible', { n: r.invisible }), level: 'caution' as const } : null,
              r.bidi ? { text: t('lab.hid.bidi', { n: r.bidi }), level: 'danger' as const } : null,
              r.tags ? { text: t('lab.hid.tags', { n: r.tags }), level: 'danger' as const } : null,
              r.lookalikes ? { text: t('lab.hid.lookalikes', { n: r.lookalikes }), level: 'caution' as const } : null
            ].filter((x): x is NonNullable<typeof x> => !!x)}
          />
          {r.smuggled && (
            <>
              <h2>{t('lab.hid.smuggled')}</h2>
              <pre className="lab-pre">{r.smuggled}</pre>
            </>
          )}
          {total > 0 && (
            <>
              <h2>{t('lab.hid.marked')}</h2>
              <pre className="lab-pre">
                {r.marked.map((m, i) => (m.odd ? <mark key={i} className="lab-odd">{m.text}</mark> : <span key={i}>{m.text}</span>))}
              </pre>
              <div className="lab-card-head">
                <h2>{t('lab.hid.cleaned')}</h2>
                <CopyBtn text={r.cleaned} label={t('lab.copy')} />
              </div>
              <pre className="lab-pre">{r.cleaned}</pre>
            </>
          )}
        </Verdict>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ e-mail headers

export function MailTool() {
  const [text, setText] = useState('')
  const r = useMemo(() => (text.trim() ? parseHeaders(text) : undefined), [text])
  const replyDomain = r?.replyTo ? (/@([^>\s]+)/.exec(r.replyTo)?.[1] ?? '') : ''
  return (
    <div className="lab-stack">
      <div className="lab-card">
        <textarea className="lab-input lab-area is-mono" value={text} placeholder={t('lab.mail.placeholder')} spellCheck={false} onChange={(e) => setText(e.target.value)} autoFocus />
      </div>
      {r === null && <Err text={t('lab.mail.none')} />}
      {r && (
        <Verdict level={r.level} title={k(`lab.mail.level.${r.level}`)}>
          <Reasons
            items={r.flags.map((f) => ({
              text: f === 'reply-to' ? t('lab.mail.f.reply-to', { domain: replyDomain }) : k(`lab.mail.f.${f}`),
              level: f === 'auth-ok' ? 'info' : ['dmarc-fail', 'display-email', 'free-mail-brand'].includes(f) ? 'danger' : 'caution'
            }))}
          />
          <dl className="lab-dl">
            <dt>{t('lab.mail.from')}</dt>
            <dd>{r.from}</dd>
            {r.replyTo && (
              <>
                <dt>{t('lab.mail.replyTo')}</dt>
                <dd>{r.replyTo}</dd>
              </>
            )}
            {r.returnPath && (
              <>
                <dt>{t('lab.mail.returnPath')}</dt>
                <dd>{r.returnPath}</dd>
              </>
            )}
            {r.subject && (
              <>
                <dt>{t('lab.mail.subject')}</dt>
                <dd>{r.subject}</dd>
              </>
            )}
            <dt>{t('lab.mail.auth')}</dt>
            <dd>
              <Mono>
                SPF {r.spf ?? '—'} · DKIM {r.dkim ?? '—'} · DMARC {r.dmarc ?? '—'}
              </Mono>
            </dd>
            <dt>{t('lab.mail.hops')}</dt>
            <dd>{r.hops}</dd>
            {r.originIp && (
              <>
                <dt>{t('lab.mail.origin')}</dt>
                <dd>
                  <Mono>{r.originIp}</Mono>
                </dd>
              </>
            )}
          </dl>
        </Verdict>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ text vault

export function VaultTool() {
  const [mode, setMode] = useState<'lock' | 'unlock'>('lock')
  const [text, setText] = useState('')
  const [pw, setPw] = useState('')
  const [out, setOut] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const strength = useMemo(() => strengthOf(pw), [pw])

  useEffect(() => {
    // pasting a locked text switches to "unlock" by itself
    if (isLocked(text)) setMode('unlock')
  }, [text])

  const run = async () => {
    setBusy(true)
    setError(null)
    setOut('')
    try {
      setOut(mode === 'lock' ? await lockText(text, pw) : await unlockText(text, pw))
    } catch {
      setError(t('lab.vault.wrong'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="lab-stack">
      <div className="lab-card">
        <div className="lab-chips" role="radiogroup">
          {(['lock', 'unlock'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              className={cls('lab-chip', mode === m && 'is-on')}
              onClick={() => {
                setMode(m)
                setOut('')
                setError(null)
              }}
            >
              {m === 'lock' ? <Lock size={13} /> : <LockOpen size={13} />} {k(`lab.vault.${m}`)}
            </button>
          ))}
        </div>
        <textarea
          className={cls('lab-input lab-area', mode === 'unlock' && 'is-mono')}
          value={text}
          placeholder={mode === 'lock' ? t('lab.vault.textPh') : t('lab.vault.sealedPh')}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          autoFocus
        />
        <div className="lab-inputrow">
          <input
            className="lab-input is-mono"
            type="password"
            value={pw}
            placeholder={t('lab.vault.password')}
            autoComplete="new-password"
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && text && pw && void run()}
          />
          <button type="button" className="lab-btn is-primary" disabled={!text || !pw || busy} onClick={() => void run()}>
            {mode === 'lock' ? t('lab.vault.lock') : t('lab.vault.unlock')}
          </button>
        </div>
        {mode === 'lock' && pw && strength.score < 3 && <p className="lab-muted lab-small">{t('lab.vault.weak')}</p>}
        <p className="lab-muted lab-small">{t('lab.vault.note')}</p>
      </div>
      {busy && <Busy label={t('lab.vault.working')} />}
      <Err text={error} />
      {out && (
        <div className="lab-card">
          <div className="lab-card-head">
            <h2>{t('lab.vault.result')}</h2>
            <CopyBtn text={out} label={t('lab.copy')} />
          </div>
          <pre className="lab-pre">{out}</pre>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ tokens

const TOKEN_SIZES: Record<TokenKind, number[]> = { uuid: [0], hex: [16, 32, 64], base64url: [16, 32, 64], pin: [4, 6, 8], words: [4, 5, 6, 8] }

export function TokenTool() {
  const [kind, setKind] = useState<TokenKind>('uuid')
  const [size, setSize] = useState(0)
  const [seed, setSeed] = useState(0)
  const list = useMemo(() => Array.from({ length: 6 }, () => makeToken(kind, size)), [kind, size, seed])
  const sizeLabel = (n: number) =>
    kind === 'pin' ? t('lab.tok.digits', { n }) : kind === 'words' ? t('lab.tok.nwords', { n }) : t('lab.tok.bytes', { n })

  return (
    <div className="lab-stack">
      <div className="lab-card">
        <div className="lab-chips" role="radiogroup">
          {(Object.keys(TOKEN_SIZES) as TokenKind[]).map((x) => (
            <button
              key={x}
              type="button"
              role="radio"
              aria-checked={kind === x}
              className={cls('lab-chip', kind === x && 'is-on')}
              onClick={() => {
                setKind(x)
                setSize(TOKEN_SIZES[x][x === 'pin' ? 1 : 0])
              }}
            >
              {t(`lab.tok.${x}` as I18nKey)}
            </button>
          ))}
        </div>
        {kind !== 'uuid' && (
          <div className="lab-chips" role="radiogroup" aria-label={t('lab.tok.size')}>
            {TOKEN_SIZES[kind].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={size === n} className={cls('lab-chip', size === n && 'is-on')} onClick={() => setSize(n)}>
                {sizeLabel(n)}
              </button>
            ))}
          </div>
        )}
        <div className="lab-actions">
          <button type="button" className="lab-btn is-primary" onClick={() => setSeed(seed + 1)}>
            <Dices size={14} /> {t('lab.tok.again')}
          </button>
          <span className="lab-muted lab-small">{t('lab.tok.bits', { n: tokenBits(kind, size) })}</span>
        </div>
      </div>
      <div className="lab-card">
        <ul className="lab-tokens">
          {list.map((x, i) => (
            <li key={`${seed}-${i}`}>
              <Mono>{x}</Mono>
              <CopyBtn text={x} />
            </li>
          ))}
        </ul>
        {kind === 'pin' && <p className="lab-muted lab-small">{t('lab.tok.pinNote')}</p>}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ clean links

export function CleanTool() {
  const [text, setText] = useState('')
  const rows = useMemo(
    () =>
      text
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, 50)
        .map((l) => ({ line: l, r: cleanLink(l) })),
    [text]
  )
  const all = rows.map((x) => x.r?.output ?? x.line).join('\n')
  return (
    <div className="lab-stack">
      <div className="lab-card">
        <textarea className="lab-input lab-area is-mono" value={text} placeholder={t('lab.cl.placeholder')} spellCheck={false} onChange={(e) => setText(e.target.value)} autoFocus />
      </div>
      {rows.length > 0 && (
        <div className="lab-card">
          <div className="lab-card-head">
            <h2>{t('lab.cl.result')}</h2>
            <CopyBtn text={all} label={t('lab.cl.copyAll')} />
          </div>
          <ul className="lab-tokens is-links">
            {rows.map(({ line, r }, i) => (
              <li key={i}>
                <span>
                  <Mono>{r?.output ?? line}</Mono>
                  <small className="lab-muted lab-small">
                    {!r
                      ? t('lab.cl.bad')
                      : [r.unwrapped && t('lab.cl.unwrapped', { host: r.unwrapped }), r.removed.length && t('lab.cl.removed', { list: r.removed.join(', ') })]
                          .filter(Boolean)
                          .join(' · ') || t('lab.cl.nothing')}
                  </small>
                </span>
                {r && <CopyBtn text={r.output} />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ disguised files

export function FileTool() {
  const [r, setR] = useState<FileReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const open = (f: File) => {
    setBusy(true)
    setError(null)
    setR(null)
    inspectFile(f)
      .then(setR)
      .catch(() => setError(t('lab.file.error')))
      .finally(() => setBusy(false))
  }
  return (
    <div className="lab-stack">
      <DropZone icon={<FileWarning size={26} />} title={t('lab.file.drop')} hint={t('lab.file.dropHint')} onFile={open} />
      {busy && <Busy label={t('lab.file.reading')} />}
      <Err text={error} />
      {r && (
        <Verdict level={r.level} title={k(`lab.file.level.${r.level}`)}>
          <Reasons
            items={r.flags.map((f) => ({
              text: f === 'mismatch' ? t('lab.file.f.mismatch', { ext: r.ext || '—' }) : k(`lab.file.f.${f}`),
              level: ['rtl-name', 'double-ext', 'zip-exe'].includes(f) || (f === 'mismatch' && r.level === 'danger') ? 'danger' : 'caution'
            }))}
          />
          <dl className="lab-dl">
            <dt>{t('lab.file.name')}</dt>
            <dd>
              <Mono>{r.name.replace(/[‪-‮⁦-⁩]/g, '⟦⇄⟧')}</Mono>
            </dd>
            <dt>{t('lab.file.real')}</dt>
            <dd>
              <strong>{k(`lab.file.t.${r.real}`)}</strong>
            </dd>
            <dt>{t('lab.file.size')}</dt>
            <dd>{bytes(r.size)}</dd>
          </dl>
          {r.entries.length > 0 && (
            <>
              <h2>{t('lab.file.entries', { n: r.entries.length })}</h2>
              <ul className="lab-hosts lab-entries">
                {r.entries.slice(0, 80).map((e) => (
                  <li key={e.name} className={e.risky ? 'is-risky' : undefined}>
                    <Mono>{e.name}</Mono>
                    {e.locked && <small> 🔒 {t('lab.file.locked')}</small>}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="lab-muted lab-small">{t('lab.file.note')}</p>
        </Verdict>
      )}
    </div>
  )
}
