import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@/app/App'
import { configurePdfJsWorker } from '@/lib/pdf'
import '@/styles/global.css'

configurePdfJsWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
