import type { Lang } from '@shared/i18n'

/*
 * Page translation through Google Translate's public website proxy (no API key).
 * Only the address of the page the user chose to translate is sent to Google; the
 * translated copy is served from <host>.translate.goog and can be undone at any time.
 */

const PROXY_SUFFIX = '.translate.goog'

/** Languages offered in the translate menu, in Google's codes. */
export const TRANSLATE_TARGETS = ['pt', 'en', 'es', 'fr', 'de', 'it', 'ja', 'ko', 'zh-CN', 'ru', 'ar', 'hi'] as const

export function googleLang(lang: Lang): string {
  return lang === 'pt-BR' ? 'pt' : lang
}

const base = (code: string): string => code.trim().toLowerCase().split(/[-_]/)[0]

/** Can this address be translated (an ordinary web page)? */
export function translatable(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
    return !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) && !u.hostname.endsWith('.localhost')
  } catch {
    return false
  }
}

export function isTranslated(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(PROXY_SUFFIX)
  } catch {
    return false
  }
}

/** The page is in another language than the app (by its declared <html lang>). */
export function looksForeign(pageLang: string | null, appLang: Lang): boolean {
  if (!pageLang || !/^[a-z]{2,3}([-_][a-z0-9]{2,8})*$/i.test(pageLang.trim())) return false
  return base(pageLang) !== base(googleLang(appLang))
}

export function translateUrl(url: string, target: string): string {
  const original = originalUrl(url) ?? url
  const tl = encodeURIComponent(target)
  return `https://translate.google.com/translate?sl=auto&tl=${tl}&hl=${tl}&u=${encodeURIComponent(original)}`
}

/** Address of the original page behind a translated one, or null if it is not translated. */
export function originalUrl(url: string): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.hostname === 'translate.google.com' && u.pathname === '/translate') {
    const inner = u.searchParams.get('u')
    return inner && translatable(inner) ? inner : null
  }
  if (!u.hostname.endsWith(PROXY_SUFFIX)) return null
  // example-com.translate.goog -> example.com ; my--site-com -> my-site.com
  const encoded = u.hostname.slice(0, -PROXY_SUFFIX.length)
  const host = encoded.replace(/--/g, '\u0000').replace(/-/g, '.').replace(/\u0000/g, '-')
  const params = new URLSearchParams(u.search)
  for (const key of [...params.keys()]) if (key.startsWith('_x_tr_')) params.delete(key)
  const query = params.toString()
  const original = `https://${host}${u.pathname}${query ? `?${query}` : ''}${u.hash}`
  return translatable(original) ? original : null
}

/** Language a translated page is shown in (`_x_tr_tl`), if any. */
export function translatedTo(url: string): string | null {
  try {
    const u = new URL(url)
    return u.hostname.endsWith(PROXY_SUFFIX) ? u.searchParams.get('_x_tr_tl') : null
  } catch {
    return null
  }
}
