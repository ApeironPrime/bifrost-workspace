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
  router.post("/verify-email", controller.verifyEmail);
  router.post("/resend-verification", requireAuth, controller.resendVerification);
  router.post("/forgot-password", getAuthRateLimiters().loginIpLimiter, controller.forgotPassword);
  router.post("/reset-password", getAuthRateLimiters().loginIpLimiter, controller.resetPassword);
  router.post("/2fa/verify", getAuthRateLimiters().loginIpLimiter, controller.verifyTwoFactor);
  router.post("/2fa/setup", requireAuth, controller.setupTwoFactor);
  router.post("/2fa/enable", requireAuth, controller.enableTwoFactor);
  router.post("/2fa/disable", requireAuth, controller.disableTwoFactor);
  router.get("/oauth/providers", controller.oauthProviders);
  router.get("/oauth/:provider/start", controller.oauthStart);
  router.get("/oauth/:provider/callback", controller.oauthCallback);
  router.post("/change-password", requireAuth, controller.changePassword);
  router.get("/me", requireAuth, controller.me);
  router.patch("/me", requireAuth, controller.updateMe);
  router.patch("/profile", requireAuth, controller.completeProfile);

  return router;
}

export const authRouter = createAuthRouter();
