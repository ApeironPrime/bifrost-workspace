import type { Server } from "socket.io";
import type { PrismaClient } from "../generated/prisma/client.js";

export const ROOM_ACCESS_REVOKED_EVENT = "room:access-revoked";
export const ROOM_ACCESS_REVOKED_REASON = "workspace_membership_removed";

export interface RevokeMemberSessionsInput {
  workspaceId: string;
  userId: string;
}

export interface RevokeMemberSessionsResult {
  evictedRoomIds: string[];
  evictedSocketIds: string[];
}

export interface RoomPresencePeer {
  peerId: string;
  userId: string;
  name: string;
  email: string;
}

/**
 * Queries Socket.IO presence for a room via the adapter `fetchSockets()` API.
 * With the default in-memory adapter this reflects local process sockets; cross-instance
 * visibility requires a cluster adapter such as Redis.
 */
export async function getRoomPresence(
  ioServer: Server,
  socketRoomKey: string,
  excludeSocketIds?: ReadonlySet<string>,
): Promise<RoomPresencePeer[]> {
  const sockets = await ioServer.in(socketRoomKey).fetchSockets();
  const peers: RoomPresencePeer[] = [];
  for (const socket of sockets) {
    if (excludeSocketIds?.has(socket.id)) continue;
    if (socket.data?.user) {
      peers.push({
        peerId: socket.id,
        userId: socket.data.user.id,
        name: socket.data.user.name,
        email: socket.data.user.email,
      });
    }
  }
  return peers;
}

/**
 * Evicts every active Socket.IO session belonging to `userId` from every room in
 * `workspaceId`, without disconnecting unrelated workspace rooms or Socket.IO connections.
 */
export async function revokeWorkspaceMemberSessions(
  ioServer: Server,
  db: PrismaClient,
  { workspaceId, userId }: RevokeMemberSessionsInput,
): Promise<RevokeMemberSessionsResult> {
  const rooms = await db.room.findMany({
    where: { workspaceId },
    select: { id: true },
  });

  const evictedRoomIds: string[] = [];
  const evictedSocketIds: string[] = [];

  for (const { id: roomId } of rooms) {
    const socketRoomKey = `room:${roomId}`;
    const socketsInRoom = await ioServer.in(socketRoomKey).fetchSockets();
    const revokedSockets = socketsInRoom.filter((socket) => socket.data?.user?.id === userId);
    if (revokedSockets.length === 0) continue;

    const revokedIdSet = new Set(revokedSockets.map((socket) => socket.id));

    // Remove revoked sockets from the room first so signaling relay checks and room broadcasts exclude them.
    await Promise.all(revokedSockets.map((socket) => socket.leave(socketRoomKey)));

    for (const revokedSocket of revokedSockets) {
      revokedSocket.emit(ROOM_ACCESS_REVOKED_EVENT, {
        workspaceId,
        roomId,
        reason: ROOM_ACCESS_REVOKED_REASON,
        message: "Quyền truy cập workspace này đã bị thu hồi.",
      });
      evictedSocketIds.push(revokedSocket.id);
    }

    const remainingPresence = await getRoomPresence(ioServer, socketRoomKey, revokedIdSet);
    for (const revokedSocket of revokedSockets) {
      ioServer.to(socketRoomKey).emit("room:peer-left", { peerId: revokedSocket.id });
    }
    ioServer.to(socketRoomKey).emit("presence:changed", {
      roomId,
      peers: remainingPresence,
    });

    evictedRoomIds.push(roomId);
  }

  return { evictedRoomIds, evictedSocketIds };
}

export async function revokeRoomSessions(
  ioServer: Server,
  {
    workspaceId,
    roomId,
    userId,
    reason = ROOM_ACCESS_REVOKED_REASON,
    message = "Quyền truy cập phòng này đã bị thu hồi.",
  }: {
    workspaceId: string;
    roomId: string;
    userId?: string;
    reason?: string;
    message?: string;
  },
): Promise<string[]> {
  const socketRoomKey = `room:${roomId}`;
  const socketsInRoom = await ioServer.in(socketRoomKey).fetchSockets();
  const targetSockets = userId
    ? socketsInRoom.filter((socket) => socket.data?.user?.id === userId)
    : socketsInRoom;

  if (targetSockets.length === 0) return [];

  const revokedIdSet = new Set(targetSockets.map((socket) => socket.id));
  await Promise.all(targetSockets.map((socket) => socket.leave(socketRoomKey)));

  for (const revokedSocket of targetSockets) {
    revokedSocket.emit(ROOM_ACCESS_REVOKED_EVENT, {
      workspaceId,
      roomId,
      reason,
      message,
    });
  }

  if (userId) {
    const remainingPresence = await getRoomPresence(ioServer, socketRoomKey, revokedIdSet);
    for (const revokedSocket of targetSockets) {
      ioServer.to(socketRoomKey).emit("room:peer-left", { peerId: revokedSocket.id });
    }
    ioServer.to(socketRoomKey).emit("presence:changed", {
      roomId,
      peers: remainingPresence,
    });
  }

  return [...revokedIdSet];
}

export async function getWorkspaceLivePresence(
  ioServer: Server,
  db: PrismaClient,
  workspaceId: string,
): Promise<Map<string, { status: "online" | "offline"; currentRoomId: string | null }>> {
  const rooms = await db.room.findMany({
    where: { workspaceId },
    select: { id: true },
  });
  const presenceMap = new Map<string, { status: "online" | "offline"; currentRoomId: string | null }>();
  for (const { id: roomId } of rooms) {
    const peers = await getRoomPresence(ioServer, `room:${roomId}`);
    for (const peer of peers) {
      presenceMap.set(peer.userId, { status: "online", currentRoomId: roomId });
    }
  }
  return presenceMap;
}
