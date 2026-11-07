import { useEffect, useState, type ReactNode } from 'react'
import { Check, Copy, Loader2 } from 'lucide-react'
import { t } from '@/lib/i18n'

// Small pieces shared by every Halyard Lab tool.

export const cls = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function CopyBtn({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  useEffect(() => setDone(false), [text])
  return (
    <button
      type="button"
      className={cls('lab-btn', !label && 'is-icon')}
      aria-label={label ?? t('lab.copy')}
      title={label ?? t('lab.copy')}
      disabled={!text}
      onClick={() => void navigator.clipboard.writeText(text).then(() => setDone(true))}
    >
      {done ? <Check size={14} /> : <Copy size={14} />}
      {label && <span>{label}</span>}
    </button>
  )
}

export function Mono({ children }: { children: ReactNode }) {
  return <code className="lab-mono">{children}</code>
}

export function Err({ text }: { text: string | null }) {
  return text ? <p className="lab-error">{text}</p> : null
}

export function Busy({ label }: { label: string }) {
  return (
    <p className="lab-busy">
      <Loader2 size={16} className="spin" /> {label}
    </p>
  )
}

