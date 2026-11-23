import type { PrismaClient } from "../generated/prisma/client.js";
import { RoomAccessRole, WorkspaceRole } from "../generated/prisma/enums.js";
import { isPrismaRecordNotFoundError } from "../lib/validation.js";

export class WorkspaceServiceError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
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

function slugify(value: string) {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/đ/g, "d")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "workspace"
  );
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

export async function listWorkspaces(db: PrismaClient, userId: string) {
  const memberships = await db.workspaceMember.findMany({
    where: { userId },
    include: { workspace: true },
    orderBy: { joinedAt: "desc" },
  });
  return { workspaces: memberships.map(({ workspace, role }) => ({ ...workspace, role })) };
}

export async function createWorkspace(db: PrismaClient, userId: string, name: string) {
  const workspace = await db.workspace.create({
    data: {
      name,
      slug: await uniqueSlug(name, db),
      ownerId: userId,
      members: { create: { userId, role: WorkspaceRole.OWNER } },
    },
  });
  return { workspace: { ...workspace, role: WorkspaceRole.OWNER } };
}

export async function getWorkspaceDetail(db: PrismaClient, workspaceId: string, userId: string) {
  const membership = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    include: {
      workspace: {
        include: {
          members: { include: { user: { select: { id: true, name: true, email: true } } } },
        },
      },
    },
  });
  if (!membership) {
    throw new WorkspaceServiceError(403, "Bạn không thuộc workspace này.");
  }
  return { workspace: { ...membership.workspace, role: membership.role } };
}

export async function updateWorkspace(
  db: PrismaClient,
  workspaceId: string,
  userId: string,
  name: string,
) {
  if (!(await ownerMembership(workspaceId, userId, db))) {
    throw new WorkspaceServiceError(403, "Chỉ Workspace Owner mới có thể chỉnh sửa workspace.");
  }
  try {
    const workspace = await db.workspace.update({
      where: { id: workspaceId },
      data: { name },
    });
    return { workspace: { ...workspace, role: WorkspaceRole.OWNER } };
  } catch (error) {
    if (isPrismaRecordNotFoundError(error)) {
      throw new WorkspaceServiceError(404, "Không tìm thấy workspace.");
    }
    throw error;
  }
}

export async function deleteWorkspace(db: PrismaClient, workspaceId: string, userId: string) {
  if (!(await ownerMembership(workspaceId, userId, db))) {
    throw new WorkspaceServiceError(403, "Chỉ Workspace Owner mới có thể xóa workspace.");
  }
  try {
    await db.workspace.delete({ where: { id: workspaceId } });
  } catch (error) {
    if (isPrismaRecordNotFoundError(error)) {
      throw new WorkspaceServiceError(404, "Không tìm thấy workspace.");
    }
    throw error;
  }
}

export async function listWorkspaceMembers(
  db: PrismaClient,
  workspaceId: string,
  userId: string,
  options: WorkspaceRouterOptions,
) {
  const membership = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
  if (!membership) {
    throw new WorkspaceServiceError(403, "Bạn không thuộc workspace này.");
  }

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

  return { source: "realtime", roomRoles, members: enrichedMembers };
}

export async function inviteWorkspaceMember(
  db: PrismaClient,
  workspaceId: string,
  actorUserId: string,
  email: string,
) {
  if (!(await ownerMembership(workspaceId, actorUserId, db))) {
    throw new WorkspaceServiceError(403, "Chỉ Workspace Owner mới có thể mời thành viên.");
  }
  const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) {
    throw new WorkspaceServiceError(404, "Người dùng cần đăng ký tài khoản trước khi được mời.");
  }
  const member = await db.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId, userId: user.id } },
    create: { workspaceId, userId: user.id, role: WorkspaceRole.MEMBER },
    update: {},
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  return { member };
}

export async function updateMemberRoomRole(
  db: PrismaClient,
  params: {
    workspaceId: string;
    actorUserId: string;
    targetUserId: string;
    roomId: string;
    roomRole: "HOST" | "MODERATOR" | "MEMBER" | "VIEWER" | null;
    labelIds?: string[];
  },
  options: WorkspaceRouterOptions,
) {
  const { workspaceId, actorUserId, targetUserId, roomId, roomRole } = params;
  const manager = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: actorUserId } },
  });
  const isOwner = manager?.role === WorkspaceRole.OWNER;
  const managerAssignment = manager
    ? await db.roomMember.findUnique({
        where: { workspaceId_roomId_userId: { workspaceId, roomId, userId: actorUserId } },
      })
    : null;
  const managerRoomRole = managerAssignment?.role;

  if (
    !manager ||
    (!isOwner &&
      managerRoomRole !== RoomAccessRole.HOST &&
      managerRoomRole !== RoomAccessRole.MODERATOR)
  ) {
    throw new WorkspaceServiceError(403, "Bạn không có quyền quản lý phòng này.");
  }

  const targetMember = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
  });
  if (!targetMember) {
    throw new WorkspaceServiceError(404, "Thành viên không thuộc Workspace.");
  }

  const room = await db.room.findFirst({ where: { id: roomId, workspaceId } });
  if (!room) {
    throw new WorkspaceServiceError(404, "Phòng không thuộc Workspace này.");
  }

  const previous = await db.roomMember.findUnique({
    where: { workspaceId_roomId_userId: { workspaceId, roomId, userId: targetUserId } },
  });

  if (
    !isOwner &&
    managerRoomRole === RoomAccessRole.MODERATOR &&
    (previous?.role === RoomAccessRole.HOST ||
      previous?.role === RoomAccessRole.MODERATOR ||
      roomRole === "HOST" ||
      roomRole === "MODERATOR")
  ) {
    throw new WorkspaceServiceError(403, "Điều phối viên chỉ quản lý Thành viên và Chỉ xem.");
  }

  const labelIds = params.labelIds === undefined ? (previous?.labelIds ?? []) : [...new Set(params.labelIds)];
  if (labelIds.length > 0) {
    const validLabels = await db.roomLabel.findMany({
      where: { workspaceId, roomId, id: { in: labelIds } },
      select: { id: true },
    });
    if (validLabels.length !== labelIds.length) {
      throw new WorkspaceServiceError(400, "Nhãn không thuộc phòng này hoặc vượt quá 12 nhãn.");
    }
  }

  if (roomRole === "HOST") {
    await db.roomMember.updateMany({
      where: { workspaceId, roomId, role: RoomAccessRole.HOST },
      data: { role: RoomAccessRole.MEMBER },
    });
  }

  if (roomRole === null) {
    await db.roomMember.deleteMany({
      where: { workspaceId, roomId, userId: targetUserId },
    });
  } else {
    await db.roomMember.upsert({
      where: { workspaceId_roomId_userId: { workspaceId, roomId, userId: targetUserId } },
      create: {
        workspaceId,
        roomId,
        userId: targetUserId,
        role: roomRole as RoomAccessRole,
        labelIds,
      },
      update: {
        role: roomRole as RoomAccessRole,
        labelIds,
      },
    });
  }

  const currentHost = await db.roomMember.findFirst({
    where: { workspaceId, roomId, role: RoomAccessRole.HOST },
    select: { userId: true },
  });
  await db.room.update({
    where: { id: roomId },
    data: { hostId: currentHost?.userId ?? null },
  });

  if (roomRole === null && options.onRoomAccessRevoked) {
    try {
      await options.onRoomAccessRevoked({ workspaceId, roomId, userId: targetUserId });
    } catch (revokeError) {
      console.error("Lỗi khi thu hồi phiên Socket.IO của thành viên khỏi phòng:", revokeError);
    }
  }

  return { updated: true };
}

export async function removeWorkspaceMember(
  db: PrismaClient,
  workspaceId: string,
  actorUserId: string,
  targetUserId: string,
  options: WorkspaceRouterOptions,
) {
  if (!(await ownerMembership(workspaceId, actorUserId, db))) {
    throw new WorkspaceServiceError(403, "Chỉ Workspace Owner mới có thể quản lý thành viên.");
  }
  if (targetUserId === actorUserId) {
    throw new WorkspaceServiceError(400, "Owner không thể tự xóa chính mình khỏi workspace.");
  }
  try {
    await db.workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
    });
  } catch (error) {
    if (isPrismaRecordNotFoundError(error)) {
      throw new WorkspaceServiceError(404, "Thành viên không tồn tại trong workspace này.");
    }
    throw error;
  }

  if (options.onMemberRemoved) {
    try {
      await options.onMemberRemoved({ workspaceId, userId: targetUserId });
    } catch (revokeError) {
      console.error("Lỗi khi thu hồi phiên Socket.IO của thành viên bị xóa:", revokeError);
    }
  }
}

export async function listWorkspaceRooms(db: PrismaClient, workspaceId: string, userId: string) {
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } });
  if (!workspace) {
    throw new WorkspaceServiceError(404, "Không tìm thấy workspace.");
  }

  const membership = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
  if (!membership) {
    throw new WorkspaceServiceError(403, "Bạn không thuộc workspace này.");
  }

  const [rooms, userRoomRoles] = await Promise.all([
    db.room.findMany({
      where: { workspaceId },
      include: { host: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.roomMember.findMany({
      where: { workspaceId, userId },
      select: { roomId: true, role: true },
    }),
  ]);

  const roleMap = new Map(userRoomRoles.map((entry) => [entry.roomId, entry.role]));
  const formattedRooms = rooms.map((room) => ({
    ...room,
    access:
      membership.role === WorkspaceRole.OWNER
        ? "OWNER"
        : (roleMap.get(room.id) ?? (room.hostId === userId ? "HOST" : null)),
    createdById: (room as { createdById?: string | null }).createdById ?? room.hostId,
  }));

  return { rooms: formattedRooms };
}

export async function createWorkspaceRoom(
  db: PrismaClient,
  workspaceId: string,
  userId: string,
  input: { name: string; description?: string | null },
) {
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } });
  if (!workspace) {
    throw new WorkspaceServiceError(404, "Không tìm thấy workspace.");
  }

  const isOwner = await ownerMembership(workspaceId, userId, db);
  if (!isOwner) {
    throw new WorkspaceServiceError(403, "Chỉ Workspace Owner mới có thể tạo room.");
  }

  const room = await db.room.create({
    data: {
      name: input.name,
      description: input.description?.trim() ? input.description.trim() : null,
      workspaceId,
      hostId: userId,
      createdById: userId,
      members: {
        create: {
          workspaceId,
          userId,
          role: RoomAccessRole.HOST,
        },
      },
    },
    include: {
      host: { select: { id: true, name: true, email: true } },
    },
  });

  return {
    room: {
      ...room,
      access: "OWNER",
      createdById: (room as { createdById?: string | null }).createdById ?? room.hostId,
    },
  };
}

export async function updateWorkspaceRoom(
  db: PrismaClient,
  workspaceId: string,
  roomId: string,
  userId: string,
  input: { name?: string; description?: string | null },
) {
  const membership = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
  if (!membership) {
    throw new WorkspaceServiceError(403, "Bạn không thuộc workspace này.");
  }
  const isOwner = membership.role === WorkspaceRole.OWNER;
  const hostAccess = isOwner ? false : await isRoomHost(workspaceId, roomId, userId, db);
  if (!isOwner && !hostAccess) {
    throw new WorkspaceServiceError(403, "Chỉ chủ Workspace hoặc chủ phòng được chỉnh sửa phòng.");
  }

  const existingRoom = await db.room.findFirst({ where: { id: roomId, workspaceId } });
  if (!existingRoom) {
    throw new WorkspaceServiceError(404, "Không tìm thấy phòng.");
  }

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

  return {
    room: {
      ...room,
      access: isOwner ? "OWNER" : "HOST",
      createdById: (room as { createdById?: string | null }).createdById ?? room.hostId,
    },
  };
}

export async function deleteWorkspaceRoom(
  db: PrismaClient,
  workspaceId: string,
  roomId: string,
  userId: string,
  options: WorkspaceRouterOptions,
) {
  if (!(await ownerMembership(workspaceId, userId, db))) {
    throw new WorkspaceServiceError(403, "Chỉ Workspace Owner mới có thể xóa phòng.");
  }
  const existingRoom = await db.room.findFirst({
    where: { id: roomId, workspaceId },
    select: { id: true },
  });
  if (!existingRoom) {
    throw new WorkspaceServiceError(404, "Không tìm thấy phòng.");
  }

  try {
    await db.room.delete({ where: { id: roomId } });
  } catch (error) {
    if (isPrismaRecordNotFoundError(error)) {
      throw new WorkspaceServiceError(404, "Không tìm thấy phòng.");
    }
    throw error;
  }

  if (options.onRoomDeleted) {
    try {
      await options.onRoomDeleted({ workspaceId, roomId });
    } catch (revokeError) {
      console.error("Lỗi khi đóng phiên Socket.IO của phòng bị xóa:", revokeError);
    }
  }
}

async function ensureRoomLabelManager(
  db: PrismaClient,
  workspaceId: string,
  roomId: string,
  userId: string,
) {
  const membership = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
  const isOwner = membership?.role === WorkspaceRole.OWNER;
  const hostAccess = !isOwner && membership ? await isRoomHost(workspaceId, roomId, userId, db) : false;
  if (!membership || (!isOwner && !hostAccess)) {
    throw new WorkspaceServiceError(403, "Chỉ chủ Workspace hoặc chủ phòng được quản lý nhãn.");
  }
}

export async function createRoomLabel(
  db: PrismaClient,
  workspaceId: string,
  roomId: string,
  userId: string,
  input: { name: string; color: string; priority: number },
) {
  await ensureRoomLabelManager(db, workspaceId, roomId, userId);

  const room = await db.room.findFirst({ where: { id: roomId, workspaceId }, select: { id: true } });
  if (!room) {
    throw new WorkspaceServiceError(404, "Không tìm thấy phòng.");
  }

  const existingLabels = await db.roomLabel.findMany({
    where: { workspaceId, roomId },
    select: { id: true, name: true },
  });
  if (existingLabels.some((item) => item.name.toLocaleLowerCase() === input.name.toLocaleLowerCase())) {
    throw new WorkspaceServiceError(409, "Tên nhãn đã có trong phòng.");
  }

  const label = await db.roomLabel.create({
    data: { workspaceId, roomId, name: input.name, color: input.color, priority: input.priority },
  });
  return { label };
}

export async function updateRoomLabel(
  db: PrismaClient,
  workspaceId: string,
  roomId: string,
  labelId: string,
  userId: string,
  input: { name: string; color: string; priority: number },
) {
  await ensureRoomLabelManager(db, workspaceId, roomId, userId);

  const existingLabel = await db.roomLabel.findFirst({ where: { id: labelId, roomId, workspaceId } });
  if (!existingLabel) {
    throw new WorkspaceServiceError(404, "Không tìm thấy nhãn.");
  }

  const siblingLabels = await db.roomLabel.findMany({
    where: { workspaceId, roomId, NOT: { id: labelId } },
    select: { name: true },
  });
  if (siblingLabels.some((item) => item.name.toLocaleLowerCase() === input.name.toLocaleLowerCase())) {
    throw new WorkspaceServiceError(409, "Tên nhãn đã có trong phòng.");
  }

  const label = await db.roomLabel.update({
    where: { id: labelId },
    data: { name: input.name, color: input.color, priority: input.priority },
  });
  return { label };
}

export async function deleteRoomLabel(
  db: PrismaClient,
  workspaceId: string,
  roomId: string,
  labelId: string,
  userId: string,
) {
  await ensureRoomLabelManager(db, workspaceId, roomId, userId);

  const existingLabel = await db.roomLabel.findFirst({ where: { id: labelId, roomId, workspaceId } });
  if (!existingLabel) {
    throw new WorkspaceServiceError(404, "Không tìm thấy nhãn.");
  }

  await db.roomLabel.delete({ where: { id: labelId } });
  const assignedMembers = await db.roomMember.findMany({
    where: { workspaceId, roomId, labelIds: { has: labelId } },
  });
  await Promise.all(
    assignedMembers.map((member) =>
      db.roomMember.update({
        where: { workspaceId_roomId_userId: { workspaceId, roomId, userId: member.userId } },
        data: { labelIds: member.labelIds.filter((id) => id !== labelId) },
      }),
    ),
  );

  return { deleted: true };
}
