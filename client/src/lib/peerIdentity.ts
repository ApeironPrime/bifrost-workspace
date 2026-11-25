export interface VerifiedPeerIdentity {
  peerId: string;
  userId: string;
  name: string;
}

export type PeerRoomAccessRole = 'OWNER' | 'HOST' | 'MODERATOR' | 'MEMBER' | 'VIEWER' | null;

export interface WorkspaceMemberAccessRecord {
  userId: string;
  role: 'OWNER' | 'MEMBER';
  roomAssignments?: Array<{
    roomId: string;
    role: 'HOST' | 'MODERATOR' | 'MEMBER' | 'VIEWER';
    labelIds?: string[];
  }>;
}

const READ_ONLY_ALLOWED_DC_MESSAGE_TYPES = new Set([
  'meeting-board:sync-request',
  'crdt:sync-request',
  'file:ack',
  'file:reject',
  'file:resume',
]);

/**
 * Returns true only for passive protocol control messages that a VIEWER is permitted
 * to emit (board snapshot requests and file delivery acknowledgements/rejections).
 */
export function isReadOnlyAllowedDataChannelMessageType(type: string): boolean {
  return READ_ONLY_ALLOWED_DC_MESSAGE_TYPES.has(type);
}

/**
 * Resolves a workspace user's effective room role from a loaded member roster.
 * Returns `undefined` when no roster is available yet, or `null` when unassigned/absent.
 */
export function resolvePeerRoomAccessRole(
  roster: { source?: string; members: readonly WorkspaceMemberAccessRecord[] } | null | undefined,
  roomId: string | null | undefined,
  userId: string | null | undefined,
): PeerRoomAccessRole | undefined {
  if (!roster) return undefined;
  const normalizedRoomId = normalizeNonEmptyString(roomId);
  const normalizedUserId = normalizeNonEmptyString(userId);
  if (!normalizedRoomId || !normalizedUserId) return null;

  const member = roster.members.find((entry) => entry.userId === normalizedUserId);
  if (!member) return null;
  if (member.role === 'OWNER') return 'OWNER';

  if (Array.isArray(member.roomAssignments)) {
    const assignment = member.roomAssignments.find((item) => item.roomId === normalizedRoomId);
    return assignment ? assignment.role : null;
  }

  return roster.source === 'mock' ? null : 'MEMBER';
}

/**
 * Enforces receiver-side role authorization for verified DataChannel messages.
 * Unassigned peers (`null`) are blocked completely; `VIEWER` is limited to read-only control frames.
 */
export function canPeerSendDataChannelMessage(params: {
  messageType: string;
  senderRole: PeerRoomAccessRole | undefined;
}): boolean {
  if (params.senderRole === undefined) {
    return true;
  }
  if (params.senderRole === null) {
    return false;
  }
  if (params.senderRole === 'VIEWER') {
    return isReadOnlyAllowedDataChannelMessageType(params.messageType);
  }
  if (
    params.senderRole === 'OWNER' ||
    params.senderRole === 'HOST' ||
    params.senderRole === 'MODERATOR' ||
    params.senderRole === 'MEMBER'
  ) {
    return true;
  }
  return false;
}

export interface DataChannelEnvelopeHandlers {
  onChat: (
    payload: { id?: unknown; body?: unknown; sentAt?: unknown; hlc?: unknown; replyTo?: unknown },
    sender: VerifiedPeerIdentity,
  ) => void;
  onChatAction?: (payload: Record<string, unknown>, sender: VerifiedPeerIdentity) => void;
  onChatSync?: (payload: Record<string, unknown>, sender: VerifiedPeerIdentity) => void;
  onNoteUpdate: (
    peerId: string,
    payload: { body?: unknown; updatedAt?: unknown; hlc?: unknown },
    sender: VerifiedPeerIdentity,
  ) => void;
  onNoteUnshared: (peerId: string, sender: VerifiedPeerIdentity) => void;
  onMeetingBoard: (
    message: Record<string, unknown>,
    peerId: string,
    sender: VerifiedPeerIdentity,
  ) => void;
  onCrdt?: (
    message: Record<string, unknown>,
    peerId: string,
    sender: VerifiedPeerIdentity,
  ) => void;
  onFileShare: (
    message: Record<string, unknown>,
    peerId: string,
    sender: VerifiedPeerIdentity,
  ) => void;
  onFileBinaryChunk?: (
    frame: ArrayBuffer,
    peerId: string,
    sender: VerifiedPeerIdentity,
  ) => void;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeNonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Normalizes a server-sourced presence entry to `{ peerId, userId, name }`.
 * Returns `null` if any required identity field is missing or blank after trim.
 */
export function normalizeVerifiedPeer(raw: unknown): VerifiedPeerIdentity | null {
  if (!isPlainRecord(raw)) return null;
  const peerId = normalizeNonEmptyString(raw.peerId);
  const userId = normalizeNonEmptyString(raw.userId);
  const name = normalizeNonEmptyString(raw.name);
  if (!peerId || !userId || !name) return null;
  return { peerId, userId, name };
}

/**
 * Pure builder: constructs a fresh remote peer registry from a server `presence` roster
 * (`room:joined` / `presence:changed`), excluding invalid rows and `localPeerId`.
 */
export function replacePeerRegistryFromPresence(
  presence: readonly unknown[] | null | undefined,
  localPeerId?: string | null,
): Map<string, VerifiedPeerIdentity> {
  const next = new Map<string, VerifiedPeerIdentity>();
  if (!Array.isArray(presence)) return next;

  const normalizedLocalPeerId = normalizeNonEmptyString(localPeerId);
  for (const entry of presence) {
    const peer = normalizeVerifiedPeer(entry);
    if (!peer) continue;
    if (normalizedLocalPeerId && peer.peerId === normalizedLocalPeerId) continue;
    next.set(peer.peerId, peer);
  }
  return next;
}

/**
 * Pure parser for the server's `room:peer-joined` payload (`{ peerId, user: { id, name } }`).
 * Excludes the local peer and rejects invalid identities.
 */
export function normalizeJoinedPeerEvent(
  payload: { peerId?: unknown; user?: unknown } | null | undefined,
  localPeerId?: string | null,
): VerifiedPeerIdentity | null {
  if (!isPlainRecord(payload) || !isPlainRecord(payload.user)) return null;
  const peer = normalizeVerifiedPeer({
    peerId: payload.peerId,
    userId: payload.user.id,
    name: payload.user.name,
  });
  if (!peer) return null;

  const normalizedLocalPeerId = normalizeNonEmptyString(localPeerId);
  if (normalizedLocalPeerId && peer.peerId === normalizedLocalPeerId) return null;
  return peer;
}

/**
 * Synchronously upserts a joined peer identity from a server `room:peer-joined` event.
 *
 * Mutates `registry` in place (NOT a pure function). Rejects invalid payloads and
 * refuses to register `localPeerId` as a remote peer.
 */
export function upsertVerifiedPeerFromJoin(
  registry: Map<string, VerifiedPeerIdentity>,
  payload: { peerId?: unknown; user?: unknown } | null | undefined,
  localPeerId?: string | null,
): VerifiedPeerIdentity | null {
  const peer = normalizeJoinedPeerEvent(payload, localPeerId);
  if (!peer) return null;
  registry.set(peer.peerId, peer);
  return peer;
}

/**
 * Removes a peer identity from `registry` when membership explicitly ends (`room:peer-left`).
 *
 * Mutates `registry` in place (NOT a pure function). Do NOT call on transient
 * `RTCPeerConnection` errors while Socket.IO membership remains valid.
 */
export function removeVerifiedPeer(
  registry: Map<string, VerifiedPeerIdentity>,
  peerId: string | null | undefined,
): boolean {
  const key = normalizeNonEmptyString(peerId);
  if (!key) return false;
  return registry.delete(key);
}

/**
 * Clears all verified remote peer identities from `registry` (e.g., on `leaveRoom` or revocation).
 *
 * Mutates `registry` in place (NOT a pure function).
 */
export function clearPeerRegistry(registry: Map<string, VerifiedPeerIdentity>): void {
  registry.clear();
}

/**
 * O(1) lookup against the server-sourced peer registry. Fails closed (`null`) for
 * unknown peers, blank IDs, or `localPeerId`.
 */
export function resolveVerifiedPeer(
  registry: ReadonlyMap<string, VerifiedPeerIdentity>,
  peerId: string | null | undefined,
  localPeerId?: string | null,
): VerifiedPeerIdentity | null {
  const key = normalizeNonEmptyString(peerId);
  if (!key) return null;
  const normalizedLocalPeerId = normalizeNonEmptyString(localPeerId);
  if (normalizedLocalPeerId && key === normalizedLocalPeerId) return null;
  return registry.get(key) ?? null;
}

/**
 * Fails closed for incoming WebRTC signaling (`webrtc:offer`, `webrtc:answer`,
 * `webrtc:ice-candidate`) unless `peerId` resolves to a verified remote room peer.
 */
export function authorizeSignalingPeer(
  registry: ReadonlyMap<string, VerifiedPeerIdentity>,
  peerId: string | null | undefined,
  localPeerId?: string | null,
): VerifiedPeerIdentity | null {
  return resolveVerifiedPeer(registry, peerId, localPeerId);
}

/**
 * Verifies a DataChannel delivery context before parsing or dispatching payload bytes:
 * 1) resolves `verifiedSender` by closure `peerId`,
 * 2) confirms the channel still owns `peerId`,
 * 3) confirms `activeRoomId === targetRoomId`,
 * 4) fails closed (`null`) when no verified sender exists.
 */
export function verifyDataChannelSender<TChannel>(params: {
  registry: ReadonlyMap<string, VerifiedPeerIdentity>;
  peerId: string;
  localPeerId: string | null | undefined;
  registeredChannel: TChannel | undefined;
  incomingChannel: TChannel;
  activeRoomId: string | null | undefined;
  targetRoomId: string;
}): VerifiedPeerIdentity | null {
  const verifiedSender = resolveVerifiedPeer(params.registry, params.peerId, params.localPeerId);
  if (params.registeredChannel !== params.incomingChannel) return null;
  if (!params.activeRoomId || params.activeRoomId !== params.targetRoomId) return null;
  if (!verifiedSender) return null;
  return verifiedSender;
}

/**
 * Defense-in-depth guard usable by leaf receivers (e.g., `FileShare`) so alternate callsites
 * cannot bypass verified sender binding.
 */
export function hasMatchingVerifiedPeer(
  verifiedSender: VerifiedPeerIdentity | null | undefined,
  peerId: string,
): boolean {
  const normalized = normalizeVerifiedPeer(verifiedSender);
  return normalized !== null && normalized.peerId === normalizeNonEmptyString(peerId);
}

/**
 * Verifies channel/room/sender identity BEFORE parsing DataChannel JSON, then dispatches to the
 * appropriate subsystem with the server-verified `sender` bound strictly from closure `peerId`.
 */
export function dispatchVerifiedDataChannelPayload<TChannel>(params: {
  rawData: unknown;
  peerId: string;
  registry: ReadonlyMap<string, VerifiedPeerIdentity>;
  localPeerId: string | null | undefined;
  registeredChannel: TChannel | undefined;
  incomingChannel: TChannel;
  activeRoomId: string | null | undefined;
  targetRoomId: string;
  senderRole?: PeerRoomAccessRole;
  resolveSenderRole?: (sender: VerifiedPeerIdentity, targetRoomId: string) => PeerRoomAccessRole | undefined;
  handlers: DataChannelEnvelopeHandlers;
}): boolean {
  const verifiedSender = verifyDataChannelSender({
    registry: params.registry,
    peerId: params.peerId,
    localPeerId: params.localPeerId,
    registeredChannel: params.registeredChannel,
    incomingChannel: params.incomingChannel,
    activeRoomId: params.activeRoomId,
    targetRoomId: params.targetRoomId,
  });
  if (!verifiedSender) return false;

  if (params.rawData instanceof ArrayBuffer || ArrayBuffer.isView(params.rawData)) {
    const effectiveRole =
      params.senderRole !== undefined
        ? params.senderRole
        : params.resolveSenderRole?.(verifiedSender, params.targetRoomId);
    if (!canPeerSendDataChannelMessage({ messageType: 'file:binary-chunk', senderRole: effectiveRole })) {
      return false;
    }
    const frame =
      params.rawData instanceof ArrayBuffer
        ? params.rawData
        : (params.rawData.buffer.slice(
            params.rawData.byteOffset,
            params.rawData.byteOffset + params.rawData.byteLength,
          ) as ArrayBuffer);
    params.handlers.onFileBinaryChunk?.(frame, verifiedSender.peerId, verifiedSender);
    return true;
  }

  if (typeof params.rawData !== 'string') return false;

  let parsed: unknown;
  try {
    parsed = JSON.parse(params.rawData);
  } catch {
    return false;
  }
  if (!isPlainRecord(parsed) || typeof parsed.type !== 'string') return false;

  const effectiveRole =
    params.senderRole !== undefined
      ? params.senderRole
      : params.resolveSenderRole?.(verifiedSender, params.targetRoomId);
  if (!canPeerSendDataChannelMessage({ messageType: parsed.type, senderRole: effectiveRole })) {
    return false;
  }

  if (parsed.type === 'chat') {
    params.handlers.onChat(
      {
        body: parsed.body,
        sentAt: parsed.sentAt,
        ...(parsed.id !== undefined ? { id: parsed.id } : {}),
        ...(parsed.hlc !== undefined ? { hlc: parsed.hlc } : {}),
        ...(parsed.replyTo !== undefined ? { replyTo: parsed.replyTo } : {}),
      },
      verifiedSender,
    );
    return true;
  }
  if (parsed.type === 'chat:reaction' || parsed.type === 'chat:pin') {
    params.handlers.onChatAction?.(parsed, verifiedSender);
    return true;
  }
  if (parsed.type === 'chat:sync-state') {
    params.handlers.onChatSync?.(parsed, verifiedSender);
    return true;
  }
  if (parsed.type === 'note:shared' || parsed.type === 'note:update') {
    params.handlers.onNoteUpdate(
      verifiedSender.peerId,
      {
        body: parsed.body,
        updatedAt: parsed.updatedAt,
        ...(parsed.hlc !== undefined ? { hlc: parsed.hlc } : {}),
      },
      verifiedSender,
    );
    return true;
  }
  if (parsed.type === 'note:unshared') {
    params.handlers.onNoteUnshared(verifiedSender.peerId, verifiedSender);
    return true;
  }
  if (parsed.type.startsWith('meeting-board:')) {
    params.handlers.onMeetingBoard(parsed, verifiedSender.peerId, verifiedSender);
    return true;
  }
  if (parsed.type.startsWith('crdt:')) {
    params.handlers.onCrdt?.(parsed, verifiedSender.peerId, verifiedSender);
    return true;
  }
  if (parsed.type.startsWith('file:')) {
    params.handlers.onFileShare(parsed, verifiedSender.peerId, verifiedSender);
    return true;
  }
  return false;
}
