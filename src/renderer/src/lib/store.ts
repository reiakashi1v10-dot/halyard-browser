import { create } from 'zustand'
import type { AccountState, AgentState, DownloadInfo, DownloadRequest, FrozenFrame, MenuEntry, Settings, TabInfo, WindowState } from '@shared/types'
import { ui } from './api'

export type Overlay =
  | { kind: 'palette'; mode: 'current' | 'new'; query: string }
  | { kind: 'shield' }
  | { kind: 'downloads' }
  | { kind: 'perf' }
  | { kind: 'space'; id: string }
  | { kind: 'drag' }
  | { kind: 'menu'; menuId: number; items: MenuEntry[]; x: number; y: number }
  | { kind: 'account' }
  | { kind: 'qr'; image?: string; text?: string; source: 'image' | 'page' | 'link' | 'none'; seq: number }
  | { kind: 'page-qr'; url: string; title: string }

interface Store {
  state: WindowState | null
  settings: Settings | null
  downloads: DownloadInfo[]
  account: AccountState | null
  agent: AgentState | null
  /** The AI assistant panel is docked beside the page. */
  agentOpen: boolean
  overlay: Overlay | null
  frames: FrozenFrame[]
  toast: { id: number; message: string } | null
  /** Warning shown above the page until closed (leaked password, runaway tab...). */
  notice: { id: number; message: string } | null
  findFocus: number
  /** Bumped to move keyboard focus to the assistant's input. */
  agentFocus: number
  /** Downloads waiting for the user's yes or no, oldest first. */
  confirms: DownloadRequest[]
  setOverlay(overlay: Overlay | null): void
  showToast(message: string): void
}

export const useStore = create<Store>((set) => ({
  state: null,
  settings: null,
  downloads: [],
  account: null,
  agent: null,
  agentOpen: false,
  overlay: null,
  frames: [],
  toast: null,
  notice: null,
  findFocus: 0,
  agentFocus: 0,
  confirms: [],
  setOverlay: (overlay) => set({ overlay }),
  showToast: (message) => set({ toast: { id: Date.now(), message } })
}))

export function activeTab(state: WindowState | null): TabInfo | null {
  if (!state || state.activeTabId == null) return null
  return state.tabs.find((t) => t.id === state.activeTabId) ?? null
}

/** Pinned tabs show in every space; the rest only in their own. */
export function visibleTabs(state: WindowState): { pinned: TabInfo[]; regular: TabInfo[] } {
  return {
    pinned: state.tabs.filter((t) => t.pinned),
    regular: state.tabs.filter((t) => !t.pinned && t.spaceId === state.activeSpaceId)
  }
}

// ---------------------------------------------------------------- freezing
// Web pages are native views drawn above the UI. To show anything over them
// (palette, popovers, drags) the UI swaps them for a still image while it is open.

let freezeSeq = 0
let frozen = false

export async function freezeViews(): Promise<void> {
  const seq = ++freezeSeq
  const frames = await ui().invoke('ui:freeze')
  if (seq !== freezeSeq) return
  useStore.setState({ frames })
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  if (seq !== freezeSeq) return
  frozen = true
  await ui().invoke('ui:hide-views', true)
}

export async function thawViews(): Promise<void> {
  ++freezeSeq
  if (frozen) {
    frozen = false
    await ui().invoke('ui:hide-views', false)
  }
  // keep the still image for a frame so the swap back is seamless
  setTimeout(() => {
    if (!frozen) useStore.setState({ frames: [] })
  }, 60)
}

export function bindBridge(): () => void {
  const api = ui()
  const offs = [
    api.on('state', (state) => useStore.setState({ state })),
    api.on('settings', (settings) => useStore.setState({ settings })),
    api.on('downloads', (downloads) => useStore.setState({ downloads })),
    api.on('account', (account) => useStore.setState({ account })),
    api.on('agent', (agent) => useStore.setState({ agent })),
    api.on('toast', ({ message, warn }) =>
      warn ? useStore.setState({ notice: { id: Date.now(), message } }) : useStore.getState().showToast(message)
    ),
    api.on('ui-action', (a) => {
      const store = useStore.getState()
      switch (a.action) {
        case 'palette':
          store.setOverlay({ kind: 'palette', mode: a.mode, query: a.query ?? '' })
          break
        case 'find':
          useStore.setState((s) => ({ findFocus: s.findFocus + 1, overlay: null }))
          break
        case 'downloads':
          if (a.open) {
            // a new download: show it, unless the user is busy with a menu or the palette
            if (!store.overlay || store.overlay.kind === 'downloads' || store.overlay.kind === 'shield' || store.overlay.kind === 'perf')
              store.setOverlay({ kind: 'downloads' })
          } else store.setOverlay(store.overlay?.kind === 'downloads' ? null : { kind: 'downloads' })
          break
        case 'performance':
          store.setOverlay({ kind: 'perf' })
          break
        case 'shield':
          store.setOverlay({ kind: 'shield' })
          break
        case 'edit-space':
          store.setOverlay({ kind: 'space', id: a.id })
          break
        case 'menu':
          store.setOverlay({ kind: 'menu', menuId: a.menuId, items: a.items, x: a.x, y: a.y })
          break
        case 'account':
          store.setOverlay({ kind: 'account' })
          break
        case 'agent':
          useStore.setState((s) => ({ agentOpen: a.open ? true : !s.agentOpen, agentFocus: s.agentFocus + 1, overlay: s.overlay?.kind === 'menu' ? null : s.overlay }))
          break
        case 'qr':
          store.setOverlay({ kind: 'qr', image: a.image, text: a.text, source: a.source, seq: Date.now() })
          break
        case 'page-qr':
          store.setOverlay({ kind: 'page-qr', url: a.url, title: a.title })
          break
        case 'confirm-download':
          useStore.setState((s) => ({ confirms: [...s.confirms, a.request], overlay: s.overlay?.kind === 'menu' ? null : s.overlay }))
          break
      }
    })
  ]
  void api.invoke('state:get').then((state) => useStore.setState({ state }))
  void api.invoke('settings:get').then((settings) => useStore.setState({ settings }))
  void api.invoke('downloads:list').then((downloads) => useStore.setState({ downloads }))
  void api.invoke('account:get').then((account) => useStore.setState({ account }))
  void api.invoke('agent:get').then((agent) => useStore.setState({ agent }))
  return () => offs.forEach((off) => off())
}
