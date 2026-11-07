import { upgradeToHttps } from './privacy'
import { INTERNAL_SCHEME, SEARCH_ENGINES, type SearchEngineId, type SecurityState } from '@shared/types'

const INTERNAL_PAGES = new Set(['newtab', 'settings', 'history', 'bookmarks', 'downloads', 'error', 'about', 'legal'])

/** Turn whatever the user typed into a URL: a link, a host, an internal page or a search. */
export function resolveInput(raw: string, engine: SearchEngineId, httpsOnly = false): string {
  const input = raw.trim()
  if (!input) return 'halyard://newtab/'

  if (/^halyard:\/\//i.test(input)) {
    const page = input.slice(7).replace(/\/.*$/, '').toLowerCase()
    return INTERNAL_PAGES.has(page) ? `halyard://${page}/` : 'halyard://newtab/'
  }
  if (/^(about|chrome):/i.test(input)) {
    const page = input.split(':')[1]?.replace(/^\/+/, '').toLowerCase() ?? ''
    if (page === 'blank') return 'about:blank'
    if (INTERNAL_PAGES.has(page)) return `halyard://${page}/`
  }

  const hasSpace = /\s/.test(input)
  if (!hasSpace) {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
      try {
        const url = new URL(input)
        // remembered by upgradeToHttps, so a site with no HTTPS version can still be offered
        if (httpsOnly && url.protocol === 'http:') return upgradeToHttps(url.href) ?? url.href
        if (['http:', 'https:', 'file:', 'view-source:'].includes(url.protocol)) return url.href
      } catch {
        /* fall through to search */
      }
    }
    if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/.*)?$/i.test(input)) return `http://${input}`
    if (/^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/.*)?$/.test(input)) return `http://${input}`
    // looks like a domain: something.tld with a known-shaped TLD
    if (/^([a-z0-9-]+\.)+[a-z]{2,24}(:\d+)?([/?#].*)?$/i.test(input)) {
      return `https://${input}`
    }
  }
  return SEARCH_ENGINES[engine].search.replace('%s', encodeURIComponent(input))
}

export function securityOf(url: string): SecurityState {
  if (url.startsWith(`${INTERNAL_SCHEME}:`) || url.startsWith('about:')) return 'internal'
  if (url.startsWith('https:')) return 'secure'
  if (url.startsWith('file:')) return 'local'
  if (/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(url)) return 'local'
  return 'insecure'
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}

export function isInternalUrl(url: string): boolean {
  return url.startsWith(`${INTERNAL_SCHEME}://`)
}

/** Only these protocols may be opened inside a tab. Everything else is dropped. */
export function isNavigable(url: string): boolean {
  return /^(https?|file|halyard|about|view-source|data|blob):/i.test(url)
}
