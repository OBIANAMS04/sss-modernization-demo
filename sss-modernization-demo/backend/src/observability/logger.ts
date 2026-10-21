import { format } from 'node:util';
import { activeTraceIds, currentTraceId } from './traceContext';
import { scrubText } from './scrub';

// STORY-026: every log line is one JSON object with the trace id, so a line can be found from a response's X-Request-Id and the other
// way round. The code keeps calling console.log / console.error with the same messages; they are written as JSON here, once, so no
// message changed meaning and none can be forgotten. Datadog reads JSON lines from the host's log stream by default.

export type Level = 'info' | 'warn' | 'error';

/** An argument as data: errors keep their name, message and stack; everything is scrubbed of Social Security numbers and email addresses. */
function plain(value: unknown, depth = 0): unknown {
  if (value instanceof Error) return { name: value.name, message: scrubText(value.message), stack: value.stack ? scrubText(value.stack) : undefined };
  if (typeof value === 'string') return scrubText(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= 4) return '[object]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => plain(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>).slice(0, 50)) out[key] = plain(v, depth + 1);
  return out;
}

/** One log line, as a JSON string. Pure apart from the clock and the active trace. */
export function logLine(level: Level, args: unknown[], now: Date = new Date()): string {
  const [first, ...rest] = args;
  const ids = activeTraceIds();
  const traceId = ids?.traceId ?? currentTraceId();
  const formatted = typeof first === 'string' && first.includes('%');
  const line: Record<string, unknown> = {
    time: now.toISOString(),
    level,
    // A format string ("%s") is expanded like console does; otherwise the first argument is the message and the others are its data
    msg: scrubText(typeof first === 'string' ? (formatted ? format(first, ...rest) : first) : format('%o', first)),
    service: process.env.OTEL_SERVICE_NAME || 'sss-demo-api',
  };
  if (traceId) line.trace_id = traceId;
  if (ids) line.span_id = ids.spanId;
  const data = formatted ? [] : rest;
  if (data.length === 1) line.data = plain(data[0]);
  else if (data.length > 1) line.data = data.map((d) => plain(d));
  try {
    return JSON.stringify(line);
  } catch {
    return JSON.stringify({ time: line.time, level, msg: line.msg, trace_id: traceId, data: '[unserialisable]' });
  }
}

let installed = false;

/** Replaces console.log/info/warn/error/debug so each call writes one JSON line (stdout for info, stderr for warn and error). */
export function installJsonLogging(): void {
  if (installed) return;
  installed = true;
  const write = (level: Level, stream: NodeJS.WriteStream) => (...args: unknown[]) => {
    stream.write(`${logLine(level, args)}\n`);
  };
  console.log = write('info', process.stdout);
  console.info = write('info', process.stdout);
  console.debug = write('info', process.stdout);
  console.warn = write('warn', process.stderr);
  console.error = write('error', process.stderr);
}
