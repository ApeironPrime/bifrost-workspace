import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Homepage from './features/homepage/Homepage.tsx'
import { initGlobalErrorTelemetry } from './lib/telemetry'
import { AppErrorBoundary } from './shared/components/AppErrorBoundary'
import './shared/components/PopoverMotion.css'

initGlobalErrorTelemetry()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <Homepage />
    </AppErrorBoundary>
  </StrictMode>,
)
