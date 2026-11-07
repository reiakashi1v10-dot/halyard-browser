import { useEffect, useMemo, useRef, useState } from 'react'
import { AppWindow, ArrowRight, Clock, Command, CornerDownLeft, Globe, Search, Star } from 'lucide-react'
import type { PaletteItem } from '@shared/types'
import { ui } from '@/lib/api'
import { useStore } from '@/lib/store'
import { cls, Favicon } from './bits'
import { t, type I18nKey } from '@/lib/i18n'

const kindLabel = (kind: PaletteItem['kind']): string => t(`palette.kind.${kind}` as I18nKey)

export function Palette({ mode, initial }: { mode: 'current' | 'new'; initial: string }) {
  const [query, setQuery] = useState(initial)
  const [items, setItems] = useState<PaletteItem[]>([])
  const [selected, setSelected] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const seq = useRef(0)
  const close = () => useStore.getState().setOverlay(null)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])

  useEffect(() => {
    const id = ++seq.current
    // local results first (instant), then the search engine's suggestions
    void ui()
      .invoke('palette:query', query, false)
      .then((res) => {
        if (id !== seq.current) return
        setItems(res)
        setSelected(0)
      })
    if (!query.trim() || query.trim().startsWith('>')) return
    const t = setTimeout(() => {
      void ui()
        .invoke('palette:query', query, true)
        .then((res) => {
          if (id === seq.current) setItems(res)
        })
    }, 120)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const run = (item: PaletteItem | undefined, forceNew = false) => {
    const where = forceNew ? 'new' : mode
    close()
    if (!item) {
      if (query.trim()) void ui().invoke('nav:go', query, where)
      return
    }
    if (item.kind === 'tab' && item.tabId != null) void ui().invoke('tab:activate', item.tabId)
    else if (item.kind === 'command' && item.command) void ui().invoke('cmd:run', item.command)
    else if (item.url) void ui().invoke('nav:go', item.url, where)
  }

  const heading = useMemo(() => {
    if (query.trim().startsWith('>')) return t('palette.actions')
    if (!query.trim()) return t('palette.recent')
    return null
  }, [query])

  return (
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-label={mode === 'new' ? t('palette.labelNew') : t('palette.labelCurrent')}>
        <div className="palette-input">
          <Search size={18} className="palette-search-icon" />
          <input
            ref={input}
            value={query}
            spellCheck={false}
            placeholder={mode === 'new' ? t('palette.phNew') : t('palette.phCurrent')}
            aria-label={t('palette.search')}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                close()
              } else if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSelected((s) => Math.min(items.length - 1, s + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSelected((s) => Math.max(0, s - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                run(items[selected], e.altKey || e.ctrlKey)
              } else if (e.key === 'Tab' && items[selected]?.url && items[selected].kind !== 'search') {
                e.preventDefault()
                setQuery(items[selected].url!)
              }
            }}
          />
          <span className="palette-mode">{mode === 'new' ? t('palette.modeNew') : t('palette.modeCurrent')}</span>
        </div>
        {items.length > 0 && (
          <div className="palette-list" ref={list} role="listbox">
            {heading && <div className="palette-heading">{heading}</div>}
            {items.map((item, i) => (
              <div
                key={`${item.id}-${i}`}
                data-index={i}
                role="option"
                aria-selected={i === selected}
                className={cls('palette-item', i === selected && 'is-selected', `kind-${item.kind}`)}
                onMouseMove={() => i !== selected && setSelected(i)}
                onClick={(e) => run(item, e.ctrlKey || e.altKey)}
              >
                <span className="palette-icon">{iconFor(item)}</span>
                <span className="palette-text">
                  <span className="palette-title">{item.title}</span>
                  {item.subtitle && item.kind !== 'command' && <span className="palette-sub">{item.subtitle}</span>}
                </span>
                {item.kind === 'command' && item.subtitle && <kbd>{item.subtitle}</kbd>}
                <span className="palette-kind">
                  {i === selected ? (
                    <>
                      {item.kind === 'tab' ? t('palette.switch') : item.kind === 'command' ? t('palette.run') : t('palette.open')}
                      <CornerDownLeft size={12} />
                    </>
                  ) : (
                    kindLabel(item.kind)
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="palette-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> {t('palette.footNav')}
          </span>
          <span>
            <kbd>Enter</kbd> {t('palette.footOpen')}
          </span>
          <span>
            <kbd>Alt</kbd>+<kbd>Enter</kbd> {t('palette.footNew')}
          </span>
          <span>
            <kbd>&gt;</kbd> {t('palette.footActions')}
          </span>
        </div>
      </div>
    </div>
  )
}

function iconFor(item: PaletteItem) {
  switch (item.kind) {
    case 'tab':
      return item.url ? <Favicon tab={{ url: item.url, favicon: item.favicon ?? null, loading: false }} /> : <AppWindow size={16} />
    case 'bookmark':
      return item.favicon ? <Favicon tab={{ url: item.url ?? '', favicon: item.favicon, loading: false }} /> : <Star size={16} />
    case 'history':
      return item.favicon ? <Favicon tab={{ url: item.url ?? '', favicon: item.favicon, loading: false }} /> : <Clock size={16} />
    case 'url':
      return <Globe size={16} />
    case 'command':
      return <Command size={16} />
    case 'suggestion':
      return <ArrowRight size={15} />
    default:
      return <Search size={16} />
  }
}
