export const DEFAULT_LOADING_DELAY_MS = 150

type TimerHandle = ReturnType<typeof setTimeout>
type ScheduleFn = (callback: () => void, delayMs: number) => TimerHandle
type CancelFn = (handle: TimerHandle) => void

export interface DelayedLoadingOptions {
  delayMs?: number
  schedule?: ScheduleFn
  cancel?: CancelFn
}

export interface DelayedLoadingController {
  getSnapshot: () => boolean
  subscribe: (listener: () => void) => () => void
  setActive: (nextActive: boolean, delayOverrideMs?: number) => void
  dispose: () => void
}

/**
 * Delays visibility of loading decoration until a pending operation crosses the
 * flash threshold, while hiding immediately once loading ends, empties, or fails.
 */
export function createDelayedLoadingController(
  options: DelayedLoadingOptions = {},
): DelayedLoadingController {
  const defaultDelayMs = Math.max(0, options.delayMs ?? DEFAULT_LOADING_DELAY_MS)
  const schedule: ScheduleFn = options.schedule ?? ((cb, ms) => globalThis.setTimeout(cb, ms))
  const cancel: CancelFn = options.cancel ?? ((id) => globalThis.clearTimeout(id))

  let active = false
  let visible = false
  let disposed = false
  let timer: TimerHandle | null = null
  const listeners = new Set<() => void>()

  const notify = () => {
    listeners.forEach((listener) => listener())
  }

  const clearPendingTimer = () => {
    if (timer !== null) {
      cancel(timer)
      timer = null
    }
  }

  return {
    getSnapshot: () => visible,
    subscribe: (listener) => {
      if (disposed) return () => {}
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setActive: (nextActive, delayOverrideMs) => {
      if (disposed) return
      if (!nextActive) {
        active = false
        clearPendingTimer()
        if (visible) {
          visible = false
          notify()
        }
        return
      }

      if (active) return
      active = true
      const effectiveDelay = Math.max(0, delayOverrideMs ?? defaultDelayMs)

      if (effectiveDelay === 0) {
        clearPendingTimer()
        if (!visible) {
          visible = true
          notify()
        }
        return
      }

      clearPendingTimer()
      timer = schedule(() => {
        timer = null
        if (disposed || !active) return
        if (!visible) {
          visible = true
          notify()
        }
      }, effectiveDelay)
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      active = false
      visible = false
      clearPendingTimer()
      listeners.clear()
    },
  }
}

let workspaceTransitionStartedAt: number | null = null

/** Records when entry into #workspace began so Suspense and !authReady share one delay budget. */
export function beginWorkspaceTransition(now = Date.now()): void {
  if (workspaceTransitionStartedAt === null) {
    workspaceTransitionStartedAt = now
  }
}

/** Clears the shared transition timer once the user leaves #workspace or finishes initializing. */
export function resetWorkspaceTransition(): void {
  workspaceTransitionStartedAt = null
}

/** Computes remaining delay before showing full-screen initialization UI. */
export function remainingWorkspaceTransitionDelay(
  delayMs = DEFAULT_LOADING_DELAY_MS,
  now = Date.now(),
): number {
  if (delayMs <= 0) return 0
  if (workspaceTransitionStartedAt === null) return delayMs
  const elapsed = Math.max(0, now - workspaceTransitionStartedAt)
  return Math.max(0, delayMs - elapsed)
}

export function resolvePreferredTheme(): 'light' | 'dark' {
  try {
    const saved = localStorage.getItem('bifrost_theme')
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    /* Storage access is optional. */
  }
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}
