import { Router } from "express";
import bcrypt from "bcrypt";
import { z } from "zod";
import { createAccessToken } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";
import { getAuthRateLimiters } from "../lib/rateLimit.js";
import { requireAuth } from "../middleware/auth.js";

export const authRouter = Router();

const credentialsSchema = z.object({
  email: z.string().trim().email("Email không hợp lệ.").max(254),
  password: z.string().min(8, "Mật khẩu cần ít nhất 8 ký tự.").max(100),
});

const registerSchema = credentialsSchema.extend({
  name: z.string().trim().min(2, "Tên cần ít nhất 2 ký tự.").max(100),
});

const profileSchema = z.object({
  name: z.string().trim().min(2, "Tên cần ít nhất 2 ký tự.").max(100),
});

function publicUser(user: { id: string; name: string; email: string; createdAt: Date }) {
  return { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt };
}

authRouter.post("/register", async (request, response, next) => {
  try {
    const input = registerSchema.parse(request.body);
    const email = input.email.toLowerCase();
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      response.status(409).json({ message: "Email này đã được sử dụng." });
      return;
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await prisma.user.create({
      data: { name: input.name, email, passwordHash },
    });
    response.status(201).json({
      token: createAccessToken(user),
      user: publicUser(user),
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/login", getAuthRateLimiters().loginAccountLimiter, async (request, response, next) => {
  try {
    const input = credentialsSchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
      response.status(401).json({ message: "Email hoặc mật khẩu không đúng." });
      return;
    }

    response.json({ token: createAccessToken(user), user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

authRouter.get("/me", requireAuth, async (request, response, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: request.user!.id } });
    if (!user) {
      response.status(404).json({ message: "Không tìm thấy người dùng." });
      return;
    }
    response.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

authRouter.patch("/me", requireAuth, async (request, response, next) => {
  try {
    const input = profileSchema.parse(request.body);
    const user = await prisma.user.update({
      where: { id: request.user!.id },
      data: { name: input.name },
    });
    response.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});
