import { useEffect, useMemo, useState } from 'react'
import { Search, Trash2, X } from 'lucide-react'
import type { HistoryEntry } from '@shared/types'
import { internal } from '@/lib/api'
import { dayLabel, Page, SiteIcon } from './shared'
import { locale, t } from '@/lib/i18n'

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function HistoryPage() {
  const [query, setQuery] = useState('')
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [confirm, setConfirm] = useState(false)

  const load = (q: string) => void internal().invoke('internal:history', q, 600).then(setEntries)
  useEffect(() => {
    const t = setTimeout(() => load(query), 120)
    return () => clearTimeout(t)
  }, [query])

  const groups = useMemo(() => {
    const map = new Map<string, HistoryEntry[]>()
    for (const e of entries) {
      const key = dayLabel(e.visitedAt)
      map.set(key, [...(map.get(key) ?? []), e])
    }
    return [...map.entries()]
  }, [entries])

  const clearAll = async () => {
    await internal().invoke('internal:history-delete', null)
    setConfirm(false)
    load(query)
  }

  return (
    <Page
      title={t('page.history')}
      actions={
        confirm ? (
          <div className="confirm">
            <span>{t('hist.confirm')}</span>
            <button type="button" className="btn btn-danger" onClick={() => void clearAll()}>
              {t('hist.deleteAll')}
            </button>
            <button type="button" className="btn" onClick={() => setConfirm(false)}>
              {t('common.cancel')}
            </button>
          </div>
        ) : (
          <button type="button" className="btn" disabled={!entries.length} onClick={() => setConfirm(true)}>
            <Trash2 size={14} /> {t('hist.clear')}
          </button>
        )
      }
    >
      <label className="search-field">
        <Search size={16} />
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('hist.search')} spellCheck={false} />
      </label>
      {groups.length === 0 && (
        <p className="empty">
          {query ? t('hist.noMatch') : t('hist.empty')}
        </p>
      )}
      {groups.map(([day, list]) => (
        <section key={day} className="list-group">
          <h2>{day}</h2>
          <ul className="entry-list">
            {list.map((e) => (
              <li key={e.url} className="entry">
                <span className="entry-time">
                  {new Date(e.visitedAt).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}
                </span>
                <a href={e.url} className="entry-link" title={e.url}>
                  <SiteIcon url={e.url} favicon={e.favicon} />
                  <span className="entry-title">{e.title}</span>
                  <span className="entry-host">{hostOf(e.url)}</span>
                </a>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={t('hist.remove')}
                  title={t('hist.remove')}
                  onClick={async () => {
                    await internal().invoke('internal:history-delete', e.url)
                    load(query)
                  }}
                >
                  <X size={15} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Page>
  )
}
