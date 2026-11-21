import type { RequestHandler } from "express";
import { z } from "zod";
import { Prisma } from "../generated/prisma/client.js";

export interface UuidParamRule {
  param: string;
  message: string;
}

/**
 * Validates one or more route path parameters as UUIDs before any database query,
 * membership check, or downstream handler runs.
 */
export function validateUuidParams<P extends Record<string, string> = Record<string, string>>(
  ...rules: ReadonlyArray<UuidParamRule>
): RequestHandler<P> {
  const compiled = rules.map(({ param, message }) => ({
    param,
    message,
    schema: z.string().uuid(message),
  }));

  return (request, response, next) => {
    const params = request.params as Record<string, unknown>;
    for (const { param, message, schema } of compiled) {
      const parsed = schema.safeParse(params[param]);
      if (!parsed.success) {
        response.status(400).json({ message });
        return;
      }
    }
    next();
  };
}

/**
 * Returns true strictly for Prisma P2025 ("Record to update/delete not found").
 */
export function isPrismaRecordNotFoundError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2025"
  );
}
