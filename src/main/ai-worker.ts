/*
 * Runs the local language model in its own (utility) process: a heavy or crashing model
 * can never freeze or take down the browser. It only talks to the main process, through
 * parentPort, and never touches the network.
 */
import type { Llama, LlamaChatSession, LlamaContext, LlamaJsonSchemaGrammar, LlamaModel } from 'node-llama-cpp'

export type WorkerRequest =
  | { type: 'load'; path: string }
  | { type: 'run'; id: number; system: string; prompt: string; schema: object; maxTokens: number }
  | { type: 'abort'; id: number }

export type WorkerReply =
  | { type: 'loaded'; gpu: string | false }
  | { type: 'result'; id: number; text: string }
  | { type: 'error'; id?: number; message: string }

const port = process.parentPort
const post = (msg: WorkerReply): void => port.postMessage(msg)

let llama: Llama | null = null
let model: LlamaModel | null = null
let context: LlamaContext | null = null
let session: LlamaChatSession | null = null
const grammars = new Map<string, LlamaJsonSchemaGrammar<never>>()
const aborts = new Map<number, AbortController>()
// one generation at a time: the model has a single context sequence
let queue: Promise<unknown> = Promise.resolve()

async function load(path: string): Promise<void> {
  const lib = await import('node-llama-cpp')
  // Vulkan runs on NVIDIA, AMD and Intel graphics; without it, the processor does the work.
  for (const gpu of ['vulkan', false] as const) {
    try {
      llama = await lib.getLlama({ gpu, build: 'never', skipDownload: true, progressLogs: false, logLevel: lib.LlamaLogLevel.error })
      break
    } catch {
      llama = null
    }
  }
  if (!llama) throw new Error('no usable llama.cpp binary')
  model = await llama.loadModel({ modelPath: path })
  context = await model.createContext({ contextSize: { min: 4096, max: 8192 } })
  session = new lib.LlamaChatSession({ contextSequence: context.getSequence() })
  post({ type: 'loaded', gpu: llama.gpu })
}

async function run(req: Extract<WorkerRequest, { type: 'run' }>): Promise<void> {
  if (!llama || !session) throw new Error('model not loaded')
  const key = JSON.stringify(req.schema)
  let grammar = grammars.get(key)
  if (!grammar) {
    grammar = (await llama.createGrammarForJsonSchema(req.schema as never)) as LlamaJsonSchemaGrammar<never>
    grammars.set(key, grammar)
  }
  const ac = new AbortController()
  aborts.set(req.id, ac)
  try {
    // every step is a fresh, self-contained prompt: no hidden state between steps
    session.setChatHistory([{ type: 'system', text: req.system }])
    const text = await session.prompt(req.prompt, {
      grammar,
      maxTokens: req.maxTokens,
      temperature: 0.2,
      signal: ac.signal
    })
    post({ type: 'result', id: req.id, text })
  } finally {
    aborts.delete(req.id)
  }
}

port.on('message', (event: { data: WorkerRequest }) => {
  const msg = event.data
  if (!msg || typeof msg !== 'object') return
  if (msg.type === 'abort') {
    aborts.get(msg.id)?.abort()
    return
  }
  const job = msg.type === 'load' ? () => load(msg.path) : msg.type === 'run' ? () => run(msg) : null
  if (!job) return
  const id = msg.type === 'run' ? msg.id : undefined
  queue = queue
    .then(job)
    .catch((err: unknown) => post({ type: 'error', id, message: err instanceof Error ? err.message : String(err) }))
})
