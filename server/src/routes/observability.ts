import crypto from "node:crypto";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import {
  ingestClientErrorReport,
  renderPrometheusMetrics,
  type MetricsRegistry,
} from "../lib/observability.js";

const clientErrorSchema = z.object({
  kind: z.enum(["error", "unhandledrejection", "react-boundary", "webrtc"]),
  message: z.string().trim().min(1).max(1000),
  stack: z.string().max(4000).optional(),
  url: z.string().max(500).optional(),
});

function timingSafeTokenMatch(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(actual, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createObservabilityRouter(registry: MetricsRegistry): Router {
  const router = Router();

  const telemetryLimiter = rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    passOnStoreError: true,
    message: { message: "Quá nhiều báo cáo lỗi từ thiết bị này." },
  });

  router.get("/metrics", (request, response) => {
    const expectedToken = process.env.METRICS_BEARER_TOKEN?.trim();
    if (expectedToken) {
      const authHeader = request.headers.authorization ?? "";
      const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
      if (!bearer || !timingSafeTokenMatch(expectedToken, bearer)) {
        response.status(401).json({ message: "Unauthorized metrics access." });
        return;
      }
    }

    response.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    response.status(200).send(renderPrometheusMetrics(registry));
  });

  router.post("/telemetry/errors", telemetryLimiter, async (request, response, next) => {
    try {
      const payload = clientErrorSchema.parse(request.body);
      const result = await ingestClientErrorReport(registry, payload);
      response.status(202).json({ accepted: true, traceId: result.traceId });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
