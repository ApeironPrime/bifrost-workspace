import { LOCALE_META, type Language } from '../i18n/locale.ts';

export const MAX_CHAT_MESSAGE_LENGTH = 4000;
export const CHAT_MESSAGE_GROUP_WINDOW_MS = 2 * 60 * 1000;
export const CHAT_REACTION_EMOJIS = ['👍', '❤️', '🔥', '✅', '👀'] as const;

export interface ChatReplySummary {
  id: string;
  author: string;
  bodyPreview: string;
}

export interface ChatMessageItem {
  id: string;
  author: string;
  authorId?: string;
  body: string;
  mine: boolean;
  sentAt?: number;
  hlc?: string;
  replyTo?: ChatReplySummary;
  reactions?: Record<string, string[]>;
  pinned?: boolean;
  pinnedBy?: string;
}

export interface SharedNoteItem {
  author: string;
  authorId?: string;
  body: string;
  updatedAt?: number;
  hlc?: string;
}

export interface VerifiedSenderSummary {
  userId: string;
  name: string;
}

export type ChatDataEnvelope = {
  type: 'chat';
  id?: string;
  author: string;
  body: string;
  sentAt?: number;
  hlc?: string;
  replyTo?: ChatReplySummary;
};

export type ChatActionDataEnvelope =
  | {
      type: 'chat:reaction';
      messageId: string;
      emoji: string;
      active: boolean;
      hlc: string;
    }
  | {
      type: 'chat:pin';
      messageId: string;
      pinned: boolean;
      hlc: string;
    };

export type ChatSyncDataEnvelope = {
  type: 'chat:sync-state';
  messages: ChatMessageItem[];
  hlc: string;
};

export type NoteDataEnvelope =
  | { type: 'note:shared' | 'note:update'; author: string; body: string; updatedAt?: number; hlc?: string }
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

function normalizeReplySummary(raw: unknown): ChatReplySummary | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const author = typeof record.author === 'string' ? record.author.trim() : '';
  const bodyPreview = typeof record.bodyPreview === 'string' ? record.bodyPreview.trim() : '';
  if (!id || !author) return undefined;
  return { id, author, bodyPreview: bodyPreview.slice(0, 140) };
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
  extra?: {
    id?: string;
    hlc?: string;
    replyTo?: ChatReplySummary;
  },
): {
  envelope: ChatDataEnvelope;
  localMessage: Omit<ChatMessageItem, 'id'> & { id?: string };
} | null {
  const body = rawBody.trim();
  if (!body) return null;
  const clampedBody = body.slice(0, MAX_CHAT_MESSAGE_LENGTH);
  const sentAt = resolveTimestamp(now);
  const trimmedLocalId = typeof localAuthorId === 'string' ? localAuthorId.trim() : '';
  const trimmedMsgId = typeof extra?.id === 'string' ? extra.id.trim() : '';
  const trimmedHlc = typeof extra?.hlc === 'string' ? extra.hlc.trim() : '';
  const replyTo = normalizeReplySummary(extra?.replyTo);

  return {
    envelope: {
      type: 'chat',
      ...(trimmedMsgId ? { id: trimmedMsgId } : {}),
      author: wireAuthor,
      body: clampedBody,
      sentAt,
      ...(trimmedHlc ? { hlc: trimmedHlc } : {}),
      ...(replyTo ? { replyTo } : {}),
    },
    localMessage: {
      ...(trimmedMsgId ? { id: trimmedMsgId } : {}),
      author: localAuthor,
      ...(trimmedLocalId ? { authorId: trimmedLocalId } : {}),
      body: clampedBody,
      mine: true,
      sentAt,
      ...(trimmedHlc ? { hlc: trimmedHlc } : {}),
      ...(replyTo ? { replyTo } : {}),
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
  payload: { id?: unknown; body?: unknown; sentAt?: unknown; hlc?: unknown; replyTo?: unknown },
  sender: VerifiedSenderSummary | null | undefined,
  fallbackNow = Date.now(),
): (Omit<ChatMessageItem, 'id'> & { id?: string }) | null {
  const verified = normalizeSenderSummary(sender);
  if (!verified || typeof payload.body !== 'string') return null;
  const id = typeof payload.id === 'string' && payload.id.trim() ? payload.id.trim() : undefined;
  const hlc = typeof payload.hlc === 'string' && payload.hlc.trim() ? payload.hlc.trim() : undefined;
  const replyTo = normalizeReplySummary(payload.replyTo);

  return {
    ...(id ? { id } : {}),
    author: verified.name,
    authorId: verified.userId,
    body: payload.body,
    mine: false,
    sentAt: resolveTimestamp(payload.sentAt, fallbackNow),
    ...(hlc ? { hlc } : {}),
    ...(replyTo ? { replyTo } : {}),
  };
}

/**
 * Normalize an incoming shared-note envelope safely using the server-verified sender identity.
 * Never reads `payload.author`; fails closed (`null`) if verified sender identity is missing.
 */
export function normalizeIncomingSharedNote(
  payload: { body?: unknown; updatedAt?: unknown; hlc?: unknown },
  sender: VerifiedSenderSummary | null | undefined,
  fallbackNow = Date.now(),
): SharedNoteItem | null {
  const verified = normalizeSenderSummary(sender);
  if (!verified || typeof payload.body !== 'string') return null;
  const hlc = typeof payload.hlc === 'string' && payload.hlc.trim() ? payload.hlc.trim() : undefined;
  return {
    author: verified.name,
    authorId: verified.userId,
    body: payload.body,
    updatedAt: resolveTimestamp(payload.updatedAt, fallbackNow),
    ...(hlc ? { hlc } : {}),
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

export function applyChatReaction(
  messages: readonly ChatMessageItem[],
  messageId: string,
  emoji: string,
  userId: string,
  active: boolean,
): ChatMessageItem[] {
  const cleanId = messageId.trim();
  const cleanUser = userId.trim();
  const cleanEmoji = emoji.trim();
  if (!cleanId || !cleanUser || !cleanEmoji) return [...messages];

  return messages.map((msg) => {
    if (msg.id !== cleanId) return msg;
    const prevMap = msg.reactions ?? {};
    const prevUsers = Array.isArray(prevMap[cleanEmoji]) ? prevMap[cleanEmoji] : [];
    const nextUsers = active
      ? Array.from(new Set([...prevUsers, cleanUser]))
      : prevUsers.filter((id) => id !== cleanUser);
    const nextReactions: Record<string, string[]> = { ...prevMap };
    if (nextUsers.length > 0) {
      nextReactions[cleanEmoji] = nextUsers;
    } else {
      delete nextReactions[cleanEmoji];
    }
    return {
      ...msg,
      reactions: Object.keys(nextReactions).length > 0 ? nextReactions : undefined,
    };
  });
}

export function applyChatPin(
  messages: readonly ChatMessageItem[],
  messageId: string,
  pinned: boolean,
  actorName: string,
): ChatMessageItem[] {
  const cleanId = messageId.trim();
  if (!cleanId) return [...messages];
  return messages.map((msg) => {
    if (msg.id !== cleanId) return msg;
    return {
      ...msg,
      pinned,
      pinnedBy: pinned ? actorName : undefined,
    };
  });
}

function normalizeReactionsRecord(raw: unknown): Record<string, string[]> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, string[]> = {};
  for (const [emoji, users] of Object.entries(raw as Record<string, unknown>)) {
    if (!emoji || !Array.isArray(users)) continue;
    const clean = Array.from(
      new Set(users.filter((u): u is string => typeof u === 'string' && u.trim().length > 0).map((u) => u.trim())),
    );
    if (clean.length > 0) out[emoji] = clean;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function mergeReactions(
  a?: Record<string, string[]>,
  b?: Record<string, string[]>,
): Record<string, string[]> | undefined {
  if (!a && !b) return undefined;
  const merged: Record<string, string[]> = {};
  for (const source of [a, b]) {
    if (!source) continue;
    for (const [emoji, users] of Object.entries(source)) {
      const existing = merged[emoji] ?? [];
      merged[emoji] = Array.from(new Set([...existing, ...users]));
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function normalizeStoredChatItem(
  raw: unknown,
  currentUserId: string,
  youLabel: string,
): ChatMessageItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const id = typeof rec.id === 'string' ? rec.id.trim() : '';
  const body = typeof rec.body === 'string' ? rec.body : '';
  const authorRaw = typeof rec.author === 'string' ? rec.author.trim() : '';
  if (!id || !body || !authorRaw) return null;
  const authorId = typeof rec.authorId === 'string' && rec.authorId.trim() ? rec.authorId.trim() : undefined;
  const mine = authorId ? authorId === currentUserId : Boolean(rec.mine);
  const sentAt = typeof rec.sentAt === 'number' && Number.isFinite(rec.sentAt) && rec.sentAt > 0 ? rec.sentAt : undefined;
  const hlc = typeof rec.hlc === 'string' && rec.hlc.trim() ? rec.hlc.trim() : undefined;
  const replyTo = normalizeReplySummary(rec.replyTo);
  const reactions = normalizeReactionsRecord(rec.reactions);
  const pinned = typeof rec.pinned === 'boolean' ? rec.pinned : undefined;
  const pinnedBy = typeof rec.pinnedBy === 'string' && rec.pinnedBy.trim() ? rec.pinnedBy.trim() : undefined;

  return {
    id,
    author: mine ? youLabel : authorRaw,
    ...(authorId ? { authorId } : {}),
    body: body.slice(0, MAX_CHAT_MESSAGE_LENGTH),
    mine,
    ...(sentAt !== undefined ? { sentAt } : {}),
    ...(hlc ? { hlc } : {}),
    ...(replyTo ? { replyTo } : {}),
    ...(reactions ? { reactions } : {}),
    ...(pinned !== undefined ? { pinned } : {}),
    ...(pinnedBy ? { pinnedBy } : {}),
  };
}

/**
 * Merges local chat history with incoming peer/cloud snapshots by message `id`,
 * unioning emoji reactions, preserving reply/pin metadata, sorting chronologically,
 * and capping history to `maxItems`.
 */
export function reconcileChatMessages(
  local: readonly ChatMessageItem[],
  incoming: readonly unknown[],
  currentUserId: string,
  youLabel: string,
  maxItems = 200,
): ChatMessageItem[] {
  const byId = new Map<string, ChatMessageItem>();

  for (const item of local) {
    const normalized = normalizeStoredChatItem(item, currentUserId, youLabel);
    if (normalized) byId.set(normalized.id, normalized);
  }

  for (const raw of incoming) {
    const inc = normalizeStoredChatItem(raw, currentUserId, youLabel);
    if (!inc) continue;
    const existing = byId.get(inc.id);
    if (!existing) {
      byId.set(inc.id, inc);
      continue;
    }
    const reactions = mergeReactions(existing.reactions, inc.reactions);
    const pinned = inc.pinned !== undefined ? inc.pinned : existing.pinned;
    const pinnedBy = pinned ? (inc.pinnedBy ?? existing.pinnedBy) : undefined;
    byId.set(inc.id, {
      ...existing,
      ...inc,
      author: existing.mine || inc.mine ? youLabel : (inc.author !== youLabel ? inc.author : existing.author),
      ...(reactions ? { reactions } : {}),
      ...(pinned !== undefined ? { pinned } : {}),
      ...(pinnedBy ? { pinnedBy } : {}),
    });
  }

  const sorted = Array.from(byId.values()).sort((a, b) => {
    const timeDiff = (a.sentAt ?? 0) - (b.sentAt ?? 0);
    if (timeDiff !== 0) return timeDiff;
    const hlcA = a.hlc ?? '';
    const hlcB = b.hlc ?? '';
    if (hlcA !== hlcB) return hlcA < hlcB ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  if (sorted.length <= maxItems) return sorted;
  return sorted.slice(sorted.length - maxItems);
}

/**
 * Splits chat message text into plain segments and `@mention` highlights.
 * Matches known room participant names (including multi-word names) first, then `@word` tokens.
 */
export function tokenizeChatMentions(
  body: string,
  knownNames: readonly string[],
): Array<{ kind: 'text' | 'mention'; value: string }> {
  if (!body) return [{ kind: 'text', value: '' }];
  const sortedNames = Array.from(
    new Set(knownNames.map((n) => n.trim()).filter(Boolean)),
  ).sort((a, b) => b.length - a.length);

  const tokens: Array<{ kind: 'text' | 'mention'; value: string }> = [];
  let cursor = 0;

  while (cursor < body.length) {
    const atIndex = body.indexOf('@', cursor);
    if (atIndex === -1) {
      tokens.push({ kind: 'text', value: body.slice(cursor) });
      break;
    }

    const prevChar = atIndex > 0 ? body[atIndex - 1] : ' ';
    if (!/[\s(["']/.test(prevChar)) {
      tokens.push({ kind: 'text', value: body.slice(cursor, atIndex + 1) });
      cursor = atIndex + 1;
      continue;
    }

    if (atIndex > cursor) {
      tokens.push({ kind: 'text', value: body.slice(cursor, atIndex) });
    }

    const afterAt = body.slice(atIndex + 1);
    let matchedName = '';
    for (const name of sortedNames) {
      if (afterAt.toLowerCase().startsWith(name.toLowerCase())) {
        const nextChar = afterAt[name.length];
        if (!nextChar || /[\s.,!?:;)\]"']/.test(nextChar)) {
          matchedName = afterAt.slice(0, name.length);
          break;
        }
      }
    }

    if (matchedName) {
      tokens.push({ kind: 'mention', value: `@${matchedName}` });
      cursor = atIndex + 1 + matchedName.length;
    } else {
      const wordMatch = afterAt.match(/^[A-Za-zÀ-ỹ0-9_.-]{1,32}/);
      if (wordMatch) {
        tokens.push({ kind: 'mention', value: `@${wordMatch[0]}` });
        cursor = atIndex + 1 + wordMatch[0].length;
      } else {
        tokens.push({ kind: 'text', value: '@' });
        cursor = atIndex + 1;
      }
    }
  }

  return tokens;
}

type CacheStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function roomChatCacheKey(userId: string, workspaceId: string, roomId: string): string {
  return `bifrost-room-chat:${encodeURIComponent(userId)}:${encodeURIComponent(workspaceId)}:${encodeURIComponent(roomId)}`;
}

export function readRoomChatCache(
  store: CacheStore | null | undefined,
  key: string,
  currentUserId: string,
  youLabel: string,
): ChatMessageItem[] {
  if (!store || !key) return [];
  try {
    const parsed = JSON.parse(store.getItem(key) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return reconcileChatMessages([], parsed, currentUserId, youLabel);
  } catch {
    return [];
  }
}

export function writeRoomChatCache(
  store: CacheStore | null | undefined,
  key: string,
  messages: readonly ChatMessageItem[],
): void {
  if (!store || !key) return;
  try {
    store.setItem(key, JSON.stringify(messages.slice(-200)));
  } catch {
    /* Best-effort browser cache; ignore quota errors. */
  }
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
  hlc,
  now = Date.now(),
}: {
  noteShared: boolean;
  roomReadOnly: boolean;
  channelRoomId: string | null | undefined;
  activeRoomId: string | null | undefined;
  author: string;
  body: string;
  updatedAt?: number;
  hlc?: string;
  now?: number;
}): NoteDataEnvelope | null {
  if (!noteShared || roomReadOnly || !activeRoomId || channelRoomId !== activeRoomId) {
    return null;
  }
  const trimmedHlc = typeof hlc === 'string' && hlc.trim() ? hlc.trim() : undefined;
  return {
    type: 'note:shared',
    author,
    body,
    updatedAt: resolveTimestamp(updatedAt, now),
    ...(trimmedHlc ? { hlc: trimmedHlc } : {}),
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
  hlc,
  now = Date.now(),
}: {
  noteShared: boolean;
  roomReadOnly: boolean;
  openConnections: number;
  author: string;
  body: string;
  updatedAt?: number;
  hlc?: string;
  now?: number;
}): NoteDataEnvelope | null {
  if (!noteShared || roomReadOnly || openConnections <= 0) {
    return null;
  }
  const trimmedHlc = typeof hlc === 'string' && hlc.trim() ? hlc.trim() : undefined;
  return {
    type: 'note:update',
    author,
    body,
    updatedAt: resolveTimestamp(updatedAt, now),
    ...(trimmedHlc ? { hlc: trimmedHlc } : {}),
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
