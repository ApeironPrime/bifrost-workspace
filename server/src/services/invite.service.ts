import crypto from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client.js";
import { WorkspaceRole } from "../generated/prisma/enums.js";
import { createMailerFromEnv, type TransactionalMailer } from "../lib/mailer.js";

export class InviteServiceError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const defaultMailer = createMailerFromEnv();

function hashInviteToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

function resolveClientBaseUrl(): string {
  return (process.env.CLIENT_URL ?? "http://localhost:5173").replace(/\/+$/, "");
}

export async function listWorkspaceInvites(
  db: PrismaClient,
  workspaceId: string,
  actorUserId: string,
) {
  const owner = await db.workspaceMember.findFirst({
    where: { workspaceId, userId: actorUserId, role: WorkspaceRole.OWNER },
  });
  if (!owner) {
    throw new InviteServiceError(403, "Chỉ Chủ không gian làm việc mới xem được lời mời.");
  }

  const invites = await db.workspaceInvite.findMany({
    where: { workspaceId, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      workspaceId: true,
      invitedEmail: true,
      maxUses: true,
      useCount: true,
      expiresAt: true,
      createdAt: true,
    },
  });

  return { invites };
}

export async function createWorkspaceInvite(
  db: PrismaClient,
  params: {
    workspaceId: string;
    actorUserId: string;
    email?: string;
    maxUses?: number;
    ttlDays?: number;
    clientBaseUrl?: string;
  },
  mailer: TransactionalMailer = defaultMailer,
) {
  const membership = await db.workspaceMember.findFirst({
    where: { workspaceId: params.workspaceId, userId: params.actorUserId, role: WorkspaceRole.OWNER },
    include: {
      workspace: { select: { id: true, name: true } },
      user: { select: { id: true, name: true } },
    },
  });
  if (!membership) {
    throw new InviteServiceError(403, "Chỉ Chủ không gian làm việc mới có thể tạo lời mời.");
  }

  const normalizedEmail = params.email?.trim().toLowerCase() || null;
  const ttlDays = Math.min(Math.max(params.ttlDays ?? 7, 1), 30);
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  const rawToken = crypto.randomBytes(24).toString("base64url");
  const tokenHash = hashInviteToken(rawToken);

  const invite = await db.workspaceInvite.create({
    data: {
      workspaceId: params.workspaceId,
      createdById: params.actorUserId,
      tokenHash,
      invitedEmail: normalizedEmail,
      maxUses: params.maxUses ?? (normalizedEmail ? 1 : null),
      expiresAt,
    },
    select: {
      id: true,
      workspaceId: true,
      invitedEmail: true,
      maxUses: true,
      useCount: true,
      expiresAt: true,
      createdAt: true,
    },
  });

  const baseUrl = (params.clientBaseUrl || resolveClientBaseUrl()).replace(/\/+$/, "");
  const inviteUrl = `${baseUrl}/#invite=${rawToken}`;

  if (normalizedEmail) {
    await mailer.sendWorkspaceInviteEmail({
      to: normalizedEmail,
      workspaceName: membership.workspace.name,
      inviterName: membership.user.name,
      inviteUrl,
    });
  }

  return {
    invite,
    inviteToken: rawToken,
    inviteUrl,
  };
}

export async function revokeWorkspaceInvite(
  db: PrismaClient,
  workspaceId: string,
  inviteId: string,
  actorUserId: string,
) {
  const owner = await db.workspaceMember.findFirst({
    where: { workspaceId, userId: actorUserId, role: WorkspaceRole.OWNER },
  });
  if (!owner) {
    throw new InviteServiceError(403, "Chỉ Chủ không gian làm việc mới có thể thu hồi lời mời.");
  }

  const updated = await db.workspaceInvite.updateMany({
    where: { id: inviteId, workspaceId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (updated.count === 0) {
    throw new InviteServiceError(404, "Không tìm thấy lời mời.");
  }
}

function assertInviteUsable(invite: {
  revokedAt: Date | null;
  expiresAt: Date;
  maxUses: number | null;
  useCount: number;
} | null): asserts invite is NonNullable<typeof invite> {
  if (!invite) {
    throw new InviteServiceError(404, "Liên kết mời không tồn tại hoặc không hợp lệ.");
  }
  if (invite.revokedAt) {
    throw new InviteServiceError(410, "Liên kết mời này đã bị thu hồi.");
  }
  if (invite.expiresAt <= new Date()) {
    throw new InviteServiceError(410, "Liên kết mời này đã hết hạn.");
  }
  if (invite.maxUses !== null && invite.useCount >= invite.maxUses) {
    throw new InviteServiceError(410, "Liên kết mời này đã đạt giới hạn lượt tham gia.");
  }
}

export async function getPublicInviteInfo(db: PrismaClient, rawToken: string) {
  const invite = await db.workspaceInvite.findUnique({
    where: { tokenHash: hashInviteToken(rawToken) },
    include: {
      workspace: { select: { id: true, name: true } },
      createdBy: { select: { name: true } },
    },
  });
  assertInviteUsable(invite);

  return {
    invite: {
      workspaceId: invite.workspace.id,
      workspaceName: invite.workspace.name,
      inviterName: invite.createdBy.name,
      invitedEmail: invite.invitedEmail,
      expiresAt: invite.expiresAt.toISOString(),
    },
  };
}

export async function acceptWorkspaceInvite(
  db: PrismaClient,
  rawToken: string,
  user: { id: string; email: string },
) {
  const invite = await db.workspaceInvite.findUnique({
    where: { tokenHash: hashInviteToken(rawToken) },
    include: {
      workspace: { select: { id: true, name: true, slug: true } },
    },
  });
  assertInviteUsable(invite);

  if (invite.invitedEmail && invite.invitedEmail.toLowerCase() !== user.email.toLowerCase()) {
    throw new InviteServiceError(
      403,
      `Lời mời này chỉ dành cho địa chỉ email ${invite.invitedEmail}.`,
    );
  }

  const membership = await db.$transaction(async (tx) => {
    const existing = await tx.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId: user.id } },
    });
    if (existing) {
      return existing;
    }

    const created = await tx.workspaceMember.create({
      data: {
        workspaceId: invite.workspaceId,
        userId: user.id,
        role: WorkspaceRole.MEMBER,
      },
    });
    await tx.workspaceInvite.update({
      where: { id: invite.id },
      data: { useCount: { increment: 1 } },
    });
    return created;
  });

  return {
    workspace: {
      ...invite.workspace,
      role: membership.role,
    },
  };
}
