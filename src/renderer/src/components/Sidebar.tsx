import { useState, type CSSProperties, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Camera, Columns2, Mic, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Plus, Volume2, VolumeX, X } from 'lucide-react'
import type { Space, TabInfo, WindowState } from '@shared/types'
import { ui } from '@/lib/api'
import { useStore, visibleTabs } from '@/lib/store'
import { cls, Favicon, IconButton } from './bits'
import { t, type I18nKey } from '@/lib/i18n'

const DRAG_TYPE = 'application/x-halyard-tab'

type DropTarget = { group: 'pinned' | 'regular'; index: number } | null

export function Sidebar({ state }: { state: WindowState }) {
  const collapsed = state.sidebarCollapsed
  const { pinned, regular } = visibleTabs(state)
  const space = state.spaces.find((s) => s.id === state.activeSpaceId)
  const [drop, setDrop] = useState<DropTarget>(null)
  const [dragging, setDragging] = useState(false)
  const isMac = window.halyard.platform === 'darwin'

  const splitIds = new Set(state.split ? [state.split.left, state.split.right] : [])

  const onDragStart = (e: DragEvent, tab: TabInfo) => {
    setDragging(true)
    e.dataTransfer.setData(DRAG_TYPE, String(tab.id))
    e.dataTransfer.effectAllowed = 'move'
  }

  const onDragOverItem = (e: DragEvent, group: 'pinned' | 'regular', index: number) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
    e.preventDefault()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const after = group === 'pinned' ? e.clientX > rect.left + rect.width / 2 : e.clientY > rect.top + rect.height / 2
    const next = { group, index: index + (after ? 1 : 0) }
    if (drop?.group !== next.group || drop.index !== next.index) setDrop(next)
  }

  const onDropAt = (e: DragEvent) => {
    e.preventDefault()
    const id = Number(e.dataTransfer.getData(DRAG_TYPE))
    if (id && drop) {
      const list = drop.group === 'pinned' ? pinned : regular
      // indexes are computed with the dragged tab still in the list
      const from = list.findIndex((t) => t.id === id)
      const index = from >= 0 && from < drop.index ? drop.index - 1 : drop.index
      void ui().invoke('tab:move', id, index, drop.group === 'pinned')
    }
    setDrop(null)
    setDragging(false)
  }

  const endDrag = () => {
    setDrop(null)
    setDragging(false)
  }

  return (
    <aside className={cls('sidebar', collapsed && 'is-collapsed', dragging && 'is-tab-drag')} onDragEnd={endDrag}>
      <div className={cls('sidebar-top', 'drag', isMac && 'has-traffic-lights')}>
        <IconButton
          label={collapsed ? t('sidebar.show') : t('sidebar.hide')}
          className="no-drag"
          onClick={() => void ui().invoke('cmd:run', 'toggle-sidebar')}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </IconButton>
        {!collapsed && state.isPrivate && <span className="private-badge">{t('sidebar.private')}</span>}
      </div>

      <div
        className={cls('pinned', pinned.length === 0 && 'is-empty', drop?.group === 'pinned' && 'is-drop')}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
          e.preventDefault()
          if (pinned.length === 0) setDrop({ group: 'pinned', index: 0 })
        }}
        onDrop={onDropAt}
      >
        {pinned.length === 0 ? (
          !collapsed && <span className="pinned-hint">{t('sidebar.pinHint')}</span>
        ) : (
          pinned.map((tab, i) => (
            <PinnedTile
              key={tab.id}
              tab={tab}
              active={tab.id === state.activeTabId || splitIds.has(tab.id)}
              dropBefore={drop?.group === 'pinned' && drop.index === i}
              dropAfter={drop?.group === 'pinned' && drop.index === i + 1 && i === pinned.length - 1}
              onDragStart={(e) => onDragStart(e, tab)}
              onDragOver={(e) => onDragOverItem(e, 'pinned', i)}
            />
          ))
        )}
      </div>

      {space && <SpaceHeader space={space} collapsed={collapsed} isPrivate={state.isPrivate} />}

      <button
        type="button"
        className="new-tab-row"
        title={t('sidebar.newTabKey')}
        onClick={() => useStore.getState().setOverlay({ kind: 'palette', mode: 'new', query: '' })}
      >
        <Plus size={16} strokeWidth={2} />
        {!collapsed && <span>{t('cmd.new-tab')}</span>}
      </button>

      <div
        className="tab-list"
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
          e.preventDefault()
          if (e.target === e.currentTarget) setDrop({ group: 'regular', index: regular.length })
        }}
        onDrop={onDropAt}
        onDoubleClick={(e) => {
          if (e.target === e.currentTarget) useStore.getState().setOverlay({ kind: 'palette', mode: 'new', query: '' })
        }}
      >
        {regular.map((tab, i) => (
          <TabRow
            key={tab.id}
            tab={tab}
            collapsed={collapsed}
            active={tab.id === state.activeTabId}
            inSplit={splitIds.has(tab.id)}
            dropBefore={drop?.group === 'regular' && drop.index === i}
            dropAfter={drop?.group === 'regular' && drop.index === regular.length && i === regular.length - 1}
            onDragStart={(e) => onDragStart(e, tab)}
            onDragOver={(e) => onDragOverItem(e, 'regular', i)}
          />
        ))}
      </div>

      <SpaceSwitcher state={state} collapsed={collapsed} />
      {!collapsed && <ResizeHandle />}
    </aside>
  )
}

function tabHandlers(tab: TabInfo) {
  return {
    onClick: () => void ui().invoke('tab:activate', tab.id),
    onAuxClick: (e: React.MouseEvent) => {
      if (e.button === 1) void ui().invoke('tab:close', tab.id)
    },
    onMouseDown: (e: React.MouseEvent) => {
      if (e.button === 1) e.preventDefault()
    },
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault()
      void ui().invoke('tab:menu', tab.id)
    }
  }
}

function TabRow(props: {
  tab: TabInfo
  active: boolean
  collapsed: boolean
  inSplit: boolean
  dropBefore: boolean
  dropAfter: boolean
  onDragStart: (e: DragEvent) => void
  onDragOver: (e: DragEvent) => void
}) {
  const { tab, active, collapsed } = props
  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={0}
      title={`${tab.container !== null ? `${t('sidebar.container')} · ` : ''}${collapsed ? tab.title : `${tab.title}\n${tab.url}`}`}
      style={tab.container !== null ? ({ '--ctr-hue': tab.container } as CSSProperties) : undefined}
      className={cls(
        'tab',
        active && 'is-active',
        tab.sleeping && 'is-sleeping',
        tab.container !== null && 'has-container',
        props.inSplit && 'is-split',
        props.dropBefore && 'drop-before',
        props.dropAfter && 'drop-after'
      )}
      draggable
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') void ui().invoke('tab:activate', tab.id)
        if (e.key === 'Delete') void ui().invoke('tab:close', tab.id)
      }}
      {...tabHandlers(tab)}
    >
      <span className="tab-icon">
        <Favicon tab={tab} />
        {collapsed && (tab.audible || tab.muted) && <span className="tab-audio-dot" />}
        {collapsed && tab.capture && <span className="tab-capture-dot" />}
      </span>
      {!collapsed && <span className="tab-title">{tab.title}</span>}
      {!collapsed && tab.capture && (
        <span className="tab-capture" title={t(`sidebar.capture.${tab.capture}` as I18nKey)} aria-label={t(`sidebar.capture.${tab.capture}` as I18nKey)}>
          {tab.capture === 'microphone' ? <Mic size={13} /> : <Camera size={13} />}
        </span>
      )}
      {!collapsed && props.inSplit && <Columns2 className="tab-flag" size={13} aria-label={t('sidebar.inSplit')} />}
      {!collapsed && (tab.audible || tab.muted) && (
        <button
          type="button"
          className="tab-btn tab-audio"
          title={tab.muted ? t('sidebar.unmute') : t('sidebar.mute')}
          onClick={(e) => {
            e.stopPropagation()
            void ui().invoke('tab:mute', tab.id)
          }}
        >
          {tab.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
        </button>
      )}
      {!collapsed && (
        <button
          type="button"
          className="tab-btn tab-close"
          title={t('sidebar.closeTab')}
          onClick={(e) => {
            e.stopPropagation()
            void ui().invoke('tab:close', tab.id)
          }}
        >
          <X size={13} strokeWidth={2.2} />
        </button>
      )}
    </div>
  )
}

function PinnedTile(props: {
  tab: TabInfo
  active: boolean
  dropBefore: boolean
  dropAfter: boolean
  onDragStart: (e: DragEvent) => void
  onDragOver: (e: DragEvent) => void
}) {
  const { tab } = props
  return (
    <button
      type="button"
      title={tab.title}
      className={cls(
        'pin',
        props.active && 'is-active',
        tab.sleeping && 'is-sleeping',
        props.dropBefore && 'drop-before',
        props.dropAfter && 'drop-after'
      )}
      draggable
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      {...tabHandlers(tab)}
    >
      <Favicon tab={tab} size={18} />
      {(tab.audible || tab.muted) && <span className="pin-audio">{tab.muted ? <VolumeX size={10} /> : <Volume2 size={10} />}</span>}
    </button>
  )
}

function SpaceHeader({ space, collapsed, isPrivate }: { space: Space; collapsed: boolean; isPrivate: boolean }) {
  if (collapsed) return <div className="space-head is-compact" title={space.name}>{space.icon}</div>
  return (
    <div className="space-head">
      <span className="space-glyph">{space.icon}</span>
      <span
        className="space-name"
        onDoubleClick={() => !isPrivate && useStore.getState().setOverlay({ kind: 'space', id: space.id })}
      >
        {space.name}
      </span>
      {!isPrivate && (
        <IconButton label={t('sidebar.spaceOptions')} className="space-more" onClick={() => void ui().invoke('space:menu', space.id)}>
          <MoreHorizontal size={15} />
        </IconButton>
      )}
    </div>
  )
}

function SpaceSwitcher({ state, collapsed }: { state: WindowState; collapsed: boolean }) {
  if (state.isPrivate) return <div className="space-switcher" />
  return (
    <nav
      className={cls('space-switcher', collapsed && 'is-vertical')}
      aria-label={t('sidebar.spaces')}
      onWheel={(e) => {
        if (Math.abs(e.deltaY) < 30) return
        void ui().invoke('cmd:run', e.deltaY > 0 ? 'next-space' : 'prev-space')
      }}
    >
      {state.spaces.map((s) => (
        <button
          key={s.id}
          type="button"
          className={cls('space-dot', s.id === state.activeSpaceId && 'is-active')}
          style={{ ['--dot-hue' as string]: s.hue }}
          title={s.name}
          onClick={() => void ui().invoke('space:activate', s.id)}
          onDoubleClick={() => useStore.getState().setOverlay({ kind: 'space', id: s.id })}
          onContextMenu={(e) => {
            e.preventDefault()
            void ui().invoke('space:menu', s.id)
          }}
        >
          {s.icon}
        </button>
      ))}
      <IconButton
        label={t('sidebar.newSpace')}
        className="space-add"
        onClick={async () => {
          const space = await ui().invoke('space:create')
          useStore.getState().setOverlay({ kind: 'space', id: space.id })
        }}
      >
        <Plus size={14} />
      </IconButton>
    </nav>
  )
}

/** Drag the sidebar edge to resize. Pages are frozen meanwhile so the pointer stays with us. */
function ResizeHandle() {
  const onPointerDown = (e: ReactPointerEvent) => {
    e.preventDefault()
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    useStore.getState().setOverlay({ kind: 'drag' })
    const root = document.documentElement
    let width = 0
    const move = (ev: PointerEvent) => {
      width = Math.round(Math.min(420, Math.max(200, ev.clientX - 4)))
      root.style.setProperty('--sidebar-w', `${width}px`)
    }
    const up = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      target.removeEventListener('pointercancel', up)
      if (width) void ui().invoke('ui:sidebar-width', width)
      useStore.getState().setOverlay(null)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
    target.addEventListener('pointercancel', up)
  }
  return <div className="sidebar-resize" onPointerDown={onPointerDown} onDoubleClick={() => void ui().invoke('ui:sidebar-width', 264)} />
}
