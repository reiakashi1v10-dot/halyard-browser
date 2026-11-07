import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { BookMarked, Download, History, Settings2, Sparkles, TriangleAlert } from 'lucide-react'
import type { TabInfo } from '@shared/types'
import { locale, t, type I18nKey } from '@/lib/i18n'

export function cls(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export function IconButton({
  label,
  children,
  className,
  active,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} className={cls('icon-btn', active && 'is-active', className)} {...rest}>
      {children}
    </button>
  )
}

const INTERNAL_ICONS: Record<string, ReactNode> = {
  newtab: <Sparkles size={15} strokeWidth={1.8} />,
  settings: <Settings2 size={15} strokeWidth={1.8} />,
  history: <History size={15} strokeWidth={1.8} />,
  bookmarks: <BookMarked size={15} strokeWidth={1.8} />,
  downloads: <Download size={15} strokeWidth={1.8} />,
  error: <TriangleAlert size={15} strokeWidth={1.8} />
}

function hostLetter(url: string): { letter: string; hue: number } {
  let host = url
  try {
    host = new URL(url).hostname.replace(/^www\./, '')
  } catch {
    /* keep raw */
  }
  let hash = 0
  for (const ch of host) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return { letter: (host[0] ?? '?').toUpperCase(), hue: Math.abs(hash) % 360 }
}

export function Favicon({ tab, size = 16 }: { tab: Pick<TabInfo, 'url' | 'favicon' | 'loading'>; size?: number }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (tab.loading) return <span className="spinner" style={{ width: size, height: size }} aria-hidden />
  if (tab.url.startsWith('halyard://')) {
    const page = tab.url.slice(7).split('/')[0]
    return (
      <span className="favicon favicon-internal" style={{ width: size, height: size }} aria-hidden>
        {INTERNAL_ICONS[page] ?? INTERNAL_ICONS.newtab}
      </span>
    )
  }
  if (tab.favicon && failed !== tab.favicon) {
    return (
      <img
        className="favicon"
        src={tab.favicon}
        width={size}
        height={size}
        alt=""
        draggable={false}
        onError={() => setFailed(tab.favicon)}
      />
    )
  }
  const { letter, hue } = hostLetter(tab.url)
  return (
    <span className="favicon favicon-letter" style={{ width: size, height: size, ['--letter-hue' as string]: hue }} aria-hidden>
      {letter}
    </span>
  )
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** i
  return `${value.toLocaleString(locale(), { maximumFractionDigits: value < 10 && i > 0 ? 1 : 0 })} ${units[i]}`
}

export function prettyUrl(url: string): { host: string; rest: string } {
  if (url.startsWith('halyard://')) {
    const page = url.slice(7).split('/')[0]
    const known = ['newtab', 'settings', 'history', 'bookmarks', 'downloads', 'about', 'error', 'blocked']
    return { host: known.includes(page) ? t(`page.${page}` as I18nKey) : 'Halyard', rest: '' }
  }
  try {
    const u = new URL(url)
    if (u.protocol === 'file:') return { host: decodeURIComponent(u.pathname.split('/').pop() || t('common.file')), rest: '' }
    const rest = `${u.pathname === '/' ? '' : decodeURI(u.pathname)}${u.search}`
    return { host: u.hostname.replace(/^www\./, ''), rest }
  } catch {
    return { host: url, rest: '' }
  }
}
