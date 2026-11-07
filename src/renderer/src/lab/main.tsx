import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/onest'
import '@fontsource-variable/bricolage-grotesque'
import '../styles/lab.css'
import { Lab } from './Lab'

document.documentElement.dataset.platform = window.halyardLab.platform

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Lab />
  </StrictMode>
)
