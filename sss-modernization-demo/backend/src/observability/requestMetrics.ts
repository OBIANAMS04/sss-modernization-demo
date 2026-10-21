import { NextFunction, Request, Response } from 'express';
import { currentTraceId } from './traceContext';
import { routeTemplate } from './scrub';
import { recordRequest } from './metricsRecorder';
import { recordServerError } from './metricsStore';

// STORY-026 and 027: one middleware times every request, and when it finishes writes the log line, counts it for the route template and,
// if the response was a server error, keeps it with its trace id. The route is the template ("GET /api/cases/:id"), never the raw path.

/** What the error handler tells this middleware about a failure (the class of the error and its code, never its message). */
export interface ErrorInfo {
  name: string;
  code?: string;
}

export function requestMetrics(req: Request, res: Response, next: NextFunction) {
  const started = process.hrtime.bigint();
  const traceId = currentTraceId();
  res.on('finish', () => {
    const ms = Math.round((Number(process.hrtime.bigint() - started) / 1e6) * 10) / 10;
    const route = routeTemplate(req.method, req.baseUrl, req.route?.path);
    recordRequest(route, res.statusCode, ms);
    console.log('Request', { route, status: res.statusCode, ms });
    if (res.statusCode >= 500) {
      const info = res.locals.errorInfo as ErrorInfo | undefined;
      recordServerError({ route, status: res.statusCode, traceId: traceId ?? currentTraceId(), durationMs: ms, errorName: info?.name, errorCode: info?.code });
    }
  });
  next();
}
