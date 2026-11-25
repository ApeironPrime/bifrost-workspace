import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { createAvatarStorageFromEnv, parseAndValidateJpegDataUrl } from "../dist/lib/avatarStorage.js";
import {
  REFRESH_COOKIE_NAME,
  parseCookies,
  serializeClearRefreshCookie,
  serializeRefreshCookie,
} from "../dist/lib/cookies.js";
import { createAuthRateLimiters } from "../dist/lib/rateLimit.js";
import { createRedisRateLimitStore } from "../dist/lib/redisCluster.js";
import { createAvatarRouter } from "../dist/routes/avatars.js";

const TINY_JPEG_BYTES = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);
const TINY_JPEG_DATA_URL = `data:image/jpeg;base64,${TINY_JPEG_BYTES.toString("base64")}`;

async function listenEphemeral(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function createMockRedisClient() {
  const store = new Map();
  return {
    async incr(key) {
      const entry = store.get(key) ?? { value: 0, expiresAt: Date.now() + 60_000 };
      if (Date.now() > entry.expiresAt) {
        entry.value = 0;
        entry.expiresAt = Date.now() + 60_000;
      }
      entry.value += 1;
      store.set(key, entry);
      return entry.value;
    },
    async decr(key) {
      const entry = store.get(key);
      if (!entry) return 0;
      entry.value -= 1;
      store.set(key, entry);
      return entry.value;
    },
    async pExpire(key, ms) {
      const entry = store.get(key) ?? { value: 0, expiresAt: Date.now() + ms };
      entry.expiresAt = Date.now() + ms;
      store.set(key, entry);
      return 1;
    },
    async pTTL(key) {
      const entry = store.get(key);
      if (!entry) return -2;
      return Math.max(0, entry.expiresAt - Date.now());
    },
    async del(key) {
      return store.delete(key) ? 1 : 0;
    },
  };
}

test("RedisRateLimitStore shares rate-limit counters across two replica limiters", async () => {
  const sharedRedis = createMockRedisClient();
  const sharedHmacSecret = "shared-cluster-hmac-secret";
  const settings = {
    loginIpEmailMax: 2,
    loginIpEmailWindowMs: 60_000,
    loginIpMax: 10,
    loginIpWindowMs: 60_000,
    registerIpMax: 10,
    registerIpWindowMs: 60_000,
  };

  const replicaA = createAuthRateLimiters({
    redisClient: sharedRedis,
    hmacSecret: sharedHmacSecret,
    settings,
  });
  const replicaB = createAuthRateLimiters({
    redisClient: sharedRedis,
    hmacSecret: sharedHmacSecret,
    settings,
  });

  const appA = express();
  appA.use(express.json());
  appA.post("/login", replicaA.loginAccountLimiter, (_req, res) => res.status(401).json({ ok: false }));

  const appB = express();
  appB.use(express.json());
  appB.post("/login", replicaB.loginAccountLimiter, (_req, res) => res.status(401).json({ ok: false }));

  const srvA = await listenEphemeral(appA);
  const srvB = await listenEphemeral(appB);

  try {
    const r1 = await fetch(`${srvA.baseUrl}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "scale@bifrost.dev" }),
    });
    assert.equal(r1.status, 401);

    const r2 = await fetch(`${srvB.baseUrl}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "scale@bifrost.dev" }),
    });
    assert.equal(r2.status, 401);

    // 3rd attempt hitting replica A must be blocked (429) because state is shared in Redis
    const r3 = await fetch(`${srvA.baseUrl}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "scale@bifrost.dev" }),
    });
    assert.equal(r3.status, 429);
  } finally {
    await Promise.all([srvA.close(), srvB.close(), replicaA.shutdown(), replicaB.shutdown()]);
  }
});

test("createRedisRateLimitStore supports increment, decrement, and resetKey", async () => {
  const client = createMockRedisClient();
  const store = createRedisRateLimitStore(client, "test", 30_000);
  const first = await store.increment("127.0.0.1");
  assert.equal(first.totalHits, 1);
  const second = await store.increment("127.0.0.1");
  assert.equal(second.totalHits, 2);
  await store.decrement?.("127.0.0.1");
  const third = await store.increment("127.0.0.1");
  assert.equal(third.totalHits, 2);
  await store.resetKey("127.0.0.1");
  const afterReset = await store.increment("127.0.0.1");
  assert.equal(afterReset.totalHits, 1);
});

test("AvatarStorage disk mode writes content-addressed JPEG and serves via GET /api/avatars/:filename", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bifrost-avatars-"));
  const app = express();
  app.use("/api/avatars", createAvatarRouter(tempDir));
  const srv = await listenEphemeral(app);

  try {
    const storage = createAvatarStorageFromEnv({ AVATAR_STORAGE_DIR: tempDir });
    assert.equal(storage.mode, "disk");

    const avatarUrl = await storage.storeAvatar(TINY_JPEG_DATA_URL);
    assert.match(avatarUrl, /^\/api\/avatars\/[a-f0-9]{64}\.jpg$/);

    const res = await fetch(`${srv.baseUrl}${avatarUrl}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/jpeg");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    const bodyBuf = Buffer.from(await res.arrayBuffer());
    assert.deepEqual(bodyBuf, TINY_JPEG_BYTES);

    const invalidRes = await fetch(`${srv.baseUrl}/api/avatars/invalid.jpg`);
    assert.equal(invalidRes.status, 404);
  } finally {
    await srv.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("AvatarStorage S3 mode signs PUT requests with AWS SigV4 and returns public URL", async () => {
  const calls = [];
  const mockFetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(null, { status: 200 });
  };

  const storage = createAvatarStorageFromEnv(
    {
      AVATAR_S3_ENDPOINT: "https://s3.example.com",
      AVATAR_S3_BUCKET: "bifrost-media",
      AVATAR_S3_REGION: "us-east-1",
      AVATAR_S3_ACCESS_KEY_ID: "AKIATESTKEY",
      AVATAR_S3_SECRET_ACCESS_KEY: "test-secret-key",
      AVATAR_S3_PUBLIC_BASE_URL: "https://cdn.example.com",
    },
    mockFetch,
  );
  assert.equal(storage.mode, "s3");

  const url = await storage.storeAvatar(TINY_JPEG_DATA_URL);
  assert.match(url, /^https:\/\/cdn\.example\.com\/avatars\/[a-f0-9]{64}\.jpg$/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, "PUT");
  assert.match(calls[0].init.headers.Authorization, /^AWS4-HMAC-SHA256 Credential=AKIATESTKEY\//);
  assert.ok(calls[0].init.headers["x-amz-content-sha256"]);
  assert.ok(calls[0].init.headers["x-amz-date"]);
});

test("parseAndValidateJpegDataUrl rejects non-JPEG bytes", () => {
  const pngFake = `data:image/jpeg;base64,${Buffer.from("not-a-jpeg-header").toString("base64")}`;
  assert.throws(() => parseAndValidateJpegDataUrl(pngFake));
});

test("Cookie helpers serialize HttpOnly refresh cookie and parse Cookie header", () => {
  const setCookie = serializeRefreshCookie("rt_abc123", { secure: true, maxAgeSeconds: 3600 });
  assert.ok(setCookie.includes(`${REFRESH_COOKIE_NAME}=rt_abc123`));
  assert.ok(setCookie.includes("HttpOnly"));
  assert.ok(setCookie.includes("SameSite=Lax"));
  assert.ok(setCookie.includes("Path=/api/auth"));
  assert.ok(setCookie.includes("Secure"));

  const cleared = serializeClearRefreshCookie({ secure: false });
  assert.ok(cleared.includes("Max-Age=0"));
  assert.ok(!cleared.includes("Secure"));

  const parsed = parseCookies(`foo=bar; ${REFRESH_COOKIE_NAME}=rt_abc123`);
  assert.equal(parsed[REFRESH_COOKIE_NAME], "rt_abc123");
  assert.equal(parsed.foo, "bar");
});
