import { useState, type ReactNode } from 'react'
import { locale, t } from '@/lib/i18n'

export function SiteIcon({ url, favicon, size = 16 }: { url: string; favicon: string | null; size?: number }) {
  const [failed, setFailed] = useState(false)
  if (favicon && !failed) {
    return <img className="site-icon" src={favicon} width={size} height={size} alt="" onError={() => setFailed(true)} />
  }
  let host = url
  try {
    host = new URL(url).hostname.replace(/^www\./, '')
  } catch {
    /* keep */
  }
  let hash = 0
  for (const ch of host) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return (
    <span
      className="site-icon site-letter"
      style={{ width: size, height: size, fontSize: size * 0.55, ['--letter-hue' as string]: Math.abs(hash) % 360 }}
    >
      {(host[0] ?? '?').toUpperCase()}
    </span>
  )
}

export function Page({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <main className="page">
      <header className="page-head">
        <h1>{title}</h1>
        {actions}
      </header>
      {children}
    </main>
  )
}

export function dayLabel(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((start(today) - start(d)) / 86_400_000)
  if (diff === 0) return t('day.today')
  if (diff === 1) return t('day.yesterday')
  const label = d.toLocaleDateString(locale(), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric'
  })
  return label.charAt(0).toUpperCase() + label.slice(1)
}
