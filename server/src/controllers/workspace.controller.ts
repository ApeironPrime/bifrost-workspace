import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client.js";
import {
  createWorkspaceInvite,
  InviteServiceError,
  listWorkspaceInvites,
  revokeWorkspaceInvite,
} from "../services/invite.service.js";
import {
  createRoomLabel,
  createWorkspace,
  createWorkspaceRoom,
  deleteRoomLabel,
  deleteWorkspace,
  deleteWorkspaceRoom,
  getWorkspaceDetail,
  inviteWorkspaceMember,
  listWorkspaceMembers,
  listWorkspaceRooms,
  listWorkspaces,
  removeWorkspaceMember,
  updateMemberRoomRole,
  updateRoomLabel,
  updateWorkspace,
  updateWorkspaceRoom,
  WorkspaceServiceError,
  type WorkspaceRouterOptions,
} from "../services/workspace.service.js";

const workspaceSchema = z.object({
  name: z.string().trim().min(3, "Tên workspace cần ít nhất 3 ký tự.").max(120),
});

const inviteSchema = z.object({
  email: z.string().trim().email("Email không hợp lệ.").max(254),
});

const createRoomSchema = z.object({
  name: z.string().trim().min(2, "Tên phòng cần ít nhất 2 ký tự.").max(120, "Tên phòng tối đa 120 ký tự."),
  description: z.string().trim().max(255, "Mô tả tối đa 255 ký tự.").optional().nullable(),
});

const updateRoomSchema = z
  .object({
    name: z.string().trim().min(2, "Tên phòng cần ít nhất 2 ký tự.").max(120, "Tên phòng tối đa 120 ký tự.").optional(),
    description: z.string().trim().max(255, "Mô tả tối đa 255 ký tự.").optional().nullable(),
  })
  .refine((data) => data.name !== undefined || data.description !== undefined, {
    message: "Cần cung cấp thông tin phòng cần cập nhật.",
  });

const ALLOWED_LABEL_COLORS = [
  "#53664b",
  "#8a684e",
  "#53617b",
  "#8b5876",
  "#477c7a",
  "#916149",
] as const;

const roomLabelSchema = z.object({
  name: z.string().trim().min(2, "Tên nhãn cần từ 2 đến 32 ký tự.").max(32, "Tên nhãn cần từ 2 đến 32 ký tự."),
  color: z.enum(ALLOWED_LABEL_COLORS, { message: "Màu nhãn không hợp lệ." }),
  priority: z.number().int().min(0).max(999, "Ưu tiên cần là số 0–999 (nhỏ hơn xếp trước)."),
});

const memberRoomRoleSchema = z.object({
  roomId: z.string().uuid("ID phòng không hợp lệ."),
  roomRole: z.enum(["HOST", "MODERATOR", "MEMBER", "VIEWER"]).nullable(),
  labelIds: z.array(z.string().uuid()).max(12, "Nhãn vượt quá 12 nhãn.").optional(),
});

const createInviteSchema = z.object({
  email: z.string().trim().email("Email không hợp lệ.").max(254).optional(),
  maxUses: z.number().int().min(1).max(100).optional(),
  ttlDays: z.number().int().min(1).max(30).optional(),
});

function handleWorkspaceError(error: unknown, response: Response, next: NextFunction) {
  if (error instanceof WorkspaceServiceError || error instanceof InviteServiceError) {
    response.status(error.status).json({ message: error.message });
    return;
  }
  next(error);
}

const paramStr = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? value[0] ?? "" : (value ?? "");

export function createWorkspaceController(db: PrismaClient, options: WorkspaceRouterOptions = {}) {
  return {
    list: async (request: Request, response: Response, next: NextFunction) => {
      try {
        response.json(await listWorkspaces(db, request.user!.id));
      } catch (error) {
        handleWorkspaceError(error, response, next);
      }
    },

    create: async (request: Request, response: Response, next: NextFunction) => {
      try {
        const input = workspaceSchema.parse(request.body);
        response.status(201).json(await createWorkspace(db, request.user!.id, input.name));
      } catch (error) {
        handleWorkspaceError(error, response, next);
      }
    },

    getById: async (request: Request, response: Response, next: NextFunction) => {
      try {
        response.json(await getWorkspaceDetail(db, paramStr(request.params.workspaceId), request.user!.id));
      } catch (error) {
        handleWorkspaceError(error, response, next);
      }
    },

    update: async (request: Request, response: Response, next: NextFunction) => {
      try {
        const input = workspaceSchema.parse(request.body);
        response.json(
          await updateWorkspace(db, paramStr(request.params.workspaceId), request.user!.id, input.name),
        );
      } catch (error) {
        handleWorkspaceError(error, response, next);
      }
    },

    remove: async (request: Request, response: Response, next: NextFunction) => {
      try {
        await deleteWorkspace(db, paramStr(request.params.workspaceId), request.user!.id);
        response.status(204).send();
      } catch (error) {
        handleWorkspaceError(error, response, next);
      }
    },

    listMembers: async (request: Request, response: Response, next: NextFunction) => {
      try {
        response.json(
          await listWorkspaceMembers(db, paramStr(request.params.workspaceId), request.user!.id, options),
        );
      } catch (error) {
        handleWorkspaceError(error, response, next);
      }
    },

    inviteMember: async (request: Request, response: Response, next: NextFunction) => {
      try {
        const input = inviteSchema.parse(request.body);
        response
          .status(201)
          .json(
            await inviteWorkspaceMember(
              db,
              paramStr(request.params.workspaceId),
              request.user!.id,
              input.email,
            ),
          );
      } catch (error) {
        handleWorkspaceError(error, response, next);
      }
    },

    listInvites: async (request: Request, response: Response, next: NextFunction) => {
      try {
        response.json(
          await listWorkspaceInvites(db, paramStr(request.params.workspaceId), request.user!.id),
        );
      } catch (error) {
        handleWorkspaceError(error, response, next);
      }
    },

    createInvite: async (request: Request, response: Response, next: NextFunction) => {
      try {
        const input = createInviteSchema.parse(request.body ?? {});
        const originHeader = request.get("origin")?.trim();
        response.status(201).json(
          await createWorkspaceInvite(db, {
            workspaceId: paramStr(request.params.workspaceId),
            actorUserId: request.user!.id,
            email: input.email,
            maxUses: input.maxUses,
            ttlDays: input.ttlDays,
            clientBaseUrl: originHeader,
          }),
        );
      } catch (error) {
        handleWorkspaceError(error, response, next);
      }
    },

    revokeInvite: async (request: Request, response: Response, next: NextFunction) => {
      try {
        await revokeWorkspaceInvite(
          db,
          paramStr(request.params.workspaceId),
          paramStr(request.params.inviteId),
          request.user!.id,
        );
        response.status(204).send();
      } catch (error) {
        handleWorkspaceError(error, response, next);
      }
    },

    updateMemberRole: async (request: Request, response: Response, next: NextFunction) => {
      try {
        if (Object.prototype.hasOwnProperty.call(request.body ?? {}, "role")) {
          response.status(403).json({ message: "Không thể thay đổi quyền Workspace bằng thao tác này." });
          return;
        }
        const input = memberRoomRoleSchema.parse(request.body);
        response.json(
          await updateMemberRoomRole(
            db,
            {
              workspaceId: paramStr(request.params.workspaceId),
              actorUserId: request.user!.id,
              targetUserId: paramStr(request.params.userId),
              roomId: input.roomId,
              roomRole: input.roomRole,
              labelIds: input.labelIds,
            },
            options,
          ),
        );
      } catch (error) {
        handleWorkspaceError(error, response, next);
      }
    },

    removeMember: async (request: Request, response: Response, next: NextFunction) => {
      try {
        await removeWorkspaceMember(
          db,
          paramStr(request.params.workspaceId),
          request.user!.id,
          paramStr(request.params.userId),
          options,
        );
        response.status(204).send();
      } catch (error) {
        handleWorkspaceError(error, response, next);
      }
    },

    listRooms: async (request: Request, response: Response, next: NextFunction) => {
      try {
        response.json(await listWorkspaceRooms(db, paramStr(request.params.workspaceId), request.user!.id));
      } catch (error) {
        handleWorkspaceError(error, response, next);
      }
    },

    createRoom: async (request: Request, response: Response, next: NextFunction) => {
      try {
        const input = createRoomSchema.parse(request.body);
        response
          .status(201)
          .json(
            await createWorkspaceRoom(db, paramStr(request.params.workspaceId), request.user!.id, input),
          );
      } catch (error) {
        handleWorkspaceError(error, response, next);
      }
    },

    updateRoom: async (request: Request, response: Response, next: NextFunction) => {
      try {
        const input = updateRoomSchema.parse(request.body);
        response.json(
          await updateWorkspaceRoom(
            db,
            paramStr(request.params.workspaceId),
            paramStr(request.params.roomId),
            request.user!.id,
            input,
          ),
        );
      } catch (error) {
        handleWorkspaceError(error, response, next);
      }
    },

    removeRoom: async (request: Request, response: Response, next: NextFunction) => {
      try {
        await deleteWorkspaceRoom(
          db,
          paramStr(request.params.workspaceId),
          paramStr(request.params.roomId),
          request.user!.id,
          options,
        );
        response.status(204).send();
      } catch (error) {
        handleWorkspaceError(error, response, next);
      }
    },

    createLabel: async (request: Request, response: Response, next: NextFunction) => {
      try {
        const input = roomLabelSchema.parse(request.body);
        response
          .status(201)
          .json(
            await createRoomLabel(
              db,
              paramStr(request.params.workspaceId),
              paramStr(request.params.roomId),
              request.user!.id,
              input,
            ),
          );
      } catch (error) {
        handleWorkspaceError(error, response, next);
      }
    },

    updateLabel: async (request: Request, response: Response, next: NextFunction) => {
      try {
        const input = roomLabelSchema.parse(request.body);
        response.json(
          await updateRoomLabel(
            db,
            paramStr(request.params.workspaceId),
            paramStr(request.params.roomId),
            paramStr(request.params.labelId),
            request.user!.id,
            input,
          ),
        );
      } catch (error) {
        handleWorkspaceError(error, response, next);
      }
    },

    removeLabel: async (request: Request, response: Response, next: NextFunction) => {
      try {
        response.json(
          await deleteRoomLabel(
            db,
            paramStr(request.params.workspaceId),
            paramStr(request.params.roomId),
            paramStr(request.params.labelId),
            request.user!.id,
          ),
        );
      } catch (error) {
        handleWorkspaceError(error, response, next);
      }
    },
  };
}
