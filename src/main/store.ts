import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const pending = new Set<JsonStore<unknown>>()

/**
 * Small JSON file store. Reads once, keeps data in memory and writes atomically
 * (temp file + rename) on a short debounce so bursts of changes cost one write.
 */
export class JsonStore<T> {
  private data: T
  private timer: NodeJS.Timeout | null = null
  readonly file: string

  constructor(name: string, defaults: T, private readonly delay = 400) {
    const dir = app.getPath('userData')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.file = join(dir, `${name}.json`)
    this.data = this.read(defaults)
  }

  private read(defaults: T): T {
    try {
      if (!existsSync(this.file)) return structuredClone(defaults)
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as T
      if (isPlainObject(defaults) && isPlainObject(parsed)) return { ...defaults, ...parsed }
      return parsed ?? structuredClone(defaults)
    } catch (err) {
      console.error(`[store] ${this.file} ilegível, usando padrão:`, err)
      return structuredClone(defaults)
    }
  }

  get(): T {
    return this.data
  }

  set(next: T): void {
    this.data = next
    this.schedule()
  }

  update(fn: (current: T) => T): T {
    this.set(fn(this.data))
    return this.data
  }

  private schedule(): void {
    pending.add(this as JsonStore<unknown>)
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), this.delay)
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    pending.delete(this as JsonStore<unknown>)
    try {
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.data))
      renameSync(tmp, this.file)
    } catch (err) {
      console.error(`[store] falha ao salvar ${this.file}:`, err)
    }
  }
}

/** Write everything that is still waiting on its debounce (used on quit). */
export function flushAllStores(): void {
  for (const store of [...pending]) store.flush()
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
