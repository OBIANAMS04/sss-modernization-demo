// STORY-026: OpenTelemetry tracing. THIS FILE MUST BE THE FIRST IMPORT of index.ts: the HTTP, Express and PostgreSQL instrumentations
// work by wrapping those modules as they are first loaded, so anything that loads express or pg before this runs is not traced.
//
// Spans are always created (the trace id on every response comes from them) but they only leave the server when
// OTEL_EXPORTER_OTLP_ENDPOINT is set, over OTLP/HTTP; otherwise there is no exporter and nothing is sent anywhere. Metrics follow the
// same rule (see metricsExport.ts). With the Datadog Agent: enable its OTLP receiver (DD_OTLP_CONFIG_RECEIVER_PROTOCOLS_HTTP_ENDPOINT=
// 0.0.0.0:4318) and set OTEL_EXPORTER_OTLP_ENDPOINT=http://<agent host>:4318. See docs/OBSERVABILITY.md.
import dotenv from 'dotenv';
import { diag, DiagConsoleLogger, DiagLogLevel, metrics } from '@opentelemetry/api';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { ExportResultCode } from '@opentelemetry/core';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { BatchSpanProcessor, NodeTracerProvider, ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-node';
import { scrubSpan } from './scrub';
import { exportEndpoint } from './exportSetting';

dotenv.config();


/** Wraps an exporter so no span leaves the server with a raw path, query string, address or SQL text on it. */
export class ScrubbingExporter implements SpanExporter {
  constructor(private readonly inner: SpanExporter) {}
  export(spans: ReadableSpan[], resultCallback: Parameters<SpanExporter['export']>[1]): void {
    try {
      this.inner.export(spans.map((s) => scrubSpan(s as unknown as { attributes: Record<string, unknown>; name: string }) as unknown as ReadableSpan), resultCallback);
    } catch {
      resultCallback({ code: ExportResultCode.FAILED });
    }
  }
  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }
  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }
}

const endpoint = exportEndpoint();
// Only errors from the SDK itself are shown; without this a failed export is silent
diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);

const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'sss-demo-api',
    [ATTR_SERVICE_VERSION]: (process.env.RENDER_GIT_COMMIT || 'local').slice(0, 7),
    'deployment.environment.name': process.env.RENDER ? 'render' : 'local',
  });

const provider = new NodeTracerProvider({
  resource,
  // A small queue keeps the memory bounded on the 512 MB instance; spans over the limit are dropped, never held
  spanProcessors: endpoint
    ? [new BatchSpanProcessor(new ScrubbingExporter(new OTLPTraceExporter()), { maxQueueSize: 512, maxExportBatchSize: 128, scheduledDelayMillis: 5000 })]
    : [],
});
provider.register();

// STORY-027: the same metrics the service keeps in PostgreSQL (request duration by route template, query duration, AI calls, tokens and cost)
// are exported as OpenTelemetry metrics, once a minute, and only when an endpoint is set. With none, the instruments are no-ops.
const meterProvider = endpoint
  ? new MeterProvider({ resource, readers: [new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter(), exportIntervalMillis: 60_000 })] })
  : undefined;
if (meterProvider) metrics.setGlobalMeterProvider(meterProvider);

registerInstrumentations({
  instrumentations: [
    new HttpInstrumentation({
      // A health ping every few seconds would be most of the traffic and none of the interest
      ignoreIncomingRequestHook: (req) => req.url === '/health',
      // Query values can be anything a person typed (a name in a search); none is recorded
      redactedQueryParamsServer: ['*'],
    }),
    // Only the route handler is a span; each middleware layer would be a dozen spans per request
    new ExpressInstrumentation({ ignoreLayersType: ['middleware', 'router'] as any }),
    // The statement text is removed as well (scrub.ts); the operation and the duration stay
    new PgInstrumentation({ enhancedDatabaseReporting: false, requireParentSpan: true }),
  ],
});

export const tracingExports = endpoint !== undefined;

process.on('SIGTERM', () => {
  provider.shutdown().catch(() => {});
  meterProvider?.shutdown().catch(() => {});
});
