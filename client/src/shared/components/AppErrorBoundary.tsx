import { Component, type ErrorInfo, type ReactNode } from 'react'
import { createT, getInitialLanguage } from '../../i18n'
import { reportClientError } from '../../lib/telemetry'

type Props = {
  children: ReactNode
}

type State = {
  hasError: boolean
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportClientError(
      'react-boundary',
      error.message || 'React render error',
      `${error.stack ?? ''}\n${info.componentStack ?? ''}`.trim(),
    )
  }

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children
    }

    const t = createT(getInitialLanguage())
    return (
      <main
        style={{
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          padding: '24px',
          background: 'var(--bg-page, #f5f3ec)',
          color: 'var(--text-main, #22231e)',
        }}
      >
        <section
          role="alert"
          style={{
            maxWidth: '460px',
            width: '100%',
            padding: '28px',
            borderRadius: '14px',
            border: '1px solid var(--border-subtle, #d8d4c7)',
            background: 'var(--bg-surface, #fff)',
            display: 'grid',
            gap: '12px',
          }}
        >
          <h1 style={{ margin: 0, fontSize: '1.25rem' }}>{t('errors.boundary.title')}</h1>
          <p style={{ margin: 0, lineHeight: 1.5 }}>{t('errors.boundary.description')}</p>
          <div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => window.location.reload()}
            >
              {t('errors.boundary.reloadButton')}
            </button>
          </div>
        </section>
      </main>
    )
  }
}
