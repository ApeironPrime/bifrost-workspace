import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNoteResyncEnvelope,
  buildNoteUnshareEnvelope,
  buildNoteUpdateEnvelope,
  classifyChatComposerKey,
  createChatOutboundPayload,
  deriveNoteShareStatus,
  formatClockTime,
  MAX_CHAT_MESSAGE_LENGTH,
  normalizeIncomingChatMessage,
  normalizeIncomingSharedNote,
  shouldStartChatGroup,
} from '../src/lib/chatNotes.ts';

test('outbound chat shares one sentAt timestamp between sender and peer and clamps 4000 chars', () => {
  const fixedNow = 1_760_000_123_456;
  const payload = createChatOutboundPayload('Alice', 'You', '  Line 1\nLine 2  ', fixedNow);
  assert.ok(payload);
  assert.equal(payload.envelope.type, 'chat');
  assert.equal(payload.envelope.sentAt, fixedNow);
  assert.equal(payload.localMessage.sentAt, fixedNow);
  assert.equal(payload.envelope.body, 'Line 1\nLine 2');
  assert.equal(payload.localMessage.body, 'Line 1\nLine 2');

  const overLimit = 'a'.repeat(MAX_CHAT_MESSAGE_LENGTH + 50);
  const clamped = createChatOutboundPayload('Alice', 'You', overLimit, fixedNow);
  assert.equal(clamped?.envelope.body.length, MAX_CHAT_MESSAGE_LENGTH);

  assert.equal(createChatOutboundPayload('Alice', 'You', '   \n\t  ', fixedNow), null);
});

test('incoming chat and legacy chat messages bind verified sender, ignore spoofed author, and format HH:mm across VI/EN/JA', () => {
  const peerTs = 1_760_000_222_000;
  const fallbackNow = 1_760_000_999_000;
  const bobSender = { userId: 'u-bob', name: 'Bob' };
  const legacySender = { userId: 'u-legacy', name: 'Legacy' };

  const modern = normalizeIncomingChatMessage(
    { author: 'Spoofed Admin', body: 'Hello\nWorld', sentAt: peerTs } as { body?: unknown; sentAt?: unknown },
    bobSender,
    fallbackNow,
  );
  assert.deepEqual(modern, {
    author: 'Bob',
    authorId: 'u-bob',
    body: 'Hello\nWorld',
    mine: false,
    sentAt: peerTs,
  });

  // Older peer omitting sentAt falls back to receipt time while binding verified identity
  const legacy = normalizeIncomingChatMessage({ body: 'Hi' }, legacySender, fallbackNow);
  assert.deepEqual(legacy, {
    author: 'Legacy',
    authorId: 'u-legacy',
    body: 'Hi',
    mine: false,
    sentAt: fallbackNow,
  });

  // Missing/blank verified sender fails closed even if payload contains an author string
  assert.equal(
    normalizeIncomingChatMessage({ author: 'Spoofed', body: 'Blocked' } as { body?: unknown }, null, fallbackNow),
    null,
  );
  assert.equal(
    normalizeIncomingChatMessage({ author: 'Spoofed', body: 'Blocked' } as { body?: unknown }, { userId: 'u-1', name: '   ' }, fallbackNow),
    null,
  );

  // Invalid numeric sentAt also falls back safely
  const malformedTs = normalizeIncomingChatMessage(
    { body: 'Oops', sentAt: -5 },
    bobSender,
    fallbackNow,
  );
  assert.equal(malformedTs?.sentAt, fallbackNow);

  for (const lang of ['vi', 'en', 'ja'] as const) {
    const formatted = formatClockTime(peerTs, lang);
    assert.match(formatted, /^\d{2}:\d{2}$/);
  }
  assert.equal(formatClockTime(undefined, 'vi'), '');
});

test('chat grouping merges same authorId inside window, keeps legacy fallback, and splits homonymous users with distinct userIds', () => {
  const t0 = 1_760_000_000_000;
  const messages = [
    { id: '1', author: 'You', authorId: 'u-me', body: 'One', mine: true, sentAt: t0 },
    { id: '2', author: 'You', authorId: 'u-me', body: 'Two', mine: true, sentAt: t0 + 30_000 },
    { id: '3', author: 'You', authorId: 'u-me', body: 'Later', mine: true, sentAt: t0 + 180_000 },
    { id: '4', author: 'Minh', authorId: 'u-minh-1', body: 'Reply 1', mine: false, sentAt: t0 + 190_000 },
    { id: '5', author: 'Minh', authorId: 'u-minh-1', body: 'Cont 1', mine: false, sentAt: t0 + 200_000 },
    { id: '6', author: 'Minh', authorId: 'u-minh-2', body: 'Different Minh!', mine: false, sentAt: t0 + 205_000 },
    { id: '7', author: 'Minh', body: 'Legacy same name', mine: false, sentAt: t0 + 210_000 },
  ];
  assert.equal(shouldStartChatGroup(messages, 0), true);
  assert.equal(shouldStartChatGroup(messages, 1), false);
  assert.equal(shouldStartChatGroup(messages, 2), true);
  assert.equal(shouldStartChatGroup(messages, 3), true);
  assert.equal(shouldStartChatGroup(messages, 4), false);
  assert.equal(shouldStartChatGroup(messages, 5), true);
  assert.equal(shouldStartChatGroup(messages, 6), false);
});

test('chat composer Enter sends, Shift+Enter adds newline, and IME composition blocks accidental send', () => {
  const base = {
    key: 'Enter',
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    isComposing: false,
    keyCode: 13,
    composing: false,
  };
  assert.equal(classifyChatComposerKey(base), 'send');
  assert.equal(classifyChatComposerKey({ ...base, shiftKey: true }), 'newline');
  assert.equal(classifyChatComposerKey({ ...base, isComposing: true }), 'ignore');
  assert.equal(classifyChatComposerKey({ ...base, keyCode: 229 }), 'ignore');
  assert.equal(classifyChatComposerKey({ ...base, composing: true }), 'ignore');
  assert.equal(classifyChatComposerKey({ ...base, key: 'a', keyCode: 65 }), 'ignore');
});

test('shared notes bind verified sender, ignore spoofed author, handle updatedAt timestamps, and fail closed on unknown sender', () => {
  const noteTs = 1_760_001_000_000;
  const fallbackNow = 1_760_002_000_000;

  assert.deepEqual(
    normalizeIncomingSharedNote(
      { author: 'Spoofed Admin', body: 'Agenda draft', updatedAt: noteTs } as { body?: unknown; updatedAt?: unknown },
      { userId: 'u-minh', name: 'Minh' },
      fallbackNow,
    ),
    { author: 'Minh', authorId: 'u-minh', body: 'Agenda draft', updatedAt: noteTs },
  );

  assert.deepEqual(
    normalizeIncomingSharedNote({ body: 'Old note' }, { userId: 'u-legacy', name: 'Legacy' }, fallbackNow),
    { author: 'Legacy', authorId: 'u-legacy', body: 'Old note', updatedAt: fallbackNow },
  );

  assert.equal(
    normalizeIncomingSharedNote({ author: 'Spoofed', body: 'No sender' } as { body?: unknown }, undefined, fallbackNow),
    null,
  );
  assert.equal(
    normalizeIncomingSharedNote({ author: 'Spoofed', body: 'Empty id' } as { body?: unknown }, { userId: '', name: 'Alice' }, fallbackNow),
    null,
  );
});

test('shared notes status transitions and reconnect/readOnly/room guards prevent leaks and silent drops', () => {
  assert.equal(deriveNoteShareStatus({ noteShared: false, peersCount: 2 }), 'private');
  assert.equal(deriveNoteShareStatus({ noteShared: true, peersCount: 2 }), 'active');
  // Disconnecting all peers keeps sharing intent active in waiting state
  assert.equal(deriveNoteShareStatus({ noteShared: true, peersCount: 0 }), 'waiting');
  assert.equal(deriveNoteShareStatus({ noteShared: true, peersCount: 1, resyncing: true }), 'resyncing');
  assert.equal(deriveNoteShareStatus({ noteShared: true, peersCount: 1, error: 'sync failed' }), 'failed');

  // Typing during temporary disconnect keeps intent active without erroring or emitting empty broadcasts
  assert.equal(
    buildNoteUpdateEnvelope({
      noteShared: true,
      roomReadOnly: false,
      openConnections: 0,
      author: 'Alice',
      body: 'Offline edit',
      updatedAt: 1000,
    }),
    null,
  );
  assert.deepEqual(
    buildNoteUpdateEnvelope({
      noteShared: true,
      roomReadOnly: false,
      openConnections: 2,
      author: 'Alice',
      body: 'Live edit',
      updatedAt: 2000,
    }),
    { type: 'note:update', author: 'Alice', body: 'Live edit', updatedAt: 2000 },
  );

  // Reconnect/new peer auto-resync works when sharing is enabled in the same writable room
  assert.deepEqual(
    buildNoteResyncEnvelope({
      noteShared: true,
      roomReadOnly: false,
      channelRoomId: 'room-1',
      activeRoomId: 'room-1',
      author: 'Alice',
      body: 'Synced draft',
      updatedAt: 3000,
    }),
    { type: 'note:shared', author: 'Alice', body: 'Synced draft', updatedAt: 3000 },
  );

  // Explicit stop sharing suppresses broadcasts; room change prevents stale channel leaks; readOnly never broadcasts
  assert.equal(
    buildNoteResyncEnvelope({
      noteShared: false,
      roomReadOnly: false,
      channelRoomId: 'room-1',
      activeRoomId: 'room-1',
      author: 'Alice',
      body: 'Stopped',
      updatedAt: 3000,
    }),
    null,
  );
  assert.equal(
    buildNoteResyncEnvelope({
      noteShared: true,
      roomReadOnly: false,
      channelRoomId: 'room-old',
      activeRoomId: 'room-new',
      author: 'Alice',
      body: 'Leak attempt',
      updatedAt: 3000,
    }),
    null,
  );
  assert.equal(
    buildNoteResyncEnvelope({
      noteShared: true,
      roomReadOnly: true,
      channelRoomId: 'room-1',
      activeRoomId: 'room-1',
      author: 'Viewer',
      body: 'Read only',
      updatedAt: 3000,
    }),
    null,
  );
  assert.equal(
    buildNoteUpdateEnvelope({
      noteShared: true,
      roomReadOnly: true,
      openConnections: 2,
      author: 'Viewer',
      body: 'Blocked',
      updatedAt: 3000,
    }),
    null,
  );
  assert.equal(buildNoteUnshareEnvelope({ roomReadOnly: true, openConnections: 1, author: 'Viewer' }), null);
  assert.equal(buildNoteUnshareEnvelope({ roomReadOnly: false, openConnections: 0, author: 'Alice' }), null);
  assert.deepEqual(
    buildNoteUnshareEnvelope({ roomReadOnly: false, openConnections: 1, author: 'Alice' }),
    { type: 'note:unshared', author: 'Alice' },
  );
});
