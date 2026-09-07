import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

export const roomRouter = Router();
roomRouter.use(requireAuth);

const uuidSchema = z.string().uuid("ID phòng không hợp lệ.");

roomRouter.get("/:roomId", async (request, response, next) => {
  try {
    const parsedRoomId = uuidSchema.safeParse(request.params.roomId);
    if (!parsedRoomId.success) {
      response.status(400).json({ message: "ID phòng không hợp lệ." });
      return;
    }
    const roomId = parsedRoomId.data;

    const room = await prisma.room.findUnique({
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

    const membership = await prisma.workspaceMember.findUnique({
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

    response.json({ room });
  } catch (error) {
    next(error);
  }
});
