jest.mock('../database/connection', () => ({ __esModule: true, default: { query: jest.fn() } }));
jest.mock('./auditService', () => ({ ...jest.requireActual('./auditService'), logAuditEvent: jest.fn() }));

import pool from '../database/connection';
import { logAuditEvent } from './auditService';
import { describeChanges, recordConfigChanges, storedValue, TRACKED_SETTINGS } from './configAuditService';

// An in-memory config_state table
const table = new Map<string, string>();
const query = pool.query as unknown as jest.Mock;
const logged = logAuditEvent as jest.Mock;

beforeEach(() => {
  table.clear();
  logged.mockReset();
  query.mockReset().mockImplementation(async (sql: string, params: string[] = []) => {
    if (sql.startsWith('INSERT INTO config_state')) {
      if (!table.has(params[0]) || sql.includes('DO UPDATE')) table.set(params[0], params[1]);
      return { rows: [] };
    }
    if (sql.startsWith('SELECT name, value FROM config_state')) return { rows: [...table].map(([name, value]) => ({ name, value })) };
    throw new Error(`unexpected query: ${sql}`);
  });
});

const SECRET = 'jwt-secret-Zq81-never-in-logs';
const PASSWORD = 'db-password-Wk27-never-in-logs';
const base = { CORS_ORIGIN: 'https://site.example', CASE_MANAGER_EMAILS: 'a@example.com', JWT_SECRET: SECRET, DATABASE_PASSWORD: PASSWORD, DATABASE_HOST: 'db.internal' };

describe('recordConfigChanges (STORY-010 configuration changes)', () => {
  it('records a baseline on the first start, then nothing while the settings stay the same', async () => {
    await recordConfigChanges(base);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged.mock.calls[0].slice(0, 3)).toEqual(['CONFIG_CHANGE', 'system', 'success']);
    expect(logged.mock.calls[0][3].details.settings).toEqual(TRACKED_SETTINGS);

    await recordConfigChanges({ ...base });
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it('shows old and new values for public settings and only names secret ones', async () => {
    await recordConfigChanges(base);
    await recordConfigChanges({ ...base, JWT_EXPIRY: '1800', CASE_MANAGER_EMAILS: 'a@example.com,b@example.com', JWT_SECRET: 'rotated-secret-Pp93' });
    expect(logged).toHaveBeenCalledTimes(2);
    expect(logged.mock.calls[1][3].details).toEqual({
      via: 'environment at startup',
      changed: ['JWT_EXPIRY', 'CASE_MANAGER_EMAILS', 'JWT_SECRET'],
      JWT_EXPIRY: '(not set) → 1800',
      CASE_MANAGER_EMAILS: 'a@example.com → a@example.com,b@example.com',
    });
  });

  it('shows the addresses on ADMIN_EMAILS before and after, like the case-manager list', async () => {
    await recordConfigChanges({ ...base, ADMIN_EMAILS: 'morgan.lee@example.com' });
    await recordConfigChanges({ ...base, ADMIN_EMAILS: 'morgan.lee@example.com,riley.chen@example.com' });
    expect(logged.mock.calls[1][3].details).toEqual({
      via: 'environment at startup',
      changed: ['ADMIN_EMAILS'],
      ADMIN_EMAILS: 'morgan.lee@example.com → morgan.lee@example.com,riley.chen@example.com',
    });
  });

  // STORY-019: turning AI on or changing the model is an audited change; the key itself never reaches the log
  it('shows the AI provider, model and daily limit before and after, and names the key without showing it', async () => {
    const KEY = 'sk-ant-key-Yt42-never-in-logs';
    await recordConfigChanges({ ...base, AI_MODEL: 'claude-opus-5-5' });
    await recordConfigChanges({ ...base, AI_PROVIDER: 'stub', AI_MODEL: 'claude-sonnet-5-5', AI_DAILY_LIMIT: '50', ANTHROPIC_API_KEY: KEY });
    expect(logged.mock.calls[1][3].details).toEqual({
      via: 'environment at startup',
      changed: ['AI_PROVIDER', 'AI_MODEL', 'AI_DAILY_LIMIT', 'ANTHROPIC_API_KEY'],
      AI_PROVIDER: '(not set) → stub',
      AI_MODEL: 'claude-opus-5-5 → claude-sonnet-5-5',
      AI_DAILY_LIMIT: '(not set) → 50',
    });
    await recordConfigChanges({ ...base, AI_PROVIDER: 'stub', AI_MODEL: 'claude-sonnet-5-5', AI_DAILY_LIMIT: '50', ANTHROPIC_API_KEY: 'rotated-key-Qq18' });
    expect(logged.mock.calls[2][3].details).toEqual({ via: 'environment at startup', changed: ['ANTHROPIC_API_KEY'] });
    expect(JSON.stringify([logged.mock.calls, query.mock.calls])).not.toMatch(/Yt42|Qq18/);
  });

  it('records nothing for a start that changes none of the AI settings', async () => {
    const ai = { ...base, AI_PROVIDER: 'stub', AI_MODEL: 'claude-opus-5-5', AI_DAILY_LIMIT: '300', ANTHROPIC_API_KEY: 'sk-ant-key-Yt42' };
    await recordConfigChanges(ai);
    await recordConfigChanges({ ...ai });
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it('reports a removed setting, and a moved database by name only', async () => {
    await recordConfigChanges(base);
    const { CORS_ORIGIN, ...withoutCors } = base;
    await recordConfigChanges({ ...withoutCors, DATABASE_HOST: 'other-db.internal' });
    expect(logged.mock.calls[1][3].details).toEqual({
      via: 'environment at startup',
      changed: ['CORS_ORIGIN', 'DATABASE_HOST'],
      CORS_ORIGIN: `${CORS_ORIGIN} → (not set)`,
    });
  });

  it('never writes a secret or a connection detail to the log or to the state table', async () => {
    await recordConfigChanges(base);
    await recordConfigChanges({ ...base, JWT_SECRET: 'rotated-secret-Pp93', DATABASE_PASSWORD: 'rotated-password-Mm55' });
    const written = JSON.stringify([logged.mock.calls, query.mock.calls]);
    for (const value of [SECRET, PASSWORD, 'rotated-secret-Pp93', 'rotated-password-Mm55', 'db.internal']) {
      expect(written).not.toContain(value);
    }
  });

  it('records the change before saving the new state, so a failed save is reported again', async () => {
    await recordConfigChanges(base);
    const order: string[] = [];
    logged.mockImplementation(async () => order.push('audit'));
    const save = query.getMockImplementation()!;
    query.mockImplementation(async (sql: string, params: string[]) => {
      if (sql.includes('DO UPDATE')) order.push('save');
      return save(sql, params);
    });
    await recordConfigChanges({ ...base, JWT_EXPIRY: '900' });
    expect(order[0]).toBe('audit');
    expect(order.slice(1).every((step) => step === 'save')).toBe(true);
  });
});

describe('storedValue and describeChanges', () => {
  it('fingerprints hidden settings with the salt, and keeps public ones as they are', () => {
    expect(storedValue('CORS_ORIGIN', 'https://site.example', 's1')).toBe('https://site.example');
    expect(storedValue('JWT_SECRET', SECRET, 's1')).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(storedValue('JWT_SECRET', SECRET, 's1')).not.toBe(storedValue('JWT_SECRET', SECRET, 's2'));
    expect(storedValue('JWT_SECRET', undefined, 's1')).toBe('(not set)');
    expect(storedValue('JWT_EXPIRY', '', 's1')).toBe('(not set)');
  });

  it('returns null when nothing changed', () => {
    expect(describeChanges({ CORS_ORIGIN: 'x' }, { CORS_ORIGIN: 'x' })).toBeNull();
  });

  it('does not call a setting that was never tracked a change while it is not set, but does once it is set', () => {
    expect(describeChanges({ CORS_ORIGIN: 'x' }, { CORS_ORIGIN: 'x', AI_MODEL: '(not set)' })).toBeNull();
    expect(describeChanges({ CORS_ORIGIN: 'x' }, { CORS_ORIGIN: 'x', AI_MODEL: 'claude-opus-5-5' })).toEqual({
      via: 'environment at startup',
      changed: ['AI_MODEL'],
      AI_MODEL: '(not set) → claude-opus-5-5',
    });
  });

  it('tracks the policy assistant settings: three in the open, the key as a fingerprint', () => {
    expect(TRACKED_SETTINGS).toEqual(expect.arrayContaining(['AI_PROVIDER', 'AI_MODEL', 'AI_DAILY_LIMIT', 'ANTHROPIC_API_KEY']));
    expect(storedValue('AI_MODEL', 'claude-opus-5-5', 's1')).toBe('claude-opus-5-5');
    expect(storedValue('AI_PROVIDER', 'stub', 's1')).toBe('stub');
    expect(storedValue('AI_DAILY_LIMIT', '300', 's1')).toBe('300');
    expect(storedValue('ANTHROPIC_API_KEY', 'sk-ant-key', 's1')).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
