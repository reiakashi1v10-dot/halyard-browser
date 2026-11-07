import { execFile } from 'node:child_process'
import { shell } from 'electron'
import type { WinScanResult, WinSecurityId, WinSecurityItem, WinSecurityReport } from '@shared/types'
import { defenderPath } from './scanner'

/*
 * Windows security health check. Most protections people expect from an antivirus
 * (real-time scanning, tamper protection, memory integrity, Secure Boot, the vulnerable
 * driver blocklist, Smart App Control, the firewall...) belong to Windows itself.
 * Halyard only READS their state and opens the matching Windows Security page; it never
 * changes a security setting on its own.
 */

const SCRIPT = String.raw`
$r=@{}
try{$s=Get-MpComputerStatus -ErrorAction Stop;$r.rt=$s.RealTimeProtectionEnabled;$r.behavior=$s.BehaviorMonitorEnabled;$r.tamper=$s.IsTamperProtected;$r.sigAge=$s.AntivirusSignatureAge;$r.scanAge=$s.QuickScanAge}catch{}
try{$p=Get-MpPreference -ErrorAction Stop;$r.cloud=[int]$p.MAPSReporting;$r.pua=[int]$p.PUAProtection;$r.cfa=[int]$p.EnableControlledFolderAccess}catch{}
function reg($k,$n){try{(Get-ItemProperty -Path $k -Name $n -ErrorAction Stop).$n}catch{$null}}
$r.secureBoot=reg 'HKLM:\SYSTEM\CurrentControlSet\Control\SecureBoot\State' 'UEFISecureBootEnabled'
$r.hvci=reg 'HKLM:\SYSTEM\CurrentControlSet\Control\DeviceGuard\Scenarios\HypervisorEnforcedCodeIntegrity' 'Enabled'
$r.drivers=reg 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Config' 'VulnerableDriverBlocklistEnable'
$r.sac=reg 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy' 'VerifiedAndReputablePolicyState'
try{$r.fwOff=@(Get-NetFirewallProfile -ErrorAction Stop|Where-Object{-not $_.Enabled}).Count}catch{}
try{$r.av=@(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction Stop|ForEach-Object{$_.displayName})}catch{}
$r|ConvertTo-Json -Compress
`

/** Windows Security page for each item (a fixed list: the page never sends a URL). */
const PAGES: Record<WinSecurityId, string> = {
  realtime: 'windowsdefender://threatsettings',
  behavior: 'windowsdefender://threatsettings',
  tamper: 'windowsdefender://threatsettings',
  cloud: 'windowsdefender://threatsettings',
  pua: 'windowsdefender://appbrowser',
  folders: 'windowsdefender://ransomwareprotection',
  signatures: 'windowsdefender://threat',
  scan: 'windowsdefender://threat',
  firewall: 'windowsdefender://network',
  secureBoot: 'windowsdefender://devicesecurity',
  memoryIntegrity: 'windowsdefender://coreisolation',
  driverBlocklist: 'windowsdefender://coreisolation',
  smartApp: 'windowsdefender://smartapp'
}

function run(command: string, timeout = 20_000): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { timeout, windowsHide: true },
      (err, stdout) => resolve(err ? '' : String(stdout).trim())
    )
  })
}

type Raw = Partial<Record<'rt' | 'behavior' | 'tamper', boolean>> &
  Partial<Record<'sigAge' | 'scanAge' | 'cloud' | 'pua' | 'cfa' | 'secureBoot' | 'hvci' | 'drivers' | 'sac' | 'fwOff', number | null>> & {
    av?: string[] | string
  }

type State = WinSecurityItem['state']

const flag = (v: boolean | number | null | undefined): State => (v == null ? 'unknown' : v === true || v === 1 ? 'on' : 'off')

let cache: { at: number; value: WinSecurityReport } | null = null

export async function windowsSecurity(): Promise<WinSecurityReport> {
  if (process.platform !== 'win32') return { supported: false, otherAntivirus: [], items: [] }
  if (cache && Date.now() - cache.at < 15_000) return cache.value
  let raw: Raw = {}
  try {
    raw = JSON.parse((await run(SCRIPT)) || '{}') as Raw
  } catch {
    raw = {}
  }
  const av = (Array.isArray(raw.av) ? raw.av : raw.av ? [raw.av] : []).filter(Boolean)
  const others = [...new Set(av.filter((n) => !/defender/i.test(n)))].slice(0, 5)
  // another antivirus took over: Defender's own switches are off on purpose.
  // (Windows keeps listing antivirus that were uninstalled, so only trust the list when Defender is off.)
  const passive = others.length > 0 && raw.rt !== true
  const otherAntivirus = passive ? others : []
  const defender = (state: State): State => (passive ? 'unknown' : state)
  const age = (days: number | null | undefined, good: number, ok: number): State =>
    days == null ? 'unknown' : days <= good ? 'on' : days <= ok ? 'warn' : 'off'

  const items: WinSecurityItem[] = [
    { id: 'realtime', state: defender(flag(raw.rt)) },
    { id: 'behavior', state: defender(flag(raw.behavior)) },
    { id: 'tamper', state: defender(flag(raw.tamper)) },
    { id: 'cloud', state: defender(raw.cloud == null ? 'unknown' : raw.cloud > 0 ? 'on' : 'off') },
    // 1 = block, 2 = audit only
    { id: 'pua', state: defender(raw.pua == null ? 'unknown' : raw.pua === 1 ? 'on' : raw.pua === 2 ? 'warn' : 'off') },
    { id: 'folders', state: defender(raw.cfa == null ? 'unknown' : raw.cfa === 1 ? 'on' : raw.cfa === 2 || raw.cfa === 4 ? 'warn' : 'off') },
    { id: 'signatures', state: defender(age(raw.sigAge, 3, 7)), value: raw.sigAge ?? undefined },
    // Defender reports 65535 days when it never ran a quick scan
    { id: 'scan', state: defender(age(raw.scanAge, 7, 30)), value: raw.scanAge != null && raw.scanAge < 10_000 ? raw.scanAge : undefined },
    { id: 'firewall', state: raw.fwOff == null ? 'unknown' : raw.fwOff === 0 ? 'on' : 'off', value: raw.fwOff ?? undefined },
    { id: 'secureBoot', state: flag(raw.secureBoot) },
    { id: 'memoryIntegrity', state: raw.hvci == null ? 'off' : flag(raw.hvci) },
    { id: 'driverBlocklist', state: flag(raw.drivers) },
    // 1 = on, 2 = evaluation (Windows decides later), 0 = off
    { id: 'smartApp', state: raw.sac == null ? 'unknown' : raw.sac === 1 ? 'on' : raw.sac === 2 ? 'warn' : 'off' }
  ]
  const value: WinSecurityReport = { supported: true, otherAntivirus, items }
  cache = { at: Date.now(), value }
  return value
}

export function openWindowsSecurity(id: string): void {
  cache = null
  const page = PAGES[id as WinSecurityId]
  if (process.platform === 'win32' && page) void shell.openExternal(page)
}

let scanning: Promise<WinScanResult> | null = null

/**
 * Microsoft Defender quick scan: running programs, memory, startup entries and the
 * places malware usually hides. Takes a few minutes; asking twice reuses the same scan.
 */
export function quickScan(): Promise<WinScanResult> {
  if (scanning) return scanning
  const exe = defenderPath()
  if (!exe) return Promise.resolve('unavailable')
  scanning = new Promise<WinScanResult>((resolve) => {
    execFile(exe, ['-Scan', '-ScanType', '1'], { timeout: 30 * 60_000, windowsHide: true }, (error) => {
      const code = error ? (typeof error.code === 'number' ? error.code : -1) : 0
      cache = null
      resolve(code === 0 ? 'clean' : code === 2 ? 'threats' : 'unavailable')
    })
  }).finally(() => {
    scanning = null
  })
  return scanning
}
