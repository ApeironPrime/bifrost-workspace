import { Router } from "express";
import type { PrismaClient } from "../generated/prisma/client.js";
import { createAuthController } from "../controllers/auth.controller.js";
import { prisma } from "../lib/prisma.js";
import { getAuthRateLimiters } from "../lib/rateLimit.js";
import { requireAuth } from "../middleware/auth.js";

export function createAuthRouter(db: PrismaClient = prisma) {
  const router = Router();
  const controller = createAuthController(db);

  router.post("/register", controller.register);
  router.post("/login", getAuthRateLimiters().loginAccountLimiter, controller.login);
  router.post("/refresh", controller.refresh);
  router.post("/logout", controller.logout);
  router.post("/change-password", requireAuth, controller.changePassword);
  router.get("/me", requireAuth, controller.me);
  router.patch("/me", requireAuth, controller.updateMe);
  router.patch("/profile", requireAuth, controller.completeProfile);

  return router;
}

export const authRouter = createAuthRouter();
