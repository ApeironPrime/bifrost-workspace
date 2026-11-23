import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import express from "express";
import cors from "cors";
import pg from "pg";
import "dotenv/config";
import { ZodError, z } from "zod";
import { ipKeyGenerator } from "express-rate-limit";

process.env.JWT_SECRET ??= "unit-test-jwt-secret-only";
process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:5432/unused";

const {
  AUTH_RATE_LIMIT_MESSAGE,
  DEFAULT_AUTH_RATE_LIMIT_CONFIG,
  RATE_LIMIT_EXPOSED_HEADERS,
  createAuthRateLimiters,
  createEmailHmac,
  formatLoginIpAccountKey,
  normalizeAuthEmail,
  parsePositiveIntSetting,
  parseTrustProxySetting,
  readAuthRateLimitSettings,
} = await import("../dist/lib/rateLimit.js");

const credentialsSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(100),
});

const registerSchema = credentialsSchema.extend({
  name: z.string().trim().min(2).max(100),
});

async function withHttpApp(
  {
    trustProxy = false,
    rateLimitOptions = {},
    loginHandler,
    registerHandler,
    clientUrl = "http://localhost:5173",
  } = {},
  fn,
) {
  const limiters = createAuthRateLimiters(rateLimitOptions);
  const app = express();
  app.set("trust proxy", parseTrustProxySetting(trustProxy === false ? "false" : trustProxy));

  app.use(
    cors({
      origin: clientUrl,
      exposedHeaders: [...RATE_LIMIT_EXPOSED_HEADERS],
    }),
  );
  app.post("/api/auth/login", limiters.loginIpLimiter);
  app.post("/api/auth/register", limiters.registerIpLimiter);
  app.use(express.json());

  const router = express.Router();
  router.post("/login", limiters.loginAccountLimiter, async (req, res, next) => {
    try {
      if (loginHandler) {
        await loginHandler(req, res);
        return;
      }
      const input = credentialsSchema.parse(req.body);
      const normalized = input.email.toLowerCase();
      if (normalized === "alice@example.com" && input.password === "CorrectPass123!") {
        res.status(200).json({ token: "jwt-token-secret-should-not-log", user: { id: "u-alice", email: normalized } });
        return;
      }
      if (normalized.startsWith("valid-") && input.password === "CorrectPass123!") {
        res.status(200).json({ token: "jwt-token-secret-should-not-log", user: { id: "u-valid", email: normalized } });
        return;
      }
      res.status(401).json({ message: "Email hoặc mật khẩu không đúng." });
    } catch (err) {
      next(err);
    }
  });

  const existingEmails = new Set(["taken@example.com"]);
  router.post("/register", async (req, res, next) => {
    try {
      if (registerHandler) {
        await registerHandler(req, res);
        return;
      }
      const input = registerSchema.parse(req.body);
      const email = input.email.toLowerCase();
      if (existingEmails.has(email)) {
        res.status(409).json({ message: "Email này đã được sử dụng." });
        return;
      }
      existingEmails.add(email);
      res.status(201).json({ token: "jwt-reg-token", user: { id: "u-new", email, name: input.name } });
    } catch (err) {
      next(err);
    }
  });

  app.use("/api/auth", router);
  app.use((error, _req, res, _next) => {
    if (error instanceof ZodError) {
      res.status(400).json({ message: error.issues[0]?.message ?? "Dữ liệu không hợp lệ." });
      return;
    }
    if (error instanceof SyntaxError) {
      res.status(400).json({ message: "JSON không hợp lệ." });
      return;
    }
    res.status(500).json({ message: "Đã xảy ra lỗi máy chủ." });
  });

  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api/auth`;

  async function req(path, { method = "POST", headers = {}, body, rawBody } = {}) {
    const finalHeaders = {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    };
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: finalHeaders,
      ...(rawBody !== undefined ? { body: rawBody } : body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, headers: res.headers, data: json, rawText: text };
  }

  try {
    await fn({ req, limiters, baseUrl, port });
  } finally {
    await limiters.shutdown();
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

test("Unit: TRUST_PROXY strict validation rejects true, numeric hops, wildcards, and malformed CIDRs", () => {
  assert.equal(parseTrustProxySetting(undefined), false);
  assert.equal(parseTrustProxySetting(""), false);
  assert.equal(parseTrustProxySetting("   "), false);
  assert.equal(parseTrustProxySetting("false"), false);
  assert.equal(parseTrustProxySetting("FALSE"), false);

  for (const dangerous of ["true", "TRUE", "1", "2", "0", "-1", "loopback", "uniquelocal", "linklocal", "0.0.0.0/0", "::/0", "10.0.0.1/33", "127.0.0.1,", "bad-cidr/x", "not-an-ip"]) {
    assert.throws(() => parseTrustProxySetting(dangerous), Error, `Expected error for TRUST_PROXY=${dangerous}`);
  }

  assert.deepEqual(parseTrustProxySetting("127.0.0.1"), ["127.0.0.1"]);
  assert.deepEqual(parseTrustProxySetting("127.0.0.1, 172.18.0.0/16, ::1, 2001:db8::/32"), [
    "127.0.0.1",
    "172.18.0.0/16",
    "::1",
    "2001:db8::/32",
  ]);
});

test("Unit: env defaults, positive int validation, email normalization, HMAC privacy, and independent stores", () => {
  const defaults = readAuthRateLimitSettings({});
  assert.deepEqual(defaults, DEFAULT_AUTH_RATE_LIMIT_CONFIG);
  assert.throws(() => parsePositiveIntSetting("0", 10, "AUTH_LOGIN_IP_MAX"));
  assert.throws(() => parsePositiveIntSetting("-5", 10, "AUTH_LOGIN_IP_MAX"));
  assert.throws(() => parsePositiveIntSetting("abc", 10, "AUTH_LOGIN_IP_MAX"));
  assert.throws(() => parsePositiveIntSetting(String(2 ** 31), 1000, "AUTH_LOGIN_IP_WINDOW_MS", 2 ** 31 - 1));

  assert.equal(normalizeAuthEmail("  Alice@Example.COM "), "alice@example.com");
  assert.equal(normalizeAuthEmail("   "), null);
  assert.equal(normalizeAuthEmail(12345), null);
  assert.equal(normalizeAuthEmail(undefined), null);

  const secretA = Buffer.from("secret-key-a-32bytes-minimum-padding", "utf8");
  const secretB = Buffer.from("secret-key-b-32bytes-minimum-padding", "utf8");
  const email = normalizeAuthEmail(" Alice@Example.COM ");
  const keyA = formatLoginIpAccountKey("198.51.100.1", email, secretA);
  const keyB = formatLoginIpAccountKey("198.51.100.1", email, secretB);
  assert.match(keyA, /^login:ip-account:198\.51\.100\.1:[0-9a-f]{64}$/);
  assert.notEqual(keyA, keyB);
  assert.equal(keyA.toLowerCase().includes("alice"), false);
  assert.equal(keyA.toLowerCase().includes("example"), false);
  assert.notEqual(createEmailHmac(email, secretA), createEmailHmac("bob@example.com", secretA));

  // Verify express-rate-limit ipKeyGenerator normalization across IPv4, IPv4-mapped IPv6, and /56 IPv6
  assert.equal(ipKeyGenerator("203.0.113.5", 56), "203.0.113.5");
  assert.equal(ipKeyGenerator("::ffff:203.0.113.5", 56), "203.0.113.5");
  assert.notEqual(ipKeyGenerator("::ffff:203.0.113.5", 56), ipKeyGenerator("::ffff:198.51.100.9", 56));
  const v6SameA = ipKeyGenerator("2001:db8:85a3:1201::1", 56);
  const v6SameB = ipKeyGenerator("2001:db8:85a3:12ff::99", 56);
  const v6Diff = ipKeyGenerator("2001:db8:85a3:1300::1", 56);
  assert.equal(v6SameA, v6SameB);
  assert.notEqual(v6SameA, v6Diff);

  const limiters = createAuthRateLimiters();
  assert.notEqual(limiters.stores.loginAccount, limiters.stores.loginIp);
  assert.notEqual(limiters.stores.loginIp, limiters.stores.registerIp);
  assert.notEqual(limiters.stores.loginAccount, limiters.stores.registerIp);
  return limiters.shutdown();
});

test("Login L1/L2, HTTP 429 contract, success skipping, email normalization, missing/bad email handling, and preflight", async () => {
  await withHttpApp(
    {
      trustProxy: "127.0.0.1",
      rateLimitOptions: {
        settings: {
          loginIpEmailMax: 3,
          loginIpEmailWindowMs: 60_000,
          loginIpMax: 7,
          loginIpWindowMs: 60_000,
          registerIpMax: 3,
          registerIpWindowMs: 60_000,
        },
      },
    },
    async ({ req }) => {
      const ipHeaders = { "X-Forwarded-For": "198.51.100.10" };

      // OPTIONS preflight never consumes login/register quota
      for (let i = 0; i < 5; i++) {
        const pre = await req("/login", {
          method: "OPTIONS",
          headers: {
            Origin: "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            ...ipHeaders,
          },
        });
        assert.equal(pre.status, 204);
      }

      // Missing/non-string email hits 400 validation without polluting L1 shared bucket
      for (const badBody of [{}, { email: 123 }, { email: "   " }]) {
        const res = await req("/login", { headers: ipHeaders, body: badBody });
        assert.equal(res.status, 400);
      }

      // Check Alice under L1: 2 failures + 2 successes (total 4 more requests -> 7 total IP requests! Wait: keep L2 headroom)
      // Use fresh IP_2 for clean L1 vs L2 assertions:
      const ip2 = { "X-Forwarded-For": "198.51.100.11" };
      // 2 failures (different case/spacing normalized identically!)
      assert.equal((await req("/login", { headers: ip2, body: { email: " Alice@Example.COM ", password: "wrong-password-1" } })).status, 401);
      assert.equal((await req("/login", { headers: ip2, body: { email: "alice@example.com", password: "wrong-password-2" } })).status, 401);
      // Successful 200 does NOT count toward L1 (still allowed up to remaining failure!)
      assert.equal((await req("/login", { headers: ip2, body: { email: "alice@example.com", password: "CorrectPass123!" } })).status, 200);
      assert.equal((await req("/login", { headers: ip2, body: { email: "Alice@Example.com", password: "CorrectPass123!" } })).status, 200);
      // 3rd failure counts toward L1 (reaches max=3, still passes handler -> 401)
      assert.equal((await req("/login", { headers: ip2, body: { email: "alice@example.com", password: "wrong-password-3" } })).status, 401);
      // 4th attempt for same IP + email exceeds L1 -> 429!
      const blockedL1 = await req("/login", { headers: ip2, body: { email: "ALICE@example.com", password: "CorrectPass123!" } });
      assert.equal(blockedL1.status, 429);
      assert.deepEqual(blockedL1.data, { message: AUTH_RATE_LIMIT_MESSAGE });
      assert.ok(Number(blockedL1.headers.get("retry-after")) >= 1);
      assert.match(blockedL1.headers.get("ratelimit") ?? "", /auth-login-ip-account/);
      assert.match(blockedL1.headers.get("ratelimit-policy") ?? "", /auth-login-ip-account/);
      assert.equal(blockedL1.headers.get("x-ratelimit-limit"), null);
      assert.match(blockedL1.headers.get("access-control-expose-headers") ?? "", /Retry-After/i);
      assert.match(blockedL1.headers.get("access-control-expose-headers") ?? "", /RateLimit/i);

      // Different email on SAME IP does NOT collide with Alice's L1 quota, and hitting L2 (total 7) returns same 429 message!
      // Currently ip2 has used 6 total hits in L2 (401, 401, 200, 200, 401, and blockedL1 hit L2 BEFORE L1!).
      // So 7th hit with another email still succeeds/401s on L2!
      const otherEmail7 = await req("/login", { headers: ip2, body: { email: "valid-bob@example.com", password: "CorrectPass123!" } });
      assert.equal(otherEmail7.status, 200);
      // 8th hit exceeds L2 (including 200 responses!) -> 429 with identical JSON body as L1!
      const blockedL2 = await req("/login", { headers: ip2, body: { email: "valid-carol@example.com", password: "CorrectPass123!" } });
      assert.equal(blockedL2.status, 429);
      assert.deepEqual(blockedL2.data, blockedL1.data);
      assert.ok(Number(blockedL2.headers.get("retry-after")) >= 1);
      assert.match(blockedL2.headers.get("ratelimit") ?? "", /auth-login-ip/);
    },
  );
});

test("Account Lockout DoS prevention & Shared NAT / Password Spraying isolation", async () => {
  await withHttpApp(
    {
      trustProxy: "127.0.0.1",
      rateLimitOptions: {
        settings: {
          loginIpEmailMax: 2,
          loginIpEmailWindowMs: 60_000,
          loginIpMax: 5,
          loginIpWindowMs: 60_000,
        },
      },
    },
    async ({ req }) => {
      const attackerIp = { "X-Forwarded-For": "203.0.113.99" };
      const aliceIp = { "X-Forwarded-For": "198.51.100.55" };

      // Attacker IP_B exhausts Alice's L1 quota
      assert.equal((await req("/login", { headers: attackerIp, body: { email: "alice@example.com", password: "bad-password-1" } })).status, 401);
      assert.equal((await req("/login", { headers: attackerIp, body: { email: "alice@example.com", password: "bad-password-2" } })).status, 401);
      assert.equal((await req("/login", { headers: attackerIp, body: { email: "alice@example.com", password: "bad-password-3" } })).status, 429);

      // Legitimate Alice from IP_A STILL succeeds (200) -> no global account lockout DoS
      assert.equal((await req("/login", { headers: aliceIp, body: { email: "alice@example.com", password: "CorrectPass123!" } })).status, 200);

      // Shared NAT IP sending 5 different emails passes L1 cleanly until L2 total limit (5), then 6th triggers 429 while other IP remains unaffected
      const natIp = { "X-Forwarded-For": "198.51.100.77" };
      for (let i = 0; i < 5; i++) {
        const res = await req("/login", {
          headers: natIp,
          body: { email: `valid-nat-${i}@example.com`, password: "CorrectPass123!" },
        });
        assert.equal(res.status, 200);
      }
      assert.equal((await req("/login", { headers: natIp, body: { email: "valid-nat-99@example.com", password: "CorrectPass123!" } })).status, 429);
      assert.equal((await req("/login", { headers: aliceIp, body: { email: "alice@example.com", password: "CorrectPass123!" } })).status, 200);
    },
  );
});

test("Register R1 counts 201, 400, 409, and malformed JSON before parser while preserving validation & independent IPs", async () => {
  await withHttpApp(
    {
      trustProxy: "127.0.0.1",
      rateLimitOptions: {
        settings: {
          registerIpMax: 4,
          registerIpWindowMs: 60_000,
        },
      },
    },
    async ({ req }) => {
      const ip1 = { "X-Forwarded-For": "198.51.100.30" };
      const ip2 = { "X-Forwarded-For": "198.51.100.31" };

      // 1) Valid 201
      assert.equal((await req("/register", { headers: ip1, body: { name: "User One", email: "one@example.com", password: "Password123!" } })).status, 201);
      // 2) Duplicate 409 (counts toward R1)
      assert.equal((await req("/register", { headers: ip1, body: { name: "Taken", email: "taken@example.com", password: "Password123!" } })).status, 409);
      // 3) Zod validation 400 (counts toward R1)
      assert.equal((await req("/register", { headers: ip1, body: { name: "X", email: "bad", password: "123" } })).status, 400);
      // 4) Malformed JSON 400 before/at parser (counts toward R1!)
      assert.equal(
        (
          await req("/register", {
            headers: { "Content-Type": "application/json", ...ip1 },
            rawBody: "{not-json",
          })
        ).status,
        400,
      );
      // 5) Over R1 -> 429 (even malformed JSON blocked BEFORE parser!)
      const blocked = await req("/register", {
        headers: { "Content-Type": "application/json", ...ip1 },
        rawBody: "{not-json",
      });
      assert.equal(blocked.status, 429);
      assert.deepEqual(blocked.data, { message: AUTH_RATE_LIMIT_MESSAGE });
      assert.ok(Number(blocked.headers.get("retry-after")) >= 1);
      assert.match(blocked.headers.get("ratelimit") ?? "", /auth-register-ip/);

      // Different IP still has full register quota
      assert.equal((await req("/register", { headers: ip2, body: { name: "User Two", email: "two@example.com", password: "Password123!" } })).status, 201);
    },
  );
});

test("Proxy spoofing tests: TRUST_PROXY=false ignores XFF/X-Real-IP; trusted CIDR ignores left-spoofed XFF and normalizes IPv4-mapped & IPv6 /56", async () => {
  // 1) TRUST_PROXY=false ignores spoofed headers completely
  await withHttpApp(
    {
      trustProxy: false,
      rateLimitOptions: {
        logger: { warn: () => {}, error: () => {} },
        settings: { registerIpMax: 2, registerIpWindowMs: 60_000 },
      },
    },
    async ({ req }) => {
      assert.equal(
        (await req("/register", {
          headers: { "X-Forwarded-For": "1.1.1.1", "X-Real-IP": "1.1.1.2" },
          body: { name: "NoProxy A", email: "np1@example.com", password: "Password123!" },
        })).status,
        201,
      );
      assert.equal(
        (await req("/register", {
          headers: { "X-Forwarded-For": "2.2.2.2", "X-Real-IP": "2.2.2.3" },
          body: { name: "NoProxy B", email: "np2@example.com", password: "Password123!" },
        })).status,
        201,
      );
      assert.equal(
        (await req("/register", {
          headers: { "X-Forwarded-For": "3.3.3.3", "X-Real-IP": "3.3.3.4" },
          body: { name: "NoProxy C", email: "np3@example.com", password: "Password123!" },
        })).status,
        429,
      );
    },
  );

  // 2) Trusted reverse proxy CIDR (127.0.0.1) blocks left-spoofed XFF and handles IPv4-mapped IPv6 + IPv6 /56 cleanly
  await withHttpApp(
    {
      trustProxy: "127.0.0.1",
      rateLimitOptions: {
        settings: { registerIpMax: 2, registerIpWindowMs: 60_000 },
      },
    },
    async ({ req }) => {
      // Attacker rotates left-side spoofed XFF while proxy appends true client IP 203.0.113.45 -> shares 1 bucket!
      assert.equal(
        (await req("/register", {
          headers: { "X-Forwarded-For": "8.8.8.8, 203.0.113.45" },
          body: { name: "Proxy A", email: "pa@example.com", password: "Password123!" },
        })).status,
        201,
      );
      // Second attempt arrives as IPv4-mapped IPv6 ::ffff:203.0.113.45 with different spoofed left header -> SAME bucket!
      assert.equal(
        (await req("/register", {
          headers: { "X-Forwarded-For": "9.9.9.9, ::ffff:203.0.113.45" },
          body: { name: "Proxy B", email: "pb@example.com", password: "Password123!" },
        })).status,
        201,
      );
      assert.equal(
        (await req("/register", {
          headers: { "X-Forwarded-For": "4.4.4.4, 203.0.113.45" },
          body: { name: "Proxy C", email: "pc@example.com", password: "Password123!" },
        })).status,
        429,
      );

      // Distinct IPv4-mapped IPv6 address must NOT collapse into 203.0.113.45 bucket
      assert.equal(
        (await req("/register", {
          headers: { "X-Forwarded-For": "::ffff:203.0.113.46" },
          body: { name: "Proxy D", email: "pd@example.com", password: "Password123!" },
        })).status,
        201,
      );

      // Two IPv6 addresses in the SAME /56 share quota; a different /56 stays independent
      assert.equal(
        (await req("/register", {
          headers: { "X-Forwarded-For": "2001:db8:aaaa:0001::1" },
          body: { name: "V6 A", email: "v6a@example.com", password: "Password123!" },
        })).status,
        201,
      );
      assert.equal(
        (await req("/register", {
          headers: { "X-Forwarded-For": "2001:db8:aaaa:00ff::99" },
          body: { name: "V6 B", email: "v6b@example.com", password: "Password123!" },
        })).status,
        201,
      );
      assert.equal(
        (await req("/register", {
          headers: { "X-Forwarded-For": "2001:db8:aaaa:0042::7" },
          body: { name: "V6 C", email: "v6c@example.com", password: "Password123!" },
        })).status,
        429,
      );
      assert.equal(
        (await req("/register", {
          headers: { "X-Forwarded-For": "2001:db8:aaaa:0100::1" },
          body: { name: "V6 Other", email: "v6other@example.com", password: "Password123!" },
        })).status,
        201,
      );
    },
  );
});

test("Failure handling: passOnStoreError=true allows requests through and logs never expose email, password, or JWT", async () => {
  const loggedPayloads = [];
  const throwingStore = {
    localKeys: true,
    increment: async () => {
      throw new Error("Simulated MemoryStore failure");
    },
    decrement: async () => {},
    resetKey: async () => {},
  };

  await withHttpApp(
    {
      rateLimitOptions: {
        settings: { loginIpMax: 1, loginIpEmailMax: 1 },
        stores: {
          loginIp: throwingStore,
          loginAccount: { ...throwingStore },
          registerIp: { ...throwingStore },
        },
        logger: {
          error: (err, msg) => loggedPayloads.push(String(err) + " " + String(msg ?? "")),
          warn: (err, msg) => loggedPayloads.push(String(err) + " " + String(msg ?? "")),
        },
      },
    },
    async ({ req }) => {
      const secretPass = "CorrectPass123!";
      const sensitiveEmail = "alice@example.com";
      const loginOk = await req("/login", { body: { email: sensitiveEmail, password: secretPass } });
      assert.equal(loginOk.status, 200);
      const loginFail = await req("/login", { body: { email: sensitiveEmail, password: "UltraSecretWrongPassword!" } });
      assert.equal(loginFail.status, 401);
      const regOk = await req("/register", { body: { name: "FailOpen", email: "failopen@example.com", password: secretPass } });
      assert.equal(regOk.status, 201);

      assert.ok(loggedPayloads.length >= 1);
      const combinedLogs = loggedPayloads.join("\n");
      assert.equal(combinedLogs.includes(secretPass), false);
      assert.equal(combinedLogs.includes("UltraSecretWrongPassword!"), false);
      assert.equal(combinedLogs.includes(sensitiveEmail), false);
      assert.equal(combinedLogs.includes("failopen@example.com"), false);
      assert.equal(combinedLogs.includes("jwt-token-secret-should-not-log"), false);
    },
  );
});

test("Window-boundary regression: slow 200 request finishing after window reset does NOT decrement next window quota", async () => {
  await withHttpApp(
    {
      trustProxy: "127.0.0.1",
      rateLimitOptions: {
        settings: {
          loginIpEmailMax: 2,
          loginIpEmailWindowMs: 250,
          loginIpMax: 20,
          loginIpWindowMs: 60_000,
        },
      },
      loginHandler: async (req, res) => {
        const input = credentialsSchema.parse(req.body);
        if (input.password === "SlowValidPass123!") {
          await new Promise((r) => setTimeout(r, 400));
          res.status(200).json({ token: "ok" });
          return;
        }
        res.status(401).json({ message: "Email hoặc mật khẩu không đúng." });
      },
    },
    async ({ req }) => {
      const headers = { "X-Forwarded-For": "198.51.100.88" };

      // Start slow successful request in window 1 (takes 400ms > 250ms window)
      const slowWin1Promise = req("/login", {
        headers,
        body: { email: "window@example.com", password: "SlowValidPass123!" },
      });

      // Wait until window 1 definitely expired (300ms > 250ms), while slow request is STILL running
      await new Promise((r) => setTimeout(r, 300));

      // Trigger failure #1 inside window 2 (resets to hits=1 in new window)
      assert.equal(
        (await req("/login", { headers, body: { email: "window@example.com", password: "BadPassword1!" } })).status,
        401,
      );

      // Now wait for slow request from window 1 to finish 200
      const slowRes = await slowWin1Promise;
      assert.equal(slowRes.status, 200);

      // Window 2 must still have hits=1 (NOT decremented back to 0 by window 1's late finish):
      // Failure #2 allowed (hits=2 == max), failure #3 MUST hit 429!
      assert.equal(
        (await req("/login", { headers, body: { email: "window@example.com", password: "BadPassword2!" } })).status,
        401,
      );
      assert.equal(
        (await req("/login", { headers, body: { email: "window@example.com", password: "BadPassword3!" } })).status,
        429,
      );
    },
  );
});

test("Real compiled server (dist/index.js) E2E rate limiting + PostgreSQL auth + CORS headers", async () => {
  const port = 3468;
  const clientUrl = "http://localhost:5173";
  const ts = Date.now();
  const aliceEmail = `rl_alice_${ts}@test.local`;
  const testEmails = [aliceEmail, `rl_bob_${ts}@test.local`, `rl_charlie_${ts}@test.local`];

  const env = {
    ...process.env,
    PORT: String(port),
    CLIENT_URL: clientUrl,
    TRUST_PROXY: "false",
    AUTH_LOGIN_IP_EMAIL_MAX: "2",
    AUTH_LOGIN_IP_EMAIL_WINDOW_MS: "60000",
    AUTH_LOGIN_IP_MAX: "6",
    AUTH_LOGIN_IP_WINDOW_MS: "60000",
    AUTH_REGISTER_IP_MAX: "3",
    AUTH_REGISTER_IP_WINDOW_MS: "60000",
  };
  const proc = spawn("node", ["dist/index.js"], { env, stdio: ["ignore", "pipe", "pipe"] });

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
    assert.equal(ready, true, "Test rate-limit server failed to start");

    const api = async (path, body, extraHeaders = {}) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/auth${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...extraHeaders },
        body: JSON.stringify(body),
      });
      return { status: res.status, headers: res.headers, data: await res.json() };
    };

    // Register 3 requests max on test server: 201 + 409 + 201, then 4th hits 429
    assert.equal((await api("/register", { name: "Alice", email: aliceEmail, password: "Password@123" })).status, 201);
    assert.equal((await api("/register", { name: "Alice Dup", email: aliceEmail, password: "Password@123" })).status, 409);
    assert.equal((await api("/register", { name: "Bob", email: testEmails[1], password: "Password@123" })).status, 201);

    const regBlocked = await api("/register", { name: "Charlie", email: testEmails[2], password: "Password@123" }, { Origin: clientUrl });
    assert.equal(regBlocked.status, 429);
    assert.deepEqual(regBlocked.data, { message: AUTH_RATE_LIMIT_MESSAGE });
    assert.ok(Number(regBlocked.headers.get("retry-after")) >= 1);
    assert.match(regBlocked.headers.get("ratelimit") ?? "", /auth-register-ip/);
    assert.match(regBlocked.headers.get("access-control-expose-headers") ?? "", /Retry-After/i);

    // Login real DB user: 200 ok, 2 failed 401 -> 3rd attempt hits L1 429
    assert.equal((await api("/login", { email: aliceEmail, password: "Password@123" })).status, 200);
    assert.equal((await api("/login", { email: ` ${aliceEmail.toUpperCase()} `, password: "WrongPassword@1" })).status, 401);
    assert.equal((await api("/login", { email: aliceEmail, password: "WrongPassword@2" })).status, 401);
    const loginBlocked = await api("/login", { email: aliceEmail, password: "Password@123" });
    assert.equal(loginBlocked.status, 429);
    assert.deepEqual(loginBlocked.data, { message: AUTH_RATE_LIMIT_MESSAGE });
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
      /* ignore cleanup error if DB wasn't used */
    }
  }
});
