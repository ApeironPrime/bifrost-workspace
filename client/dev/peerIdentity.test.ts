import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authorizeSignalingPeer,
  canPeerSendDataChannelMessage,
  clearPeerRegistry,
  dispatchVerifiedDataChannelPayload,
  hasMatchingVerifiedPeer,
  isReadOnlyAllowedDataChannelMessageType,
  normalizeJoinedPeerEvent,
  normalizeVerifiedPeer,
  removeVerifiedPeer,
  replacePeerRegistryFromPresence,
  resolvePeerRoomAccessRole,
  resolveVerifiedPeer,
  upsertVerifiedPeerFromJoin,
  verifyDataChannelSender,
  type VerifiedPeerIdentity,
  type WorkspaceMemberAccessRecord,
} from '../src/lib/peerIdentity.ts';
import { normalizeIncomingChatMessage, normalizeIncomingSharedNote } from '../src/lib/chatNotes.ts';
import { isDevMockSession } from '../src/lib/appApi.ts';

test('normalizeVerifiedPeer and replacePeerRegistryFromPresence enforce strict server roster fields without email', () => {
  assert.deepEqual(
    normalizeVerifiedPeer({
      peerId: ' sock-alice ',
      userId: ' user-alice ',
      name: ' Alice ',
      email: 'alice@example.com',
    }),
    { peerId: 'sock-alice', userId: 'user-alice', name: 'Alice' },
  );
  assert.equal('email' in normalizeVerifiedPeer({ peerId: 'p1', userId: 'u1', name: 'A', email: 'a@b.c' })!, false);

  assert.equal(normalizeVerifiedPeer(null), null);
  assert.equal(normalizeVerifiedPeer(['sock-1', 'u1', 'Alice']), null);
  assert.equal(normalizeVerifiedPeer({ peerId: '   ', userId: 'u1', name: 'Alice' }), null);
  assert.equal(normalizeVerifiedPeer({ peerId: 'p1', userId: '', name: 'Alice' }), null);
  assert.equal(normalizeVerifiedPeer({ peerId: 'p1', userId: 'u1', name: '   ' }), null);

  const registry = replacePeerRegistryFromPresence(
    [
      { peerId: 'self-sock', userId: 'u-self', name: 'Self', email: 'self@example.com' },
      { peerId: 'peer-bob', userId: 'u-bob', name: 'Bob', email: 'bob@example.com' },
      { peerId: 'peer-bad', userId: '', name: 'Broken' },
      { peerId: 'peer-carol', userId: 'u-carol', name: 'Carol' },
    ],
    'self-sock',
  );

  assert.equal(registry.size, 2);
  assert.equal(resolveVerifiedPeer(registry, 'self-sock', 'self-sock'), null);
  assert.equal(resolveVerifiedPeer(registry, 'peer-bad'), null);
  assert.equal(resolveVerifiedPeer(registry, 'unknown-peer'), null);
  assert.deepEqual(resolveVerifiedPeer(registry, 'peer-bob'), {
    peerId: 'peer-bob',
    userId: 'u-bob',
    name: 'Bob',
  });
  assert.deepEqual(resolveVerifiedPeer(registry, 'peer-carol'), {
    peerId: 'peer-carol',
    userId: 'u-carol',
    name: 'Carol',
  });
});

test('upsertVerifiedPeerFromJoin, removeVerifiedPeer, presence:changed, and clearPeerRegistry follow membership lifecycle', () => {
  const registry = replacePeerRegistryFromPresence([], 'local-sock');

  // Synchronous upsert on room:peer-joined before createPeer() runs
  assert.equal(normalizeJoinedPeerEvent({ peerId: 'local-sock', user: { id: 'u-me', name: 'Me' } }, 'local-sock'), null);
  const bob = upsertVerifiedPeerFromJoin(
    registry,
    { peerId: 'sock-bob', user: { id: 'u-bob', name: 'Bob', email: 'bob@example.com' } },
    'local-sock',
  );
  assert.deepEqual(bob, { peerId: 'sock-bob', userId: 'u-bob', name: 'Bob' });
  assert.deepEqual(resolveVerifiedPeer(registry, 'sock-bob', 'local-sock'), bob);

  // Invalid join payloads never enter registry
  assert.equal(upsertVerifiedPeerFromJoin(registry, { peerId: 'sock-x', user: { name: 'NoId' } }, 'local-sock'), null);
  assert.equal(upsertVerifiedPeerFromJoin(registry, { peerId: 'local-sock', user: { id: 'u-me', name: 'Me' } }, 'local-sock'), null);
  assert.equal(resolveVerifiedPeer(registry, 'sock-x'), null);

  // Generic WebRTC transport close MUST NOT remove verified identity while membership holds
  const peerConnections = new Map<string, { state: string }>([['sock-bob', { state: 'connected' }]]);
  const simulateGenericWebRtcClose = (peerId: string) => {
    peerConnections.delete(peerId);
  };
  simulateGenericWebRtcClose('sock-bob');
  assert.equal(peerConnections.has('sock-bob'), false);
  assert.deepEqual(resolveVerifiedPeer(registry, 'sock-bob', 'local-sock'), bob);

  // presence:changed replaces entire roster cleanly
  const nextRoster = replacePeerRegistryFromPresence(
    [
      { peerId: 'local-sock', userId: 'u-me', name: 'Me' },
      { peerId: 'sock-dave', userId: 'u-dave', name: 'Dave' },
    ],
    'local-sock',
  );
  assert.equal(resolveVerifiedPeer(nextRoster, 'sock-bob'), null);
  assert.deepEqual(resolveVerifiedPeer(nextRoster, 'sock-dave'), {
    peerId: 'sock-dave',
    userId: 'u-dave',
    name: 'Dave',
  });

  // Explicit room:peer-left removes only that peer
  assert.equal(removeVerifiedPeer(nextRoster, 'sock-dave'), true);
  assert.equal(resolveVerifiedPeer(nextRoster, 'sock-dave'), null);

  // leaveRoom / room:access-revoked clears all verified peers atomically
  upsertVerifiedPeerFromJoin(nextRoster, { peerId: 'sock-eve', user: { id: 'u-eve', name: 'Eve' } }, 'local-sock');
  assert.equal(nextRoster.size, 1);
  clearPeerRegistry(nextRoster);
  assert.equal(nextRoster.size, 0);
});

test('signaling gate blocks unknown or self peers for offer, answer, and ICE candidates without joining race', () => {
  // Simulate exact server event order when Bob joins room containing Alice:
  // 1) Existing member Alice receives `presence:changed` + `room:peer-joined` synchronously before `webrtc:offer`
  let aliceRegistry = replacePeerRegistryFromPresence([], 'sock-alice');
  aliceRegistry = replacePeerRegistryFromPresence(
    [
      { peerId: 'sock-alice', userId: 'u-alice', name: 'Alice' },
      { peerId: 'sock-bob', userId: 'u-bob', name: 'Bob' },
    ],
    'sock-alice',
  );
  upsertVerifiedPeerFromJoin(
    aliceRegistry,
    { peerId: 'sock-bob', user: { id: 'u-bob', name: 'Bob' } },
    'sock-alice',
  );

  // 2) New joiner Bob receives `room:joined` with full presence before receiving `webrtc:offer` from Alice
  const bobRegistry = replacePeerRegistryFromPresence(
    [
      { peerId: 'sock-alice', userId: 'u-alice', name: 'Alice' },
      { peerId: 'sock-bob', userId: 'u-bob', name: 'Bob' },
    ],
    'sock-bob',
  );

  // Both sides authorize legitimate WebRTC offer/answer/ICE
  assert.ok(authorizeSignalingPeer(bobRegistry, 'sock-alice', 'sock-bob'));
  assert.ok(authorizeSignalingPeer(aliceRegistry, 'sock-bob', 'sock-alice'));

  // Unknown peer or local self peer is rejected fail-closed for offer, answer, ICE
  const tryProcessSignaling = (
    registry: ReadonlyMap<string, VerifiedPeerIdentity>,
    localPeerId: string,
    peerId: string,
  ) => authorizeSignalingPeer(registry, peerId, localPeerId) !== null;

  assert.equal(tryProcessSignaling(bobRegistry, 'sock-bob', 'sock-outsider'), false);
  assert.equal(tryProcessSignaling(bobRegistry, 'sock-bob', 'sock-bob'), false);
  assert.equal(tryProcessSignaling(aliceRegistry, 'sock-alice', 'sock-outsider'), false);

  // After room:peer-left or eviction, further answers/ICE from that peer fail closed
  removeVerifiedPeer(aliceRegistry, 'sock-bob');
  assert.equal(tryProcessSignaling(aliceRegistry, 'sock-alice', 'sock-bob'), false);
});

test('DataChannel dispatcher gates by verified closure peerId, blocks unknown peers, and protects FileShare & Chat/Notes', () => {
  const channelBob = { id: 'dc-bob' };
  const channelOther = { id: 'dc-other' };
  const channels = new Map([[ 'sock-bob', channelBob ]]);
  const registry = replacePeerRegistryFromPresence(
    [
      { peerId: 'sock-alice', userId: 'u-alice', name: 'Alice' },
      { peerId: 'sock-bob', userId: 'u-bob', name: 'Bob' },
    ],
    'sock-alice',
  );

  const chats: Array<ReturnType<typeof normalizeIncomingChatMessage>> = [];
  const notes: Array<{ peerId: string; note: ReturnType<typeof normalizeIncomingSharedNote> }> = [];
  const unshared: string[] = [];
  const boardMessages: Array<{ type: unknown; peerId: string; sender: VerifiedPeerIdentity }> = [];
  const fileMessages: Array<{ type: unknown; peerId: string; sender: VerifiedPeerIdentity }> = [];

  const dispatch = (peerId: string, rawData: unknown, incomingChannel = channelBob, activeRoomId = 'room-1') =>
    dispatchVerifiedDataChannelPayload({
      rawData,
      peerId,
      registry,
      localPeerId: 'sock-alice',
      registeredChannel: channels.get(peerId),
      incomingChannel,
      activeRoomId,
      targetRoomId: 'room-1',
      handlers: {
        onChat: (payload, sender) => {
          chats.push(normalizeIncomingChatMessage(payload, sender));
        },
        onNoteUpdate: (verifiedPeerId, payload, sender) => {
          notes.push({ peerId: verifiedPeerId, note: normalizeIncomingSharedNote(payload, sender) });
        },
        onNoteUnshared: (verifiedPeerId) => {
          unshared.push(verifiedPeerId);
        },
        onMeetingBoard: (message, verifiedPeerId, sender) => {
          boardMessages.push({ type: message.type, peerId: verifiedPeerId, sender });
        },
        onFileShare: (message, verifiedPeerId, sender) => {
          if (!hasMatchingVerifiedPeer(sender, verifiedPeerId)) return;
          fileMessages.push({ type: message.type, peerId: verifiedPeerId, sender });
        },
      },
    });

  // 1) Verified peer sending spoofed chat & note author still displays server-verified identity
  assert.equal(
    dispatch('sock-bob', JSON.stringify({ type: 'chat', author: 'Spoofed Admin', body: 'Hello', sentAt: 1000 })),
    true,
  );
  assert.deepEqual(chats, [{ author: 'Bob', authorId: 'u-bob', body: 'Hello', mine: false, sentAt: 1000 }]);

  assert.equal(
    dispatch('sock-bob', JSON.stringify({ type: 'note:update', author: 'Spoofed Owner', body: 'Agenda', updatedAt: 2000 })),
    true,
  );
  assert.deepEqual(notes, [
    { peerId: 'sock-bob', note: { author: 'Bob', authorId: 'u-bob', body: 'Agenda', updatedAt: 2000 } },
  ]);

  // 2) Verified peer dispatches FileShare with existing wire shape (no wire mutation)
  assert.equal(
    dispatch(
      'sock-bob',
      JSON.stringify({
        type: 'file:start',
        transferId: 't-1',
        name: 'spec.pdf',
        mimeType: 'application/pdf',
        size: 100,
        totalChunks: 1,
      }),
    ),
    true,
  );
  assert.equal(fileMessages.length, 1);
  assert.deepEqual(fileMessages[0], {
    type: 'file:start',
    peerId: 'sock-bob',
    sender: { peerId: 'sock-bob', userId: 'u-bob', name: 'Bob' },
  });

  // 3) Stale channel or mismatched room or unmapped peer fails closed BEFORE handlers run
  assert.equal(dispatch('sock-bob', JSON.stringify({ type: 'chat', author: 'X', body: 'stale' }), channelOther), false);
  assert.equal(dispatch('sock-bob', JSON.stringify({ type: 'chat', author: 'X', body: 'wrong room' }), channelBob, 'room-2'), false);
  assert.equal(dispatch('sock-unknown', JSON.stringify({ type: 'chat', author: 'Spoofed', body: 'hi' }), channelBob), false);
  assert.equal(
    dispatch(
      'sock-unknown',
      JSON.stringify({ type: 'file:start', transferId: 't-2', name: 'x.txt', mimeType: 'text/plain', size: 1, totalChunks: 1 }),
      channelBob,
    ),
    false,
  );
  assert.equal(chats.length, 1);
  assert.equal(fileMessages.length, 1);

  // 4) Leaf FileShare guard blocks callsites lacking matching verifiedSender
  assert.equal(hasMatchingVerifiedPeer(null, 'sock-bob'), false);
  assert.equal(hasMatchingVerifiedPeer({ peerId: 'sock-other', userId: 'u-bob', name: 'Bob' }, 'sock-bob'), false);
  assert.equal(hasMatchingVerifiedPeer({ peerId: 'sock-bob', userId: '', name: 'Bob' }, 'sock-bob'), false);
  assert.equal(hasMatchingVerifiedPeer({ peerId: 'sock-bob', userId: 'u-bob', name: 'Bob' }, 'sock-bob'), true);

  // 5) Temporary Socket.IO disconnect does NOT drop verified registry so live P2P continues
  // until explicit room leave or revocation
  assert.ok(
    verifyDataChannelSender({
      registry,
      peerId: 'sock-bob',
      localPeerId: 'sock-alice',
      registeredChannel: channels.get('sock-bob'),
      incomingChannel: channelBob,
      activeRoomId: 'room-1',
      targetRoomId: 'room-1',
    }),
  );

  // Clear on leaveRoom/revocation immediately blocks queued DataChannel frames
  clearPeerRegistry(registry);
  assert.equal(dispatch('sock-bob', JSON.stringify({ type: 'meeting-board:item-create', item: { id: 'c1' } })), false);
  assert.equal(boardMessages.length, 0);
  assert.equal(unshared.length, 0);
});

test('Dev TXT mock compatibility keeps production fail-closed and provides no payload.author fallback', () => {
  assert.equal(isDevMockSession('bifrost-txt-abc123', { DEV: true }), true);
  assert.equal(isDevMockSession('bifrost-txt-abc123', { DEV: false }), false);

  // Remote DataChannel path never synthesizes identity for mock-local-peer or unknown sender
  const emptyRegistry = replacePeerRegistryFromPresence([], 'mock-local-peer');
  const channelMock = { id: 'mock-dc' };
  const receivedChats: unknown[] = [];
  const dispatched = dispatchVerifiedDataChannelPayload({
    rawData: JSON.stringify({ type: 'chat', author: 'Admin', body: 'Forged' }),
    peerId: 'mock-local-peer',
    registry: emptyRegistry,
    localPeerId: null,
    registeredChannel: channelMock,
    incomingChannel: channelMock,
    activeRoomId: 'room-1',
    targetRoomId: 'room-1',
    handlers: {
      onChat: (payload, sender) => {
        receivedChats.push(normalizeIncomingChatMessage(payload, sender));
      },
      onNoteUpdate: () => {},
      onNoteUnshared: () => {},
      onMeetingBoard: () => {},
      onFileShare: () => {},
    },
  });
  assert.equal(dispatched, false);
  assert.equal(receivedChats.length, 0);
});

test('AUD-04B: receiver-side role enforcement blocks VIEWER writes, allows VIEWER passive controls, and fails closed on unassigned peers', () => {
  assert.equal(isReadOnlyAllowedDataChannelMessageType('meeting-board:sync-request'), true);
  assert.equal(isReadOnlyAllowedDataChannelMessageType('file:ack'), true);
  assert.equal(isReadOnlyAllowedDataChannelMessageType('file:reject'), true);
  assert.equal(isReadOnlyAllowedDataChannelMessageType('chat'), false);
  assert.equal(isReadOnlyAllowedDataChannelMessageType('file:start'), false);

  assert.equal(canPeerSendDataChannelMessage({ messageType: 'chat', senderRole: null }), false);
  assert.equal(canPeerSendDataChannelMessage({ messageType: 'meeting-board:sync-request', senderRole: null }), false);
  assert.equal(canPeerSendDataChannelMessage({ messageType: 'file:ack', senderRole: null }), false);

  const roster: { source: string; members: WorkspaceMemberAccessRecord[] } = {
    source: 'mock',
    members: [
      { userId: 'u-owner', role: 'OWNER', roomAssignments: [] },
      { userId: 'u-host', role: 'MEMBER', roomAssignments: [{ roomId: 'room-1', role: 'HOST' }] },
      { userId: 'u-mod', role: 'MEMBER', roomAssignments: [{ roomId: 'room-1', role: 'MODERATOR' }] },
      { userId: 'u-member', role: 'MEMBER', roomAssignments: [{ roomId: 'room-1', role: 'MEMBER' }] },
      { userId: 'u-viewer', role: 'MEMBER', roomAssignments: [{ roomId: 'room-1', role: 'VIEWER' }] },
      { userId: 'u-other-room', role: 'MEMBER', roomAssignments: [{ roomId: 'room-2', role: 'HOST' }] },
    ],
  };

  assert.equal(resolvePeerRoomAccessRole(undefined, 'room-1', 'u-viewer'), undefined);
  assert.equal(resolvePeerRoomAccessRole(roster, 'room-1', 'u-owner'), 'OWNER');
  assert.equal(resolvePeerRoomAccessRole(roster, 'room-1', 'u-host'), 'HOST');
  assert.equal(resolvePeerRoomAccessRole(roster, 'room-1', 'u-mod'), 'MODERATOR');
  assert.equal(resolvePeerRoomAccessRole(roster, 'room-1', 'u-member'), 'MEMBER');
  assert.equal(resolvePeerRoomAccessRole(roster, 'room-1', 'u-viewer'), 'VIEWER');
  assert.equal(resolvePeerRoomAccessRole(roster, 'room-1', 'u-other-room'), null);
  assert.equal(resolvePeerRoomAccessRole(roster, 'room-1', 'u-stranger'), null);

  // Standard Prisma member payload without mock source defaults members to 'MEMBER'.
  assert.equal(
    resolvePeerRoomAccessRole(
      { members: [{ userId: 'u-pg', role: 'MEMBER' }] },
      'room-1',
      'u-pg',
    ),
    'MEMBER',
  );

  const registry = replacePeerRegistryFromPresence(
    [
      { peerId: 'sock-viewer', userId: 'u-viewer', name: 'Viewer' },
      { peerId: 'sock-unassigned', userId: 'u-other-room', name: 'OtherRoom' },
      { peerId: 'sock-member', userId: 'u-member', name: 'Member' },
    ],
    'sock-self',
  );
  const channels = new Map([
    ['sock-viewer', { id: 'dc-v' }],
    ['sock-unassigned', { id: 'dc-u' }],
    ['sock-member', { id: 'dc-m' }],
  ]);

  const receivedChats: string[] = [];
  const receivedNotes: string[] = [];
  const receivedBoard: string[] = [];
  const receivedFile: string[] = [];

  const sendAs = (peerId: string, envelope: Record<string, unknown>) =>
    dispatchVerifiedDataChannelPayload({
      rawData: JSON.stringify(envelope),
      peerId,
      registry,
      localPeerId: 'sock-self',
      registeredChannel: channels.get(peerId),
      incomingChannel: channels.get(peerId)!,
      activeRoomId: 'room-1',
      targetRoomId: 'room-1',
      resolveSenderRole: (sender, roomId) => resolvePeerRoomAccessRole(roster, roomId, sender.userId),
      handlers: {
        onChat: (payload) => {
          receivedChats.push(String(payload.body ?? ''));
        },
        onNoteUpdate: (_id, payload) => {
          receivedNotes.push(String(payload.body ?? ''));
        },
        onNoteUnshared: () => {
          receivedNotes.push('unshared');
        },
        onMeetingBoard: (msg) => {
          receivedBoard.push(String(msg.type));
        },
        onFileShare: (msg) => {
          receivedFile.push(String(msg.type));
        },
      },
    });

  // VIEWER is blocked from all write/broadcast operations at receiver
  assert.equal(sendAs('sock-viewer', { type: 'chat', body: 'Forged chat' }), false);
  assert.equal(sendAs('sock-viewer', { type: 'note:shared', body: 'Note' }), false);
  assert.equal(sendAs('sock-viewer', { type: 'note:update', body: 'Edit' }), false);
  assert.equal(sendAs('sock-viewer', { type: 'note:unshared' }), false);
  assert.equal(sendAs('sock-viewer', { type: 'meeting-board:item-create', item: { id: '1' } }), false);
  assert.equal(sendAs('sock-viewer', { type: 'meeting-board:item-update', item: { id: '1' } }), false);
  assert.equal(sendAs('sock-viewer', { type: 'meeting-board:item-delete', itemId: '1' }), false);
  assert.equal(sendAs('sock-viewer', { type: 'meeting-board:item-move', itemId: '1' }), false);
  assert.equal(sendAs('sock-viewer', { type: 'meeting-board:sync-state', items: [] }), false);
  assert.equal(sendAs('sock-viewer', { type: 'file:start', transferId: 't1', name: 'x.txt', mimeType: 'text/plain', size: 1, totalChunks: 1 }), false);
  assert.equal(sendAs('sock-viewer', { type: 'file:chunk', transferId: 't1', index: 0, data: 'YQ==' }), false);
  assert.equal(sendAs('sock-viewer', { type: 'file:end', transferId: 't1' }), false);
  assert.equal(receivedChats.length, 0);
  assert.equal(receivedNotes.length, 0);

  // VIEWER is allowed passive sync-request, file:ack, and file:reject
  assert.equal(sendAs('sock-viewer', { type: 'meeting-board:sync-request', roomId: 'room-1' }), true);
  assert.equal(sendAs('sock-viewer', { type: 'file:ack', transferId: 't1' }), true);
  assert.equal(sendAs('sock-viewer', { type: 'file:reject', transferId: 't2', reason: 'invalid' }), true);
  assert.deepEqual(receivedBoard, ['meeting-board:sync-request']);
  assert.deepEqual(receivedFile, ['file:ack', 'file:reject']);

  // Unassigned peer (null) is blocked from EVERYTHING, including passive frames
  assert.equal(sendAs('sock-unassigned', { type: 'meeting-board:sync-request', roomId: 'room-1' }), false);
  assert.equal(sendAs('sock-unassigned', { type: 'file:ack', transferId: 't1' }), false);
  assert.equal(sendAs('sock-unassigned', { type: 'chat', body: 'Intruder' }), false);

  // Writable MEMBER continues functioning normally
  assert.equal(sendAs('sock-member', { type: 'chat', body: 'Legit msg' }), true);
  assert.equal(sendAs('sock-member', { type: 'meeting-board:item-create', item: { id: '2' } }), true);
  assert.equal(sendAs('sock-member', { type: 'file:start', transferId: 't3', name: 'ok.txt', mimeType: 'text/plain', size: 1, totalChunks: 1 }), true);
  assert.deepEqual(receivedChats, ['Legit msg']);
  assert.deepEqual(receivedBoard, ['meeting-board:sync-request', 'meeting-board:item-create']);
  assert.deepEqual(receivedFile, ['file:ack', 'file:reject', 'file:start']);
});
