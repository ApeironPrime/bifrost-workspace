import { useEffect, useState, type ReactNode } from 'react'
import { PresenceContext } from '../hooks/useMotionPresent'

/** Retain the last visible content only for its exit transition. Exiting UI is
 * immediately inert and hidden from assistive technology, never a second dialog. */
export function MotionPresence({ present, children }: { present: boolean; children: ReactNode }) {
  const [snapshot, setSnapshot] = useState({ present, mounted: present, content: children })
  // Adjust only this component's state during render, before children commit.
  // This avoids a blank frame and never reads mutable refs during rendering.
  if (present !== snapshot.present || (present && children !== snapshot.content)) {
    setSnapshot({ present, mounted: present || snapshot.mounted, content: present ? children : snapshot.content })
  }
  useEffect(() => {
    if (present) return
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 360
    const timer = window.setTimeout(() => setSnapshot(previous => ({ ...previous, mounted: false })), duration)
    return () => window.clearTimeout(timer)
  }, [present])
  if (!present && !snapshot.mounted) return null
  return <PresenceContext.Provider value={present}><div className="motion-presence" data-exiting={!present || undefined} inert={!present} aria-hidden={!present || undefined}>
    {present ? children : snapshot.content}
  </div></PresenceContext.Provider>
}
