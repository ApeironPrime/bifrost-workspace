import { useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'
import type { SlideDirection } from '../../../lib/tabDirection'

/** Snapshot only the chosen content region, not the app chrome. A superseded callback
 * must not restore an older tab when several clicks arrive during capture. */
export function useTabTransition(viewportSelector = '.room-tabs-viewport') {
  const running = useRef<ViewTransition | null>(null)
  const generation = useRef(0)
  const fallbackTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => {
    generation.current++
    running.current?.skipTransition()
    window.clearTimeout(fallbackTimer.current)
    document.querySelector(viewportSelector)?.removeAttribute('data-snapshot-transition')
    if (viewportSelector === '.room-tabs-viewport') document.documentElement.removeAttribute('data-room-slide')
  }, [viewportSelector])

  const run = (update: () => void, direction?: SlideDirection) => {
    const ticket = ++generation.current
    running.current?.skipTransition()
    window.clearTimeout(fallbackTimer.current)
    const viewport = document.querySelector<HTMLElement>(viewportSelector)
    viewport?.removeAttribute('data-slide-direction')
    viewport?.querySelectorAll('[data-slide-leaving]').forEach(pane => pane.removeAttribute('data-slide-leaving'))
    if (!viewport || !document.startViewTransition || document.visibilityState === 'hidden' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      running.current = null
      viewport?.removeAttribute('data-snapshot-transition')
      if (direction) document.documentElement.removeAttribute('data-room-slide')
      if (direction && viewport && !window.matchMedia('(prefers-reduced-motion: reduce)').matches && document.visibilityState !== 'hidden') {
        viewport.setAttribute('data-slide-direction', direction)
        viewport.querySelector('.tab-pane.active')?.setAttribute('data-slide-leaving', '')
        fallbackTimer.current = window.setTimeout(() => {
          if (ticket !== generation.current) return
          viewport.removeAttribute('data-slide-direction')
          viewport.querySelectorAll('[data-slide-leaving]').forEach(pane => pane.removeAttribute('data-slide-leaving'))
        }, 380)
      }
      flushSync(update)
      return
    }

    // Snapshots own the scene; never animate live panes underneath them.
    viewport.setAttribute('data-snapshot-transition', '')
    if (direction) document.documentElement.setAttribute('data-room-slide', direction)
    const transition = document.startViewTransition(() => {
      if (ticket === generation.current) flushSync(update)
    })
    running.current = transition
    void transition.ready.catch(() => { /* Superseded captures are expected. */ })
    const finish = () => {
      if (running.current !== transition) return
      running.current = null
      viewport.removeAttribute('data-snapshot-transition')
      if (direction) document.documentElement.removeAttribute('data-room-slide')
    }
    void transition.finished.then(finish, finish)
  }
  return { run, running }
}
