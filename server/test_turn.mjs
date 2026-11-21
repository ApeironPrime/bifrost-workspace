import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import pg from "pg";
import "dotenv/config";
import { ZodError } from "zod";

process.env.JWT_SECRET ??= "unit-test-jwt-secret-only";
process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:5432/unused";

const { createAccessToken } = await import("./dist/lib/auth.js");
const {
  DEFAULT_STUN_URLS,
  DEFAULT_TURN_TTL_SECONDS,
  MAX_TURN_TTL_SECONDS,
  MIN_TURN_TTL_SECONDS,
  createTurnService,
  createTurnServiceFromEnv,
  generateTurnRestCredential,
  parseIceUrlList,
  parseTurnTtlSeconds,
  readTurnSharedSecretFile,
} = await import("./dist/lib/turn.js");
const { createTurnRouterBundle } = await import("./dist/routes/turn.js");
const { RATE_LIMIT_EXPOSED_HEADERS } = await import("./dist/lib/rateLimit.js");

const VALID_USER_A = "11111111-1111-4111-8111-111111111111";
const VALID_USER_B = "22222222-2222-4222-8222-222222222222";
const VALID_WS_ID = "33333333-3333-4333-8333-333333333333";
const VALID_ROOM_ID = "44444444-4444-4444-8444-444444444444";
const FIXED_HEX_SECRET =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function createStrictPrismaSpy(overrides = {}) {
  const calls = [];
  const makeModelProxy = (modelName) =>
    new Proxy(
      {},
      {
        get(_target, methodName) {
          return async (...args) => {
            calls.push({ model: modelName, method: String(methodName), args });
            const custom = overrides?.[modelName]?.[String(methodName)];
            if (typeof custom === "function") {
              return custom(...args);
            }
            throw new Error(`Unexpected Prisma call: ${modelName}.${String(methodName)}`);
          };
        },
      },
    );

  const db = new Proxy(
    {},
    {
      get(_target, modelName) {
        return makeModelProxy(String(modelName));
      },
    },
  );
  return { db, calls };
}

async function withTurnApp({ dbOverrides = {}, turnService, rateLimitMax = 30, rateLimitWindowMs = 900_000 }, fn) {
  const { db, calls } = createStrictPrismaSpy(dbOverrides);
  const app = express();
  const bundle = createTurnRouterBundle(db, turnService, {
    rateLimitMax,
    rateLimitWindowMs,
  });
  app.use("/api/turn", bundle.router);
  app.use((error, _req, res, _next) => {
    if (error instanceof ZodError) {
      res.status(400).json({ message: error.issues[0]?.message ?? "Dữ liệu không hợp lệ." });
      return;
    }
    res.status(500).json({ message: "Đã xảy ra lỗi máy chủ." });
  });

  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}/api/turn`;
  try {
    await fn({ baseUrl, calls });
  } finally {
    await bundle.shutdown();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("Unit: HMAC-SHA1 coturn REST vector, Base64 output, UTC expiry integer, and username format", () => {
  const fixedNowMs = 1_700_000_000_987;
  const result = generateTurnRestCredential({
    userId: VALID_USER_A,
    sharedSecret: FIXED_HEX_SECRET,
    ttlSeconds: 900,
    nowMs: fixedNowMs,
  });

  const expectedExpiry = 1_700_000_900;
  const expectedUsername = `${expectedExpiry}:${VALID_USER_A}`;
  const expectedHmacBase64 = createHmac("sha1", FIXED_HEX_SECRET)
    .update(expectedUsername, "utf8")
    .digest("base64");

  assert.equal(Number.isInteger(result.expiresAt), true);
  assert.equal(result.expiresAt, expectedExpiry);
  assert.equal(result.username, expectedUsername);
  assert.equal(result.credential, expectedHmacBase64);
  assert.equal(result.credential.length, 28);
  assert.equal(result.ttlSeconds, 900);
});

test("Unit: invalid userId values and TTL out of [60..3600] bounds are rejected", () => {
  for (const badUserId of ["", "   ", "user:colon", "user\nid", "user id", "user\0id"]) {
    assert.throws(() =>
      generateTurnRestCredential({
        userId: badUserId,
        sharedSecret: FIXED_HEX_SECRET,
        ttlSeconds: 900,
      }),
    );
  }

  assert.equal(parseTurnTtlSeconds(undefined), DEFAULT_TURN_TTL_SECONDS);
  assert.equal(parseTurnTtlSeconds(String(MIN_TURN_TTL_SECONDS)), 60);
  assert.equal(parseTurnTtlSeconds(String(MAX_TURN_TTL_SECONDS)), 3600);

  for (const badTtl of ["0", "59", "3601", "-60", "90.5", "abc"]) {
    assert.throws(() => parseTurnTtlSeconds(badTtl));
  }
});

test("Unit: secret file validation rejects missing, empty, invalid hex, multi-line, and inline env secret", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "bifrost-turn-unit-"));
  try {
    assert.throws(() => readTurnSharedSecretFile(path.join(tmpDir, "missing.secret")));
    assert.throws(() => readTurnSharedSecretFile(tmpDir));

    const emptyFile = path.join(tmpDir, "empty.secret");
    writeFileSync(emptyFile, "", "utf8");
    assert.throws(() => readTurnSharedSecretFile(emptyFile));

    const shortFile = path.join(tmpDir, "short.secret");
    writeFileSync(shortFile, "0123456789abcdef\n", "utf8");
    assert.throws(() => readTurnSharedSecretFile(shortFile));

    const nonHexFile = path.join(tmpDir, "nonhex.secret");
    const nonHexPayload = `${"g".repeat(64)}\n`;
    writeFileSync(nonHexFile, nonHexPayload, "utf8");
    assert.throws(
      () => readTurnSharedSecretFile(nonHexFile),
      (err) => !String(err).includes(nonHexPayload.trim()),
    );

    const multiLineFile = path.join(tmpDir, "multi.secret");
    writeFileSync(multiLineFile, `${FIXED_HEX_SECRET}\nextra\n`, "utf8");
    assert.throws(() => readTurnSharedSecretFile(multiLineFile));

    const validCrlfFile = path.join(tmpDir, "valid.secret");
    writeFileSync(validCrlfFile, `${FIXED_HEX_SECRET}\r\n`, "utf8");
    assert.equal(readTurnSharedSecretFile(validCrlfFile), FIXED_HEX_SECRET);

    assert.throws(() =>
      createTurnServiceFromEnv({
        TURN_SHARED_SECRET: FIXED_HEX_SECRET,
        TURN_URLS: "turn:127.0.0.1:3478?transport=udp",
      }),
    );

    assert.throws(
      () =>
        createTurnServiceFromEnv({
          TURN_URLS: "turn:127.0.0.1:3478?transport=udp",
          TURN_SHARED_SECRET_FILE: nonHexFile,
        }),
      (err) => !String(err).includes("gggg"),
    );

    assert.throws(() =>
      createTurnServiceFromEnv({
        TURN_URLS: "turn:127.0.0.1:3478?transport=udp",
      }),
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("Unit: URL validation, STUN-only disabled mode, and shared secret redaction", () => {
  assert.throws(() => parseIceUrlList("turn:user:pass@127.0.0.1:3478", ["turn:", "turns:"], "TURN_URLS"));
  assert.throws(() => parseIceUrlList("turn:127.0.0.1:3478?secret=abc", ["turn:", "turns:"], "TURN_URLS"));
  assert.throws(() => parseIceUrlList("turn:turn:3478", ["turn:", "turns:"], "TURN_URLS"));
  assert.throws(() => parseIceUrlList("http://127.0.0.1:3478", ["turn:", "turns:"], "TURN_URLS"));
  assert.deepEqual(
    parseIceUrlList("turn:127.0.0.1:3478?transport=udp,turns:relay.example.com:5349?transport=tcp", ["turn:", "turns:"], "TURN_URLS"),
    ["turn:127.0.0.1:3478?transport=udp", "turns:relay.example.com:5349?transport=tcp"],
  );

  const disabledService = createTurnServiceFromEnv({
    TURN_URLS: "",
  });
  assert.equal(disabledService.config.turnEnabled, false);
  const disabledPayload = disabledService.issueForUser(VALID_USER_A);
  assert.deepEqual(disabledPayload, {
    iceServers: [{ urls: [...DEFAULT_STUN_URLS] }],
    expiresAt: null,
    ttlSeconds: 0,
    turnEnabled: false,
  });

  const enabledService = createTurnService({
    stunUrls: [...DEFAULT_STUN_URLS],
    turnUrls: ["turn:127.0.0.1:3478?transport=udp"],
    ttlSeconds: 900,
    rateLimitMax: 30,
    rateLimitWindowMs: 900_000,
    externalIp: null,
    sharedSecret: FIXED_HEX_SECRET,
  });
  const issued = enabledService.issueForUser(VALID_USER_A, 1_700_000_000_000);
  assert.equal(issued.turnEnabled, true);
  assert.equal(issued.iceServers[1].credentialType, "password");
  assert.equal(JSON.stringify(enabledService).includes(FIXED_HEX_SECRET), false);
  assert.equal(JSON.stringify(issued).includes(FIXED_HEX_SECRET), false);
});

test("Integration (Router + Prisma Spy): middleware ordering, membership checks, user isolation, no-store headers, and rate limit", async () => {
  const turnService = createTurnService({
    stunUrls: [...DEFAULT_STUN_URLS],
    turnUrls: ["turn:127.0.0.1:3478?transport=udp", "turn:127.0.0.1:3478?transport=tcp"],
    ttlSeconds: 900,
    rateLimitMax: 3,
    rateLimitWindowMs: 60_000,
    externalIp: null,
    sharedSecret: FIXED_HEX_SECRET,
  });

  const tokenA = createAccessToken({ id: VALID_USER_A, email: "alice@test.local" });
  const tokenB = createAccessToken({ id: VALID_USER_B, email: "bob@test.local" });
  const deletedUserId = "55555555-5555-4555-8555-555555555555";
  const deletedToken = createAccessToken({ id: deletedUserId, email: "deleted@test.local" });
  const outsiderId = "66666666-6666-4666-8666-666666666666";
  const outsiderToken = createAccessToken({ id: outsiderId, email: "outsider@test.local" });

  await withTurnApp(
    {
      turnService,
      rateLimitMax: 3,
      rateLimitWindowMs: 60_000,
      dbOverrides: {
        user: {
          findUnique: ({ where }) => {
            if (where.id === deletedUserId) return null;
            return { id: where.id };
          },
        },
        room: {
          findUnique: ({ where }) =>
            where.id === VALID_ROOM_ID ? { id: VALID_ROOM_ID, workspaceId: VALID_WS_ID } : null,
        },
        workspaceMember: {
          findUnique: ({ where }) => {
            const uid = where.workspaceId_userId.userId;
            if (uid === VALID_USER_A || uid === VALID_USER_B) {
              return { userId: uid };
            }
            return null;
          },
        },
      },
    },
    async ({ baseUrl, calls }) => {
      // 1. Unauthenticated -> 401 before Prisma
      const noAuthRes = await fetch(`${baseUrl}/credentials?roomId=${VALID_ROOM_ID}`);
      assert.equal(noAuthRes.status, 401);
      assert.equal(calls.length, 0);

      // 2. Malformed/missing/array roomId -> 400 before Prisma
      const badRoomRes = await fetch(`${baseUrl}/credentials?roomId=not-a-uuid`, {
        headers: { Authorization: `Bearer ${tokenA}` },
      });
      assert.equal(badRoomRes.status, 400);
      assert.equal(calls.length, 0);

      const arrayRoomRes = await fetch(
        `${baseUrl}/credentials?roomId=${VALID_ROOM_ID}&roomId=${VALID_ROOM_ID}`,
        { headers: { Authorization: `Bearer ${tokenA}` } },
      );
      assert.equal(arrayRoomRes.status, 400);
      assert.equal(calls.length, 0);

      // 3. Deleted user -> 401 (Note: consumed 1 limiter slot above for tokenA badRoom, Wait - rateLimit ran AFTER requireAuth, BEFORE validateRoomIdQuery!)
      const deletedRes = await fetch(`${baseUrl}/credentials?roomId=${VALID_ROOM_ID}`, {
        headers: { Authorization: `Bearer ${deletedToken}` },
      });
      assert.equal(deletedRes.status, 401);

      // 4. Non-member -> 403
      const outsiderRes = await fetch(`${baseUrl}/credentials?roomId=${VALID_ROOM_ID}`, {
        headers: { Authorization: `Bearer ${outsiderToken}` },
      });
      assert.equal(outsiderRes.status, 403);

      // 5. Missing room -> 404 (use User B to avoid exhausting A's 3-req test limit)
      const missingRoomRes = await fetch(
        `${baseUrl}/credentials?roomId=77777777-7777-4777-8777-777777777777`,
        { headers: { Authorization: `Bearer ${tokenB}` } },
      );
      assert.equal(missingRoomRes.status, 404);

      // 6. Valid member B gets 200, ignores spoofed query params, no secret, Cache-Control: no-store
      const spoofQuery = new URLSearchParams({
        roomId: VALID_ROOM_ID,
        userId: outsiderId,
        username: "9999999999:spoofed",
        credential: "spoofed_cred",
        ttl: "86400",
        secret: "spoofed_secret",
      });
      const resB = await fetch(`${baseUrl}/credentials?${spoofQuery.toString()}`, {
        headers: { Authorization: `Bearer ${tokenB}` },
      });
      assert.equal(resB.status, 200);
      assert.equal(resB.headers.get("cache-control"), "no-store");
      assert.equal(resB.headers.get("pragma"), "no-cache");
      const bodyB = await resB.json();
      assert.equal(bodyB.turnEnabled, true);
      assert.equal(bodyB.ttlSeconds, 900);
      assert.equal(bodyB.iceServers.length, 2);
      assert.equal(bodyB.iceServers[1].username, `${bodyB.expiresAt}:${VALID_USER_B}`);
      const expectedCredB = createHmac("sha1", FIXED_HEX_SECRET)
        .update(bodyB.iceServers[1].username, "utf8")
        .digest("base64");
      assert.equal(bodyB.iceServers[1].credential, expectedCredB);
      assert.equal(JSON.stringify(bodyB).includes(FIXED_HEX_SECRET), false);

      // 7. User A gets distinct username bound to VALID_USER_A and hits 429 after 3 total hits
      // (tokenA already made 2 requests earlier: badRoomRes & arrayRoomRes; 1 more succeeds -> 4th hits 429)
      const resA = await fetch(`${baseUrl}/credentials?roomId=${VALID_ROOM_ID}`, {
        headers: { Authorization: `Bearer ${tokenA}` },
      });
      assert.equal(resA.status, 200);
      const bodyA = await resA.json();
      assert.equal(bodyA.iceServers[1].username, `${bodyA.expiresAt}:${VALID_USER_A}`);
      assert.notEqual(bodyA.iceServers[1].username, bodyB.iceServers[1].username);

      const resALimited = await fetch(`${baseUrl}/credentials?roomId=${VALID_ROOM_ID}`, {
        headers: { Authorization: `Bearer ${tokenA}` },
      });
      assert.equal(resALimited.status, 429);
      assert.ok(resALimited.headers.get("ratelimit"));
      assert.ok(Number(resALimited.headers.get("retry-after")) >= 1);

      // User B still allowed independently when User A is rate-limited
      const resBStillAllowed = await fetch(`${baseUrl}/credentials?roomId=${VALID_ROOM_ID}`, {
        headers: { Authorization: `Bearer ${tokenB}` },
      });
      assert.equal(resBStillAllowed.status, 200);
    },
  );
});

test("E2E (dist/index.js + PostgreSQL): startup fails without secret when TURN_URLS set, and enforces auth/membership/AUD-05 revocation", async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "bifrost-turn-e2e-"));
  const secretHex = randomBytes(32).toString("hex");
  const secretFile = path.join(tmpDir, "turn_shared_secret");
  writeFileSync(secretFile, `${secretHex}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(secretFile, 0o600);
  } catch {
    // Windows chmod is best-effort.
  }

  // 1. Verify fail-closed startup when TURN_URLS is set without secret file
  const failExitCode = await new Promise((resolve) => {
    const p = spawn("node", ["dist/index.js"], {
      env: {
        ...process.env,
        PORT: "3479",
        TURN_URLS: "turn:127.0.0.1:3478?transport=udp",
        TURN_SHARED_SECRET_FILE: path.join(tmpDir, "missing_secret"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    p.once("exit", (code) => resolve(code));
  });
  assert.notEqual(failExitCode, 0, "Server must fail startup when TURN_URLS is enabled without valid secret file");

  // 2. Start real server with file-backed shared secret
  const port = 3471;
  const clientUrl = "http://localhost:5173";
  const ts = Date.now();
  const aliceEmail = `turn_alice_${ts}@test.local`;
  const bobEmail = `turn_bob_${ts}@test.local`;
  const charlieEmail = `turn_charlie_${ts}@test.local`;
  const testEmails = [aliceEmail, bobEmail, charlieEmail];

  const proc = spawn("node", ["dist/index.js"], {
    env: {
      ...process.env,
      PORT: String(port),
      CLIENT_URL: clientUrl,
      TURN_URLS: "turn:127.0.0.1:3478?transport=udp,turn:127.0.0.1:3478?transport=tcp",
      TURN_SHARED_SECRET_FILE: secretFile,
      TURN_TTL_SECONDS: "900",
      TURN_RATE_LIMIT_MAX: "4",
      TURN_RATE_LIMIT_WINDOW_MS: "60000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/health`);
        if (res.ok) {
          ready = true;
          break;
        }
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    assert.equal(ready, true, "TURN E2E server failed to start");

    const api = async (urlPath, method = "GET", body = undefined, token = undefined) => {
      const res = await fetch(`http://127.0.0.1:${port}/api${urlPath}`, {
        method,
        headers: {
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          Origin: clientUrl,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = res.status === 204 ? null : await res.json();
      return { status: res.status, headers: res.headers, data };
    };

    const regA = await api("/auth/register", "POST", { name: "Alice", email: aliceEmail, password: "Password@123" });
    const regB = await api("/auth/register", "POST", { name: "Bob", email: bobEmail, password: "Password@123" });
    const regC = await api("/auth/register", "POST", { name: "Charlie", email: charlieEmail, password: "Password@123" });
    assert.equal(regA.status, 201);
    assert.equal(regB.status, 201);
    assert.equal(regC.status, 201);

    const tokenA = regA.data.token;
    const tokenB = regB.data.token;
    const tokenC = regC.data.token;
    const bobId = regB.data.user.id;

    const wsRes = await api("/workspaces", "POST", { name: "TURN Workspace" }, tokenA);
    assert.equal(wsRes.status, 201);
    const wsId = wsRes.data.workspace.id;

    const invRes = await api(`/workspaces/${wsId}/members`, "POST", { email: bobEmail }, tokenA);
    assert.equal(invRes.status, 201);

    const roomRes = await api(`/workspaces/${wsId}/rooms`, "POST", { name: "TURN Room" }, tokenA);
    assert.equal(roomRes.status, 201);
    const roomId = roomRes.data.room.id;

    // Outsider denied (403)
    const charlieTurn = await api(`/turn/credentials?roomId=${roomId}`, "GET", undefined, tokenC);
    assert.equal(charlieTurn.status, 403);

    // Valid member Bob gets 200 with verifiable HMAC-SHA1 credential
    const bobTurn = await api(`/turn/credentials?roomId=${roomId}`, "GET", undefined, tokenB);
    assert.equal(bobTurn.status, 200);
    assert.equal(bobTurn.headers.get("cache-control"), "no-store");
    assert.equal(bobTurn.headers.get("pragma"), "no-cache");
    assert.equal(bobTurn.data.turnEnabled, true);
    assert.equal(bobTurn.data.iceServers[1].username, `${bobTurn.data.expiresAt}:${bobId}`);
    assert.equal(
      bobTurn.data.iceServers[1].credential,
      createHmac("sha1", secretHex).update(bobTurn.data.iceServers[1].username, "utf8").digest("base64"),
    );
    assert.equal(JSON.stringify(bobTurn.data).includes(secretHex), false);

    // After AUD-05 removal from workspace, Bob immediately receives 403 from /api/turn/credentials
    const delRes = await api(`/workspaces/${wsId}/members/${bobId}`, "DELETE", undefined, tokenA);
    assert.equal(delRes.status, 204);
    const bobAfterRemoval = await api(`/turn/credentials?roomId=${roomId}`, "GET", undefined, tokenB);
    assert.equal(bobAfterRemoval.status, 403);

    // Rate limit 429 check on Alice (limit=4): 1..4 succeed, 5th hits 429
    for (let i = 0; i < 4; i++) {
      const okRes = await api(`/turn/credentials?roomId=${roomId}`, "GET", undefined, tokenA);
      assert.equal(okRes.status, 200);
    }
    const limitedRes = await api(`/turn/credentials?roomId=${roomId}`, "GET", undefined, tokenA);
    assert.equal(limitedRes.status, 429);
    assert.match(limitedRes.headers.get("access-control-expose-headers") ?? "", /Retry-After/i);
    assert.match(limitedRes.headers.get("ratelimit") ?? "", /turn-credentials/);
  } finally {
    if (proc.exitCode === null && !proc.killed) {
      proc.kill();
      await new Promise((resolve) => proc.once("exit", resolve));
    }
    try {
      const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await db.connect();
      await db.query("DELETE FROM users WHERE email = ANY($1)", [testEmails]);
      await db.end();
    } catch {
      /* best-effort test DB cleanup */
    }
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
