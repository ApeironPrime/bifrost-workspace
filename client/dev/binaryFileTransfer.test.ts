import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  CHUNK_SIZE,
  decodeBinaryFileChunk,
  encodeBinaryFileChunk,
  resolveResumeStartChunk,
  streamFileSlices,
} from '../src/lib/fileTransfer.ts';
import { computeSha256Hex, IncrementalSha256 } from '../src/lib/sha256.ts';
import {
  dispatchVerifiedDataChannelPayload,
  replacePeerRegistryFromPresence,
} from '../src/lib/peerIdentity.ts';

test('IncrementalSha256 matches Node crypto SHA-256 across empty, short, and multi-chunk inputs', () => {
  assert.equal(
    computeSha256Hex(new Uint8Array(0)),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
  assert.equal(
    computeSha256Hex(new TextEncoder().encode('abc')),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );

  const sample = new Uint8Array(195_123);
  for (let i = 0; i < sample.byteLength; i++) {
    sample[i] = (i * 31 + 7) % 256;
  }
  const expected = createHash('sha256').update(sample).digest('hex');

  const hasher = new IncrementalSha256();
  hasher.update(sample.subarray(0, 65_536));
  hasher.update(sample.subarray(65_536, 130_000));
  hasher.update(sample.subarray(130_000));
  assert.equal(hasher.digestHex(), expected);
});

test('encodeBinaryFileChunk & decodeBinaryFileChunk round-trip with minimal overhead and reject corrupt frames', () => {
  const payload = new Uint8Array(CHUNK_SIZE);
  for (let i = 0; i < payload.byteLength; i++) payload[i] = i % 251;

  const transferId = '550e8400-e29b-41d4-a716-446655440000';
  const frame = encodeBinaryFileChunk(transferId, 42, payload);
  assert.ok(frame.byteLength < payload.byteLength + 64, 'Binary framing overhead must be < 64 bytes');

  const decoded = decodeBinaryFileChunk(frame);
  assert.ok(decoded);
  assert.equal(decoded!.transferId, transferId);
  assert.equal(decoded!.index, 42);
  assert.deepEqual(decoded!.data, payload);

  // Reject malformed magic or truncated header
  const bad = new Uint8Array(frame.slice(0));
  bad[0] = 0x00;
  assert.equal(decodeBinaryFileChunk(bad), null);
  assert.equal(decodeBinaryFileChunk(new Uint8Array(4)), null);
});

test('streamFileSlices and resolveResumeStartChunk support O(1) sliced streaming from resume offset', async () => {
  const bytes = new Uint8Array(CHUNK_SIZE * 2 + 512).fill(9);
  const blob = new Blob([bytes]);
  const seen: number[] = [];

  const total = await streamFileSlices(blob, 1, (index, totalChunks, slice) => {
    seen.push(index);
    assert.equal(totalChunks, 3);
    assert.ok(slice.byteLength <= CHUNK_SIZE);
  });

  assert.equal(total, 3);
  assert.deepEqual(seen, [1, 2]);

  const offsets = new Map([
    ['peer-a', 12],
    ['peer-b', 8],
  ]);
  assert.equal(resolveResumeStartChunk(offsets, ['peer-a', 'peer-b']), 8);
  assert.equal(resolveResumeStartChunk(offsets, ['peer-a', 'peer-missing']), 0);
});

test('dispatchVerifiedDataChannelPayload gates binary ArrayBuffer frames by verified role', () => {
  const registry = replacePeerRegistryFromPresence(
    [
      { peerId: 'sock-member', userId: 'u-member', name: 'Member' },
      { peerId: 'sock-viewer', userId: 'u-viewer', name: 'Viewer' },
    ],
    'sock-self',
  );
  const channels = new Map([
    ['sock-member', { id: 'dc-m' }],
    ['sock-viewer', { id: 'dc-v' }],
  ]);

  const roster = {
    source: 'mock',
    members: [
      { userId: 'u-member', role: 'MEMBER' as const, roomAssignments: [{ roomId: 'r1', role: 'MEMBER' as const }] },
      { userId: 'u-viewer', role: 'MEMBER' as const, roomAssignments: [{ roomId: 'r1', role: 'VIEWER' as const }] },
    ],
  };

  const frame = encodeBinaryFileChunk('tx-1', 0, new Uint8Array([1, 2, 3]));
  const receivedFrames: ArrayBuffer[] = [];

  const sendBinary = (peerId: string) =>
    dispatchVerifiedDataChannelPayload({
      rawData: frame,
      peerId,
      registry,
      localPeerId: 'sock-self',
      registeredChannel: channels.get(peerId),
      incomingChannel: channels.get(peerId)!,
      activeRoomId: 'r1',
      targetRoomId: 'r1',
      resolveSenderRole: (sender) =>
        roster.members.find((m) => m.userId === sender.userId)?.roomAssignments[0].role ?? null,
      handlers: {
        onChat: () => {},
        onNoteUpdate: () => {},
        onNoteUnshared: () => {},
        onMeetingBoard: () => {},
        onFileShare: () => {},
        onFileBinaryChunk: (buf) => {
          receivedFrames.push(buf);
        },
      },
    });

  assert.equal(sendBinary('sock-viewer'), false);
  assert.equal(sendBinary('sock-member'), true);
  assert.equal(receivedFrames.length, 1);
});
