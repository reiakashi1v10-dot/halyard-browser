import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { SEARCH_ENGINES, type HistoryEntry, type Settings } from '@shared/types'
import { internal } from '@/lib/api'
import { SiteIcon } from './shared'
import { locale, rich, t } from '@/lib/i18n'

function greeting(date: Date): string {
  const h = date.getHours()
  if (h < 5) return t('nt.lateNight')
  if (h < 12) return t('nt.morning')
  if (h < 18) return t('nt.afternoon')
  return t('nt.evening')
}

export function NewTab({ settings }: { settings: Settings }) {
  const [now, setNow] = useState(() => new Date())
  const [sites, setSites] = useState<HistoryEntry[]>([])
  const [stats, setStats] = useState<{ blocked: number; sleepingTabs: number; openTabs: number; threatsBlocked: number } | null>(null)
  const [query, setQuery] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    void internal().invoke('internal:top-sites').then(setSites)
    void internal().invoke('internal:stats').then(setStats)
    input.current?.focus()
    return () => clearInterval(t)
  }, [])

  const go = async (text: string) => {
    if (!text.trim()) return
    location.href = await internal().invoke('internal:resolve', text)
  }

  const time = now.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
  const date = now.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' })
  const name = settings.userName.trim()

  return (
    <main className="newtab">
      <section className="nt-hero">
        <p className="nt-greeting">
          {greeting(now)}
          {name ? `, ${name}` : ''}
        </p>
        <h1 className="nt-clock" aria-label={`${time}, ${date}`}>
          {time}
        </h1>
        <p className="nt-date">{date}</p>
      </section>

      <form
        className="nt-search"
        onSubmit={(e) => {
          e.preventDefault()
          void go(query)
        }}
      >
        <Search size={18} />
        <input
          ref={input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('nt.searchPh', { engine: SEARCH_ENGINES[settings.searchEngine].name })}
          aria-label={t('nt.searchLabel')}
          spellCheck={false}
        />
        <kbd>Ctrl K</kbd>
      </form>

      {sites.length > 0 && (
        <nav className="nt-sites" aria-label={t('nt.sites')}>
          {sites.map((s) => (
            <a key={s.url} className="nt-site" href={s.url} title={s.title}>
              <SiteIcon url={s.url} favicon={s.favicon} size={22} />
              <span>{new URL(s.url).hostname.replace(/^www\./, '')}</span>
            </a>
          ))}
        </nav>
      )}

      {stats && stats.blocked > 0 && (
        <p className="nt-stat">
          {rich('nt.blocked', { n: stats.blocked.toLocaleString(locale()) })}
          {stats.threatsBlocked > 0 && rich(stats.threatsBlocked === 1 ? 'nt.threatsOne' : 'nt.threatsMany', { n: stats.threatsBlocked })}
          {stats.sleepingTabs > 0 && rich(stats.sleepingTabs === 1 ? 'nt.sleepOne' : 'nt.sleepMany', { n: stats.sleepingTabs })}
          .
        </p>
      )}
    </main>
  )
}
