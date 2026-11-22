import { Router } from "express";
import type { PrismaClient } from "../generated/prisma/client.js";
import { RoomAccessRole, WorkspaceRole } from "../generated/prisma/enums.js";
import { prisma } from "../lib/prisma.js";
import { isPrismaRecordNotFoundError, validateUuidParams } from "../lib/validation.js";
import { requireAuth } from "../middleware/auth.js";
import { z } from "zod";

const workspaceSchema = z.object({
  name: z.string().trim().min(3, "Tên workspace cần ít nhất 3 ký tự.").max(120),
});

const inviteSchema = z.object({
  email: z.string().trim().email("Email không hợp lệ.").max(254),
});

const createRoomSchema = z.object({
  name: z.string().trim().min(2, "Tên phòng cần ít nhất 2 ký tự.").max(120, "Tên phòng tối đa 120 ký tự."),
  description: z.string().trim().max(255, "Mô tả tối đa 255 ký tự.").optional().nullable(),
});

const updateRoomSchema = z
  .object({
    name: z.string().trim().min(2, "Tên phòng cần ít nhất 2 ký tự.").max(120, "Tên phòng tối đa 120 ký tự.").optional(),
    description: z.string().trim().max(255, "Mô tả tối đa 255 ký tự.").optional().nullable(),
  })
  .refine((data) => data.name !== undefined || data.description !== undefined, {
    message: "Cần cung cấp thông tin phòng cần cập nhật.",
  });

const ALLOWED_LABEL_COLORS = [
  "#53664b",
  "#8a684e",
  "#53617b",
  "#8b5876",
  "#477c7a",
  "#916149",
] as const;

const roomLabelSchema = z.object({
  name: z.string().trim().min(2, "Tên nhãn cần từ 2 đến 32 ký tự.").max(32, "Tên nhãn cần từ 2 đến 32 ký tự."),
  color: z.enum(ALLOWED_LABEL_COLORS, { message: "Màu nhãn không hợp lệ." }),
  priority: z.number().int().min(0).max(999, "Ưu tiên cần là số 0–999 (nhỏ hơn xếp trước)."),
});

const memberRoomRoleSchema = z.object({
  roomId: z.string().uuid("ID phòng không hợp lệ."),
  roomRole: z.enum(["HOST", "MODERATOR", "MEMBER", "VIEWER"]).nullable(),
  labelIds: z.array(z.string().uuid()).max(12, "Nhãn vượt quá 12 nhãn.").optional(),
});

const WORKSPACE_ID_RULE = { param: "workspaceId", message: "ID workspace không hợp lệ." } as const;
const USER_ID_RULE = { param: "userId", message: "ID thành viên không hợp lệ." } as const;
const ROOM_ID_RULE = { param: "roomId", message: "ID phòng không hợp lệ." } as const;
const LABEL_ID_RULE = { param: "labelId", message: "ID nhãn không hợp lệ." } as const;

function slugify(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/đ/g, "d").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
}

async function uniqueSlug(name: string, db: PrismaClient) {
  const baseSlug = slugify(name);
  let slug = baseSlug;
  let suffix = 2;
  while (await db.workspace.findUnique({ where: { slug }, select: { id: true } })) {
    slug = `${baseSlug}-${suffix++}`;
  }
  return slug;
}

async function ownerMembership(workspaceId: string, userId: string, db: PrismaClient) {
  return db.workspaceMember.findFirst({
    where: { workspaceId, userId, role: WorkspaceRole.OWNER },
  });
}

async function isRoomHost(workspaceId: string, roomId: string, userId: string, db: PrismaClient) {
  const assignment = await db.roomMember.findUnique({
    where: { workspaceId_roomId_userId: { workspaceId, roomId, userId } },
  });
  return assignment?.role === RoomAccessRole.HOST;
}

export interface MemberRemovedEvent {
  workspaceId: string;
  userId: string;
}

export interface RoomDeletedEvent {
  workspaceId: string;
  roomId: string;
}

export interface RoomAccessRevokedEvent {
  workspaceId: string;
  roomId: string;
  userId: string;
}

export interface WorkspaceRouterOptions {
  onMemberRemoved?: (event: MemberRemovedEvent) => Promise<unknown> | unknown;
  onRoomDeleted?: (event: RoomDeletedEvent) => Promise<unknown> | unknown;
  onRoomAccessRevoked?: (event: RoomAccessRevokedEvent) => Promise<unknown> | unknown;
  getWorkspacePresence?: (
    workspaceId: string,
  ) => Promise<Map<string, { status: "online" | "offline"; currentRoomId: string | null }>>;
}

/**
 * Builds the workspaces router with injectable Prisma client and optional lifecycle hooks.
 */
export function createWorkspaceRouter(
  db: PrismaClient = prisma,
  options: WorkspaceRouterOptions = {},
) {
  const router = Router();
  router.use(requireAuth);

  router.get("/", async (request, response, next) => {
    try {
      const memberships = await db.workspaceMember.findMany({
        where: { userId: request.user!.id },
        include: { workspace: true },
        orderBy: { joinedAt: "desc" },
      });
      response.json({ workspaces: memberships.map(({ workspace, role }) => ({ ...workspace, role })) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/", async (request, response, next) => {
    try {
      const input = workspaceSchema.parse(request.body);
      const workspace = await db.workspace.create({
        data: {
          name: input.name,
          slug: await uniqueSlug(input.name, db),
          ownerId: request.user!.id,
          members: { create: { userId: request.user!.id, role: WorkspaceRole.OWNER } },
        },
      });
      response.status(201).json({ workspace: { ...workspace, role: WorkspaceRole.OWNER } });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:workspaceId", validateUuidParams(WORKSPACE_ID_RULE), async (request, response, next) => {
    try {
      const membership = await db.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: request.params.workspaceId, userId: request.user!.id } },
        include: { workspace: { include: { members: { include: { user: { select: { id: true, name: true, email: true } } } } } } },
      });
      if (!membership) {
        response.status(403).json({ message: "Bạn không thuộc workspace này." });
        return;
      }
      response.json({ workspace: { ...membership.workspace, role: membership.role } });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:workspaceId", validateUuidParams(WORKSPACE_ID_RULE), async (request, response, next) => {
    try {
      const { workspaceId } = request.params;
      if (!(await ownerMembership(workspaceId, request.user!.id, db))) {
        response.status(403).json({ message: "Chỉ Workspace Owner mới có thể chỉnh sửa workspace." });
        return;
      }
      const input = workspaceSchema.parse(request.body);
      const workspace = await db.workspace.update({
        where: { id: workspaceId },
        data: { name: input.name },
      });
      response.json({ workspace: { ...workspace, role: WorkspaceRole.OWNER } });
    } catch (error) {
      if (isPrismaRecordNotFoundError(error)) {
        response.status(404).json({ message: "Không tìm thấy workspace." });
        return;
      }
      next(error);
    }
  });

  router.delete("/:workspaceId", validateUuidParams(WORKSPACE_ID_RULE), async (request, response, next) => {
    try {
      const { workspaceId } = request.params;
      if (!(await ownerMembership(workspaceId, request.user!.id, db))) {
        response.status(403).json({ message: "Chỉ Workspace Owner mới có thể xóa workspace." });
        return;
      }
      await db.workspace.delete({ where: { id: workspaceId } });
      response.status(204).send();
    } catch (error) {
      if (isPrismaRecordNotFoundError(error)) {
        response.status(404).json({ message: "Không tìm thấy workspace." });
        return;
      }
      next(error);
    }
  });

  router.get("/:workspaceId/members", validateUuidParams(WORKSPACE_ID_RULE), async (request, response, next) => {
    try {
      const { workspaceId } = request.params;
      const membership = await db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: request.user!.id } } });
      if (!membership) { response.status(403).json({ message: "Bạn không thuộc workspace này." }); return; }

      const members = await db.workspaceMember.findMany({
        where: { workspaceId },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              profile: { select: { avatarDataUrl: true } },
            },
          },
        },
        orderBy: { joinedAt: "asc" },
      });

      const [roomMembers, roomRoles, livePresence] = await Promise.all([
        db.roomMember.findMany({ where: { workspaceId } }),
        db.roomLabel.findMany({ where: { workspaceId }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }] }),
        options.getWorkspacePresence ? options.getWorkspacePresence(workspaceId) : Promise.resolve(new Map()),
      ]);

      const enrichedMembers = members.map((row) => {
        const userAssignments = roomMembers.filter((item) => item.userId === row.userId);
        const presence = livePresence.get(row.userId) ?? {
          status: "offline" as const,
          currentRoomId: null,
        };
        return {
          ...row,
          roomIds: userAssignments.map((item) => item.roomId),
          roomAssignments: userAssignments.map((item) => ({
            roomId: item.roomId,
            role: item.role,
            labelIds: item.labelIds,
          })),
          presence: { ...presence, source: "realtime" as const },
          user: {
            id: row.user.id,
            name: row.user.name,
            email: row.user.email,
            avatarDataUrl: row.user.profile?.avatarDataUrl ?? null,
          },
        };
      });

      response.json({ source: "realtime", roomRoles, members: enrichedMembers });
    } catch (error) { next(error); }
  });

  router.post("/:workspaceId/members", validateUuidParams(WORKSPACE_ID_RULE), async (request, response, next) => {
    try {
      const { workspaceId } = request.params;
      if (!(await ownerMembership(workspaceId, request.user!.id, db))) {
        response.status(403).json({ message: "Chỉ Workspace Owner mới có thể mời thành viên." });
        return;
      }
      const input = inviteSchema.parse(request.body);
      const user = await db.user.findUnique({ where: { email: input.email.toLowerCase() } });
      if (!user) {
        response.status(404).json({ message: "Người dùng cần đăng ký tài khoản trước khi được mời." });
        return;
      }
      const member = await db.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId, userId: user.id } },
        create: { workspaceId, userId: user.id, role: WorkspaceRole.MEMBER },
        update: {},
        include: { user: { select: { id: true, name: true, email: true } } },
      });
      response.status(201).json({ member });
    } catch (error) {
      next(error);
    }
  });

  router.patch(
    "/:workspaceId/members/:userId",
    validateUuidParams(WORKSPACE_ID_RULE, USER_ID_RULE),
    async (request, response, next) => {
      try {
        const { workspaceId, userId } = request.params;
        if (Object.prototype.hasOwnProperty.call(request.body ?? {}, "role")) {
          response.status(403).json({ message: "Không thể thay đổi quyền Workspace bằng thao tác này." });
          return;
        }
        const input = memberRoomRoleSchema.parse(request.body);

        const manager = await db.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId, userId: request.user!.id } },
        });
        const isOwner = manager?.role === WorkspaceRole.OWNER;
        const managerAssignment = manager
          ? await db.roomMember.findUnique({
              where: {
                workspaceId_roomId_userId: {
                  workspaceId,
                  roomId: input.roomId,
                  userId: request.user!.id,
                },
              },
            })
          : null;
        const managerRoomRole = managerAssignment?.role;

        if (
          !manager ||
          (!isOwner &&
            managerRoomRole !== RoomAccessRole.HOST &&
            managerRoomRole !== RoomAccessRole.MODERATOR)
        ) {
          response.status(403).json({ message: "Bạn không có quyền quản lý phòng này." });
          return;
        }

        const targetMember = await db.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId, userId } },
        });
        if (!targetMember) {
          response.status(404).json({ message: "Thành viên không thuộc Workspace." });
          return;
        }

        const room = await db.room.findFirst({
          where: { id: input.roomId, workspaceId },
        });
        if (!room) {
          response.status(404).json({ message: "Phòng không thuộc Workspace này." });
          return;
        }

        const previous = await db.roomMember.findUnique({
          where: {
            workspaceId_roomId_userId: { workspaceId, roomId: input.roomId, userId },
          },
        });

        if (
          !isOwner &&
          managerRoomRole === RoomAccessRole.MODERATOR &&
          (previous?.role === RoomAccessRole.HOST ||
            previous?.role === RoomAccessRole.MODERATOR ||
            input.roomRole === "HOST" ||
            input.roomRole === "MODERATOR")
        ) {
          response.status(403).json({ message: "Điều phối viên chỉ quản lý Thành viên và Chỉ xem." });
          return;
        }

        const labelIds = input.labelIds === undefined ? (previous?.labelIds ?? []) : [...new Set(input.labelIds)];
        if (labelIds.length > 0) {
          const validLabels = await db.roomLabel.findMany({
            where: { workspaceId, roomId: input.roomId, id: { in: labelIds } },
            select: { id: true },
          });
          if (validLabels.length !== labelIds.length) {
            response.status(400).json({ message: "Nhãn không thuộc phòng này hoặc vượt quá 12 nhãn." });
            return;
          }
        }

        if (input.roomRole === "HOST") {
          await db.roomMember.updateMany({
            where: { workspaceId, roomId: input.roomId, role: RoomAccessRole.HOST },
            data: { role: RoomAccessRole.MEMBER },
          });
        }

        if (input.roomRole === null) {
          await db.roomMember.deleteMany({
            where: { workspaceId, roomId: input.roomId, userId },
          });
        } else {
          await db.roomMember.upsert({
            where: {
              workspaceId_roomId_userId: { workspaceId, roomId: input.roomId, userId },
            },
            create: {
              workspaceId,
              roomId: input.roomId,
              userId,
              role: input.roomRole as RoomAccessRole,
              labelIds,
            },
            update: {
              role: input.roomRole as RoomAccessRole,
              labelIds,
            },
          });
        }

        const currentHost = await db.roomMember.findFirst({
          where: { workspaceId, roomId: input.roomId, role: RoomAccessRole.HOST },
          select: { userId: true },
        });
        await db.room.update({
          where: { id: input.roomId },
          data: { hostId: currentHost?.userId ?? null },
        });

        if (input.roomRole === null && options.onRoomAccessRevoked) {
          try {
            await options.onRoomAccessRevoked({ workspaceId, roomId: input.roomId, userId });
          } catch (revokeError) {
            console.error("Lỗi khi thu hồi phiên Socket.IO của thành viên khỏi phòng:", revokeError);
          }
        }

        response.json({ updated: true });
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete(
    "/:workspaceId/members/:userId",
    validateUuidParams(WORKSPACE_ID_RULE, USER_ID_RULE),
    async (request, response, next) => {
      try {
        const { workspaceId, userId } = request.params;
        if (!(await ownerMembership(workspaceId, request.user!.id, db))) {
          response.status(403).json({ message: "Chỉ Workspace Owner mới có thể quản lý thành viên." });
          return;
        }
        if (userId === request.user!.id) {
          response.status(400).json({ message: "Owner không thể tự xóa chính mình khỏi workspace." });
          return;
        }
        await db.workspaceMember.delete({ where: { workspaceId_userId: { workspaceId, userId } } });
        if (options.onMemberRemoved) {
          try {
            await options.onMemberRemoved({ workspaceId, userId });
          } catch (revokeError) {
            console.error("Lỗi khi thu hồi phiên Socket.IO của thành viên bị xóa:", revokeError);
          }
        }
        response.status(204).send();
      } catch (error) {
        if (isPrismaRecordNotFoundError(error)) {
          response.status(404).json({ message: "Thành viên không tồn tại trong workspace này." });
          return;
        }
        next(error);
      }
    },
  );

  router.get("/:workspaceId/rooms", validateUuidParams(WORKSPACE_ID_RULE), async (request, response, next) => {
    try {
      const { workspaceId } = request.params;
      const workspace = await db.workspace.findUnique({
        where: { id: workspaceId },
        select: { id: true },
      });
      if (!workspace) {
        response.status(404).json({ message: "Không tìm thấy workspace." });
        return;
      }

      const membership = await db.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: request.user!.id } },
      });
      if (!membership) {
        response.status(403).json({ message: "Bạn không thuộc workspace này." });
        return;
      }

      const [rooms, userRoomRoles] = await Promise.all([
        db.room.findMany({
          where: { workspaceId },
          include: {
            host: { select: { id: true, name: true, email: true } },
          },
          orderBy: { createdAt: "desc" },
        }),
        db.roomMember.findMany({
          where: { workspaceId, userId: request.user!.id },
          select: { roomId: true, role: true },
        }),
      ]);

      const roleMap = new Map(userRoomRoles.map((entry) => [entry.roomId, entry.role]));
      const formattedRooms = rooms.map((room) => ({
        ...room,
        access:
          membership.role === WorkspaceRole.OWNER
            ? "OWNER"
            : (roleMap.get(room.id) ?? (room.hostId === request.user!.id ? "HOST" : null)),
        createdById: (room as { createdById?: string | null }).createdById ?? room.hostId,
      }));

      response.json({ rooms: formattedRooms });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:workspaceId/rooms", validateUuidParams(WORKSPACE_ID_RULE), async (request, response, next) => {
    try {
      const { workspaceId } = request.params;
      const workspace = await db.workspace.findUnique({
        where: { id: workspaceId },
        select: { id: true },
      });
      if (!workspace) {
        response.status(404).json({ message: "Không tìm thấy workspace." });
        return;
      }

      const isOwner = await ownerMembership(workspaceId, request.user!.id, db);
      if (!isOwner) {
        response.status(403).json({ message: "Chỉ Workspace Owner mới có thể tạo room." });
        return;
      }

      const input = createRoomSchema.parse(request.body);
      const room = await db.room.create({
        data: {
          name: input.name,
          description: input.description?.trim() ? input.description.trim() : null,
          workspaceId,
          hostId: request.user!.id,
          createdById: request.user!.id,
          members: {
            create: {
              workspaceId,
              userId: request.user!.id,
              role: RoomAccessRole.HOST,
            },
          },
        },
        include: {
          host: { select: { id: true, name: true, email: true } },
        },
      });

      response.status(201).json({
        room: {
          ...room,
          access: "OWNER",
          createdById: (room as { createdById?: string | null }).createdById ?? room.hostId,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.patch(
    "/:workspaceId/rooms/:roomId",
    validateUuidParams(WORKSPACE_ID_RULE, ROOM_ID_RULE),
    async (request, response, next) => {
      try {
        const { workspaceId, roomId } = request.params;
        const membership = await db.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId, userId: request.user!.id } },
        });
        if (!membership) {
          response.status(403).json({ message: "Bạn không thuộc workspace này." });
          return;
        }
        const isOwner = membership.role === WorkspaceRole.OWNER;
        const hostAccess = isOwner ? false : await isRoomHost(workspaceId, roomId, request.user!.id, db);
        if (!isOwner && !hostAccess) {
          response.status(403).json({ message: "Chỉ chủ Workspace hoặc chủ phòng được chỉnh sửa phòng." });
          return;
        }

        const existingRoom = await db.room.findFirst({
          where: { id: roomId, workspaceId },
        });
        if (!existingRoom) {
          response.status(404).json({ message: "Không tìm thấy phòng." });
          return;
        }

        const input = updateRoomSchema.parse(request.body);
        const room = await db.room.update({
          where: { id: roomId },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.description !== undefined
              ? { description: input.description?.trim() ? input.description.trim() : null }
              : {}),
          },
          include: {
            host: { select: { id: true, name: true, email: true } },
          },
        });

        response.json({
          room: {
            ...room,
            access: isOwner ? "OWNER" : "HOST",
            createdById: (room as { createdById?: string | null }).createdById ?? room.hostId,
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete(
    "/:workspaceId/rooms/:roomId",
    validateUuidParams(WORKSPACE_ID_RULE, ROOM_ID_RULE),
    async (request, response, next) => {
      try {
        const { workspaceId, roomId } = request.params;
        if (!(await ownerMembership(workspaceId, request.user!.id, db))) {
          response.status(403).json({ message: "Chỉ Workspace Owner mới có thể xóa phòng." });
          return;
        }
        const existingRoom = await db.room.findFirst({
          where: { id: roomId, workspaceId },
          select: { id: true },
        });
        if (!existingRoom) {
          response.status(404).json({ message: "Không tìm thấy phòng." });
          return;
        }

        await db.room.delete({ where: { id: roomId } });
        if (options.onRoomDeleted) {
          try {
            await options.onRoomDeleted({ workspaceId, roomId });
          } catch (revokeError) {
            console.error("Lỗi khi đóng phiên Socket.IO của phòng bị xóa:", revokeError);
          }
        }
        response.status(204).send();
      } catch (error) {
        if (isPrismaRecordNotFoundError(error)) {
          response.status(404).json({ message: "Không tìm thấy phòng." });
          return;
        }
        next(error);
      }
    },
  );

  router.post(
    "/:workspaceId/rooms/:roomId/roles",
    validateUuidParams(WORKSPACE_ID_RULE, ROOM_ID_RULE),
    async (request, response, next) => {
      try {
        const { workspaceId, roomId } = request.params;
        const membership = await db.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId, userId: request.user!.id } },
        });
        const isOwner = membership?.role === WorkspaceRole.OWNER;
        const hostAccess = !isOwner && membership ? await isRoomHost(workspaceId, roomId, request.user!.id, db) : false;
        if (!membership || (!isOwner && !hostAccess)) {
          response.status(403).json({ message: "Chỉ chủ Workspace hoặc chủ phòng được quản lý nhãn." });
          return;
        }

        const room = await db.room.findFirst({ where: { id: roomId, workspaceId }, select: { id: true } });
        if (!room) {
          response.status(404).json({ message: "Không tìm thấy phòng." });
          return;
        }

        const input = roomLabelSchema.parse(request.body);
        const existingLabels = await db.roomLabel.findMany({
          where: { workspaceId, roomId },
          select: { id: true, name: true },
        });
        if (existingLabels.some((item) => item.name.toLocaleLowerCase() === input.name.toLocaleLowerCase())) {
          response.status(409).json({ message: "Tên nhãn đã có trong phòng." });
          return;
        }

        const label = await db.roomLabel.create({
          data: {
            workspaceId,
            roomId,
            name: input.name,
            color: input.color,
            priority: input.priority,
          },
        });
        response.status(201).json({ label });
      } catch (error) {
        next(error);
      }
    },
  );

  router.patch(
    "/:workspaceId/rooms/:roomId/roles/:labelId",
    validateUuidParams(WORKSPACE_ID_RULE, ROOM_ID_RULE, LABEL_ID_RULE),
    async (request, response, next) => {
      try {
        const { workspaceId, roomId, labelId } = request.params;
        const membership = await db.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId, userId: request.user!.id } },
        });
        const isOwner = membership?.role === WorkspaceRole.OWNER;
        const hostAccess = !isOwner && membership ? await isRoomHost(workspaceId, roomId, request.user!.id, db) : false;
        if (!membership || (!isOwner && !hostAccess)) {
          response.status(403).json({ message: "Chỉ chủ Workspace hoặc chủ phòng được quản lý nhãn." });
          return;
        }

        const existingLabel = await db.roomLabel.findFirst({
          where: { id: labelId, roomId, workspaceId },
        });
        if (!existingLabel) {
          response.status(404).json({ message: "Không tìm thấy nhãn." });
          return;
        }

        const input = roomLabelSchema.parse(request.body);
        const siblingLabels = await db.roomLabel.findMany({
          where: { workspaceId, roomId, NOT: { id: labelId } },
          select: { name: true },
        });
        if (siblingLabels.some((item) => item.name.toLocaleLowerCase() === input.name.toLocaleLowerCase())) {
          response.status(409).json({ message: "Tên nhãn đã có trong phòng." });
          return;
        }

        const label = await db.roomLabel.update({
          where: { id: labelId },
          data: { name: input.name, color: input.color, priority: input.priority },
        });
        response.json({ label });
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete(
    "/:workspaceId/rooms/:roomId/roles/:labelId",
    validateUuidParams(WORKSPACE_ID_RULE, ROOM_ID_RULE, LABEL_ID_RULE),
    async (request, response, next) => {
      try {
        const { workspaceId, roomId, labelId } = request.params;
        const membership = await db.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId, userId: request.user!.id } },
        });
        const isOwner = membership?.role === WorkspaceRole.OWNER;
        const hostAccess = !isOwner && membership ? await isRoomHost(workspaceId, roomId, request.user!.id, db) : false;
        if (!membership || (!isOwner && !hostAccess)) {
          response.status(403).json({ message: "Chỉ chủ Workspace hoặc chủ phòng được quản lý nhãn." });
          return;
        }

        const existingLabel = await db.roomLabel.findFirst({
          where: { id: labelId, roomId, workspaceId },
        });
        if (!existingLabel) {
          response.status(404).json({ message: "Không tìm thấy nhãn." });
          return;
        }

        await db.roomLabel.delete({ where: { id: labelId } });
        const assignedMembers = await db.roomMember.findMany({
          where: { workspaceId, roomId, labelIds: { has: labelId } },
        });
        await Promise.all(
          assignedMembers.map((member) =>
            db.roomMember.update({
              where: {
                workspaceId_roomId_userId: { workspaceId, roomId, userId: member.userId },
              },
              data: { labelIds: member.labelIds.filter((id) => id !== labelId) },
            }),
          ),
        );

        response.json({ deleted: true });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

export const workspaceRouter = createWorkspaceRouter();
