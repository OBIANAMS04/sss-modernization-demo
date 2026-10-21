import { availability, beginStartup, completeStartup, isDatabaseUnavailable, markDatabaseDown, markDatabaseUp, requireDatabase, resetAvailability } from './availability';

const pgError = (code: string, message = 'x') => Object.assign(new Error(message), { code });

describe('isDatabaseUnavailable', () => {
  it('is true for refused, reset, timed-out and unresolvable connections', () => {
    for (const code of ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH']) {
      expect(isDatabaseUnavailable(pgError(code))).toBe(true);
    }
  });

  it('is true for a database that is starting, shutting down, full, missing or not accepting connections', () => {
    for (const code of ['57P01', '57P03', '53300', '3D000', '08006', '08001']) expect(isDatabaseUnavailable(pgError(code))).toBe(true);
    expect(isDatabaseUnavailable(pgError('55000', 'database "x" is not currently accepting connections'))).toBe(true);
  });

  it('is true for the errors pg raises without a code', () => {
    expect(isDatabaseUnavailable(new Error('Connection terminated unexpectedly'))).toBe(true);
    expect(isDatabaseUnavailable(new Error('timeout exceeded when trying to connect'))).toBe(true);
  });

  it('is true for an AggregateError whose every address was refused, and for a wrapped cause', () => {
    const refused = pgError('ECONNREFUSED');
    expect(isDatabaseUnavailable(Object.assign(new Error(''), { errors: [refused, refused] }))).toBe(true);
    expect(isDatabaseUnavailable(Object.assign(new Error('wrapper'), { cause: refused }))).toBe(true);
  });

  it('is false for a statement the database rejected, which is a fault in the release (a failed migration stops the deploy)', () => {
    expect(isDatabaseUnavailable(pgError('42P01', 'relation "x" does not exist'))).toBe(false);
    expect(isDatabaseUnavailable(pgError('23505', 'duplicate key'))).toBe(false);
    expect(isDatabaseUnavailable(pgError('42601', 'Connection terminated in my SQL text'))).toBe(false);
    expect(isDatabaseUnavailable(new Error('Migration 026_x.sql failed: syntax error'))).toBe(false);
    expect(isDatabaseUnavailable(Object.assign(new Error(''), { errors: [pgError('ECONNREFUSED'), new Error('other')] }))).toBe(false);
    expect(isDatabaseUnavailable(null)).toBe(false);
    expect(isDatabaseUnavailable('ECONNREFUSED')).toBe(false);
  });
});

describe('requireDatabase', () => {
  const run = () => {
    const res: any = { headers: {} as Record<string, string> };
    res.set = (k: string, v: string) => ((res.headers[k] = v), res);
    res.status = (c: number) => ((res.code = c), res);
    res.json = (b: unknown) => ((res.body = b), res);
    const next = jest.fn();
    requireDatabase({} as any, res, next);
    return { res, next };
  };

  beforeEach(() => {
    resetAvailability();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => resetAvailability());

  it('lets everything through when the server never began a gated start (tests, scripts)', () => {
    markDatabaseDown();
    expect(run().next).toHaveBeenCalled();
    expect(availability().startup).toBe('not-gated');
  });

  it('answers 503 "starting" until the start has finished, then lets requests through', () => {
    beginStartup();
    let { res, next } = run();
    expect([res.code, res.body.error.code, res.headers['Retry-After'], next.mock.calls.length]).toEqual([503, 'SERVICE_UNAVAILABLE', '5', 0]);
    expect(res.body.error.message).toMatch(/starting up/);
    expect(availability().startup).toBe('pending');
    completeStartup();
    ({ res, next } = run());
    expect(next).toHaveBeenCalled();
    expect(availability().startup).toBe('complete');
  });

  it('answers 503 with a database message while the database is down and reopens when it is back, with no restart', () => {
    beginStartup();
    completeStartup();
    markDatabaseDown(pgError('ECONNREFUSED'));
    let { res, next } = run();
    expect([res.code, next.mock.calls.length]).toEqual([503, 0]);
    expect(res.body.error.message).toMatch(/cannot reach its database/);
    expect(res.body.error.message).toMatch(/Nothing you sent was saved/);
    markDatabaseUp();
    ({ res, next } = run());
    expect(next).toHaveBeenCalled();
  });

  it('reports how long the database has been down', () => {
    let t = 1_000_000;
    resetAvailability(() => t);
    markDatabaseDown();
    t += 42_000;
    expect(availability()).toMatchObject({ database: 'down', downSeconds: 42 });
    markDatabaseUp();
    expect(availability().downSeconds).toBeNull();
  });
});
