import { execFile } from 'node:child_process'
import { shell } from 'electron'
import type { RansomwareStatus } from '@shared/types'

/*
 * Ransomware protection is Windows' "Controlled folder access" (part of Microsoft Defender).
 * Blocking other programs from changing files needs the operating system itself, so the
 * browser only READS the current state and opens the Windows Security page where the
 * user can turn it on. It never changes security settings by itself.
 */

function powershell(command: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { timeout: 10_000, windowsHide: true },
      (err, stdout) => resolve(err ? '' : String(stdout).trim())
    )
  })
}

let cache: { at: number; value: RansomwareStatus } | null = null

export async function ransomwareStatus(): Promise<RansomwareStatus> {
  if (process.platform !== 'win32') return { folders: 'unsupported', antivirus: [] }
  if (cache && Date.now() - cache.at < 15_000) return cache.value
  const [cfa, av] = await Promise.all([
    powershell('(Get-MpPreference).EnableControlledFolderAccess'),
    powershell('Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct | ForEach-Object { $_.displayName }')
  ])
  // 0 off, 1 on (block), 2 audit only, 3/4 block or audit disk changes only
  const folders: RansomwareStatus['folders'] = cfa === '1' ? 'on' : cfa === '2' || cfa === '4' ? 'audit' : cfa === '0' || cfa === '3' ? 'off' : 'unknown'
  const antivirus = [...new Set(av.split(/\r?\n/).map((s) => s.trim()).filter(Boolean))].slice(0, 5)
  const value = { folders, antivirus }
  cache = { at: Date.now(), value }
  return value
}

/** Windows Security › Ransomware protection, where the user turns it on. */
export function openRansomwareSettings(): void {
  cache = null
  if (process.platform === 'win32') void shell.openExternal('windowsdefender://ransomwareprotection')
}
