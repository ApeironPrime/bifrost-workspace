import { createHmac, randomBytes } from "node:crypto";
import { BlockList, isIP } from "node:net";
import {
  MemoryStore,
  ipKeyGenerator,
  rateLimit,
  type RateLimitRequestHandler,
  type Store,
} from "express-rate-limit";
import { createRedisRateLimitStore, type RedisRateLimitClient } from "./redisCluster.js";

export const AUTH_RATE_LIMIT_MESSAGE =
  "Quá nhiều yêu cầu xác thực. Vui lòng thử lại sau ít phút.";

export const RATE_LIMIT_EXPOSED_HEADERS = [
  "Retry-After",
  "RateLimit",
  "RateLimit-Policy",
] as const;

export const DEFAULT_AUTH_RATE_LIMIT_CONFIG = {
  loginIpEmailMax: 10,
  loginIpEmailWindowMs: 900_000,
  loginIpMax: 30,
  loginIpWindowMs: 900_000,
  registerIpMax: 10,
  registerIpWindowMs: 3_600_000,
} as const;

// Bounded by Node's 32-bit signed timer limit used by express-rate-limit MemoryStore.
export const MAX_SAFE_WINDOW_MS = 2 ** 31 - 1;

export interface AuthRateLimitSettings {
  loginIpEmailMax: number;
  loginIpEmailWindowMs: number;
  loginIpMax: number;
  loginIpWindowMs: number;
  registerIpMax: number;
  registerIpWindowMs: number;
}

export interface AuthRateLimitOptions {
  env?: NodeJS.ProcessEnv;
  settings?: Partial<AuthRateLimitSettings>;
  hmacSecret?: Buffer | string;
  redisClient?: RedisRateLimitClient | null;
  stores?: {
    loginAccount?: Store;
    loginIp?: Store;
    registerIp?: Store;
  };
  logger?: {
    error: (error: unknown, message?: string) => void;
    warn: (error: unknown, message?: string) => void;
  };
}

export interface AuthRateLimiters {
  loginAccountLimiter: RateLimitRequestHandler;
  loginIpLimiter: RateLimitRequestHandler;
  registerIpLimiter: RateLimitRequestHandler;
  stores: {
    loginAccount: Store;
    loginIp: Store;
    registerIp: Store;
  };
  settings: AuthRateLimitSettings;
  shutdown: () => Promise<void>;
}

/**
 * Validates and parses `TRUST_PROXY` strictly:
 * - unset, empty, or `"false"` -> `false` (direct socket IP only; XFF ignored)
 * - `"true"`, numeric hop counts, named shortcuts (`loopback`, etc.), or `/0` wildcards -> throw startup error
 * - comma-separated explicit IPs / CIDRs -> validated `string[]` passed to Express `trust proxy`
 */
export function parseTrustProxySetting(raw: string | undefined): false | string[] {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed || trimmed.toLowerCase() === "false") {
    return false;
  }
  if (trimmed.toLowerCase() === "true") {
    throw new Error(
      "TRUST_PROXY=true bị từ chối vì cho phép giả mạo X-Forwarded-For; hãy đặt false hoặc danh sách IP/CIDR tin cậy cụ thể.",
    );
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(
      "TRUST_PROXY dạng số hop không được hỗ trợ; hãy đặt false hoặc danh sách IP/CIDR cụ thể của reverse proxy.",
    );
  }

  const entries = trimmed.split(",").map((entry) => entry.trim());
  if (entries.length === 0 || entries.some((entry) => entry.length === 0)) {
    throw new Error("TRUST_PROXY không được chứa phần tử rỗng.");
  }

  const blockList = new BlockList();
  for (const entry of entries) {
    const slashIdx = entry.indexOf("/");
    if (slashIdx === -1) {
      const ipVersion = isIP(entry);
      if (ipVersion === 0) {
        throw new Error(
          `Giá trị TRUST_PROXY không hợp lệ (${entry}); chỉ chấp nhận IP hoặc CIDR hợp lệ.`,
        );
      }
      continue;
    }

    const parts = entry.split("/");
    if (parts.length !== 2 || !/^\d+$/.test(parts[1])) {
      throw new Error(`CIDR trong TRUST_PROXY không hợp lệ: ${entry}`);
    }
    const [ipPart, prefixPart] = parts;
    const ipVersion = isIP(ipPart);
    const prefix = Number(prefixPart);
    const maxPrefix = ipVersion === 4 ? 32 : ipVersion === 6 ? 128 : 0;
    if (ipVersion === 0 || !Number.isInteger(prefix) || prefix < 1 || prefix > maxPrefix) {
      throw new Error(
        `CIDR trong TRUST_PROXY không hợp lệ hoặc quá rộng (không chấp nhận /0): ${entry}`,
      );
    }
    try {
      blockList.addSubnet(ipPart, prefix, ipVersion === 4 ? "ipv4" : "ipv6");
    } catch {
      throw new Error(`CIDR trong TRUST_PROXY không hợp lệ: ${entry}`);
    }
  }

  return entries;
}

export function parsePositiveIntSetting(
  raw: string | undefined,
  fallback: number,
  envName: string,
  maxAllowed = Number.MAX_SAFE_INTEGER,
): number {
  const trimmed = raw?.trim();
  if (!trimmed) return fallback;
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${envName} phải là số nguyên dương hợp lệ.`);
  }
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value < 1 || value > maxAllowed) {
    throw new Error(`${envName} phải nằm trong khoảng 1..${maxAllowed}.`);
  }
  return value;
}

export function readAuthRateLimitSettings(
  env: NodeJS.ProcessEnv = process.env,
): AuthRateLimitSettings {
  return {
    loginIpEmailMax: parsePositiveIntSetting(
      env.AUTH_LOGIN_IP_EMAIL_MAX,
      DEFAULT_AUTH_RATE_LIMIT_CONFIG.loginIpEmailMax,
      "AUTH_LOGIN_IP_EMAIL_MAX",
    ),
    loginIpEmailWindowMs: parsePositiveIntSetting(
      env.AUTH_LOGIN_IP_EMAIL_WINDOW_MS,
      DEFAULT_AUTH_RATE_LIMIT_CONFIG.loginIpEmailWindowMs,
      "AUTH_LOGIN_IP_EMAIL_WINDOW_MS",
      MAX_SAFE_WINDOW_MS,
    ),
    loginIpMax: parsePositiveIntSetting(
      env.AUTH_LOGIN_IP_MAX,
      DEFAULT_AUTH_RATE_LIMIT_CONFIG.loginIpMax,
      "AUTH_LOGIN_IP_MAX",
    ),
    loginIpWindowMs: parsePositiveIntSetting(
      env.AUTH_LOGIN_IP_WINDOW_MS,
      DEFAULT_AUTH_RATE_LIMIT_CONFIG.loginIpWindowMs,
      "AUTH_LOGIN_IP_WINDOW_MS",
      MAX_SAFE_WINDOW_MS,
    ),
    registerIpMax: parsePositiveIntSetting(
      env.AUTH_REGISTER_IP_MAX,
      DEFAULT_AUTH_RATE_LIMIT_CONFIG.registerIpMax,
      "AUTH_REGISTER_IP_MAX",
    ),
    registerIpWindowMs: parsePositiveIntSetting(
      env.AUTH_REGISTER_IP_WINDOW_MS,
      DEFAULT_AUTH_RATE_LIMIT_CONFIG.registerIpWindowMs,
      "AUTH_REGISTER_IP_WINDOW_MS",
      MAX_SAFE_WINDOW_MS,
    ),
  };
}

/** Normalizes auth email identically to `auth.ts` (`trim().toLowerCase()`), returning `null` for empty/non-string inputs. */
export function normalizeAuthEmail(email: unknown): string | null {
  if (typeof email !== "string") return null;
  const normalized = email.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

/**
 * Computes a keyed HMAC-SHA256 digest of a normalized email for in-memory rate-limit keys.
 * Plaintext emails are never stored in limiter keys or logs.
 */
export function createEmailHmac(normalizedEmail: string, secret: Buffer | string): string {
  return createHmac("sha256", secret).update(normalizedEmail).digest("hex");
}

function extractBodyEmail(body: unknown): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }
  return normalizeAuthEmail((body as Record<string, unknown>).email);
}

export function formatLoginIpAccountKey(
  normalizedIp: string,
  normalizedEmail: string,
  hmacSecret: Buffer | string,
): string {
  return `login:ip-account:${normalizedIp}:${createEmailHmac(normalizedEmail, hmacSecret)}`;
}

/**
 * Creates independent AUD-08a rate limiters backed by separate in-memory `MemoryStore`
 * instances for a single Node.js process:
 * - `loginAccountLimiter` (L1): IP + HMAC(email), counts failures only (`status >= 400`)
 * - `loginIpLimiter` (L2): per-IP, counts all login attempts (`200`, `400`, `401`, bad JSON)
 * - `registerIpLimiter` (R1): per-IP, counts all register attempts (`201`, `400`, `409`, bad JSON)
 *
 * Deployment boundary: MemoryStore state resets on restart and is NOT shared across multiple
 * backend replicas. Horizontal scaling requires replacing these stores with a shared store
 * (e.g. Redis/Valkey) and replacing the process-local HMAC key with a shared secret.
 */
export function createAuthRateLimiters(options: AuthRateLimitOptions = {}): AuthRateLimiters {
  const envSettings = readAuthRateLimitSettings(options.env);
  const settings: AuthRateLimitSettings = {
    ...envSettings,
    ...options.settings,
  };

  const envSource = options.env ?? process.env;
  const hmacSecret =
    options.hmacSecret ??
    (envSource.RATE_LIMIT_HMAC_SECRET?.trim() || undefined) ??
    randomBytes(32);

  const redisClient = options.redisClient ?? null;
  const stores = {
    loginAccount:
      options.stores?.loginAccount ??
      (redisClient
        ? createRedisRateLimitStore(redisClient, "loginAccount", settings.loginIpEmailWindowMs)
        : new MemoryStore()),
    loginIp:
      options.stores?.loginIp ??
      (redisClient
        ? createRedisRateLimitStore(redisClient, "loginIp", settings.loginIpWindowMs)
        : new MemoryStore()),
    registerIp:
      options.stores?.registerIp ??
      (redisClient
        ? createRedisRateLimitStore(redisClient, "registerIp", settings.registerIpWindowMs)
        : new MemoryStore()),
  };

  const errorMessage = { message: AUTH_RATE_LIMIT_MESSAGE };
  const loggerOpt = options.logger ? { logger: options.logger } : {};

  const loginIpLimiter = rateLimit({
    windowMs: settings.loginIpWindowMs,
    limit: settings.loginIpMax,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    identifier: "auth-login-ip",
    ipv6Subnet: 56,
    skipSuccessfulRequests: false,
    passOnStoreError: true,
    statusCode: 429,
    message: errorMessage,
    store: stores.loginIp,
    ...loggerOpt,
  });

  const loginAccountLimiter = rateLimit({
    windowMs: settings.loginIpEmailWindowMs,
    limit: settings.loginIpEmailMax,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    identifier: "auth-login-ip-account",
    skipSuccessfulRequests: true,
    passOnStoreError: true,
    statusCode: 429,
    message: errorMessage,
    store: stores.loginAccount,
    skip: (request) => extractBodyEmail(request.body) === null,
    keyGenerator: (request) => {
      const normalizedIp = request.ip ? ipKeyGenerator(request.ip, 56) : "unknown";
      const normalizedEmail = extractBodyEmail(request.body);
      if (!normalizedEmail) {
        return `login:ip-account:${normalizedIp}:__missing_email__`;
      }
      return formatLoginIpAccountKey(normalizedIp, normalizedEmail, hmacSecret);
    },
    ...loggerOpt,
  });

  const registerIpLimiter = rateLimit({
    windowMs: settings.registerIpWindowMs,
    limit: settings.registerIpMax,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    identifier: "auth-register-ip",
    ipv6Subnet: 56,
    skipSuccessfulRequests: false,
    passOnStoreError: true,
    statusCode: 429,
    message: errorMessage,
    store: stores.registerIp,
    ...loggerOpt,
  });

  return {
    loginAccountLimiter,
    loginIpLimiter,
    registerIpLimiter,
    stores,
    settings,
    shutdown: async () => {
      await Promise.all([
        stores.loginAccount.shutdown?.(),
        stores.loginIp.shutdown?.(),
        stores.registerIp.shutdown?.(),
      ]);
    },
  };
}

let defaultAuthRateLimiters: AuthRateLimiters | null = null;

export function configureAuthRateLimiters(options: AuthRateLimitOptions = {}): AuthRateLimiters {
  defaultAuthRateLimiters = createAuthRateLimiters(options);
  return defaultAuthRateLimiters;
}

/** Lazily initializes and returns the auth rate-limiter bundle. */
export function getAuthRateLimiters(): AuthRateLimiters {
  if (!defaultAuthRateLimiters) {
    defaultAuthRateLimiters = createAuthRateLimiters();
  }
  return defaultAuthRateLimiters;
}
