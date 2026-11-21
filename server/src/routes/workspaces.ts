import { Router } from "express";
import type { PrismaClient } from "../generated/prisma/client.js";
import { WorkspaceRole } from "../generated/prisma/enums.js";
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

const WORKSPACE_ID_RULE = { param: "workspaceId", message: "ID workspace không hợp lệ." } as const;
const USER_ID_RULE = { param: "userId", message: "ID thành viên không hợp lệ." } as const;

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

export interface MemberRemovedEvent {
  workspaceId: string;
  userId: string;
}

export interface WorkspaceRouterOptions {
  onMemberRemoved?: (event: MemberRemovedEvent) => Promise<unknown> | unknown;
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
      const members = await db.workspaceMember.findMany({ where: { workspaceId }, include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { joinedAt: "asc" } });
      response.json({ members });
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

      const rooms = await db.room.findMany({
        where: { workspaceId },
        include: {
          host: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: "desc" },
      });

      response.json({ rooms });
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
        },
        include: {
          host: { select: { id: true, name: true, email: true } },
        },
      });

      response.status(201).json({ room });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export const workspaceRouter = createWorkspaceRouter();
