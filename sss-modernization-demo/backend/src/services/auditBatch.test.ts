jest.mock('../database/connection', () => ({ __esModule: true, default: { query: jest.fn() } }));

import pool from '../database/connection';
import { flushAuditEntries, recordAudit } from './auditService';

const query = pool.query as unknown as jest.Mock;

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [] });
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('recordAudit batching (STORY-033)', () => {
  it('writes entries recorded together with one statement and keeps every field of each', async () => {
    recordAudit('DATA_READ', 'cases', 'success', { actor: 'u1', actorEmail: 'a@example.com', resourceId: 'c1', details: { route: 'GET /api/cases/:id' } });
    recordAudit('DATA_READ', 'users', 'success', { actor: 'u2', ipAddress: '10.0.0.1', userAgent: 'agent' });
    expect(query).not.toHaveBeenCalled();
    await flushAuditEntries();
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('INSERT INTO audit_logs');
    expect(sql).toContain('($1, $2');
    expect(sql).toContain('($12, $13'); // the second row's placeholders follow the first row's eleven
    expect(params).toHaveLength(22);
    expect(params.slice(0, 6)).toEqual(['DATA_READ', 'u1', 'a@example.com', 'cases', 'c1', 'success']);
    expect(JSON.parse(params[6])).toEqual({ route: 'GET /api/cases/:id' });
    expect(params.slice(11 + 7, 11 + 9)).toEqual(['10.0.0.1', 'agent']);
    expect(typeof params[10]).toBe('number'); // the moment the entry was recorded, not the moment of the write
  });

  it('writes nothing when nothing is pending, and each entry only once', async () => {
    await flushAuditEntries();
    recordAudit('DATA_READ', 'cases', 'success');
    await flushAuditEntries();
    await flushAuditEntries();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('writes the entries one at a time when the batch is refused, so only the bad one is lost', async () => {
    query.mockImplementation(async (_sql: string, params: unknown[]) => {
      if (params.length > 11) throw new Error('batch refused');
      if (params[1] === 'gone') throw new Error('foreign key');
      return { rows: [] };
    });
    recordAudit('DATA_READ', 'cases', 'success', { actor: 'gone' });
    recordAudit('DATA_READ', 'cases', 'success', { actor: 'here' });
    await flushAuditEntries();
    expect(query).toHaveBeenCalledTimes(3);
    expect(console.error).toHaveBeenCalledTimes(1);
  });
});
