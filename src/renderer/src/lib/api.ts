import type { InternalApi, LabApi, UiApi } from '@shared/ipc'
import type { AiModelStatus, Settings, UiEvents, UpdateState } from '@shared/types'

type Invoke<Api> = <K extends keyof Api>(
  channel: K,
  ...args: Api[K] extends (...a: infer A) => unknown ? A : never
) => Promise<Api[K] extends (...a: never[]) => infer R ? Awaited<R> : never>

interface Bridge<Api, Events> {
  invoke: Invoke<Api>
  on<K extends keyof Events>(event: K, cb: (payload: Events[K]) => void): () => void
}

declare global {
  interface Window {
    halyard: Bridge<UiApi, UiEvents> & { platform: string }
    halyardLab: { invoke: Invoke<LabApi>; onSettings(cb: () => void): () => void; pathForFile(file: File): string; platform: string }
    halyardInternal: Bridge<InternalApi, { settings: Settings; downloads: UiEvents['downloads']; account: UiEvents['account']; ai: AiModelStatus; update: UpdateState }>
  }
}

export const ui = (): Window['halyard'] => window.halyard
export const internal = (): Window['halyardInternal'] => window.halyardInternal
export const lab = (): Window['halyardLab'] => window.halyardLab
