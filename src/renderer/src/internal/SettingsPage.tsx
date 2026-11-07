import { useEffect, useState, type ReactNode } from 'react'
import { SEARCH_ENGINES, type AccountState, type AiModelStatus, type RansomwareStatus, type UpdateState, type WinScanResult, type WinSecurityReport, type Command, type SearchEngineId, type SecureDns, type Settings } from '@shared/types'
import { Check } from 'lucide-react'
import { COMMANDS, commandLabel } from '@shared/commands'
import { internal } from '@/lib/api'
import { BRAND, LANGUAGES, t, type I18nKey, type Lang } from '@/lib/i18n'

const SECTIONS: { id: string; key: I18nKey }[] = [
  { id: 'general', key: 'set.general' },
  { id: 'appearance', key: 'set.appearance' },
  { id: 'privacy', key: 'set.privacy' },
  { id: 'network', key: 'set.network' },
  { id: 'downloads', key: 'set.downloads' },
  { id: 'protect', key: 'set.protect' },
  { id: 'windows', key: 'set.winsec' },
  { id: 'ai', key: 'set.ai' },
  { id: 'performance', key: 'set.performance' },
  { id: 'shortcuts', key: 'set.shortcuts' },
  { id: 'about', key: 'set.about' }
]

const PERMISSION_KEYS = new Set([
  'camera', 'microphone', 'camera+microphone', 'geolocation', 'notifications', 'clipboard-read',
  'midi', 'midiSysex', 'hid', 'serial', 'usb', 'display-capture'
])

const permissionName = (p: string): string => (PERMISSION_KEYS.has(p) ? t(`permName.${p}` as I18nKey) : p)

export function SettingsPage({ settings }: { settings: Settings }) {
  const [section, setSection] = useState(location.hostname === 'about' ? 'about' : 'general')
  const set = (patch: Partial<Settings>) => void internal().invoke('internal:set-settings', patch)

  useEffect(() => {
    document.getElementById(section)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [section])

  return (
    <div className="settings">
      <nav className="settings-nav" aria-label={t('set.sections')}>
        <h1>{t('set.title')}</h1>
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" className={section === s.id ? 'is-on' : ''} onClick={() => setSection(s.id)}>
            {t(s.key)}
          </button>
        ))}
      </nav>
      <div className="settings-body">
        <Section id="general" title={t('set.general')}>
          <AccountRow />
          <Row label={t('set.language')} hint={t('set.languageHint')}>
            <select className="input" value={settings.language} onChange={(e) => set({ language: e.target.value as Lang })}>
              {LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Row>
          <Row label={t('set.name')} hint={t('set.nameHint')}>
            <input
              key={`name-${settings.userName}`}
              className="input"
              defaultValue={settings.userName}
              maxLength={40}
              placeholder={t('set.namePh')}
              onBlur={(e) => set({ userName: e.target.value })}
            />
          </Row>
          <Row label={t('set.engine')} hint={t('set.engineHint')}>
            <select className="input" value={settings.searchEngine} onChange={(e) => set({ searchEngine: e.target.value as SearchEngineId })}>
              {Object.entries(SEARCH_ENGINES).map(([id, e]) => (
                <option key={id} value={id}>
                  {e.name}
                </option>
              ))}
            </select>
          </Row>
          <Toggle label={t('set.suggest')} hint={t('set.suggestHint')} checked={settings.suggestions} onChange={(v) => set({ suggestions: v })} />
          <Toggle label={t('set.restore')} hint={t('set.restoreHint')} checked={settings.restoreSession} onChange={(v) => set({ restoreSession: v })} />
        </Section>

        <Section id="appearance" title={t('set.appearance')}>
          <Row label={t('set.theme')} hint={t('set.themeHint')}>
            <div className="segmented">
              {(
                [
                  ['system', 'theme.system'],
                  ['dark', 'theme.dark'],
                  ['light', 'theme.light']
                ] as const
              ).map(([v, key]) => (
                <button key={v} type="button" className={settings.theme === v ? 'is-on' : ''} onClick={() => set({ theme: v })}>
                  {t(key)}
                </button>
              ))}
            </div>
          </Row>
          <Toggle
            label={t('set.collapsed')}
            hint={t('set.collapsedHint')}
            checked={settings.sidebarCollapsed}
            onChange={(v) => set({ sidebarCollapsed: v })}
          />
        </Section>

        <Section id="privacy" title={t('set.privacy')}>
          <Toggle label={t('set.adblock')} hint={t('set.adblockHint')} checked={settings.adblock} onChange={(v) => set({ adblock: v })} />
          <Toggle label={t('set.safe')} hint={t('set.safeHint')} checked={settings.safeBrowsing} onChange={(v) => set({ safeBrowsing: v })} />
          <Toggle label={t('set.https')} hint={t('set.httpsHint')} checked={settings.httpsOnly} onChange={(v) => set({ httpsOnly: v })} />
          <Toggle label={t('set.dnt')} hint={t('set.dntHint')} checked={settings.doNotTrack} onChange={(v) => set({ doNotTrack: v })} />
          <Toggle label={t('set.strip')} hint={t('set.stripHint')} checked={settings.stripTracking} onChange={(v) => set({ stripTracking: v })} />
          <Toggle label={t('set.bounce')} hint={t('set.bounceHint')} checked={settings.bounceProtection} onChange={(v) => set({ bounceProtection: v })} />
          <Toggle label={t('set.popups')} hint={t('set.popupsHint')} checked={settings.blockPopups} onChange={(v) => set({ blockPopups: v })} />
          <Toggle label={t('set.webrtc')} hint={t('set.webrtcHint')} checked={settings.webrtcProtection} onChange={(v) => set({ webrtcProtection: v })} />
          <Toggle label={t('set.breach')} hint={t('set.breachHint')} checked={settings.breachCheck} onChange={(v) => set({ breachCheck: v })} />
          <Toggle label={t('set.fp')} hint={t('set.fpHint')} checked={settings.fingerprintProtection} onChange={(v) => set({ fingerprintProtection: v })} />
          <Toggle
            label={t('set.scriptsOff')}
            hint={t('set.scriptsOffHint')}
            checked={settings.scriptsOffByDefault}
            onChange={(v) => set({ scriptsOffByDefault: v })}
          />
          {settings.scriptSites.length > 0 && (
            <Row label={t('set.scriptSites')} hint={t('set.scriptSitesHint')}>
              <ul className="chips">
                {settings.scriptSites.map((h) => (
                  <li key={h}>
                    {h}
                    <button type="button" aria-label={h} onClick={() => set({ scriptSites: settings.scriptSites.filter((x) => x !== h) })}>
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </Row>
          )}
          <Toggle label={t('set.fonts')} hint={t('set.fontsHint')} checked={settings.blockRemoteFonts} onChange={(v) => set({ blockRemoteFonts: v })} />
          <Toggle label={t('set.notif')} hint={t('set.notifHint')} checked={settings.quietNotifications} onChange={(v) => set({ quietNotifications: v })} />
          <Row label={t('set.permTemp')} hint={t('set.permTempHint')}>
            {null}
          </Row>
          {settings.allowlist.length > 0 && (
            <Row label={t('set.allowlist')} hint={t('set.allowlistHint')}>
              <ul className="chips">
                {settings.allowlist.map((h) => (
                  <li key={h}>
                    {h}
                    <button
                      type="button"
                      aria-label={t('set.reblock', { host: h })}
                      onClick={() => set({ allowlist: settings.allowlist.filter((x) => x !== h) })}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </Row>
          )}
          <Permissions />
          <ClearData />
        </Section>

        <Section id="network" title={t('set.network')}>
          <Row label={t('set.dns')} hint={t('set.dnsHint')}>
            <select className="input" value={settings.secureDns} onChange={(e) => set({ secureDns: e.target.value as SecureDns })}>
              {DNS_OPTIONS.map(([v, key]) => (
                <option key={v} value={v}>
                  {t(key)}
                </option>
              ))}
            </select>
          </Row>
          {settings.secureDns !== 'off' && settings.secureDns !== 'system' && (
            <Toggle
              label={t('set.dnsStrict')}
              hint={t('set.dnsStrictHint')}
              checked={settings.secureDnsStrict}
              onChange={(v) => set({ secureDnsStrict: v })}
            />
          )}
          <Toggle label={t('set.localNet')} hint={t('set.localNetHint')} checked={settings.blockLocalNetwork} onChange={(v) => set({ blockLocalNetwork: v })} />
          <Toggle label={t('set.tls')} hint={t('set.tlsHint')} checked={settings.strictTls} onChange={(v) => set({ strictTls: v })} />
          <Always keys={['set.alwaysHsts', 'set.alwaysEch', 'set.alwaysMixed', 'set.alwaysCorp']} />
        </Section>

        <Section id="downloads" title={t('set.downloads')}>
          <Toggle label={t('set.askSave')} hint={t('set.askSaveHint')} checked={settings.askWhereToSave} onChange={(v) => set({ askWhereToSave: v })} />
          <Toggle label={t('set.driveBy')} hint={t('set.driveByHint')} checked={settings.blockDriveBy} onChange={(v) => set({ blockDriveBy: v })} />
          <Toggle label={t('set.exe')} hint={t('set.exeHint')} checked={settings.blockExecutables} onChange={(v) => set({ blockExecutables: v })} />
          <Always keys={['set.alwaysMotw', 'set.alwaysScan', 'set.alwaysHash', 'set.alwaysDeceptive']} />
        </Section>

        <Section id="protect" title={t('set.protect')}>
          <Toggle label={t('set.crypto')} hint={t('set.cryptoHint')} checked={settings.cryptoGuard} onChange={(v) => set({ cryptoGuard: v })} />
          <Toggle label={t('set.clickfix')} hint={t('set.clickfixHint')} checked={settings.antiClickFix} onChange={(v) => set({ antiClickFix: v })} />
          <Toggle label={t('set.insecureLogin')} hint={t('set.insecureLoginHint')} checked={settings.insecureLoginWarn} onChange={(v) => set({ insecureLoginWarn: v })} />
          <Toggle label={t('set.risky')} hint={t('set.riskyHint')} checked={settings.riskyDomainWarn} onChange={(v) => set({ riskyDomainWarn: v })} />
          <Toggle label={t('set.fsWarn')} hint={t('set.fsWarnHint')} checked={settings.fullscreenWarn} onChange={(v) => set({ fullscreenWarn: v })} />
          <Always keys={['set.alwaysQr', 'set.alwaysLink', 'set.alwaysCapture', 'set.alwaysDisposable']} />
          <Row label={t('set.lab')} hint={t('set.labHint')}>
            <button type="button" className="btn btn-primary" onClick={() => void internal().invoke('internal:open-lab')}>
              {t('set.labOpen')}
            </button>
          </Row>
          <Row label={t('set.panic')} hint={t('set.panicHint')}>
            <button type="button" className="btn btn-danger" onClick={() => void internal().invoke('internal:panic')}>
              {t('set.panicBtn')}
            </button>
          </Row>
          <RansomwareRows />
        </Section>

        <Section id="windows" title={t('set.winsec')}>
          <WindowsHealth />
        </Section>

        <Section id="ai" title={t('set.ai')}>
          <AiRow />
        </Section>

        <Section id="performance" title={t('set.performance')}>
          <Row label={t('set.sleep')} hint={t('set.sleepHint')}>
            <select className="input" value={settings.sleepAfterMinutes} onChange={(e) => set({ sleepAfterMinutes: Number(e.target.value) })}>
              <option value={0}>{t('set.never')}</option>
              <option value={5}>{t('set.afterMin', { n: 5 })}</option>
              <option value={15}>{t('set.afterMin', { n: 15 })}</option>
              <option value={30}>{t('set.afterMin', { n: 30 })}</option>
              <option value={60}>{t('set.afterHour')}</option>
              <option value={180}>{t('set.afterHours', { n: 3 })}</option>
            </select>
          </Row>
          <Row label={t('set.memLimit')} hint={t('set.memHint')}>
            <select className="input" value={settings.memoryLimitMB} onChange={(e) => set({ memoryLimitMB: Number(e.target.value) })}>
              <option value={0}>{t('perf.noLimit')}</option>
              <option value={1024}>1 GB</option>
              <option value={2048}>2 GB</option>
              <option value={4096}>4 GB</option>
              <option value={8192}>8 GB</option>
              <option value={16384}>16 GB</option>
            </select>
          </Row>
        </Section>

        <Section id="shortcuts" title={t('set.shortcutsTitle')}>
          <dl className="shortcuts">
            {(Object.entries(COMMANDS) as [Command, (typeof COMMANDS)[Command]][])
              .filter(([id, c]) => c.keys && !id.startsWith('select-tab-'))
              .map(([id, c]) => (
                <div key={id}>
                  <dt>{commandLabel(id)}</dt>
                  <dd>
                    {c.keys!.split(/\+(?=.)/).map((k, i) => (
                      <kbd key={i}>{k}</kbd>
                    ))}
                  </dd>
                </div>
              ))}
            <div>
              <dt>{t('set.tabN')}</dt>
              <dd>
                <kbd>Ctrl</kbd>
                <kbd>1…8</kbd>
              </dd>
            </div>
          </dl>
        </Section>

        <Section id="about" title={t('page.about')}>
          <About onWelcome={() => set({ onboarded: false })} />
        </Section>
      </div>
    </div>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="settings-section">
      <h2>{title}</h2>
      <div className="settings-card">{children}</div>
    </section>
  )
}

const DNS_OPTIONS: [SecureDns, I18nKey][] = [
  ['cloudflare', 'set.dnsCloudflare'],
  ['quad9', 'set.dnsQuad9'],
  ['google', 'set.dnsGoogle'],
  ['system', 'set.dnsSystem'],
  ['off', 'set.dnsOff']
]

/** Protections that are always on (nothing to switch). */
function Always({ keys }: { keys: I18nKey[] }) {
  return (
    <div className="setting-row always">
      <div className="setting-text">
        <span className="setting-label">{t('set.always')}</span>
        <ul className="always-list">
          {keys.map((k) => (
            <li key={k}>
              <Check size={13} /> {t(k)}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-text">
        <span className="setting-label">{label}</span>
        {hint && <span className="setting-hint">{hint}</span>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  )
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="setting-row is-toggle">
      <div className="setting-text">
        <span className="setting-label">{label}</span>
        {hint && <span className="setting-hint">{hint}</span>}
      </div>
      <input type="checkbox" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

function AccountRow() {
  const [account, setAccount] = useState<AccountState | null>(null)
  useEffect(() => {
    void internal().invoke('internal:account').then(setAccount)
    return internal().on('account', setAccount)
  }, [])
  if (!account) return null
  if (!account.configured) return <Row label={t('set.account')} hint={t('acct.err.not-configured')}>{null}</Row>
  if (account.user) {
    return (
      <Row label={t('set.account')} hint={`${t('acct.signedAs', { email: account.user.email })} · ${t('acct.synced')}`}>
        <button type="button" className="btn" onClick={() => void internal().invoke('internal:sign-out')}>
          {t('acct.signOut')}
        </button>
      </Row>
    )
  }
  return (
    <Row label={t('set.account')} hint={t('acct.hint')}>
      <button type="button" className="btn btn-primary" onClick={() => void internal().invoke('internal:account-open')}>
        {t('acct.open')}
      </button>
    </Row>
  )
}

function formatSize(bytes: number): string {
  return `${(bytes / 1024 ** 3).toLocaleString(undefined, { maximumFractionDigits: 1 })} GB`
}

function AiRow() {
  const [ai, setAi] = useState<{ status: AiModelStatus; size: number } | null>(null)
  useEffect(() => {
    void internal().invoke('internal:ai').then(setAi)
    return internal().on('ai', (status) => setAi((prev) => (prev ? { ...prev, status } : prev)))
  }, [])
  if (!ai) return null
  const size = formatSize(ai.size)
  const kind = ai.status.kind
  const hint = kind === 'ready' ? t('set.aiReady', { size }) : kind === 'missing' || kind === 'error' ? t('set.aiMissing', { size }) : t('set.aiBusy')
  return (
    <Row label={t('set.aiModel')} hint={hint}>
      {kind === 'ready' && (
        <button type="button" className="btn" onClick={() => void internal().invoke('internal:ai-remove')}>
          {t('set.aiRemove')}
        </button>
      )}
    </Row>
  )
}

function RansomwareRows() {
  const [st, setSt] = useState<RansomwareStatus | null>(null)
  useEffect(() => {
    const load = () => void internal().invoke('internal:ransomware').then(setSt)
    load()
    // the user may have just turned it on in Windows Security
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [])
  if (!st || st.folders === 'unsupported') return null
  const av = st.antivirus.length ? ` (${st.antivirus.join(', ')})` : ''
  const hint =
    st.folders === 'on' ? t('set.ransomOn') : st.folders === 'audit' ? t('set.ransomAudit') : st.folders === 'off' ? t('set.ransomOff') : t('set.ransomUnknown', { av })
  return (
    <>
      <Row label={t('set.ransom')} hint={`${hint} ${t('set.ransomNote')}`}>
        <span className={st.folders === 'on' ? 'perm-allow' : st.folders === 'off' ? 'perm-deny' : ''}>
          {st.folders === 'on' ? '●' : st.folders === 'off' ? '○' : '◐'}
        </span>
        <button type="button" className={st.folders === 'off' ? 'btn btn-primary' : 'btn'} onClick={() => void internal().invoke('internal:open-ransomware')}>
          {t('set.ransomOpen')}
        </button>
      </Row>
      <Row label={t('set.edr')} hint={t('set.edrHint', { av })}>
        {null}
      </Row>
    </>
  )
}

const WIN_STATE: Record<WinSecurityReport['items'][number]['state'], { key: I18nKey; cls: string; dot: string }> = {
  on: { key: 'winsec.on', cls: 'perm-allow', dot: '●' },
  warn: { key: 'winsec.warn', cls: '', dot: '◐' },
  off: { key: 'winsec.off', cls: 'perm-deny', dot: '○' },
  unknown: { key: 'winsec.unknown', cls: '', dot: '–' }
}

/** Windows' own protections: read-only status plus a button to the right Windows Security page. */
function WindowsHealth() {
  const [rep, setRep] = useState<WinSecurityReport | null>(null)
  const [scan, setScan] = useState<'idle' | 'running' | WinScanResult>('idle')
  useEffect(() => {
    const load = () => void internal().invoke('internal:winsec').then(setRep)
    load()
    // the user may have just changed something in Windows Security
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [])
  if (!rep) return <Row label={t('set.winsec')} hint={t('winsec.loading')}>{null}</Row>
  if (!rep.supported) return <Row label={t('set.winsec')} hint={t('winsec.unsupported')}>{null}</Row>
  const other = rep.otherAntivirus.join(', ')
  return (
    <>
      <Row label={t('winsec.intro')} hint={other ? `${t('winsec.introHint')} ${t('winsec.other', { av: other })}` : t('winsec.introHint')}>
        {null}
      </Row>
      {rep.items.map((it) => {
        const st = WIN_STATE[it.state]
        let hint = t(`winsec.${it.id}Hint` as I18nKey)
        if ((it.id === 'signatures' || it.id === 'scan') && it.value != null) hint += ` ${t('winsec.daysAgo', { n: it.value })}`
        if (it.id === 'scan' && it.value == null && it.state !== 'unknown') hint += ` ${t('winsec.never')}`
        return (
          <Row key={it.id} label={t(`winsec.${it.id}` as I18nKey)} hint={hint}>
            <span className={st.cls}>
              {st.dot} {t(st.key)}
            </span>
            {it.state !== 'on' && it.state !== 'unknown' && (
              <button type="button" className={it.state === 'off' ? 'btn btn-primary' : 'btn'} onClick={() => void internal().invoke('internal:open-winsec', it.id)}>
                {t('winsec.open')}
              </button>
            )}
          </Row>
        )
      })}
      <Row
        label={t('winsec.scanLabel')}
        hint={
          scan === 'idle'
            ? t('winsec.scanLabelHint')
            : scan === 'running'
              ? t('winsec.scanning')
              : t(scan === 'clean' ? 'winsec.scanClean' : scan === 'threats' ? 'winsec.scanThreats' : 'winsec.scanUnavailable')
        }
      >
        {scan === 'threats' ? (
          <button type="button" className="btn btn-danger" onClick={() => void internal().invoke('internal:open-winsec', 'scan')}>
            {t('winsec.open')}
          </button>
        ) : (
          <button
            type="button"
            className="btn"
            disabled={scan === 'running'}
            onClick={async () => {
              setScan('running')
              const result = await internal().invoke('internal:quick-scan')
              setScan(result)
              setRep(await internal().invoke('internal:winsec'))
            }}
          >
            {scan === 'running' ? <span className="spinner" style={{ width: 14, height: 14 }} /> : t('winsec.scanNow')}
          </button>
        )}
      </Row>
    </>
  )
}

function Permissions() {
  const [list, setList] = useState<{ origin: string; permission: string; decision: 'allow' | 'deny' }[]>([])
  const load = () => void internal().invoke('internal:permissions').then(setList)
  useEffect(load, [])
  if (list.length === 0) return null
  return (
    <Row label={t('set.perms')} hint={t('set.permsHint')}>
      <ul className="perm-list">
        {list.map((p) => (
          <li key={p.origin + p.permission}>
            <span className="perm-origin">{p.origin.replace(/^https?:\/\//, '')}</span>
            <span className={p.decision === 'allow' ? 'perm-allow' : 'perm-deny'}>
              {permissionName(p.permission)}: {p.decision === 'allow' ? t('set.allowed') : t('set.blocked')}
            </span>
            <button
              type="button"
              className="link-btn"
              onClick={async () => {
                await internal().invoke('internal:permission-remove', p.origin, p.permission)
                load()
              }}
            >
              {t('common.remove')}
            </button>
          </li>
        ))}
      </ul>
    </Row>
  )
}

function ClearData() {
  const [what, setWhat] = useState({ history: true, cache: true, cookies: false })
  const [done, setDone] = useState(false)
  return (
    <Row label={t('set.clear')} hint={t('set.clearHint')}>
      <div className="clear-data">
        <label className="check">
          <input type="checkbox" checked={what.history} onChange={(e) => setWhat({ ...what, history: e.target.checked })} /> {t('set.clearHistory')}
        </label>
        <label className="check">
          <input type="checkbox" checked={what.cache} onChange={(e) => setWhat({ ...what, cache: e.target.checked })} /> {t('set.clearCache')}
        </label>
        <label className="check">
          <input type="checkbox" checked={what.cookies} onChange={(e) => setWhat({ ...what, cookies: e.target.checked })} /> {t('set.clearCookies')}
        </label>
        <button
          type="button"
          className="btn"
          disabled={!what.history && !what.cache && !what.cookies}
          onClick={async () => {
            await internal().invoke('internal:clear-data', what)
            setDone(true)
            setTimeout(() => setDone(false), 2500)
          }}
        >
          {done ? t('set.cleared') : t('set.clearBtn')}
        </button>
      </div>
    </Row>
  )
}

function About({ onWelcome }: { onWelcome: () => void }) {
  const [v, setV] = useState<{ app: string; electron: string; chrome: string; node: string } | null>(null)
  useEffect(() => void internal().invoke('internal:version').then(setV), [])
  return (
    <div className="about">
      <p className="about-name">
        {BRAND} {v?.app}
      </p>
      <p className="setting-hint">{t('set.engineInfo', { chrome: v?.chrome ?? '', electron: v?.electron ?? '' })}</p>
      <UpdateRow />
      <p className="about-links">
        {(['privacy', 'terms', 'licenses'] as const).map((doc) => (
          <button key={doc} type="button" className="link-btn" onClick={() => void internal().invoke('internal:open-legal', doc)}>
            {t(`legal.${doc}` as I18nKey)}
          </button>
        ))}
      </p>
      <button type="button" className="link-btn" onClick={onWelcome}>
        {t('set.welcomeAgain')}
      </button>
    </div>
  )
}

/** Automatic updates (GitHub Releases). */
function UpdateRow() {
  const [st, setSt] = useState<UpdateState | null>(null)
  useEffect(() => {
    void internal().invoke('internal:update').then(setSt)
    return internal().on('update', setSt)
  }, [])
  if (!st) return null
  const text: Record<UpdateState['status'], string> = {
    disabled: t('upd.disabled'),
    idle: t('upd.idle'),
    checking: t('upd.checking'),
    latest: t('upd.latest'),
    available: t('upd.available', { version: st.version ?? '' }),
    downloading: t('upd.downloading', { version: st.version ?? '', percent: st.percent ?? 0 }),
    ready: t('upd.ready', { version: st.version ?? '' }),
    error: t('upd.error')
  }
  const busy = st.status === 'checking' || st.status === 'downloading'
  const action =
    st.status === 'ready' ? (st.portable ? t('upd.download') : t('upd.restart')) : st.status === 'available' ? t('upd.download') : t('upd.check')
  return (
    <div className="update-row">
      <p className="setting-hint">{text[st.status]}</p>
      {st.status !== 'disabled' && (
        <button
          type="button"
          className={st.status === 'ready' || st.status === 'available' ? 'btn btn-primary' : 'btn'}
          disabled={busy}
          onClick={async () => {
            if (st.status === 'ready' || st.status === 'available') await internal().invoke('internal:update-install')
            else setSt(await internal().invoke('internal:update-check'))
          }}
        >
          {busy ? <span className="spinner" style={{ width: 14, height: 14 }} /> : action}
        </button>
      )}
    </div>
  )
}
