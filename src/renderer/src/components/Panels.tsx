import { useEffect, useState, type ReactNode } from 'react'
import { File, FolderOpen, Lock, LockOpen, Moon, Shield, ShieldAlert, ShieldCheck, ShieldOff, Sparkles, Trash2, X } from 'lucide-react'
import type { DownloadInfo, PerformanceReport, SiteInfo, Space } from '@shared/types'
import { ui } from '@/lib/api'
import { useStore } from '@/lib/store'
import { cls, Favicon, formatBytes, IconButton } from './bits'
import { permissionLabel } from './Content'
import { locale, t } from '@/lib/i18n'
import { insideWarning } from '@/lib/downloads'

function Popover({ children, label, className }: { children: ReactNode; label: string; className?: string }) {
  const close = () => useStore.getState().setOverlay(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className="popover-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className={cls('popover', className)} role="dialog" aria-label={label}>
        {children}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- shield

export function ShieldPanel() {
  const [info, setInfo] = useState<SiteInfo | null>(null)
  const state = useStore((s) => s.state)
  const settings = useStore((s) => s.settings)

  useEffect(() => {
    void ui().invoke('site:info').then(setInfo)
  }, [state?.activeTabId, state?.allowlist.length])

  if (!info) return null
  const secure = info.security === 'secure'
  return (
    <Popover label={t('shield.label')} className="shield-panel">
      <div className="panel-head">
        <span className={cls('sec-chip', !secure && 'is-warn')}>
          {secure ? <Lock size={13} /> : <LockOpen size={13} />}
          {secure ? t('toolbar.secure') : t('toolbar.insecure')}
        </span>
        <h3 className="panel-title">{info.host}</h3>
      </div>

      <div className="shield-count">
        <span className="shield-number">{info.blocked}</span>
        <span className="shield-caption">
          {info.blocked === 1 ? t('shield.one') : t('shield.many')}
        </span>
      </div>

      <label className={cls('switch-row', !settings?.adblock && 'is-disabled')}>
        <span>
          <strong>{t('shield.site')}</strong>
          <small>{settings?.adblock ? t('shield.siteHint') : t('shield.disabled')}</small>
        </span>
        <input
          type="checkbox"
          className="switch"
          disabled={!settings?.adblock}
          checked={info.adblockActive}
          onChange={() => void ui().invoke('site:toggle-adblock')}
        />
      </label>

      {/^https?:/.test(state?.tabs.find((x) => x.id === state.activeTabId)?.url ?? '') && (
        <label className="switch-row">
          <span>
            <strong>{t('shield.scripts')}</strong>
            <small>{t('shield.scriptsHint')}</small>
          </span>
          <input
            type="checkbox"
            className="switch"
            checked={info.scriptsActive}
            onChange={async () => {
              await ui().invoke('site:toggle-scripts')
              setInfo(await ui().invoke('site:info'))
            }}
          />
        </label>
      )}

      {info.permissions.length > 0 && (
        <div className="panel-section">
          <h4>{t('shield.perms')}</h4>
          {info.permissions.map((p) => (
            <div key={p.permission} className="perm-row">
              <span>
                {t(p.decision === 'allow' ? 'shield.can' : 'shield.cannot', { what: permissionLabel(p.permission) })}
              </span>
              <button
                type="button"
                className="link-btn"
                onClick={async () => {
                  await ui().invoke('site:clear-permission', p.permission)
                  setInfo(await ui().invoke('site:info'))
                }}
              >
                {t('common.reset')}
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="panel-foot">
        {t('shield.total', { n: (state?.totalBlocked ?? 0).toLocaleString(locale()) })}
      </p>
    </Popover>
  )
}

// ---------------------------------------------------------------- downloads

function downloadStatus(d: DownloadInfo): string {
  if (d.status === 'progressing') {
    if (d.scan === 'awaiting-confirmation') return t('dl.awaiting')
    const amount = d.total ? t('common.of', { a: formatBytes(d.received), b: formatBytes(d.total) }) : t('dl.received', { a: formatBytes(d.received) })
    if (d.speed < 1) return amount
    const speed = formatBytes(d.speed)
    if (!d.total) return t('dl.rate', { amount, speed })
    return t('dl.eta', { amount, speed, time: duration((d.total - d.received) / d.speed) })
  }
  if (d.status === 'paused') return d.scan === 'awaiting-confirmation' ? t('dl.awaiting') : t('dl.paused')
  if (d.status === 'cancelled') return t('dl.cancelled')
  if (d.status === 'interrupted') return t('dl.interrupted')
  const size = formatBytes(d.received)
  switch (d.scan) {
    case 'pending':
    case 'scanning':
      return t('dl.scanning')
    case 'clean':
      return t('dl.clean', { size })
    case 'infected':
      return t('dl.infected')
    case 'unavailable':
      return t('dl.unavailable', { size })
    default:
      return t('dl.done', { size })
  }
}

export function duration(seconds: number): string {
  const s = Math.max(1, Math.round(seconds))
  if (s < 60) return t('dl.sec', { n: s })
  if (s < 3600) return t('dl.min', { n: Math.round(s / 60) })
  return t('dl.hour', { n: Math.round((s / 3600) * 10) / 10 })
}

function ScanIcon({ d }: { d: DownloadInfo }) {
  if (d.scan === 'infected') return <ShieldAlert size={18} className="dl-icon is-danger" />
  if (d.scan === 'clean') return <ShieldCheck size={18} className="dl-icon is-safe" />
  if (d.scan === 'scanning' || (d.scan === 'pending' && d.status === 'completed')) return <span className="spinner dl-icon" style={{ width: 16, height: 16 }} />
  return <File size={18} className="dl-icon" />
}

export function DownloadsPanel() {
  const downloads = useStore((s) => s.downloads)
  return (
    <Popover label={t('dl.title')} className="downloads-panel">
      <div className="panel-head row">
        <h3 className="panel-title">{t('dl.title')}</h3>
        {downloads.some((d) => d.status !== 'progressing') && (
          <button type="button" className="link-btn" onClick={() => void ui().invoke('downloads:clear')}>
            {t('dl.clear')}
          </button>
        )}
      </div>
      {downloads.length === 0 ? (
        <p className="empty">{t('dl.empty')}</p>
      ) : (
        <ul className="dl-list">
          {downloads.map((d) => {
            const pct = d.total ? Math.min(100, (d.received / d.total) * 100) : 0
            const done = d.status === 'completed' && d.scan !== 'infected' && d.scan !== 'scanning'
            return (
              <li key={d.id} className={cls('dl-item', `is-${d.status}`)}>
                <button type="button" className="dl-main" disabled={!done} onClick={() => void ui().invoke('downloads:open', d.id)} title={done ? t('dl.open') : d.filename}>
                  <ScanIcon d={d} />
                  <span className="dl-text">
                    <span className="dl-name">{d.filename}</span>
                    {d.source && <span className="dl-source">{t('dl.from', { host: d.source })}</span>}
                    <span className={cls('dl-status', d.scan === 'infected' && 'is-danger', d.scan === 'clean' && !d.inside && 'is-safe')}>{downloadStatus(d)}</span>
                    {d.inside && d.scan !== 'infected' && <span className="dl-status is-danger">{insideWarning(d)}</span>}
                    {d.status === 'progressing' && d.scan !== 'awaiting-confirmation' && (
                      <span className="dl-bar">
                        <span style={{ width: `${d.total ? pct : 30}%` }} className={cls(!d.total && 'is-indeterminate')} />
                      </span>
                    )}
                  </span>
                </button>
                {d.status === 'progressing' || d.status === 'paused' ? (
                  <button type="button" className="dl-cancel" aria-label={t('dl.cancel')} title={t('dl.cancel')} onClick={() => void ui().invoke('downloads:cancel', d.id)}>
                    <X size={13} strokeWidth={2.5} /> {t('dl.cancelBtn')}
                  </button>
                ) : done ? (
                  <IconButton label={t('dl.show')} onClick={() => void ui().invoke('downloads:show', d.id)}>
                    <FolderOpen size={15} />
                  </IconButton>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </Popover>
  )
}

// ---------------------------------------------------------------- performance

const LIMITS = [
  { mb: 0, label: '' },
  { mb: 2048, label: '2 GB' },
  { mb: 4096, label: '4 GB' },
  { mb: 8192, label: '8 GB' }
]

export function PerfPanel() {
  const [report, setReport] = useState<PerformanceReport | null>(null)
  const state = useStore((s) => s.state)

  useEffect(() => {
    let alive = true
    const load = () => void ui().invoke('perf:report').then((r) => alive && setReport(r))
    load()
    const t = setInterval(load, 1500)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  if (!report) return null
  const totalMB = report.totalKB / 1024
  const limit = report.limitMB
  const usage = limit ? Math.min(1, totalMB / limit) : Math.min(1, totalMB / 8192)
  const visible = new Set([state?.activeTabId, state?.split?.left, state?.split?.right])

  return (
    <Popover label={t('perf.label')} className="perf-panel">
      <div className="panel-head">
        <h3 className="panel-title">{t('perf.memory')}</h3>
        <div className="perf-total">
          <span className="perf-number">{formatBytes(report.totalKB * 1024)}</span>
          {limit > 0 && <span className="perf-limit">/ {formatBytes(limit * 1024 * 1024)}</span>}
        </div>
        <div className={cls('meter', usage > 0.85 && 'is-high')}>
          <span style={{ width: `${usage * 100}%` }} />
        </div>
      </div>

      <div className="panel-section">
        <h4>{t('perf.limit')}</h4>
        <p className="hint">{t('perf.limitHint')}</p>
        <div className="segmented" role="radiogroup">
          {LIMITS.map((l) => (
            <button
              key={l.mb}
              type="button"
              role="radio"
              aria-checked={limit === l.mb}
              className={cls(limit === l.mb && 'is-on')}
              onClick={async () => {
                await ui().invoke('perf:set-limit', l.mb)
                setReport(await ui().invoke('perf:report'))
              }}
            >
              {l.mb === 0 ? t('perf.noLimit') : l.label}
            </button>
          ))}
        </div>
      </div>

      <div className="panel-section">
        <div className="row">
          <h4>{t('perf.tabs')}</h4>
          <button type="button" className="link-btn" onClick={() => void ui().invoke('cmd:run', 'sleep-background-tabs')}>
            <Moon size={13} /> {t('perf.sleepBg')}
          </button>
        </div>
        <ul className="perf-list">
          {report.tabs.map((row) => {
            const tab = state?.tabs.find((x) => x.id === row.tabId)
            return (
              <li key={row.tabId} className={cls(row.sleeping && 'is-sleeping')}>
                {tab ? <Favicon tab={{ ...tab, loading: false }} /> : <Sparkles size={15} />}
                <span className="perf-title">{row.title}</span>
                <span className="perf-mem">{row.sleeping ? t('perf.sleeping') : formatBytes(row.memoryKB * 1024)}</span>
                {!row.sleeping && !visible.has(row.tabId) ? (
                  <IconButton label={t('perf.sleepTab')} onClick={() => void ui().invoke('tab:sleep', row.tabId)}>
                    <Moon size={14} />
                  </IconButton>
                ) : (
                  <span className="perf-spacer" />
                )}
              </li>
            )
          })}
        </ul>
        <p className="hint">
          {t('perf.foot', { size: formatBytes(report.browserKB * 1024) })}
        </p>
      </div>
    </Popover>
  )
}

// ---------------------------------------------------------------- space editor

const GLYPHS = ['✦', '◆', '●', '▲', '■', '★', '☾', '☀', '✿', '♫', '⚑', '✎', '⌘', '☕', '🎮', '💼', '🎨', '📚', '🏠', '🧪', '💬', '🛒', '✈️', '🎬']

export function SpaceEditor({ space, count }: { space: Space; count: number }) {
  const [name, setName] = useState(space.name)
  const close = () => useStore.getState().setOverlay(null)
  const update = (patch: Partial<Omit<Space, 'id'>>) => void ui().invoke('space:update', space.id, patch)

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <form
        className="modal space-editor"
        style={{ ['--preview-hue' as string]: space.hue }}
        onSubmit={(e) => {
          e.preventDefault()
          update({ name })
          close()
        }}
      >
        <h3 className="panel-title">{t('space.edit')}</h3>
        <label className="field">
          <span>{t('space.name')}</span>
          <input autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onBlur={() => update({ name })} />
        </label>
        <div className="field">
          <span>{t('space.symbol')}</span>
          <div className="glyph-grid">
            {GLYPHS.map((g) => (
              <button key={g} type="button" className={cls('glyph', g === space.icon && 'is-on')} onClick={() => update({ icon: g })}>
                {g}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>{t('space.color')}</span>
          <input
            type="range"
            className="hue-range"
            min={0}
            max={360}
            value={space.hue}
            onChange={(e) => update({ hue: Number(e.target.value) })}
          />
        </label>
        <div className="modal-actions">
          {count > 1 && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                void ui().invoke('space:delete', space.id)
                close()
              }}
            >
              <Trash2 size={14} /> {t('space.delete')}
            </button>
          )}
          <span className="grow" />
          <button type="submit" className="btn btn-primary">
            {t('common.done')}
          </button>
        </div>
      </form>
    </div>
  )
}

export function ShieldIcon({ on }: { on: boolean }) {
  return on ? <Shield size={16} /> : <ShieldOff size={16} />
}
