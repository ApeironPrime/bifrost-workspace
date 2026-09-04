import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken, type AuthUser } from "../lib/auth.js";

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function requireAuth(request: Request, response: Response, next: NextFunction) {
  const authorization = request.header("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;

  if (!token) {
    response.status(401).json({ message: "Bạn cần đăng nhập để thực hiện thao tác này." });
    return;
  }

  try {
    request.user = verifyAccessToken(token);
    next();
  } catch {
    response.status(401).json({ message: "Phiên đăng nhập không hợp lệ hoặc đã hết hạn." });
  }
}
