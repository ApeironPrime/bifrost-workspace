import { createHash, randomBytes } from "node:crypto";
import jwt, { type SignOptions } from "jsonwebtoken";

export type AuthUser = {
  id: string;
  email: string;
};

function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET chưa được cấu hình.");
  return secret;
}

export function createAccessToken(user: AuthUser) {
  const expiresIn = (process.env.JWT_ACCESS_EXPIRES_IN ?? "15m") as SignOptions["expiresIn"];
  return jwt.sign({ email: user.email }, jwtSecret(), {
    subject: user.id,
    expiresIn,
  });
}

export function verifyAccessToken(token: string): AuthUser {
  const payload = jwt.verify(token, jwtSecret());
  if (typeof payload === "string" || !payload.sub || typeof payload.email !== "string") {
    throw new Error("Token không hợp lệ.");
  }
  return { id: payload.sub, email: payload.email };
}

export function createOpaqueRefreshToken(): string {
  return randomBytes(48).toString("hex");
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function refreshTokenExpiresAt(nowMs: number = Date.now()): Date {
  const parsedDays = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? "30");
  const ttlDays = Number.isFinite(parsedDays) && parsedDays >= 1 ? Math.min(parsedDays, 365) : 30;
  return new Date(nowMs + ttlDays * 24 * 60 * 60 * 1000);
}
