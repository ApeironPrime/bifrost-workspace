import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client.js";
import {
  AuthServiceError,
  changeUserPassword,
  completeUserProfile,
  getCurrentUser,
  loginUser,
  logoutUserSession,
  refreshUserSession,
  registerUser,
  updateUserMe,
} from "../services/auth.service.js";

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

function handleAuthError(error: unknown, response: Response, next: NextFunction) {
  if (error instanceof AuthServiceError) {
    response.status(error.status).json({ message: error.message });
    return;
  }
  next(error);
}

export function createAuthController(db: PrismaClient) {
  return {
    register: async (request: Request, response: Response, next: NextFunction) => {
      try {
        const input = registerSchema.parse(request.body);
        const result = await registerUser(db, input);
        response.status(201).json(result);
      } catch (error) {
        handleAuthError(error, response, next);
      }
    },

    login: async (request: Request, response: Response, next: NextFunction) => {
      try {
        const input = credentialsSchema.parse(request.body);
        const result = await loginUser(db, input);
        response.json(result);
      } catch (error) {
        handleAuthError(error, response, next);
      }
    },

    refresh: async (request: Request, response: Response, next: NextFunction) => {
      try {
        const input = refreshSchema.parse(request.body);
        const result = await refreshUserSession(db, input.refreshToken);
        response.json(result);
      } catch (error) {
        handleAuthError(error, response, next);
      }
    },

    logout: async (request: Request, response: Response, next: NextFunction) => {
      try {
        const parsed = logoutSchema.safeParse(request.body ?? {});
        await logoutUserSession(db, parsed.success ? parsed.data.refreshToken : undefined);
        response.status(204).send();
      } catch (error) {
        handleAuthError(error, response, next);
      }
    },

    changePassword: async (request: Request, response: Response, next: NextFunction) => {
      try {
        const input = changePasswordSchema.parse(request.body);
        const result = await changeUserPassword(db, request.user!.id, input);
        response.json(result);
      } catch (error) {
        handleAuthError(error, response, next);
      }
    },

    me: async (request: Request, response: Response, next: NextFunction) => {
      try {
        const result = await getCurrentUser(db, request.user!.id);
        response.json(result);
      } catch (error) {
        handleAuthError(error, response, next);
      }
    },

    updateMe: async (request: Request, response: Response, next: NextFunction) => {
      try {
        const input = profileSchema.parse(request.body);
        const hasAvatar = Object.prototype.hasOwnProperty.call(request.body ?? {}, "avatarDataUrl");
        const result = await updateUserMe(db, request.user!.id, {
          name: input.name,
          hasAvatar,
          avatarDataUrl: input.avatarDataUrl,
        });
        response.json(result);
      } catch (error) {
        handleAuthError(error, response, next);
      }
    },

    completeProfile: async (request: Request, response: Response, next: NextFunction) => {
      try {
        const input = profileSchema.parse(request.body);
        const hasAvatar = Object.prototype.hasOwnProperty.call(request.body ?? {}, "avatarDataUrl");
        const result = await completeUserProfile(db, request.user!.id, {
          name: input.name,
          hasAvatar,
          avatarDataUrl: input.avatarDataUrl,
        });
        response.json(result);
      } catch (error) {
        handleAuthError(error, response, next);
      }
    },
  };
}
