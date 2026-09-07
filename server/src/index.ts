import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { createServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { ZodError, z } from "zod";
import { verifyAccessToken } from "./lib/auth.js";
import { prisma } from "./lib/prisma.js";
import { authRouter } from "./routes/auth.js";
import { roomRouter } from "./routes/rooms.js";
import { workspaceRouter } from "./routes/workspaces.js";

dotenv.config();

const app = express();
const httpServer = createServer(app);
const clientUrl = process.env.CLIENT_URL ?? "http://localhost:5173";
const port = Number(process.env.PORT ?? 3000);

app.use(cors({ origin: clientUrl }));
app.use(express.json());

app.get("/api/health", (_request, response) => {
  response.json({
    status: "ok",
    service: "bifrost-signaling-server",
    realtime: "webrtc-p2p-signaling",
  });
});

app.use("/api/auth", authRouter);
app.use("/api/workspaces", workspaceRouter);
app.use("/api/rooms", roomRouter);

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (error instanceof ZodError) {
    response.status(400).json({ message: error.issues[0]?.message ?? "Dữ liệu không hợp lệ." });
    return;
  }
  console.error(error);
  response.status(500).json({ message: "Đã xảy ra lỗi máy chủ." });
});

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
  cors: { origin: clientUrl },
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

function getRoomPresence(ioServer: Server, socketRoomKey: string): PresencePeer[] {
  const socketIds = ioServer.sockets.adapter.rooms.get(socketRoomKey) ?? new Set();
  const list: PresencePeer[] = [];
  for (const sid of socketIds) {
    const s = ioServer.sockets.sockets.get(sid);
    if (s?.data?.user) {
      list.push({
        peerId: sid,
        userId: s.data.user.id,
        name: s.data.user.name,
        email: s.data.user.email,
      });
    }
  }
  return list;
}

function leaveRoomInternal(socket: Socket, socketRoomKey: string) {
  if (!socket.rooms.has(socketRoomKey)) return;
  const roomId = socketRoomKey.replace("room:", "");
  socket.leave(socketRoomKey);
  socket.to(socketRoomKey).emit("room:peer-left", { peerId: socket.id });
  const remainingPresence = getRoomPresence(io, socketRoomKey);
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

      if (!room) {
        socket.emit("room:error", { message: "Room không tồn tại." });
        return;
      }

      if (room.workspace.members.length === 0) {
        socket.emit("room:error", { message: "Bạn không thuộc workspace chứa room này." });
        return;
      }

      const socketRoomKey = `room:${roomId}`;

      // A reconnecting client can emit room:join more than once. Joining the
      // same Socket Room is idempotent, but broadcasting peer-joined twice is
      // not: it can cause peers to recreate/close their WebRTC connection.
      if (socket.rooms.has(socketRoomKey)) {
        const presence = getRoomPresence(io, socketRoomKey);
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
          leaveRoomInternal(socket, priorRoomKey);
        }
      }

      socket.join(socketRoomKey);

      const presence = getRoomPresence(io, socketRoomKey);
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

  socket.on("room:leave", (rawRoomId: unknown) => {
    const parsedRoomId = roomIdSchema.safeParse(rawRoomId);
    if (parsedRoomId.success) {
      leaveRoomInternal(socket, `room:${parsedRoomId.data}`);
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
