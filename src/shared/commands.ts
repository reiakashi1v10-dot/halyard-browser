import type { Command } from './types'
import { t, type I18nKey } from './i18n'

export interface CommandSpec {
  /** Shortcut shown in menus and the palette. The main process keymap is the source of truth. */
  keys?: string
  /** Listed in the command palette. */
  palette?: boolean
}

export const COMMANDS: Record<Command, CommandSpec> = {
  'new-tab': { keys: 'Ctrl+T', palette: true },
  'new-container-tab': { keys: 'Ctrl+Shift+E', palette: true },
  'close-tab': { keys: 'Ctrl+W', palette: true },
  'reopen-closed-tab': { keys: 'Ctrl+Shift+T', palette: true },
  'next-tab': { keys: 'Ctrl+Tab' },
  'prev-tab': { keys: 'Ctrl+Shift+Tab' },
  reload: { keys: 'Ctrl+R', palette: true },
  'hard-reload': { keys: 'Ctrl+Shift+R', palette: true },
  stop: {},
  back: { keys: 'Alt+←' },
  forward: { keys: 'Alt+→' },
  'focus-address': { keys: 'Ctrl+L' },
  'open-palette': { keys: 'Ctrl+K' },
  find: { keys: 'Ctrl+F', palette: true },
  'zoom-in': { keys: 'Ctrl++', palette: true },
  'zoom-out': { keys: 'Ctrl+-', palette: true },
  'zoom-reset': { keys: 'Ctrl+0', palette: true },
  'toggle-sidebar': { keys: 'Ctrl+B', palette: true },
  'toggle-split': { keys: 'Ctrl+Shift+S', palette: true },
  'toggle-pin': { keys: 'Ctrl+Shift+P', palette: true },
  'toggle-mute': { keys: 'Ctrl+M', palette: true },
  'duplicate-tab': { keys: 'Ctrl+Shift+D', palette: true },
  bookmark: { keys: 'Ctrl+D', palette: true },
  'new-window': { keys: 'Ctrl+N', palette: true },
  'new-private-window': { keys: 'Ctrl+Shift+N', palette: true },
  'open-history': { keys: 'Ctrl+H', palette: true },
  'open-bookmarks': { keys: 'Ctrl+Shift+O', palette: true },
  'open-downloads': { keys: 'Ctrl+J', palette: true },
  'open-settings': { keys: 'Ctrl+,', palette: true },
  devtools: { keys: 'F12', palette: true },
  print: { keys: 'Ctrl+P', palette: true },
  'sleep-tab': { palette: true },
  'sleep-background-tabs': { palette: true },
  'translate-page': { palette: true },
  'toggle-agent': { keys: 'Ctrl+Shift+A', palette: true },
  'next-space': { keys: 'Ctrl+Alt+→', palette: true },
  'prev-space': { keys: 'Ctrl+Alt+←', palette: true },
  'copy-url': { keys: 'Ctrl+Shift+C', palette: true },
  fullscreen: { keys: 'F11', palette: true },
  'select-tab-1': { keys: 'Ctrl+1' },
  'select-tab-2': { keys: 'Ctrl+2' },
  'select-tab-3': { keys: 'Ctrl+3' },
  'select-tab-4': { keys: 'Ctrl+4' },
  'select-tab-5': { keys: 'Ctrl+5' },
  'select-tab-6': { keys: 'Ctrl+6' },
  'select-tab-7': { keys: 'Ctrl+7' },
  'select-tab-8': { keys: 'Ctrl+8' },
  'select-last-tab': { keys: 'Ctrl+9' },
  'toggle-theme': { palette: true },
  'scan-qr': { keys: 'Ctrl+Shift+Q', palette: true },
  'page-qr': { palette: true },
  screenshot: { keys: 'Ctrl+Shift+X', palette: true },
  'open-lab': { keys: 'Ctrl+Shift+L', palette: true },
  panic: { palette: true }
}

export function commandLabel(command: Command): string {
  return t(`cmd.${command}` as I18nKey)
}

/** Keyboard map used by the main process. Keys are normalised as Ctrl+Shift+Alt+Key. */
export const KEYMAP: Record<string, Command> = {
  'Ctrl+T': 'new-tab',
  'Ctrl+Shift+E': 'new-container-tab',
  'Ctrl+Shift+Q': 'scan-qr',
  'Ctrl+Shift+X': 'screenshot',
  'Ctrl+Shift+L': 'open-lab',
  'Ctrl+W': 'close-tab',
  'Ctrl+F4': 'close-tab',
  'Ctrl+Shift+T': 'reopen-closed-tab',
  'Ctrl+Tab': 'next-tab',
  'Ctrl+PageDown': 'next-tab',
  'Ctrl+Shift+Tab': 'prev-tab',
  'Ctrl+PageUp': 'prev-tab',
  'Ctrl+R': 'reload',
  F5: 'reload',
  'Ctrl+Shift+R': 'hard-reload',
  'Ctrl+F5': 'hard-reload',
  'Shift+F5': 'hard-reload',
  'Alt+ArrowLeft': 'back',
  BrowserBack: 'back',
  'Alt+ArrowRight': 'forward',
  BrowserForward: 'forward',
  'Ctrl+L': 'focus-address',
  'Alt+D': 'focus-address',
  F6: 'focus-address',
  'Ctrl+K': 'open-palette',
  'Ctrl+F': 'find',
  F3: 'find',
  'Ctrl+=': 'zoom-in',
  'Ctrl++': 'zoom-in',
  'Ctrl+Shift++': 'zoom-in',
  'Ctrl+Shift+=': 'zoom-in',
  'Ctrl+-': 'zoom-out',
  'Ctrl+Shift+_': 'zoom-out',
  'Ctrl+0': 'zoom-reset',
  'Ctrl+B': 'toggle-sidebar',
  'Ctrl+Shift+S': 'toggle-split',
  'Ctrl+Shift+P': 'toggle-pin',
  'Ctrl+M': 'toggle-mute',
  'Ctrl+Shift+D': 'duplicate-tab',
  'Ctrl+D': 'bookmark',
  'Ctrl+N': 'new-window',
  'Ctrl+Shift+N': 'new-private-window',
  'Ctrl+H': 'open-history',
  'Ctrl+Shift+O': 'open-bookmarks',
  'Ctrl+J': 'open-downloads',
  'Ctrl+Shift+A': 'toggle-agent',
  'Ctrl+,': 'open-settings',
  F12: 'devtools',
  'Ctrl+Shift+I': 'devtools',
  'Ctrl+P': 'print',
  'Ctrl+Alt+ArrowRight': 'next-space',
  'Ctrl+Alt+ArrowLeft': 'prev-space',
  'Ctrl+Shift+C': 'copy-url',
  F11: 'fullscreen',
  'Ctrl+1': 'select-tab-1',
  'Ctrl+2': 'select-tab-2',
  'Ctrl+3': 'select-tab-3',
  'Ctrl+4': 'select-tab-4',
  'Ctrl+5': 'select-tab-5',
  'Ctrl+6': 'select-tab-6',
  'Ctrl+7': 'select-tab-7',
  'Ctrl+8': 'select-tab-8',
  'Ctrl+9': 'select-last-tab'
}

export function normalizeKey(input: { key: string; control: boolean; meta: boolean; shift: boolean; alt: boolean }): string {
  let key = input.key
  if (key.length === 1) key = key.toUpperCase()
  const parts: string[] = []
  if (input.control || input.meta) parts.push('Ctrl')
  if (input.shift) parts.push('Shift')
  if (input.alt) parts.push('Alt')
  parts.push(key)
  return parts.join('+')
}
