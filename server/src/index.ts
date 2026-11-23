import "dotenv/config";
import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { ZodError } from "zod";
import { prisma } from "./lib/prisma.js";
import {
  RATE_LIMIT_EXPOSED_HEADERS,
  getAuthRateLimiters,
  parseTrustProxySetting,
} from "./lib/rateLimit.js";
import {
  getWorkspaceLivePresence,
  revokeRoomSessions,
  revokeWorkspaceMemberSessions,
} from "./lib/revocation.js";
import { createTurnServiceFromEnv } from "./lib/turn.js";
import { authRouter } from "./routes/auth.js";
import { roomRouter } from "./routes/rooms.js";
import { createTurnRouter } from "./routes/turn.js";
import { createWorkspaceRouter } from "./routes/workspaces.js";
import { attachRoomSocket } from "./sockets/room.socket.js";

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
app.post("/api/auth/refresh", authRateLimiters.loginIpLimiter);
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

attachRoomSocket(io, prisma);

httpServer.listen(port, () => {
  console.info(`Bifrost server is running on http://localhost:${port}`);
});
