import { Router } from "express";
import type { PrismaClient } from "../generated/prisma/client.js";
import { WorkspaceRole } from "../generated/prisma/enums.js";
import { prisma } from "../lib/prisma.js";
import { validateUuidParams } from "../lib/validation.js";
import { requireAuth } from "../middleware/auth.js";

const ROOM_ID_RULE = { param: "roomId", message: "ID phòng không hợp lệ." } as const;

/**
 * Builds the rooms router with injectable Prisma client for isolated testing.
 */
export function createRoomRouter(db: PrismaClient = prisma) {
  const router = Router();
  router.use(requireAuth);

  router.get("/:roomId", validateUuidParams(ROOM_ID_RULE), async (request, response, next) => {
    try {
      const { roomId } = request.params;

      const room = await db.room.findUnique({
        where: { id: roomId },
        include: {
          host: { select: { id: true, name: true, email: true } },
          workspace: { select: { id: true, name: true, slug: true } },
        },
      });

      if (!room) {
        response.status(404).json({ message: "Không tìm thấy room." });
        return;
      }

      const membership = await db.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: room.workspaceId,
            userId: request.user!.id,
          },
        },
      });

      if (!membership) {
        response.status(403).json({ message: "Bạn không thuộc workspace chứa room này." });
        return;
      }

      const roomAssignment = await db.roomMember.findUnique({
        where: {
          workspaceId_roomId_userId: {
            workspaceId: room.workspaceId,
            roomId: room.id,
            userId: request.user!.id,
          },
        },
      });

      const access =
        membership.role === WorkspaceRole.OWNER
          ? "OWNER"
          : (roomAssignment?.role ?? (room.hostId === request.user!.id ? "HOST" : null));

      response.json({
        room: {
          ...room,
          access,
          createdById: (room as { createdById?: string | null }).createdById ?? room.hostId,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export const roomRouter = createRoomRouter();
