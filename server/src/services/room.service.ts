import { z } from "zod";
import * as Y from "yjs";
import type { PrismaClient } from "../generated/prisma/client.js";
import { Prisma } from "../generated/prisma/client.js";
import { WorkspaceRole } from "../generated/prisma/enums.js";

export class RoomServiceError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const collabBackupSchema = z.object({
  messages: z.array(z.record(z.string(), z.unknown())).max(200).optional(),
  board: z
    .object({
      items: z.array(z.record(z.string(), z.unknown())).max(300).optional(),
      tombstones: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
    })
    .optional(),
  crdtDocBase64: z.string().max(500_000).optional(),
  hlc: z.string().max(160).optional(),
});

const CRDT_STATE_KEY = "__crdtDocBase64";

function mergeYjsBase64(existingB64: unknown, incomingB64: string): string {
  let incomingBytes: Uint8Array;
  try {
    incomingBytes = Uint8Array.from(Buffer.from(incomingB64, "base64"));
    if (incomingBytes.length === 0) {
      throw new Error("Empty CRDT update");
    }
    const probe = new Y.Doc();
    Y.applyUpdate(probe, incomingBytes);
    probe.destroy();
  } catch {
    throw new RoomServiceError(400, "Dữ liệu tài liệu CRDT không hợp lệ.");
  }

  if (typeof existingB64 === "string" && existingB64.trim().length > 0) {
    try {
      const existingBytes = Uint8Array.from(Buffer.from(existingB64, "base64"));
      if (existingBytes.length > 0) {
        const merged = Y.mergeUpdates([existingBytes, incomingBytes]);
        return Buffer.from(merged).toString("base64");
      }
    } catch {
      // If stored state was corrupt, replace with validated incoming bytes.
    }
  }

  return Buffer.from(incomingBytes).toString("base64");
}

const userNoteSchema = z.object({
  body: z.string().max(50000),
  isShared: z.boolean(),
  updatedAt: z.number().finite().nonnegative().optional(),
  hlc: z.string().max(160).optional(),
});

async function resolveRoomAndAccess(db: PrismaClient, roomId: string, userId: string) {
  const room = await db.room.findUnique({
    where: { id: roomId },
    include: {
      host: { select: { id: true, name: true, email: true } },
      workspace: { select: { id: true, name: true, slug: true } },
    },
  });

  if (!room) {
    throw new RoomServiceError(404, "Không tìm thấy room.");
  }

  const membership = await db.workspaceMember.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId: room.workspaceId,
        userId,
      },
    },
  });

  if (!membership) {
    throw new RoomServiceError(403, "Bạn không thuộc workspace chứa room này.");
  }

  const roomAssignment = await db.roomMember.findUnique({
    where: {
      workspaceId_roomId_userId: {
        workspaceId: room.workspaceId,
        roomId: room.id,
        userId,
      },
    },
  });

  const access =
    membership.role === WorkspaceRole.OWNER
      ? "OWNER"
      : (roomAssignment?.role ?? (room.hostId === userId ? "HOST" : null));

  return { room, access };
}

export async function getRoomDetailsForUser(
  db: PrismaClient,
  roomId: string,
  userId: string,
) {
  const { room, access } = await resolveRoomAndAccess(db, roomId, userId);

  return {
    room: {
      ...room,
      access,
      createdById: (room as { createdById?: string | null }).createdById ?? room.hostId,
    },
  };
}

function mergeServerChatMessages(existingRaw: unknown, incomingRaw: unknown): unknown[] {
  const existing = Array.isArray(existingRaw) ? existingRaw : [];
  const incoming = Array.isArray(incomingRaw) ? incomingRaw : [];
  const byId = new Map<string, Record<string, unknown>>();

  for (const list of [existing, incoming]) {
    for (const raw of list) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const rec = raw as Record<string, unknown>;
      const id = typeof rec.id === "string" ? rec.id.trim() : "";
      if (!id) continue;
      const prev = byId.get(id);
      if (!prev) {
        byId.set(id, rec);
        continue;
      }

      const prevReactions =
        prev.reactions && typeof prev.reactions === "object" && !Array.isArray(prev.reactions)
          ? (prev.reactions as Record<string, unknown>)
          : {};
      const nextReactions =
        rec.reactions && typeof rec.reactions === "object" && !Array.isArray(rec.reactions)
          ? (rec.reactions as Record<string, unknown>)
          : {};
      const mergedReactions: Record<string, string[]> = {};
      for (const src of [prevReactions, nextReactions]) {
        for (const [emoji, users] of Object.entries(src)) {
          if (!Array.isArray(users)) continue;
          const clean = users.filter((u): u is string => typeof u === "string" && u.trim().length > 0);
          if (clean.length > 0) {
            mergedReactions[emoji] = Array.from(new Set([...(mergedReactions[emoji] ?? []), ...clean]));
          }
        }
      }

      byId.set(id, {
        ...prev,
        ...rec,
        ...(Object.keys(mergedReactions).length > 0 ? { reactions: mergedReactions } : {}),
      });
    }
  }

  return Array.from(byId.values())
    .sort((a, b) => {
      const sa = typeof a.sentAt === "number" ? a.sentAt : 0;
      const sb = typeof b.sentAt === "number" ? b.sentAt : 0;
      return sa - sb;
    })
    .slice(-200);
}

function mergeServerBoard(existingRaw: unknown, incomingRaw: { items?: unknown[]; tombstones?: Record<string, Record<string, unknown>> }) {
  const existing =
    existingRaw && typeof existingRaw === "object" && !Array.isArray(existingRaw)
      ? (existingRaw as { items?: unknown[]; tombstones?: Record<string, Record<string, unknown>> })
      : {};
  const tombstones: Record<string, Record<string, unknown>> = {
    ...(existing.tombstones ?? {}),
  };
  for (const [id, tomb] of Object.entries(incomingRaw.tombstones ?? {})) {
    const prev = tombstones[id];
    const prevRev = typeof prev?.revision === "number" ? prev.revision : 0;
    const nextRev = typeof tomb?.revision === "number" ? tomb.revision : 0;
    if (!prev || nextRev >= prevRev) {
      tombstones[id] = tomb;
    }
  }

  const byId = new Map<string, Record<string, unknown>>();
  for (const raw of [...(existing.items ?? []), ...(incomingRaw.items ?? [])]) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (!id) continue;
    const itemRev = typeof item.revision === "number" ? item.revision : 0;
    const tomb = tombstones[id];
    const tombRev = typeof tomb?.revision === "number" ? tomb.revision : 0;
    if (tomb && tombRev >= itemRev) continue;

    const prev = byId.get(id);
    if (!prev) {
      byId.set(id, item);
      continue;
    }
    const prevRev = typeof prev.revision === "number" ? prev.revision : 0;
    const prevUp = typeof prev.updatedAt === "string" ? prev.updatedAt : "";
    const nextUp = typeof item.updatedAt === "string" ? item.updatedAt : "";
    if (itemRev > prevRev || (itemRev === prevRev && nextUp >= prevUp)) {
      byId.set(id, item);
    }
  }

  return {
    items: Array.from(byId.values()),
    tombstones,
  };
}

export async function getRoomCollabForUser(
  db: PrismaClient,
  roomId: string,
  userId: string,
) {
  const { access } = await resolveRoomAndAccess(db, roomId, userId);
  if (access === null) {
    throw new RoomServiceError(403, "Bạn chưa được phân quyền tham gia room này.");
  }

  const [collab, myNote] = await Promise.all([
    db.roomCollabState.findUnique({ where: { roomId } }),
    db.userRoomNote.findUnique({
      where: { roomId_userId: { roomId, userId } },
    }),
  ]);

  const boardObj =
    collab?.boardJson && typeof collab.boardJson === "object" && !Array.isArray(collab.boardJson)
      ? (collab.boardJson as { items?: unknown[]; tombstones?: Record<string, unknown> })
      : { items: [], tombstones: {} };

  const rawSharedNotes =
    collab?.sharedNotesJson && typeof collab.sharedNotesJson === "object" && !Array.isArray(collab.sharedNotesJson)
      ? ({ ...(collab.sharedNotesJson as Record<string, unknown>) })
      : {};
  const crdtDocBase64 =
    typeof rawSharedNotes[CRDT_STATE_KEY] === "string"
      ? (rawSharedNotes[CRDT_STATE_KEY] as string)
      : null;
  delete rawSharedNotes[CRDT_STATE_KEY];

  return {
    messages: Array.isArray(collab?.messagesJson) ? collab.messagesJson : [],
    board: {
      items: Array.isArray(boardObj.items) ? boardObj.items : [],
      tombstones:
        boardObj.tombstones && typeof boardObj.tombstones === "object" && !Array.isArray(boardObj.tombstones)
          ? boardObj.tombstones
          : {},
    },
    sharedNotes: rawSharedNotes,
    crdtDocBase64,
    myNote: myNote
      ? {
          body: myNote.body,
          isShared: myNote.isShared,
          updatedAt: myNote.updatedAtMs ?? undefined,
          hlc: myNote.hlc ?? undefined,
        }
      : null,
  };
}

export async function saveRoomCollabForUser(
  db: PrismaClient,
  roomId: string,
  userId: string,
  rawBody: unknown,
) {
  const { access } = await resolveRoomAndAccess(db, roomId, userId);
  if (access === null || access === "VIEWER") {
    throw new RoomServiceError(403, "Bạn không có quyền ghi dữ liệu cộng tác trong room này.");
  }

  const parsed = collabBackupSchema.parse(rawBody);
  const existing = await db.roomCollabState.findUnique({ where: { roomId } });

  const nextMessages =
    parsed.messages !== undefined
      ? mergeServerChatMessages(existing?.messagesJson, parsed.messages)
      : (Array.isArray(existing?.messagesJson) ? existing.messagesJson : []);

  const nextBoard =
    parsed.board !== undefined
      ? mergeServerBoard(existing?.boardJson, parsed.board)
      : (existing?.boardJson ?? { items: [], tombstones: {} });

  const nextHlc = parsed.hlc ?? existing?.hlc ?? null;
  const existingShared =
    existing?.sharedNotesJson &&
    typeof existing.sharedNotesJson === "object" &&
    !Array.isArray(existing.sharedNotesJson)
      ? ({ ...(existing.sharedNotesJson as Record<string, unknown>) })
      : {};

  if (parsed.crdtDocBase64 !== undefined) {
    existingShared[CRDT_STATE_KEY] = mergeYjsBase64(
      existingShared[CRDT_STATE_KEY],
      parsed.crdtDocBase64,
    );
  }

  await db.roomCollabState.upsert({
    where: { roomId },
    create: {
      roomId,
      messagesJson: nextMessages as Prisma.InputJsonValue,
      boardJson: nextBoard as Prisma.InputJsonValue,
      sharedNotesJson: existingShared as Prisma.InputJsonValue,
      hlc: nextHlc,
    },
    update: {
      messagesJson: nextMessages as Prisma.InputJsonValue,
      boardJson: nextBoard as Prisma.InputJsonValue,
      sharedNotesJson: existingShared as Prisma.InputJsonValue,
      hlc: nextHlc,
    },
  });

  return { ok: true };
}

export async function saveUserRoomNote(
  db: PrismaClient,
  roomId: string,
  userId: string,
  rawBody: unknown,
) {
  const { access } = await resolveRoomAndAccess(db, roomId, userId);
  if (access === null || access === "VIEWER") {
    throw new RoomServiceError(403, "Bạn không có quyền lưu ghi chú trong room này.");
  }

  const parsed = userNoteSchema.parse(rawBody);
  const userRecord = await db.user.findUnique({
    where: { id: userId },
    select: { name: true },
  });
  const authorName = userRecord?.name ?? "Member";

  await db.userRoomNote.upsert({
    where: { roomId_userId: { roomId, userId } },
    create: {
      roomId,
      userId,
      body: parsed.body,
      isShared: parsed.isShared,
      updatedAtMs: parsed.updatedAt ?? null,
      hlc: parsed.hlc ?? null,
    },
    update: {
      body: parsed.body,
      isShared: parsed.isShared,
      updatedAtMs: parsed.updatedAt ?? null,
      hlc: parsed.hlc ?? null,
    },
  });

  const existingCollab = await db.roomCollabState.findUnique({ where: { roomId } });
  const sharedMap: Record<string, unknown> =
    existingCollab?.sharedNotesJson &&
    typeof existingCollab.sharedNotesJson === "object" &&
    !Array.isArray(existingCollab.sharedNotesJson)
      ? { ...(existingCollab.sharedNotesJson as Record<string, unknown>) }
      : {};

  if (parsed.isShared) {
    sharedMap[userId] = {
      author: authorName,
      authorId: userId,
      body: parsed.body,
      updatedAt: parsed.updatedAt ?? Date.now(),
      ...(parsed.hlc ? { hlc: parsed.hlc } : {}),
    };
  } else {
    delete sharedMap[userId];
  }

  await db.roomCollabState.upsert({
    where: { roomId },
    create: {
      roomId,
      messagesJson: (existingCollab?.messagesJson ?? []) as Prisma.InputJsonValue,
      boardJson: (existingCollab?.boardJson ?? { items: [], tombstones: {} }) as Prisma.InputJsonValue,
      sharedNotesJson: sharedMap as Prisma.InputJsonValue,
      hlc: parsed.hlc ?? existingCollab?.hlc ?? null,
    },
    update: {
      sharedNotesJson: sharedMap as Prisma.InputJsonValue,
    },
  });

  return { ok: true };
}
