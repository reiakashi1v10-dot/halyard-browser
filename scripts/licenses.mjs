// Builds the third-party license list shipped with Halyard:
//   legal/licenses.json          short list shown in Settings › About and on the website
//   legal/THIRD_PARTY_NOTICES.txt full license texts, copied next to the .exe
// Run automatically by `npm run dist` / `npm run release`.
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const nm = join(root, 'node_modules')

// runtime dependencies (inside the .exe, unpacked or in app.asar)
const parseable = execSync('npm ls --omit=dev --all --parseable', { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const dirs = new Set(parseable.split(/\r?\n/).filter((d) => d && resolve(d) !== root))
// dev dependencies that get bundled into the interface code
for (const name of ['react', 'react-dom', 'scheduler', 'zustand', 'lucide-react', '@fontsource-variable/onest', '@fontsource-variable/bricolage-grotesque'])
  if (existsSync(join(nm, name))) dirs.add(join(nm, name))

const licenseText = (dir) => {
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying|notice)(\.|$)/i.test(f))
  return file ? readFileSync(join(dir, file), 'utf8').trim() : ''
}
const repoUrl = (repo) => {
  const raw = typeof repo === 'string' ? repo : repo?.url ?? ''
  return raw.replace(/^git\+/, '').replace(/\.git$/, '').replace(/^github:/, 'https://github.com/').replace(/^git:\/\//, 'https://')
}

const seen = new Map()
for (const dir of dirs) {
  let pkg
  try {
    pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  } catch {
    continue
  }
  const key = `${pkg.name}@${pkg.version}`
  if (seen.has(key) || !pkg.name) continue
  const license = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? (pkg.licenses?.map((l) => l.type).join(' OR ') || 'UNKNOWN')
  seen.set(key, { name: pkg.name, version: pkg.version, license, url: repoUrl(pkg.repository) || pkg.homepage || '', text: licenseText(dir) })
}

const packages = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))

// software and data that are not npm packages
const extra = [
  { name: 'Chromium', version: '', license: 'BSD-3-Clause and others', url: 'https://www.chromium.org/', note: 'Full list: LICENSES.chromium.html next to Halyard Browser.exe' },
  { name: 'Electron', version: '', license: 'MIT', url: 'https://github.com/electron/electron', note: 'LICENSE.electron.txt next to Halyard Browser.exe' },
  { name: 'EasyList, EasyPrivacy, uBlock Origin filters (via Ghostery)', version: '', license: 'GPL-3.0 / CC BY-SA 3.0 (per list)', url: 'https://github.com/ghostery/adblocker', note: 'Filter lists downloaded at run time' },
  { name: 'malware-filter (URLhaus, phishing-filter)', version: '', license: 'See source', url: 'https://gitlab.com/malware-filter', note: 'Lists of dangerous sites downloaded at run time' },
  { name: 'Have I Been Pwned — Pwned Passwords', version: '', license: 'CC BY 4.0', url: 'https://haveibeenpwned.com/Passwords', note: 'Leaked-password check (k-anonymity)' },
  { name: 'Qwen3-4B-Instruct-2507 (GGUF by Unsloth)', version: '', license: 'Apache-2.0', url: 'https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507', note: 'Local AI model, downloaded only if the user asks' }
]

const list = [...extra.map((e) => ({ ...e })), ...packages.map(({ text, ...p }) => p)]
writeFileSync(join(root, 'legal', 'licenses.json'), JSON.stringify(list, null, 1) + '\n')

const rule = '-'.repeat(78)
const body = [
  'Halyard Browser — third-party notices',
  'Halyard Browser is released under the MIT license. It includes or uses the software below,',
  'each under its own license.',
  '',
  ...extra.map((e) => `${rule}\n${e.name}\nLicense: ${e.license}\n${e.url}\n${e.note}`),
  ...packages.map((p) => `${rule}\n${p.name} ${p.version}\nLicense: ${p.license}\n${p.url}\n\n${p.text || '(no license file in the package; see the license field above)'}`)
].join('\n\n')
writeFileSync(join(root, 'legal', 'THIRD_PARTY_NOTICES.txt'), body + '\n')

const unknown = packages.filter((p) => p.license === 'UNKNOWN').map((p) => p.name)
console.log(`licenses: ${packages.length} packages + ${extra.length} other components${unknown.length ? ` (no license field: ${unknown.join(', ')})` : ''}`)
