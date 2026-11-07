import { execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DownloadKind } from '@shared/types'

/** Files that can run code when opened. These ask for confirmation and get scanned. */
const RISKY_EXTENSIONS = new Set([
  'exe', 'msi', 'msix', 'msixbundle', 'appx', 'appxbundle', 'bat', 'cmd', 'com', 'scr', 'pif', 'cpl', 'ps1', 'psm1',
  'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'hta', 'jar', 'reg', 'lnk', 'dll', 'sys', 'apk', 'xapk', 'dmg', 'pkg',
  'deb', 'rpm', 'appimage', 'sh', 'iso', 'img', 'vhd', 'vhdx', 'zip', 'rar', '7z', 'cab', 'tar', 'gz', 'docm', 'xlsm', 'pptm'
])

export function isRiskyFile(filename: string): boolean {
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  return RISKY_EXTENSIONS.has(ext)
}

const KINDS: [DownloadKind, string[]][] = [
  ['program', ['exe', 'msi', 'msix', 'msixbundle', 'appx', 'appxbundle', 'com', 'scr', 'pif', 'cpl', 'dll', 'sys', 'apk', 'xapk', 'dmg', 'pkg', 'deb', 'rpm', 'appimage', 'jar', 'lnk']],
  ['script', ['bat', 'cmd', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'hta', 'reg', 'sh']],
  ['archive', ['zip', 'rar', '7z', 'cab', 'tar', 'gz']],
  ['disk', ['iso', 'img', 'vhd', 'vhdx']],
  ['document', ['docm', 'xlsm', 'pptm']]
]

export function fileKind(filename: string): DownloadKind {
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  return KINDS.find(([, list]) => list.includes(ext))?.[0] ?? 'other'
}

export type ScanResult = 'clean' | 'infected' | 'unavailable'

export function defenderPath(): string | null {
  if (process.platform !== 'win32') return null
  const platformDir = join(process.env['ProgramData'] ?? 'C:\\ProgramData', 'Microsoft', 'Windows Defender', 'Platform')
  try {
    const versions = readdirSync(platformDir).sort().reverse()
    for (const v of versions) {
      const exe = join(platformDir, v, 'MpCmdRun.exe')
      if (existsSync(exe)) return exe
    }
  } catch {
    /* fall back to Program Files */
  }
  const legacy = join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Windows Defender', 'MpCmdRun.exe')
  return existsSync(legacy) ? legacy : null
}

/**
 * Scan one file with Microsoft Defender's command-line scanner (built into Windows).
 * Exit code 0 = no threats, 2 = threat found. Anything else means Defender could not
 * scan (another antivirus may own real-time protection, which then scans on its own).
 */
export function scanFile(path: string): Promise<ScanResult> {
  const exe = defenderPath()
  if (!exe) return Promise.resolve('unavailable')
  return new Promise((resolve) => {
    execFile(
      exe,
      ['-Scan', '-ScanType', '3', '-File', path, '-DisableRemediation'],
      { timeout: 180_000, windowsHide: true },
      (error) => {
        const code = error ? (typeof error.code === 'number' ? error.code : -1) : 0
        resolve(code === 0 ? 'clean' : code === 2 ? 'infected' : 'unavailable')
      }
    )
  })
}

/**
 * Mark the file as coming from the internet (NTFS Zone.Identifier stream), like Chrome
 * and Edge do. Windows SmartScreen and Office Protected View then treat it with care.
 */
export async function markOfTheWeb(path: string, url: string, referrer?: string): Promise<void> {
  if (process.platform !== 'win32') return
  const lines = ['[ZoneTransfer]', 'ZoneId=3']
  if (referrer && /^https?:/.test(referrer)) lines.push(`ReferrerUrl=${referrer}`)
  if (/^https?:/.test(url)) lines.push(`HostUrl=${url}`)
  try {
    await writeFile(`${path}:Zone.Identifier`, lines.join('\r\n') + '\r\n')
  } catch {
    /* non-NTFS drives have no alternate streams */
  }
}

export async function deleteFile(path: string): Promise<void> {
  await unlink(path).catch(() => undefined)
}
