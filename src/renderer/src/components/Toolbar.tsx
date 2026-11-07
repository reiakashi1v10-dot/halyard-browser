import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Columns2,
  Download,
  Gauge,
  Globe,
  Languages,
  Lock,
  LockOpen,
  MoreVertical,
  RotateCw,
  Shield,
  ShieldAlert,
  ShieldOff,
  Star,
  X,
  FileText,
  Sparkles,
  BotMessageSquare
} from 'lucide-react'
import type { TabInfo, WindowState } from '@shared/types'
import { ui } from '@/lib/api'
import { activeTab, useStore } from '@/lib/store'
import { cls, IconButton, internalPage, prettyUrl, searchQueryOf } from './bits'
import { t } from '@/lib/i18n'

export function Toolbar({ state }: { state: WindowState }) {
  const tab = activeTab(state)
  const overlay = useStore((s) => s.overlay)
  const downloads = useStore((s) => s.downloads)
  const toggle = (kind: 'shield' | 'downloads' | 'perf') =>
    useStore.getState().setOverlay(overlay?.kind === kind ? null : { kind })

  const active = downloads.filter((d) => d.status === 'progressing')
  const progress = active.length
    ? active.reduce((sum, d) => sum + (d.total ? d.received / d.total : 0), 0) / active.length
    : null

  const host = tab ? hostOf(tab.url) : ''
  const siteAllowed = !!host && state.allowlist.some((h) => host === h || host.endsWith(`.${h}`))
  const shieldOn = state.adblockEnabled && !siteAllowed
  const isWeb = !!tab && /^https?:/.test(tab.url)
  const agentOpen = useStore((s) => s.agentOpen)
  const agentRunning = useStore((s) => !!s.agent?.running)

  return (
    <header className="toolbar drag">
      <div className="nav no-drag">
        <IconButton label={t('toolbar.back')} disabled={!tab?.canGoBack} onClick={() => void ui().invoke('cmd:run', 'back')}>
          <ArrowLeft size={16} />
        </IconButton>
        <IconButton label={t('toolbar.forward')} disabled={!tab?.canGoForward} onClick={() => void ui().invoke('cmd:run', 'forward')}>
          <ArrowRight size={16} />
        </IconButton>
        {tab?.loading ? (
          <IconButton label={t('toolbar.stop')} onClick={() => void ui().invoke('cmd:run', 'stop')}>
            <X size={16} />
          </IconButton>
        ) : (
          <IconButton label={t('toolbar.reload')} onClick={() => void ui().invoke('cmd:run', 'reload')}>
            <RotateCw size={15} />
          </IconButton>
        )}
      </div>

      <AddressPill tab={tab} />

      <div className="tool-actions no-drag">
        <IconButton
          label={shieldOn ? t('toolbar.shieldOn', { n: tab?.blocked ?? 0 }) : t('toolbar.shieldOff')}
          className={cls('shield-btn', !shieldOn && 'is-off')}
          active={overlay?.kind === 'shield'}
          disabled={!isWeb}
          onClick={() => toggle('shield')}
        >
          {shieldOn ? <Shield size={16} /> : <ShieldOff size={16} />}
          {shieldOn && !!tab?.blocked && <span className="badge">{tab.blocked > 99 ? '99+' : tab.blocked}</span>}
        </IconButton>
        {isWeb && tab && (tab.translated || tab.foreign) && (
          <IconButton
            label={tab.translated ? t('tr.translated') : t('tr.button')}
            active={tab.translated}
            className="translate-btn"
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
              void ui().invoke('tab:translate-menu', r.right, r.bottom + 6)
            }}
          >
            <Languages size={16} />
          </IconButton>
        )}
        <BookmarkButton tab={tab} />
        <IconButton
          label={state.split ? t('toolbar.splitClose') : t('toolbar.splitOpen')}
          active={!!state.split}
          onClick={() => void ui().invoke('cmd:run', 'toggle-split')}
        >
          <Columns2 size={16} />
        </IconButton>
        <IconButton
          label={`${t('agent.title')} (Ctrl+Shift+A)`}
          active={agentOpen}
          className={cls(agentRunning && 'is-busy')}
          onClick={() => useStore.setState((s) => ({ agentOpen: !s.agentOpen, agentFocus: s.agentFocus + 1 }))}
        >
          <BotMessageSquare size={16} />
        </IconButton>
        <IconButton label={t('toolbar.downloads')} active={overlay?.kind === 'downloads'} onClick={() => toggle('downloads')} className="dl-btn">
          <Download size={16} />
          {progress !== null && (
            <svg className="dl-ring" viewBox="0 0 24 24" aria-hidden>
              <circle cx="12" cy="12" r="10.5" pathLength="100" strokeDasharray={`${Math.max(4, progress * 100)} 100`} />
            </svg>
          )}
        </IconButton>
        <IconButton label={t('toolbar.perf')} active={overlay?.kind === 'perf'} onClick={() => toggle('perf')}>
          <Gauge size={16} />
        </IconButton>
        <IconButton
          label={t('toolbar.menu')}
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            void ui().invoke('app:menu', r.right, r.bottom + 6)
          }}
        >
          <MoreVertical size={16} />
        </IconButton>
      </div>
      <div className={cls('caption-space', window.halyard.platform === 'darwin' && 'is-mac')} />
    </header>
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function AddressPill({ tab }: { tab: TabInfo | null }) {
  const toast = useStore((s) => s.toast)
  const [showToast, setShowToast] = useState(false)

  useEffect(() => {
    if (!toast) return
    setShowToast(true)
    const t = setTimeout(() => setShowToast(false), 2200)
    return () => clearTimeout(t)
  }, [toast])

  const open = () =>
    useStore.getState().setOverlay({
      kind: 'palette',
      mode: 'current',
      // on a Halyard search page, edit the words searched, not the internal address
      query: !tab || tab.url.startsWith('halyard://newtab') ? '' : internalPage(tab.url) === 'search' && tab.url.startsWith('halyard://') ? searchQueryOf(tab.url) : tab.url
    })

  if (showToast && toast) {
    return (
      <div className="address no-drag is-toast" role="status">
        <Check size={14} className="address-sec" />
        <span className="address-host">{toast.message}</span>
      </div>
    )
  }

  const { host, rest } = tab ? prettyUrl(tab.url) : { host: '', rest: '' }
  const sec = tab?.security
  const SecIcon =
    sec === 'secure' ? Lock : sec === 'insecure' ? LockOpen : sec === 'dangerous' ? ShieldAlert : sec === 'internal' ? Sparkles : sec === 'local' ? FileText : Globe
  const secLabel =
    sec === 'secure'
      ? t('toolbar.secure')
      : sec === 'insecure'
        ? t('toolbar.insecure')
        : sec === 'dangerous'
          ? t('toolbar.dangerous')
          : sec === 'internal'
            ? t('toolbar.internal')
            : t('toolbar.local')

  return (
    <div className={cls('address no-drag', tab?.loading && 'is-loading', sec === 'insecure' && 'is-insecure', sec === 'dangerous' && 'is-dangerous')}>
      <button type="button" className="address-main" onClick={open} title={t('toolbar.edit')}>
        <span className="address-sec" title={secLabel}>
          <SecIcon size={13} />
        </span>
        {tab && !tab.url.startsWith('halyard://newtab') ? (
          <span className="address-text">
            <span className="address-host">{host}</span>
            <span className="address-rest">{rest}</span>
          </span>
        ) : (
          <span className="address-placeholder">{t('toolbar.placeholder')}</span>
        )}
      </button>
      {tab && Math.abs(tab.zoom - 1) > 0.01 && (
        <button type="button" className="address-zoom" title={t('toolbar.zoomReset')} onClick={() => void ui().invoke('cmd:run', 'zoom-reset')}>
          {Math.round(tab.zoom * 100)}%
        </button>
      )}
      <span className="address-progress" aria-hidden />
    </div>
  )
}

function BookmarkButton({ tab }: { tab: TabInfo | null }) {
  const [marked, setMarked] = useState(false)
  const url = tab?.url ?? ''
  const toast = useStore((s) => s.toast)
  const enabled = /^(https?|file):/.test(url)

  useEffect(() => {
    if (!enabled) return setMarked(false)
    let alive = true
    void ui()
      .invoke('bookmark:is', url)
      .then((v) => alive && setMarked(v))
    return () => {
      alive = false
    }
  }, [url, enabled, toast])

  return (
    <IconButton
      label={marked ? t('toolbar.unbookmark') : t('toolbar.bookmark')}
      disabled={!enabled}
      active={marked}
      className={cls('star-btn', marked && 'is-marked')}
      onClick={async () => setMarked(await ui().invoke('bookmark:toggle'))}
    >
      <Star size={16} />
    </IconButton>
  )
}
