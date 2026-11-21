import { LOCALE_META, type Language } from '../i18n/locale.ts';

export const MAX_CHAT_MESSAGE_LENGTH = 4000;
export const CHAT_MESSAGE_GROUP_WINDOW_MS = 2 * 60 * 1000;

export interface ChatMessageItem {
  id: string;
  author: string;
  authorId?: string;
  body: string;
  mine: boolean;
  sentAt?: number;
}

export interface SharedNoteItem {
  author: string;
  authorId?: string;
  body: string;
  updatedAt?: number;
}

export interface VerifiedSenderSummary {
  userId: string;
  name: string;
}

export type ChatDataEnvelope = {
  type: 'chat';
  author: string;
  body: string;
  sentAt?: number;
};

export type NoteDataEnvelope =
  | { type: 'note:shared' | 'note:update'; author: string; body: string; updatedAt?: number }
  | { type: 'note:unshared'; author: string };

export type NoteShareStatus = 'private' | 'active' | 'waiting' | 'resyncing' | 'failed';

export interface ComposerKeyEventInput {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  isComposing: boolean;
  keyCode: number;
  composing?: boolean;
}

export type ComposerKeyAction = 'send' | 'newline' | 'ignore';

/**
 * Resolve a valid Unix millisecond timestamp, falling back to `fallbackNow`
 * when receiving legacy messages from older peers without timestamp fields.
 */
export function resolveTimestamp(candidate: unknown, fallbackNow = Date.now()): number {
  if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
    return candidate;
  }
  return fallbackNow;
}

/**
 * Build a single shared timestamp for outbound chat so local display and peer
 * delivery record the exact same `sentAt` value.
 */
export function createChatOutboundPayload(
  wireAuthor: string,
  localAuthor: string,
  rawBody: string,
  now = Date.now(),
  localAuthorId?: string,
): {
  envelope: ChatDataEnvelope;
  localMessage: Omit<ChatMessageItem, 'id'>;
} | null {
  const body = rawBody.trim();
  if (!body) return null;
  const clampedBody = body.slice(0, MAX_CHAT_MESSAGE_LENGTH);
  const sentAt = resolveTimestamp(now);
  const trimmedLocalId = typeof localAuthorId === 'string' ? localAuthorId.trim() : '';
  return {
    envelope: {
      type: 'chat',
      author: wireAuthor,
      body: clampedBody,
      sentAt,
    },
    localMessage: {
      author: localAuthor,
      ...(trimmedLocalId ? { authorId: trimmedLocalId } : {}),
      body: clampedBody,
      mine: true,
      sentAt,
    },
  };
}

function normalizeSenderSummary(
  sender: VerifiedSenderSummary | null | undefined,
): VerifiedSenderSummary | null {
  const userId = typeof sender?.userId === 'string' ? sender.userId.trim() : '';
  const name = typeof sender?.name === 'string' ? sender.name.trim() : '';
  if (!userId || !name) return null;
  return { userId, name };
}

/**
 * Normalize an incoming chat envelope safely using the server-verified sender identity.
 * Never reads `payload.author`; fails closed (`null`) if verified sender identity is missing.
 */
export function normalizeIncomingChatMessage(
  payload: { body?: unknown; sentAt?: unknown },
  sender: VerifiedSenderSummary | null | undefined,
  fallbackNow = Date.now(),
): Omit<ChatMessageItem, 'id'> | null {
  const verified = normalizeSenderSummary(sender);
  if (!verified || typeof payload.body !== 'string') return null;
  return {
    author: verified.name,
    authorId: verified.userId,
    body: payload.body,
    mine: false,
    sentAt: resolveTimestamp(payload.sentAt, fallbackNow),
  };
}

/**
 * Normalize an incoming shared-note envelope safely using the server-verified sender identity.
 * Never reads `payload.author`; fails closed (`null`) if verified sender identity is missing.
 */
export function normalizeIncomingSharedNote(
  payload: { body?: unknown; updatedAt?: unknown },
  sender: VerifiedSenderSummary | null | undefined,
  fallbackNow = Date.now(),
): SharedNoteItem | null {
  const verified = normalizeSenderSummary(sender);
  if (!verified || typeof payload.body !== 'string') return null;
  return {
    author: verified.name,
    authorId: verified.userId,
    body: payload.body,
    updatedAt: resolveTimestamp(payload.updatedAt, fallbackNow),
  };
}

export function formatClockTime(timestamp: number | undefined, lang: Language): string {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) {
    return '';
  }
  try {
    return new Intl.DateTimeFormat(LOCALE_META[lang].intl, {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(timestamp));
  } catch {
    return '';
  }
}

/**
 * Determine whether a message starts a new visual author group.
 * Continuation bubbles preserve time & accessible author info while reducing repetition.
 */
export function shouldStartChatGroup(
  messages: readonly ChatMessageItem[],
  index: number,
  groupWindowMs = CHAT_MESSAGE_GROUP_WINDOW_MS,
): boolean {
  if (index <= 0) return true;
  const current = messages[index];
  const previous = messages[index - 1];
  if (!current || !previous) return true;
  if (current.mine !== previous.mine) return true;
  if (current.authorId && previous.authorId) {
    if (current.authorId !== previous.authorId) return true;
  } else if (current.author !== previous.author) {
    return true;
  }
  if (
    typeof current.sentAt === 'number' &&
    typeof previous.sentAt === 'number' &&
    Math.abs(current.sentAt - previous.sentAt) > groupWindowMs
  ) {
    return true;
  }
  return false;
}

/**
 * Classify Enter / Shift+Enter keys while protecting active IME compositions
 * (Vietnamese Telex/VNI and Japanese Kana/Kanji conversion).
 */
export function classifyChatComposerKey(input: ComposerKeyEventInput): ComposerKeyAction {
  if (input.key !== 'Enter') return 'ignore';
  if (input.isComposing || input.keyCode === 229 || input.composing) {
    return 'ignore';
  }
  if (input.shiftKey) return 'newline';
  if (input.ctrlKey || input.altKey || input.metaKey) return 'ignore';
  return 'send';
}

export function deriveNoteShareStatus({
  noteShared,
  peersCount,
  resyncing,
  error,
}: {
  noteShared: boolean;
  peersCount: number;
  resyncing?: boolean;
  error?: string;
}): NoteShareStatus {
  if (error) return 'failed';
  if (!noteShared) return 'private';
  if (resyncing) return 'resyncing';
  if (peersCount > 0) return 'active';
  return 'waiting';
}

/**
 * Guard peer-open auto-resync so read-only viewers, inactive sharing, and stale
 * DataChannels from previous rooms never broadcast note content.
 */
export function buildNoteResyncEnvelope({
  noteShared,
  roomReadOnly,
  channelRoomId,
  activeRoomId,
  author,
  body,
  updatedAt,
  now = Date.now(),
}: {
  noteShared: boolean;
  roomReadOnly: boolean;
  channelRoomId: string | null | undefined;
  activeRoomId: string | null | undefined;
  author: string;
  body: string;
  updatedAt?: number;
  now?: number;
}): NoteDataEnvelope | null {
  if (!noteShared || roomReadOnly || !activeRoomId || channelRoomId !== activeRoomId) {
    return null;
  }
  return {
    type: 'note:shared',
    author,
    body,
    updatedAt: resolveTimestamp(updatedAt, now),
  };
}

/**
 * Build a live update envelope when sharing is enabled and peers are open;
 * returns null during temporary disconnect (`openConnections === 0`) so user sharing intent stays on.
 */
export function buildNoteUpdateEnvelope({
  noteShared,
  roomReadOnly,
  openConnections,
  author,
  body,
  updatedAt,
  now = Date.now(),
}: {
  noteShared: boolean;
  roomReadOnly: boolean;
  openConnections: number;
  author: string;
  body: string;
  updatedAt?: number;
  now?: number;
}): NoteDataEnvelope | null {
  if (!noteShared || roomReadOnly || openConnections <= 0) {
    return null;
  }
  return {
    type: 'note:update',
    author,
    body,
    updatedAt: resolveTimestamp(updatedAt, now),
  };
}

export function buildNoteUnshareEnvelope({
  roomReadOnly,
  openConnections,
  author,
}: {
  roomReadOnly: boolean;
  openConnections: number;
  author: string;
}): NoteDataEnvelope | null {
  if (roomReadOnly || openConnections <= 0) {
    return null;
  }
  return {
    type: 'note:unshared',
    author,
  };
}
