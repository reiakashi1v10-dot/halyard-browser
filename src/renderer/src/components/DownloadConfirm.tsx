import { useEffect, useRef, type ReactNode } from 'react'
import { Disc3, Download, File, FileArchive, FileCode2, FileText, FolderOpen, Globe, Package, ShieldCheck, ShieldAlert } from 'lucide-react'
import type { DownloadKind, DownloadRequest } from '@shared/types'
import { ui } from '@/lib/api'
import { useStore } from '@/lib/store'
import { rich, t, type I18nKey } from '@/lib/i18n'
import { formatBytes } from './bits'

const KIND_ICON: Record<DownloadKind, ReactNode> = {
  program: <Package size={22} />,
  archive: <FileArchive size={22} />,
  script: <FileCode2 size={22} />,
  disk: <Disc3 size={22} />,
  document: <FileText size={22} />,
  other: <File size={22} />
}

const CODE = new Set<DownloadKind>(['program', 'script', 'archive', 'disk'])

/** Halyard's own "are you sure?" for files that can run code. Cancel is the safe default. */
export function DownloadConfirm({ request, queued }: { request: DownloadRequest; queued: number }) {
  const cancelBtn = useRef<HTMLButtonElement>(null)

  const decide = (ok: boolean) => {
    useStore.setState((s) => ({ confirms: s.confirms.filter((c) => c.id !== request.id) }))
    void ui().invoke('download:decide', request.id, ok)
  }

  useEffect(() => {
    cancelBtn.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        decide(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [request.id])

  const source = request.source || t('dlc.internet')

  return (
    <div className="modal-backdrop dlc-backdrop">
      <div className="modal dlc" role="alertdialog" aria-modal="true" aria-labelledby="dlc-title" aria-describedby="dlc-body">
        <div className="dlc-glow" aria-hidden />
        <div className="dlc-badge" aria-hidden>
          <ShieldAlert size={26} strokeWidth={1.8} />
        </div>
        <h2 id="dlc-title" className="dlc-title">
          {request.unprompted ? t('dlc.autoTitle') : t('dlc.title')}
        </h2>

        <div className="dlc-file">
          <span className="dlc-file-icon">{KIND_ICON[request.kind]}</span>
          <span className="dlc-file-text">
            <span className="dlc-file-name" title={request.filename}>
              {request.filename}
            </span>
            <span className="dlc-file-meta">
              <span className="dlc-chip">{t(`dlc.kind.${request.kind}` as I18nKey)}</span>
              <span>{request.size > 0 ? formatBytes(request.size) : t('dlc.unknownSize')}</span>
              {request.source && (
                <span className="dlc-source">
                  <Globe size={12} /> {request.source}
                </span>
              )}
            </span>
          </span>
        </div>

        {request.deceptive && <p className="dlc-deceptive">{t('dlc.deceptive')}</p>}

        <p id="dlc-body" className="dlc-body">
          {request.unprompted ? (
            <>
              {rich('dlc.autoBody', { source })} {t('dlc.autoAdvice')}
            </>
          ) : (
            <>
              {rich('dlc.body', { source })} {t('dlc.advice')}
            </>
          )}
        </p>

        {(!request.unprompted || CODE.has(request.kind)) && (
        <>
        <ol className="dlc-steps" aria-label={t('dlc.steps')}>
          <li>
            <span className="dlc-step-icon">
              <Download size={14} />
            </span>
            {t('dlc.step1')}
          </li>
          <li className="is-key">
            <span className="dlc-step-icon">
              <ShieldCheck size={14} />
            </span>
            {t('dlc.step2')}
          </li>
          <li>
            <span className="dlc-step-icon">
              <FolderOpen size={14} />
            </span>
            {t('dlc.step3')}
          </li>
        </ol>
        <p className="dlc-hint">{t('dlc.steps')}</p>
        </>
        )}

        <div className="modal-actions">
          {queued > 0 && <span className="dlc-queue">+{queued}</span>}
          <span className="grow" />
          <button ref={cancelBtn} type="button" className="btn" onClick={() => decide(false)}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => decide(true)}>
            <ShieldCheck size={14} /> {request.unprompted && !CODE.has(request.kind) ? t('dlc.autoConfirm') : t('dlc.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
