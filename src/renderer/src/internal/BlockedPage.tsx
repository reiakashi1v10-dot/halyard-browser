import { useState } from 'react'
import { ArrowLeft, ShieldAlert } from 'lucide-react'
import type { ThreatKind } from '@shared/types'
import { internal } from '@/lib/api'
import { t, type I18nKey } from '@/lib/i18n'

const KINDS: ThreatKind[] = ['malware', 'phishing', 'typo', 'homograph']

export function BlockedPage() {
  const params = new URLSearchParams(location.search)
  const raw = params.get('kind') as ThreatKind
  const kind: ThreatKind = KINDS.includes(raw) ? raw : 'malware'
  const url = params.get('url') ?? ''
  const host = params.get('host') ?? ''
  const suggest = params.get('suggest')
  const [details, setDetails] = useState(false)
  const [remember, setRemember] = useState(false)
  const copy = { title: t(`block.${kind}.title` as I18nKey), body: t(`block.${kind}.body` as I18nKey) }
  const lookalike = kind === 'typo' || kind === 'homograph'
  let suggestHost = ''
  try {
    suggestHost = suggest ? new URL(suggest).hostname : ''
  } catch {
    /* ignore */
  }

  const goBack = () => {
    if (history.length > 1) history.back()
    else location.replace('halyard://newtab/')
  }

  const proceed = async () => {
    await internal().invoke('internal:guard-proceed', url, remember)
    location.replace(url)
  }

  return (
    <main className={`blocked-page is-${lookalike ? 'warn' : 'danger'}`}>
      <ShieldAlert className="blocked-icon" size={44} strokeWidth={1.6} />
      <h1>{copy.title}</h1>
      <p className="blocked-host">{host}</p>
      <p>{copy.body}</p>

      <div className="blocked-actions">
        {suggest ? (
          <button type="button" className="btn btn-primary" onClick={() => location.replace(suggest)}>
            {t('block.goTo', { host: suggestHost })}
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={goBack}>
            <ArrowLeft size={14} /> {t('block.safety')}
          </button>
        )}
        {suggest && (
          <button type="button" className="btn" onClick={goBack}>
            {t('common.back')}
          </button>
        )}
      </div>

      <button type="button" className="link-btn blocked-more" onClick={() => setDetails(!details)} aria-expanded={details}>
        {details ? t('block.hide') : t('block.details')}
      </button>
      {details && (
        <div className="blocked-details">
          <p>
            {lookalike ? t('block.lookalikeNote') : t('block.dangerNote')}
          </p>
          {lookalike && (
            <label className="check">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              {t('block.remember', { host })}
            </label>
          )}
          <button type="button" className="btn btn-danger" onClick={() => void proceed()}>
            {t('block.proceed', { host })}
          </button>
        </div>
      )}
    </main>
  )
}
