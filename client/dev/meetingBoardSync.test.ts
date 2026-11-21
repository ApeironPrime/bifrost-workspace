import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyLocalBoardMessage,
  applyPeerBoardMessage,
  BOARD_ORDER_STEP,
  buildBoardSyncStateMessage,
  createBoardItem,
  deleteBoardItem,
  getSortedColumnItems,
  moveBoardItem,
  moveBoardItemRelative,
  readRoomBoard,
  reconcileBoardSnapshots,
  resolveVisualDropSlotToTargetIndex,
  roomBoardKey,
  toggleBoardItemComplete,
  updateBoardItem,
  writeRoomBoard,
  writeRoomBoardDetailed,
  type BoardState,
  type MeetingBoardItem,
  type MeetingBoardMessage,
} from '../src/lib/roomUiState.ts'

function createMemoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
    removeItem: (key: string) => {
      map.delete(key)
    },
  }
}

const emptyState: BoardState = { items: [], tombstones: {} }

test('1-2: board snapshot persists across reload and stays isolated across users, workspaces, and rooms', () => {
  const store = createMemoryStorage()
  const roomAScope = { userId: 'user-1', workspaceId: 'ws-1', roomId: 'room-a' }
  const roomBScope = { userId: 'user-1', workspaceId: 'ws-1', roomId: 'room-b' }
  const user2Scope = { userId: 'user-2', workspaceId: 'ws-1', roomId: 'room-a' }

  const { state: createdState } = createBoardItem(emptyState, {
    id: 'card-a',
    kind: 'decision',
    title: 'Ship API v1',
    description: 'Freeze contract today',
    author: 'Alice',
    actorId: 'user-1',
    roomId: 'room-a',
    nowMs: 1_700_000_001_000,
  })

  writeRoomBoard(store, roomBoardKey(roomAScope.userId, roomAScope.workspaceId, roomAScope.roomId), {
    ...roomAScope,
    ...createdState,
  })

  // Reload simulation in Room A recovers card
  const reloadedA = readRoomBoard(
    store,
    roomBoardKey(roomAScope.userId, roomAScope.workspaceId, roomAScope.roomId),
    roomAScope
  )
  assert.equal(reloadedA.items.length, 1)
  assert.equal(reloadedA.items[0]?.id, 'card-a')
  assert.equal(reloadedA.items[0]?.revision, 1)

  // Room B and User 2 see empty snapshots
  assert.equal(
    readRoomBoard(
      store,
      roomBoardKey(roomBScope.userId, roomBScope.workspaceId, roomBScope.roomId),
      roomBScope
    ).items.length,
    0
  )
  assert.equal(
    readRoomBoard(
      store,
      roomBoardKey(user2Scope.userId, user2Scope.workspaceId, user2Scope.roomId),
      user2Scope
    ).items.length,
    0
  )
})

test('3-4: create, update, toggle complete, and move increment revision and synchronize deterministically', () => {
  const { state: s1, message: createMsg } = createBoardItem(emptyState, {
    id: 'item-1',
    kind: 'agenda',
    title: 'Initial topic',
    author: 'Alice',
    actorId: 'alice',
    roomId: 'room-1',
    nowMs: 1_700_000_001_000,
  })
  assert.ok(createMsg && createMsg.type === 'meeting-board:item-create')
  assert.equal(s1.items[0]?.revision, 1)

  // Peer B receives create
  const aliceSender = { userId: 'alice', name: 'Alice' }
  let peerB = applyPeerBoardMessage(emptyState, createMsg, { roomId: 'room-1', sender: aliceSender })
  assert.equal(peerB.items.length, 1)

  // Peer A updates title/description, toggles completion, and moves column
  const { state: s2, message: updateMsg } = updateBoardItem(s1, {
    itemId: 'item-1',
    title: 'Updated topic',
    description: 'Clarified scope',
    actorId: 'alice',
    roomId: 'room-1',
    nowMs: 1_700_000_002_000,
  })
  assert.ok(updateMsg && updateMsg.type === 'meeting-board:item-update')
  assert.equal(s2.items[0]?.revision, 2)

  const { state: s3, message: toggleMsg } = toggleBoardItemComplete(s2, {
    itemId: 'item-1',
    actorId: 'alice',
    roomId: 'room-1',
    nowMs: 1_700_000_003_000,
  })
  assert.ok(toggleMsg)
  assert.equal(s3.items[0]?.completed, true)
  assert.equal(s3.items[0]?.revision, 3)

  const { state: s4, message: moveMsg } = moveBoardItem(s3, {
    itemId: 'item-1',
    targetKind: 'action',
    actorId: 'alice',
    roomId: 'room-1',
    nowMs: 1_700_000_004_000,
  })
  assert.ok(moveMsg && moveMsg.type === 'meeting-board:item-move')
  assert.equal(s4.items[0]?.kind, 'action')
  assert.equal(s4.items[0]?.revision, 4)

  // Peer B applies messages and converges cleanly
  peerB = applyPeerBoardMessage(peerB, updateMsg, { roomId: 'room-1', sender: aliceSender })
  peerB = applyPeerBoardMessage(peerB, toggleMsg!, { roomId: 'room-1', sender: aliceSender })
  peerB = applyPeerBoardMessage(peerB, moveMsg, { roomId: 'room-1', sender: aliceSender })
  assert.deepEqual(peerB.items, s4.items)
})

test('5-6: delete records tombstone and prevents stale update, stale move, or old snapshot from resurrecting item', () => {
  const aliceSender = { userId: 'alice', name: 'Alice' }
  const bobSender = { userId: 'bob', name: 'Bob' }
  const { state: initial } = createBoardItem(emptyState, {
    id: 'item-del',
    kind: 'agenda',
    title: 'Obsolete task',
    author: 'Alice',
    actorId: 'alice',
    roomId: 'room-1',
    nowMs: 1_700_000_001_000,
  })

  // Stale update snapshot from earlier offline edit (t = +2000)
  const { state: staleUpdatedState, message: staleUpdateMsg } = updateBoardItem(initial, {
    itemId: 'item-del',
    title: 'Offline edit before delete',
    actorId: 'bob',
    roomId: 'room-1',
    nowMs: 1_700_000_002_000,
  })

  // Delete happened later (t = +5000)
  const { state: deletedState, message: deleteMsg } = deleteBoardItem(initial, {
    itemId: 'item-del',
    actorId: 'alice',
    roomId: 'room-1',
    nowMs: 1_700_000_005_000,
  })
  assert.equal(deletedState.items.length, 0)
  assert.ok(deletedState.tombstones['item-del'])
  assert.ok(deleteMsg && deleteMsg.type === 'meeting-board:item-delete')

  // Order A: Delete already known -> stale item-update, stale item-move, and stale sync-state arrive
  let peerAfterDelete = applyPeerBoardMessage(deletedState, staleUpdateMsg!, { roomId: 'room-1', sender: bobSender })
  peerAfterDelete = applyPeerBoardMessage(
    peerAfterDelete,
    {
      type: 'meeting-board:item-move',
      roomId: 'room-1',
      itemId: 'item-del',
      targetKind: 'parking',
      targetOrder: 0,
      updatedAt: new Date(1_700_000_003_000).toISOString(),
      revision: 3,
      updatedBy: 'bob',
    },
    { roomId: 'room-1', sender: bobSender }
  )
  peerAfterDelete = applyPeerBoardMessage(
    peerAfterDelete,
    {
      type: 'meeting-board:sync-state',
      roomId: 'room-1',
      items: staleUpdatedState.items,
    },
    { roomId: 'room-1', sender: bobSender }
  )
  assert.equal(peerAfterDelete.items.length, 0)
  assert.ok(peerAfterDelete.tombstones['item-del'])

  // Order B: Peer holds stale update first, then receives sync-state with tombstone from peer that has 0 items
  const replyWithTombstone = buildBoardSyncStateMessage(deletedState, {
    readOnly: false,
    roomId: 'room-1',
  })
  assert.ok(replyWithTombstone)
  const syncedOfflinePeer = applyPeerBoardMessage(staleUpdatedState, replyWithTombstone, {
    roomId: 'room-1',
    sender: aliceSender,
  })
  assert.equal(syncedOfflinePeer.items.length, 0)
  assert.ok(syncedOfflinePeer.tombstones['item-del'])

  // Equal timestamp + equal revision tie-break: delete wins over concurrent update regardless of arrival order
  const concurrentUpdate: BoardState = {
    items: [
      {
        id: 'tie-item',
        kind: 'agenda',
        title: 'Concurrent edit',
        author: 'Bob',
        createdAt: new Date(1_700_000_001_000).toISOString(),
        updatedAt: new Date(1_700_000_010_000).toISOString(),
        order: 0,
        revision: 2,
        updatedBy: 'zzz-actor',
      },
    ],
    tombstones: {},
  }
  const concurrentDeleteMsg: MeetingBoardMessage = {
    type: 'meeting-board:item-delete',
    roomId: 'room-1',
    itemId: 'tie-item',
    deletedAt: new Date(1_700_000_010_000).toISOString(),
    revision: 2,
    deletedBy: 'aaa-actor',
  }
  const aaaSender = { userId: 'aaa-actor', name: 'Actor A' }
  const zzzSender = { userId: 'zzz-actor', name: 'Bob' }
  const res1 = applyPeerBoardMessage(concurrentUpdate, concurrentDeleteMsg, { roomId: 'room-1', sender: aaaSender })
  const res2 = applyPeerBoardMessage(
    applyPeerBoardMessage(emptyState, concurrentDeleteMsg, { roomId: 'room-1', sender: aaaSender }),
    { type: 'meeting-board:sync-state', items: concurrentUpdate.items, roomId: 'room-1' },
    { roomId: 'room-1', sender: zzzSender }
  )
  assert.equal(res1.items.length, 0)
  assert.equal(res2.items.length, 0)
})

test('7: concurrent updates by two peers converge deterministically regardless of arrival order (even with clock skew or same ms)', () => {
  const userASender = { userId: 'user-a', name: 'Alice' }
  const userBSender = { userId: 'user-b', name: 'Bob' }
  const userCSender = { userId: 'user-c', name: 'Charlie' }
  const { state: base } = createBoardItem(emptyState, {
    id: 'shared-1',
    kind: 'agenda',
    title: 'Draft spec',
    author: 'Alice',
    actorId: 'user-a',
    roomId: 'room-1',
    nowMs: 1_700_000_010_000,
  })

  // Concurrent updates at identical ms & revision: actorId tie-break guarantees convergence
  const editFromA = updateBoardItem(base, {
    itemId: 'shared-1',
    title: 'Version from A',
    actorId: 'user-a',
    roomId: 'room-1',
    nowMs: 1_700_000_020_000,
  })
  const editFromB = updateBoardItem(base, {
    itemId: 'shared-1',
    title: 'Version from B',
    actorId: 'user-b',
    roomId: 'room-1',
    nowMs: 1_700_000_020_000,
  })

  const orderAB = applyPeerBoardMessage(editFromA.state, editFromB.message!, { roomId: 'room-1', sender: userBSender })
  const orderBA = applyPeerBoardMessage(editFromB.state, editFromA.message!, { roomId: 'room-1', sender: userASender })
  assert.deepEqual(orderAB.items, orderBA.items)
  assert.equal(orderAB.items[0]?.title, 'Version from B')

  // Causal clock skew safety: Peer A clock far in future (+60s), Peer B receives item and later edits with slower local clock
  const skewedItem: MeetingBoardItem = {
    id: 'skew-1',
    kind: 'agenda',
    title: 'From skewed clock',
    author: 'Alice',
    createdAt: new Date(1_700_000_060_000).toISOString(),
    updatedAt: new Date(1_700_000_060_000).toISOString(),
    order: 0,
    revision: 1,
    updatedBy: 'user-a',
  }
  const peerBHasSkewed = applyPeerBoardMessage(
    emptyState,
    {
      type: 'meeting-board:item-create',
      item: skewedItem,
    },
    { sender: userASender },
  )
  const { state: peerBEdited, message: peerBEditMsg } = updateBoardItem(peerBHasSkewed, {
    itemId: 'skew-1',
    title: 'Edited later despite slower wall clock',
    actorId: 'user-b',
    nowMs: 1_700_000_001_000, // much earlier wall clock than 60_000!
  })
  assert.ok(peerBEditMsg && peerBEditMsg.type === 'meeting-board:item-update')
  assert.equal(peerBEditMsg.item.revision, 2)
  // Genuine wall-clock timestamp preserved without artificial future warping
  assert.equal(peerBEditMsg.item.updatedAt, new Date(1_700_000_001_000).toISOString())

  const peerAWithEdit = applyPeerBoardMessage({ items: [skewedItem], tombstones: {} }, peerBEditMsg, {
    sender: userBSender,
  })
  assert.equal(peerAWithEdit.items[0]?.title, 'Edited later despite slower wall clock')
  assert.deepEqual(peerAWithEdit.items, peerBEdited.items)

  // Stale lower-revision update with even larger skewed clock MUST NOT overwrite higher causal revision
  const staleFutureUpdate: MeetingBoardItem = {
    ...skewedItem,
    title: 'Stale rev 1 from year+ clock skew',
    updatedAt: new Date(1_900_000_000_000).toISOString(),
    revision: 1,
    updatedBy: 'user-c',
  }
  const stillRev2 = applyPeerBoardMessage(
    peerAWithEdit,
    {
      type: 'meeting-board:item-update',
      item: staleFutureUpdate,
    },
    { sender: userCSender },
  )
  assert.equal(stillRev2.items[0]?.title, 'Edited later despite slower wall clock')
  assert.equal(stillRev2.items[0]?.revision, 2)
})

test('8: legacy peer compatibility & delayed unversioned legacy delete safety', () => {
  const legacySender = { userId: 'legacy-peer', name: 'LegacyPeer' }
  const { state: initial } = createBoardItem(emptyState, {
    id: 'legacy-item',
    kind: 'agenda',
    title: 'Updated locally',
    author: 'Alice',
    actorId: 'alice',
    roomId: 'room-1',
    nowMs: 1_700_000_010_000,
  })
  const { state: updatedLegacyItem } = updateBoardItem(initial, {
    itemId: 'legacy-item',
    title: 'Updated v2 locally',
    actorId: 'alice',
    roomId: 'room-1',
    nowMs: 1_700_000_012_000,
  })
  const { state: afterDelete } = createBoardItem(updatedLegacyItem, {
    id: 'deleted-legacy-item',
    kind: 'decision',
    title: 'To delete',
    author: 'Alice',
    actorId: 'alice',
    roomId: 'room-1',
    nowMs: 1_700_000_010_000,
  })
  const { state: withTombstone } = deleteBoardItem(afterDelete, {
    itemId: 'deleted-legacy-item',
    actorId: 'alice',
    roomId: 'room-1',
    nowMs: 1_700_000_020_000,
  })

  // Legacy sync-state omits tombstones, roomId, revision, updatedBy and carries stale copies (even with skewed future ts)
  const legacySync: MeetingBoardMessage = {
    type: 'meeting-board:sync-state',
    items: [
      {
        id: 'legacy-item',
        kind: 'agenda',
        title: 'Stale legacy title',
        author: 'Alice',
        createdAt: new Date(1_700_000_005_000).toISOString(),
        updatedAt: new Date(1_900_000_000_000).toISOString(),
        order: 0,
      },
      {
        id: 'deleted-legacy-item',
        kind: 'decision',
        title: 'Should NOT resurrect',
        author: 'Alice',
        createdAt: new Date(1_700_000_010_000).toISOString(),
        updatedAt: new Date(1_700_000_015_000).toISOString(),
        order: 0,
      },
      {
        id: 'new-from-legacy',
        kind: 'parking',
        title: 'Genuinely created on legacy peer',
        author: 'LegacyUser',
        createdAt: new Date(1_700_000_018_000).toISOString(),
        updatedAt: new Date(1_700_000_018_000).toISOString(),
        order: 0,
      },
    ],
  }

  const merged = applyPeerBoardMessage(withTombstone, legacySync, { roomId: 'room-1', sender: legacySender })
  assert.equal(merged.items.find((i) => i.id === 'legacy-item')?.title, 'Updated v2 locally')
  assert.equal(merged.items.some((i) => i.id === 'deleted-legacy-item'), false)
  assert.equal(
    merged.items.find((i) => i.id === 'new-from-legacy')?.title,
    'Genuinely created on legacy peer'
  )

  // Delayed legacy delete (missing deletedAt & revision) arriving AFTER versioned update MUST NOT
  // fabricate receiver timestamp/revision to wrongly delete the updated versioned item
  const afterDelayedLegacyDelete = applyPeerBoardMessage(
    merged,
    { type: 'meeting-board:item-delete', itemId: 'legacy-item' },
    { roomId: 'room-1', sender: legacySender, nowMs: 1_999_999_999_000 }
  )
  assert.equal(
    afterDelayedLegacyDelete.items.find((i) => i.id === 'legacy-item')?.title,
    'Updated v2 locally'
  )
  assert.equal(afterDelayedLegacyDelete.items.find((i) => i.id === 'legacy-item')?.revision, 2)
  assert.equal(afterDelayedLegacyDelete.tombstones['legacy-item'], undefined)

  // Unversioned legacy item (revision absent / 0) deleted via legacy item-delete still converges safely without receiver clock fabrication
  const afterUnversionedLegacyDelete = applyPeerBoardMessage(
    afterDelayedLegacyDelete,
    { type: 'meeting-board:item-delete', itemId: 'new-from-legacy' },
    { roomId: 'room-1', sender: legacySender, nowMs: 1_700_000_030_000 }
  )
  assert.equal(afterUnversionedLegacyDelete.items.some((i) => i.id === 'new-from-legacy'), false)
  assert.equal(afterUnversionedLegacyDelete.tombstones['new-from-legacy']?.revision, 0)
  assert.equal(
    afterUnversionedLegacyDelete.tombstones['new-from-legacy']?.deletedAt,
    '1970-01-01T00:00:00.000Z'
  )
})

test('9: readOnly viewer cannot mutate or broadcast sync-state from stale cache, yet still caches valid incoming peer updates', () => {
  const store = createMemoryStorage()
  const viewerScope = { userId: 'viewer-1', workspaceId: 'ws-1', roomId: 'room-1' }
  const viewerKey = roomBoardKey(viewerScope.userId, viewerScope.workspaceId, viewerScope.roomId)

  // Simulate demoted viewer who previously cached a card locally
  const staleCache: BoardState = {
    items: [
      {
        id: 'stale-viewer-card',
        kind: 'agenda',
        title: 'Cached before demotion',
        author: 'Viewer',
        createdAt: new Date(1_700_000_001_000).toISOString(),
        updatedAt: new Date(1_700_000_001_000).toISOString(),
        order: 0,
        revision: 1,
        updatedBy: 'viewer-1',
      },
    ],
    tombstones: {},
  }

  assert.equal(
    createBoardItem(staleCache, {
      kind: 'agenda',
      title: 'Unauthorized',
      author: 'Viewer',
      actorId: 'viewer-1',
      readOnly: true,
    }).message,
    null
  )
  assert.equal(
    updateBoardItem(staleCache, {
      itemId: 'stale-viewer-card',
      title: 'Unauthorized edit',
      actorId: 'viewer-1',
      readOnly: true,
    }).message,
    null
  )
  assert.equal(
    toggleBoardItemComplete(staleCache, {
      itemId: 'stale-viewer-card',
      actorId: 'viewer-1',
      readOnly: true,
    }).message,
    null
  )
  assert.equal(
    deleteBoardItem(staleCache, {
      itemId: 'stale-viewer-card',
      actorId: 'viewer-1',
      readOnly: true,
    }).message,
    null
  )
  assert.equal(
    moveBoardItem(staleCache, {
      itemId: 'stale-viewer-card',
      targetKind: 'action',
      actorId: 'viewer-1',
      readOnly: true,
    }).message,
    null
  )

  // Read-only peer must NOT emit sync-state to peers even if local cache has items
  assert.equal(buildBoardSyncStateMessage(staleCache, { readOnly: true, roomId: 'room-1' }), null)

  // Read-only peer STILL accepts valid sync-state from authorized peer and caches locally
  const hostItem: MeetingBoardItem = {
    id: 'host-card',
    kind: 'decision',
    title: 'Authoritative host card',
    author: 'Host',
    createdAt: new Date(1_700_000_002_000).toISOString(),
    updatedAt: new Date(1_700_000_002_000).toISOString(),
    order: 0,
    revision: 1,
    updatedBy: 'host-1',
  }
  const viewerAfterSync = applyPeerBoardMessage(
    staleCache,
    { type: 'meeting-board:sync-state', roomId: 'room-1', items: [hostItem] },
    { roomId: 'room-1', sender: { userId: 'host-1', name: 'Host' } }
  )
  writeRoomBoard(store, viewerKey, { ...viewerScope, ...viewerAfterSync })

  const cachedForViewer = readRoomBoard(store, viewerKey, viewerScope)
  assert.equal(cachedForViewer.items.some((i) => i.id === 'host-card'), true)
})

test('10: switching rooms restores each room snapshot cleanly and ignores mismatched roomId messages', () => {
  const store = createMemoryStorage()
  const scopeA = { userId: 'u-1', workspaceId: 'ws-1', roomId: 'room-alpha' }
  const scopeB = { userId: 'u-1', workspaceId: 'ws-1', roomId: 'room-beta' }
  const keyA = roomBoardKey(scopeA.userId, scopeA.workspaceId, scopeA.roomId)
  const keyB = roomBoardKey(scopeB.userId, scopeB.workspaceId, scopeB.roomId)

  const stateA = createBoardItem(emptyState, {
    id: 'alpha-1',
    kind: 'agenda',
    title: 'Alpha agenda',
    author: 'U1',
    actorId: 'u-1',
    roomId: 'room-alpha',
    nowMs: 1_700_000_001_000,
  }).state
  writeRoomBoard(store, keyA, { ...scopeA, ...stateA })

  // Switch to Room Beta (empty), create item in Beta
  const loadedB = readRoomBoard(store, keyB, scopeB)
  assert.equal(loadedB.items.length, 0)

  const { state: stateB, message: msgFromB } = createBoardItem(loadedB, {
    id: 'beta-1',
    kind: 'action',
    title: 'Beta action',
    author: 'U1',
    actorId: 'u-1',
    roomId: 'room-beta',
    nowMs: 1_700_000_002_000,
  })
  writeRoomBoard(store, keyB, { ...scopeB, ...stateB })

  // Switch back to Room Alpha and verify message from Beta is ignored if tagged room-beta
  const loadedA = readRoomBoard(store, keyA, scopeA)
  const guardedA = applyPeerBoardMessage(loadedA, msgFromB!, {
    roomId: 'room-alpha',
    sender: { userId: 'u-1', name: 'U1' },
  })
  assert.deepEqual(guardedA.items.map((i) => i.id), ['alpha-1'])

  // Check Room Beta remains untouched
  const reloadedB = readRoomBoard(store, keyB, scopeB)
  assert.deepEqual(reloadedB.items.map((i) => i.id), ['beta-1'])

  // Malformed reconcile input is safely skipped
  const sanitized = reconcileBoardSnapshots(emptyState, {
    items: [{ bad: true }, stateA.items[0]],
    tombstones: { 'bad-tomb': { deletedAt: 123 } },
  })
  assert.equal(sanitized.items.length, 1)
  assert.deepEqual(sanitized.tombstones, {})
})

test('11: synchronous mutation flush recovers across immediate reload and storage failure blocks false success', () => {
  const store = createMemoryStorage()
  const scope = { userId: 'u-1', workspaceId: 'ws-1', roomId: 'room-reload' }
  const key = roomBoardKey(scope.userId, scope.workspaceId, scope.roomId)

  // Mutation applied & flushed immediately before any async effect tick
  const { state: created, message: createMsg } = createBoardItem(emptyState, {
    id: 'instant-reload-card',
    kind: 'action',
    title: 'Saved before reload',
    author: 'U1',
    actorId: 'u-1',
    roomId: scope.roomId,
    nowMs: 1_700_000_001_000,
  })
  assert.ok(createMsg)
  const applied = applyLocalBoardMessage(emptyState, createMsg, { roomId: scope.roomId })
  const saveRes = writeRoomBoardDetailed(store, key, { ...scope, ...applied })
  assert.equal(saveRes.ok, true)
  assert.equal(saveRes.status, 'ok')
  assert.deepEqual(created.items, readRoomBoard(store, key, scope).items)

  // QuotaExceededError must report failure explicitly so UI does not claim save succeeded
  const quotaStore = {
    getItem: () => null,
    setItem: () => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    },
  }
  const failRes = writeRoomBoardDetailed(quotaStore, key, { ...scope, ...applied })
  assert.equal(failRes.ok, false)
  assert.equal(failRes.status, 'storage-error')
})

test('12: H2 same-column reordering, relative keyboard moves, and visual slot resolution', () => {
  let state = emptyState
  const ids = ['c1', 'c2', 'c3', 'c4']
  ids.forEach((id, idx) => {
    state = createBoardItem(state, {
      id,
      kind: 'agenda',
      title: `Card ${idx + 1}`,
      author: 'Alice',
      actorId: 'u-1',
      roomId: 'room-h2',
      nowMs: 1_700_000_010_000 + idx * 100,
    }).state
  })

  // Initial sparse orders are strictly increasing multiples of BOARD_ORDER_STEP
  assert.deepEqual(
    getSortedColumnItems(state.items, 'agenda').map((item) => item.id),
    ['c1', 'c2', 'c3', 'c4'],
  )
  assert.deepEqual(
    getSortedColumnItems(state.items, 'agenda').map((item) => item.order),
    [1, 2, 3, 4].map((n) => n * BOARD_ORDER_STEP),
  )

  // Move c1 to index 2 (middle)
  const moveMid = moveBoardItem(state, {
    itemId: 'c1',
    targetKind: 'agenda',
    targetIndex: 2,
    actorId: 'u-1',
    roomId: 'room-h2',
    nowMs: 1_700_000_011_000,
  })
  assert.ok(moveMid.message)
  assert.equal(moveMid.message.type, 'meeting-board:item-move')
  assert.equal(moveMid.targetIndex, 2)
  assert.equal(moveMid.columnCount, 4)
  state = moveMid.state
  assert.deepEqual(
    getSortedColumnItems(state.items, 'agenda').map((item) => item.id),
    ['c2', 'c3', 'c1', 'c4'],
  )

  // Move c4 to top (index 0) and c2 to bottom (clamped targetIndex)
  state = moveBoardItem(state, {
    itemId: 'c4',
    targetKind: 'agenda',
    targetIndex: 0,
    actorId: 'u-1',
    nowMs: 1_700_000_012_000,
  }).state
  state = moveBoardItem(state, {
    itemId: 'c2',
    targetKind: 'agenda',
    targetIndex: 99,
    actorId: 'u-1',
    nowMs: 1_700_000_013_000,
  }).state
  assert.deepEqual(
    getSortedColumnItems(state.items, 'agenda').map((item) => item.id),
    ['c4', 'c3', 'c1', 'c2'],
  )

  // Relative keyboard moves: up / down / top / bottom
  const upC1 = moveBoardItemRelative(state, {
    itemId: 'c1',
    direction: 'up',
    actorId: 'u-1',
    nowMs: 1_700_000_014_000,
  })
  assert.equal(upC1.targetIndex, 1)
  state = upC1.state
  assert.deepEqual(
    getSortedColumnItems(state.items, 'agenda').map((item) => item.id),
    ['c4', 'c1', 'c3', 'c2'],
  )

  state = moveBoardItemRelative(state, {
    itemId: 'c4',
    direction: 'bottom',
    actorId: 'u-1',
    nowMs: 1_700_000_015_000,
  }).state
  state = moveBoardItemRelative(state, {
    itemId: 'c3',
    direction: 'top',
    actorId: 'u-1',
    nowMs: 1_700_000_016_000,
  }).state
  state = moveBoardItemRelative(state, {
    itemId: 'c3',
    direction: 'down',
    actorId: 'u-1',
    nowMs: 1_700_000_017_000,
  }).state
  assert.deepEqual(
    getSortedColumnItems(state.items, 'agenda').map((item) => item.id),
    ['c1', 'c3', 'c2', 'c4'],
  )

  // No-op boundaries return message: null cleanly
  assert.equal(
    moveBoardItemRelative(state, { itemId: 'c1', direction: 'up', actorId: 'u-1' }).message,
    null,
  )
  assert.equal(
    moveBoardItemRelative(state, { itemId: 'c4', direction: 'bottom', actorId: 'u-1' }).message,
    null,
  )
  assert.equal(
    moveBoardItem(state, { itemId: 'c3', targetKind: 'agenda', targetIndex: 1, actorId: 'u-1' }).message,
    null,
  )

  // Visual drop slot index resolution (before/after slots adjust when moving down in same column)
  const colItems = getSortedColumnItems(state.items, 'agenda') // [c1, c3, c2, c4]
  assert.equal(resolveVisualDropSlotToTargetIndex({ columnItems: colItems, draggedItemId: 'c1', rawSlotIndex: 3 }), 2)
  assert.equal(resolveVisualDropSlotToTargetIndex({ columnItems: colItems, draggedItemId: 'c2', rawSlotIndex: 1 }), 1)
  assert.equal(resolveVisualDropSlotToTargetIndex({ columnItems: colItems, draggedItemId: 'other-col', rawSlotIndex: 2 }), 2)
})

test('13: H2 cross-column positional drops, tie/exhaustion rebalance, and P2P convergence', () => {
  let peerA = emptyState
  ;['a1', 'a2'].forEach((id, idx) => {
    peerA = createBoardItem(peerA, {
      id,
      kind: 'agenda',
      title: id.toUpperCase(),
      author: 'Alice',
      actorId: 'u-a',
      roomId: 'r1',
      nowMs: 1_700_000_020_000 + idx,
    }).state
  })
  ;['d1', 'd2', 'd3'].forEach((id, idx) => {
    peerA = createBoardItem(peerA, {
      id,
      kind: 'decision',
      title: id.toUpperCase(),
      author: 'Alice',
      actorId: 'u-a',
      roomId: 'r1',
      nowMs: 1_700_000_020_100 + idx,
    }).state
  })

  let peerB = reconcileBoardSnapshots(emptyState, peerA)

  // Move a1 to middle (index 1) of decision column; move a2 into empty parking column (index 0)
  const userASender = { userId: 'u-a', name: 'User A' }
  const crossMid = moveBoardItem(peerA, {
    itemId: 'a1',
    targetKind: 'decision',
    targetIndex: 1,
    actorId: 'u-a',
    roomId: 'r1',
    nowMs: 1_700_000_021_000,
  })
  assert.ok(crossMid.message)
  assert.equal(crossMid.message.type, 'meeting-board:item-move')
  peerA = crossMid.state
  peerB = applyPeerBoardMessage(peerB, crossMid.message, { roomId: 'r1', sender: userASender })

  const toEmpty = moveBoardItem(peerA, {
    itemId: 'a2',
    targetKind: 'parking',
    targetIndex: 0,
    actorId: 'u-a',
    roomId: 'r1',
    nowMs: 1_700_000_022_000,
  })
  assert.ok(toEmpty.message)
  peerA = toEmpty.state
  peerB = applyPeerBoardMessage(peerB, toEmpty.message, { roomId: 'r1', sender: userASender })

  assert.deepEqual(
    getSortedColumnItems(peerA.items, 'decision').map((i) => i.id),
    ['d1', 'a1', 'd2', 'd3'],
  )
  assert.deepEqual(
    getSortedColumnItems(peerB.items, 'decision').map((i) => i.id),
    ['d1', 'a1', 'd2', 'd3'],
  )
  assert.deepEqual(
    getSortedColumnItems(peerB.items, 'parking').map((i) => i.id),
    ['a2'],
  )

  // Force equal-order tie on two items and exhaust bisection across 60 swaps; column must rebalance and sync cleanly
  let tieState: BoardState = {
    items: [
      { id: 't1', kind: 'action', title: 'T1', author: 'A', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', order: 0, revision: 1 },
      { id: 't2', kind: 'action', title: 'T2', author: 'A', createdAt: '2026-01-01T00:00:01Z', updatedAt: '2026-01-01T00:00:01Z', order: 0, revision: 1 },
      { id: 't3', kind: 'action', title: 'T3', author: 'A', createdAt: '2026-01-01T00:00:02Z', updatedAt: '2026-01-01T00:00:02Z', order: 0, revision: 1 },
    ],
    tombstones: {},
  }
  const tieMove = moveBoardItem(tieState, {
    itemId: 't3',
    targetKind: 'action',
    targetIndex: 1,
    actorId: 'u-a',
    roomId: 'r1',
    nowMs: 1_700_000_030_000,
  })
  assert.ok(tieMove.message)
  assert.equal(tieMove.message.type, 'meeting-board:sync-state')
  tieState = tieMove.state
  assert.deepEqual(
    getSortedColumnItems(tieState.items, 'action').map((i) => i.id),
    ['t1', 't3', 't2'],
  )

  // Peer applying sync-state converges to exact same order
  const syncedPeer = applyPeerBoardMessage(emptyState, tieMove.message, { roomId: 'r1', sender: userASender })
  assert.deepEqual(
    getSortedColumnItems(syncedPeer.items, 'action').map((i) => i.id),
    ['t1', 't3', 't2'],
  )

  // 60 repeated bisections between t1 and t2 never lose strict monotonic ordering
  for (let step = 0; step < 60; step++) {
    const res = moveBoardItem(tieState, {
      itemId: step % 2 === 0 ? 't2' : 't1',
      targetKind: 'action',
      targetIndex: 1,
      actorId: 'u-a',
      roomId: 'r1',
      nowMs: 1_700_000_040_000 + step,
    })
    assert.ok(res.message)
    tieState = res.state
    const ordered = getSortedColumnItems(tieState.items, 'action')
    assert.ok(ordered[0].order < ordered[1].order && ordered[1].order < ordered[2].order)
  }
})

test('14: H2 readOnly, missing/deleted cards, invalid indices, persistence, and C1 move reconciliation', () => {
  const store = createMemoryStorage()
  const scopeA = { userId: 'u-1', workspaceId: 'ws-1', roomId: 'room-h2-a' }
  const scopeB = { userId: 'u-1', workspaceId: 'ws-1', roomId: 'room-h2-b' }

  let stateA = emptyState
  stateA = createBoardItem(stateA, {
    id: 'm1',
    kind: 'agenda',
    title: 'First',
    author: 'Alice',
    actorId: 'u-1',
    roomId: scopeA.roomId,
    nowMs: 1_700_000_050_000,
  }).state
  stateA = createBoardItem(stateA, {
    id: 'm2',
    kind: 'agenda',
    title: 'Second',
    author: 'Alice',
    actorId: 'u-1',
    roomId: scopeA.roomId,
    nowMs: 1_700_000_050_100,
  }).state
  const stateB = createBoardItem(emptyState, {
    id: 'b1',
    kind: 'agenda',
    title: 'Other room',
    author: 'Alice',
    actorId: 'u-1',
    roomId: scopeB.roomId,
    nowMs: 1_700_000_050_200,
  }).state
  writeRoomBoard(store, roomBoardKey(scopeB.userId, scopeB.workspaceId, scopeB.roomId), {
    ...scopeB,
    ...stateB,
  })

  // VIEWER / readOnly blocks both direct and relative moves
  assert.equal(
    moveBoardItem(stateA, {
      itemId: 'm2',
      targetKind: 'agenda',
      targetIndex: 0,
      actorId: 'viewer-1',
      readOnly: true,
    }).message,
    null,
  )
  assert.equal(
    moveBoardItemRelative(stateA, {
      itemId: 'm2',
      direction: 'up',
      actorId: 'viewer-1',
      readOnly: true,
    }).message,
    null,
  )

  // Missing ID and invalid non-finite targetIndex reject cleanly
  assert.equal(
    moveBoardItem(stateA, { itemId: 'does-not-exist', targetKind: 'decision', targetIndex: 0, actorId: 'u-1' }).message,
    null,
  )
  assert.equal(
    moveBoardItem(stateA, { itemId: 'm1', targetKind: 'decision', targetIndex: Number.NaN, actorId: 'u-1' }).message,
    null,
  )

  // Reorder m2 above m1, persist, and reload
  stateA = moveBoardItemRelative(stateA, {
    itemId: 'm2',
    direction: 'top',
    actorId: 'u-1',
    roomId: scopeA.roomId,
    nowMs: 1_700_000_051_000,
  }).state
  writeRoomBoard(store, roomBoardKey(scopeA.userId, scopeA.workspaceId, scopeA.roomId), {
    ...scopeA,
    ...stateA,
  })

  const reloadedA = readRoomBoard(store, roomBoardKey(scopeA.userId, scopeA.workspaceId, scopeA.roomId), scopeA)
  assert.deepEqual(getSortedColumnItems(reloadedA.items, 'agenda').map((i) => i.id), ['m2', 'm1'])
  const reloadedB = readRoomBoard(store, roomBoardKey(scopeB.userId, scopeB.workspaceId, scopeB.roomId), scopeB)
  assert.deepEqual(getSortedColumnItems(reloadedB.items, 'agenda').map((i) => i.id), ['b1'])

  // Concurrent delete at equal revision beats stale move; deleted card cannot be moved locally
  const deleted = deleteBoardItem(reloadedA, {
    itemId: 'm1',
    actorId: 'u-2',
    roomId: scopeA.roomId,
    nowMs: 1_700_000_052_000,
  })
  assert.ok(deleted.message)
  assert.equal(
    moveBoardItem(deleted.state, { itemId: 'm1', targetKind: 'action', actorId: 'u-1' }).message,
    null,
  )

  // Unversioned legacy move (revision 0) cannot overwrite versioned item, yet moves unversioned legacy items cleanly
  const staleLegacyMoveMsg: MeetingBoardMessage = {
    type: 'meeting-board:item-move',
    itemId: 'm2',
    targetKind: 'decision',
    targetOrder: 300,
    updatedAt: '2026-01-02T00:00:00.000Z',
  }
  const legacyPeerSender = { userId: 'legacy-peer', name: 'LegacyPeer' }
  const afterStaleLegacy = applyPeerBoardMessage(reloadedA, staleLegacyMoveMsg, {
    roomId: scopeA.roomId,
    sender: legacyPeerSender,
  })
  assert.equal(afterStaleLegacy.items.find((i) => i.id === 'm2')?.kind, 'agenda')

  const legacyBase: BoardState = {
    items: [
      {
        id: 'legacy-m1',
        kind: 'agenda',
        title: 'Legacy item',
        author: 'LegacyPeer',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        order: 0,
      },
    ],
    tombstones: {},
  }
  const afterLegacy = applyPeerBoardMessage(
    legacyBase,
    {
      type: 'meeting-board:item-move',
      itemId: 'legacy-m1',
      targetKind: 'decision',
      targetOrder: 300,
      updatedAt: '2026-01-02T00:00:00.000Z',
    },
    { roomId: scopeA.roomId, sender: legacyPeerSender },
  )
  assert.equal(afterLegacy.items.find((i) => i.id === 'legacy-m1')?.kind, 'decision')
  assert.equal(afterLegacy.items.find((i) => i.id === 'legacy-m1')?.order, 300)
})

test('15: structural sharing preserves === item & tombstone references across mutations, reconciliation, and storage flush', () => {
  const store = createMemoryStorage()
  const scope = { userId: 'u-perf', workspaceId: 'ws-perf', roomId: 'room-perf' }
  const key = roomBoardKey(scope.userId, scope.workspaceId, scope.roomId)

  let state: BoardState = emptyState
  const seedSpecs: Array<{ id: string; kind: MeetingBoardItem['kind']; title: string }> = [
    { id: 'a1', kind: 'agenda', title: 'Agenda 1' },
    { id: 'a2', kind: 'agenda', title: 'Agenda 2' },
    { id: 'a3', kind: 'agenda', title: 'Agenda 3' },
    { id: 'd1', kind: 'decision', title: 'Decision 1' },
    { id: 'd2', kind: 'decision', title: 'Decision 2' },
    { id: 'act1', kind: 'action', title: 'Action 1' },
    { id: 'del1', kind: 'parking', title: 'Deleted 1' },
  ]
  let clock = 1_700_000_000_000
  for (const spec of seedSpecs) {
    clock += 1000
    state = createBoardItem(state, {
      id: spec.id,
      kind: spec.kind,
      title: spec.title,
      author: 'Alice',
      actorId: 'alice',
      roomId: scope.roomId,
      nowMs: clock,
    }).state
  }
  state = deleteBoardItem(state, {
    itemId: 'del1',
    actorId: 'alice',
    roomId: scope.roomId,
    nowMs: (clock += 1000),
  }).state

  const byId = (s: BoardState, id: string) => s.items.find((it) => it.id === id)!
  const expectAllExceptIdentical = (prev: BoardState, next: BoardState, changedIds: Set<string>, label: string) => {
    for (const prevItem of prev.items) {
      if (changedIds.has(prevItem.id)) continue
      const nextItem = byId(next, prevItem.id)
      assert.strictEqual(nextItem, prevItem, `${label}: untouched item ${prevItem.id} lost reference identity`)
    }
    for (const [tid, tomb] of Object.entries(prev.tombstones)) {
      if (changedIds.has(tid)) continue
      assert.strictEqual(next.tombstones[tid], tomb, `${label}: untouched tombstone ${tid} lost reference identity`)
    }
  }

  // 1) Same-column move preserves untouched same-column + cross-column item & tombstone identity
  const afterSameCol = moveBoardItem(state, {
    itemId: 'a1',
    targetKind: 'agenda',
    targetIndex: 2,
    actorId: 'alice',
    roomId: scope.roomId,
    nowMs: (clock += 1000),
  }).state
  assert.deepEqual(
    getSortedColumnItems(afterSameCol.items, 'agenda').map((i) => i.id),
    ['a2', 'a3', 'a1'],
  )
  expectAllExceptIdentical(state, afterSameCol, new Set(['a1']), 'same-column moveBoardItem')

  // 2) Cross-column move preserves untouched items in source, target, and unrelated columns
  const afterCrossCol = moveBoardItem(afterSameCol, {
    itemId: 'a2',
    targetKind: 'decision',
    targetIndex: 1,
    actorId: 'alice',
    roomId: scope.roomId,
    nowMs: (clock += 1000),
  }).state
  assert.deepEqual(
    getSortedColumnItems(afterCrossCol.items, 'decision').map((i) => i.id),
    ['d1', 'a2', 'd2'],
  )
  expectAllExceptIdentical(afterSameCol, afterCrossCol, new Set(['a2']), 'cross-column moveBoardItem')

  // 3) Move into empty column preserves all other items
  const afterEmptyCol = moveBoardItem(afterCrossCol, {
    itemId: 'd2',
    targetKind: 'parking',
    targetIndex: 0,
    actorId: 'alice',
    roomId: scope.roomId,
    nowMs: (clock += 1000),
  }).state
  assert.deepEqual(
    getSortedColumnItems(afterEmptyCol.items, 'parking').map((i) => i.id),
    ['d2'],
  )
  expectAllExceptIdentical(afterCrossCol, afterEmptyCol, new Set(['d2']), 'empty-column moveBoardItem')

  // 4) Keyboard relative move preserves untouched items
  const afterRelMove = moveBoardItemRelative(afterEmptyCol, {
    itemId: 'a1',
    direction: 'up',
    actorId: 'alice',
    roomId: scope.roomId,
    nowMs: (clock += 1000),
  }).state
  assert.deepEqual(
    getSortedColumnItems(afterRelMove.items, 'agenda').map((i) => i.id),
    ['a1', 'a3'],
  )
  expectAllExceptIdentical(afterEmptyCol, afterRelMove, new Set(['a1']), 'moveBoardItemRelative')

  // 5) Single-item update & toggle complete preserve untouched items
  const afterUpdate = updateBoardItem(afterRelMove, {
    itemId: 'a3',
    title: 'Agenda 3 edited',
    description: 'New detail',
    actorId: 'alice',
    roomId: scope.roomId,
    nowMs: (clock += 1000),
  }).state
  expectAllExceptIdentical(afterRelMove, afterUpdate, new Set(['a3']), 'updateBoardItem')

  const afterToggle = toggleBoardItemComplete(afterUpdate, {
    itemId: 'd1',
    actorId: 'alice',
    roomId: scope.roomId,
    nowMs: (clock += 1000),
  }).state
  expectAllExceptIdentical(afterUpdate, afterToggle, new Set(['d1']), 'toggleBoardItemComplete')

  // 6) applyPeerBoardMessage updates only targeted item and ignores stale incoming messages
  const afterMsg = applyPeerBoardMessage(
    afterToggle,
    {
      type: 'meeting-board:item-move',
      roomId: scope.roomId,
      itemId: 'act1',
      targetKind: 'decision',
      targetOrder: 5000,
      updatedAt: new Date((clock += 1000)).toISOString(),
      revision: 9,
      updatedBy: 'bob',
    },
    { roomId: scope.roomId, sender: { userId: 'bob', name: 'Bob' } },
  )
  expectAllExceptIdentical(afterToggle, afterMsg, new Set(['act1']), 'applyPeerBoardMessage move')

  const afterStaleMsg = applyPeerBoardMessage(
    afterMsg,
    {
      type: 'meeting-board:item-update',
      roomId: scope.roomId,
      itemId: 'a3',
      title: 'Stale title',
      updatedAt: new Date(1_700_000_000_000).toISOString(),
      revision: 0,
      updatedBy: 'stale-peer',
    } as unknown as MeetingBoardMessage,
    { roomId: scope.roomId, sender: { userId: 'stale-peer', name: 'Stale' } },
  )
  assert.strictEqual(afterStaleMsg, afterMsg, 'stale incoming message must preserve full BoardState reference')

  // 7) No-op reconcileBoardSnapshots keeps container and item references intact
  const cloneSame: BoardState = {
    items: afterMsg.items.map((it) => ({ ...it })),
    tombstones: Object.fromEntries(Object.entries(afterMsg.tombstones).map(([k, v]) => [k, { ...v }])),
  }
  const reconciledNoop = reconcileBoardSnapshots(afterMsg, cloneSame)
  assert.strictEqual(reconciledNoop.items, afterMsg.items, 'no-op reconcile must preserve local.items reference')
  assert.strictEqual(reconciledNoop.tombstones, afterMsg.tombstones, 'no-op reconcile must preserve local.tombstones reference')
  expectAllExceptIdentical(afterMsg, reconciledNoop, new Set(), 'no-op reconcileBoardSnapshots')

  // 8) writeRoomBoardDetailed preserves in-memory item identity on local write while still merging newer cross-tab updates
  const initWrite = writeRoomBoardDetailed(store, key, { ...scope, ...afterMsg })
  assert.equal(initWrite.ok, true)
  expectAllExceptIdentical(afterMsg, initWrite.snapshot, new Set(), 'initial writeRoomBoardDetailed')

  // Another tab writes a newer revision of act1 directly into storage
  const otherTabState = updateBoardItem(
    { items: JSON.parse(JSON.stringify(afterMsg.items)), tombstones: JSON.parse(JSON.stringify(afterMsg.tombstones)) },
    {
      itemId: 'act1',
      title: 'Updated from Tab B',
      actorId: 'bob',
      roomId: scope.roomId,
      nowMs: (clock += 5000),
    },
  ).state
  // Bump revision via second edit so otherTabState is strictly newer than afterMsg's act1
  const otherTabNewer = updateBoardItem(otherTabState, {
    itemId: 'act1',
    title: 'Updated twice from Tab B',
    actorId: 'bob',
    roomId: scope.roomId,
    nowMs: (clock += 1000),
  }).state
  writeRoomBoard(store, key, { ...scope, ...otherTabNewer })

  // Local tab edits d1 concurrently and persists -> must keep untouched local references AND receive Tab B's newer act1
  const localConcurrentEdit = updateBoardItem(afterMsg, {
    itemId: 'd1',
    title: 'Decision 1 local edit',
    actorId: 'alice',
    roomId: scope.roomId,
    nowMs: (clock += 1000),
  }).state
  const mergedWrite = writeRoomBoardDetailed(store, key, { ...scope, ...localConcurrentEdit })
  assert.equal(mergedWrite.ok, true)
  assert.equal(byId(mergedWrite.snapshot, 'act1').title, 'Updated twice from Tab B')
  assert.equal(byId(mergedWrite.snapshot, 'd1').title, 'Decision 1 local edit')
  expectAllExceptIdentical(localConcurrentEdit, mergedWrite.snapshot, new Set(['act1']), 'cross-tab merged writeRoomBoardDetailed')
})

test('16: AUD-04A MeetingBoard binds live ops to verified sender, rejects unknown senders, and preserves historical authorship during snapshot sync', () => {
  const alice = { userId: 'u-alice', name: 'Alice' }
  const bob = { userId: 'u-bob', name: 'Bob' }
  const charlie = { userId: 'u-charlie', name: 'Charlie' }

  // 1) Bob spoofs author/updatedBy as Alice on live item-create -> stored as Bob / u-bob
  const createSpoof = applyPeerBoardMessage(
    emptyState,
    {
      type: 'meeting-board:item-create',
      roomId: 'room-sec',
      item: {
        id: 'card-spoof-create',
        kind: 'agenda',
        title: 'Created by Bob',
        author: 'Alice',
        createdAt: '2026-11-17T01:00:00.000Z',
        updatedAt: '2026-11-17T01:00:00.000Z',
        order: 1024,
        revision: 1,
        updatedBy: 'u-alice',
      },
    },
    { roomId: 'room-sec', sender: bob },
  )
  assert.equal(createSpoof.items[0]?.author, 'Bob')
  assert.equal(createSpoof.items[0]?.updatedBy, 'u-bob')

  // 2) Live item-create validates structure independently of wire `author` (works even if payload omits `author`)
  const createWithoutWireAuthor = applyPeerBoardMessage(
    createSpoof,
    {
      type: 'meeting-board:item-create',
      roomId: 'room-sec',
      item: {
        id: 'card-no-wire-author',
        kind: 'decision',
        title: 'Author-free wire card',
        createdAt: '2026-11-17T01:01:00.000Z',
        updatedAt: '2026-11-17T01:01:00.000Z',
        order: 1024,
        revision: 1,
      } as unknown as MeetingBoardItem,
    },
    { roomId: 'room-sec', sender: bob },
  )
  const noWireAuthorItem = createWithoutWireAuthor.items.find((i) => i.id === 'card-no-wire-author')
  assert.ok(noWireAuthorItem)
  assert.equal(noWireAuthorItem.author, 'Bob')
  assert.equal(noWireAuthorItem.updatedBy, 'u-bob')

  // 3) Alice legitimately creates card C1; Bob later sends spoofed item-update & item-move -> preserves original author Alice, sets updatedBy u-bob
  let board = applyPeerBoardMessage(
    emptyState,
    {
      type: 'meeting-board:item-create',
      roomId: 'room-sec',
      item: {
        id: 'c1',
        kind: 'agenda',
        title: 'Original Alice Card',
        author: 'Alice',
        createdAt: '2026-11-17T02:00:00.000Z',
        updatedAt: '2026-11-17T02:00:00.000Z',
        order: 1024,
        revision: 1,
        updatedBy: 'u-alice',
      },
    },
    { roomId: 'room-sec', sender: alice },
  )
  board = applyPeerBoardMessage(
    board,
    {
      type: 'meeting-board:item-update',
      roomId: 'room-sec',
      item: {
        id: 'c1',
        kind: 'agenda',
        title: 'Bob edited title',
        author: 'Mallory',
        createdAt: '2026-11-17T02:00:00.000Z',
        updatedAt: '2026-11-17T02:01:00.000Z',
        order: 1024,
        revision: 2,
        updatedBy: 'u-alice',
      },
    },
    { roomId: 'room-sec', sender: bob },
  )
  assert.equal(board.items[0]?.title, 'Bob edited title')
  assert.equal(board.items[0]?.author, 'Alice')
  assert.equal(board.items[0]?.updatedBy, 'u-bob')

  board = applyPeerBoardMessage(
    board,
    {
      type: 'meeting-board:item-move',
      roomId: 'room-sec',
      itemId: 'c1',
      targetKind: 'action',
      targetOrder: 2048,
      updatedAt: '2026-11-17T02:02:00.000Z',
      revision: 3,
      updatedBy: 'u-alice',
    },
    { roomId: 'room-sec', sender: bob },
  )
  assert.equal(board.items[0]?.kind, 'action')
  assert.equal(board.items[0]?.author, 'Alice')
  assert.equal(board.items[0]?.updatedBy, 'u-bob')

  // 4) Bob sending item-update with unknown card ID cannot forge another author
  const spoofUnknownUpdate = applyPeerBoardMessage(
    board,
    {
      type: 'meeting-board:item-update',
      roomId: 'room-sec',
      item: {
        id: 'unknown-card-id',
        kind: 'parking',
        title: 'Injected via item-update',
        author: 'Alice',
        createdAt: '2026-11-17T02:03:00.000Z',
        updatedAt: '2026-11-17T02:03:00.000Z',
        order: 1024,
        revision: 1,
        updatedBy: 'u-alice',
      },
    },
    { roomId: 'room-sec', sender: bob },
  )
  assert.equal(spoofUnknownUpdate.items.find((i) => i.id === 'unknown-card-id')?.author, 'Bob')
  assert.equal(spoofUnknownUpdate.items.find((i) => i.id === 'unknown-card-id')?.updatedBy, 'u-bob')

  // 5) Bob spoofing deletedBy on item-delete records u-bob
  const deletedByBob = applyPeerBoardMessage(
    board,
    {
      type: 'meeting-board:item-delete',
      roomId: 'room-sec',
      itemId: 'c1',
      deletedAt: '2026-11-17T02:04:00.000Z',
      revision: 4,
      deletedBy: 'u-alice',
    },
    { roomId: 'room-sec', sender: bob },
  )
  assert.equal(deletedByBob.tombstones['c1']?.deletedBy, 'u-bob')

  // 6) Invalid / empty sender fails closed without mutating state
  const unmappedResult = applyPeerBoardMessage(
    board,
    {
      type: 'meeting-board:item-create',
      roomId: 'room-sec',
      item: {
        id: 'unmapped',
        kind: 'agenda',
        title: 'Should reject',
        author: 'Ghost',
        createdAt: '2026-11-17T02:05:00.000Z',
        updatedAt: '2026-11-17T02:05:00.000Z',
        order: 1024,
        revision: 1,
      },
    },
    { roomId: 'room-sec', sender: { userId: '', name: 'Ghost' } },
  )
  assert.strictEqual(unmappedResult, board)

  // 7) Historical snapshot sync relayed by Charlie preserves original authorship from Alice (items & tombstones)
  const historicalSnapshot: MeetingBoardMessage = {
    type: 'meeting-board:sync-state',
    roomId: 'room-sec',
    items: [
      {
        id: 'hist-alice',
        kind: 'decision',
        title: 'Historical card by Alice',
        author: 'Alice',
        createdAt: '2026-11-17T00:10:00.000Z',
        updatedAt: '2026-11-17T00:10:00.000Z',
        order: 1024,
        revision: 1,
        updatedBy: 'u-alice',
      },
    ],
    tombstones: {
      'hist-del-alice': {
        id: 'hist-del-alice',
        deletedAt: '2026-11-17T00:15:00.000Z',
        revision: 2,
        deletedBy: 'u-alice',
      },
    },
  }
  const afterHistoricalSync = applyPeerBoardMessage(emptyState, historicalSnapshot, {
    roomId: 'room-sec',
    sender: charlie,
  })
  assert.equal(afterHistoricalSync.items[0]?.author, 'Alice')
  assert.equal(afterHistoricalSync.items[0]?.updatedBy, 'u-alice')
  assert.equal(afterHistoricalSync.tombstones['hist-del-alice']?.deletedBy, 'u-alice')

  // 8) Live update by Bob after historical sync preserves historical author Alice while updating updatedBy to u-bob
  const afterLiveEditPostSync = applyPeerBoardMessage(
    afterHistoricalSync,
    {
      type: 'meeting-board:item-update',
      roomId: 'room-sec',
      item: {
        id: 'hist-alice',
        kind: 'decision',
        title: 'Refined by Bob after sync',
        author: 'Spoofed Relayer',
        createdAt: '2026-11-17T00:10:00.000Z',
        updatedAt: '2026-11-17T03:00:00.000Z',
        order: 1024,
        revision: 2,
        updatedBy: 'u-alice',
      },
    },
    { roomId: 'room-sec', sender: bob },
  )
  assert.equal(afterLiveEditPostSync.items[0]?.author, 'Alice')
  assert.equal(afterLiveEditPostSync.items[0]?.updatedBy, 'u-bob')

  // 9) applyLocalBoardMessage remains dedicated to locally authored messages
  const { message: localMsg } = createBoardItem(emptyState, {
    id: 'local-1',
    kind: 'agenda',
    title: 'Local card',
    author: 'LocalUser',
    actorId: 'u-local',
    roomId: 'room-sec',
    nowMs: 1_700_000_090_000,
  })
  const localCommitted = applyLocalBoardMessage(emptyState, localMsg!, { roomId: 'room-sec' })
  assert.equal(localCommitted.items[0]?.author, 'LocalUser')
  assert.equal(localCommitted.items[0]?.updatedBy, 'u-local')
})
