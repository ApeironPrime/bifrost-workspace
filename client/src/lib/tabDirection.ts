export const ROOM_TAB_ORDER = ['meeting', 'board', 'chat', 'notes', 'files'] as const
export type SlideDirection = 'forward' | 'backward'

export function tabDirection(from: string, to: string): SlideDirection {
  return ROOM_TAB_ORDER.indexOf(to as typeof ROOM_TAB_ORDER[number]) < ROOM_TAB_ORDER.indexOf(from as typeof ROOM_TAB_ORDER[number])
    ? 'backward' : 'forward'
}
