import { useState } from 'react'
import { BifrostMark } from '../homepage/components/UI'
import { translateLanding, type Language } from '../i18n/landing'
import { remainingWorkspaceTransitionDelay } from '../lib/delayedLoading'
import { useDelayedLoading } from '../lib/useDelayedLoading'
import './WorkspaceLoadingScreen.css'

export interface WorkspaceLoadingScreenProps {
  phase: 'initializing' | 'session'
  lang: Language
  theme: 'light' | 'dark'
}

/**
 * Shared botanical loading surface across lazy chunk loading (Suspense) and
 * session restoration (!authReady) so transitions share one visual shell and
 * expose an intentional, state-owned path back to the public Homepage.
 */
export function WorkspaceLoadingScreen({ phase, lang, theme }: WorkspaceLoadingScreenProps) {
  const [initialDelayMs] = useState(() => remainingWorkspaceTransitionDelay())
  const showVisual = useDelayedLoading(true, initialDelayMs)

  const statusLabel =
    phase === 'session'
      ? translateLanding(lang, 'loading.checkingSession')
      : translateLanding(lang, 'loading.initializing')

  const returnLabel = translateLanding(lang, 'loading.returnHome')

  return (
    <main
      className="workspace-loading"
      data-theme={theme}
      data-loading-phase={phase}
      aria-busy="true"
    >
      {showVisual && (
        <section className="workspace-loading-panel">
          <div className="workspace-loading-brand">
            <BifrostMark size={32} />
            <span>Bifrost</span>
          </div>
          <p className="workspace-loading-eyebrow">
            {translateLanding(lang, 'loading.eyebrow')}
          </p>
          <div className="workspace-loading-status" role="status">
            <span className="workspace-loading-indicator" aria-hidden="true" />
            <p>{statusLabel}</p>
          </div>
          <div className="workspace-loading-footer">
            <a className="homepage-return" href="#top">
              <span aria-hidden="true">←</span>
              <span>{returnLabel}</span>
            </a>
          </div>
        </section>
      )}
    </main>
  )
}
