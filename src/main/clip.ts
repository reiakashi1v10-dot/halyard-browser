import { clipboard, ClipboardItem } from 'electron'

/** Put a PNG on the system clipboard (Electron's clipboard is asynchronous since v45). */
export async function copyPng(png: Buffer): Promise<void> {
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })])
}
