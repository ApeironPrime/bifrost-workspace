import test from 'node:test'
import assert from 'node:assert/strict'
import {
  readWorkspaceRoute,
  workspaceHash,
  roomDraftKey,
  readRoomDraft,
  readRoomNoteUpdatedAt,
  writeRoomDraft,
  roomBoardKey,
  readRoomBoard,
  readRoomBoardDetailed,
  writeRoomBoard,
  writeRoomBoardDetailed,
  createBoardItem,
  deleteBoardItem,
  ROOM_BOARD_SNAPSHOT_VERSION,
} from '../src/lib/roomUiState.ts'
test('room drafts are isolated by user, workspace and room and never store sharing state',()=>{
 const values=new Map<string,string>();const store={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}}
 const a=roomDraftKey('a','workspace','design'),b=roomDraftKey('a','workspace','engineering'),other=roomDraftKey('b','workspace','design')
 writeRoomDraft(store,a,{chat:'design only',note:'private note'});writeRoomDraft(store,b,{chat:'engineering only'})
 assert.deepEqual(readRoomDraft(store,a),{chat:'design only',note:'private note'});assert.equal(readRoomDraft(store,b).chat,'engineering only');assert.equal(readRoomDraft(store,other).chat,'')
 writeRoomDraft(store,a,{chat:''});assert.equal(readRoomDraft(store,a).note,'private note');assert.equal(values.get(a)?.includes('shared'),false)
 values.set(a,'invalid');assert.deepEqual(readRoomDraft(store,a),{chat:'',note:''})
})
test('workspace routes round-trip safely and reject unknown tabs',()=>{
 const route={workspaceId:'team / 1',roomId:'room & 2',tab:'notes' as const};assert.deepEqual(readWorkspaceRoute(workspaceHash(route)),route)
 assert.equal(readWorkspaceRoute('#workspace?tab=bad').tab,'meeting');assert.equal(workspaceHash({workspaceId:'',roomId:'',tab:'chat'}),'#workspace')
})

test('room board snapshots persist safely, isolate user/workspace/room, and reject corrupt data', () => {
  const values = new Map<string, string>()
  const store = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  }

  const scopeA1 = { userId: 'u-1', workspaceId: 'ws:a', roomId: 'room:1' }
  const scopeA2 = { userId: 'u-1', workspaceId: 'ws:a', roomId: 'room:2' }
  const scopeWsB = { userId: 'u-1', workspaceId: 'ws:b', roomId: 'room:1' }
  const scopeU2 = { userId: 'u-2', workspaceId: 'ws:a', roomId: 'room:1' }

  const keyA1 = roomBoardKey(scopeA1.userId, scopeA1.workspaceId, scopeA1.roomId)
  const keyA2 = roomBoardKey(scopeA2.userId, scopeA2.workspaceId, scopeA2.roomId)
  const keyWsB = roomBoardKey(scopeWsB.userId, scopeWsB.workspaceId, scopeWsB.roomId)
  const keyU2 = roomBoardKey(scopeU2.userId, scopeU2.workspaceId, scopeU2.roomId)

  assert.equal(new Set([keyA1, keyA2, keyWsB, keyU2]).size, 4)

  const ok = writeRoomBoard(store, keyA1, {
    ...scopeA1,
    items: [
      {
        id: 'card-1',
        kind: 'agenda',
        title: 'Prepare roadmap',
        author: 'Alice',
        createdAt: '2026-11-15T01:00:00.000Z',
        updatedAt: '2026-11-15T01:00:00.000Z',
        order: 0,
        revision: 1,
        updatedBy: 'u-1',
      },
    ],
    tombstones: {},
  })
  assert.equal(ok, true)

  const restored = readRoomBoard(store, keyA1, scopeA1)
  assert.equal(restored.version, ROOM_BOARD_SNAPSHOT_VERSION)
  assert.equal(restored.items.length, 1)
  assert.equal(restored.items[0]?.title, 'Prepare roadmap')

  // Scope mismatch across room, workspace, or user must remain isolated
  assert.equal(readRoomBoard(store, keyA2, scopeA2).items.length, 0)
  assert.equal(readRoomBoard(store, keyWsB, scopeWsB).items.length, 0)
  assert.equal(readRoomBoard(store, keyU2, scopeU2).items.length, 0)
  assert.equal(readRoomBoard(store, keyA1, scopeU2).items.length, 0)

  // Malformed JSON and wrong schema versions fail cleanly to empty snapshots WITHOUT deleting stored data
  const corruptPayload = '{not valid json'
  values.set(keyA2, corruptPayload)
  const corruptRes = readRoomBoardDetailed(store, keyA2, scopeA2)
  assert.equal(corruptRes.status, 'corrupt')
  assert.deepEqual(corruptRes.snapshot.items, [])
  assert.equal(values.get(keyA2), corruptPayload)

  const futureSchemaPayload = JSON.stringify({ version: 99, ...scopeA2, items: [{ id: 'future' }] })
  values.set(keyA2, futureSchemaPayload)
  const incompatibleRes = readRoomBoardDetailed(store, keyA2, scopeA2)
  assert.equal(incompatibleRes.status, 'incompatible-version')
  assert.deepEqual(incompatibleRes.snapshot.items, [])
  assert.equal(values.get(keyA2), futureSchemaPayload)

  // Refuses to overwrite incompatible schema version without migration
  const writeOverIncompatible = writeRoomBoardDetailed(store, keyA2, {
    ...scopeA2,
    items: [],
    tombstones: {},
  })
  assert.equal(writeOverIncompatible.ok, false)
  assert.equal(writeOverIncompatible.status, 'incompatible-version')
  assert.equal(values.get(keyA2), futureSchemaPayload)

  // Unversioned structured object also reports incompatible-version and stays preserved
  const unversionedPayload = JSON.stringify({ ...scopeA2, items: [{ id: 'old' }] })
  values.set(keyA2, unversionedPayload)
  assert.equal(readRoomBoardDetailed(store, keyA2, scopeA2).status, 'incompatible-version')
  assert.equal(writeRoomBoardDetailed(store, keyA2, { ...scopeA2, items: [], tombstones: {} }).ok, false)
  assert.equal(values.get(keyA2), unversionedPayload)

  values.set(keyA2, JSON.stringify({ version: 1, ...scopeA2, items: 'broken' }))
  assert.equal(readRoomBoardDetailed(store, keyA2, scopeA2).status, 'corrupt')
  assert.deepEqual(readRoomBoard(store, keyA2, scopeA2).items, [])

  // Storage throwing errors never crash reads/writes and report explicit failure
  const failingStore = {
    getItem: () => {
      throw new Error('SecurityError')
    },
    setItem: () => {
      throw new Error('QuotaExceededError')
    },
  }
  const writeQuotaFail = writeRoomBoardDetailed(failingStore, keyA1, { ...scopeA1, items: [], tombstones: {} })
  assert.equal(writeQuotaFail.ok, false)
  assert.equal(writeQuotaFail.status, 'storage-error')
  assert.equal(
    writeRoomBoard(failingStore, keyA1, { ...scopeA1, items: [], tombstones: {} }),
    false
  )
  assert.equal(readRoomBoardDetailed(failingStore, keyA1, scopeA1).status, 'storage-error')
  assert.deepEqual(readRoomBoard(failingStore, keyA1, scopeA1).items, [])
})

test('concurrent writes from two browser tabs reconcile snapshots instead of overwriting each other', () => {
  const values = new Map<string, string>()
  const sharedStore = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
  }
  const scope = { userId: 'u-1', workspaceId: 'ws-1', roomId: 'room-1' }
  const key = roomBoardKey(scope.userId, scope.workspaceId, scope.roomId)

  const tab1Initial = createBoardItem(
    { items: [], tombstones: {} },
    {
      id: 'tab1-card',
      kind: 'agenda',
      title: 'From Tab 1',
      author: 'User 1',
      actorId: 'u-1',
      nowMs: 1_700_000_001_000,
    }
  ).state
  const tab2Initial = createBoardItem(
    { items: [], tombstones: {} },
    {
      id: 'tab2-card',
      kind: 'decision',
      title: 'From Tab 2',
      author: 'User 1',
      actorId: 'u-1',
      nowMs: 1_700_000_002_000,
    }
  ).state

  assert.equal(writeRoomBoardDetailed(sharedStore, key, { ...scope, ...tab1Initial }).ok, true)
  const tab2Write = writeRoomBoardDetailed(sharedStore, key, { ...scope, ...tab2Initial })
  assert.equal(tab2Write.ok, true)
  assert.deepEqual(
    tab2Write.snapshot?.items.map((i) => i.id).sort(),
    ['tab1-card', 'tab2-card']
  )

  // Tab 1 deletes tab1-card; Tab 2 concurrently holds stale tab1-card and creates tab2-extra
  const tab1Deleted = deleteBoardItem(tab1Initial, {
    itemId: 'tab1-card',
    actorId: 'u-1',
    nowMs: 1_700_000_005_000,
  }).state
  assert.equal(writeRoomBoardDetailed(sharedStore, key, { ...scope, ...tab1Deleted }).ok, true)

  const staleTab2State = createBoardItem(tab1Initial, {
    id: 'tab2-extra',
    kind: 'parking',
    title: 'Tab 2 extra',
    author: 'User 1',
    actorId: 'u-1',
    nowMs: 1_700_000_006_000,
  }).state
  const mergedTab2 = writeRoomBoardDetailed(sharedStore, key, { ...scope, ...staleTab2State })
  assert.equal(mergedTab2.ok, true)
  assert.deepEqual(
    mergedTab2.snapshot?.items.map((i) => i.id).sort(),
    ['tab2-card', 'tab2-extra']
  )
  assert.ok(mergedTab2.snapshot?.tombstones['tab1-card'])
})

test('readRoomNoteUpdatedAt persists note timestamps cleanly per scope without changing readRoomDraft keys', () => {
  const values = new Map<string, string>()
  const store = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  }
  const keyA = roomDraftKey('u-1', 'ws-1', 'design')
  const keyB = roomDraftKey('u-1', 'ws-1', 'engineering')

  assert.equal(readRoomNoteUpdatedAt(store, keyA), undefined)
  writeRoomDraft(store, keyA, { note: 'Draft A', noteUpdatedAt: 1_700_000_000_000 })
  assert.deepEqual(readRoomDraft(store, keyA), { chat: '', note: 'Draft A' })
  assert.equal(readRoomNoteUpdatedAt(store, keyA), 1_700_000_000_000)
  assert.equal(readRoomNoteUpdatedAt(store, keyB), undefined)

  writeRoomDraft(store, keyA, { chat: 'hello' })
  assert.equal(readRoomNoteUpdatedAt(store, keyA), 1_700_000_000_000)

  values.set(keyA, '{corrupt')
  assert.equal(readRoomNoteUpdatedAt(store, keyA), undefined)
})
