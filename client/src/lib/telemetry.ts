import { apiUrl } from './appApi'

export type ClientErrorKind = 'error' | 'unhandledrejection' | 'react-boundary' | 'webrtc'

const recentErrorTimestamps = new Map<string, number>()
let telemetryInitialized = false

function redactUrl(rawUrl: string): string {
  return rawUrl
    .replace(/#(invite|verify_email|reset_token)=[^\s&]+/gi, '#$1=[REDACTED]')
    .slice(0, 500)
}

export function reportClientError(
  kind: ClientErrorKind,
  rawMessage: string,
  rawStack?: string,
): void {
  if (typeof window === 'undefined') return
  const message = (rawMessage || 'Unknown client error').slice(0, 1000)
  const dedupeKey = `${kind}:${message}`
  const now = Date.now()
  const lastSeen = recentErrorTimestamps.get(dedupeKey) ?? 0
  if (now - lastSeen < 10_000) return
  recentErrorTimestamps.set(dedupeKey, now)

  if (import.meta.env.VITE_DATA_MODE !== 'api' && !import.meta.env.VITE_API_URL) {
    return
  }

  try {
    void fetch(apiUrl('/telemetry/errors'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        kind,
        message,
        stack: rawStack ? rawStack.slice(0, 4000) : undefined,
        url: redactUrl(window.location.href),
      }),
    }).catch(() => {
      // Best-effort telemetry; never throw.
    })
  } catch {
    // Ignore transport unavailability.
  }
}

export function initGlobalErrorTelemetry(): void {
  if (typeof window === 'undefined' || telemetryInitialized) return
  telemetryInitialized = true

  window.addEventListener('error', (event) => {
    const stack = event.error instanceof Error ? event.error.stack : undefined
    reportClientError('error', event.message || 'Unhandled window error', stack)
  })

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : 'Unhandled promise rejection'
    const stack = reason instanceof Error ? reason.stack : undefined
    reportClientError('unhandledrejection', message, stack)
  })
}
