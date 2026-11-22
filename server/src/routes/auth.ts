import { Router } from "express";
import bcrypt from "bcrypt";
import { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client.js";
import { createAccessToken } from "../lib/auth.js";
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
      response.status(201).json({
        token: createAccessToken(user),
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

      response.json({ token: createAccessToken(user), user: publicUser(user) });
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
