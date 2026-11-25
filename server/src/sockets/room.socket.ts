import type { Server, Socket } from "socket.io";
import { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client.js";
import { verifyAccessToken } from "../lib/auth.js";
import { getRoomPresence, type RoomPresencePeer } from "../lib/revocation.js";

const roomIdSchema = z.string().uuid("Mã room không hợp lệ.");
const signalSchema = z.object({
  targetId: z.string().min(1),
  payload: z.unknown(),
});

async function leaveRoomInternal(io: Server, socket: Socket, socketRoomKey: string) {
  if (!socket.rooms.has(socketRoomKey)) return;
  const roomId = socketRoomKey.replace("room:", "");
  await socket.leave(socketRoomKey);
  socket.to(socketRoomKey).emit("room:peer-left", { peerId: socket.id });
  const remainingPresence = await getRoomPresence(io, socketRoomKey);
  io.to(socketRoomKey).emit("presence:changed", {
    roomId,
    peers: remainingPresence,
  });
}

function findSharedRoom(socket: Socket, target: Socket): string | undefined {
  return [...socket.rooms].find(
    (roomId) => roomId.startsWith("room:") && target.rooms.has(roomId),
  );
}

/**
 * Registers Socket.IO JWT authentication, room membership/ACL checks, presence
 * broadcasts, and WebRTC signaling relay (`offer`, `answer`, `ice-candidate`).
 */
export function attachRoomSocket(io: Server, db: PrismaClient) {
  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    if (typeof token !== "string" || !token.trim()) {
      next(new Error("Bạn cần đăng nhập trước khi kết nối realtime."));
      return;
    }

    try {
      const payload = verifyAccessToken(token);
      const user = await db.user.findUnique({
        where: { id: payload.id },
        select: { id: true, name: true, email: true },
      });
      if (!user) {
        next(new Error("Người dùng không tồn tại."));
        return;
      }
      socket.data.user = user;
      next();
    } catch {
      next(new Error("Phiên đăng nhập không hợp lệ hoặc đã hết hạn."));
    }
  });

  io.on("connection", (socket) => {
    console.info(`Socket connected: ${socket.id} (user: ${socket.data.user.email})`);
    void socket.join(`user:${socket.data.user.id}`);

    const lastRingByRoom = new Map<string, number>();

    async function notifyWorkspaceMembersOfActiveRoom(
      room: {
        id: string;
        name: string;
        workspaceId: string;
        hostId: string | null;
        workspace: { name: string; ownerId: string };
      },
      caller: { id: string; name: string },
    ) {
      try {
        const roomMembers = await db.roomMember.findMany({
          where: { workspaceId: room.workspaceId, roomId: room.id },
          select: { userId: true },
        });
        const targetUserIds = new Set<string>([room.workspace.ownerId]);
        if (room.hostId) targetUserIds.add(room.hostId);
        for (const entry of roomMembers) {
          targetUserIds.add(entry.userId);
        }
        targetUserIds.delete(caller.id);
        if (targetUserIds.size === 0) return;

        const channels = [...targetUserIds].map((uid) => `user:${uid}`);
        io.to(channels).emit("workspace:room-active", {
          workspaceId: room.workspaceId,
          workspaceName: room.workspace.name,
          roomId: room.id,
          roomName: room.name,
          caller: { id: caller.id, name: caller.name },
        });
      } catch (error) {
        console.error("[socket] notifyWorkspaceMembersOfActiveRoom error:", error);
      }
    }

    // Server only relays WebRTC metadata; realtime media & DataChannel payloads travel P2P.
    socket.on("room:join", async (rawRoomId: unknown) => {
      const parsedRoomId = roomIdSchema.safeParse(rawRoomId);
      if (!parsedRoomId.success) {
        socket.emit("room:error", { message: "Mã room không hợp lệ." });
        return;
      }

      const roomId = parsedRoomId.data;

      try {
        const room = await db.room.findUnique({
          where: { id: roomId },
          include: {
            workspace: {
              include: {
                members: {
                  where: { userId: socket.data.user.id },
                },
              },
            },
            members: {
              where: { userId: socket.data.user.id },
            },
          },
        });

        const socketRoomKey = `room:${roomId}`;

        if (!room) {
          if (socket.rooms.has(socketRoomKey)) {
            await leaveRoomInternal(io, socket, socketRoomKey);
          }
          socket.emit("room:error", { message: "Room không tồn tại." });
          return;
        }

        if (room.workspace.members.length === 0) {
          if (socket.rooms.has(socketRoomKey)) {
            await leaveRoomInternal(io, socket, socketRoomKey);
          }
          socket.emit("room:error", { message: "Bạn không thuộc workspace chứa room này." });
          return;
        }

        const workspaceMembership = room.workspace.members[0];
        const hasRoomAccess =
          workspaceMembership.role === "OWNER" ||
          room.hostId === socket.data.user.id ||
          room.members.length > 0;
        if (!hasRoomAccess) {
          if (socket.rooms.has(socketRoomKey)) {
            await leaveRoomInternal(io, socket, socketRoomKey);
          }
          socket.emit("room:error", { message: "Bạn chưa được phân vào phòng này." });
          return;
        }

        // Joining the same Socket Room is idempotent so reconnects never emit duplicate peer-joined events.
        if (socket.rooms.has(socketRoomKey)) {
          const presence = await getRoomPresence(io, socketRoomKey);
          socket.emit("room:joined", {
            roomId,
            roomName: room.name,
            peerId: socket.id,
            peers: presence.filter((peer) => peer.peerId !== socket.id).map((peer) => peer.peerId),
            presence,
          });
          return;
        }

        const existingRooms = [...socket.rooms].filter((r) => r.startsWith("room:"));
        for (const priorRoomKey of existingRooms) {
          if (priorRoomKey !== socketRoomKey) {
            await leaveRoomInternal(io, socket, priorRoomKey);
          }
        }

        if (!socket.connected) return;
        await socket.join(socketRoomKey);

        // Re-verify membership & room access after joining to close in-flight removal races.
        const stillMember = await db.workspaceMember.findUnique({
          where: {
            workspaceId_userId: {
              workspaceId: room.workspaceId,
              userId: socket.data.user.id,
            },
          },
          select: { userId: true, role: true },
        });
        const stillRoomAccess =
          stillMember &&
          (stillMember.role === "OWNER" ||
            room.hostId === socket.data.user.id ||
            Boolean(
              await db.roomMember.findUnique({
                where: {
                  workspaceId_roomId_userId: {
                    workspaceId: room.workspaceId,
                    roomId,
                    userId: socket.data.user.id,
                  },
                },
                select: { userId: true },
              }),
            ));
        if (!stillRoomAccess || !socket.connected) {
          await socket.leave(socketRoomKey);
          if (socket.connected) {
            socket.emit("room:error", { message: "Bạn không thuộc workspace chứa room này." });
          }
          return;
        }

        const presence = await getRoomPresence(io, socketRoomKey);
        const peers = presence.filter((p) => p.peerId !== socket.id).map((p) => p.peerId);

        socket.emit("room:joined", {
          roomId,
          roomName: room.name,
          peerId: socket.id,
          peers,
          presence,
        });
        socket.emit("room:peers", { roomId, peers });

        io.to(socketRoomKey).emit("presence:changed", {
          roomId,
          peers: presence,
        });

        socket.to(socketRoomKey).emit("room:peer-joined", {
          peerId: socket.id,
          user: socket.data.user,
        });

        if (peers.length === 0) {
          lastRingByRoom.set(roomId, Date.now());
          void notifyWorkspaceMembersOfActiveRoom(room, socket.data.user);
        }
      } catch (error) {
        console.error("Lỗi khi tham gia room:", error);
        socket.emit("room:error", { message: "Đã xảy ra lỗi khi tham gia room." });
      }
    });

    socket.on("room:ring", async (rawRoomId: unknown) => {
      const parsedRoomId = roomIdSchema.safeParse(rawRoomId);
      if (!parsedRoomId.success) return;
      const roomId = parsedRoomId.data;
      if (!socket.rooms.has(`room:${roomId}`)) return;
      const now = Date.now();
      const last = lastRingByRoom.get(roomId) ?? 0;
      if (now - last < 30_000) return;
      lastRingByRoom.set(roomId, now);

      const room = await db.room.findUnique({
        where: { id: roomId },
        include: { workspace: { select: { name: true, ownerId: true } } },
      });
      if (room) {
        await notifyWorkspaceMembersOfActiveRoom(room, socket.data.user);
      }
    });

    socket.on("room:leave", async (rawRoomId: unknown) => {
      const parsedRoomId = roomIdSchema.safeParse(rawRoomId);
      if (parsedRoomId.success) {
        await leaveRoomInternal(io, socket, `room:${parsedRoomId.data}`);
      }
    });

    const relaySignal = (
      eventName: "webrtc:offer" | "webrtc:answer" | "webrtc:ice-candidate",
    ) => {
      socket.on(eventName, async (rawSignal: unknown) => {
        const parsedSignal = signalSchema.safeParse(rawSignal);
        if (!parsedSignal.success) {
          socket.emit("room:error", { message: "Dữ liệu signalling không hợp lệ." });
          return;
        }

        const [target] = await io.in(parsedSignal.data.targetId).fetchSockets();
        if (!target) {
          socket.emit("room:error", { message: "Peer không còn trong room." });
          return;
        }

        const sharedRoom = [...socket.rooms].find(
          (roomId) => roomId.startsWith("room:") && target.rooms.has(roomId),
        );
        if (!sharedRoom) {
          socket.emit("room:error", { message: "Không thể relay signalling đến peer khác room." });
          return;
        }

        io.to(parsedSignal.data.targetId).emit(eventName, {
          peerId: socket.id,
          payload: parsedSignal.data.payload,
        });
      });
    };

    relaySignal("webrtc:offer");
    relaySignal("webrtc:answer");
    relaySignal("webrtc:ice-candidate");

    socket.on("disconnecting", async () => {
      const roomKeys = [...socket.rooms].filter((roomId) => roomId.startsWith("room:"));
      for (const socketRoomKey of roomKeys) {
        const roomId = socketRoomKey.replace("room:", "");
        socket.to(socketRoomKey).emit("room:peer-left", { peerId: socket.id });

        try {
          const roomSockets = await io.in(socketRoomKey).fetchSockets();
          const remainingPeers: RoomPresencePeer[] = [];
          for (const s of roomSockets) {
            if (s.id !== socket.id && s.data?.user) {
              remainingPeers.push({
                peerId: s.id,
                userId: s.data.user.id,
                name: s.data.user.name,
                email: s.data.user.email,
              });
            }
          }

          socket.to(socketRoomKey).emit("presence:changed", {
            roomId,
            peers: remainingPeers,
          });
        } catch (error) {
          console.error("[socket] disconnecting presence update error:", error);
        }
      }
    });
  });
}
