import { Router } from "express";
import { WorkspaceRole } from "../generated/prisma/enums.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { z } from "zod";

export const workspaceRouter = Router();
workspaceRouter.use(requireAuth);

const workspaceSchema = z.object({
  name: z.string().trim().min(3, "Tên workspace cần ít nhất 3 ký tự.").max(120),
});

const inviteSchema = z.object({
  email: z.string().trim().email("Email không hợp lệ.").max(254),
});

function slugify(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/đ/g, "d").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
}

async function uniqueSlug(name: string) {
  const baseSlug = slugify(name);
  let slug = baseSlug;
  let suffix = 2;
  while (await prisma.workspace.findUnique({ where: { slug }, select: { id: true } })) {
    slug = `${baseSlug}-${suffix++}`;
  }
  return slug;
}

async function ownerMembership(workspaceId: string, userId: string) {
  return prisma.workspaceMember.findFirst({
    where: { workspaceId, userId, role: WorkspaceRole.OWNER },
  });
}

workspaceRouter.get("/", async (request, response, next) => {
  try {
    const memberships = await prisma.workspaceMember.findMany({
      where: { userId: request.user!.id },
      include: { workspace: true },
      orderBy: { joinedAt: "desc" },
    });
    response.json({ workspaces: memberships.map(({ workspace, role }) => ({ ...workspace, role })) });
  } catch (error) {
    next(error);
  }
});

workspaceRouter.post("/", async (request, response, next) => {
  try {
    const input = workspaceSchema.parse(request.body);
    const workspace = await prisma.workspace.create({
      data: {
        name: input.name,
        slug: await uniqueSlug(input.name),
        ownerId: request.user!.id,
        members: { create: { userId: request.user!.id, role: WorkspaceRole.OWNER } },
      },
    });
    response.status(201).json({ workspace: { ...workspace, role: WorkspaceRole.OWNER } });
  } catch (error) {
    next(error);
  }
});

workspaceRouter.get("/:workspaceId", async (request, response, next) => {
  try {
    const membership = await prisma.workspaceMember.findUnique({
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

workspaceRouter.post("/:workspaceId/members", async (request, response, next) => {
  try {
    const workspaceId = request.params.workspaceId;
    if (!(await ownerMembership(workspaceId, request.user!.id))) {
      response.status(403).json({ message: "Chỉ Workspace Owner mới có thể mời thành viên." });
      return;
    }
    const input = inviteSchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
    if (!user) {
      response.status(404).json({ message: "Người dùng cần đăng ký tài khoản trước khi được mời." });
      return;
    }
    const member = await prisma.workspaceMember.upsert({
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

workspaceRouter.delete("/:workspaceId/members/:userId", async (request, response, next) => {
  try {
    const { workspaceId, userId } = request.params;
    if (!(await ownerMembership(workspaceId, request.user!.id))) {
      response.status(403).json({ message: "Chỉ Workspace Owner mới có thể quản lý thành viên." });
      return;
    }
    if (userId === request.user!.id) {
      response.status(400).json({ message: "Owner không thể tự xóa chính mình khỏi workspace." });
      return;
    }
    await prisma.workspaceMember.delete({ where: { workspaceId_userId: { workspaceId, userId } } });
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

const createRoomSchema = z.object({
  name: z.string().trim().min(2, "Tên phòng cần ít nhất 2 ký tự.").max(120, "Tên phòng tối đa 120 ký tự."),
  description: z.string().trim().max(255, "Mô tả tối đa 255 ký tự.").optional().nullable(),
});
const workspaceIdSchema = z.string().uuid("ID workspace không hợp lệ.");

workspaceRouter.get("/:workspaceId/rooms", async (request, response, next) => {
  try {
    const parsedWorkspaceId = workspaceIdSchema.safeParse(request.params.workspaceId);
    if (!parsedWorkspaceId.success) {
      response.status(400).json({ message: "ID workspace không hợp lệ." });
      return;
    }
    const workspaceId = parsedWorkspaceId.data;
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true },
    });
    if (!workspace) {
      response.status(404).json({ message: "Không tìm thấy workspace." });
      return;
    }

    const membership = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: request.user!.id } },
    });
    if (!membership) {
      response.status(403).json({ message: "Bạn không thuộc workspace này." });
      return;
    }

    const rooms = await prisma.room.findMany({
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

workspaceRouter.post("/:workspaceId/rooms", async (request, response, next) => {
  try {
    const parsedWorkspaceId = workspaceIdSchema.safeParse(request.params.workspaceId);
    if (!parsedWorkspaceId.success) {
      response.status(400).json({ message: "ID workspace không hợp lệ." });
      return;
    }
    const workspaceId = parsedWorkspaceId.data;
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true },
    });
    if (!workspace) {
      response.status(404).json({ message: "Không tìm thấy workspace." });
      return;
    }

    const isOwner = await ownerMembership(workspaceId, request.user!.id);
    if (!isOwner) {
      response.status(403).json({ message: "Chỉ Workspace Owner mới có thể tạo room." });
      return;
    }

    const input = createRoomSchema.parse(request.body);
    const room = await prisma.room.create({
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
