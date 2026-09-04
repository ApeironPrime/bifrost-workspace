import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { createServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { ZodError, z } from "zod";
import { verifyAccessToken } from "./lib/auth.js";
import { authRouter } from "./routes/auth.js";
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

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (error instanceof ZodError) {
    response.status(400).json({ message: error.issues[0]?.message ?? "Dữ liệu không hợp lệ." });
    return;
  }
  console.error(error);
  response.status(500).json({ message: "Đã xảy ra lỗi máy chủ." });
});

const io = new Server(httpServer, {
  cors: { origin: clientUrl },
});

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (typeof token !== "string") {
    next(new Error("Bạn cần đăng nhập trước khi kết nối realtime."));
    return;
  }

  try {
    socket.data.user = verifyAccessToken(token);
    next();
  } catch {
    next(new Error("Phiên đăng nhập không hợp lệ."));
  }
});

const roomIdSchema = z.string().trim().min(3).max(80);
const signalSchema = z.object({
  targetId: z.string().min(1),
  payload: z.unknown(),
});

function leaveRoom(socket: Socket, roomId: string) {
  if (!socket.rooms.has(roomId)) return;
  socket.leave(roomId);
  socket.to(roomId).emit("room:peer-left", { peerId: socket.id });
}

function isPeerInSameRoom(socket: Socket, target: Socket) {
  return [...socket.rooms].some(
    (roomId) => roomId !== socket.id && target.rooms.has(roomId),
  );
}

io.on("connection", (socket) => {
  console.info(`Socket connected: ${socket.id}`);

  // The server only relays WebRTC metadata. Realtime content travels P2P.
  socket.on("room:join", (rawRoomId: unknown) => {
    const parsedRoomId = roomIdSchema.safeParse(rawRoomId);
    if (!parsedRoomId.success) {
      socket.emit("room:error", { message: "Mã room không hợp lệ." });
      return;
    }

    const roomId = parsedRoomId.data;
    const peers = [...(io.sockets.adapter.rooms.get(roomId) ?? [])];
    socket.join(roomId);
    socket.emit("room:peers", { roomId, peers });
    socket.to(roomId).emit("room:peer-joined", { peerId: socket.id });
  });

  socket.on("room:leave", (rawRoomId: unknown) => {
    const parsedRoomId = roomIdSchema.safeParse(rawRoomId);
    if (parsedRoomId.success) leaveRoom(socket, parsedRoomId.data);
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
      if (!target || !isPeerInSameRoom(socket, target)) {
        socket.emit("room:error", { message: "Peer không còn trong room." });
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
    [...socket.rooms]
      .filter((roomId) => roomId !== socket.id)
      .forEach((roomId) => socket.to(roomId).emit("room:peer-left", { peerId: socket.id }));
    console.info(`Socket disconnected: ${socket.id}`);
  });
});

httpServer.listen(port, () => {
  console.info(`Bifrost server is running on http://localhost:${port}`);
});
