import { randomBytes } from 'node:crypto';
import { trace } from '@opentelemetry/api';
import { NextFunction, Request, Response } from 'express';
import { getRequestContext } from '../utils/requestContext';

// STORY-026: every response says which trace it belongs to, so a person reporting a problem (or a log line, or an audit entry) can be
// matched to the trace. With the OpenTelemetry SDK running the ids are the ones of the request's span; without it (unit tests, or a
// process started without tracing) an id of the same shape is made, so the headers and the logs behave the same either way.

const TRACE_ID = /^[0-9a-f]{32}$/;
const SPAN_ID = /^[0-9a-f]{16}$/;

export interface TraceIds {
  traceId: string;
  spanId: string;
}

export const newTraceId = (): string => randomBytes(16).toString('hex');
export const newSpanId = (): string => randomBytes(8).toString('hex');

/** The ids of the span active right now, if the SDK is running and the span is valid. */
export function activeTraceIds(): TraceIds | undefined {
  const context = trace.getActiveSpan()?.spanContext();
  if (!context || !TRACE_ID.test(context.traceId) || !SPAN_ID.test(context.spanId) || /^0+$/.test(context.traceId)) return undefined;
  return { traceId: context.traceId, spanId: context.spanId };
}

/** The trace id of the request being handled, for an audit entry or a log line. */
export function currentTraceId(): string | undefined {
  return activeTraceIds()?.traceId ?? getRequestContext()?.traceId;
}

export function traceparent(ids: TraceIds): string {
  return `00-${ids.traceId}-${ids.spanId}-01`;
}

/** Puts the trace id on the response (traceparent and X-Request-Id) and on the request context. Must run after requestContextMiddleware. */
export function traceContextMiddleware(_req: Request, res: Response, next: NextFunction) {
  const ids = activeTraceIds() ?? { traceId: newTraceId(), spanId: newSpanId() };
  const context = getRequestContext();
  if (context) context.traceId = ids.traceId;
  res.setHeader('traceparent', traceparent(ids));
  res.setHeader('X-Request-Id', ids.traceId);
  next();
}
