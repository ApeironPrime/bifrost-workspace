import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  createDelayedLoadingController,
  DEFAULT_LOADING_DELAY_MS,
} from '../../lib/delayedLoading'

/**
 * Shows loading UI only after `active` remains true for `delayMs` (~150ms),
 * clearing immediately on resolution, empty state, error, or unmount.
 */
export function useDelayedLoading(
  active: boolean,
  delayMs = DEFAULT_LOADING_DELAY_MS,
): boolean {
  const [controller] = useState(() => createDelayedLoadingController({ delayMs }))

  useEffect(() => {
    controller.setActive(active, delayMs)
    return () => {
      controller.setActive(false)
    }
  }, [controller, active, delayMs])

  const delayedVisible = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    () => false,
  )

  return active && delayedVisible
}
