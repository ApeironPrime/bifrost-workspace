import { useLayoutEffect, useRef } from 'react'

export function useRoomTabIndicator(tab: string, language: string, roomId?: string) {
  const navRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const measure = () => {
      const selected = nav.querySelector<HTMLElement>('.room-tab-btn[aria-selected="true"]')
      if (!selected) return
      nav.style.setProperty('--tab-indicator-x', `${selected.offsetLeft}px`)
      nav.style.setProperty('--tab-indicator-width', `${selected.offsetWidth}px`)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(nav)
    nav.querySelectorAll('.room-tab-btn').forEach(button => observer.observe(button))
    return () => observer.disconnect()
  }, [tab, language, roomId])
  return navRef
}
