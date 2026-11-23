import type { PrismaClient } from "../generated/prisma/client.js";
import { WorkspaceRole } from "../generated/prisma/enums.js";

export class RoomServiceError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function getRoomDetailsForUser(
  db: PrismaClient,
  roomId: string,
  userId: string,
) {
  const room = await db.room.findUnique({
    where: { id: roomId },
    include: {
      host: { select: { id: true, name: true, email: true } },
      workspace: { select: { id: true, name: true, slug: true } },
    },
  });

  if (!room) {
    throw new RoomServiceError(404, "Không tìm thấy room.");
  }

  const membership = await db.workspaceMember.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId: room.workspaceId,
        userId,
      },
    },
  });

  if (!membership) {
    throw new RoomServiceError(403, "Bạn không thuộc workspace chứa room này.");
  }

  const roomAssignment = await db.roomMember.findUnique({
    where: {
      workspaceId_roomId_userId: {
        workspaceId: room.workspaceId,
        roomId: room.id,
        userId,
      },
    },
  });

  const access =
    membership.role === WorkspaceRole.OWNER
      ? "OWNER"
      : (roomAssignment?.role ?? (room.hostId === userId ? "HOST" : null));

  return {
    room: {
      ...room,
      access,
      createdById: (room as { createdById?: string | null }).createdById ?? room.hostId,
    },
  };
}
