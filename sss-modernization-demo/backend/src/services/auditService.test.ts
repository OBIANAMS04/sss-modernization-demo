jest.mock('../database/connection', () => ({ __esModule: true, default: { query: jest.fn() } }));

import { sanitizeDetails } from './auditService';
import { readAuditEntry } from '../middleware/auditAccess';

describe('sanitizeDetails (no PII in the audit log)', () => {
  it('redacts sensitive keys at any depth, including inside arrays', () => {
    const clean = sanitizeDetails({
      password: 'Str0ng!Passw0rd',
      profile: { ssn: '900-00-0010', newPassword: 'x', mfaSecret: 'ABC', name: 'Jordan' },
      attempts: [{ totpCode: '123456' }, { accessToken: 'eyJ...' }],
    });
    expect(clean).toEqual({
      password: '[REDACTED]',
      profile: { ssn: '[REDACTED]', newPassword: '[REDACTED]', mfaSecret: '[REDACTED]', name: 'Jordan' },
      attempts: [{ totpCode: '[REDACTED]' }, { accessToken: '[REDACTED]' }],
    });
  });

  it('removes SSN-shaped text from any value', () => {
    expect(sanitizeDetails({ note: 'Applicant gave 900-00-0010 by phone' })).toEqual({ note: 'Applicant gave [REDACTED] by phone' });
  });

  it('keeps ordinary fields, including ones whose names merely contain "pass"', () => {
    const details = { passed: true, compass: 'N', decision: 'Approved', failedControls: ['CTRL-05'], at: new Date(0) };
    expect(sanitizeDetails(details)).toEqual(details);
  });

  it('returns null for no details', () => {
    expect(sanitizeDetails(undefined)).toBeNull();
  });
});

describe('readAuditEntry (every successful read is audited by its route key)', () => {
  it('names a read by the same key as the access table, with the record id', () => {
    expect(readAuditEntry('GET', '/api/cases', '/:id', { id: 'case-1' }, 200)).toEqual({
      key: 'GET /api/cases/:id',
      action: 'DATA_READ',
      resource: 'cases',
      resourceId: 'case-1',
    });
  });

  it('treats the CSV export as an export', () => {
    expect(readAuditEntry('GET', '/api/cases', '/export', {}, 200)?.action).toBe('DATA_EXPORT');
  });

  it('uses the router path for a router root', () => {
    expect(readAuditEntry('GET', '/api/exemptions', '/', {}, 200)?.key).toBe('GET /api/exemptions');
  });

  it('skips writes, failures, unmatched paths, health and reference data', () => {
    expect(readAuditEntry('POST', '/api/cases', '/', {}, 201)).toBeNull();
    expect(readAuditEntry('GET', '/api/cases', '/:id', { id: 'x' }, 403)).toBeNull();
    expect(readAuditEntry('GET', '/api/cases', undefined, {}, 200)).toBeNull();
    expect(readAuditEntry('GET', '', '/health', {}, 200)).toBeNull();
    expect(readAuditEntry('GET', '/api/compliance', '/matrix', {}, 200)).toBeNull();
  });
});

describe('recordServerStart (a restart is not a deployment)', () => {
  const pool = require('../database/connection').default;
  const { recordServerStart } = require('./auditService');
  const recorded = async (lastCommit: string | null, commit: string, migrations: string[]) => {
    pool.query.mockReset();
    pool.query.mockResolvedValueOnce({ rows: lastCommit ? [{ commit: lastCommit }] : [] });
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, action: 'X', resource: 'system', status: 'success', timestamp: new Date() }] });
    await recordServerStart(commit, migrations);
    return pool.query.mock.calls[1][1][0];
  };

  it('records a deployment for a new commit, for the first start ever, and when migrations ran', async () => {
    expect(await recorded('68e0274', 'a8250f5', [])).toBe('DEPLOYMENT');
    expect(await recorded(null, '68e0274', [])).toBe('DEPLOYMENT');
    expect(await recorded('68e0274', '68e0274', ['017_roles.sql'])).toBe('DEPLOYMENT');
  });

  it('records a server restart when the same release starts again', async () => {
    expect(await recorded('68e0274', '68e0274', [])).toBe('SERVER_START');
  });
});
