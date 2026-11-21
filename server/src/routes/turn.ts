import { Router, type RequestHandler } from "express";
import { MemoryStore, ipKeyGenerator, rateLimit, type RateLimitRequestHandler, type Store } from "express-rate-limit";
import { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import {
  DEFAULT_TURN_RATE_LIMIT_MAX,
  DEFAULT_TURN_RATE_LIMIT_WINDOW_MS,
  TURN_RATE_LIMIT_MESSAGE,
  type TurnService,
} from "../lib/turn.js";
import { requireAuth } from "../middleware/auth.js";

const roomIdQuerySchema = z.string().uuid("ID phòng không hợp lệ.");

export interface TurnRateLimiterOptions {
  max?: number;
  windowMs?: number;
  store?: Store;
}

export interface TurnRouterOptions {
  rateLimitStore?: Store;
  rateLimitMax?: number;
  rateLimitWindowMs?: number;
}

export interface TurnRouterBundle {
  router: Router;
  rateLimiter: RateLimitRequestHandler;
  shutdown: () => Promise<void>;
}

/**
 * Creates the endpoint-scoped rate limiter for `GET /api/turn/credentials`,
 * keyed by authenticated user ID (with IP fallback) on an isolated MemoryStore.
 */
export function createTurnRateLimiter(options: TurnRateLimiterOptions = {}): {
  limiter: RateLimitRequestHandler;
  store: Store;
  shutdown: () => Promise<void>;
} {
  const store = options.store ?? new MemoryStore();
  const limiter = rateLimit({
    windowMs: options.windowMs ?? DEFAULT_TURN_RATE_LIMIT_WINDOW_MS,
    limit: options.max ?? DEFAULT_TURN_RATE_LIMIT_MAX,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    identifier: "turn-credentials",
    passOnStoreError: true,
    statusCode: 429,
    message: { message: TURN_RATE_LIMIT_MESSAGE },
    store,
    keyGenerator: (request) => {
      if (request.user?.id) {
        return `turn:user:${request.user.id}`;
      }
      const normalizedIp = request.ip ? ipKeyGenerator(request.ip, 56) : "unknown";
      return `turn:ip:${normalizedIp}`;
    },
  });

  return {
    limiter,
    store,
    shutdown: async () => {
      await store.shutdown?.();
    },
  };
}

const validateRoomIdQuery: RequestHandler = (request, response, next) => {
  const rawRoomId = request.query.roomId;
  if (typeof rawRoomId !== "string") {
    response.status(400).json({ message: "ID phòng không hợp lệ." });
    return;
  }
  const parsed = roomIdQuerySchema.safeParse(rawRoomId);
  if (!parsed.success) {
    response.status(400).json({ message: "ID phòng không hợp lệ." });
    return;
  }
  response.locals.validatedTurnRoomId = parsed.data;
  next();
};

/**
 * Builds the TURN credentials router (`GET /api/turn/credentials?roomId=<uuid>`)
 * with strict middleware order: auth -> rate-limit -> UUID query check -> DB user/room/membership checks.
 */
export function createTurnRouterBundle(
  db: PrismaClient,
  turnService: TurnService,
  options: TurnRouterOptions = {},
): TurnRouterBundle {
  const router = Router();
  const { limiter, shutdown } = createTurnRateLimiter({
    max: options.rateLimitMax ?? turnService.config.rateLimitMax,
    windowMs: options.rateLimitWindowMs ?? turnService.config.rateLimitWindowMs,
    store: options.rateLimitStore,
  });

  router.get(
    "/credentials",
    requireAuth,
    limiter,
    validateRoomIdQuery,
    async (request, response, next) => {
      try {
        const roomId = response.locals.validatedTurnRoomId as string;
        const authUserId = request.user!.id;

        const existingUser = await db.user.findUnique({
          where: { id: authUserId },
          select: { id: true },
        });
        if (!existingUser) {
          response.status(401).json({ message: "Phiên đăng nhập không hợp lệ hoặc tài khoản không tồn tại." });
          return;
        }

        const room = await db.room.findUnique({
          where: { id: roomId },
          select: { id: true, workspaceId: true },
        });
        if (!room) {
          response.status(404).json({ message: "Không tìm thấy room." });
          return;
        }

        const membership = await db.workspaceMember.findUnique({
          where: {
            workspaceId_userId: {
              workspaceId: room.workspaceId,
              userId: existingUser.id,
            },
          },
          select: { userId: true },
        });
        if (!membership) {
          response.status(403).json({ message: "Bạn không thuộc workspace chứa room này." });
          return;
        }

        // Ignore all client-supplied credential parameters; issue strictly from verified DB user ID.
        const credentials = turnService.issueForUser(existingUser.id);
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Pragma", "no-cache");
        response.json(credentials);
      } catch (error) {
        next(error);
      }
    },
  );

  return { router, rateLimiter: limiter, shutdown };
}

export function createTurnRouter(
  db: PrismaClient = prisma,
  turnService: TurnService,
  options: TurnRouterOptions = {},
): Router {
  return createTurnRouterBundle(db, turnService, options).router;
}
