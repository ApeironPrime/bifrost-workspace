import { ROOM_TAB_ORDER } from './tabDirection.ts'

export type RoomTabId = (typeof ROOM_TAB_ORDER)[number]

const FOCUSABLE_DESCENDANT_SELECTOR = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled):not([type="hidden"])',
  'textarea:not(:disabled)',
  'select:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

export function roomTabElementId(tab: RoomTabId): string {
  return `room-tab-${tab}`
}

export function roomPanelElementId(tab: RoomTabId): string {
  return `room-panel-${tab}`
}

export function roomTabTabIndex(tab: RoomTabId, activeTab: RoomTabId): 0 | -1 {
  return tab === activeTab ? 0 : -1
}

export function getNextRoomTab(
  current: RoomTabId,
  key: string,
  modifiers?: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean },
): RoomTabId | null {
  if (modifiers?.altKey || modifiers?.ctrlKey || modifiers?.metaKey || modifiers?.shiftKey) {
    return null
  }
  const index = ROOM_TAB_ORDER.indexOf(current)
  if (index === -1) return null
  switch (key) {
    case 'ArrowRight':
      return ROOM_TAB_ORDER[(index + 1) % ROOM_TAB_ORDER.length]
    case 'ArrowLeft':
      return ROOM_TAB_ORDER[(index - 1 + ROOM_TAB_ORDER.length) % ROOM_TAB_ORDER.length]
    case 'Home':
      return ROOM_TAB_ORDER[0]
    case 'End':
      return ROOM_TAB_ORDER[ROOM_TAB_ORDER.length - 1]
    default:
      return null
  }
}

function isHiddenFromFocus(el: HTMLElement, boundary: HTMLElement): boolean {
  let current: HTMLElement | null = el
  while (current && current !== boundary) {
    if (current.hasAttribute('hidden') || current.hasAttribute('inert')) return true
    if (typeof window !== 'undefined' && window.getComputedStyle(current).display === 'none') {
      return true
    }
    current = current.parentElement
  }
  return false
}

export function hasFocusableDescendant(panel: HTMLElement | null): boolean {
  if (!panel) return false
  const candidates = panel.querySelectorAll<HTMLElement>(FOCUSABLE_DESCENDANT_SELECTOR)
  for (const candidate of candidates) {
    if (!isHiddenFromFocus(candidate, panel)) return true
  }
  return false
}

/** Keep a panel reachable via Tab only when it currently has no enabled focusable descendant. */
export function syncEmptyTabPanelTabIndex(panel: HTMLElement | null): void {
  if (!panel) return
  if (hasFocusableDescendant(panel)) {
    if (panel.hasAttribute('tabindex')) panel.removeAttribute('tabindex')
  } else if (panel.getAttribute('tabindex') !== '0') {
    panel.setAttribute('tabindex', '0')
  }
}
