import { Router } from "express";
import { createRoomController } from "../controllers/room.controller.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { validateUuidParams } from "../lib/validation.js";
import { requireAuth } from "../middleware/auth.js";

const ROOM_ID_RULE = { param: "roomId", message: "ID phòng không hợp lệ." } as const;

/**
 * Builds the rooms router with injectable Prisma client for isolated testing.
 */
export function createRoomRouter(db: PrismaClient = prisma) {
  const router = Router();
  const controller = createRoomController(db);

  router.use(requireAuth);
  router.get("/:roomId", validateUuidParams(ROOM_ID_RULE), controller.getById);

  return router;
}

export const roomRouter = createRoomRouter();
