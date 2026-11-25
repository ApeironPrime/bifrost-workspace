import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client.js";
import { verifyAccessToken } from "../lib/auth.js";
import {
  REFRESH_COOKIE_NAME,
  isSecureCookieRequest,
  parseCookies,
  serializeClearRefreshCookie,
  serializeRefreshCookie,
} from "../lib/cookies.js";
import {
  OAUTH_NONCE_COOKIE_NAME,
  buildOAuthAuthorizeUrl,
  createOAuthStateToken,
  exchangeOAuthCodeForProfile,
  getConfiguredOAuthProviders,
  verifyOAuthStateToken,
  type OAuthProvider,
} from "../lib/oauth.js";
import {
  AuthServiceError,
  authenticateOAuthUser,
  changeUserPassword,
  completeUserProfile,
  disableTwoFactor,
  enableTwoFactor,
  getCurrentUser,
  loginUser,
  logoutUserSession,
  refreshUserSession,
  registerUser,
  requestPasswordReset,
  resendVerificationEmail,
  resetPasswordWithCode,
  setupTwoFactor,
  updateUserMe,
  verifyTwoFactorLogin,
  verifyUserEmail,
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

const verifyEmailSchema = z
  .object({
    token: z.string().trim().min(16).max(256).optional(),
    email: z.string().trim().email().max(254).optional(),
    code: z.string().trim().regex(/^\d{6}$/, "Mã OTP cần gồm 6 chữ số.").optional(),
  })
  .refine((data) => Boolean(data.token || data.code), {
    message: "Vui lòng nhập mã OTP hoặc liên kết xác minh.",
  });

const forgotPasswordSchema = z.object({
  email: z.string().trim().email("Email không hợp lệ.").max(254),
});

const resetPasswordSchema = z
  .object({
    token: z.string().trim().min(16).max(256).optional(),
    email: z.string().trim().email().max(254).optional(),
    code: z.string().trim().regex(/^\d{6}$/, "Mã OTP cần gồm 6 chữ số.").optional(),
    newPassword: z.string().min(8, "Mật khẩu mới cần ít nhất 8 ký tự.").max(100),
  })
  .refine((data) => Boolean(data.token || (data.email && data.code)), {
    message: "Vui lòng cung cấp email và mã OTP 6 chữ số.",
  });

const twoFactorVerifySchema = z.object({
  challengeToken: z.string().trim().min(16).max(1024),
  code: z.string().trim().min(6, "Mã xác thực cần ít nhất 6 ký tự.").max(32),
});

const twoFactorCodeSchema = z.object({
  code: z.string().trim().min(6, "Mã xác thực cần ít nhất 6 ký tự.").max(32),
});

function parseOAuthProvider(raw: string | string[] | undefined): OAuthProvider | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "google" || value === "github" ? value : null;
}

function resolveClientOrigin(): string {
  return (process.env.CLIENT_URL ?? "http://localhost:5173").replace(/\/+$/, "");
}

function serializeOAuthNonceCookie(nonce: string, secure: boolean, maxAge = 600): string {
  return [
    `${OAUTH_NONCE_COOKIE_NAME}=${encodeURIComponent(nonce)}`,
    "Path=/api/auth/oauth",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

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
        if ("refreshToken" in result && result.refreshToken) {
          response.setHeader(
            "Set-Cookie",
            serializeRefreshCookie(result.refreshToken, {
              secure: isSecureCookieRequest(request),
            }),
          );
        }
        response.status(201).json(result);
      } catch (error) {
        handleAuthError(error, response, next);
      }
    },

    login: async (request: Request, response: Response, next: NextFunction) => {
      try {
        const input = credentialsSchema.parse(request.body);
        const result = await loginUser(db, input);
        if ("refreshToken" in result && result.refreshToken) {
          response.setHeader(
            "Set-Cookie",
            serializeRefreshCookie(result.refreshToken, {
              secure: isSecureCookieRequest(request),
            }),
          );
        }
        response.json(result);
      } catch (error) {
        handleAuthError(error, response, next);
      }
    },

    refresh: async (request: Request, response: Response, next: NextFunction) => {
      try {
        const cookies = parseCookies(request.headers.cookie);
        const candidateToken =
          typeof request.body?.refreshToken === "string" && request.body.refreshToken.trim()
            ? request.body.refreshToken
            : cookies[REFRESH_COOKIE_NAME];
        const input = refreshSchema.parse({ refreshToken: candidateToken });
        const result = await refreshUserSession(db, input.refreshToken);
        if (result.refreshToken) {
          response.setHeader(
            "Set-Cookie",
            serializeRefreshCookie(result.refreshToken, {
              secure: isSecureCookieRequest(request),
            }),
          );
        }
        response.json(result);
      } catch (error) {
        handleAuthError(error, response, next);
      }
    },

    logout: async (request: Request, response: Response, next: NextFunction) => {
      try {
        const cookies = parseCookies(request.headers.cookie);
        const parsed = logoutSchema.safeParse(request.body ?? {});
        const refreshToken =
          (parsed.success ? parsed.data.refreshToken : undefined) ?? cookies[REFRESH_COOKIE_NAME];
        await logoutUserSession(db, refreshToken);
        response.setHeader(
          "Set-Cookie",
          serializeClearRefreshCookie({
            secure: isSecureCookieRequest(request),
          }),
        );
        response.status(204).send();
      } catch (error) {
        handleAuthError(error, response, next);
      }
    },

    changePassword: async (request: Request, response: Response, next: NextFunction) => {
      try {
        const input = changePasswordSchema.parse(request.body);
        const result = await changeUserPassword(db, request.user!.id, input);
        if (result.refreshToken) {
          response.setHeader(
            "Set-Cookie",
            serializeRefreshCookie(result.refreshToken, {
              secure: isSecureCookieRequest(request),
            }),
          );
        }
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

    verifyEmail: async (request: Request, response: Response, next: NextFunction) => {
      try {
        const input = verifyEmailSchema.parse(request.body);
        let authUserId: string | undefined;
        const header = request.headers.authorization;
        if (header?.startsWith("Bearer ")) {
          try {
            authUserId = verifyAccessToken(header.slice(7).trim()).id;
          } catch {
            // Optional bearer token for OTP verification
          }
        }
        const result = await verifyUserEmail(db, { ...input, userId: authUserId });
        response.json(result);
      } catch (error) {
        handleAuthError(error, response, next);
      }
    },

    resendVerification: async (request: Request, response: Response, next: NextFunction) => {
      try {
        response.json(await resendVerificationEmail(db, request.user!.id));
      } catch (error) {
        handleAuthError(error, response, next);
      }
    },

    forgotPassword: async (request: Request, response: Response, next: NextFunction) => {
      try {
        const input = forgotPasswordSchema.parse(request.body);
        response.json(await requestPasswordReset(db, input.email));
      } catch (error) {
        handleAuthError(error, response, next);
      }
    },

    resetPassword: async (request: Request, response: Response, next: NextFunction) => {
      try {
        const input = resetPasswordSchema.parse(request.body);
        response.json(await resetPasswordWithCode(db, input));
      } catch (error) {
        handleAuthError(error, response, next);
      }
    },

    verifyTwoFactor: async (request: Request, response: Response, next: NextFunction) => {
      try {
        const input = twoFactorVerifySchema.parse(request.body);
        const result = await verifyTwoFactorLogin(db, input);
        if (result.refreshToken) {
          response.setHeader(
            "Set-Cookie",
            serializeRefreshCookie(result.refreshToken, {
              secure: isSecureCookieRequest(request),
            }),
          );
        }
        response.json(result);
      } catch (error) {
        handleAuthError(error, response, next);
      }
    },

    setupTwoFactor: async (request: Request, response: Response, next: NextFunction) => {
      try {
        response.json(await setupTwoFactor(db, request.user!.id));
      } catch (error) {
        handleAuthError(error, response, next);
      }
    },

    enableTwoFactor: async (request: Request, response: Response, next: NextFunction) => {
      try {
        const input = twoFactorCodeSchema.parse(request.body);
        response.json(await enableTwoFactor(db, request.user!.id, input.code));
      } catch (error) {
        handleAuthError(error, response, next);
      }
    },

    disableTwoFactor: async (request: Request, response: Response, next: NextFunction) => {
      try {
        const input = twoFactorCodeSchema.parse(request.body);
        response.json(await disableTwoFactor(db, request.user!.id, input.code));
      } catch (error) {
        handleAuthError(error, response, next);
      }
    },

    oauthProviders: (_request: Request, response: Response) => {
      response.json({ providers: getConfiguredOAuthProviders() });
    },

    oauthStart: (request: Request, response: Response) => {
      const provider = parseOAuthProvider(request.params.provider);
      const clientOrigin = resolveClientOrigin();
      if (!provider) {
        response.redirect(`${clientOrigin}/#oauth_error=unsupported_provider`);
        return;
      }

      const nonce = crypto.randomBytes(16).toString("hex");
      const inviteToken =
        typeof request.query.invite === "string" && request.query.invite.trim()
          ? request.query.invite.trim()
          : undefined;
      const state = createOAuthStateToken({ provider, nonce, inviteToken });
      const authorizeUrl = buildOAuthAuthorizeUrl(provider, state);
      if (!authorizeUrl) {
        response.redirect(`${clientOrigin}/#oauth_error=unconfigured&provider=${provider}`);
        return;
      }

      response.setHeader(
        "Set-Cookie",
        serializeOAuthNonceCookie(nonce, isSecureCookieRequest(request), 600),
      );
      response.redirect(authorizeUrl);
    },

    oauthCallback: async (request: Request, response: Response) => {
      const provider = parseOAuthProvider(request.params.provider);
      const clientOrigin = resolveClientOrigin();
      const secure = isSecureCookieRequest(request);
      const code = typeof request.query.code === "string" ? request.query.code : "";
      const rawState = typeof request.query.state === "string" ? request.query.state : "";

      if (!provider || !code || !rawState) {
        response.redirect(`${clientOrigin}/#oauth_error=invalid_callback`);
        return;
      }

      try {
        const cookies = parseCookies(request.headers.cookie);
        const statePayload = verifyOAuthStateToken(rawState);
        if (statePayload.provider !== provider || cookies[OAUTH_NONCE_COOKIE_NAME] !== statePayload.nonce) {
          response.redirect(`${clientOrigin}/#oauth_error=invalid_state`);
          return;
        }

        const profile = await exchangeOAuthCodeForProfile(provider, code);
        const session = await authenticateOAuthUser(db, profile);
        response.setHeader("Set-Cookie", [
          serializeRefreshCookie(session.refreshToken, { secure }),
          serializeOAuthNonceCookie("", secure, 0),
        ]);
        const inviteSuffix = statePayload.inviteToken
          ? `&invite=${encodeURIComponent(statePayload.inviteToken)}`
          : "";
        response.redirect(`${clientOrigin}/#oauth_success=1${inviteSuffix}`);
      } catch {
        response.setHeader("Set-Cookie", serializeOAuthNonceCookie("", secure, 0));
        response.redirect(`${clientOrigin}/#oauth_error=oauth_failed`);
      }
    },
  };
}
