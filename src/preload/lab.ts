// Bridge for the Halyard Lab window. Only whitelisted channels pass.
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { LAB_CHANNELS, type Result } from '@shared/ipc'

const channels = new Set<string>(LAB_CHANNELS)

contextBridge.exposeInMainWorld('halyardLab', {
  platform: process.platform,
  async invoke(channel: string, ...args: unknown[]) {
    if (!channels.has(channel)) throw new Error(`Canal bloqueado: ${channel}`)
    const res = (await ipcRenderer.invoke(channel, ...args)) as Result<unknown>
    if (!res.ok) throw new Error(res.error)
    return res.data
  },
  /** Language or theme changed in the browser. */
  onSettings(callback: () => void): () => void {
    const handler = () => callback()
    ipcRenderer.on('lab-settings', handler)
    return () => ipcRenderer.removeListener('lab-settings', handler)
  },
  /** Where a dropped file is on disk, so main can read it to compute its hash. */
  pathForFile(file: File): string {
    return webUtils.getPathForFile(file)
  }
})
