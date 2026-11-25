import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export type ClientErrorKind = "error" | "unhandledrejection" | "react-boundary" | "webrtc";

export interface MetricsRegistry {
  httpRequestsTotal: Map<string, number>;
  httpRequestDurationMsSum: number;
  httpRequestDurationMsCount: number;
  socketConnectedClients: number;
  webrtcSignalsRelayedTotal: Map<string, number>;
  serverErrorsTotal: number;
  clientErrorsTotal: Map<ClientErrorKind, number>;
}

export function createMetricsRegistry(): MetricsRegistry {
  return {
    httpRequestsTotal: new Map(),
    httpRequestDurationMsSum: 0,
    httpRequestDurationMsCount: 0,
    socketConnectedClients: 0,
    webrtcSignalsRelayedTotal: new Map(),
    serverErrorsTotal: 0,
    clientErrorsTotal: new Map(),
  };
}

function normalizeRouteLabel(rawPath: string): string {
  const pathOnly = rawPath.split("?")[0] || "/";
  return pathOnly
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":uuid")
    .replace(/\/api\/avatars\/[^/]+/g, "/api/avatars/:file")
    .replace(/\/api\/invites\/[^/]+/g, "/api/invites/:token");
}

function escapePromLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

export function createHttpMetricsMiddleware(registry: MetricsRegistry) {
  return (request: Request, response: Response, next: NextFunction) => {
    const startNs = process.hrtime.bigint();
    response.on("finish", () => {
      const elapsedMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;
      const route = normalizeRouteLabel(request.originalUrl || request.path || "/");
      const key = `${request.method}|${route}|${response.statusCode}`;
      registry.httpRequestsTotal.set(key, (registry.httpRequestsTotal.get(key) ?? 0) + 1);
      registry.httpRequestDurationMsSum += elapsedMs;
      registry.httpRequestDurationMsCount += 1;
    });
    next();
  };
}

export function renderPrometheusMetrics(registry: MetricsRegistry): string {
  const lines: string[] = [
    "# HELP bifrost_http_requests_total Total HTTP requests handled by Bifrost server",
    "# TYPE bifrost_http_requests_total counter",
  ];

  for (const [key, count] of registry.httpRequestsTotal.entries()) {
    const [method, route, status] = key.split("|");
    lines.push(
      `bifrost_http_requests_total{method="${escapePromLabel(method)}",route="${escapePromLabel(route)}",status="${escapePromLabel(status)}"} ${count}`,
    );
  }

  lines.push(
    "# HELP bifrost_http_request_duration_ms_sum Sum of HTTP request durations in milliseconds",
    "# TYPE bifrost_http_request_duration_ms_sum counter",
    `bifrost_http_request_duration_ms_sum ${registry.httpRequestDurationMsSum.toFixed(3)}`,
    "# HELP bifrost_http_request_duration_ms_count Count of measured HTTP requests",
    "# TYPE bifrost_http_request_duration_ms_count counter",
    `bifrost_http_request_duration_ms_count ${registry.httpRequestDurationMsCount}`,
    "# HELP bifrost_socketio_connected_clients Current number of connected Socket.IO clients",
    "# TYPE bifrost_socketio_connected_clients gauge",
    `bifrost_socketio_connected_clients ${registry.socketConnectedClients}`,
    "# HELP bifrost_webrtc_signals_relayed_total Total WebRTC signaling events relayed",
    "# TYPE bifrost_webrtc_signals_relayed_total counter",
  );

  for (const [eventName, count] of registry.webrtcSignalsRelayedTotal.entries()) {
    lines.push(
      `bifrost_webrtc_signals_relayed_total{event="${escapePromLabel(eventName)}"} ${count}`,
    );
  }

  lines.push(
    "# HELP bifrost_server_errors_total Total unhandled 5xx server errors",
    "# TYPE bifrost_server_errors_total counter",
    `bifrost_server_errors_total ${registry.serverErrorsTotal}`,
    "# HELP bifrost_client_errors_total Total client runtime error reports ingested",
    "# TYPE bifrost_client_errors_total counter",
  );

  for (const [kind, count] of registry.clientErrorsTotal.entries()) {
    lines.push(`bifrost_client_errors_total{kind="${escapePromLabel(kind)}"} ${count}`);
  }

  const memory = process.memoryUsage();
  lines.push(
    "# HELP process_resident_memory_bytes Resident set size in bytes",
    "# TYPE process_resident_memory_bytes gauge",
    `process_resident_memory_bytes ${memory.rss}`,
    "# HELP process_uptime_seconds Process uptime in seconds",
    "# TYPE process_uptime_seconds gauge",
    `process_uptime_seconds ${process.uptime().toFixed(3)}`,
    "",
  );

  return lines.join("\n");
}

export function sanitizeTelemetryText(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/bifrost_rt=[^;\s]+/gi, "bifrost_rt=[REDACTED]")
    .replace(/#(invite|verify_email|reset_token)=[^\s&]+/gi, "#$1=[REDACTED]");
}

export async function ingestClientErrorReport(
  registry: MetricsRegistry,
  report: {
    kind: ClientErrorKind;
    message: string;
    stack?: string;
    url?: string;
  },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<{ traceId: string }> {
  const traceId = crypto.randomUUID();
  registry.clientErrorsTotal.set(
    report.kind,
    (registry.clientErrorsTotal.get(report.kind) ?? 0) + 1,
  );

  const sanitized = {
    traceId,
    kind: report.kind,
    message: sanitizeTelemetryText(report.message) ?? "",
    stack: sanitizeTelemetryText(report.stack),
    url: sanitizeTelemetryText(report.url),
    timestamp: new Date().toISOString(),
  };

  console.error("[telemetry:client-error]", JSON.stringify(sanitized));

  const webhookUrl = env.TELEMETRY_WEBHOOK_URL?.trim();
  if (webhookUrl) {
    try {
      await fetchImpl(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sanitized),
      });
    } catch {
      // Best-effort telemetry forwarding; never fail ingestion response.
    }
  }

  return { traceId };
}
