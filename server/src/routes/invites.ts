import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import {
  acceptWorkspaceInvite,
  getPublicInviteInfo,
  InviteServiceError,
} from "../services/invite.service.js";

const tokenParamSchema = z.string().trim().min(12, "Mã lời mời không hợp lệ.").max(256);

function handleInviteError(error: unknown, response: Response, next: NextFunction) {
  if (error instanceof InviteServiceError) {
    response.status(error.status).json({ message: error.message });
    return;
  }
  next(error);
}

export function createInviteRouter(db: PrismaClient = prisma): Router {
  const router = Router();

  router.get("/:token", async (request: Request, response: Response, next: NextFunction) => {
    try {
      const token = tokenParamSchema.parse(request.params.token);
      response.json(await getPublicInviteInfo(db, token));
    } catch (error) {
      handleInviteError(error, response, next);
    }
  });

  router.post(
    "/:token/accept",
    requireAuth,
    async (request: Request, response: Response, next: NextFunction) => {
      try {
        const token = tokenParamSchema.parse(request.params.token);
        response.json(await acceptWorkspaceInvite(db, token, request.user!));
      } catch (error) {
        handleInviteError(error, response, next);
      }
    },
  );

  return router;
}
