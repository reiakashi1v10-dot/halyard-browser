import { LockOpen, RotateCw } from 'lucide-react'
import { internal } from '@/lib/api'
import { t, type I18nKey } from '@/lib/i18n'

function kindOf(code: number): string {
  if (code === -106) return 'offline'
  if (code === -105 || code === -137) return 'dns'
  if (code === -102) return 'refused'
  if (code === -118 || code === -7) return 'timeout'
  if (code === -109) return 'unreachable'
  if (code <= -200 && code > -300) return 'cert'
  if (code === -21) return 'network'
  return 'generic'
}

function describe(code: number): { title: string; body: string } {
  const k = kindOf(code)
  return { title: t(`err.${k}` as I18nKey), body: t(`err.${k}Body` as I18nKey) }
}

export function ErrorPage() {
  const params = new URLSearchParams(location.search)
  const code = Number(params.get('code') ?? 0)
  const url = params.get('url') ?? ''
  const httpsOnly = params.get('https') === '1'
  const { title, body } = httpsOnly ? { title: t('err.httpsOnly'), body: t('err.httpsOnlyBody') } : describe(code)
  let host = url
  try {
    host = new URL(url).hostname
  } catch {
    /* keep raw */
  }
  return (
    <main className="error-page">
      <h1>{title}</h1>
      <p>{body}</p>
      <p className="error-detail">
        <span>{host}</span>
        <code>{params.get('desc') ?? ''}</code>
      </p>
      <div className="error-actions">
        <button type="button" className="btn btn-primary" onClick={() => url && location.replace(url)}>
          <RotateCw size={14} /> {t('err.retry')}
        </button>
        {httpsOnly && (
          <button
            type="button"
            className="btn"
            onClick={() => void internal().invoke('internal:allow-http', url).then(() => location.replace(url))}
          >
            <LockOpen size={14} /> {t('err.httpsContinue')}
          </button>
        )}
      </div>
      {httpsOnly && <p className="error-note">{t('err.httpsNote')}</p>}
    </main>
  )
}
