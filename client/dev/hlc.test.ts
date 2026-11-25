import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HybridLogicalClock,
  compareHlc,
  formatHlc,
  isIncomingNewer,
  parseHlc,
} from '../src/lib/hlc.ts';
import {
  applyChatPin,
  applyChatReaction,
  reconcileChatMessages,
  tokenizeChatMentions,
  type ChatMessageItem,
} from '../src/lib/chatNotes.ts';

test('HybridLogicalClock stays strictly monotonic even when local wall clock jumps backward', () => {
  const clock = new HybridLogicalClock('user-a', 1_000_000);
  const t1 = clock.now(1_000_000);
  const t2 = clock.now(995_000); // 5s backward skew
  const t3 = clock.now(995_000);

  assert.ok(compareHlc(t2, t1) > 0);
  assert.ok(compareHlc(t3, t2) > 0);
  assert.equal(parseHlc(t3)?.wallMs, 1_000_000);
  assert.equal(parseHlc(t3)?.counter, 3);
});

test('HybridLogicalClock.receive advances past future remote peer clocks', () => {
  const clock = new HybridLogicalClock('user-a', 1_000);
  const remoteAhead = formatHlc(5_000, 3, 'user-b');
  const localAfter = clock.receive(remoteAhead, 1_100);

  assert.ok(compareHlc(localAfter, remoteAhead) > 0);
  assert.equal(parseHlc(localAfter)?.wallMs, 5_000);
  assert.equal(parseHlc(localAfter)?.counter, 4);
});

test('isIncomingNewer prefers HLC causal ordering and falls back cleanly to timestamps', () => {
  const olderHlc = formatHlc(10_000, 0, 'u1');
  const newerHlc = formatHlc(10_000, 1, 'u2');
  assert.equal(isIncomingNewer(olderHlc, 99_999, newerHlc, 5_000), true);
  assert.equal(isIncomingNewer(newerHlc, 5_000, olderHlc, 99_999), false);

  // Legacy timestamp fallback
  assert.equal(isIncomingNewer(undefined, 1000, undefined, 2000), true);
  assert.equal(isIncomingNewer(undefined, 2000, undefined, 1000), false);
});

test('applyChatReaction, applyChatPin, and reconcileChatMessages merge deterministically', () => {
  const base: ChatMessageItem[] = [
    {
      id: 'm1',
      author: 'Bạn',
      authorId: 'u1',
      body: 'Hello team',
      mine: true,
      sentAt: 1000,
      reactions: { '👍': ['u1'] },
    },
  ];

  const reacted = applyChatReaction(base, 'm1', '👍', 'u2', true);
  assert.deepEqual(reacted[0].reactions, { '👍': ['u1', 'u2'] });

  const pinned = applyChatPin(reacted, 'm1', true, 'Bob');
  assert.equal(pinned[0].pinned, true);
  assert.equal(pinned[0].pinnedBy, 'Bob');

  const merged = reconcileChatMessages(
    pinned,
    [
      {
        id: 'm1',
        author: 'Alice',
        authorId: 'u1',
        body: 'Hello team',
        mine: false,
        sentAt: 1000,
        reactions: { '❤️': ['u3'] },
      },
      {
        id: 'm2',
        author: 'Bob',
        authorId: 'u2',
        body: 'Second message',
        mine: false,
        sentAt: 2000,
      },
    ],
    'u1',
    'Bạn',
  );

  assert.equal(merged.length, 2);
  assert.equal(merged[0].mine, true);
  assert.equal(merged[0].author, 'Bạn');
  assert.deepEqual(merged[0].reactions, { '👍': ['u1', 'u2'], '❤️': ['u3'] });
  assert.equal(merged[0].pinned, true);
  assert.equal(merged[1].id, 'm2');
});

test('tokenizeChatMentions highlights known multi-word names and @tokens safely', () => {
  const tokens = tokenizeChatMentions('Chào @Minh Anh và @khanh, nhớ xem @room!', ['Minh Anh', 'Văn Khánh']);
  assert.deepEqual(tokens, [
    { kind: 'text', value: 'Chào ' },
    { kind: 'mention', value: '@Minh Anh' },
    { kind: 'text', value: ' và ' },
    { kind: 'mention', value: '@khanh' },
    { kind: 'text', value: ', nhớ xem ' },
    { kind: 'mention', value: '@room' },
    { kind: 'text', value: '!' },
  ]);
});
