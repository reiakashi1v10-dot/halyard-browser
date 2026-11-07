import type { DownloadInfo } from '@shared/types'
import { t } from './i18n'

/** Warning for a .zip that holds programs or scripts, or is locked with a password. */
export function insideWarning(d: DownloadInfo): string {
  const inside = d.inside
  if (!inside) return ''
  const parts: string[] = []
  if (inside.riskyCount) parts.push(t('dl.zipRisky', { n: inside.riskyCount, names: inside.risky.map((n) => n.split('/').pop()).join(', ') }))
  if (inside.encrypted) parts.push(t('dl.zipLocked'))
  return parts.join(' ')
}
