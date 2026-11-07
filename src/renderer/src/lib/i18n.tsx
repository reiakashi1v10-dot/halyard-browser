import { Fragment, type ReactNode } from 'react'
import { t, type I18nKey } from '@shared/i18n'

export { t, locale, setLang, getLang, BRAND, LANGUAGES } from '@shared/i18n'
export type { I18nKey, Lang } from '@shared/i18n'

/** Like t(), but the placeholders are rendered in bold. */
export function rich(key: I18nKey, vars: Record<string, string | number>): ReactNode {
  const text = t(key)
  const parts = text.split(/(\{\w+\})/)
  return parts.map((part, i) => {
    const m = /^\{(\w+)\}$/.exec(part)
    if (m && m[1] in vars) return <strong key={i}>{vars[m[1]]}</strong>
    return <Fragment key={i}>{part}</Fragment>
  })
}
