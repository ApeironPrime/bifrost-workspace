import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import express from "express";
import {
  createHttpMetricsMiddleware,
  createMetricsRegistry,
  ingestClientErrorReport,
  sanitizeTelemetryText,
} from "../dist/lib/observability.js";
import { createObservabilityRouter } from "../dist/routes/observability.js";

async function listenEphemeral(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("GET /api/metrics exposes Prometheus counters and enforces optional METRICS_BEARER_TOKEN", async () => {
  const registry = createMetricsRegistry();
  registry.socketConnectedClients = 3;
  registry.webrtcSignalsRelayedTotal.set("webrtc:offer", 5);

  const app = express();
  app.use(express.json());
  app.use(createHttpMetricsMiddleware(registry));
  app.get("/api/ping", (_req, res) => res.json({ ok: true }));
  app.use("/api", createObservabilityRouter(registry));

  const srv = await listenEphemeral(app);
  const prevToken = process.env.METRICS_BEARER_TOKEN;
  try {
    await fetch(`${srv.baseUrl}/api/ping`);

    delete process.env.METRICS_BEARER_TOKEN;
    const publicMetrics = await fetch(`${srv.baseUrl}/api/metrics`);
    assert.equal(publicMetrics.status, 200);
    assert.match(publicMetrics.headers.get("content-type") ?? "", /text\/plain/);
    const body = await publicMetrics.text();
    assert.match(body, /bifrost_http_requests_total\{method="GET",route="\/api\/ping",status="200"\} 1/);
    assert.match(body, /bifrost_socketio_connected_clients 3/);
    assert.match(body, /bifrost_webrtc_signals_relayed_total\{event="webrtc:offer"\} 5/);
    assert.match(body, /process_resident_memory_bytes \d+/);

    process.env.METRICS_BEARER_TOKEN = "prom-secret-token";
    const unauth = await fetch(`${srv.baseUrl}/api/metrics`);
    assert.equal(unauth.status, 401);

    const auth = await fetch(`${srv.baseUrl}/api/metrics`, {
      headers: { Authorization: "Bearer prom-secret-token" },
    });
    assert.equal(auth.status, 200);
  } finally {
    if (prevToken === undefined) delete process.env.METRICS_BEARER_TOKEN;
    else process.env.METRICS_BEARER_TOKEN = prevToken;
    await srv.close();
  }
});

test("POST /api/telemetry/errors accepts client crash reports and redacts secrets", async () => {
  const registry = createMetricsRegistry();
  const app = express();
  app.use(express.json());
  app.use("/api", createObservabilityRouter(registry));

  const srv = await listenEphemeral(app);
  try {
    const res = await fetch(`${srv.baseUrl}/api/telemetry/errors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "react-boundary",
        message: "Boom with Bearer secret.jwt.token",
        url: "http://localhost:5173/#invite=secretToken123",
      }),
    });
    assert.equal(res.status, 202);
    const body = await res.json();
    assert.equal(body.accepted, true);
    assert.ok(body.traceId);
    assert.equal(registry.clientErrorsTotal.get("react-boundary"), 1);

    assert.equal(
      sanitizeTelemetryText("Authorization: Bearer abc.def.ghi #invite=xyz"),
      "Authorization: Bearer [REDACTED] #invite=[REDACTED]",
    );

    const forwarded = [];
    await ingestClientErrorReport(
      registry,
      {
        kind: "webrtc",
        message: "ICE failed Bearer tok123",
        url: "https://bifrost.app/#verify_email=tok456",
      },
      { TELEMETRY_WEBHOOK_URL: "https://telemetry.example.com/hook" },
      async (url, init) => {
        forwarded.push({ url, payload: JSON.parse(init.body) });
        return new Response(null, { status: 200 });
      },
    );
    assert.equal(forwarded.length, 1);
    assert.equal(forwarded[0].payload.message, "ICE failed Bearer [REDACTED]");
    assert.equal(forwarded[0].payload.url, "https://bifrost.app/#verify_email=[REDACTED]");
  } finally {
    await srv.close();
  }
});
