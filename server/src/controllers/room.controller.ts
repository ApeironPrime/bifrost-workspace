import type { NextFunction, Request, Response } from "express";
import type { PrismaClient } from "../generated/prisma/client.js";
import {
  getRoomCollabForUser,
  getRoomDetailsForUser,
  RoomServiceError,
  saveRoomCollabForUser,
  saveUserRoomNote,
} from "../services/room.service.js";

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

    getCollab: async (request: Request, response: Response, next: NextFunction) => {
      try {
        const result = await getRoomCollabForUser(db, String(request.params.roomId), request.user!.id);
        response.json(result);
      } catch (error) {
        if (error instanceof RoomServiceError) {
          response.status(error.status).json({ message: error.message });
          return;
        }
        next(error);
      }
    },

    putCollab: async (request: Request, response: Response, next: NextFunction) => {
      try {
        const result = await saveRoomCollabForUser(
          db,
          String(request.params.roomId),
          request.user!.id,
          request.body,
        );
        response.json(result);
      } catch (error) {
        if (error instanceof RoomServiceError) {
          response.status(error.status).json({ message: error.message });
          return;
        }
        next(error);
      }
    },

    putMyNote: async (request: Request, response: Response, next: NextFunction) => {
      try {
        const result = await saveUserRoomNote(
          db,
          String(request.params.roomId),
          request.user!.id,
          request.body,
        );
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
