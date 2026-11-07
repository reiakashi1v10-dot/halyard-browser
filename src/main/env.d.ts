// Build-time values from .env (see .env.example). Only MAIN_VITE_* reach the main process.
interface ImportMetaEnv {
  readonly MAIN_VITE_SUPABASE_URL?: string
  readonly MAIN_VITE_SUPABASE_PUBLISHABLE_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
