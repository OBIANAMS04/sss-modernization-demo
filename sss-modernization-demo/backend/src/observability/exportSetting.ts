/** The OTLP endpoint traces and metrics are exported to (OTEL_EXPORTER_OTLP_ENDPOINT); undefined means nothing leaves the server. */
export const exportEndpoint = (): string | undefined => process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() || undefined;
