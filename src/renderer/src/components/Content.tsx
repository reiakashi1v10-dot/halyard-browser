import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ChevronDown, ChevronUp, RotateCw, TriangleAlert, X } from 'lucide-react'
import type { PermissionPrompt, WindowState } from '@shared/types'
import { ui } from '@/lib/api'
import { activeTab, useStore } from '@/lib/store'
import { IconButton } from './bits'
import { t, type I18nKey } from '@/lib/i18n'

const SPLIT_GAP = 8

/** The page area. Its rectangle is reported to the main process, which places the web views on it. */
export function Content({ state }: { state: WindowState }) {
  const ref = useRef<HTMLElement>(null)
  const frames = useStore((s) => s.frames)
  const tab = activeTab(state)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    let raf = 0
    const report = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect()
        setSize({ width: r.width, height: r.height })
        void ui().invoke('ui:bounds', {
          left: Math.round(r.left),
          top: Math.round(r.top),
          right: Math.max(0, Math.round(window.innerWidth - r.right)),
          bottom: Math.max(0, Math.round(window.innerHeight - r.bottom))
        })
      })
    }
    const ro = new ResizeObserver(report)
    ro.observe(el)
    ro.observe(document.body)
    window.addEventListener('resize', report)
    report()
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', report)
      cancelAnimationFrame(raf)
    }
  }, [])

  const split = state.split
  const leftW = split ? Math.round((size.width - SPLIT_GAP) * split.ratio) : size.width
  const paneStyle = (tabId: number): React.CSSProperties => {
    if (!split) return { left: 0, width: '100%' }
    if (tabId === split.left) return { left: 0, width: leftW }
    return { left: leftW + SPLIT_GAP, width: size.width - leftW - SPLIT_GAP }
  }

  return (
    <section ref={ref} className="content" aria-label={t('content.page')}>
      {split ? (
        <>
          <div className={`pane-card${state.activeTabId === split.left ? ' is-focused' : ''}`} style={paneStyle(split.left)} />
          <div className={`pane-card${state.activeTabId === split.right ? ' is-focused' : ''}`} style={paneStyle(split.right)} />
        </>
      ) : (
        <div className="pane-card" style={{ left: 0, width: '100%' }} />
      )}
      {frames.map((f) => (
        <img key={f.tabId} className="frame" src={f.dataUrl} alt="" style={paneStyle(f.tabId)} draggable={false} />
      ))}
      {tab?.crashed && !split && (
        <div className="crash">
          <h2>{t('content.crashTitle')}</h2>
          <p>{t('content.crashBody')}</p>
          <button type="button" className="btn btn-primary" onClick={() => void ui().invoke('cmd:run', 'reload')}>
            <RotateCw size={14} /> {t('content.crashReload')}
          </button>
        </div>
      )}
      {split && <SplitHandle left={leftW} width={size.width} />}
    </section>
  )
}

function SplitHandle({ left, width }: { left: number; width: number }) {
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    const target = e.currentTarget as HTMLElement
    const parent = target.parentElement!.getBoundingClientRect()
    target.setPointerCapture(e.pointerId)
    useStore.getState().setOverlay({ kind: 'drag' })
    let raf = 0
    const move = (ev: PointerEvent) => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => void ui().invoke('split:ratio', (ev.clientX - parent.left) / parent.width))
    }
    const up = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      target.removeEventListener('pointercancel', up)
      useStore.getState().setOverlay(null)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
    target.addEventListener('pointercancel', up)
  }
  if (!width) return null
  return (
    <div
      className="split-handle"
      style={{ left }}
      title={t('content.splitHandle')}
      onPointerDown={onPointerDown}
      onDoubleClick={() => void ui().invoke('split:ratio', 0.5)}
      onContextMenu={(e) => {
        e.preventDefault()
        void ui().invoke('split:swap')
      }}
    >
      <span />
    </div>
  )
}

export function FindBar({ state }: { state: WindowState }) {
  const focusTick = useStore((s) => s.findFocus)
  const input = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')

  useEffect(() => {
    if (!state.find.open) return
    input.current?.focus()
    input.current?.select()
  }, [focusTick, state.find.open])

  useEffect(() => {
    if (!state.find.open) setText('')
  }, [state.find.open])

  if (!state.find.open) return null
  const search = (value: string, forward = true, findNext = false) =>
    void ui().invoke('find:query', value, { forward, findNext })

  return (
    <div className="strip find-bar" role="search">
      <input
        ref={input}
        value={text}
        placeholder={t('find.placeholder')}
        aria-label={t('find.placeholder')}
        onChange={(e) => {
          setText(e.target.value)
          search(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') search(text, !e.shiftKey, true)
          if (e.key === 'Escape') void ui().invoke('find:close')
        }}
      />
      <span className="find-count">
        {text ? (state.find.matches ? t('common.of', { a: state.find.active, b: state.find.matches }) : t('find.none')) : ''}
      </span>
      <IconButton label={t('find.prev')} disabled={!state.find.matches} onClick={() => search(text, false, true)}>
        <ChevronUp size={15} />
      </IconButton>
      <IconButton label={t('find.next')} disabled={!state.find.matches} onClick={() => search(text, true, true)}>
        <ChevronDown size={15} />
      </IconButton>
      <IconButton label={t('find.close')} onClick={() => void ui().invoke('find:close')}>
        <X size={15} />
      </IconButton>
    </div>
  )
}

const KNOWN_PERMISSIONS = new Set([
  'camera', 'microphone', 'camera+microphone', 'geolocation', 'notifications', 'clipboard-read', 'midi', 'midiSysex',
  'idle-detection', 'hid', 'serial', 'usb', 'display-capture', 'speaker-selection', 'storage-access',
  'top-level-storage-access', 'keyboardLock'
])

export function permissionLabel(p: string): string {
  return KNOWN_PERMISSIONS.has(p) ? t(`perm.${p}` as I18nKey) : t('perm.other', { p })
}

/** Camera, microphone, location...: granted "only this time" unless the user ticks the box. */
const ONE_TIME = new Set(['camera', 'microphone', 'camera+microphone', 'geolocation', 'display-capture', 'clipboard-read', 'hid', 'serial', 'usb', 'midiSysex'])

/** A warning that needs the user's attention. Stays for 15 s or until closed. */
export function NoticeBar() {
  const notice = useStore((s) => s.notice)
  useEffect(() => {
    if (!notice) return
    const id = notice.id
    const timer = setTimeout(() => {
      if (useStore.getState().notice?.id === id) useStore.setState({ notice: null })
    }, 15_000)
    return () => clearTimeout(timer)
  }, [notice])
  if (!notice) return null
  return (
    <div className="strip notice-bar" role="alert">
      <TriangleAlert size={16} className="notice-icon" />
      <p>{notice.message}</p>
      <IconButton label={t('notice.close')} onClick={() => useStore.setState({ notice: null })}>
        <X size={14} />
      </IconButton>
    </div>
  )
}

export function PromptBar({ prompts, isPrivate }: { prompts: PermissionPrompt[]; isPrivate: boolean }) {
  const [remember, setRemember] = useState(true)
  const prompt = prompts[0]
  useEffect(() => {
    if (prompt) setRemember(!ONE_TIME.has(prompt.permission))
  }, [prompt?.id])
  if (!prompt) return null
  let host = prompt.origin
  try {
    host = new URL(prompt.origin).hostname.replace(/^www\./, '')
  } catch {
    /* keep origin */
  }
  const respond = (allow: boolean) => void ui().invoke('prompt:respond', prompt.id, allow, remember && !isPrivate)
  return (
    <div className="strip prompt-bar" role="alertdialog" aria-label={t('prompt.label')}>
      <p>
        <strong>{host}</strong> {t('prompt.wants', { what: permissionLabel(prompt.permission) })}
        {prompts.length > 1 && <span className="prompt-more"> (+{prompts.length - 1})</span>}
      </p>
      {!isPrivate && (
        <label className="check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          {t('prompt.remember')}
        </label>
      )}
      <button type="button" className="btn" onClick={() => respond(false)}>
        {t('prompt.block')}
      </button>
      <button type="button" className="btn btn-primary" onClick={() => respond(true)}>
        {t('prompt.allow')}
      </button>
    </div>
  )
}
