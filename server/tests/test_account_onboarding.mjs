import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import express from "express";
import { Server as SocketServer } from "socket.io";
import { io as ioClient } from "../../client/node_modules/socket.io-client/build/esm/index.js";
import {
  buildOtpAuthUri,
  consumeRecoveryCode,
  generateRecoveryCodes,
  generateTotpCode,
  generateTotpSecret,
  verifyTotpCode,
} from "../dist/lib/totp.js";
import {
  buildOAuthAuthorizeUrl,
  createOAuthStateToken,
  verifyOAuthStateToken,
} from "../dist/lib/oauth.js";
import { prisma } from "../dist/lib/prisma.js";
import { createAuthRouter } from "../dist/routes/auth.js";
import { createInviteRouter } from "../dist/routes/invites.js";
import { createWorkspaceRouter } from "../dist/routes/workspaces.js";
import { attachRoomSocket } from "../dist/sockets/room.socket.js";

process.env.JWT_SECRET ||= "test_jwt_secret_for_account_onboarding_suite";

async function startTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", createAuthRouter(prisma));
  app.use("/api/workspaces", createWorkspaceRouter(prisma));
  app.use("/api/invites", createInviteRouter(prisma));
  app.use((err, _req, res, _next) => {
    if (err?.name === "ZodError") {
      res.status(400).json({ message: err.issues[0]?.message ?? "Dữ liệu không hợp lệ." });
      return;
    }
    res.status(500).json({ message: err?.message ?? "Server error" });
  });

  const server = http.createServer(app);
  const io = new SocketServer(server);
  attachRoomSocket(io, prisma);

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise((resolve) => io.close(resolve));
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

test("TOTP generator/verifier follows RFC 6238 and recovery codes are single-use", () => {
  // RFC 6238 ASCII "12345678901234567890" -> Base32 GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ
  const rfcSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  assert.equal(generateTotpCode(rfcSecret, 59_000), "287082");

  const secret = generateTotpSecret();
  const uri = buildOtpAuthUri({ secret, accountEmail: "alice@bifrost.dev" });
  assert.ok(uri.startsWith("otpauth://totp/Bifrost:alice%40bifrost.dev?"));

  const code = generateTotpCode(secret);
  assert.equal(verifyTotpCode(secret, code), true);
  assert.equal(verifyTotpCode(secret, "000000"), false);

  const { rawCodes, hashes } = generateRecoveryCodes(4);
  assert.equal(rawCodes.length, 4);
  const firstUse = consumeRecoveryCode(rawCodes[0], hashes);
  assert.equal(firstUse.matched, true);
  assert.equal(firstUse.remainingHashes.length, 3);
  const replayUse = consumeRecoveryCode(rawCodes[0], firstUse.remainingHashes);
  assert.equal(replayUse.matched, false);
});

test("OAuth2 state tokens validate CSRF nonce and build Google/GitHub authorize URLs", () => {
  const token = createOAuthStateToken({
    provider: "github",
    nonce: "nonce-123",
    inviteToken: "inv-abc",
  });
  const decoded = verifyOAuthStateToken(token);
  assert.equal(decoded.provider, "github");
  assert.equal(decoded.nonce, "nonce-123");
  assert.equal(decoded.inviteToken, "inv-abc");

  const ghUrl = buildOAuthAuthorizeUrl("github", token, {
    GITHUB_CLIENT_ID: "gh_client",
    GITHUB_REDIRECT_URI: "http://localhost:3000/api/auth/oauth/github/callback",
  });
  assert.ok(ghUrl?.startsWith("https://github.com/login/oauth/authorize?"));
});

test("E2E: Email OTP, Forgot/Reset Password, 2FA TOTP, 1-Click Invite & Call Notification", async () => {
  const srv = await startTestApp();
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const ownerEmail = `owner-onboard-${suffix}@bifrost.dev`;
  const guestEmail = `guest-onboard-${suffix}@bifrost.dev`;
  const createdUserIds = [];

  try {
    // 1. Register Owner + Verify Email OTP
    const regOwnerRes = await fetch(`${srv.baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Alice Owner",
        email: ownerEmail,
        password: "Password123!",
      }),
    });
    assert.equal(regOwnerRes.status, 201);
    const regOwner = await regOwnerRes.json();
    createdUserIds.push(regOwner.user.id);
    assert.equal(regOwner.user.emailVerified, false);
    assert.match(regOwner.devVerificationCode, /^\d{6}$/);

    const verifyRes = await fetch(`${srv.baseUrl}/api/auth/verify-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${regOwner.token}`,
      },
      body: JSON.stringify({ code: regOwner.devVerificationCode }),
    });
    assert.equal(verifyRes.status, 200);
    const verified = await verifyRes.json();
    assert.equal(verified.user.emailVerified, true);

    // 2. Forgot Password + Reset Password OTP
    const forgotRes = await fetch(`${srv.baseUrl}/api/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: ownerEmail }),
    });
    assert.equal(forgotRes.status, 200);
    const forgotBody = await forgotRes.json();
    assert.match(forgotBody.devResetCode, /^\d{6}$/);

    const resetRes = await fetch(`${srv.baseUrl}/api/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: ownerEmail,
        code: forgotBody.devResetCode,
        newPassword: "NewPassword456!",
      }),
    });
    assert.equal(resetRes.status, 200);

    // Old refresh token must be revoked after password reset
    const staleRefresh = await fetch(`${srv.baseUrl}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: regOwner.refreshToken }),
    });
    assert.equal(staleRefresh.status, 401);

    // Login with new password
    const loginNewRes = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: ownerEmail, password: "NewPassword456!" }),
    });
    assert.equal(loginNewRes.status, 200);
    let ownerSession = await loginNewRes.json();

    // 3. Setup & Enable 2FA TOTP, then test 2FA Login Challenge
    const setup2faRes = await fetch(`${srv.baseUrl}/api/auth/2fa/setup`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ownerSession.token}` },
    });
    assert.equal(setup2faRes.status, 200);
    const { secret } = await setup2faRes.json();

    const enable2faRes = await fetch(`${srv.baseUrl}/api/auth/2fa/enable`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ownerSession.token}`,
      },
      body: JSON.stringify({ code: generateTotpCode(secret) }),
    });
    assert.equal(enable2faRes.status, 200);
    const enableBody = await enable2faRes.json();
    assert.equal(enableBody.user.twoFactorEnabled, true);
    assert.equal(enableBody.recoveryCodes.length, 8);

    const challengeLoginRes = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: ownerEmail, password: "NewPassword456!" }),
    });
    assert.equal(challengeLoginRes.status, 200);
    const challengeBody = await challengeLoginRes.json();
    assert.equal(challengeBody.requiresTwoFactor, true);
    assert.ok(challengeBody.challengeToken);

    const verify2faRes = await fetch(`${srv.baseUrl}/api/auth/2fa/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        challengeToken: challengeBody.challengeToken,
        code: generateTotpCode(secret),
      }),
    });
    assert.equal(verify2faRes.status, 200);
    ownerSession = await verify2faRes.json();
    assert.ok(ownerSession.token);

    // 4. Create Workspace & 1-Click Invite for unregistered Guest Email
    const wsRes = await fetch(`${srv.baseUrl}/api/workspaces`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ownerSession.token}`,
      },
      body: JSON.stringify({ name: "Onboarding Lab" }),
    });
    assert.equal(wsRes.status, 201);
    const { workspace } = await wsRes.json();

    const inviteRes = await fetch(`${srv.baseUrl}/api/workspaces/${workspace.id}/invites`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ownerSession.token}`,
      },
      body: JSON.stringify({ email: guestEmail }),
    });
    assert.equal(inviteRes.status, 201);
    const { inviteToken } = await inviteRes.json();

    const previewRes = await fetch(`${srv.baseUrl}/api/invites/${inviteToken}`);
    assert.equal(previewRes.status, 200);
    const previewBody = await previewRes.json();
    assert.equal(previewBody.invite.workspaceName, "Onboarding Lab");

    // Guest registers AFTER receiving invite, then accepts 1-click invite
    const regGuestRes = await fetch(`${srv.baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Bob Guest",
        email: guestEmail,
        password: "Password123!",
      }),
    });
    assert.equal(regGuestRes.status, 201);
    const guestSession = await regGuestRes.json();
    createdUserIds.push(guestSession.user.id);

    const acceptRes = await fetch(`${srv.baseUrl}/api/invites/${inviteToken}/accept`, {
      method: "POST",
      headers: { Authorization: `Bearer ${guestSession.token}` },
    });
    assert.equal(acceptRes.status, 200);
    const accepted = await acceptRes.json();
    assert.equal(accepted.workspace.id, workspace.id);

    // 5. Real-time Incoming Room Call Notification (workspace:room-active)
    const roomRes = await fetch(`${srv.baseUrl}/api/workspaces/${workspace.id}/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ownerSession.token}`,
      },
      body: JSON.stringify({ name: "Daily Standup" }),
    });
    assert.equal(roomRes.status, 201);
    const { room } = await roomRes.json();

    // Assign Guest to room so Guest receives room call alert
    await fetch(`${srv.baseUrl}/api/workspaces/${workspace.id}/members/${guestSession.user.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ownerSession.token}`,
      },
      body: JSON.stringify({ roomId: room.id, roomRole: "MEMBER" }),
    });

    const guestSocket = ioClient(srv.baseUrl, {
      auth: { token: guestSession.token },
      transports: ["websocket"],
    });
    const ownerSocket = ioClient(srv.baseUrl, {
      auth: { token: ownerSession.token },
      transports: ["websocket"],
    });

    await Promise.all([
      new Promise((resolve) => guestSocket.once("connect", resolve)),
      new Promise((resolve) => ownerSocket.once("connect", resolve)),
    ]);

    const callAlertPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for workspace:room-active")), 4000);
      guestSocket.once("workspace:room-active", (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });

    ownerSocket.emit("room:join", room.id);
    const alertPayload = await callAlertPromise;
    assert.equal(alertPayload.roomId, room.id);
    assert.equal(alertPayload.roomName, "Daily Standup");
    assert.equal(alertPayload.caller.id, ownerSession.user.id);

    guestSocket.disconnect();
    ownerSocket.disconnect();
  } finally {
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await srv.close();
  }
});
