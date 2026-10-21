import { Request, Response } from 'express';
import { logLine } from './logger';
import { routeTemplate, scrubSpan, scrubText } from './scrub';
import { newTraceId, traceContextMiddleware, traceparent } from './traceContext';
import { getRequestContext, requestContextMiddleware } from '../utils/requestContext';

describe('scrubText (nothing personal in a log line or a span)', () => {
  it('removes email addresses and Social Security numbers, however written', () => {
    expect(scrubText('Key (email)=(jane.doe+x@example.com) already exists')).toBe('Key (email)=([email]) already exists');
    expect(scrubText('ssn 123-45-6789 and 123 45 6789 and 123456789')).toBe('ssn [REDACTED] and [REDACTED] and [REDACTED]');
  });
  it('leaves ordinary text alone', () => {
    expect(scrubText('GET /api/cases/:id took 12 ms')).toBe('GET /api/cases/:id took 12 ms');
  });
});

describe('routeTemplate (labels never carry a record id)', () => {
  it('names a route by its template', () => {
    expect(routeTemplate('GET', '/api/cases', '/:id')).toBe('GET /api/cases/:id');
    expect(routeTemplate('GET', '/api/cases', '/')).toBe('GET /api/cases');
  });
  it('puts every request that no route matched in one bucket, and every odd method in one', () => {
    expect(routeTemplate('GET', '', undefined)).toBe('GET (unmatched)');
    expect(routeTemplate('BREW', '', undefined)).toBe('OTHER (unmatched)');
  });
});

describe('scrubSpan', () => {
  it('removes raw paths, query strings, addresses and SQL text from a span before it is exported', () => {
    const span = scrubSpan({
      name: 'GET jane@example.com',
      attributes: {
        'url.path': '/api/cases/6f1c', 'url.query': 'q=jane', 'http.target': '/api/cases/6f1c?q=jane', 'client.address': '::1',
        'db.statement': 'SELECT * FROM users WHERE email = $1', 'db.query.text': 'SELECT 1', 'http.request.header.cookie': 'a=b',
        'http.route': '/api/cases/:id', 'http.response.status_code': 200, 'ai.model': 'claude-opus-5-5', note: 'for 123-45-6789',
      },
    });
    expect(span.attributes).toEqual({ 'http.route': '/api/cases/:id', 'http.response.status_code': 200, 'ai.model': 'claude-opus-5-5', note: 'for [REDACTED]' });
    expect(span.name).toBe('GET [email]');
  });
});

describe('logLine (every line is JSON with the trace id)', () => {
  it('is one JSON object with time, level, message and service', () => {
    const line = JSON.parse(logLine('info', ['Request', { route: 'GET /api/cases/:id', status: 200 }], new Date('2026-10-20T10:00:00Z')));
    expect(line).toMatchObject({ time: '2026-10-20T10:00:00.000Z', level: 'info', msg: 'Request', data: { route: 'GET /api/cases/:id', status: 200 } });
  });
  it('keeps an error as name, message and stack, scrubbed', () => {
    const line = JSON.parse(logLine('error', ['Error:', new Error('duplicate key for jane@example.com')]));
    expect(line.data.name).toBe('Error');
    expect(line.data.message).toBe('duplicate key for [email]');
  });
  it('carries the trace id of the request being handled', (done) => {
    const ids = newTraceId();
    requestContextMiddleware({ ip: '::1', get: () => undefined } as unknown as Request, {} as Response, () => {
      getRequestContext()!.traceId = ids;
      expect(JSON.parse(logLine('info', ['hello'])).trace_id).toBe(ids);
      done();
    });
  });
  it('expands a format string like console does', () => {
    expect(JSON.parse(logLine('info', ['port %d', 3001])).msg).toBe('port 3001');
  });
});

describe('traceContextMiddleware', () => {
  it('puts a traceparent and an X-Request-Id with the same trace id on the response and on the request context', (done) => {
    const headers: Record<string, string> = {};
    const res = { setHeader: (k: string, v: string) => (headers[k] = v) } as unknown as Response;
    requestContextMiddleware({ ip: '::1', get: () => undefined } as unknown as Request, res, () => {
      traceContextMiddleware({} as Request, res, () => {
        expect(headers['X-Request-Id']).toMatch(/^[0-9a-f]{32}$/);
        expect(headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
        expect(headers.traceparent.split('-')[1]).toBe(headers['X-Request-Id']);
        expect(getRequestContext()!.traceId).toBe(headers['X-Request-Id']);
        done();
      });
    });
  });
  it('writes a traceparent in the W3C shape', () => {
    expect(traceparent({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) })).toBe(`00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`);
  });
});
