import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CrdtRoomController,
  captureRelativeSelection,
  decodeRelativeCursor,
  encodeRelativeCursor,
  restoreRelativeSelection,
} from '../src/lib/crdtCollabDoc.ts'
import { dispatchVerifiedDataChannelPayload, type VerifiedPeerIdentity } from '../src/lib/peerIdentity.ts'

test('CrdtRoomController converges concurrent character edits across peers', () => {
  const alice = new CrdtRoomController()
  const bob = new CrdtRoomController()

  const initUpdate = alice.applyLocalEdit('Hello world')
  assert.ok(initUpdate)
  bob.applyRemoteUpdate(initUpdate)
  assert.equal(bob.getText(), 'Hello world')

  // Concurrent offline edits: Alice appends at end, Bob prepends at start
  const aliceEdit = alice.applyLocalEdit('Hello world!')
  const bobEdit = bob.applyLocalEdit('Hi! Hello world')
  assert.ok(aliceEdit)
  assert.ok(bobEdit)

  // Exchange updates in opposite order
  alice.applyRemoteUpdate(bobEdit)
  bob.applyRemoteUpdate(aliceEdit)

  assert.equal(alice.getText(), bob.getText())
  assert.equal(alice.getText(), 'Hi! Hello world!')

  // Delta sync via stateVector for a late-joining peer (Carol)
  const carol = new CrdtRoomController()
  const carolSv = carol.encodeStateVectorBase64()
  const deltaForCarol = alice.encodeStateAsUpdateBase64(carolSv)
  carol.applyRemoteUpdate(deltaForCarol)
  assert.equal(carol.getText(), 'Hi! Hello world!')

  alice.destroy()
  bob.destroy()
  carol.destroy()
})

test('Y.RelativePosition preserves local caret across remote prefix insertions and decodes remote line/col', () => {
  const local = new CrdtRoomController()
  const remote = new CrdtRoomController()

  const seed = local.applyLocalEdit('Line 1\nTarget')
  assert.ok(seed)
  remote.applyRemoteUpdate(seed)

  // Local caret is right before "Target" (index 7)
  const captured = captureRelativeSelection(local.ytext, 7, 7)

  // Remote peer inserts prefix at the start of line 1
  const remoteInsert = remote.applyLocalEdit('Intro\nLine 1\nTarget')
  assert.ok(remoteInsert)
  local.applyRemoteUpdate(remoteInsert)

  const restored = restoreRelativeSelection(local.doc, captured)
  assert.ok(restored)
  // "Intro\n" is 6 chars -> caret shifts from 7 to 13, still right before "Target"
  assert.equal(restored.start, 13)
  assert.equal(restored.end, 13)

  // Encode remote cursor at end of "Target" (line 3, column 7) and decode on local
  const encodedCursor = encodeRelativeCursor(remote.ytext, remote.getText().length, remote.getText().length)
  const decoded = decodeRelativeCursor(local.doc, local.ytext, encodedCursor.anchor, encodedCursor.head)
  assert.ok(decoded)
  assert.equal(decoded.line, 3)
  assert.equal(decoded.column, 7)

  local.destroy()
  remote.destroy()
})

test('dispatchVerifiedDataChannelPayload enforces VIEWER ACL on CRDT messages', () => {
  const peerId = 'peer-viewer-1'
  const verifiedSender: VerifiedPeerIdentity = {
    peerId,
    userId: 'user-viewer-1',
    name: 'Viewer User',
  }
  const registry = new Map<string, VerifiedPeerIdentity>([[peerId, verifiedSender]])
  const mockChannel = { label: 'bifrost-realtime' }

  const receivedTypes: string[] = []
  const runDispatch = (payload: unknown, senderRole: 'VIEWER' | 'MEMBER') =>
    dispatchVerifiedDataChannelPayload({
      rawData: JSON.stringify(payload),
      peerId,
      registry,
      localPeerId: 'local-peer',
      registeredChannel: mockChannel,
      incomingChannel: mockChannel,
      activeRoomId: 'room-1',
      targetRoomId: 'room-1',
      senderRole,
      handlers: {
        onCrdt: (msg) => {
          receivedTypes.push(String(msg.type))
        },
      },
    })

  // VIEWER is allowed to request sync, but blocked from mutating doc or broadcasting cursors
  assert.equal(runDispatch({ type: 'crdt:sync-request', stateVector: 'AA==' }, 'VIEWER'), true)
  assert.equal(runDispatch({ type: 'crdt:update', update: 'AA==' }, 'VIEWER'), false)
  assert.equal(runDispatch({ type: 'crdt:cursor', anchor: 'AA==', head: 'AA==' }, 'VIEWER'), false)
  assert.deepEqual(receivedTypes, ['crdt:sync-request'])

  // MEMBER can send all three CRDT message types
  assert.equal(runDispatch({ type: 'crdt:update', update: 'AA==' }, 'MEMBER'), true)
  assert.equal(runDispatch({ type: 'crdt:cursor', anchor: 'AA==', head: 'AA==' }, 'MEMBER'), true)
  assert.deepEqual(receivedTypes, ['crdt:sync-request', 'crdt:update', 'crdt:cursor'])
})
