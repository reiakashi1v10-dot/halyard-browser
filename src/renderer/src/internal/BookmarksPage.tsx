import { useEffect, useState } from 'react'
import { Pencil, Search, Trash2 } from 'lucide-react'
import type { Bookmark } from '@shared/types'
import { internal } from '@/lib/api'
import { Page, SiteIcon } from './shared'
import { hostOf } from './HistoryPage'
import { t } from '@/lib/i18n'

export function BookmarksPage() {
  const [list, setList] = useState<Bookmark[]>([])
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const load = () => void internal().invoke('internal:bookmarks').then(setList)
  useEffect(load, [])

  const q = query.trim().toLowerCase()
  const shown = q ? list.filter((b) => b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q)) : list

  return (
    <Page title={t('page.bookmarks')}>
      <label className="search-field">
        <Search size={16} />
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('bm.search')} spellCheck={false} />
      </label>
      {shown.length === 0 && (
        <p className="empty">
          {q ? t('bm.noMatch') : t('bm.empty')}
        </p>
      )}
      <ul className="entry-list">
        {shown.map((b) => (
          <li key={b.id} className="entry">
            {editing === b.id ? (
              <form
                className="entry-edit"
                onSubmit={async (e) => {
                  e.preventDefault()
                  const title = new FormData(e.currentTarget).get('title')
                  await internal().invoke('internal:bookmark-rename', b.id, String(title ?? ''))
                  setEditing(null)
                  load()
                }}
              >
                <SiteIcon url={b.url} favicon={b.favicon} />
                <input name="title" autoFocus defaultValue={b.title} className="input" onBlur={(e) => e.currentTarget.form?.requestSubmit()} />
              </form>
            ) : (
              <a href={b.url} className="entry-link" title={b.url}>
                <SiteIcon url={b.url} favicon={b.favicon} />
                <span className="entry-title">{b.title}</span>
                <span className="entry-host">{hostOf(b.url)}</span>
              </a>
            )}
            <button type="button" className="icon-btn" aria-label={t('bm.rename')} title={t('bm.rename')} onClick={() => setEditing(b.id)}>
              <Pencil size={14} />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label={t('bm.remove')}
              title={t('bm.remove')}
              onClick={async () => {
                await internal().invoke('internal:bookmark-remove', b.id)
                load()
              }}
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>
    </Page>
  )
}
