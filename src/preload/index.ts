// Bridge for the browser chrome (sidebar, toolbar, palette). Only whitelisted channels pass.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { UI_CHANNELS, UI_EVENTS, type Result } from '@shared/ipc'

const channels = new Set<string>(UI_CHANNELS)
const events = new Set<string>(UI_EVENTS)

contextBridge.exposeInMainWorld('halyard', {
  platform: process.platform,
  async invoke(channel: string, ...args: unknown[]) {
    if (!channels.has(channel)) throw new Error(`Canal bloqueado: ${channel}`)
    const res = (await ipcRenderer.invoke(channel, ...args)) as Result<unknown>
    if (!res.ok) throw new Error(res.error)
    return res.data
  },
  on(event: string, callback: (payload: unknown) => void) {
    if (!events.has(event)) throw new Error(`Evento bloqueado: ${event}`)
    const handler = (_e: IpcRendererEvent, payload: unknown) => callback(payload)
    ipcRenderer.on(event, handler)
    return () => ipcRenderer.removeListener(event, handler)
  }
})
