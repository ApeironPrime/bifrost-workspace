/** Pure connection/sendability helpers for active room panels. */

export function canSendToRoom(readOnly: boolean, text: string, connections: number): boolean {
  return !readOnly && text.trim().length > 0 && connections > 0
}

export function openConnectionCount(channels: Iterable<{ readyState: string }>): number {
  return Array.from(channels).filter((channel) => channel.readyState === 'open').length
}
