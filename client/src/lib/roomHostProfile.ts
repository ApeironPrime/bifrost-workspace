type HostProfile = { id: string; name: string; email: string }
type HostedRoom = { host?: HostProfile | null }

/** Overlay the latest saved identity without changing room access or server snapshots. */
export function withCurrentUserHost<T extends HostedRoom>(
  room: T,
  user: HostProfile | null | undefined,
): T {
  if (
    !user ||
    room.host?.id !== user.id ||
    (room.host.name === user.name && room.host.email === user.email)
  ) return room

  return { ...room, host: { ...room.host, name: user.name, email: user.email } }
}
