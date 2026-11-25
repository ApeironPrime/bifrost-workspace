import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import * as Y from "yjs";
import { prisma } from "../dist/lib/prisma.js";
import { getRoomCollabForUser, saveRoomCollabForUser } from "../dist/services/room.service.js";

test("CRDT collaborative document merges concurrent updates losslessly in PostgreSQL and enforces VIEWER ACL", async () => {
  const suffix = `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const owner = await prisma.user.create({
    data: {
      email: `crdt-owner-${suffix}@bifrost.dev`,
      name: "CRDT Owner",
      passwordHash: "hash",
    },
  });
  const member = await prisma.user.create({
    data: {
      email: `crdt-member-${suffix}@bifrost.dev`,
      name: "CRDT Member",
      passwordHash: "hash",
    },
  });
  const viewer = await prisma.user.create({
    data: {
      email: `crdt-viewer-${suffix}@bifrost.dev`,
      name: "CRDT Viewer",
      passwordHash: "hash",
    },
  });

  const workspace = await prisma.workspace.create({
    data: {
      name: `CRDT Workspace ${suffix}`,
      slug: `crdt-ws-${suffix}`,
      ownerId: owner.id,
      members: {
        create: [
          { userId: owner.id, role: "OWNER" },
          { userId: member.id, role: "MEMBER" },
          { userId: viewer.id, role: "MEMBER" },
        ],
      },
    },
  });

  const room = await prisma.room.create({
    data: {
      workspaceId: workspace.id,
      name: "CRDT Room",
      members: {
        create: [
          { userId: owner.id, workspaceId: workspace.id, role: "HOST" },
          { userId: member.id, workspaceId: workspace.id, role: "MEMBER" },
          { userId: viewer.id, workspaceId: workspace.id, role: "VIEWER" },
        ],
      },
    },
  });

  try {
    // Two clients edit independently without having synced with each other yet
    const docOwner = new Y.Doc();
    docOwner.getText("content").insert(0, "Alpha line\n");
    const ownerBase64 = Buffer.from(Y.encodeStateAsUpdate(docOwner)).toString("base64");

    const docMember = new Y.Doc();
    docMember.getText("content").insert(0, "Beta line\n");
    const memberBase64 = Buffer.from(Y.encodeStateAsUpdate(docMember)).toString("base64");

    await saveRoomCollabForUser(prisma, room.id, owner.id, { crdtDocBase64: ownerBase64 });
    await saveRoomCollabForUser(prisma, room.id, member.id, { crdtDocBase64: memberBase64 });

    const fetched = await getRoomCollabForUser(prisma, room.id, owner.id);
    assert.ok(fetched.crdtDocBase64, "Merged CRDT snapshot should be persisted");
    assert.equal("__crdtDocBase64" in (fetched.sharedNotes ?? {}), false);

    const mergedDoc = new Y.Doc();
    Y.applyUpdate(mergedDoc, Buffer.from(fetched.crdtDocBase64, "base64"));
    const mergedText = mergedDoc.getText("content").toString();
    assert.ok(mergedText.includes("Alpha line"), `Expected Alpha line in merged text: ${mergedText}`);
    assert.ok(mergedText.includes("Beta line"), `Expected Beta line in merged text: ${mergedText}`);

    docOwner.destroy();
    docMember.destroy();
    mergedDoc.destroy();

    await assert.rejects(
      () => saveRoomCollabForUser(prisma, room.id, viewer.id, { crdtDocBase64: ownerBase64 }),
      (err) => err && (err.status === 403 || err.statusCode === 403),
    );
  } finally {
    await prisma.workspace.delete({ where: { id: workspace.id } }).catch(() => {});
    await prisma.user
      .deleteMany({
        where: { id: { in: [owner.id, member.id, viewer.id] } },
      })
      .catch(() => {});
    await prisma.$disconnect();
  }
});
