import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { ZodError } from "zod";

process.env.JWT_SECRET ??= "unit-test-jwt-secret-only";
process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:5432/unused";

const { createAccessToken } = await import("../dist/lib/auth.js");
const { Prisma } = await import("../dist/generated/prisma/client.js");
const { isPrismaRecordNotFoundError } = await import("../dist/lib/validation.js");
const { createWorkspaceRouter } = await import("../dist/routes/workspaces.js");
const { createRoomRouter } = await import("../dist/routes/rooms.js");

const VALID_OWNER_ID = "11111111-1111-4111-8111-111111111111";
const VALID_MEMBER_ID = "22222222-2222-4222-8222-222222222222";
const VALID_WS_ID = "33333333-3333-4333-8333-333333333333";
const VALID_ROOM_ID = "44444444-4444-4444-8444-444444444444";

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

async function withServer(dbOverrides, fn, routerOptions = {}) {
  const { db, calls } = createStrictPrismaSpy(dbOverrides);
  const app = express();
  app.use(express.json());
  app.use("/api/workspaces", createWorkspaceRouter(db, routerOptions));
  app.use("/api/rooms", createRoomRouter(db));
  app.use((error, _request, response, _next) => {
    if (error instanceof ZodError) {
      response.status(400).json({ message: error.issues[0]?.message ?? "Dữ liệu không hợp lệ." });
      return;
    }
    response.status(500).json({ message: "Đã xảy ra lỗi máy chủ." });
  });

  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/api`;
  const ownerToken = createAccessToken({ id: VALID_OWNER_ID, email: "owner@example.com" });

  async function api(path, { method = "GET", token = ownerToken, body } = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return {
      status: res.status,
      data: text ? JSON.parse(text) : null,
    };
  }

  try {
    await fn({ api, calls });
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

test("isPrismaRecordNotFoundError matches only PrismaClientKnownRequestError P2025", () => {
  const p2025 = new Prisma.PrismaClientKnownRequestError("Record not found", {
    code: "P2025",
    clientVersion: "7.10.0",
  });
  const p2003 = new Prisma.PrismaClientKnownRequestError("Foreign key constraint", {
    code: "P2003",
    clientVersion: "7.10.0",
  });
  const fakeError = Object.assign(new Error("Fake P2025"), { code: "P2025" });

  assert.equal(isPrismaRecordNotFoundError(p2025), true);
  assert.equal(isPrismaRecordNotFoundError(p2003), false);
  assert.equal(isPrismaRecordNotFoundError(fakeError), false);
  assert.equal(isPrismaRecordNotFoundError(null), false);
});

test("malformed UUIDs return HTTP 400 across all workspace and room routes before calling Prisma", async () => {
  const malformedIds = ["not-a-uuid", "12345", "00000000-0000-0000-0000-00000000000g"];

  await withServer({}, async ({ api, calls }) => {
    for (const badId of malformedIds) {
      const checks = [
        await api(`/workspaces/${badId}`),
        await api(`/workspaces/${badId}/members`),
        await api(`/workspaces/${badId}/members`, {
          method: "POST",
          body: { email: "target@example.com" },
        }),
        await api(`/workspaces/${badId}/members/${VALID_MEMBER_ID}`, {
          method: "DELETE",
        }),
        await api(`/workspaces/${VALID_WS_ID}/members/${badId}`, {
          method: "DELETE",
        }),
        await api(`/workspaces/${badId}/rooms`),
        await api(`/workspaces/${badId}/rooms`, {
          method: "POST",
          body: { name: "Test Room" },
        }),
        await api(`/rooms/${badId}`),
      ];

      for (const res of checks) {
        assert.equal(res.status, 400);
        assert.equal(typeof res.data?.message, "string");
        assert.ok(res.data.message.length > 0);
      }
    }

    assert.equal(calls.length, 0, `Expected 0 Prisma calls on malformed UUIDs, got: ${JSON.stringify(calls)}`);

    // Unauthenticated request must still preserve 401 before UUID validation leaks parameter details
    const unauth = await api(`/workspaces/not-a-uuid`, { token: null });
    assert.equal(unauth.status, 401);
    assert.equal(calls.length, 0);
  });
});

test("DELETE /:workspaceId/members/:userId maps P2025 to 404 while preserving 204, 403, 400 self-removal, and 500 for unrelated errors", async () => {
  const hookEvents = [];
  await withServer(
    {
      workspaceMember: {
        findFirst: async ({ where }) => {
          if (where.userId === VALID_OWNER_ID && where.workspaceId === VALID_WS_ID) {
            return { workspaceId: VALID_WS_ID, userId: VALID_OWNER_ID, role: "OWNER" };
          }
          return null;
        },
        delete: async ({ where }) => {
          const { userId } = where.workspaceId_userId;
          if (userId === "55555555-5555-4555-8555-555555555555") {
            throw new Prisma.PrismaClientKnownRequestError("No record was found for a delete.", {
              code: "P2025",
              clientVersion: "7.10.0",
            });
          }
          if (userId === "66666666-6666-4666-8666-666666666666") {
            throw new Prisma.PrismaClientKnownRequestError("Foreign key failed", {
              code: "P2003",
              clientVersion: "7.10.0",
            });
          }
          if (userId === "77777777-7777-4777-8777-777777777777") {
            throw new Error("Transient database connection failure");
          }
          return { workspaceId: VALID_WS_ID, userId, role: "MEMBER" };
        },
      },
    },
    async ({ api }) => {
      const memberToken = createAccessToken({ id: VALID_MEMBER_ID, email: "member@example.com" });

      // Existing member removal by owner -> 204 + invokes onMemberRemoved once
      const okDelete = await api(`/workspaces/${VALID_WS_ID}/members/${VALID_MEMBER_ID}`, {
        method: "DELETE",
      });
      assert.equal(okDelete.status, 204);
      assert.equal(okDelete.data, null);
      assert.deepEqual(hookEvents, [{ workspaceId: VALID_WS_ID, userId: VALID_MEMBER_ID }]);

      // Non-existent member UUID -> 404 from P2025
      const notFound = await api(
        `/workspaces/${VALID_WS_ID}/members/55555555-5555-4555-8555-555555555555`,
        { method: "DELETE" },
      );
      assert.equal(notFound.status, 404);
      assert.equal(notFound.data?.message, "Thành viên không tồn tại trong workspace này.");

      // Non-owner attempts deletion -> 403 preserved
      const forbidden = await api(`/workspaces/${VALID_WS_ID}/members/${VALID_OWNER_ID}`, {
        method: "DELETE",
        token: memberToken,
      });
      assert.equal(forbidden.status, 403);

      // Owner attempts self-removal -> 400 preserved
      const selfDelete = await api(`/workspaces/${VALID_WS_ID}/members/${VALID_OWNER_ID}`, {
        method: "DELETE",
      });
      assert.equal(selfDelete.status, 400);
      assert.equal(selfDelete.data?.message, "Owner không thể tự xóa chính mình khỏi workspace.");

      // Unrelated Prisma error (e.g. P2003) must NOT become 400 or 404 -> 500
      const unrelatedPrisma = await api(
        `/workspaces/${VALID_WS_ID}/members/66666666-6666-4666-8666-666666666666`,
        { method: "DELETE" },
      );
      assert.equal(unrelatedPrisma.status, 500);
      assert.equal(unrelatedPrisma.data?.message, "Đã xảy ra lỗi máy chủ.");

      // Unrelated unexpected error must NOT become 400 or 404 -> 500
      const unexpected = await api(
        `/workspaces/${VALID_WS_ID}/members/77777777-7777-4777-8777-777777777777`,
        { method: "DELETE" },
      );
      assert.equal(unexpected.status, 500);
      assert.equal(unexpected.data?.message, "Đã xảy ra lỗi máy chủ.");

      // Malformed userId -> 400 without invoking eviction hook
      const badDelete = await api(`/workspaces/${VALID_WS_ID}/members/not-a-uuid`, {
        method: "DELETE",
      });
      assert.equal(badDelete.status, 400);

      // Eviction hook must NOT have fired for any failed delete above
      assert.equal(hookEvents.length, 1);
    },
    { onMemberRemoved: (event) => hookEvents.push(event) },
  );
});

test("valid existing GET workspace/members/room requests preserve semantics", async () => {
  await withServer(
    {
      workspaceMember: {
        findUnique: async () => null,
      },
      room: {
        findUnique: async ({ where }) => {
          assert.equal(where.id, VALID_ROOM_ID);
          return null;
        },
      },
    },
    async ({ api }) => {
      const wsGet = await api(`/workspaces/${VALID_WS_ID}`);
      assert.equal(wsGet.status, 403);

      const membersGet = await api(`/workspaces/${VALID_WS_ID}/members`);
      assert.equal(membersGet.status, 403);

      const roomGet = await api(`/rooms/${VALID_ROOM_ID}`);
      assert.equal(roomGet.status, 404);
    },
  );
});

test("malformed roomId and labelId UUIDs return HTTP 400 before calling Prisma", async () => {
  await withServer({}, async ({ api, calls }) => {
    const checks = [
      await api(`/workspaces/${VALID_WS_ID}/rooms/not-a-uuid`, {
        method: "PATCH",
        body: { name: "Updated Room" },
      }),
      await api(`/workspaces/${VALID_WS_ID}/rooms/not-a-uuid`, {
        method: "DELETE",
      }),
      await api(`/workspaces/${VALID_WS_ID}/rooms/not-a-uuid/roles`, {
        method: "POST",
        body: { name: "Design", color: "#53664b", priority: 10 },
      }),
      await api(`/workspaces/${VALID_WS_ID}/rooms/${VALID_ROOM_ID}/roles/not-a-uuid`, {
        method: "PATCH",
        body: { name: "Design", color: "#53664b", priority: 10 },
      }),
      await api(`/workspaces/${VALID_WS_ID}/rooms/${VALID_ROOM_ID}/roles/not-a-uuid`, {
        method: "DELETE",
      }),
    ];

    for (const res of checks) {
      assert.equal(res.status, 400);
    }
    assert.equal(calls.length, 0);
  });
});

test("PATCH /workspaces/:wsId/members/:userId enforces moderator escalation guard and invokes onRoomAccessRevoked on removal", async () => {
  const revokedEvents = [];
  await withServer(
    {
      workspaceMember: {
        findUnique: async ({ where }) => {
          const { workspaceId, userId } = where.workspaceId_userId;
          if (workspaceId !== VALID_WS_ID) return null;
          if (userId === VALID_OWNER_ID) return { workspaceId, userId, role: "OWNER" };
          if (userId === VALID_MEMBER_ID) return { workspaceId, userId, role: "MEMBER" };
          return null;
        },
      },
      roomMember: {
        findUnique: async ({ where }) => {
          const { userId } = where.workspaceId_roomId_userId;
          if (userId === VALID_MEMBER_ID) {
            return { workspaceId: VALID_WS_ID, roomId: VALID_ROOM_ID, userId, role: "MODERATOR", labelIds: [] };
          }
          return null;
        },
        deleteMany: async () => ({ count: 1 }),
        findFirst: async () => null,
      },
      room: {
        findFirst: async () => ({ id: VALID_ROOM_ID, workspaceId: VALID_WS_ID }),
        update: async () => ({ id: VALID_ROOM_ID, hostId: null }),
      },
    },
    async ({ api }) => {
      const modToken = createAccessToken({ id: VALID_MEMBER_ID, email: "mod@example.com" });

      // Moderator cannot promote someone to HOST
      const escalate = await api(`/workspaces/${VALID_WS_ID}/members/${VALID_MEMBER_ID}`, {
        method: "PATCH",
        token: modToken,
        body: { roomId: VALID_ROOM_ID, roomRole: "HOST" },
      });
      assert.equal(escalate.status, 403);

      // Owner can revoke room access (roomRole: null) and trigger Socket.IO eviction hook
      const revoke = await api(`/workspaces/${VALID_WS_ID}/members/${VALID_MEMBER_ID}`, {
        method: "PATCH",
        body: { roomId: VALID_ROOM_ID, roomRole: null },
      });
      assert.equal(revoke.status, 200);
      assert.equal(revoke.data?.updated, true);
      assert.deepEqual(revokedEvents, [
        { workspaceId: VALID_WS_ID, roomId: VALID_ROOM_ID, userId: VALID_MEMBER_ID },
      ]);
    },
    { onRoomAccessRevoked: (event) => revokedEvents.push(event) },
  );
});
