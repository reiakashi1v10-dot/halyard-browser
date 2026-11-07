import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Check, Cpu, Eraser, Lock, Sparkles, Square, TriangleAlert, X } from 'lucide-react'
import type { AgentEntry, AgentState } from '@shared/types'
import { ui } from '@/lib/api'
import { useStore } from '@/lib/store'
import { t, type I18nKey } from '@/lib/i18n'
import { cls, formatBytes, IconButton } from './bits'
import { duration } from './Panels'

/** The local AI assistant, docked to the right of the page so the page stays live while it works. */
export function AgentPanel() {
  const agent = useStore((s) => s.agent)
  const close = () => useStore.setState({ agentOpen: false })
  return (
    <aside className="agent-panel" aria-label={t('agent.title')}>
      <header className="agent-head">
        <Sparkles size={16} className="agent-logo" />
        <h2>{t('agent.title')}</h2>
        {agent && agent.entries.length > 0 && !agent.running && (
          <IconButton label={t('agent.clear')} onClick={() => void ui().invoke('agent:clear')}>
            <Eraser size={15} />
          </IconButton>
        )}
        <IconButton label={t('agent.close')} onClick={close}>
          <X size={16} />
        </IconButton>
      </header>
      {!agent ? null : agent.model.kind === 'ready' || agent.model.kind === 'loading' ? <Chat agent={agent} /> : <Setup agent={agent} />}
    </aside>
  )
}

function Setup({ agent }: { agent: AgentState }) {
  const m = agent.model
  const size = formatBytes(agent.modelSize)
  return (
    <div className="agent-setup">
      <div className="agent-setup-icon">
        <Sparkles size={26} />
      </div>
      <h3>{t('agent.setupTitle')}</h3>
      <p>{t('agent.setupBody', { size })}</p>
      <p className="agent-muted">
        <Lock size={12} /> {t('agent.local')}
      </p>
      {m.kind === 'missing' && (
        <>
          <button type="button" className="btn btn-primary" onClick={() => void ui().invoke('agent:download')}>
            {m.partial > 0 ? t('agent.resume') : t('agent.download')}
          </button>
          <p className="agent-muted">{t('agent.setupNeeds')}</p>
        </>
      )}
      {m.kind === 'downloading' && (
        <div className="agent-progress">
          <span>{t('agent.downloading', { done: formatBytes(m.received), total: formatBytes(m.total) })}</span>
          <span className="dl-bar">
            <span style={{ width: `${Math.min(100, (m.received / m.total) * 100)}%` }} />
          </span>
          {m.speed > 0 && (
            <span className="agent-muted">{t('agent.left', { speed: formatBytes(m.speed), time: duration((m.total - m.received) / m.speed) })}</span>
          )}
          <button type="button" className="btn" onClick={() => void ui().invoke('agent:cancel-download')}>
            {t('agent.cancel')}
          </button>
        </div>
      )}
      {m.kind === 'verifying' && (
        <p className="agent-wait">
          <span className="spinner" /> {t('agent.verifying')}
        </p>
      )}
      {m.kind === 'error' && (
        <>
          <p className="agent-alert">
            <TriangleAlert size={14} /> {t(`agent.err.${m.error}` as I18nKey, { size })}
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void ui().invoke(m.error === 'engine' ? 'agent:retry' : 'agent:download')}
          >
            {t('agent.retry')}
          </button>
        </>
      )}
    </div>
  )
}

const EXAMPLES: I18nKey[] = ['agent.ex1', 'agent.ex2', 'agent.ex3']

function Chat({ agent }: { agent: AgentState }) {
  const [goal, setGoal] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  const list = useRef<HTMLOListElement>(null)
  const focus = useStore((s) => s.agentFocus)

  useEffect(() => input.current?.focus(), [focus])
  useEffect(() => {
    list.current?.lastElementChild?.scrollIntoView({ block: 'end' })
  }, [agent.entries.length, agent.thinking, agent.confirm?.id])

  const send = (text: string) => {
    const g = text.trim()
    if (!g || agent.running) return
    void ui().invoke('agent:run', g)
    setGoal('')
  }

  return (
    <>
      <ol className="agent-log" ref={list}>
        {agent.entries.length === 0 && (
          <li className="agent-intro">
            <p>{t('agent.hello')}</p>
            <div className="agent-examples">
              {EXAMPLES.map((key) => (
                <button key={key} type="button" onClick={() => send(t(key))}>
                  {t(key)}
                </button>
              ))}
            </div>
            <p className="agent-muted">
              <Lock size={12} /> {t('agent.safety')}
            </p>
          </li>
        )}
        {agent.entries.map((e) => (
          <Entry key={e.id} entry={e} />
        ))}
        {agent.model.kind === 'loading' && agent.running && (
          <li className="agent-wait">
            <span className="spinner" /> {t('agent.loading')}
          </li>
        )}
        {agent.thinking && agent.model.kind !== 'loading' && (
          <li className="agent-wait">
            <span className="spinner" /> {t('agent.thinking')}
          </li>
        )}
        {agent.confirm && (
          <li className="agent-confirm" role="alertdialog" aria-label={t('agent.confirmTitle')}>
            <strong>{t('agent.confirmTitle')}</strong>
            <p>{agent.confirm.text}</p>
            <div className="agent-confirm-actions">
              <button type="button" className="btn btn-primary" onClick={() => void ui().invoke('agent:confirm', agent.confirm!.id, true)}>
                {t('agent.allow')}
              </button>
              <button type="button" className="btn" onClick={() => void ui().invoke('agent:confirm', agent.confirm!.id, false)}>
                {t('agent.deny')}
              </button>
            </div>
          </li>
        )}
      </ol>
      <form
        className="agent-input"
        onSubmit={(e) => {
          e.preventDefault()
          send(goal)
        }}
      >
        <textarea
          ref={input}
          value={goal}
          rows={2}
          maxLength={1000}
          placeholder={t('agent.placeholder')}
          disabled={agent.running}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send(goal)
            }
          }}
        />
        {agent.running ? (
          <IconButton label={t('agent.stop')} className="agent-send is-stop" onClick={() => void ui().invoke('agent:stop')}>
            <Square size={13} fill="currentColor" />
          </IconButton>
        ) : (
          <IconButton label={t('agent.send')} className="agent-send" type="submit" disabled={!goal.trim()}>
            <ArrowUp size={16} />
          </IconButton>
        )}
      </form>
      {agent.model.kind === 'ready' && agent.model.gpu && (
        <p className="agent-foot">
          <Cpu size={11} /> {agent.model.gpu === 'gpu' ? t('agent.gpu') : t('agent.cpu')}
        </p>
      )}
    </>
  )
}

function Entry({ entry }: { entry: AgentEntry }) {
  switch (entry.kind) {
    case 'goal':
      return <li className="agent-goal">{entry.text}</li>
    case 'answer':
      return <li className="agent-answer">{entry.text}</li>
    case 'error':
      return (
        <li className="agent-note is-error">
          <TriangleAlert size={13} /> {entry.text}
        </li>
      )
    case 'info':
      return <li className="agent-note">{entry.text}</li>
    case 'step':
      return (
        <li className={cls('agent-step', entry.ok === false && 'is-failed')}>
          {entry.ok === false ? <X size={13} className="agent-step-icon" /> : <Check size={13} className="agent-step-icon" />}
          <span>
            {entry.text}
            {entry.note && <small>{entry.note}</small>}
          </span>
        </li>
      )
  }
}
