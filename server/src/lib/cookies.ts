import type { Request } from "express";

export const REFRESH_COOKIE_NAME = "bifrost_rt";
const DEFAULT_REFRESH_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const cookies: Record<string, string> = {};
  for (const part of cookieHeader.split(";")) {
    const eqIndex = part.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = part.slice(0, eqIndex).trim();
    const rawValue = part.slice(eqIndex + 1).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(rawValue);
    } catch {
      cookies[key] = rawValue;
    }
  }
  return cookies;
}

export function isSecureCookieRequest(request: Request): boolean {
  if (request.secure) return true;
  const forwardedProto = request.headers["x-forwarded-proto"];
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  if (proto && proto.split(",")[0]?.trim().toLowerCase() === "https") {
    return true;
  }
  return false;
}

export function serializeRefreshCookie(
  token: string,
  options: { secure: boolean; maxAgeSeconds?: number },
): string {
  const maxAge = options.maxAgeSeconds ?? DEFAULT_REFRESH_MAX_AGE_SECONDS;
  const parts = [
    `${REFRESH_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/api/auth",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
  ];
  if (options.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function serializeClearRefreshCookie(options: { secure: boolean }): string {
  const parts = [
    `${REFRESH_COOKIE_NAME}=`,
    "Path=/api/auth",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (options.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}
