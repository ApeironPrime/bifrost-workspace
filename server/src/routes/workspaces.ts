import { Router } from "express";
import { createWorkspaceController } from "../controllers/workspace.controller.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { validateUuidParams } from "../lib/validation.js";
import { requireAuth } from "../middleware/auth.js";
import type { WorkspaceRouterOptions } from "../services/workspace.service.js";

export type {
  MemberRemovedEvent,
  RoomAccessRevokedEvent,
  RoomDeletedEvent,
  WorkspaceRouterOptions,
} from "../services/workspace.service.js";

const WORKSPACE_ID_RULE = { param: "workspaceId", message: "ID workspace không hợp lệ." } as const;
const USER_ID_RULE = { param: "userId", message: "ID thành viên không hợp lệ." } as const;
const ROOM_ID_RULE = { param: "roomId", message: "ID phòng không hợp lệ." } as const;
const LABEL_ID_RULE = { param: "labelId", message: "ID nhãn không hợp lệ." } as const;
const INVITE_ID_RULE = { param: "inviteId", message: "ID lời mời không hợp lệ." } as const;

/**
 * Builds the workspaces router with injectable Prisma client and optional lifecycle hooks.
 */
export function createWorkspaceRouter(
  db: PrismaClient = prisma,
  options: WorkspaceRouterOptions = {},
) {
  const router = Router();
  const controller = createWorkspaceController(db, options);

  router.use(requireAuth);

  router.get("/", controller.list);
  router.post("/", controller.create);

  router.get("/:workspaceId", validateUuidParams(WORKSPACE_ID_RULE), controller.getById);
  router.patch("/:workspaceId", validateUuidParams(WORKSPACE_ID_RULE), controller.update);
  router.delete("/:workspaceId", validateUuidParams(WORKSPACE_ID_RULE), controller.remove);

  router.get("/:workspaceId/members", validateUuidParams(WORKSPACE_ID_RULE), controller.listMembers);
  router.post("/:workspaceId/members", validateUuidParams(WORKSPACE_ID_RULE), controller.inviteMember);
  router.get("/:workspaceId/invites", validateUuidParams(WORKSPACE_ID_RULE), controller.listInvites);
  router.post("/:workspaceId/invites", validateUuidParams(WORKSPACE_ID_RULE), controller.createInvite);
  router.delete("/:workspaceId/invites/:inviteId", validateUuidParams(WORKSPACE_ID_RULE, INVITE_ID_RULE), controller.revokeInvite);
  router.patch("/:workspaceId/members/:userId", validateUuidParams(WORKSPACE_ID_RULE, USER_ID_RULE), controller.updateMemberRole);
  router.delete("/:workspaceId/members/:userId", validateUuidParams(WORKSPACE_ID_RULE, USER_ID_RULE), controller.removeMember);

  router.get("/:workspaceId/rooms", validateUuidParams(WORKSPACE_ID_RULE), controller.listRooms);
  router.post("/:workspaceId/rooms", validateUuidParams(WORKSPACE_ID_RULE), controller.createRoom);
  router.patch("/:workspaceId/rooms/:roomId", validateUuidParams(WORKSPACE_ID_RULE, ROOM_ID_RULE), controller.updateRoom);
  router.delete("/:workspaceId/rooms/:roomId", validateUuidParams(WORKSPACE_ID_RULE, ROOM_ID_RULE), controller.removeRoom);

  router.post("/:workspaceId/rooms/:roomId/roles", validateUuidParams(WORKSPACE_ID_RULE, ROOM_ID_RULE), controller.createLabel);
  router.patch("/:workspaceId/rooms/:roomId/roles/:labelId", validateUuidParams(WORKSPACE_ID_RULE, ROOM_ID_RULE, LABEL_ID_RULE), controller.updateLabel);
  router.delete("/:workspaceId/rooms/:roomId/roles/:labelId", validateUuidParams(WORKSPACE_ID_RULE, ROOM_ID_RULE, LABEL_ID_RULE), controller.removeLabel);

  return router;
}

export const workspaceRouter = createWorkspaceRouter();
