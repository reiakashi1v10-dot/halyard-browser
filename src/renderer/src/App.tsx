import { useEffect } from 'react'
import { Content, FindBar, NoticeBar, PromptBar } from './components/Content'
import { Palette } from './components/Palette'
import { DownloadsPanel, PerfPanel, ShieldPanel, SpaceEditor } from './components/Panels'
import { Sidebar } from './components/Sidebar'
import { Toolbar } from './components/Toolbar'
import { ContextMenu } from './components/Menu'
import { DownloadConfirm } from './components/DownloadConfirm'
import { Welcome } from './components/Welcome'
import { AgentPanel } from './components/AgentPanel'
import { PageQr, QrCheck } from './components/QrCheck'
import { setLang } from './lib/i18n'
import { cls } from './components/bits'
import { ui } from './lib/api'
import { cssColorToHex, resolveTheme } from './lib/color'
import { bindBridge, freezeViews, thawViews, useStore } from './lib/store'

export function App() {
  const state = useStore((s) => s.state)
  const settings = useStore((s) => s.settings)
  const overlay = useStore((s) => s.overlay)
  const confirms = useStore((s) => s.confirms)
  const agentOpen = useStore((s) => s.agentOpen)

  // every component reads the language through t() while rendering below
  setLang(settings?.language)
  useEffect(() => {
    document.documentElement.lang = settings?.language ?? 'en'
  }, [settings?.language])

  useEffect(() => bindBridge(), [])

  // theme + space tint
  const space = state?.spaces.find((s) => s.id === state.activeSpaceId)
  const hue = space?.hue ?? 262
  const themeSetting = settings?.theme ?? 'system'
  useEffect(() => {
    const root = document.documentElement
    const apply = () => {
      root.dataset.theme = resolveTheme(themeSetting)
      // Windows caption buttons are drawn by the OS: hand them the final colours
      // once the hue transition has settled.
      setTimeout(() => {
        const css = getComputedStyle(root)
        void ui().invoke('ui:chrome-colors', cssColorToHex(css.getPropertyValue('--chrome-solid')), cssColorToHex(css.getPropertyValue('--ink')))
      }, 700)
    }
    root.style.setProperty('--hue', String(hue))
    apply()
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [hue, themeSetting])

  useEffect(() => {
    if (settings) document.documentElement.style.setProperty('--sidebar-w', `${settings.sidebarWidth}px`)
  }, [settings?.sidebarWidth])

  // Native page views sit above the UI; freeze them while anything overlaps.
  const welcome = !!settings && !settings.onboarded && !state?.isPrivate
  const hasOverlay = overlay !== null || confirms.length > 0 || welcome
  useEffect(() => {
    if (hasOverlay) void freezeViews()
    else void thawViews()
  }, [hasOverlay])

  if (!state) return <div className="shell is-booting" />

  const editing = overlay?.kind === 'space' ? state.spaces.find((s) => s.id === overlay.id) : undefined

  return (
    <div
      className={cls('shell', state.sidebarCollapsed && 'is-collapsed', state.isPrivate && 'is-private', overlay?.kind === 'drag' && 'is-dragging')}
    >
      <Sidebar state={state} />
      <main className="main">
        <Toolbar state={state} />
        <FindBar state={state} />
        <PromptBar prompts={state.prompts} isPrivate={state.isPrivate} />
        <NoticeBar />
        <div className="content-row">
          <Content state={state} />
          {agentOpen && <AgentPanel />}
        </div>
      </main>
      {overlay?.kind === 'palette' && <Palette key={`${overlay.mode}:${overlay.query}`} mode={overlay.mode} initial={overlay.query} />}
      {overlay?.kind === 'shield' && <ShieldPanel />}
      {overlay?.kind === 'downloads' && <DownloadsPanel />}
      {overlay?.kind === 'perf' && <PerfPanel />}
      {editing && <SpaceEditor space={editing} count={state.spaces.length} />}
      {overlay?.kind === 'menu' && <ContextMenu key={overlay.menuId} menuId={overlay.menuId} items={overlay.items} x={overlay.x} y={overlay.y} />}
      {overlay?.kind === 'qr' && <QrCheck key={overlay.seq} image={overlay.image} text={overlay.text} source={overlay.source} />}
      {overlay?.kind === 'page-qr' && <PageQr url={overlay.url} title={overlay.title} />}
      {confirms[0] && <DownloadConfirm key={confirms[0].id} request={confirms[0]} queued={confirms.length - 1} />}
      {welcome && settings && <Welcome settings={settings} />}
      {!welcome && overlay?.kind === 'account' && settings && <Welcome settings={settings} accountOnly />}
    </div>
  )
}
