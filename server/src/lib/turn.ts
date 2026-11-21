import { createHmac } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { MAX_SAFE_WINDOW_MS, parsePositiveIntSetting } from "./rateLimit.js";

export const DEFAULT_STUN_URLS = ["stun:stun.l.google.com:19302"] as const;
export const DEFAULT_TURN_TTL_SECONDS = 900;
export const MIN_TURN_TTL_SECONDS = 60;
export const MAX_TURN_TTL_SECONDS = 3600;
export const DEFAULT_TURN_RATE_LIMIT_MAX = 30;
export const DEFAULT_TURN_RATE_LIMIT_WINDOW_MS = 900_000;
export const TURN_RATE_LIMIT_MESSAGE =
  "Quá nhiều yêu cầu lấy cấu hình kết nối. Vui lòng thử lại sau ít phút.";

const TURN_SECRET_HEX_REGEX = /^[0-9a-fA-F]{64}$/;
const MAX_SECRET_FILE_BYTES = 512;

function hasSpaceOrControl(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f || /\s/.test(value[i])) {
      return true;
    }
  }
  return false;
}

export interface TurnIceServer {
  urls: string[];
  username?: string;
  credential?: string;
  credentialType?: "password";
}

export type TurnCredentialsResponse =
  | {
      iceServers: TurnIceServer[];
      expiresAt: number;
      ttlSeconds: number;
      turnEnabled: true;
    }
  | {
      iceServers: TurnIceServer[];
      expiresAt: null;
      ttlSeconds: 0;
      turnEnabled: false;
    };

export interface TurnPublicConfig {
  turnEnabled: boolean;
  stunUrls: string[];
  turnUrls: string[];
  ttlSeconds: number;
  rateLimitMax: number;
  rateLimitWindowMs: number;
  externalIp: string | null;
}

export interface TurnService {
  readonly config: TurnPublicConfig;
  issueForUser: (userId: string, nowMs?: number) => TurnCredentialsResponse;
}

export interface CreateTurnServiceOptions {
  stunUrls: string[];
  turnUrls: string[];
  ttlSeconds: number;
  rateLimitMax: number;
  rateLimitWindowMs: number;
  externalIp: string | null;
  sharedSecret: string | null;
}

function validateUserId(userId: unknown): string {
  if (
    typeof userId !== "string" ||
    userId.length === 0 ||
    userId.includes(":") ||
    hasSpaceOrControl(userId)
  ) {
    throw new Error("ID người dùng không hợp lệ để cấp TURN credential.");
  }
  return userId;
}

/**
 * Parses and validates comma-separated ICE server URLs (`stun:`/`stuns:` or `turn:`/`turns:`),
 * rejecting embedded credentials (`@`), whitespace/control characters, or internal-only host `turn`.
 */
export function parseIceUrlList(
  raw: string | undefined,
  allowedSchemes: readonly ("stun:" | "stuns:" | "turn:" | "turns:")[],
  envName: string,
): string[] {
  if (raw === undefined) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const entries = trimmed.split(",").map((entry) => entry.trim());
  if (entries.some((entry) => entry.length === 0)) {
    throw new Error(`${envName} không được chứa URL rỗng giữa các dấu phẩy.`);
  }

  for (const url of entries) {
    if (hasSpaceOrControl(url)) {
      throw new Error(`${envName} không được chứa khoảng trắng hoặc ký tự điều khiển.`);
    }

    const lower = url.toLowerCase();
    const matchedScheme = allowedSchemes.find((scheme) => lower.startsWith(scheme));
    if (!matchedScheme) {
      throw new Error(`${envName} chỉ chấp nhận URL dạng ${allowedSchemes.join(", ")}.`);
    }

    const withoutScheme = url.slice(matchedScheme.length);
    if (!withoutScheme || withoutScheme.startsWith("//")) {
      throw new Error(`${envName} chứa TURN/STUN URI không hợp lệ: ${url}`);
    }

    const [authorityAndHost, queryString] = withoutScheme.split("?");
    if (authorityAndHost.includes("@")) {
      throw new Error(`${envName} không được nhúng username/password trực tiếp trong URL.`);
    }

    if (queryString && /(^|&)(secret|credential|password)=/i.test(queryString)) {
      throw new Error(`${envName} không được chứa credential hoặc secret trong query string.`);
    }

    let host = authorityAndHost;
    if (authorityAndHost.startsWith("[")) {
      const closingBracket = authorityAndHost.indexOf("]");
      if (closingBracket <= 1) {
        throw new Error(`${envName} chứa IPv6 host không hợp lệ.`);
      }
      host = authorityAndHost.slice(1, closingBracket);
      const suffix = authorityAndHost.slice(closingBracket + 1);
      if (suffix) {
        if (!/^:\d+$/.test(suffix)) {
          throw new Error(`${envName} chứa cổng IPv6 không hợp lệ.`);
        }
        const portNum = Number(suffix.slice(1));
        if (portNum < 1 || portNum > 65535) {
          throw new Error(`${envName} chứa cổng không hợp lệ.`);
        }
      }
    } else {
      const colonIdx = authorityAndHost.indexOf(":");
      if (colonIdx !== -1) {
        host = authorityAndHost.slice(0, colonIdx);
        const portPart = authorityAndHost.slice(colonIdx + 1);
        if (!/^\d+$/.test(portPart) || Number(portPart) < 1 || Number(portPart) > 65535) {
          throw new Error(`${envName} chứa cổng không hợp lệ.`);
        }
      }
    }

    if (!host) {
      throw new Error(`${envName} thiếu hostname.`);
    }

    if ((matchedScheme === "turn:" || matchedScheme === "turns:") && host.toLowerCase() === "turn") {
      throw new Error(
        `${envName} không được dùng hostname nội bộ Docker 'turn'; hãy dùng địa chỉ mà browser truy cập được.`,
      );
    }
  }

  return entries;
}

/**
 * Validates `TURN_TTL_SECONDS` strictly inside `[60, 3600]`, defaulting to `900`.
 */
export function parseTurnTtlSeconds(raw: string | undefined): number {
  const trimmed = raw?.trim();
  if (!trimmed) return DEFAULT_TURN_TTL_SECONDS;
  if (!/^\d+$/.test(trimmed)) {
    throw new Error("TURN_TTL_SECONDS phải là số nguyên.");
  }
  const value = Number(trimmed);
  if (
    !Number.isSafeInteger(value) ||
    value < MIN_TURN_TTL_SECONDS ||
    value > MAX_TURN_TTL_SECONDS
  ) {
    throw new Error(
      `TURN_TTL_SECONDS phải nằm trong khoảng ${MIN_TURN_TTL_SECONDS}..${MAX_TURN_TTL_SECONDS} giây.`,
    );
  }
  return value;
}

/**
 * Validates and reads the 64-hex shared secret from a local or mounted secret file.
 * Never embeds file content in thrown errors.
 */
export function readTurnSharedSecretFile(secretFilePath: string): string {
  const trimmedPath = secretFilePath.trim();
  if (!trimmedPath) {
    throw new Error("TURN_SHARED_SECRET_FILE chưa được cấu hình.");
  }

  const resolved = path.resolve(trimmedPath);
  let stats;
  try {
    stats = statSync(resolved);
  } catch {
    throw new Error("Không thể truy cập tệp TURN_SHARED_SECRET_FILE.");
  }
  if (!stats.isFile()) {
    throw new Error("TURN_SHARED_SECRET_FILE không trỏ tới một tệp hợp lệ.");
  }
  if (stats.size === 0 || stats.size > MAX_SECRET_FILE_BYTES) {
    throw new Error("TURN_SHARED_SECRET_FILE có kích thước không hợp lệ.");
  }

  let raw: string;
  try {
    raw = readFileSync(resolved, "utf8");
  } catch {
    throw new Error("Không thể đọc tệp TURN_SHARED_SECRET_FILE.");
  }

  const normalized = raw.replace(/\r?\n$/, "");
  if (!TURN_SECRET_HEX_REGEX.test(normalized)) {
    throw new Error(
      "TURN shared secret trong file phải gồm đúng 64 ký tự hexadecimal (32 bytes random).",
    );
  }

  return normalized;
}

/**
 * Generates coturn-compatible TURN REST temporary credentials using HMAC-SHA1 + Base64.
 */
export function generateTurnRestCredential(params: {
  userId: string;
  sharedSecret: string;
  ttlSeconds: number;
  nowMs?: number;
}): { username: string; credential: string; expiresAt: number; ttlSeconds: number } {
  const safeUserId = validateUserId(params.userId);
  if (!TURN_SECRET_HEX_REGEX.test(params.sharedSecret)) {
    throw new Error("TURN shared secret không hợp lệ.");
  }
  if (
    !Number.isSafeInteger(params.ttlSeconds) ||
    params.ttlSeconds < MIN_TURN_TTL_SECONDS ||
    params.ttlSeconds > MAX_TURN_TTL_SECONDS
  ) {
    throw new Error(
      `TURN TTL phải nằm trong khoảng ${MIN_TURN_TTL_SECONDS}..${MAX_TURN_TTL_SECONDS} giây.`,
    );
  }

  const timestampMs = params.nowMs ?? Date.now();
  if (!Number.isFinite(timestampMs) || timestampMs < 0) {
    throw new Error("Thời gian UTC để cấp TURN credential không hợp lệ.");
  }

  const nowSeconds = Math.floor(timestampMs / 1000);
  const expiresAt = nowSeconds + params.ttlSeconds;
  const username = `${expiresAt}:${safeUserId}`;
  const credential = createHmac("sha1", params.sharedSecret)
    .update(username, "utf8")
    .digest("base64");

  return {
    username,
    credential,
    expiresAt,
    ttlSeconds: params.ttlSeconds,
  };
}

/**
 * Builds a `TurnService` keeping the shared secret private inside a closure so
 * config/errors/serialization can never expose it.
 */
export function createTurnService(options: CreateTurnServiceOptions): TurnService {
  const turnEnabled = options.turnUrls.length > 0;
  const stunUrls = [...options.stunUrls];
  const turnUrls = [...options.turnUrls];
  const secretKey = options.sharedSecret;

  if (turnEnabled) {
    if (!secretKey || !TURN_SECRET_HEX_REGEX.test(secretKey)) {
      throw new Error("TURN shared secret hợp lệ là bắt buộc khi bật TURN_URLS.");
    }
    if (
      !Number.isSafeInteger(options.ttlSeconds) ||
      options.ttlSeconds < MIN_TURN_TTL_SECONDS ||
      options.ttlSeconds > MAX_TURN_TTL_SECONDS
    ) {
      throw new Error(
        `TURN_TTL_SECONDS phải nằm trong khoảng ${MIN_TURN_TTL_SECONDS}..${MAX_TURN_TTL_SECONDS} giây.`,
      );
    }
  }

  const config: TurnPublicConfig = Object.freeze({
    turnEnabled,
    stunUrls: Object.freeze([...stunUrls]) as unknown as string[],
    turnUrls: Object.freeze([...turnUrls]) as unknown as string[],
    ttlSeconds: turnEnabled ? options.ttlSeconds : 0,
    rateLimitMax: options.rateLimitMax,
    rateLimitWindowMs: options.rateLimitWindowMs,
    externalIp: options.externalIp,
  });

  return {
    config,
    issueForUser(userId: string, nowMs?: number): TurnCredentialsResponse {
      validateUserId(userId);
      const baseIceServers: TurnIceServer[] =
        stunUrls.length > 0 ? [{ urls: [...stunUrls] }] : [];

      if (!turnEnabled || !secretKey) {
        return {
          iceServers: baseIceServers,
          expiresAt: null,
          ttlSeconds: 0,
          turnEnabled: false,
        };
      }

      const issued = generateTurnRestCredential({
        userId,
        sharedSecret: secretKey,
        ttlSeconds: options.ttlSeconds,
        nowMs,
      });

      return {
        iceServers: [
          ...baseIceServers,
          {
            urls: [...turnUrls],
            username: issued.username,
            credential: issued.credential,
            credentialType: "password",
          },
        ],
        expiresAt: issued.expiresAt,
        ttlSeconds: issued.ttlSeconds,
        turnEnabled: true,
      };
    },
  };
}

/**
 * Parses environment configuration and secret file for AUD-01 TURN credentials.
 * Fails fast if TURN_URLS is enabled while TURN_SHARED_SECRET_FILE is missing/invalid,
 * or if secret is passed directly via `TURN_SHARED_SECRET`.
 */
export function createTurnServiceFromEnv(env: NodeJS.ProcessEnv = process.env): TurnService {
  if (env.TURN_SHARED_SECRET && env.TURN_SHARED_SECRET.trim().length > 0) {
    throw new Error(
      "TURN_SHARED_SECRET không được phép truyền trực tiếp qua biến môi trường; hãy dùng TURN_SHARED_SECRET_FILE.",
    );
  }

  const parsedStun = parseIceUrlList(env.STUN_URLS, ["stun:", "stuns:"], "STUN_URLS");
  const stunUrls = parsedStun.length > 0 ? parsedStun : [...DEFAULT_STUN_URLS];
  const turnUrls = parseIceUrlList(env.TURN_URLS, ["turn:", "turns:"], "TURN_URLS");

  const ttlSeconds = parseTurnTtlSeconds(env.TURN_TTL_SECONDS);
  const rateLimitMax = parsePositiveIntSetting(
    env.TURN_RATE_LIMIT_MAX,
    DEFAULT_TURN_RATE_LIMIT_MAX,
    "TURN_RATE_LIMIT_MAX",
  );
  const rateLimitWindowMs = parsePositiveIntSetting(
    env.TURN_RATE_LIMIT_WINDOW_MS,
    DEFAULT_TURN_RATE_LIMIT_WINDOW_MS,
    "TURN_RATE_LIMIT_WINDOW_MS",
    MAX_SAFE_WINDOW_MS,
  );

  const rawExternalIp = env.TURN_EXTERNAL_IP?.trim() ?? "";
  if (rawExternalIp && hasSpaceOrControl(rawExternalIp)) {
    throw new Error("TURN_EXTERNAL_IP không hợp lệ.");
  }
  const externalIp = rawExternalIp || null;

  let sharedSecret: string | null = null;
  if (turnUrls.length > 0) {
    sharedSecret = readTurnSharedSecretFile(env.TURN_SHARED_SECRET_FILE ?? "");
  }

  return createTurnService({
    stunUrls,
    turnUrls,
    ttlSeconds,
    rateLimitMax,
    rateLimitWindowMs,
    externalIp,
    sharedSecret,
  });
}
