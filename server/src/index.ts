import "dotenv/config";
import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { ZodError, z } from "zod";
import { verifyAccessToken } from "./lib/auth.js";
import { prisma } from "./lib/prisma.js";
import {
  RATE_LIMIT_EXPOSED_HEADERS,
  getAuthRateLimiters,
  parseTrustProxySetting,
} from "./lib/rateLimit.js";
import {
  getRoomPresence,
  getWorkspaceLivePresence,
  revokeRoomSessions,
  revokeWorkspaceMemberSessions,
} from "./lib/revocation.js";
import { createTurnServiceFromEnv } from "./lib/turn.js";
import { authRouter } from "./routes/auth.js";
import { roomRouter } from "./routes/rooms.js";
import { createTurnRouter } from "./routes/turn.js";
import { createWorkspaceRouter } from "./routes/workspaces.js";

const app = express();
app.set("trust proxy", parseTrustProxySetting(process.env.TRUST_PROXY));
const authRateLimiters = getAuthRateLimiters();
const turnService = createTurnServiceFromEnv();
const httpServer = createServer(app);
const clientUrl = process.env.CLIENT_URL ?? "http://localhost:5173";
const port = Number(process.env.PORT ?? 3000);

function resolveCorsOrigins(rawClientUrl: string): string | string[] {
  try {
    const parsed = new URL(rawClientUrl);
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
      const siblingHost = parsed.hostname === "localhost" ? "127.0.0.1" : "localhost";
      const portPart = parsed.port ? `:${parsed.port}` : "";
      return [
        `${parsed.protocol}//${parsed.hostname}${portPart}`,
        `${parsed.protocol}//${siblingHost}${portPart}`,
      ];
    }
  } catch {
    // Keep raw string when CLIENT_URL is not a single URL.
  }
  return rawClientUrl;
}

const allowedOrigins = resolveCorsOrigins(clientUrl);

declare module "socket.io" {
  interface SocketData {
    user: {
      id: string;
      name: string;
      email: string;
    };
  }
}

type PresencePeer = {
  peerId: string;
  userId: string;
  name: string;
  email: string;
};

const io = new Server(httpServer, {
  cors: { origin: allowedOrigins },
});

app.use(
  cors({
    origin: allowedOrigins,
    exposedHeaders: [...RATE_LIMIT_EXPOSED_HEADERS],
  }),
);
app.post("/api/auth/login", authRateLimiters.loginIpLimiter);
app.post("/api/auth/register", authRateLimiters.registerIpLimiter);
app.use(express.json());

app.get("/api/health", (_request, response) => {
  response.json({
    status: "ok",
    service: "bifrost-signaling-server",
    realtime: "webrtc-p2p-signaling",
  });
});

app.use("/api/auth", authRouter);
app.use(
  "/api/workspaces",
  createWorkspaceRouter(prisma, {
    onMemberRemoved: (event) => revokeWorkspaceMemberSessions(io, prisma, event),
    onRoomDeleted: (event) =>
      revokeRoomSessions(io, {
        workspaceId: event.workspaceId,
        roomId: event.roomId,
        message: "Phòng này đã bị xóa bởi Workspace Owner.",
      }),
    onRoomAccessRevoked: (event) => revokeRoomSessions(io, event),
    getWorkspacePresence: (workspaceId) => getWorkspaceLivePresence(io, prisma, workspaceId),
  }),
);
app.use("/api/rooms", roomRouter);
app.use("/api/turn", createTurnRouter(prisma, turnService));

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (error instanceof ZodError) {
    response.status(400).json({ message: error.issues[0]?.message ?? "Dữ liệu không hợp lệ." });
    return;
  }
  console.error(error);
  response.status(500).json({ message: "Đã xảy ra lỗi máy chủ." });
});

io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  if (typeof token !== "string" || !token.trim()) {
    next(new Error("Bạn cần đăng nhập trước khi kết nối realtime."));
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    const user = await prisma.user.findUnique({
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

const roomIdSchema = z.string().uuid("Mã room không hợp lệ.");
const signalSchema = z.object({
  targetId: z.string().min(1),
  payload: z.unknown(),
});

async function leaveRoomInternal(socket: Socket, socketRoomKey: string) {
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

io.on("connection", (socket) => {
  console.info(`Socket connected: ${socket.id} (user: ${socket.data.user.email})`);

  // The server only relays WebRTC metadata. Realtime content travels P2P.
  socket.on("room:join", async (rawRoomId: unknown) => {
    const parsedRoomId = roomIdSchema.safeParse(rawRoomId);
    if (!parsedRoomId.success) {
      socket.emit("room:error", { message: "Mã room không hợp lệ." });
      return;
    }

    const roomId = parsedRoomId.data;

    try {
      const room = await prisma.room.findUnique({
        where: { id: roomId },
        include: {
          workspace: {
            include: {
              members: {
                where: { userId: socket.data.user.id },
              },
            },
          },
        },
      });

      const socketRoomKey = `room:${roomId}`;

      if (!room) {
        if (socket.rooms.has(socketRoomKey)) {
          await leaveRoomInternal(socket, socketRoomKey);
        }
        socket.emit("room:error", { message: "Room không tồn tại." });
        return;
      }

      if (room.workspace.members.length === 0) {
        if (socket.rooms.has(socketRoomKey)) {
          await leaveRoomInternal(socket, socketRoomKey);
        }
        socket.emit("room:error", { message: "Bạn không thuộc workspace chứa room này." });
        return;
      }

      // A reconnecting client can emit room:join more than once. Joining the
      // same Socket Room is idempotent, but broadcasting peer-joined twice is
      // not: it can cause peers to recreate/close their WebRTC connection.
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

      // Leave any other room:<...> the socket might be in
      const existingRooms = [...socket.rooms].filter((r) => r.startsWith("room:"));
      for (const priorRoomKey of existingRooms) {
        if (priorRoomKey !== socketRoomKey) {
          await leaveRoomInternal(socket, priorRoomKey);
        }
      }

      if (!socket.connected) return;
      await socket.join(socketRoomKey);

      // Re-verify membership after joining the Socket.IO room so an in-flight
      // removal during the initial DB query cannot leave an unauthorized socket inside.
      const stillMember = await prisma.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: room.workspaceId,
            userId: socket.data.user.id,
          },
        },
        select: { userId: true },
      });
      if (!stillMember || !socket.connected) {
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

      // Maintain backwards-compatibility for existing clients expecting room:peers
      socket.emit("room:peers", { roomId, peers });

      io.to(socketRoomKey).emit("presence:changed", {
        roomId,
        peers: presence,
      });

      socket.to(socketRoomKey).emit("room:peer-joined", {
        peerId: socket.id,
        user: socket.data.user,
      });
    } catch (error) {
      console.error("Lỗi khi tham gia room:", error);
      socket.emit("room:error", { message: "Đã xảy ra lỗi khi tham gia room." });
    }
  });

  socket.on("room:leave", async (rawRoomId: unknown) => {
    const parsedRoomId = roomIdSchema.safeParse(rawRoomId);
    if (parsedRoomId.success) {
      await leaveRoomInternal(socket, `room:${parsedRoomId.data}`);
    }
  });

  const relaySignal = (
    eventName: "webrtc:offer" | "webrtc:answer" | "webrtc:ice-candidate",
  ) => {
    socket.on(eventName, (rawSignal: unknown) => {
      const parsedSignal = signalSchema.safeParse(rawSignal);
      if (!parsedSignal.success) {
        socket.emit("room:error", { message: "Dữ liệu signalling không hợp lệ." });
        return;
      }

      const target = io.sockets.sockets.get(parsedSignal.data.targetId);
      if (!target) {
        socket.emit("room:error", { message: "Peer không còn trong room." });
        return;
      }

      const sharedRoom = findSharedRoom(socket, target);
      if (!sharedRoom) {
        socket.emit("room:error", { message: "Không thể relay signalling đến peer khác room." });
        return;
      }

      target.emit(eventName, {
        peerId: socket.id,
        payload: parsedSignal.data.payload,
      });
    });
  };

  relaySignal("webrtc:offer");
  relaySignal("webrtc:answer");
  relaySignal("webrtc:ice-candidate");

  socket.on("disconnecting", () => {
    const roomKeys = [...socket.rooms].filter((roomId) => roomId.startsWith("room:"));
    for (const socketRoomKey of roomKeys) {
      const roomId = socketRoomKey.replace("room:", "");
      socket.to(socketRoomKey).emit("room:peer-left", { peerId: socket.id });

      const socketIds = [...(io.sockets.adapter.rooms.get(socketRoomKey) ?? [])].filter(
        (sid) => sid !== socket.id,
      );
      const remainingPeers: PresencePeer[] = [];
      for (const sid of socketIds) {
        const s = io.sockets.sockets.get(sid);
        if (s?.data?.user) {
          remainingPeers.push({
            peerId: sid,
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
    }
    console.info(`Socket disconnected: ${socket.id}`);
  });
});

httpServer.listen(port, () => {
  console.info(`Bifrost server is running on http://localhost:${port}`);
});
