import { useEffect, useState } from 'react'
import { File, FolderOpen } from 'lucide-react'
import type { DownloadInfo } from '@shared/types'
import { insideWarning } from '@/lib/downloads'
import { internal } from '@/lib/api'
import { formatBytes } from '@/components/bits'
import { Page } from './shared'
import { t } from '@/lib/i18n'

function status(d: DownloadInfo): string {
  if (d.status === 'completed') {
    if (d.scan === 'scanning' || d.scan === 'pending') return t('dl.pageScanning')
    if (d.scan === 'clean') return t('dl.pageClean', { size: formatBytes(d.received) })
    if (d.scan === 'infected') return t('dl.pageInfected')
    return formatBytes(d.received)
  }
  if (d.status === 'progressing') {
    if (d.scan === 'awaiting-confirmation') return t('dl.awaiting')
    return d.total ? t('common.of', { a: formatBytes(d.received), b: formatBytes(d.total) }) : formatBytes(d.received)
  }
  if (d.status === 'paused') return d.scan === 'awaiting-confirmation' ? t('dl.awaiting') : t('dl.paused')
  if (d.status === 'cancelled') return t('dl.cancelled')
  return t('dl.failed')
}

export function DownloadsPage() {
  const [list, setList] = useState<DownloadInfo[]>([])
  useEffect(() => {
    void internal().invoke('internal:downloads').then(setList)
    return internal().on('downloads', setList)
  }, [])
  return (
    <Page title={t('page.downloads')}>
      {list.length === 0 && <p className="empty">{t('dl.pageEmpty')}</p>}
      <ul className="entry-list">
        {list.map((d) => (
          <li key={d.id} className="entry">
            <button
              type="button"
              className="entry-link"
              disabled={d.status !== 'completed' || d.scan === 'infected' || d.scan === 'scanning'}
              onClick={() => void internal().invoke('internal:open-download', d.id)}
            >
              <File size={16} />
              <span className="entry-title">{d.filename}</span>
              <span className="entry-host">
                {status(d)}
                {d.inside && d.scan !== 'infected' ? ` · ${insideWarning(d)}` : ''}
              </span>
            </button>
            {d.sha256 && (
              <button
                type="button"
                className="hash-btn"
                title={t('dl.hashHint', { hash: d.sha256 })}
                onClick={(e) => {
                  const btn = e.currentTarget
                  void navigator.clipboard.writeText(d.sha256!).then(() => {
                    btn.dataset.copied = '1'
                    setTimeout(() => delete btn.dataset.copied, 1500)
                  })
                }}
              >
                SHA-256 {d.sha256.slice(0, 8)}…
              </button>
            )}
            {d.status === 'completed' && d.scan !== 'infected' && (
              <button
                type="button"
                className="icon-btn"
                aria-label={t('dl.show')}
                title={t('dl.show')}
                onClick={() => void internal().invoke('internal:show-download', d.id)}
              >
                <FolderOpen size={15} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </Page>
  )
}
