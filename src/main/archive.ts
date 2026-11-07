import { open } from 'node:fs/promises'
import type { ArchiveReport } from '@shared/types'
import { fileKind } from './scanner'
import { deceptiveName } from './downloads'

/*
 * Looks inside a downloaded .zip without extracting anything: only the archive's table of
 * contents (the "central directory" at the end of the file) is read. Phishing often ships
 * a shortcut, script or program inside a zip, or protects the zip with a password so
 * antivirus scanners can't see inside it.
 */

const EOCD = 0x06054b50
const ZIP64_LOCATOR = 0x07064b50
const ZIP64_EOCD = 0x06064b50
const ENTRY = 0x02014b50
const MAX_DIRECTORY = 16 * 1024 * 1024
const MAX_ENTRIES = 20_000

/** Names inside the zip that can run code, or that are archives/disks hiding more files. */
function dangerous(name: string): boolean {
  const base = name.split('/').pop() ?? name
  if (!base) return false
  const kind = fileKind(base)
  return kind === 'program' || kind === 'script' || kind === 'disk' || kind === 'document' || deceptiveName(base)
}

export async function inspectZip(path: string): Promise<ArchiveReport | null> {
  const fh = await open(path, 'r').catch(() => null)
  if (!fh) return null
  try {
    const { size } = await fh.stat()
    if (size < 22) return null
    // the end record is in the last 64 KB (+22 bytes) of the file
    const tailLen = Math.min(size, 65_557)
    const tail = Buffer.alloc(tailLen)
    await fh.read(tail, 0, tailLen, size - tailLen)
    let eocd = -1
    for (let i = tailLen - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD) {
        eocd = i
        break
      }
    }
    if (eocd < 0) return null
    let count = tail.readUInt16LE(eocd + 10)
    let dirSize = tail.readUInt32LE(eocd + 12)
    let dirOffset = tail.readUInt32LE(eocd + 16)
    // ZIP64: the real numbers are in a second, larger end record
    if ((count === 0xffff || dirOffset === 0xffffffff || dirSize === 0xffffffff) && eocd >= 20 && tail.readUInt32LE(eocd - 20) === ZIP64_LOCATOR) {
      const at = Number(tail.readBigUInt64LE(eocd - 12))
      const rec = Buffer.alloc(56)
      await fh.read(rec, 0, 56, at)
      if (rec.readUInt32LE(0) !== ZIP64_EOCD) return null
      count = Number(rec.readBigUInt64LE(32))
      dirSize = Number(rec.readBigUInt64LE(40))
      dirOffset = Number(rec.readBigUInt64LE(48))
    }
    if (dirSize > MAX_DIRECTORY || dirOffset + dirSize > size) return null
    const dir = Buffer.alloc(dirSize)
    await fh.read(dir, 0, dirSize, dirOffset)

    const report: ArchiveReport = { entries: 0, risky: [], riskyCount: 0, encrypted: false }
    let p = 0
    while (p + 46 <= dir.length && report.entries < Math.min(count, MAX_ENTRIES)) {
      if (dir.readUInt32LE(p) !== ENTRY) break
      const flags = dir.readUInt16LE(p + 8)
      const nameLen = dir.readUInt16LE(p + 28)
      const extraLen = dir.readUInt16LE(p + 30)
      const commentLen = dir.readUInt16LE(p + 32)
      // bit 11: the name is UTF-8; older tools use the DOS code page (close enough as latin1)
      const name = dir.subarray(p + 46, p + 46 + nameLen).toString(flags & 0x800 ? 'utf8' : 'latin1')
      p += 46 + nameLen + extraLen + commentLen
      if (name.endsWith('/')) continue
      report.entries++
      if (flags & 0x1) report.encrypted = true
      if (dangerous(name)) {
        report.riskyCount++
        if (report.risky.length < 5) report.risky.push(name.replace(/[‪-‮⁦-⁩]/g, '').slice(-120))
      }
    }
    return report
  } catch {
    return null
  } finally {
    await fh.close().catch(() => undefined)
  }
}
