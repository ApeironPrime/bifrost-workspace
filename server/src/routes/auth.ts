import { Router } from "express";
import bcrypt from "bcrypt";
import { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client.js";
import {
  createAccessToken,
  createOpaqueRefreshToken,
  hashRefreshToken,
  refreshTokenExpiresAt,
} from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";
import { getAuthRateLimiters } from "../lib/rateLimit.js";
import { requireAuth } from "../middleware/auth.js";

const credentialsSchema = z.object({
  email: z.string().trim().email("Email không hợp lệ.").max(254),
  password: z.string().min(8, "Mật khẩu cần ít nhất 8 ký tự.").max(100),
});

const registerSchema = credentialsSchema.extend({
  name: z.string().trim().min(2, "Tên cần ít nhất 2 ký tự.").max(100),
});

const profileSchema = z.object({
  name: z.string().trim().min(2, "Tên cần ít nhất 2 ký tự.").max(100),
  avatarDataUrl: z.unknown().optional(),
});

const refreshSchema = z.object({
  refreshToken: z.string().trim().min(32, "Refresh token không hợp lệ.").max(512),
});

const logoutSchema = z.object({
  refreshToken: z.string().trim().min(1).max(512).optional(),
});

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(8, "Mật khẩu hiện tại cần ít nhất 8 ký tự.").max(100),
    newPassword: z.string().min(8, "Mật khẩu mới cần ít nhất 8 ký tự.").max(100),
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: "Mật khẩu mới cần khác mật khẩu hiện tại.",
  });

class InvalidAvatarError extends Error {
  constructor(message: string) {
    super(message);
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
    throw new InvalidAvatarError("Avatar không hợp lệ hoặc quá lớn.");
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
    throw new InvalidAvatarError("Avatar cần là ảnh JPEG hợp lệ.");
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

function publicUser(user: UserWithOptionalProfile) {
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

export function createAuthRouter(db: PrismaClient = prisma) {
  const router = Router();

  router.post("/register", async (request, response, next) => {
    try {
      const input = registerSchema.parse(request.body);
      const email = input.email.toLowerCase();
      const existingUser = await db.user.findUnique({ where: { email } });
      if (existingUser) {
        response.status(409).json({ message: "Email này đã được sử dụng." });
        return;
      }

      const passwordHash = await bcrypt.hash(input.password, 12);
      const user = await db.user.create({
        data: { name: input.name, email, passwordHash },
        include: { profile: true },
      });
      const refreshToken = await issueRefreshToken(db, user.id);
      response.status(201).json({
        token: createAccessToken(user),
        refreshToken,
        user: publicUser(user),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/login", getAuthRateLimiters().loginAccountLimiter, async (request, response, next) => {
    try {
      const input = credentialsSchema.parse(request.body);
      const user = await db.user.findUnique({
        where: { email: input.email.toLowerCase() },
        include: { profile: true },
      });
      if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
        response.status(401).json({ message: "Email hoặc mật khẩu không đúng." });
        return;
      }

      const refreshToken = await issueRefreshToken(db, user.id);
      response.json({
        token: createAccessToken(user),
        refreshToken,
        user: publicUser(user),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/refresh", async (request, response, next) => {
    try {
      const input = refreshSchema.parse(request.body);
      const tokenHash = hashRefreshToken(input.refreshToken);
      const existing = await db.refreshToken.findUnique({
        where: { tokenHash },
        include: { user: { include: { profile: true } } },
      });

      if (!existing) {
        response.status(401).json({ message: "Phiên làm mới không hợp lệ hoặc đã hết hạn." });
        return;
      }

      if (existing.revokedAt !== null) {
        // Replay detected: revoke all active refresh tokens for this user.
        await db.refreshToken.updateMany({
          where: { userId: existing.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        response.status(401).json({ message: "Phiên đăng nhập đã bị thu hồi. Vui lòng đăng nhập lại." });
        return;
      }

      if (existing.expiresAt <= new Date()) {
        response.status(401).json({ message: "Phiên làm mới đã hết hạn. Vui lòng đăng nhập lại." });
        return;
      }

      await db.refreshToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date() },
      });
      const nextRefreshToken = await issueRefreshToken(db, existing.userId);
      response.json({
        token: createAccessToken(existing.user),
        refreshToken: nextRefreshToken,
        user: publicUser(existing.user),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/logout", async (request, response, next) => {
    try {
      const parsed = logoutSchema.safeParse(request.body ?? {});
      if (parsed.success && parsed.data.refreshToken) {
        await db.refreshToken.updateMany({
          where: { tokenHash: hashRefreshToken(parsed.data.refreshToken), revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  router.post("/change-password", requireAuth, async (request, response, next) => {
    try {
      const input = changePasswordSchema.parse(request.body);
      const user = await db.user.findUnique({
        where: { id: request.user!.id },
        include: { profile: true },
      });
      if (!user) {
        response.status(404).json({ message: "Không tìm thấy người dùng." });
        return;
      }

      const validCurrent = await bcrypt.compare(input.currentPassword, user.passwordHash);
      if (!validCurrent) {
        response.status(400).json({ message: "Mật khẩu hiện tại không đúng." });
        return;
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

      response.json({
        token: createAccessToken(user),
        refreshToken: nextRefreshToken,
        user: publicUser(user),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/me", requireAuth, async (request, response, next) => {
    try {
      const user = await db.user.findUnique({
        where: { id: request.user!.id },
        include: { profile: true },
      });
      if (!user) {
        response.status(404).json({ message: "Không tìm thấy người dùng." });
        return;
      }
      response.json({ user: publicUser(user) });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/me", requireAuth, async (request, response, next) => {
    try {
      const input = profileSchema.parse(request.body);
      const hasAvatar = Object.prototype.hasOwnProperty.call(request.body ?? {}, "avatarDataUrl");
      const validatedAvatar = hasAvatar ? validateAvatarDataUrl(input.avatarDataUrl) : undefined;

      if (hasAvatar && db.userProfile) {
        await db.userProfile.upsert({
          where: { userId: request.user!.id },
          create: { userId: request.user!.id, avatarDataUrl: validatedAvatar ?? null },
          update: { avatarDataUrl: validatedAvatar ?? null },
        });
      }

      const user = await db.user.update({
        where: { id: request.user!.id },
        data: { name: input.name },
        include: { profile: true },
      });
      response.json({ user: publicUser(user) });
    } catch (error) {
      if (error instanceof InvalidAvatarError) {
        response.status(400).json({ message: error.message });
        return;
      }
      next(error);
    }
  });

  router.patch("/profile", requireAuth, async (request, response, next) => {
    try {
      const input = profileSchema.parse(request.body);
      const hasAvatar = Object.prototype.hasOwnProperty.call(request.body ?? {}, "avatarDataUrl");
      const validatedAvatar = hasAvatar ? validateAvatarDataUrl(input.avatarDataUrl) : undefined;

      if (db.userProfile) {
        const existingProfile = await db.userProfile.findUnique({
          where: { userId: request.user!.id },
        });
        await db.userProfile.upsert({
          where: { userId: request.user!.id },
          create: {
            userId: request.user!.id,
            avatarDataUrl: hasAvatar ? (validatedAvatar ?? null) : null,
          },
          update: {
            avatarDataUrl: hasAvatar
              ? (validatedAvatar ?? null)
              : (existingProfile?.avatarDataUrl ?? null),
          },
        });
      }

      const user = await db.user.update({
        where: { id: request.user!.id },
        data: { name: input.name },
        include: { profile: true },
      });
      response.json({ user: publicUser(user) });
    } catch (error) {
      if (error instanceof InvalidAvatarError) {
        response.status(400).json({ message: error.message });
        return;
      }
      next(error);
    }
  });

  return router;
}

export const authRouter = createAuthRouter();
