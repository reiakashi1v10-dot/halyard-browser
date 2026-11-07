import { resolve } from 'node:path'
import { defineConfig, loadEnv } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Strict CSP only in production builds: the dev server needs inline scripts for HMR.
function cspPlugin(): Plugin {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https: http: halyard:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'"
  ].join('; ')
  return {
    name: 'halyard-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`)
  }
}

const shared = { '@shared': resolve('src/shared') }

// The app may only ship Supabase's *publishable* key: a secret / service_role key bypasses
// row-level security and anyone could pull it out of the .exe. Stop the build if one is set.
function checkSupabaseKey(): void {
  for (const mode of ['development', 'production']) {
    const key = (loadEnv(mode, process.cwd(), 'MAIN_VITE_').MAIN_VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim()
    if (!key) continue
    let role: unknown = null
    const parts = key.split('.')
    if (parts.length === 3) {
      try {
        role = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).role
      } catch {
        role = null
      }
    }
    const ok = key.startsWith('sb_publishable_') || role === 'anon'
    if (!ok) throw new Error('MAIN_VITE_SUPABASE_PUBLISHABLE_KEY is not a publishable key. Never put the secret/service_role key in the app.')
  }
}
checkSupabaseKey()

export default defineConfig({
  main: {
    resolve: { alias: shared },
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts'), 'ai-worker': resolve('src/main/ai-worker.ts') } } }
  },
  preload: {
    resolve: { alias: shared },
    build: {
      // sandboxed preloads can't require sibling chunks: each one must be standalone
      isolatedEntries: true,
      externalizeDeps: false,
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          internal: resolve('src/preload/internal.ts'),
          lab: resolve('src/preload/lab.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    base: './',
    resolve: { alias: { ...shared, '@': resolve('src/renderer/src') } },
    plugins: [react(), cspPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          internal: resolve('src/renderer/internal.html'),
          lab: resolve('src/renderer/lab.html')
        }
      }
    }
  }
})
