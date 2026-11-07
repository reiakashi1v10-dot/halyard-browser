import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/onest'
import '@fontsource-variable/bricolage-grotesque'
import '../styles/internal.css'
import type { Settings } from '@shared/types'
import { internal } from '@/lib/api'
import { resolveTheme } from '@/lib/color'
import { NewTab } from './NewTab'
import { SettingsPage } from './SettingsPage'
import { HistoryPage } from './HistoryPage'
import { BookmarksPage } from './BookmarksPage'
import { DownloadsPage } from './DownloadsPage'
import { ErrorPage } from './ErrorPage'
import { BlockedPage } from './BlockedPage'
import { LegalPage } from './LegalPage'
import { setLang, t, type I18nKey } from '@/lib/i18n'

const PAGES = ['newtab', 'settings', 'history', 'bookmarks', 'downloads', 'error', 'blocked', 'about', 'legal']

function Root() {
  const page = location.hostname
  const [settings, setSettings] = useState<Settings | null>(null)

  setLang(settings?.language)

  useEffect(() => {
    document.title = PAGES.includes(page) ? t(`page.${page}` as I18nKey) : 'Halyard'
    document.documentElement.lang = settings?.language ?? 'en'
  }, [page, settings?.language])

  useEffect(() => {
    void internal().invoke('internal:settings').then(setSettings)
    void internal()
      .invoke('internal:theme')
      .then(({ hue }) => document.documentElement.style.setProperty('--hue', String(hue)))
    return internal().on('settings', setSettings)
  }, [page])

  useEffect(() => {
    if (!settings) return
    const apply = () => (document.documentElement.dataset.theme = resolveTheme(settings.theme))
    apply()
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [settings?.theme])

  if (!settings) return null
  switch (page) {
    case 'newtab':
      return <NewTab settings={settings} />
    case 'settings':
    case 'about':
      return <SettingsPage settings={settings} />
    case 'history':
      return <HistoryPage />
    case 'bookmarks':
      return <BookmarksPage />
    case 'downloads':
      return <DownloadsPage />
    case 'error':
      return <ErrorPage />
    case 'blocked':
      return <BlockedPage />
    case 'legal':
      return <LegalPage />
    default:
      return <NewTab settings={settings} />
  }
}

if (window.halyardInternal) {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Root />
    </StrictMode>
  )
}
