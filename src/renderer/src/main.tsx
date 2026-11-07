import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/onest'
import '@fontsource-variable/bricolage-grotesque'
import './styles/chrome.css'
import { App } from './App'

document.documentElement.dataset.platform = window.halyard.platform

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
