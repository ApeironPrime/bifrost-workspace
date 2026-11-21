type SortableMember = { userId: string; user: { name: string }; roomAssignments?: { roomId: string; role: string; labelIds?: string[] }[] }
const collator = new Intl.Collator('vi', { sensitivity: 'base', numeric: true })
const cleanName = (name: string) => name.trim().replace(/\s+/g, ' ')

/** Vietnamese display names sort by given name, then full name, then stable ID. */
export function compareMemberNames(a: SortableMember, b: SortableMember): number {
  const aName = cleanName(a.user.name), bName = cleanName(b.user.name)
  return collator.compare(aName.split(' ').at(-1) ?? '', bName.split(' ').at(-1) ?? '')
    || collator.compare(aName, bName) || a.userId.localeCompare(b.userId)
}

export function orderMembers<T extends SortableMember>(members: T[], roomId?: string, labels: { id: string; roomId: string; priority: number }[] = []): T[] {
  const assignment = (member: T) => member.roomAssignments?.find(item => item.roomId === roomId)
  const rank = (member: T) => ({ HOST: 0, MODERATOR: 1, MEMBER: 2, VIEWER: 3 }[assignment(member)?.role ?? 'MEMBER'] ?? 4)
  const priority = (member: T) => Math.min(1000, ...labels.filter(label => label.roomId === roomId && assignment(member)?.labelIds?.includes(label.id)).map(label => label.priority))
  return [...members].sort((a, b) => (roomId ? rank(a) - rank(b) || priority(a) - priority(b) : 0) || compareMemberNames(a, b))
}
