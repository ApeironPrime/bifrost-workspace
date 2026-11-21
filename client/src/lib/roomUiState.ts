export type RoomView = 'meeting' | 'board' | 'chat' | 'notes' | 'files'
export type WorkspaceRoute = { workspaceId: string; roomId: string; tab: RoomView }
const views: RoomView[] = ['meeting','board','chat','notes','files']
export function readWorkspaceRoute(hash: string): WorkspaceRoute {
  const query = new URLSearchParams(hash.split('?')[1] ?? '')
  const tab = query.get('tab') as RoomView
  return { workspaceId: query.get('workspace') ?? '', roomId: query.get('room') ?? '', tab: views.includes(tab) ? tab : 'meeting' }
}
export function workspaceHash(route: WorkspaceRoute): string {
  const query = new URLSearchParams()
  if(route.workspaceId) query.set('workspace',route.workspaceId)
  if(route.roomId) {query.set('room',route.roomId);query.set('tab',route.tab)}
  return `#workspace${query.size ? `?${query}` : ''}`
}
type Draft = { chat: string; note: string }
type DraftWrite = Partial<Draft> & { noteUpdatedAt?: number }
type Store = Pick<Storage,'getItem'|'setItem'|'removeItem'>
export function roomDraftKey(userId: string, workspaceId: string, roomId: string) {
  return `bifrost-room-draft:${encodeURIComponent(userId)}:${encodeURIComponent(workspaceId)}:${encodeURIComponent(roomId)}`
}
export function readRoomDraft(store: Store, key: string): Draft {
  try { const value=JSON.parse(store.getItem(key) ?? '{}');return {chat:typeof value.chat==='string'?value.chat:'',note:typeof value.note==='string'?value.note:''} } catch {return {chat:'',note:''}}
}
export function readRoomNoteUpdatedAt(store: Store, key: string): number | undefined {
  try {
    const value = JSON.parse(store.getItem(key) ?? '{}')
    return typeof value.noteUpdatedAt === 'number' && Number.isFinite(value.noteUpdatedAt) && value.noteUpdatedAt > 0
      ? value.noteUpdatedAt
      : undefined
  } catch {
    return undefined
  }
}
export function writeRoomDraft(store: Store, key: string, value: DraftWrite) {
  try {
    const currentDraft = readRoomDraft(store, key)
    const currentNoteUpdatedAt = readRoomNoteUpdatedAt(store, key)
    const nextNoteUpdatedAt = value.noteUpdatedAt !== undefined ? value.noteUpdatedAt : currentNoteUpdatedAt
    const nextPayload: Record<string, unknown> = { ...currentDraft, ...value }
    if (typeof nextNoteUpdatedAt === 'number' && Number.isFinite(nextNoteUpdatedAt) && nextNoteUpdatedAt > 0) {
      nextPayload.noteUpdatedAt = nextNoteUpdatedAt
    } else {
      delete nextPayload.noteUpdatedAt
    }
    store.setItem(key, JSON.stringify(nextPayload))
  } catch { /* In-memory input remains usable if storage is unavailable. */ }
}

export const ROOM_BOARD_SNAPSHOT_VERSION = 1 as const

export type BoardItemKind = 'agenda' | 'decision' | 'action' | 'parking'

const VALID_BOARD_KINDS = new Set<BoardItemKind>(['agenda', 'decision', 'action', 'parking'])

export interface MeetingBoardItem {
  id: string
  kind: BoardItemKind
  title: string
  description?: string
  completed?: boolean
  author: string
  createdAt: string
  updatedAt: string
  order: number
  revision?: number
  updatedBy?: string
}

export interface BoardTombstone {
  id: string
  deletedAt: string
  revision: number
  deletedBy?: string
}

export interface RoomBoardScope {
  userId: string
  workspaceId: string
  roomId: string
}

export interface PeerBoardSenderIdentity {
  userId: string
  name: string
}

export interface BoardState {
  items: MeetingBoardItem[]
  tombstones: Record<string, BoardTombstone>
}

export interface RoomBoardSnapshot extends BoardState {
  version: typeof ROOM_BOARD_SNAPSHOT_VERSION
  userId: string
  workspaceId: string
  roomId: string
  updatedAt: string
}

export type MeetingBoardMessage =
  | { type: 'meeting-board:sync-request'; roomId?: string }
  | {
      type: 'meeting-board:sync-state'
      roomId?: string
      items: MeetingBoardItem[]
      tombstones?: Record<string, BoardTombstone>
    }
  | { type: 'meeting-board:item-create'; roomId?: string; item: MeetingBoardItem }
  | { type: 'meeting-board:item-update'; roomId?: string; item: MeetingBoardItem }
  | {
      type: 'meeting-board:item-delete'
      roomId?: string
      itemId: string
      deletedAt?: string
      revision?: number
      deletedBy?: string
    }
  | {
      type: 'meeting-board:item-move'
      roomId?: string
      itemId: string
      targetKind: BoardItemKind
      targetOrder: number
      updatedAt: string
      revision?: number
      updatedBy?: string
    }

type StorageReader = Pick<Store, 'getItem' | 'setItem'>

const LEGACY_UNVERSIONED_ISO = '1970-01-01T00:00:00.000Z'

export type BoardStorageReadStatus =
  | 'ok'
  | 'empty'
  | 'corrupt'
  | 'incompatible-version'
  | 'scope-mismatch'
  | 'storage-error'

export type BoardStorageWriteStatus =
  | 'ok'
  | 'incompatible-version'
  | 'scope-mismatch'
  | 'storage-error'
  | 'invalid-key'

export type BoardStorageReadResult = {
  status: BoardStorageReadStatus
  snapshot: RoomBoardSnapshot
}

export type BoardStorageWriteResult = {
  ok: boolean
  status: BoardStorageWriteStatus
  snapshot?: RoomBoardSnapshot
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidTimestamp(iso: unknown): iso is string {
  if (typeof iso !== 'string' || !iso) return false
  return Number.isFinite(Date.parse(iso))
}

function parseTimestampMs(iso: unknown): number {
  if (!isValidTimestamp(iso)) return 0
  return Date.parse(iso)
}

function normalizeRevision(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0
}

function hasSameCanonicalFields<T extends object>(
  raw: Record<string, unknown>,
  normalized: T
): raw is Record<string, unknown> & T {
  const proto = Object.getPrototypeOf(raw)
  if (proto !== Object.prototype && proto !== null) return false
  const normRecord = normalized as Record<string, unknown>
  const rawKeys = Object.keys(raw)
  const normKeys = Object.keys(normRecord)
  if (rawKeys.length !== normKeys.length) return false
  for (const key of normKeys) {
    if (!Object.prototype.hasOwnProperty.call(raw, key) || !Object.is(raw[key], normRecord[key])) {
      return false
    }
  }
  return true
}

function normalizeBoardItemCore(
  raw: unknown,
  overrides?: { author: string; updatedBy: string }
): MeetingBoardItem | null {
  if (!isPlainRecord(raw)) return null
  if (typeof raw.id !== 'string' || !raw.id.trim()) return null
  if (typeof raw.kind !== 'string' || !VALID_BOARD_KINDS.has(raw.kind as BoardItemKind)) return null
  if (typeof raw.title !== 'string') return null
  if (!overrides && typeof raw.author !== 'string') return null
  if (!isValidTimestamp(raw.createdAt)) return null
  if (!isValidTimestamp(raw.updatedAt)) return null
  if (typeof raw.order !== 'number' || !Number.isFinite(raw.order)) return null

  const normalized: MeetingBoardItem = {
    id: raw.id,
    kind: raw.kind as BoardItemKind,
    title: raw.title,
    author: overrides ? overrides.author : (raw.author as string),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    order: raw.order,
  }
  if (typeof raw.description === 'string' && raw.description.length > 0) {
    normalized.description = raw.description
  }
  if (typeof raw.completed === 'boolean') {
    normalized.completed = raw.completed
  }
  if (typeof raw.revision === 'number' && Number.isInteger(raw.revision) && raw.revision >= 0) {
    normalized.revision = raw.revision
  }
  if (overrides) {
    normalized.updatedBy = overrides.updatedBy
  } else if (typeof raw.updatedBy === 'string' && raw.updatedBy.length > 0) {
    normalized.updatedBy = raw.updatedBy
  }
  return !overrides && hasSameCanonicalFields(raw, normalized) ? raw : normalized
}

function normalizeBoardItem(raw: unknown): MeetingBoardItem | null {
  return normalizeBoardItemCore(raw)
}

function normalizeTombstone(raw: unknown, fallbackId?: string): BoardTombstone | null {
  if (!isPlainRecord(raw)) return null
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id : fallbackId
  if (!id || !id.trim()) return null
  if (!isValidTimestamp(raw.deletedAt)) return null
  const normalized: BoardTombstone = {
    id,
    deletedAt: raw.deletedAt,
    revision: normalizeRevision(raw.revision),
  }
  if (typeof raw.deletedBy === 'string' && raw.deletedBy.length > 0) {
    normalized.deletedBy = raw.deletedBy
  }
  return hasSameCanonicalFields(raw, normalized) ? raw : normalized
}

function normalizeTombstoneMap(raw: unknown): Record<string, BoardTombstone> {
  const result: Record<string, BoardTombstone> = {}
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const normalized = normalizeTombstone(entry)
      if (normalized) result[normalized.id] = pickWinningTombstone(result[normalized.id], normalized)
    }
    return result
  }
  if (!isPlainRecord(raw)) return result
  for (const [key, entry] of Object.entries(raw)) {
    const normalized = normalizeTombstone(entry, key)
    if (normalized) result[normalized.id] = pickWinningTombstone(result[normalized.id], normalized)
  }
  return result
}

type VersionTuple = {
  revision: number
  isDelete: 0 | 1
  versionMs: number
  actorId: string
  tieSignature: string
}

function itemTieSignature(item: MeetingBoardItem): string {
  return JSON.stringify([
    item.kind,
    item.title,
    item.description ?? '',
    Boolean(item.completed),
    item.order,
    item.author,
    item.createdAt,
    item.updatedAt,
  ])
}

function versionFromItem(item: MeetingBoardItem): VersionTuple {
  return {
    revision: normalizeRevision(item.revision),
    isDelete: 0,
    versionMs: parseTimestampMs(item.updatedAt),
    actorId: item.updatedBy ?? '',
    tieSignature: itemTieSignature(item),
  }
}

function versionFromTombstone(tombstone: BoardTombstone): VersionTuple {
  return {
    revision: normalizeRevision(tombstone.revision),
    isDelete: 1,
    versionMs: parseTimestampMs(tombstone.deletedAt),
    actorId: tombstone.deletedBy ?? '',
    tieSignature: tombstone.deletedAt,
  }
}

/**
 * Total, commutative, associative, idempotent order over board item versions and tombstones.
 * Logical Lamport revision leads causal ordering so skewed peer clocks cannot clobber causally
 * newer versions; at equal revision, tombstones outrank concurrent upserts, then timestamps,
 * actorId, and payload signature break remaining concurrent ties deterministically.
 */
function compareVersions(a: VersionTuple, b: VersionTuple): number {
  if (a.revision !== b.revision) return a.revision > b.revision ? 1 : -1
  if (a.isDelete !== b.isDelete) return a.isDelete > b.isDelete ? 1 : -1
  if (a.versionMs !== b.versionMs) return a.versionMs > b.versionMs ? 1 : -1
  if (a.actorId !== b.actorId) return a.actorId > b.actorId ? 1 : -1
  if (a.tieSignature !== b.tieSignature) return a.tieSignature > b.tieSignature ? 1 : -1
  return 0
}

function pickWinningItem(a: MeetingBoardItem | undefined, b: MeetingBoardItem | undefined): MeetingBoardItem | undefined {
  if (!a) return b
  if (!b) return a
  return compareVersions(versionFromItem(a), versionFromItem(b)) >= 0 ? a : b
}

function pickWinningTombstone(a: BoardTombstone | undefined, b: BoardTombstone | undefined): BoardTombstone {
  if (!a) return b!
  if (!b) return a
  return compareVersions(versionFromTombstone(a), versionFromTombstone(b)) >= 0 ? a : b
}

export const BOARD_ORDER_STEP = 1024
const MIN_BOARD_ORDER_GAP = 1e-7

function compareBoardItems(a: MeetingBoardItem, b: MeetingBoardItem): number {
  return (
    a.order - b.order ||
    a.createdAt.localeCompare(b.createdAt) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  )
}

function sortBoardItems(items: MeetingBoardItem[]): MeetingBoardItem[] {
  return [...items].sort(compareBoardItems)
}

export function getSortedColumnItems(
  items: readonly MeetingBoardItem[],
  kind: BoardItemKind
): MeetingBoardItem[] {
  return items.filter((item) => item.kind === kind).sort(compareBoardItems)
}

/**
 * Converts a visual gap index (`0..columnItems.length`, where `k` is before item `k`
 * and `columnItems.length` is after the last item) into the `targetIndex` in the
 * destination list after excluding the dragged card.
 */
export function resolveVisualDropSlotToTargetIndex({
  columnItems,
  draggedItemId,
  rawSlotIndex,
}: {
  columnItems: readonly MeetingBoardItem[]
  draggedItemId: string
  rawSlotIndex: number
}): number {
  const sourceIndex = columnItems.findIndex((item) => item.id === draggedItemId)
  const destLen = sourceIndex >= 0 ? columnItems.length - 1 : columnItems.length
  const safeRaw = Number.isFinite(rawSlotIndex) ? Math.trunc(rawSlotIndex) : columnItems.length
  const clampedRaw = Math.max(0, Math.min(safeRaw, columnItems.length))
  const adjusted = sourceIndex >= 0 && clampedRaw > sourceIndex ? clampedRaw - 1 : clampedRaw
  return Math.max(0, Math.min(adjusted, destLen))
}

function resolveCandidateForId(
  items: (MeetingBoardItem | undefined)[],
  tombstones: (BoardTombstone | undefined)[]
): { item?: MeetingBoardItem; tombstone?: BoardTombstone } {
  let winningItem: MeetingBoardItem | undefined
  for (const candidate of items) {
    if (candidate) winningItem = pickWinningItem(winningItem, candidate)
  }

  let winningTombstone: BoardTombstone | undefined
  for (const candidate of tombstones) {
    if (candidate) winningTombstone = pickWinningTombstone(winningTombstone, candidate)
  }

  if (winningItem && winningTombstone) {
    return compareVersions(versionFromTombstone(winningTombstone), versionFromItem(winningItem)) >= 0
      ? { tombstone: winningTombstone }
      : { item: winningItem }
  }
  return winningTombstone ? { tombstone: winningTombstone } : { item: winningItem }
}

function nextCausalStamp(
  existingItem: MeetingBoardItem | undefined,
  existingTombstone: BoardTombstone | undefined,
  nowMs = Date.now()
): { iso: string; revision: number } {
  const safeNow = Number.isFinite(nowMs) ? nowMs : Date.now()
  const prevRevision = Math.max(
    normalizeRevision(existingItem?.revision),
    normalizeRevision(existingTombstone?.revision)
  )
  return {
    iso: new Date(safeNow).toISOString(),
    revision: prevRevision + 1,
  }
}

export function getBrowserLocalStorage(): Store | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
  } catch {
    return null
  }
}

export function roomBoardKey(userId: string, workspaceId: string, roomId: string): string {
  return `bifrost-room-board:${encodeURIComponent(userId)}:${encodeURIComponent(workspaceId)}:${encodeURIComponent(roomId)}`
}

export function emptyRoomBoardSnapshot(scope?: Partial<RoomBoardScope>): RoomBoardSnapshot {
  return {
    version: ROOM_BOARD_SNAPSHOT_VERSION,
    userId: scope?.userId ?? '',
    workspaceId: scope?.workspaceId ?? '',
    roomId: scope?.roomId ?? '',
    updatedAt: '',
    items: [],
    tombstones: {},
  }
}

function parseRoomBoardRaw(
  raw: string,
  expectedScope?: RoomBoardScope
): { status: 'ok'; snapshot: RoomBoardSnapshot } | { status: 'corrupt' | 'incompatible-version' | 'scope-mismatch' } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { status: 'corrupt' }
  }

  if (!isPlainRecord(parsed)) {
    return { status: 'corrupt' }
  }
  if (parsed.version !== ROOM_BOARD_SNAPSHOT_VERSION) {
    return { status: 'incompatible-version' }
  }
  if (
    typeof parsed.userId !== 'string' ||
    typeof parsed.workspaceId !== 'string' ||
    typeof parsed.roomId !== 'string'
  ) {
    return { status: 'corrupt' }
  }
  if (
    expectedScope &&
    (parsed.userId !== expectedScope.userId ||
      parsed.workspaceId !== expectedScope.workspaceId ||
      parsed.roomId !== expectedScope.roomId)
  ) {
    return { status: 'scope-mismatch' }
  }
  if (!Array.isArray(parsed.items)) {
    return { status: 'corrupt' }
  }
  if (parsed.tombstones !== undefined && !isPlainRecord(parsed.tombstones)) {
    return { status: 'corrupt' }
  }

  const validItems = parsed.items
    .map((entry) => normalizeBoardItem(entry))
    .filter((entry): entry is MeetingBoardItem => entry !== null)
  const validTombstones = normalizeTombstoneMap(parsed.tombstones)
  const reconciled = reconcileBoardSnapshots(
    { items: [], tombstones: {} },
    { items: validItems, tombstones: validTombstones }
  )

  return {
    status: 'ok',
    snapshot: {
      version: ROOM_BOARD_SNAPSHOT_VERSION,
      userId: parsed.userId,
      workspaceId: parsed.workspaceId,
      roomId: parsed.roomId,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
      items: reconciled.items,
      tombstones: reconciled.tombstones,
    },
  }
}

export function readRoomBoardDetailed(
  store: Pick<StorageReader, 'getItem'> | null | undefined,
  key: string,
  expectedScope?: RoomBoardScope
): BoardStorageReadResult {
  const fallback = emptyRoomBoardSnapshot(expectedScope)
  if (!store || !key) return { status: 'empty', snapshot: fallback }

  try {
    const raw = store.getItem(key)
    if (!raw) return { status: 'empty', snapshot: fallback }

    const parsed = parseRoomBoardRaw(raw, expectedScope)
    if (parsed.status !== 'ok') {
      return { status: parsed.status, snapshot: fallback }
    }
    return { status: 'ok', snapshot: parsed.snapshot }
  } catch {
    return { status: 'storage-error', snapshot: fallback }
  }
}

export function readRoomBoard(
  store: Pick<StorageReader, 'getItem'> | null | undefined,
  key: string,
  expectedScope?: RoomBoardScope
): RoomBoardSnapshot {
  return readRoomBoardDetailed(store, key, expectedScope).snapshot
}

export function writeRoomBoardDetailed(
  store: (Pick<StorageReader, 'setItem'> & Partial<Pick<StorageReader, 'getItem'>>) | null | undefined,
  key: string,
  snapshot: Omit<RoomBoardSnapshot, 'version' | 'updatedAt'> & { updatedAt?: string }
): BoardStorageWriteResult {
  if (!store || !key) return { ok: false, status: 'invalid-key' }

  try {
    let baseState: BoardState = { items: [], tombstones: {} }
    if (typeof store.getItem === 'function') {
      const rawExisting = store.getItem(key)
      if (rawExisting) {
        const existingParsed = parseRoomBoardRaw(rawExisting, {
          userId: snapshot.userId,
          workspaceId: snapshot.workspaceId,
          roomId: snapshot.roomId,
        })
        if (existingParsed.status === 'incompatible-version' || existingParsed.status === 'scope-mismatch') {
          return { ok: false, status: existingParsed.status }
        }
        if (existingParsed.status === 'ok') {
          baseState = {
            items: existingParsed.snapshot.items,
            tombstones: existingParsed.snapshot.tombstones,
          }
        }
      }
    }

    // Preserve in-memory item/tombstone object references on exact version ties while
    // still honoring any newer cross-tab updates stored in baseState.
    const reconciled = reconcileBoardSnapshots(
      {
        items: snapshot.items,
        tombstones: snapshot.tombstones,
      },
      baseState
    )
    const payload: RoomBoardSnapshot = {
      version: ROOM_BOARD_SNAPSHOT_VERSION,
      userId: snapshot.userId,
      workspaceId: snapshot.workspaceId,
      roomId: snapshot.roomId,
      updatedAt: snapshot.updatedAt || new Date().toISOString(),
      items: reconciled.items,
      tombstones: reconciled.tombstones,
    }
    store.setItem(key, JSON.stringify(payload))
    return { ok: true, status: 'ok', snapshot: payload }
  } catch {
    return { ok: false, status: 'storage-error' }
  }
}

export function writeRoomBoard(
  store: (Pick<StorageReader, 'setItem'> & Partial<Pick<StorageReader, 'getItem'>>) | null | undefined,
  key: string,
  snapshot: Omit<RoomBoardSnapshot, 'version' | 'updatedAt'> & { updatedAt?: string }
): boolean {
  return writeRoomBoardDetailed(store, key, snapshot).ok
}

export function reconcileBoardSnapshots(
  local: BoardState,
  incoming: { items?: unknown; tombstones?: unknown }
): BoardState {
  const localItemsById = new Map<string, MeetingBoardItem>()
  for (const item of local.items) {
    const normalized = normalizeBoardItem(item)
    if (normalized) {
      localItemsById.set(normalized.id, pickWinningItem(localItemsById.get(normalized.id), normalized)!)
    }
  }

  const incomingItemsById = new Map<string, MeetingBoardItem>()
  if (Array.isArray(incoming.items)) {
    for (const rawItem of incoming.items) {
      const normalized = normalizeBoardItem(rawItem)
      if (normalized) {
        incomingItemsById.set(normalized.id, pickWinningItem(incomingItemsById.get(normalized.id), normalized)!)
      }
    }
  }

  const localTombstones = normalizeTombstoneMap(local.tombstones)
  const incomingTombstones = normalizeTombstoneMap(incoming.tombstones)

  const allIds = new Set<string>([
    ...localItemsById.keys(),
    ...incomingItemsById.keys(),
    ...Object.keys(localTombstones),
    ...Object.keys(incomingTombstones),
  ])

  const nextItems: MeetingBoardItem[] = []
  const nextTombstones: Record<string, BoardTombstone> = {}

  for (const id of allIds) {
    const winner = resolveCandidateForId(
      [localItemsById.get(id), incomingItemsById.get(id)],
      [localTombstones[id], incomingTombstones[id]]
    )
    if (winner.item) {
      nextItems.push(winner.item)
    } else if (winner.tombstone) {
      nextTombstones[id] = winner.tombstone
    }
  }

  const sortedItems = sortBoardItems(nextItems)
  const itemsUnchanged =
    sortedItems.length === local.items.length &&
    sortedItems.every((item, idx) => item === local.items[idx])
  const localTombKeys = Object.keys(local.tombstones)
  const nextTombKeys = Object.keys(nextTombstones)
  const tombstonesUnchanged =
    localTombKeys.length === nextTombKeys.length &&
    nextTombKeys.every((key) => nextTombstones[key] === local.tombstones[key])

  if (itemsUnchanged && tombstonesUnchanged) {
    return local
  }

  return {
    items: itemsUnchanged ? local.items : sortedItems,
    tombstones: tombstonesUnchanged ? local.tombstones : nextTombstones,
  }
}

function buildDeleteTombstone(
  message: Extract<MeetingBoardMessage, { type: 'meeting-board:item-delete' }>,
  actorIdOverride?: string
): BoardTombstone | null {
  if (typeof message.itemId !== 'string' || !message.itemId.trim()) return null
  const hasValidDeletedAt = isValidTimestamp(message.deletedAt)
  const resolvedActorId =
    actorIdOverride !== undefined
      ? actorIdOverride
      : typeof message.deletedBy === 'string' && message.deletedBy
        ? message.deletedBy
        : undefined
  return {
    id: message.itemId,
    deletedAt: hasValidDeletedAt ? message.deletedAt! : LEGACY_UNVERSIONED_ISO,
    revision: normalizeRevision(message.revision),
    ...(resolvedActorId ? { deletedBy: resolvedActorId } : {}),
  }
}

function buildMovedCandidate(
  state: BoardState,
  message: Extract<MeetingBoardMessage, { type: 'meeting-board:item-move' }>,
  actorIdOverride?: string
): MeetingBoardItem | null {
  if (typeof message.itemId !== 'string' || !message.itemId.trim()) return null
  if (!VALID_BOARD_KINDS.has(message.targetKind)) return null
  if (typeof message.targetOrder !== 'number' || !Number.isFinite(message.targetOrder)) return null
  if (!isValidTimestamp(message.updatedAt)) return null

  const existingItem = state.items.find((item) => item.id === message.itemId)
  if (!existingItem) return null

  const resolvedActorId =
    actorIdOverride !== undefined
      ? actorIdOverride
      : typeof message.updatedBy === 'string' && message.updatedBy
        ? message.updatedBy
        : existingItem.updatedBy

  return {
    ...existingItem,
    kind: message.targetKind,
    order: message.targetOrder,
    updatedAt: message.updatedAt,
    revision: normalizeRevision(message.revision),
    ...(resolvedActorId ? { updatedBy: resolvedActorId } : {}),
  }
}

/**
 * Applies a locally authored MeetingBoard operation produced by the signed-in user.
 * Do NOT use this for incoming DataChannel peer messages; use `applyPeerBoardMessage`.
 */
export function applyLocalBoardMessage(
  state: BoardState,
  message: MeetingBoardMessage,
  context?: { roomId?: string; nowMs?: number }
): BoardState {
  if (message.roomId && context?.roomId && message.roomId !== context.roomId) {
    return state
  }

  switch (message.type) {
    case 'meeting-board:sync-state':
      return reconcileBoardSnapshots(state, {
        items: message.items,
        tombstones: message.tombstones,
      })

    case 'meeting-board:item-create':
    case 'meeting-board:item-update': {
      const incoming = normalizeBoardItem(message.item)
      if (!incoming) return state
      return reconcileBoardSnapshots(state, { items: [incoming] })
    }

    case 'meeting-board:item-delete': {
      const incomingTombstone = buildDeleteTombstone(message)
      if (!incomingTombstone) return state
      return reconcileBoardSnapshots(state, {
        tombstones: { [incomingTombstone.id]: incomingTombstone },
      })
    }

    case 'meeting-board:item-move': {
      const movedCandidate = buildMovedCandidate(state, message)
      if (!movedCandidate) return state
      return reconcileBoardSnapshots(state, { items: [movedCandidate] })
    }

    default:
      return state
  }
}

/**
 * Applies a remote peer's MeetingBoard message with server-verified sender identity binding.
 * Fails closed without mutating `state` when `context.sender` is missing or invalid.
 */
export function applyPeerBoardMessage(
  state: BoardState,
  message: MeetingBoardMessage,
  context: { roomId?: string; sender: PeerBoardSenderIdentity; nowMs?: number }
): BoardState {
  const senderUserId = typeof context?.sender?.userId === 'string' ? context.sender.userId.trim() : ''
  const senderName = typeof context?.sender?.name === 'string' ? context.sender.name.trim() : ''
  if (!senderUserId || !senderName) {
    return state
  }
  if (message.roomId && context.roomId && message.roomId !== context.roomId) {
    return state
  }

  switch (message.type) {
    case 'meeting-board:sync-state':
      // Historical snapshot sync intentionally preserves card/tombstone authorship from the
      // snapshot so a peer relaying cached state is not misattributed as historical creator.
      // Security limitation: verified sender proves only who transmitted this snapshot over the
      // DataChannel, not cryptographic authorship of historical items/tombstones (no server event
      // log or author signature mechanism exists yet).
      return reconcileBoardSnapshots(state, {
        items: message.items,
        tombstones: message.tombstones,
      })

    case 'meeting-board:item-create': {
      const incoming = normalizeBoardItemCore(message.item, {
        author: senderName,
        updatedBy: senderUserId,
      })
      if (!incoming) return state
      return reconcileBoardSnapshots(state, { items: [incoming] })
    }

    case 'meeting-board:item-update': {
      if (!isPlainRecord(message.item) || typeof message.item.id !== 'string' || !message.item.id.trim()) {
        return state
      }
      const existingItem = state.items.find((item) => item.id === message.item.id)
      const incoming = normalizeBoardItemCore(message.item, {
        author: existingItem ? existingItem.author : senderName,
        updatedBy: senderUserId,
      })
      if (!incoming) return state
      return reconcileBoardSnapshots(state, { items: [incoming] })
    }

    case 'meeting-board:item-delete': {
      const incomingTombstone = buildDeleteTombstone(message, senderUserId)
      if (!incomingTombstone) return state
      return reconcileBoardSnapshots(state, {
        tombstones: { [incomingTombstone.id]: incomingTombstone },
      })
    }

    case 'meeting-board:item-move': {
      const movedCandidate = buildMovedCandidate(state, message, senderUserId)
      if (!movedCandidate) return state
      return reconcileBoardSnapshots(state, { items: [movedCandidate] })
    }

    default:
      return state
  }
}

export function buildBoardSyncStateMessage(
  state: BoardState,
  params: { readOnly?: boolean; roomId?: string }
): MeetingBoardMessage | null {
  if (params.readOnly) return null
  const hasTombstones = Object.keys(state.tombstones).length > 0
  if (state.items.length === 0 && !hasTombstones) return null
  return {
    type: 'meeting-board:sync-state',
    ...(params.roomId ? { roomId: params.roomId } : {}),
    items: state.items,
    ...(hasTombstones ? { tombstones: state.tombstones } : {}),
  }
}

export function createBoardItem(
  state: BoardState,
  params: {
    kind: BoardItemKind
    title: string
    description?: string
    author: string
    actorId: string
    roomId?: string
    readOnly?: boolean
    nowMs?: number
    id?: string
  }
): { state: BoardState; message: MeetingBoardMessage | null } {
  const titleTrimmed = params.title.trim()
  if (params.readOnly || !titleTrimmed) return { state, message: null }

  const id = params.id ?? crypto.randomUUID()
  const stamp = nextCausalStamp(undefined, state.tombstones[id], params.nowMs)
  const columnItems = state.items.filter((i) => i.kind === params.kind)
  const maxOrder = columnItems.reduce(
    (highest, item) => (item.order > highest ? item.order : highest),
    columnItems.length > 0 ? columnItems[0].order : 0
  )
  const nextOrder = columnItems.length === 0 ? BOARD_ORDER_STEP : maxOrder + BOARD_ORDER_STEP
  const description = params.description?.trim()

  const newItem: MeetingBoardItem = {
    id,
    kind: params.kind,
    title: titleTrimmed,
    ...(description ? { description } : {}),
    completed: false,
    author: params.author,
    createdAt: stamp.iso,
    updatedAt: stamp.iso,
    order: nextOrder,
    revision: stamp.revision,
    updatedBy: params.actorId,
  }

  const nextState = reconcileBoardSnapshots(state, { items: [newItem] })
  return {
    state: nextState,
    message: {
      type: 'meeting-board:item-create',
      ...(params.roomId ? { roomId: params.roomId } : {}),
      item: newItem,
    },
  }
}

export function updateBoardItem(
  state: BoardState,
  params: {
    itemId: string
    title: string
    description?: string
    actorId: string
    roomId?: string
    readOnly?: boolean
    nowMs?: number
  }
): { state: BoardState; message: MeetingBoardMessage | null } {
  const titleTrimmed = params.title.trim()
  if (params.readOnly || !titleTrimmed) return { state, message: null }

  const existing = state.items.find((item) => item.id === params.itemId)
  if (!existing) return { state, message: null }

  const stamp = nextCausalStamp(existing, state.tombstones[params.itemId], params.nowMs)
  const description = params.description?.trim()
  const updatedItem: MeetingBoardItem = {
    ...existing,
    title: titleTrimmed,
    description: description || undefined,
    updatedAt: stamp.iso,
    revision: stamp.revision,
    updatedBy: params.actorId,
  }

  const nextState = reconcileBoardSnapshots(state, { items: [updatedItem] })
  return {
    state: nextState,
    message: {
      type: 'meeting-board:item-update',
      ...(params.roomId ? { roomId: params.roomId } : {}),
      item: updatedItem,
    },
  }
}

export function toggleBoardItemComplete(
  state: BoardState,
  params: {
    itemId: string
    actorId: string
    roomId?: string
    readOnly?: boolean
    nowMs?: number
  }
): { state: BoardState; message: MeetingBoardMessage | null } {
  if (params.readOnly) return { state, message: null }
  const existing = state.items.find((item) => item.id === params.itemId)
  if (!existing) return { state, message: null }

  const stamp = nextCausalStamp(existing, state.tombstones[params.itemId], params.nowMs)
  const updatedItem: MeetingBoardItem = {
    ...existing,
    completed: !existing.completed,
    updatedAt: stamp.iso,
    revision: stamp.revision,
    updatedBy: params.actorId,
  }

  const nextState = reconcileBoardSnapshots(state, { items: [updatedItem] })
  return {
    state: nextState,
    message: {
      type: 'meeting-board:item-update',
      ...(params.roomId ? { roomId: params.roomId } : {}),
      item: updatedItem,
    },
  }
}

export function deleteBoardItem(
  state: BoardState,
  params: {
    itemId: string
    actorId: string
    roomId?: string
    readOnly?: boolean
    nowMs?: number
  }
): { state: BoardState; message: MeetingBoardMessage | null } {
  if (params.readOnly) return { state, message: null }
  const existing = state.items.find((item) => item.id === params.itemId)
  const existingTomb = state.tombstones[params.itemId]
  if (!existing && !existingTomb) return { state, message: null }

  const stamp = nextCausalStamp(existing, existingTomb, params.nowMs)
  const tombstone: BoardTombstone = {
    id: params.itemId,
    deletedAt: stamp.iso,
    revision: stamp.revision,
    deletedBy: params.actorId,
  }

  const nextState = reconcileBoardSnapshots(state, {
    tombstones: { [params.itemId]: tombstone },
  })
  return {
    state: nextState,
    message: {
      type: 'meeting-board:item-delete',
      ...(params.roomId ? { roomId: params.roomId } : {}),
      itemId: params.itemId,
      deletedAt: tombstone.deletedAt,
      revision: tombstone.revision,
      deletedBy: tombstone.deletedBy,
    },
  }
}

export type BoardMoveDirection = 'up' | 'down' | 'top' | 'bottom'

export function moveBoardItem(
  state: BoardState,
  params: {
    itemId: string
    targetKind: BoardItemKind
    targetIndex?: number
    actorId: string
    roomId?: string
    readOnly?: boolean
    nowMs?: number
  }
): {
  state: BoardState
  message: MeetingBoardMessage | null
  movedItem?: MeetingBoardItem
  targetIndex?: number
  columnCount?: number
} {
  if (params.readOnly || !VALID_BOARD_KINDS.has(params.targetKind)) {
    return { state, message: null }
  }
  const existing = state.items.find((item) => item.id === params.itemId)
  if (!existing) return { state, message: null }

  if (
    params.targetIndex !== undefined &&
    (typeof params.targetIndex !== 'number' || !Number.isFinite(params.targetIndex))
  ) {
    return { state, message: null }
  }

  const sameColumn = existing.kind === params.targetKind
  const currentColumnItems = getSortedColumnItems(state.items, existing.kind)
  const currentIndex = sameColumn ? currentColumnItems.findIndex((i) => i.id === existing.id) : -1
  const destWithoutItem = sameColumn
    ? currentColumnItems.filter((i) => i.id !== existing.id)
    : getSortedColumnItems(state.items, params.targetKind)

  let desiredIndex: number
  if (params.targetIndex === undefined) {
    if (sameColumn) return { state, message: null }
    desiredIndex = destWithoutItem.length
  } else {
    desiredIndex = Math.max(0, Math.min(Math.trunc(params.targetIndex), destWithoutItem.length))
    if (sameColumn && desiredIndex === currentIndex) {
      return { state, message: null }
    }
  }

  const prev = destWithoutItem[desiredIndex - 1]
  const next = destWithoutItem[desiredIndex]

  let computedOrder: number | null = null
  if (!prev && !next) {
    computedOrder = BOARD_ORDER_STEP
  } else if (!prev && next) {
    computedOrder = next.order - BOARD_ORDER_STEP
  } else if (prev && !next) {
    computedOrder = prev.order + BOARD_ORDER_STEP
  } else if (prev && next) {
    const gap = next.order - prev.order
    if (gap > MIN_BOARD_ORDER_GAP) {
      const candidate = prev.order + gap / 2
      if (candidate > prev.order && candidate < next.order) {
        computedOrder = candidate
      }
    }
  }

  if (computedOrder !== null && Number.isFinite(computedOrder)) {
    const stamp = nextCausalStamp(existing, state.tombstones[params.itemId], params.nowMs)
    const movedItem: MeetingBoardItem = {
      ...existing,
      kind: params.targetKind,
      order: computedOrder,
      updatedAt: stamp.iso,
      revision: stamp.revision,
      updatedBy: params.actorId,
    }

    const nextState = reconcileBoardSnapshots(state, { items: [movedItem] })
    const finalColItems = getSortedColumnItems(nextState.items, params.targetKind)
    const finalIndex = finalColItems.findIndex((item) => item.id === movedItem.id)
    return {
      state: nextState,
      movedItem,
      targetIndex: finalIndex >= 0 ? finalIndex : desiredIndex,
      columnCount: finalColItems.length,
      message: {
        type: 'meeting-board:item-move',
        ...(params.roomId ? { roomId: params.roomId } : {}),
        itemId: existing.id,
        targetKind: params.targetKind,
        targetOrder: computedOrder,
        updatedAt: stamp.iso,
        revision: stamp.revision,
        updatedBy: params.actorId,
      },
    }
  }

  // Degenerate tie-order or exhausted float precision: rebalance the target column monotonically
  const assembled = [
    ...destWithoutItem.slice(0, desiredIndex),
    existing,
    ...destWithoutItem.slice(desiredIndex),
  ]
  const updatedColumnItems: MeetingBoardItem[] = []
  let movedItem: MeetingBoardItem | undefined

  assembled.forEach((entry, idx) => {
    const cleanOrder = (idx + 1) * BOARD_ORDER_STEP
    if (entry.id === existing.id) {
      const stamp = nextCausalStamp(entry, state.tombstones[entry.id], params.nowMs)
      movedItem = {
        ...entry,
        kind: params.targetKind,
        order: cleanOrder,
        updatedAt: stamp.iso,
        revision: stamp.revision,
        updatedBy: params.actorId,
      }
      updatedColumnItems.push(movedItem)
    } else if (entry.order !== cleanOrder) {
      const stamp = nextCausalStamp(entry, state.tombstones[entry.id], params.nowMs)
      updatedColumnItems.push({
        ...entry,
        order: cleanOrder,
        updatedAt: stamp.iso,
        revision: stamp.revision,
        updatedBy: params.actorId,
      })
    }
  })

  const nextState = reconcileBoardSnapshots(state, { items: updatedColumnItems })
  const finalColItems = getSortedColumnItems(nextState.items, params.targetKind)
  const finalIndex = finalColItems.findIndex((item) => item.id === existing.id)
  return {
    state: nextState,
    movedItem,
    targetIndex: finalIndex >= 0 ? finalIndex : desiredIndex,
    columnCount: finalColItems.length,
    message: buildBoardSyncStateMessage(nextState, { readOnly: false, roomId: params.roomId }),
  }
}

export function moveBoardItemRelative(
  state: BoardState,
  params: {
    itemId: string
    direction: BoardMoveDirection
    actorId: string
    roomId?: string
    readOnly?: boolean
    nowMs?: number
  }
) {
  if (params.readOnly) return { state, message: null }
  const existing = state.items.find((item) => item.id === params.itemId)
  if (!existing) return { state, message: null }
  const colItems = getSortedColumnItems(state.items, existing.kind)
  const currentIndex = colItems.findIndex((item) => item.id === existing.id)
  if (currentIndex < 0) return { state, message: null }

  let targetIndex: number
  switch (params.direction) {
    case 'up':
      targetIndex = currentIndex - 1
      break
    case 'down':
      targetIndex = currentIndex + 1
      break
    case 'top':
      targetIndex = 0
      break
    case 'bottom':
      targetIndex = colItems.length - 1
      break
  }

  return moveBoardItem(state, {
    itemId: existing.id,
    targetKind: existing.kind,
    targetIndex,
    actorId: params.actorId,
    roomId: params.roomId,
    readOnly: params.readOnly,
    nowMs: params.nowMs,
  })
}

export function areBoardStatesEqual(a: BoardState, b: BoardState): boolean {
  if (a.items.length !== b.items.length) return false
  const aTombKeys = Object.keys(a.tombstones)
  const bTombKeys = Object.keys(b.tombstones)
  if (aTombKeys.length !== bTombKeys.length) return false

  for (let i = 0; i < a.items.length; i++) {
    const left = a.items[i]
    const right = b.items[i]
    if (
      left.id !== right.id ||
      left.kind !== right.kind ||
      left.title !== right.title ||
      (left.description ?? '') !== (right.description ?? '') ||
      Boolean(left.completed) !== Boolean(right.completed) ||
      left.author !== right.author ||
      left.createdAt !== right.createdAt ||
      left.updatedAt !== right.updatedAt ||
      left.order !== right.order ||
      (left.revision ?? 0) !== (right.revision ?? 0) ||
      (left.updatedBy ?? '') !== (right.updatedBy ?? '')
    ) {
      return false
    }
  }

  for (const key of aTombKeys) {
    const left = a.tombstones[key]
    const right = b.tombstones[key]
    if (
      !right ||
      left.id !== right.id ||
      left.deletedAt !== right.deletedAt ||
      left.revision !== right.revision ||
      (left.deletedBy ?? '') !== (right.deletedBy ?? '')
    ) {
      return false
    }
  }

  return true
}
