import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  AppWindow,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  BookA,
  Check,
  ChevronRight,
  ClipboardPaste,
  Code,
  Columns2,
  Copy,
  CopyPlus,
  Download,
  ExternalLink,
  EyeOff,
  FolderInput,
  History,
  Image,
  Link,
  ListX,
  Moon,
  Palette,
  Pencil,
  PictureInPicture2,
  Pin,
  PinOff,
  Plus,
  Power,
  Printer,
  Redo2,
  RotateCw,
  ScanSearch,
  Scissors,
  Search,
  Settings,
  SpellCheck,
  Star,
  Sun,
  TextSelect,
  UserRound,
  Languages,
  Globe,
  Info,
  Trash2,
  Undo2,
  Volume2,
  VolumeX,
  X,
  ZoomIn,
  ZoomOut,
  QrCode,
  Share2,
  Camera,
  FlaskConical,
  Eraser,
  ShieldCheck
} from 'lucide-react'
import type { MenuEntry } from '@shared/types'
import { ui } from '@/lib/api'
import { useStore } from '@/lib/store'
import { cls } from './bits'

const ICONS: Record<string, ReactNode> = {
  spell: <SpellCheck size={15} />,
  user: <UserRound size={15} />,
  translate: <Languages size={15} />,
  globe: <Globe size={15} />,
  info: <Info size={15} />,
  book: <BookA size={15} />,
  external: <ExternalLink size={15} />,
  columns: <Columns2 size={15} />,
  private: <EyeOff size={15} />,
  link: <Link size={15} />,
  image: <Image size={15} />,
  download: <Download size={15} />,
  copy: <Copy size={15} />,
  pip: <PictureInPicture2 size={15} />,
  undo: <Undo2 size={15} />,
  redo: <Redo2 size={15} />,
  cut: <Scissors size={15} />,
  paste: <ClipboardPaste size={15} />,
  select: <TextSelect size={15} />,
  search: <Search size={15} />,
  back: <ArrowLeft size={15} />,
  forward: <ArrowRight size={15} />,
  reload: <RotateCw size={15} />,
  print: <Printer size={15} />,
  code: <Code size={15} />,
  inspect: <ScanSearch size={15} />,
  duplicate: <CopyPlus size={15} />,
  pin: <Pin size={15} />,
  unpin: <PinOff size={15} />,
  sound: <Volume2 size={15} />,
  mute: <VolumeX size={15} />,
  sleep: <Moon size={15} />,
  move: <FolderInput size={15} />,
  'close-others': <ListX size={15} />,
  'close-below': <ArrowDownToLine size={15} />,
  close: <X size={15} />,
  edit: <Pencil size={15} />,
  palette: <Palette size={15} />,
  trash: <Trash2 size={15} />,
  plus: <Plus size={15} />,
  window: <AppWindow size={15} />,
  history: <History size={15} />,
  star: <Star size={15} />,
  zoom: <ZoomIn size={15} />,
  'zoom-in': <ZoomIn size={15} />,
  'zoom-out': <ZoomOut size={15} />,
  sun: <Sun size={15} />,
  moon: <Moon size={15} />,
  settings: <Settings size={15} />,
  quit: <Power size={15} />,
  qr: <QrCode size={15} />,
  share: <Share2 size={15} />,
  camera: <Camera size={15} />,
  lab: <FlaskConical size={15} />,
  eraser: <Eraser size={15} />,
  shield: <ShieldCheck size={15} />
}

const MARGIN = 8

/** Keep a box of the given size inside the window, preferring the requested corner. */
function place(x: number, y: number, w: number, h: number, flipFrom?: number): { left: number; top: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  let left = x
  if (left + w > vw - MARGIN) left = flipFrom !== undefined ? flipFrom - w : vw - MARGIN - w
  left = Math.max(MARGIN, left)
  let top = y
  if (top + h > vh - MARGIN) top = Math.max(MARGIN, vh - MARGIN - h)
  return { left, top: Math.max(MARGIN, top) }
}

export function ContextMenu({ menuId, items, x, y }: { menuId: number; items: MenuEntry[]; x: number; y: number }) {
  const done = useRef(false)

  const finish = (itemId: string | null) => {
    if (done.current) return
    done.current = true
    useStore.getState().setOverlay(null)
    void ui().invoke('menu:pick', menuId, itemId)
  }

  useEffect(() => {
    const onBlur = () => finish(null)
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [])

  return (
    <div
      className="menu-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && finish(null)}
      onContextMenu={(e) => {
        e.preventDefault()
        if (e.target === e.currentTarget) finish(null)
      }}
    >
      <MenuList items={items} x={x} y={y} onPick={finish} root />
    </div>
  )
}

function MenuList({
  items,
  x,
  y,
  flipFrom,
  onPick,
  onBack,
  root
}: {
  items: MenuEntry[]
  x: number
  y: number
  flipFrom?: number
  onPick: (id: string | null) => void
  onBack?: () => void
  root?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [active, setActive] = useState(-1)
  const [openSub, setOpenSub] = useState<{ index: number; x: number; y: number; flip: number } | null>(null)
  const hoverTimer = useRef<number | undefined>(undefined)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos(place(x, y, r.width, r.height, flipFrom))
  }, [x, y, flipFrom])

  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
  }, [pos === null])

  const enabled = (i: number) => {
    const it = items[i]
    return !!it && !it.separator && it.enabled !== false
  }

  const step = (dir: 1 | -1) => {
    for (let n = 1; n <= items.length; n++) {
      const i = (active + dir * n + items.length * 2) % items.length
      if (enabled(i)) return setActive(i)
    }
  }

  const openSubmenu = (index: number, row: HTMLElement) => {
    const r = row.getBoundingClientRect()
    setOpenSub({ index, x: r.right - 4, y: r.top - 6, flip: r.left + 4 })
  }

  const activate = (index: number, row?: HTMLElement | null) => {
    const it = items[index]
    if (!it || !enabled(index)) return
    if (it.submenu) {
      if (row) openSubmenu(index, row)
      return
    }
    onPick(it.id ?? null)
  }

  const rowEl = (i: number) => ref.current?.querySelector<HTMLElement>(`[data-row="${i}"]`)

  return (
    <>
      <div
        ref={ref}
        className={cls('menu', root && 'is-root')}
        role="menu"
        tabIndex={-1}
        style={pos ? { left: pos.left, top: pos.top } : { left: x, top: y, visibility: 'hidden' }}
        onKeyDown={(e) => {
          if (openSub) return
          if (e.key === 'ArrowDown') step(1)
          else if (e.key === 'ArrowUp') step(-1)
          else if (e.key === 'Enter' || e.key === ' ') activate(active, rowEl(active))
          else if (e.key === 'ArrowRight' && items[active]?.submenu) activate(active, rowEl(active))
          else if (e.key === 'ArrowLeft' && onBack) onBack()
          else if (e.key === 'Escape') onBack ? onBack() : onPick(null)
          else return
          e.preventDefault()
          e.stopPropagation()
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {items.map((it, i) =>
          it.separator ? (
            <div key={i} className="menu-sep" role="separator" />
          ) : (
            <div
              key={i}
              data-row={i}
              role="menuitem"
              aria-disabled={it.enabled === false}
              aria-haspopup={it.submenu ? 'menu' : undefined}
              className={cls(
                'menu-item',
                i === active && 'is-active',
                it.enabled === false && 'is-disabled',
                it.danger && 'is-danger',
                openSub?.index === i && 'is-open'
              )}
              onMouseEnter={(e) => {
                setActive(i)
                window.clearTimeout(hoverTimer.current)
                const row = e.currentTarget
                hoverTimer.current = window.setTimeout(() => {
                  if (it.submenu && it.enabled !== false) openSubmenu(i, row)
                  else setOpenSub(null)
                }, it.submenu ? 90 : 160)
              }}
              onMouseLeave={() => window.clearTimeout(hoverTimer.current)}
              onClick={(e) => activate(i, e.currentTarget)}
            >
              <span className="menu-icon">
                {it.hue !== undefined ? (
                  <span className="menu-swatch" style={{ ['--swatch-hue' as string]: it.hue }}>
                    {it.glyph}
                  </span>
                ) : it.icon ? (
                  ICONS[it.icon]
                ) : null}
              </span>
              <span className="menu-label">{it.label}</span>
              {it.checked && <Check size={14} className="menu-check" />}
              {it.keys && !it.submenu && <span className="menu-keys">{it.keys}</span>}
              {it.submenu && <ChevronRight size={14} className="menu-chevron" />}
            </div>
          )
        )}
      </div>
      {openSub && items[openSub.index]?.submenu && (
        <MenuList
          key={openSub.index}
          items={items[openSub.index].submenu!}
          x={openSub.x}
          y={openSub.y}
          flipFrom={openSub.flip}
          onPick={onPick}
          onBack={() => {
            setOpenSub(null)
            ref.current?.focus({ preventScroll: true })
          }}
        />
      )}
    </>
  )
}
