import type { NextFunction, Request, Response } from "express";
import type { PrismaClient } from "../generated/prisma/client.js";
import { getRoomDetailsForUser, RoomServiceError } from "../services/room.service.js";

export function createRoomController(db: PrismaClient) {
  return {
    getById: async (request: Request, response: Response, next: NextFunction) => {
      try {
        const result = await getRoomDetailsForUser(db, String(request.params.roomId), request.user!.id);
        response.json(result);
      } catch (error) {
        if (error instanceof RoomServiceError) {
          response.status(error.status).json({ message: error.message });
          return;
        }
        next(error);
      }
    },
  };
}
