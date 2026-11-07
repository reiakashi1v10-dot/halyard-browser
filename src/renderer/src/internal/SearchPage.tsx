import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { Search, ShieldCheck, X } from 'lucide-react'
import { SEARCH_ENGINES, type SearchEngineId, type SearchPage as Page, type SearchResult } from '@shared/types'
import { internal } from '@/lib/api'
import { SiteIcon } from './shared'
import { rich, t } from '@/lib/i18n'

const ELSEWHERE: SearchEngineId[] = ['google', 'bing', 'brave', 'duckduckgo']

function SailMark() {
  return (
    <svg className="sr-mark" width="30" height="30" viewBox="0 0 100 100" aria-hidden>
      <rect x="4" y="4" width="92" height="92" rx="24" fill="currentColor" />
      <path d="M46 20 C 64 34, 76 52, 77 70 L 46 70 Z" fill="var(--accent-ink)" />
      <path d="M42 29 L 42 70 L 21 70 Z" fill="var(--accent-ink)" opacity="0.82" />
      <rect x="28" y="75" width="47" height="5" rx="2.5" fill="var(--accent-ink)" />
    </svg>
  )
}

/** Bold the words of the query inside a snippet. */
function highlight(text: string, query: string): ReactNode {
  const words = query
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (!words.length) return text
  const re = new RegExp(`(${words.join('|')})`, 'gi')
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : <Fragment key={i}>{part}</Fragment>))
}

function where(url: string): { host: string; path: string } {
  try {
    const u = new URL(url)
    let path = ''
    try {
      path = decodeURI(u.pathname)
    } catch {
      path = u.pathname
    }
    const parts = path.split('/').filter(Boolean).slice(0, 3)
    return { host: u.hostname.replace(/^www\./, ''), path: parts.length ? ` › ${parts.join(' › ')}` : '' }
  } catch {
    return { host: url, path: '' }
  }
}

function Result({ r, query }: { r: SearchResult; query: string }) {
  const { host, path } = where(r.url)
  return (
    <article className="sr-item">
      <a className="sr-link" href={r.url}>
        <span className="sr-site">
          <SiteIcon url={r.url} favicon={r.icon} size={18} />
          <span className="sr-where">
            <span className="sr-host">{host}</span>
            <span className="sr-path">{path}</span>
          </span>
        </span>
        <h2 className="sr-title">{r.title}</h2>
      </a>
      {r.snippet && <p className="sr-snippet">{highlight(r.snippet, query)}</p>}
    </article>
  )
}

export function SearchPage() {
  const query = new URLSearchParams(location.search).get('q')?.trim() ?? ''
  const [text, setText] = useState(query)
  const [page, setPage] = useState<Page | null>(null)
  const [results, setResults] = useState<SearchResult[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'more'>(query ? 'loading' : 'ready')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    document.title = query ? `${query} — Halyard` : t('page.search')
  }, [query])

  const load = (next: string | null) => {
    setState(next ? 'more' : 'loading')
    internal()
      .invoke('internal:search', query, next)
      .then((p) => {
        setPage((prev) => (next && prev ? { ...p, answer: prev.answer } : p))
        setResults((prev) => {
          if (!next) return p.results
          const seen = new Set(prev.map((r) => r.url))
          return [...prev, ...p.results.filter((r) => !seen.has(r.url))]
        })
        setState('ready')
      })
      .catch((err: unknown) => {
        // the provider asked for a captcha (too many searches in a row): show its own page instead
        if (!next && err instanceof Error && err.message.includes('blocked')) {
          location.replace(SEARCH_ENGINES.duckduckgo.search.replace('%s', encodeURIComponent(query)))
          return
        }
        setState(next ? 'ready' : 'error')
      })
  }

  useEffect(() => {
    if (query) load(null)
    else input.current?.focus()
    // "/" jumps to the search box, like on most search sites
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.altKey || e.metaKey) return
      const el = document.activeElement
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return
      e.preventDefault()
      input.current?.focus()
      input.current?.select()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const go = async (value: string) => {
    if (!value.trim() || value.trim() === query) return
    location.href = await internal().invoke('internal:resolve', value)
  }

  const answer = page?.answer ?? null

  return (
    <main className="sr">
      <header className="sr-head">
        <a className="sr-brand" href="halyard://newtab/" aria-label="Halyard">
          <SailMark />
          <span>Halyard</span>
        </a>
        <form
          className="sr-box"
          role="search"
          onSubmit={(e) => {
            e.preventDefault()
            void go(text)
          }}
        >
          <Search size={18} />
          <input
            ref={input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('sr.placeholder')}
            aria-label={t('sr.placeholder')}
            spellCheck={false}
            autoComplete="off"
          />
          {text && (
            <button
              type="button"
              className="sr-clear"
              aria-label={t('sr.clear')}
              onClick={() => {
                setText('')
                input.current?.focus()
              }}
            >
              <X size={16} />
            </button>
          )}
        </form>
      </header>

      <p className="sr-private">
        <ShieldCheck size={14} />
        {t('sr.private')}
      </p>

      {!query ? (
        <p className="sr-empty">{t('sr.empty')}</p>
      ) : (
        <div className={answer ? 'sr-body has-answer' : 'sr-body'}>
          <section className="sr-results" aria-busy={state === 'loading'}>
            {state === 'loading' &&
              Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="sr-skel" aria-hidden>
                  <span />
                  <span />
                  <span />
                </div>
              ))}

            {state === 'error' && (
              <div className="sr-note">
                <p>{t('sr.error')}</p>
                <button type="button" className="btn" onClick={() => load(null)}>
                  {t('sr.retry')}
                </button>
              </div>
            )}

            {state !== 'loading' && state !== 'error' && results.length === 0 && (
              <div className="sr-note">
                <p>{t('sr.none', { q: query })}</p>
                <p className="sr-faint">{t('sr.noneHint')}</p>
              </div>
            )}

            {state !== 'loading' && results.map((r) => <Result key={r.url} r={r} query={query} />)}

            {state !== 'loading' && page?.next && (
              <button type="button" className="sr-more" disabled={state === 'more'} onClick={() => load(page.next)}>
                {state === 'more' ? '…' : t('sr.more')}
              </button>
            )}

            {state !== 'loading' && (
              <footer className="sr-foot">
                <p>
                  {t('sr.elsewhere')}{' '}
                  {ELSEWHERE.map((id, i) => (
                    <Fragment key={id}>
                      {i > 0 && ' · '}
                      <a href={SEARCH_ENGINES[id].search.replace('%s', encodeURIComponent(query))}>{SEARCH_ENGINES[id].name}</a>
                    </Fragment>
                  ))}
                </p>
                <p className="sr-faint">{t('sr.via')}</p>
              </footer>
            )}
          </section>

          {answer && state !== 'loading' && (
            <aside className="sr-answer">
              {answer.image && <img src={answer.image} alt="" className="sr-answer-img" onError={(e) => (e.currentTarget.style.display = 'none')} />}
              <h2>{answer.heading}</h2>
              <p>{answer.text}</p>
              <a href={answer.url} className="sr-answer-src">
                {rich('sr.source', { source: answer.source })}
              </a>
            </aside>
          )}
        </div>
      )}
    </main>
  )
}
