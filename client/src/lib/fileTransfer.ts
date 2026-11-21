export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
export const CHUNK_SIZE = 16 * 1024; // 16 KB safe chunk size for RTCDataChannel
export const MAX_ACTIVE_TRANSFERS = 5;
export const FILE_ACK_TIMEOUT_MS = 10_000;

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
 * clone per 16 KB chunk while still flushing first, final, and periodic steps.
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
  receivedChunks: Map<number, Uint8Array>;
  receivedBytes: number;
  startedAt: number;
}

export interface ReceivedFile {
  transferId: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
  receivedAt: number;
}

export interface OutboundTransfer extends FileTransferMeta {
  sentChunks: number;
  progress: number; // 0..100
  status: "sending" | "completed" | "failed";
}

/**
 * Convert Uint8Array to base64 string
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
 * Convert base64 string to Uint8Array
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
 * Format bytes into human readable format (KB, MB, etc.)
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

/**
 * Slice a file/blob into 16KB chunks and stream them via callback
 */
export async function splitFileIntoChunks(
  file: File | Blob,
  onChunk: (index: number, total: number, base64Data: string) => Promise<void> | void
): Promise<number> {
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE) || 1;
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(file.size, start + CHUNK_SIZE);
    const slice = file.slice(start, end);
    const buffer = await slice.arrayBuffer();
    const base64 = uint8ArrayToBase64(new Uint8Array(buffer));
    await onChunk(i, totalChunks, base64);
  }
  return totalChunks;
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
