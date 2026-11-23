import bcrypt from "bcrypt";
import type { PrismaClient } from "../generated/prisma/client.js";
import {
  createAccessToken,
  createOpaqueRefreshToken,
  hashRefreshToken,
  refreshTokenExpiresAt,
} from "../lib/auth.js";

export class AuthServiceError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function validateAvatarDataUrl(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value === "string" && /^\/avatars\/notionist-0[1-8]\.svg$/.test(value)) {
    return value;
  }
  if (
    typeof value !== "string" ||
    value.length > 180000 ||
    !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(value)
  ) {
    throw new AuthServiceError(400, "Avatar không hợp lệ hoặc quá lớn.");
  }
  const base64 = value.split(",")[1] ?? "";
  const bytes = Buffer.from(base64, "base64");
  if (
    bytes.length < 4 ||
    bytes[0] !== 255 ||
    bytes[1] !== 216 ||
    bytes[bytes.length - 2] !== 255 ||
    bytes[bytes.length - 1] !== 217
  ) {
    throw new AuthServiceError(400, "Avatar cần là ảnh JPEG hợp lệ.");
  }
  return value;
}

interface UserWithOptionalProfile {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  profile?: {
    userId: string;
    avatarDataUrl: string | null;
    completedAt: Date;
    updatedAt: Date;
  } | null;
}

export function publicUser(user: UserWithOptionalProfile) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
    profile: user.profile
      ? {
          userId: user.profile.userId,
          avatarDataUrl: user.profile.avatarDataUrl,
          completedAt: user.profile.completedAt.toISOString(),
          updatedAt: user.profile.updatedAt.toISOString(),
        }
      : null,
  };
}

async function issueRefreshToken(db: PrismaClient, userId: string): Promise<string> {
  const rawToken = createOpaqueRefreshToken();
  await db.refreshToken.create({
    data: {
      userId,
      tokenHash: hashRefreshToken(rawToken),
      expiresAt: refreshTokenExpiresAt(),
    },
  });
  return rawToken;
}

export async function registerUser(
  db: PrismaClient,
  input: { name: string; email: string; password: string },
) {
  const email = input.email.toLowerCase();
  const existingUser = await db.user.findUnique({ where: { email } });
  if (existingUser) {
    throw new AuthServiceError(409, "Email này đã được sử dụng.");
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await db.user.create({
    data: { name: input.name, email, passwordHash },
    include: { profile: true },
  });
  const refreshToken = await issueRefreshToken(db, user.id);
  return {
    token: createAccessToken(user),
    refreshToken,
    user: publicUser(user),
  };
}

export async function loginUser(
  db: PrismaClient,
  input: { email: string; password: string },
) {
  const user = await db.user.findUnique({
    where: { email: input.email.toLowerCase() },
    include: { profile: true },
  });
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    throw new AuthServiceError(401, "Email hoặc mật khẩu không đúng.");
  }

  const refreshToken = await issueRefreshToken(db, user.id);
  return {
    token: createAccessToken(user),
    refreshToken,
    user: publicUser(user),
  };
}

export async function refreshUserSession(db: PrismaClient, rawRefreshToken: string) {
  const tokenHash = hashRefreshToken(rawRefreshToken);
  const existing = await db.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: { include: { profile: true } } },
  });

  if (!existing) {
    throw new AuthServiceError(401, "Phiên làm mới không hợp lệ hoặc đã hết hạn.");
  }

  if (existing.revokedAt !== null) {
    // Replay detected: revoke all active refresh tokens for this user.
    await db.refreshToken.updateMany({
      where: { userId: existing.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw new AuthServiceError(401, "Phiên đăng nhập đã bị thu hồi. Vui lòng đăng nhập lại.");
  }

  if (existing.expiresAt <= new Date()) {
    throw new AuthServiceError(401, "Phiên làm mới đã hết hạn. Vui lòng đăng nhập lại.");
  }

  await db.refreshToken.update({
    where: { id: existing.id },
    data: { revokedAt: new Date() },
  });
  const nextRefreshToken = await issueRefreshToken(db, existing.userId);
  return {
    token: createAccessToken(existing.user),
    refreshToken: nextRefreshToken,
    user: publicUser(existing.user),
  };
}

export async function logoutUserSession(db: PrismaClient, rawRefreshToken?: string) {
  if (!rawRefreshToken) return;
  await db.refreshToken.updateMany({
    where: { tokenHash: hashRefreshToken(rawRefreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function changeUserPassword(
  db: PrismaClient,
  userId: string,
  input: { currentPassword: string; newPassword: string },
) {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  });
  if (!user) {
    throw new AuthServiceError(404, "Không tìm thấy người dùng.");
  }

  const validCurrent = await bcrypt.compare(input.currentPassword, user.passwordHash);
  if (!validCurrent) {
    throw new AuthServiceError(400, "Mật khẩu hiện tại không đúng.");
  }

  const nextHash = await bcrypt.hash(input.newPassword, 12);
  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: nextHash },
  });
  await db.refreshToken.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  const nextRefreshToken = await issueRefreshToken(db, user.id);

  return {
    token: createAccessToken(user),
    refreshToken: nextRefreshToken,
    user: publicUser(user),
  };
}

export async function getCurrentUser(db: PrismaClient, userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  });
  if (!user) {
    throw new AuthServiceError(404, "Không tìm thấy người dùng.");
  }
  return { user: publicUser(user) };
}

export async function updateUserMe(
  db: PrismaClient,
  userId: string,
  input: { name: string; hasAvatar: boolean; avatarDataUrl?: unknown },
) {
  const validatedAvatar = input.hasAvatar ? validateAvatarDataUrl(input.avatarDataUrl) : undefined;
  if (input.hasAvatar && db.userProfile) {
    await db.userProfile.upsert({
      where: { userId },
      create: { userId, avatarDataUrl: validatedAvatar ?? null },
      update: { avatarDataUrl: validatedAvatar ?? null },
    });
  }

  const user = await db.user.update({
    where: { id: userId },
    data: { name: input.name },
    include: { profile: true },
  });
  return { user: publicUser(user) };
}

export async function completeUserProfile(
  db: PrismaClient,
  userId: string,
  input: { name: string; hasAvatar: boolean; avatarDataUrl?: unknown },
) {
  const validatedAvatar = input.hasAvatar ? validateAvatarDataUrl(input.avatarDataUrl) : undefined;
  if (db.userProfile) {
    const existingProfile = await db.userProfile.findUnique({ where: { userId } });
    await db.userProfile.upsert({
      where: { userId },
      create: {
        userId,
        avatarDataUrl: input.hasAvatar ? (validatedAvatar ?? null) : null,
      },
      update: {
        avatarDataUrl: input.hasAvatar
          ? (validatedAvatar ?? null)
          : (existingProfile?.avatarDataUrl ?? null),
      },
    });
  }

  const user = await db.user.update({
    where: { id: userId },
    data: { name: input.name },
    include: { profile: true },
  });
  return { user: publicUser(user) };
}
