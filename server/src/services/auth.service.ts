import crypto from "node:crypto";
import bcrypt from "bcrypt";
import type { PrismaClient } from "../generated/prisma/client.js";
import {
  createAccessToken,
  createOpaqueRefreshToken,
  createTwoFactorChallengeToken,
  hashRefreshToken,
  refreshTokenExpiresAt,
  verifyTwoFactorChallengeToken,
} from "../lib/auth.js";
import { createMailerFromEnv, type TransactionalMailer } from "../lib/mailer.js";
import type { OAuthUserProfile } from "../lib/oauth.js";
import {
  buildOtpAuthUri,
  consumeRecoveryCode,
  generateRecoveryCodes,
  generateTotpSecret,
  verifyTotpCode,
} from "../lib/totp.js";

const defaultMailer = createMailerFromEnv();

function hashVerificationSecret(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function generateSixDigitOtp(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

function resolveClientBaseUrl(): string {
  return (process.env.CLIENT_URL ?? "http://localhost:5173").replace(/\/+$/, "");
}

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
  emailVerifiedAt?: Date | null;
  totpEnabledAt?: Date | null;
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
    emailVerified: Boolean(user.emailVerifiedAt),
    twoFactorEnabled: Boolean(user.totpEnabledAt),
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

async function createVerificationRecord(
  db: PrismaClient,
  userId: string,
  purpose: "EMAIL_VERIFY" | "PASSWORD_RESET",
): Promise<{ rawToken: string; code: string }> {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const code = generateSixDigitOtp();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await db.verificationToken.updateMany({
    where: { userId, purpose, usedAt: null },
    data: { usedAt: new Date() },
  });
  await db.verificationToken.create({
    data: {
      userId,
      purpose,
      tokenHash: hashVerificationSecret(rawToken),
      codeHash: hashVerificationSecret(`${userId}:${purpose}:${code}`),
      expiresAt,
    },
  });

  return { rawToken, code };
}

export async function registerUser(
  db: PrismaClient,
  input: { name: string; email: string; password: string },
  mailer: TransactionalMailer = defaultMailer,
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

  let devVerificationCode: string | undefined;
  if (db.verificationToken) {
    const { rawToken, code } = await createVerificationRecord(db, user.id, "EMAIL_VERIFY");
    const verifyUrl = `${resolveClientBaseUrl()}/#verify_email=${rawToken}`;
    await mailer.sendVerificationEmail({ to: user.email, name: user.name, code, verifyUrl });
    if (mailer.exposeDevCode) {
      devVerificationCode = code;
    }
  }

  if (process.env.REQUIRE_EMAIL_VERIFICATION === "true") {
    return {
      requiresEmailVerification: true,
      user: publicUser(user),
      ...(devVerificationCode ? { devVerificationCode } : {}),
    };
  }

  const refreshToken = await issueRefreshToken(db, user.id);
  return {
    token: createAccessToken(user),
    refreshToken,
    user: publicUser(user),
    ...(devVerificationCode ? { devVerificationCode } : {}),
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

  if (user.totpEnabledAt && user.totpSecret) {
    return {
      requiresTwoFactor: true,
      challengeToken: createTwoFactorChallengeToken(user.id),
    };
  }

  const refreshToken = await issueRefreshToken(db, user.id);
  return {
    token: createAccessToken(user),
    refreshToken,
    user: publicUser(user),
  };
}

export async function verifyUserEmail(
  db: PrismaClient,
  input: { userId?: string; email?: string; code?: string; token?: string },
) {
  const now = new Date();
  let record: { id: string; userId: string } | null = null;

  if (input.token) {
    const found = await db.verificationToken.findUnique({
      where: { tokenHash: hashVerificationSecret(input.token.trim()) },
    });
    if (found && found.purpose === "EMAIL_VERIFY" && !found.usedAt && found.expiresAt > now) {
      record = found;
    }
  } else if (input.code) {
    let targetUserId = input.userId;
    if (!targetUserId && input.email) {
      const targetUser = await db.user.findUnique({
        where: { email: input.email.trim().toLowerCase() },
        select: { id: true },
      });
      targetUserId = targetUser?.id;
    }
    if (targetUserId) {
      const codeHash = hashVerificationSecret(
        `${targetUserId}:EMAIL_VERIFY:${input.code.trim()}`,
      );
      record = await db.verificationToken.findFirst({
        where: {
          userId: targetUserId,
          purpose: "EMAIL_VERIFY",
          codeHash,
          usedAt: null,
          expiresAt: { gt: now },
        },
        orderBy: { createdAt: "desc" },
      });
    }
  }

  if (!record) {
    throw new AuthServiceError(400, "Mã xác minh email không hợp lệ hoặc đã hết hạn.");
  }

  const [, updatedUser] = await db.$transaction([
    db.verificationToken.update({
      where: { id: record.id },
      data: { usedAt: now },
    }),
    db.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: now },
      include: { profile: true },
    }),
  ]);

  return { user: publicUser(updatedUser) };
}

export async function resendVerificationEmail(
  db: PrismaClient,
  userId: string,
  mailer: TransactionalMailer = defaultMailer,
) {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  });
  if (!user) {
    throw new AuthServiceError(404, "Không tìm thấy người dùng.");
  }
  if (user.emailVerifiedAt) {
    return { alreadyVerified: true, user: publicUser(user) };
  }

  const { rawToken, code } = await createVerificationRecord(db, user.id, "EMAIL_VERIFY");
  const verifyUrl = `${resolveClientBaseUrl()}/#verify_email=${rawToken}`;
  await mailer.sendVerificationEmail({ to: user.email, name: user.name, code, verifyUrl });
  return {
    sent: true,
    ...(mailer.exposeDevCode ? { devVerificationCode: code } : {}),
  };
}

export async function requestPasswordReset(
  db: PrismaClient,
  rawEmail: string,
  mailer: TransactionalMailer = defaultMailer,
) {
  const email = rawEmail.trim().toLowerCase();
  const user = await db.user.findUnique({ where: { email } });
  if (!user) {
    return { sent: true };
  }

  const { rawToken, code } = await createVerificationRecord(db, user.id, "PASSWORD_RESET");
  const resetUrl = `${resolveClientBaseUrl()}/#reset_token=${rawToken}`;
  await mailer.sendPasswordResetEmail({ to: user.email, name: user.name, code, resetUrl });
  return {
    sent: true,
    ...(mailer.exposeDevCode ? { devResetCode: code } : {}),
  };
}

export async function resetPasswordWithCode(
  db: PrismaClient,
  input: { email?: string; code?: string; token?: string; newPassword: string },
) {
  const now = new Date();
  let record: { id: string; userId: string } | null = null;

  if (input.token) {
    const found = await db.verificationToken.findUnique({
      where: { tokenHash: hashVerificationSecret(input.token.trim()) },
    });
    if (found && found.purpose === "PASSWORD_RESET" && !found.usedAt && found.expiresAt > now) {
      record = found;
    }
  } else if (input.email && input.code) {
    const user = await db.user.findUnique({
      where: { email: input.email.trim().toLowerCase() },
      select: { id: true },
    });
    if (user) {
      const codeHash = hashVerificationSecret(
        `${user.id}:PASSWORD_RESET:${input.code.trim()}`,
      );
      record = await db.verificationToken.findFirst({
        where: {
          userId: user.id,
          purpose: "PASSWORD_RESET",
          codeHash,
          usedAt: null,
          expiresAt: { gt: now },
        },
        orderBy: { createdAt: "desc" },
      });
    }
  }

  if (!record) {
    throw new AuthServiceError(400, "Mã đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.");
  }

  const nextHash = await bcrypt.hash(input.newPassword, 12);
  await db.$transaction([
    db.verificationToken.update({
      where: { id: record.id },
      data: { usedAt: now },
    }),
    db.user.update({
      where: { id: record.userId },
      data: { passwordHash: nextHash, emailVerifiedAt: now },
    }),
    db.refreshToken.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: now },
    }),
  ]);

  return { reset: true };
}

export async function verifyTwoFactorLogin(
  db: PrismaClient,
  input: { challengeToken: string; code: string },
) {
  let userId: string;
  try {
    userId = verifyTwoFactorChallengeToken(input.challengeToken).userId;
  } catch {
    throw new AuthServiceError(401, "Phiên xác thực 2 lớp đã hết hạn. Vui lòng đăng nhập lại.");
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  });
  if (!user || !user.totpEnabledAt || !user.totpSecret) {
    throw new AuthServiceError(401, "Tài khoản chưa bật xác thực 2 lớp.");
  }

  const totpValid = verifyTotpCode(user.totpSecret, input.code);
  if (!totpValid) {
    const recovery = consumeRecoveryCode(input.code, user.totpRecoveryHashes);
    if (!recovery.matched) {
      throw new AuthServiceError(401, "Mã xác thực 2 lớp không đúng.");
    }
    await db.user.update({
      where: { id: user.id },
      data: { totpRecoveryHashes: recovery.remainingHashes },
    });
  }

  const refreshToken = await issueRefreshToken(db, user.id);
  return {
    token: createAccessToken(user),
    refreshToken,
    user: publicUser(user),
  };
}

export async function setupTwoFactor(db: PrismaClient, userId: string) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new AuthServiceError(404, "Không tìm thấy người dùng.");
  }
  const secret = generateTotpSecret();
  await db.user.update({
    where: { id: user.id },
    data: { totpSecret: secret, totpEnabledAt: null },
  });
  return {
    secret,
    otpauthUri: buildOtpAuthUri({ secret, accountEmail: user.email }),
  };
}

export async function enableTwoFactor(db: PrismaClient, userId: string, code: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  });
  if (!user || !user.totpSecret) {
    throw new AuthServiceError(400, "Bạn cần khởi tạo mã bí mật 2FA trước.");
  }
  if (!verifyTotpCode(user.totpSecret, code)) {
    throw new AuthServiceError(400, "Mã OTP 6 chữ số không đúng.");
  }

  const { rawCodes, hashes } = generateRecoveryCodes();
  const updated = await db.user.update({
    where: { id: user.id },
    data: {
      totpEnabledAt: new Date(),
      totpRecoveryHashes: hashes,
    },
    include: { profile: true },
  });

  return {
    recoveryCodes: rawCodes,
    user: publicUser(updated),
  };
}

export async function disableTwoFactor(db: PrismaClient, userId: string, code: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  });
  if (!user || !user.totpEnabledAt || !user.totpSecret) {
    throw new AuthServiceError(400, "Xác thực 2 lớp chưa được bật.");
  }

  const totpValid = verifyTotpCode(user.totpSecret, code);
  const recovery = totpValid
    ? { matched: true }
    : consumeRecoveryCode(code, user.totpRecoveryHashes);
  if (!recovery.matched) {
    throw new AuthServiceError(400, "Mã OTP hoặc mã khôi phục không đúng.");
  }

  const updated = await db.user.update({
    where: { id: user.id },
    data: {
      totpSecret: null,
      totpEnabledAt: null,
      totpRecoveryHashes: [],
    },
    include: { profile: true },
  });
  return { user: publicUser(updated) };
}

export async function authenticateOAuthUser(db: PrismaClient, profile: OAuthUserProfile) {
  const existingLink = await db.oAuthAccount.findUnique({
    where: {
      provider_providerAccountId: {
        provider: profile.provider,
        providerAccountId: profile.providerAccountId,
      },
    },
    include: { user: { include: { profile: true } } },
  });

  let user = existingLink?.user ?? null;

  if (!user) {
    const existingByEmail = await db.user.findUnique({
      where: { email: profile.email.toLowerCase() },
      include: { profile: true },
    });

    if (existingByEmail) {
      if (!profile.emailVerified && !existingByEmail.emailVerifiedAt) {
        throw new AuthServiceError(
          409,
          "Email từ nhà cung cấp OAuth chưa được xác minh nên không thể tự động liên kết.",
        );
      }
      user = await db.user.update({
        where: { id: existingByEmail.id },
        data: {
          emailVerifiedAt: existingByEmail.emailVerifiedAt ?? new Date(),
          oauthAccounts: {
            create: {
              provider: profile.provider,
              providerAccountId: profile.providerAccountId,
              email: profile.email,
            },
          },
        },
        include: { profile: true },
      });
    } else {
      const randomPasswordHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 12);
      user = await db.user.create({
        data: {
          name: profile.name,
          email: profile.email.toLowerCase(),
          passwordHash: randomPasswordHash,
          emailVerifiedAt: profile.emailVerified ? new Date() : null,
          oauthAccounts: {
            create: {
              provider: profile.provider,
              providerAccountId: profile.providerAccountId,
              email: profile.email,
            },
          },
        },
        include: { profile: true },
      });
    }
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

import { createAvatarStorageFromEnv, type AvatarStorage } from "../lib/avatarStorage.js";

const defaultAvatarStorage = createAvatarStorageFromEnv();

async function persistAvatarIfNeeded(
  hasAvatar: boolean,
  avatarDataUrl: unknown,
  avatarStorage: AvatarStorage,
): Promise<string | null | undefined> {
  if (!hasAvatar) return undefined;
  const validatedAvatar = validateAvatarDataUrl(avatarDataUrl);
  if (!validatedAvatar) return null;
  try {
    return await avatarStorage.storeAvatar(validatedAvatar);
  } catch (error) {
    throw new AuthServiceError(
      400,
      error instanceof Error ? error.message : "Không thể lưu ảnh đại diện.",
    );
  }
}

export async function updateUserMe(
  db: PrismaClient,
  userId: string,
  input: { name: string; hasAvatar: boolean; avatarDataUrl?: unknown },
  avatarStorage: AvatarStorage = defaultAvatarStorage,
) {
  const storedAvatarUrl = await persistAvatarIfNeeded(
    input.hasAvatar,
    input.avatarDataUrl,
    avatarStorage,
  );
  if (input.hasAvatar && db.userProfile) {
    await db.userProfile.upsert({
      where: { userId },
      create: { userId, avatarDataUrl: storedAvatarUrl ?? null },
      update: { avatarDataUrl: storedAvatarUrl ?? null },
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
  avatarStorage: AvatarStorage = defaultAvatarStorage,
) {
  const storedAvatarUrl = await persistAvatarIfNeeded(
    input.hasAvatar,
    input.avatarDataUrl,
    avatarStorage,
  );
  if (db.userProfile) {
    const existingProfile = await db.userProfile.findUnique({ where: { userId } });
    await db.userProfile.upsert({
      where: { userId },
      create: {
        userId,
        avatarDataUrl: input.hasAvatar ? (storedAvatarUrl ?? null) : null,
      },
      update: {
        avatarDataUrl: input.hasAvatar
          ? (storedAvatarUrl ?? null)
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
