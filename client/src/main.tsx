import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Homepage from './features/homepage/Homepage.tsx'
import './shared/components/PopoverMotion.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Homepage />
  </StrictMode>,
)
