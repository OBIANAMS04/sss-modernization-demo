# Observability: tracing, metrics and the Datadog Agent

STORY-026 to 029. The backend measures itself (OpenTelemetry for traces, its own PostgreSQL rollups for metrics). Nothing leaves the server unless you ask it to.

## What is recorded

- **Traces:** one per request (HTTP, Express route handler, each PostgreSQL query) and a span `assistant.model_call` around each Claude call with the model, token counts, latency and outcome. Never the question, the policy passages or the answer. Raw paths, query strings, client addresses, user agents and SQL text are removed from every span before export.
- **Trace id on every response:** `traceparent` and `X-Request-Id`. Every log line is JSON with `trace_id`; every audit entry made by a request records it.
- **Metrics:** per route template per minute (requests, 4xx, 5xx, p50/p95/p99), database query time and pool use, AI tokens and estimated cost. Kept 30 days in PostgreSQL and shown on `/observability` (administrators).
- **Alerts:** objectives (`backend/src/observability/slo.ts`) checked every minute; see `RUNBOOK-ALERTS.md`.

## Sending traces and metrics to Datadog

The server speaks OTLP over HTTP. Datadog receives it through the Datadog Agent's OTLP receiver.

1. In the Agent (`datadog.yaml`, or environment variables on the Agent container), enable the OTLP receiver on HTTP:
   `otlp_config.receiver.protocols.http.endpoint: 0.0.0.0:4318` (environment: `DD_OTLP_CONFIG_RECEIVER_PROTOCOLS_HTTP_ENDPOINT=0.0.0.0:4318`).
2. On the API service (Render dashboard, Environment), set `OTEL_EXPORTER_OTLP_ENDPOINT=http://<agent host>:4318`. Optionally `OTEL_SERVICE_NAME` (default `sss-demo-api`).
3. Restart the service. Traces arrive under the service name; metrics (`http.server.request.duration` by `http.route`, `db.client.operation.duration`, `ai.calls`, `ai.tokens`, `ai.cost`) every minute.
4. For logs, point the Datadog Agent at the service's stdout; each line is JSON and `trace_id` correlates it with the trace.

Without `OTEL_EXPORTER_OTLP_ENDPOINT` there is no exporter: spans are created (for the trace id) and dropped. Render's free instance has no Agent next to it, so a Datadog setup needs an Agent host the service can reach.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset | OTLP/HTTP endpoint for traces and metrics; unset means nothing is exported |
| `OTEL_SERVICE_NAME` | `sss-demo-api` | Service name on traces, metrics and log lines |
| `AI_DAILY_BUDGET_USD` | `2` | Daily AI spend objective (estimated cost) |
| `OBSERVABILITY_INTERVAL_MS` | `60000` | Timer period for the objective check (the AI-quality check runs every fifth tick) |

Estimated AI cost comes from the price table in `backend/src/services/aiPricing.ts`; the provider's invoice is the source of truth.
