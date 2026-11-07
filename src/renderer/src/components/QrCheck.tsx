import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import {
  Bitcoin,
  Check,
  Contact,
  Copy,
  Download,
  ExternalLink,
  ImageUp,
  KeyRound,
  Landmark,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  QrCode,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  ShieldX,
  Type,
  Wifi,
  X
} from 'lucide-react'
import type { LinkReport } from '@shared/types'
import { parseQrPayload, pixKeyKind, type QrPayload } from '@shared/qrpayload'
import { ui } from '@/lib/api'
import { decodeQr, imageFrom, qrDataUrl, readFile } from '@/lib/qr'
import { useStore } from '@/lib/store'
import { t, type I18nKey } from '@/lib/i18n'
import { cls } from './bits'

export type Level = 'safe' | 'caution' | 'danger' | 'info'
type Note = { level: Level; text: string }

// ------------------------------------------------------------------ verdicts

export const LEVEL_ICON: Record<Level, ReactNode> = {
  safe: <ShieldCheck size={22} />,
  caution: <ShieldAlert size={22} />,
  danger: <ShieldX size={22} />,
  info: <ShieldQuestion size={22} />
}

const RANK: Record<Level, number> = { info: 0, safe: 1, caution: 2, danger: 3 }

export function worst(a: Level, b: Level): Level {
  return RANK[a] >= RANK[b] ? a : b
}

/** Warnings that depend on what kind of QR Code it is (not on a link). */
export function payloadNotes(p: QrPayload): Note[] {
  switch (p.type) {
    case 'pix': {
      const notes: Note[] = []
      if (!p.crcOk) notes.push({ level: 'danger', text: t('qr.pix.crcBad') })
      if (!p.amount) notes.push({ level: 'info', text: t('qr.pix.noAmount') })
      notes.push({ level: 'info', text: t('qr.pix.check') })
      return notes
    }
    case 'wifi':
      if (p.security === 'NOPASS') return [{ level: 'caution', text: t('qr.wifi.open') }]
      if (p.security === 'WEP') return [{ level: 'caution', text: t('qr.wifi.wep') }]
      return [{ level: 'info', text: t('qr.wifi.ok') }]
    case 'otp':
      return [{ level: 'caution', text: t('qr.otp.warn', { issuer: p.issuer || '?' }) }]
    case 'crypto':
      return [{ level: 'caution', text: t('qr.crypto.warn') }]
    case 'tel':
      return [{ level: 'info', text: t('qr.tel.warn') }]
    case 'sms':
      return [{ level: 'info', text: t('qr.sms.warn') }]
    case 'email':
      return [{ level: 'info', text: t('qr.email.warn') }]
    default:
      return []
  }
}

/** The link inside the payload that should be checked (a website, a Pix bank server...). */
export function linkOf(p: QrPayload): string | null {
  if (p.type === 'url') return p.url
  if (p.type === 'pix') return p.location
  if (p.type === 'contact') return p.url
  return null
}

export const TYPE_ICON: Record<QrPayload['type'], ReactNode> = {
  url: <ExternalLink size={16} />,
  pix: <Landmark size={16} />,
  wifi: <Wifi size={16} />,
  tel: <Phone size={16} />,
  sms: <MessageSquare size={16} />,
  email: <Mail size={16} />,
  otp: <KeyRound size={16} />,
  crypto: <Bitcoin size={16} />,
  contact: <Contact size={16} />,
  geo: <MapPin size={16} />,
  text: <Type size={16} />
}

function money(v: string): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return v
  return n.toLocaleString(document.documentElement.lang || 'pt-BR', { style: 'currency', currency: 'BRL' })
}

function Row({ label, value, mono, copy }: { label: string; value: string; mono?: boolean; copy?: boolean }) {
  const [done, setDone] = useState(false)
  return (
    <div className="qr-row">
      <span className="qr-row-label">{label}</span>
      <span className={cls('qr-row-value', mono && 'is-mono')} title={value}>
        {value}
      </span>
      {copy && (
        <button
          type="button"
          className="icon-btn qr-row-copy"
          aria-label={t('qr.copy')}
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => setDone(true))
          }}
        >
          {done ? <Check size={13} /> : <Copy size={13} />}
        </button>
      )}
    </div>
  )
}

export function PayloadDetails({ p }: { p: QrPayload }) {
  switch (p.type) {
    case 'pix': {
      const kind = p.key ? pixKeyKind(p.key) : null
      return (
        <>
          <Row label={t('qr.pix.name')} value={p.name || '—'} />
          <Row label={t('qr.pix.city')} value={p.city || '—'} />
          <Row label={t('qr.pix.amount')} value={p.amount ? money(p.amount) : t('qr.pix.free')} />
          {p.key && <Row label={`${t('qr.pix.key')} (${t(`qr.pix.kind.${kind}` as I18nKey)})`} value={p.key} mono copy />}
          {p.description && <Row label={t('qr.pix.desc')} value={p.description} />}
          {p.location && <Row label={t('qr.pix.location')} value={p.location.replace(/^https:\/\//, '')} mono />}
          {p.txid && p.txid !== '***' && <Row label={t('qr.pix.txid')} value={p.txid} mono />}
        </>
      )
    }
    case 'wifi':
      return (
        <>
          <Row label={t('qr.wifi.ssid')} value={p.ssid || '—'} />
          <Row label={t('qr.wifi.security')} value={p.security === 'NOPASS' ? t('qr.wifi.none') : p.security} />
          {p.password && <Row label={t('qr.wifi.password')} value={p.password} mono copy />}
        </>
      )
    case 'tel':
      return <Row label={t('qr.tel.number')} value={p.number} mono copy />
    case 'sms':
      return (
        <>
          <Row label={t('qr.tel.number')} value={p.number} mono copy />
          {p.body && <Row label={t('qr.sms.body')} value={p.body} />}
        </>
      )
    case 'email':
      return (
        <>
          <Row label={t('qr.email.to')} value={p.to} mono copy />
          {p.subject && <Row label={t('qr.email.subject')} value={p.subject} />}
        </>
      )
    case 'otp':
      return (
        <>
          <Row label={t('qr.otp.issuer')} value={p.issuer || '—'} />
          <Row label={t('qr.otp.account')} value={p.account || '—'} />
        </>
      )
    case 'crypto':
      return (
        <>
          <Row label={t('qr.crypto.coin')} value={p.coin} />
          <Row label={t('qr.crypto.address')} value={p.address} mono copy />
          {p.amount && <Row label={t('qr.pix.amount')} value={p.amount} />}
        </>
      )
    case 'contact':
      return (
        <>
          <Row label={t('qr.contact.name')} value={p.name || '—'} />
          {p.phone && <Row label={t('qr.tel.number')} value={p.phone} mono copy />}
          {p.email && <Row label={t('qr.email.to')} value={p.email} mono copy />}
        </>
      )
    case 'geo':
      return <Row label={t('qr.geo.place')} value={`${p.lat}, ${p.lon}`} mono copy />
    case 'text':
      return <p className="qr-text">{p.text}</p>
    default:
      return null
  }
}

// ------------------------------------------------------------------ the check window

type Phase = { step: 'pick' } | { step: 'decoding' } | { step: 'notfound' } | { step: 'ready'; raw: string }

/** Reads a QR Code (or takes a link) and shows where it really leads before anything is opened. */
export function QrCheck({ image, text, source }: { image?: string; text?: string; source: 'image' | 'page' | 'link' | 'none' }) {
  const [phase, setPhase] = useState<Phase>(text ? { step: 'ready', raw: text } : image ? { step: 'decoding' } : { step: 'pick' })
  const [preview, setPreview] = useState<string | undefined>(source === 'image' ? image : undefined)
  const [report, setReport] = useState<LinkReport | null>(null)
  const [checking, setChecking] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)

  const close = () => useStore.getState().setOverlay(null)

  const fromImage = (src: string, showPreview: boolean) => {
    setPhase({ step: 'decoding' })
    setReport(null)
    if (showPreview) setPreview(src)
    void decodeQr(src)
      .then((raw) => setPhase(raw ? { step: 'ready', raw } : { step: 'notfound' }))
      .catch(() => setPhase({ step: 'notfound' }))
  }

  useEffect(() => {
    if (image && !text) fromImage(image, source === 'image')
  }, [image, text])

  // paste an image (a screenshot of a QR Code from WhatsApp, an email...) or drop a file
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = imageFrom(e.clipboardData)
      if (file) {
        e.preventDefault()
        void readFile(file).then((src) => fromImage(src, true))
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
    }
    window.addEventListener('paste', onPaste)
    window.addEventListener('keydown', onKey)
    closeBtn.current?.focus()
    return () => {
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const payload = useMemo(() => (phase.step === 'ready' ? parseQrPayload(phase.raw) : null), [phase])
  const link = payload ? linkOf(payload) : null

  useEffect(() => {
    if (!link) return
    let alive = true
    setChecking(true)
    void ui()
      .invoke('qr:analyze', link)
      .then((r) => alive && setReport(r))
      .catch(() => undefined)
      .finally(() => alive && setChecking(false))
    return () => {
      alive = false
    }
  }, [link])

  const notes = payload ? payloadNotes(payload) : []
  const reasons = report?.reasons ?? []
  let level: Level = payload?.type === 'url' ? 'safe' : 'info'
  for (const n of notes) level = worst(level, n.level === 'info' ? 'info' : n.level)
  if (report) level = worst(level, report.level)
  if (payload?.type === 'url' && report?.kind === 'text') level = 'caution'

  const openable = payload?.type === 'url' && report?.kind === 'url' && /^https?:/i.test(report.finalUrl ?? report.input)
  const target = report?.finalUrl ?? link ?? ''

  const open = (disposable: boolean) => {
    if (!openable) return
    if (level === 'danger' && !confirmOpen) {
      setConfirmOpen(true)
      return
    }
    // the original address: the site's own redirects then run inside the tab, under Halyard's protections
    void ui().invoke('qr:open', link ?? target, disposable)
    close()
  }

  const copyRaw = () => {
    if (phase.step !== 'ready') return
    void navigator.clipboard.writeText(phase.raw).then(() => setCopied(true))
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    const file = imageFrom(e.dataTransfer)
    if (file) void readFile(file).then((src) => fromImage(src, true))
  }

  const title =
    source === 'link' ? t('qr.titleLink') : payload ? t(`qr.type.${payload.type}` as I18nKey) : t('qr.title')

  return (
    <div className="modal-backdrop qr-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        className={cls('modal qr', phase.step === 'ready' && `is-${checking ? 'checking' : level}`)}
        role="dialog"
        aria-modal="true"
        aria-labelledby="qr-title"
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <div className="qr-head">
          <span className="qr-head-icon">{payload ? TYPE_ICON[payload.type] : <QrCode size={16} />}</span>
          <h2 id="qr-title" className="qr-title">
            {title}
          </h2>
          <span className="grow" />
          <button ref={closeBtn} type="button" className="icon-btn" aria-label={t('common.close')} onClick={close}>
            <X size={16} />
          </button>
        </div>

        {(phase.step === 'pick' || phase.step === 'notfound') && (
          <div className="qr-drop" onClick={() => fileInput.current?.click()} role="button" tabIndex={0}>
            {preview && phase.step === 'notfound' && <img className="qr-preview is-dim" src={preview} alt="" />}
            <ImageUp size={28} strokeWidth={1.6} />
            <strong>{phase.step === 'notfound' ? t('qr.notFound') : t('qr.pickTitle')}</strong>
            <span>{phase.step === 'notfound' ? t(source === 'page' ? 'qr.notFoundPage' : 'qr.notFoundHint') : t('qr.pickHint')}</span>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void readFile(file).then((src) => fromImage(src, true))
                e.target.value = ''
              }}
            />
          </div>
        )}

        {phase.step === 'decoding' && (
          <div className="qr-busy">
            <Loader2 size={20} className="spin" /> {t('qr.reading')}
          </div>
        )}

        {phase.step === 'ready' && payload && (
          <>
            <div className={cls('qr-verdict', `is-${checking ? 'checking' : level}`)} role="status" aria-live="polite">
              <span className="qr-verdict-icon">{checking ? <Loader2 size={22} className="spin" /> : LEVEL_ICON[level]}</span>
              <span className="qr-verdict-text">
                <strong>{checking ? t('qr.checking') : t(`qr.level.${level}` as I18nKey)}</strong>
                <span>{checking ? t('qr.checkingHint') : t(`qr.levelHint.${level}` as I18nKey)}</span>
              </span>
              {preview && <img className="qr-preview" src={preview} alt="" />}
            </div>

            {payload.type === 'url' && (
              <div className="qr-dest">
                <span className="qr-dest-label">{t('qr.goesTo')}</span>
                <span className="qr-dest-host">{report?.finalHost ?? report?.displayHost ?? hostOf(payload.url)}</span>
                <span className="qr-dest-url" title={target || payload.url}>
                  {target || payload.url}
                </span>
                {report && report.displayHost && report.finalHost && report.finalHost !== report.displayHost && (
                  <span className="qr-dest-from">{t('qr.from', { host: report.displayHost })}</span>
                )}
              </div>
            )}

            {payload.type !== 'url' && (
              <div className="qr-details">
                <PayloadDetails p={payload} />
              </div>
            )}

            {(reasons.length > 0 || notes.length > 0) && (
              <ul className="qr-reasons">
                {reasons.map((r) => (
                  <li key={`${r.code}|${r.value ?? ''}`} className={cls(`is-${reasonLevel(r.code)}`)}>
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

            {report && report.chain.length > 1 && (
              <details className="qr-chain">
                <summary>{t('qr.chain', { n: report.chain.length - 1 })}</summary>
                <ol>
                  {report.chain.map((hop, i) => (
                    <li key={`${i}:${hop.url}`}>
                      <span className="qr-chain-status">{hop.status || '—'}</span>
                      <span className="qr-chain-url">{hop.url}</span>
                    </li>
                  ))}
                </ol>
              </details>
            )}

            {confirmOpen && <p className="qr-confirm">{t('qr.confirmDanger')}</p>}

            <div className="modal-actions qr-actions">
              <button type="button" className="btn" onClick={copyRaw}>
                {copied ? <Check size={14} /> : <Copy size={14} />} {payload.type === 'url' ? t('qr.copyLink') : t('qr.copy')}
              </button>
              <span className="grow" />
              {openable && (
                <>
                  <button type="button" className="btn" disabled={checking} onClick={() => open(true)} title={t('qr.disposableHint')}>
                    {t('qr.openDisposable')}
                  </button>
                  <button
                    type="button"
                    className={cls('btn', level === 'danger' ? 'btn-danger' : 'btn-primary')}
                    disabled={checking}
                    onClick={() => open(false)}
                  >
                    <ExternalLink size={14} /> {confirmOpen ? t('qr.openAnyway') : t('qr.open')}
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const DANGER_CODES = new Set(['malware', 'phishing', 'homograph', 'typo', 'decoy', 'credentials', 'scheme'])
const INFO_CODES = new Set(['shortener', 'redirects', 'local'])

export function reasonLevel(code: string): Level {
  if (DANGER_CODES.has(code)) return 'danger'
  if (INFO_CODES.has(code)) return 'info'
  return 'caution'
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

// ------------------------------------------------------------------ QR Code of this page

export function PageQr({ url, title }: { url: string; title: string }) {
  const [done, setDone] = useState<'copied' | 'saved' | null>(null)
  const src = useMemo(() => {
    try {
      return qrDataUrl(url)
    } catch {
      return ''
    }
  }, [url])
  const close = () => useStore.getState().setOverlay(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="modal-backdrop qr-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal qr page-qr" role="dialog" aria-modal="true" aria-labelledby="pqr-title">
        <div className="qr-head">
          <span className="qr-head-icon">
            <QrCode size={16} />
          </span>
          <h2 id="pqr-title" className="qr-title">
            {t('qr.pageTitle')}
          </h2>
          <span className="grow" />
          <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={close} autoFocus>
            <X size={16} />
          </button>
        </div>
        {src ? <img className="page-qr-img" src={src} alt={t('qr.pageAlt', { title })} /> : <p className="qr-text">{t('qr.tooLong')}</p>}
        <p className="page-qr-title">{title}</p>
        <p className="page-qr-url">{url}</p>
        <p className="dlc-hint">{t('qr.pageHint')}</p>
        <div className="modal-actions">
          <span className="grow" />
          <button
            type="button"
            className="btn"
            disabled={!src}
            onClick={() => void ui().invoke('qr:save-image', src, title || 'QR Code').then((ok) => ok && setDone('saved'))}
          >
            {done === 'saved' ? <Check size={14} /> : <Download size={14} />} {t('qr.save')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!src}
            onClick={() => void ui().invoke('qr:copy-image', src).then(() => setDone('copied'))}
          >
            {done === 'copied' ? <Check size={14} /> : <Copy size={14} />} {t('qr.copyImage')}
          </button>
        </div>
      </div>
    </div>
  )
}
