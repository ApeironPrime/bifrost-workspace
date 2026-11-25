export const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB direct P2P streaming limit
export const CHUNK_SIZE = 64 * 1024; // 64 KB binary chunk size for RTCDataChannel
export const MAX_ACTIVE_TRANSFERS = 5;
export const FILE_ACK_TIMEOUT_MS = 15_000;
export const MAX_BUFFERED_AMOUNT = 1024 * 1024; // 1 MB DataChannel high-water mark
export const BUFFERED_LOW_THRESHOLD = 256 * 1024; // 256 KB DataChannel low-water mark
export const RESUMABLE_TRANSFER_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function fileSizeIssue(size: number): 'empty' | 'too-large' | null {
  if (!Number.isFinite(size) || size <= 0) return 'empty';
  return size > MAX_FILE_SIZE ? 'too-large' : null;
}

export interface OutboundTransferRecipientState {
  targetPeers: ReadonlySet<string>;
  rejectedPeers: ReadonlySet<string>;
  ackedPeers: ReadonlySet<string>;
  endSent: boolean;
}

/**
 * Throttles inbound UI progress updates so large transfers avoid one React state
 * clone per chunk while still flushing first, final, and periodic steps.
 */
export function shouldFlushInboundProgress(params: {
  receivedCount: number;
  totalChunks: number;
  lastFlushedCount: number;
  lastFlushedAtMs: number;
  nowMs?: number;
  minIntervalMs?: number;
}): boolean {
  if (params.totalChunks <= 0) return true;
  if (params.receivedCount <= 1 || params.lastFlushedCount <= 0) return true;
  if (params.receivedCount >= params.totalChunks) return true;
  const nowMs = params.nowMs ?? Date.now();
  const minIntervalMs = params.minIntervalMs ?? 80;
  if (nowMs - params.lastFlushedAtMs < minIntervalMs) return false;
  const prevPct = Math.round((params.lastFlushedCount / params.totalChunks) * 100);
  const nextPct = Math.round((params.receivedCount / params.totalChunks) * 100);
  return nextPct - prevPct >= 1;
}

/**
 * Creates immutable recipient-tracking state for one outbound transfer.
 */
export function createOutboundRecipientState(
  targetPeerIds: Iterable<string>,
): OutboundTransferRecipientState {
  return {
    targetPeers: new Set(targetPeerIds),
    rejectedPeers: new Set(),
    ackedPeers: new Set(),
    endSent: false,
  };
}

/**
 * Records that `endSent` transition has occurred after streaming all chunks.
 */
export function markOutboundEndSent(
  state: OutboundTransferRecipientState,
): OutboundTransferRecipientState {
  if (state.endSent) return state;
  return {
    ...state,
    endSent: true,
  };
}

/**
 * Records a `file:reject` from `peerId` scoped to that peer only.
 */
export function recordOutboundPeerReject(
  state: OutboundTransferRecipientState,
  peerId: string,
): OutboundTransferRecipientState {
  if (!state.targetPeers.has(peerId) || state.rejectedPeers.has(peerId) || state.ackedPeers.has(peerId)) {
    return state;
  }
  const rejectedPeers = new Set(state.rejectedPeers);
  rejectedPeers.add(peerId);
  return {
    ...state,
    rejectedPeers,
  };
}

/**
 * Records a receiver `file:ack` from `peerId`.
 */
export function recordOutboundPeerAck(
  state: OutboundTransferRecipientState,
  peerId: string,
): OutboundTransferRecipientState {
  if (!state.targetPeers.has(peerId) || state.rejectedPeers.has(peerId) || state.ackedPeers.has(peerId)) {
    return state;
  }
  const ackedPeers = new Set(state.ackedPeers);
  ackedPeers.add(peerId);
  return {
    ...state,
    ackedPeers,
  };
}

/**
 * Lists target peers that remain open and have not rejected the transfer.
 */
export function activePeerIds(
  state: OutboundTransferRecipientState,
  currentlyOpenPeerIds: ReadonlySet<string>,
): string[] {
  const active: string[] = [];
  for (const peerId of state.targetPeers) {
    if (!state.rejectedPeers.has(peerId) && currentlyOpenPeerIds.has(peerId)) {
      active.push(peerId);
    }
  }
  return active;
}

/**
 * Evaluates aggregate outbound transfer status across all initial target peers.
 */
export function evaluateOutboundTransferResolution(
  state: OutboundTransferRecipientState,
  currentlyOpenPeerIds: ReadonlySet<string>,
): 'pending' | 'completed' | 'failed' {
  const active = activePeerIds(state, currentlyOpenPeerIds);
  if (active.length === 0 && state.ackedPeers.size === 0) {
    return 'failed';
  }
  if (!state.endSent) {
    return 'pending';
  }
  const allActiveAcked = active.every((peerId) => state.ackedPeers.has(peerId));
  if (allActiveAcked && state.ackedPeers.size > 0) {
    return 'completed';
  }
  return 'pending';
}

export interface FileTransferMeta {
  transferId: string;
  name: string;
  mimeType: string;
  size: number;
  totalChunks: number;
}

export interface InboundTransfer extends FileTransferMeta {
  senderPeerId: string;
  senderUserId: string;
  receivedCount: number;
  contiguousChunks: number;
  receivedBytes: number;
  startedAt: number;
  paused?: boolean;
  storageMode?: 'disk-opfs' | 'memory';
}

export interface ReceivedFile {
  transferId: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
  receivedAt: number;
  sha256?: string;
  blob?: Blob;
  storageMode?: 'disk-opfs' | 'memory';
}

export interface OutboundTransfer extends FileTransferMeta {
  sentChunks: number;
  progress: number; // 0..100
  status: "sending" | "completed" | "failed";
  resumable?: boolean;
  sha256?: string;
}

const BINARY_MAGIC_0 = 0x42; // 'B'
const BINARY_MAGIC_1 = 0x46; // 'F'
const BINARY_MAGIC_2 = 0x43; // 'C'
const BINARY_MAGIC_3 = 0x31; // '1'
const BINARY_HEADER_FIXED_BYTES = 9; // 4 magic + 1 idLen + 4 chunkIndex

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Encodes a binary DataChannel file chunk frame (`BFC1`):
 * `[4B magic 'BFC1'][1B idLen][4B uint32 chunkIndex][idBytes][raw payload bytes]`
 * Eliminates ~33% Base64/JSON wire bloat.
 */
export function encodeBinaryFileChunk(
  transferId: string,
  chunkIndex: number,
  payload: Uint8Array,
): ArrayBuffer {
  const idBytes = textEncoder.encode(transferId);
  if (idBytes.byteLength === 0 || idBytes.byteLength > 64) {
    throw new Error('Invalid transferId length for binary chunk frame');
  }
  const frame = new Uint8Array(BINARY_HEADER_FIXED_BYTES + idBytes.byteLength + payload.byteLength);
  frame[0] = BINARY_MAGIC_0;
  frame[1] = BINARY_MAGIC_1;
  frame[2] = BINARY_MAGIC_2;
  frame[3] = BINARY_MAGIC_3;
  frame[4] = idBytes.byteLength;
  const view = new DataView(frame.buffer);
  view.setUint32(5, chunkIndex >>> 0, false);
  frame.set(idBytes, BINARY_HEADER_FIXED_BYTES);
  frame.set(payload, BINARY_HEADER_FIXED_BYTES + idBytes.byteLength);
  return frame.buffer;
}

/**
 * Decodes a `BFC1` binary DataChannel chunk frame into `{ transferId, index, data }`
 * returning `null` if the header is malformed or truncated.
 */
export function decodeBinaryFileChunk(
  raw: ArrayBuffer | ArrayBufferView,
): { transferId: string; index: number; data: Uint8Array } | null {
  const bytes =
    raw instanceof ArrayBuffer
      ? new Uint8Array(raw)
      : new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  if (bytes.byteLength < BINARY_HEADER_FIXED_BYTES + 1) return null;
  if (
    bytes[0] !== BINARY_MAGIC_0 ||
    bytes[1] !== BINARY_MAGIC_1 ||
    bytes[2] !== BINARY_MAGIC_2 ||
    bytes[3] !== BINARY_MAGIC_3
  ) {
    return null;
  }
  const idLen = bytes[4];
  if (idLen < 1 || idLen > 64 || BINARY_HEADER_FIXED_BYTES + idLen > bytes.byteLength) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const index = view.getUint32(5, false);
  const transferId = textDecoder.decode(
    bytes.subarray(BINARY_HEADER_FIXED_BYTES, BINARY_HEADER_FIXED_BYTES + idLen),
  );
  if (!transferId) return null;
  const data = bytes.subarray(BINARY_HEADER_FIXED_BYTES + idLen);
  return { transferId, index, data };
}

/**
 * Streams a Blob/File from `startChunkIndex` to EOF one slice at a time in O(1) RAM.
 */
export async function streamFileSlices(
  file: Blob,
  startChunkIndex: number,
  onSlice: (index: number, totalChunks: number, bytes: Uint8Array) => Promise<void> | void,
  chunkSize = CHUNK_SIZE,
): Promise<number> {
  const totalChunks = Math.ceil(file.size / chunkSize) || 1;
  const startIndex = Math.max(0, Math.min(totalChunks, Math.floor(startChunkIndex)));
  for (let i = startIndex; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(file.size, start + chunkSize);
    const buffer = await file.slice(start, end).arrayBuffer();
    await onSlice(i, totalChunks, new Uint8Array(buffer));
  }
  return totalChunks;
}

/**
 * Computes the safe starting chunk index when resuming across one or more target peers.
 * Uses the minimum reported `nextChunkIndex` so no target peer misses any chunk.
 */
export function resolveResumeStartChunk(
  peerResumeOffsets: ReadonlyMap<string, number>,
  targetPeerIds: readonly string[],
  fallbackChunk = 0,
): number {
  if (targetPeerIds.length === 0) return Math.max(0, fallbackChunk);
  let minOffset = Infinity;
  for (const peerId of targetPeerIds) {
    const reported = peerResumeOffsets.get(peerId);
    if (typeof reported !== 'number' || !Number.isInteger(reported) || reported < 0) {
      return Math.max(0, fallbackChunk);
    }
    if (reported < minOffset) minOffset = reported;
  }
  return Number.isFinite(minOffset) ? minOffset : Math.max(0, fallbackChunk);
}

/**
 * Convert Uint8Array to base64 string (legacy fallback for non-binary peers/fixtures)
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert base64 string to Uint8Array (legacy fallback)
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Format bytes into human readable format (B, KB, MB, GB)
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

/**
 * Slice a file/blob into chunks and stream them as Base64 via callback (legacy fallback)
 */
export async function splitFileIntoChunks(
  file: File | Blob,
  onChunk: (index: number, total: number, base64Data: string) => Promise<void> | void
): Promise<number> {
  return streamFileSlices(file, 0, async (index, total, bytes) => {
    await onChunk(index, total, uint8ArrayToBase64(bytes));
  });
}

/**
 * Reassemble received chunks into a single Blob
 */
export function reassembleChunks(
  chunks: Map<number, Uint8Array>,
  totalChunks: number,
  mimeType: string,
  options?: { clearChunks?: boolean },
): Blob {
  const parts: Uint8Array[] = [];
  for (let i = 0; i < totalChunks; i++) {
    const chunk = chunks.get(i);
    if (!chunk) {
      throw new Error(`Thiếu phần tệp số ${i + 1}/${totalChunks}`);
    }
    parts.push(chunk);
  }
  const blob = new Blob(parts as BlobPart[], {
    type: mimeType || "application/octet-stream",
  });
  if (options?.clearChunks) {
    chunks.clear();
  }
  return blob;
}
