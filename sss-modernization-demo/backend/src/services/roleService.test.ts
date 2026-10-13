// Staff Access: who gets the case-manager role and every way it is granted or removed. Runs without a database:
// the mock below keeps a users table in memory and answers the statements the code sends, so a statement it does
// not know fails the test instead of passing silently.
jest.mock('../database/connection', () => ({ __esModule: true, default: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('./auditService', () => ({ ...jest.requireActual('./auditService'), logAuditEvent: jest.fn() }));
jest.mock('./caseEvents', () => ({ ...jest.requireActual('./caseEvents'), notify: jest.fn() }));
jest.mock('bcrypt', () => ({ hash: jest.fn().mockResolvedValue('hashed') }));

import pool from '../database/connection';
import { AppError } from '../utils/errors';
import { AuditAction, logAuditEvent } from './auditService';
import { notify } from './caseEvents';
import { registerUser } from './authService';
import {
  BOOTSTRAP_VIA,
  Role,
  bootstrapStaffRoles,
  grantCaseManager,
  isStaff,
  listStaff,
  revokeCaseManager,
  roleForNewUser,
} from './roleService';

interface Row {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  created_at: Date;
}

const user = (id: string, email: string, role: Role = 'citizen'): Row => ({
  id,
  email,
  full_name: `Name of ${id}`,
  role,
  created_at: new Date('2026-10-01T09:00:00Z'),
});

let users: Row[] = [];
let statements: string[] = [];

const staffCount = () => users.filter((u) => isStaff(u.role)).length;
const roleOf = (id: string) => users.find((u) => u.id === id)?.role;
const copy = (rows: Row[]) => ({ rows: rows.map((r) => ({ ...r })) });

/** The statements roleService and registerUser send, answered over the in-memory table. */
async function run(sql: string, params: any[] = []) {
  const text = sql.replace(/\s+/g, ' ').trim();
  statements.push(text);

  if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(text) || text.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [] };
  if (text.startsWith(`SELECT 1 FROM users WHERE role IN ('case_manager', 'admin')`)) {
    return { rows: staffCount() > 0 ? [{ '?column?': 1 }] : [] };
  }
  if (text.startsWith('SELECT id, email, full_name, role, created_at FROM users WHERE role IN')) {
    return copy(users.filter((u) => isStaff(u.role)).sort((a, b) => a.email.localeCompare(b.email)));
  }
  if (text.startsWith('SELECT id, email, full_name, role FROM users WHERE lower(email) = lower($1)')) {
    const matches = users.filter((u) => u.email.toLowerCase() === String(params[0]).toLowerCase());
    return copy(matches.sort((a, b) => Number(b.email === params[0]) - Number(a.email === params[0])).slice(0, 1));
  }
  if (text.startsWith('SELECT id, email, full_name, role FROM users WHERE id = $1')) {
    return copy(users.filter((u) => u.id === params[0]));
  }
  if (text.startsWith(`UPDATE users SET role = 'case_manager' WHERE role = 'citizen' AND lower(email) = ANY($1)`)) {
    const granted = users.filter((u) => u.role === 'citizen' && params[0].includes(u.email.toLowerCase()));
    granted.forEach((u) => (u.role = 'case_manager'));
    return copy(granted);
  }
  if (text.startsWith(`UPDATE users SET role = 'case_manager' WHERE id = $1 AND role = 'citizen'`)) {
    const granted = users.filter((u) => u.id === params[0] && u.role === 'citizen');
    granted.forEach((u) => (u.role = 'case_manager'));
    return copy(granted);
  }
  if (text.startsWith(`UPDATE users SET role = 'citizen' WHERE id = $1 AND role = 'case_manager' AND (SELECT COUNT(*) FROM users WHERE role IN ('case_manager', 'admin')) > 1`)) {
    const removed = staffCount() > 1 ? users.filter((u) => u.id === params[0] && u.role === 'case_manager') : [];
    removed.forEach((u) => (u.role = 'citizen'));
    return copy(removed);
  }
  if (text.startsWith('SELECT id FROM users WHERE email = $1')) return copy(users.filter((u) => u.email === params[0]));
  if (text.startsWith('INSERT INTO users')) {
    const created = user(`new-${users.length + 1}`, params[0], params[5]);
    users.push(created);
    return copy([created]);
  }
  throw new Error(`unexpected query: ${text}`);
}

const query = pool.query as unknown as jest.Mock;
const connect = pool.connect as unknown as jest.Mock;
const audit = logAuditEvent as jest.Mock;
const notified = notify as jest.Mock;
let client: { query: jest.Mock; release: jest.Mock };

const savedList = process.env.CASE_MANAGER_EMAILS;

beforeEach(() => {
  users = [];
  statements = [];
  process.env.CASE_MANAGER_EMAILS = 'first-manager@example.com,second-manager@example.com';
  client = { query: jest.fn(run), release: jest.fn() };
  query.mockReset().mockImplementation(run);
  connect.mockReset().mockResolvedValue(client);
  audit.mockReset();
  notified.mockReset();
});

afterAll(() => {
  if (savedList === undefined) delete process.env.CASE_MANAGER_EMAILS;
  else process.env.CASE_MANAGER_EMAILS = savedList;
});

/** The error a call ends in, or null if it succeeds. */
const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error) => error as AppError
  );
const described = (error: AppError | null) => error && [error.statusCode, error.code, error.message];

const MANAGER = { actorId: 'u-manager', actorEmail: 'manager@example.com' };

describe('roleForNewUser: CASE_MANAGER_EMAILS only bootstraps a database with no staff', () => {
  it('makes a listed address a case manager while nobody has staff access', async () => {
    users = [user('u-1', 'someone@example.com')];
    expect(await roleForNewUser('first-manager@example.com')).toBe('case_manager');
  });

  it('makes the same listed address a citizen once a case manager or an admin exists', async () => {
    users = [user('u-1', 'existing@example.com', 'case_manager')];
    expect(await roleForNewUser('first-manager@example.com')).toBe('citizen');
    users = [user('u-2', 'admin@example.com', 'admin')];
    expect(await roleForNewUser('first-manager@example.com')).toBe('citizen');
  });

  it('makes an address that is not listed a citizen, even with no staff', async () => {
    expect(await roleForNewUser('someone@example.com')).toBe('citizen');
  });

  it('matches the list ignoring case and spaces', async () => {
    process.env.CASE_MANAGER_EMAILS = '  First-Manager@Example.com , other@example.com';
    expect(await roleForNewUser('FIRST-MANAGER@example.com')).toBe('case_manager');
  });
});

describe('registration', () => {
  const input = (email: string) => ({ email, password: 'Str0ng!Passw0rd', fullName: 'Test Person', ssn: '900-00-0010', dob: '1950-06-01' });

  it('registers a listed address as a case manager on a database with no staff', async () => {
    const { user: registered } = await registerUser(input('first-manager@example.com'));
    expect(registered.role).toBe('case_manager');
    expect(roleOf(registered.id)).toBe('case_manager');
  });

  it('registers the same listed address as a citizen when staff exist', async () => {
    users = [user('u-1', 'existing@example.com', 'case_manager')];
    const { user: registered } = await registerUser(input('first-manager@example.com'));
    expect(registered.role).toBe('citizen');
    expect(roleOf(registered.id)).toBe('citizen');
  });
});

describe('bootstrapStaffRoles (startup)', () => {
  it('gives listed accounts that already exist the role while nobody has staff access, and audits each grant', async () => {
    process.env.CASE_MANAGER_EMAILS = 'Dana@example.com, sam@example.com ,not-registered@example.com';
    users = [user('u-dana', 'dana@example.com'), user('u-sam', 'sam@example.com'), user('u-other', 'other@example.com')];
    await bootstrapStaffRoles();
    expect(users.map((u) => u.role)).toEqual(['case_manager', 'case_manager', 'citizen']);
    expect(audit.mock.calls).toEqual([
      [AuditAction.PERMISSION_GRANT, 'users', 'success', { resourceId: 'u-dana', details: { email: 'dana@example.com', role: 'case_manager', via: BOOTSTRAP_VIA } }],
      [AuditAction.PERMISSION_GRANT, 'users', 'success', { resourceId: 'u-sam', details: { email: 'sam@example.com', role: 'case_manager', via: BOOTSTRAP_VIA } }],
    ]);
  });

  it('does nothing once anyone has staff access', async () => {
    users = [user('u-existing', 'existing@example.com', 'admin'), user('u-first', 'first-manager@example.com')];
    await bootstrapStaffRoles();
    expect(roleOf('u-first')).toBe('citizen');
    expect(statements.some((s) => s.startsWith('UPDATE'))).toBe(false);
    expect(audit).not.toHaveBeenCalled();
  });

  it('never revokes: a case manager the list does not name keeps access', async () => {
    users = [user('u-granted', 'granted-in-the-app@example.com', 'case_manager'), user('u-first', 'first-manager@example.com')];
    await bootstrapStaffRoles();
    expect(users.map((u) => u.role)).toEqual(['case_manager', 'citizen']);
    expect(statements.some((s) => /SET role = 'citizen'/.test(s))).toBe(false);
    expect(audit).not.toHaveBeenCalled();
  });

  it('never revokes when the list is empty or unset either', async () => {
    users = [user('u-granted', 'granted-in-the-app@example.com', 'case_manager'), user('u-admin', 'admin@example.com', 'admin')];
    for (const list of ['', undefined]) {
      if (list === undefined) delete process.env.CASE_MANAGER_EMAILS;
      else process.env.CASE_MANAGER_EMAILS = list;
      await bootstrapStaffRoles();
    }
    expect(users.map((u) => u.role)).toEqual(['case_manager', 'admin']);
    expect(statements).toEqual([]);
    expect(audit).not.toHaveBeenCalled();
  });
});

describe('listStaff', () => {
  it('lists case managers and admins ordered by email, and nobody else', async () => {
    users = [
      user('u-z', 'zed@example.com', 'case_manager'),
      user('u-citizen', 'citizen@example.com'),
      user('u-a', 'amy@example.com', 'admin'),
    ];
    expect(await listStaff()).toEqual([
      { id: 'u-a', email: 'amy@example.com', fullName: 'Name of u-a', role: 'admin', createdAt: new Date('2026-10-01T09:00:00Z') },
      { id: 'u-z', email: 'zed@example.com', fullName: 'Name of u-z', role: 'case_manager', createdAt: new Date('2026-10-01T09:00:00Z') },
    ]);
    expect(statements[0]).toMatch(/ORDER BY email$/);
  });
});

describe('grantCaseManager', () => {
  beforeEach(() => {
    users = [user('u-manager', 'manager@example.com', 'case_manager'), user('u-jordan', 'jordan@example.com'), user('u-admin', 'admin@example.com', 'admin')];
  });

  const untouched = () => {
    expect(roleOf('u-jordan')).toBe('citizen');
    expect(audit).not.toHaveBeenCalled();
    expect(notified).not.toHaveBeenCalled();
  };

  it.each([[undefined], [''], ['   '], [42]])('needs a reason (%p)', async (reason) => {
    const error = await failure(grantCaseManager(MANAGER, 'jordan@example.com', reason as any));
    expect(described(error)).toEqual([400, 'VALIDATION_ERROR', 'A reason is required. It is kept in the audit log.']);
    untouched();
  });

  it('accepts a reason of 500 characters and refuses 501', async () => {
    expect(described(await failure(grantCaseManager(MANAGER, 'jordan@example.com', 'x'.repeat(501))))).toEqual([
      400,
      'VALIDATION_ERROR',
      'The reason must be 500 characters or less.',
    ]);
    untouched();
    await grantCaseManager(MANAGER, 'jordan@example.com', 'x'.repeat(500));
    expect(roleOf('u-jordan')).toBe('case_manager');
  });

  it('needs an email address', async () => {
    for (const email of [undefined, '', '   ']) {
      expect(described(await failure(grantCaseManager(MANAGER, email as any, 'Joins the review team')))).toEqual([400, 'VALIDATION_ERROR', 'An email address is required.']);
    }
    untouched();
  });

  it('answers 404 for an address nobody registered, and says they need to register first', async () => {
    const error = await failure(grantCaseManager(MANAGER, 'nobody@example.com', 'Joins the review team'));
    expect(described(error)).toEqual([404, 'NOT_FOUND', 'No account uses that email. They need to register first.']);
    untouched();
  });

  it('answers 409 for someone who already has staff access, case manager or admin', async () => {
    for (const email of ['manager@example.com', 'admin@example.com']) {
      const error = await failure(grantCaseManager(MANAGER, email, 'Joins the review team'));
      expect(described(error)).toEqual([409, 'CONFLICT', `${email} already has staff access.`]);
    }
    expect(roleOf('u-admin')).toBe('admin');
    expect(audit).not.toHaveBeenCalled();
    expect(notified).not.toHaveBeenCalled();
  });

  it('gives the role, records who did it and why, and tells the person', async () => {
    const granted = await grantCaseManager(MANAGER, 'jordan@example.com', '  Joins the review team  ');
    expect(granted).toEqual({ id: 'u-jordan', email: 'jordan@example.com', fullName: 'Name of u-jordan', role: 'case_manager' });
    expect(roleOf('u-jordan')).toBe('case_manager');
    expect(audit.mock.calls).toEqual([
      [
        AuditAction.PERMISSION_GRANT,
        'users',
        'success',
        {
          actor: 'u-manager',
          actorEmail: 'manager@example.com',
          resourceId: 'u-jordan',
          details: { email: 'jordan@example.com', role: 'case_manager', reason: 'Joins the review team', via: 'Staff Access' },
        },
      ],
    ]);
    expect(notified.mock.calls).toEqual([[client, 'u-jordan', null, 'You now have case-manager access, granted by manager@example.com. Sign in again to see the staff pages.']]);
    expect(statements).toContain('COMMIT');
  });

  it('finds the account whatever case the address is typed in, and records the address as registered', async () => {
    const granted = await grantCaseManager(MANAGER, 'JORDAN@Example.com', 'Joins the review team');
    expect(granted.id).toBe('u-jordan');
    expect(audit.mock.calls[0][3].details.email).toBe('jordan@example.com');
  });

  it('writes the audit entry in the same transaction, so a failed entry leaves the role as it was', async () => {
    audit.mockRejectedValueOnce(new Error('audit database unavailable'));
    const error = await failure(grantCaseManager(MANAGER, 'jordan@example.com', 'Joins the review team'));
    expect(error?.message).toBe('audit database unavailable');
    expect(statements).toContain('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
  });
});

describe('revokeCaseManager', () => {
  beforeEach(() => {
    users = [
      user('u-manager', 'manager@example.com', 'case_manager'),
      user('u-second', 'second@example.com', 'case_manager'),
      user('u-jordan', 'jordan@example.com'),
      user('u-admin', 'admin@example.com', 'admin'),
    ];
  });

  const unchanged = (...expected: [string, Role][]) => {
    expect(expected.map(([id]) => roleOf(id))).toEqual(expected.map(([, role]) => role));
    expect(audit).not.toHaveBeenCalled();
    expect(notified).not.toHaveBeenCalled();
    expect(statements).not.toContain('COMMIT');
  };

  it.each([[undefined], [''], ['  '], [7]])('needs a reason (%p)', async (reason) => {
    const error = await failure(revokeCaseManager(MANAGER, 'u-second', reason as any));
    expect(described(error)).toEqual([400, 'VALIDATION_ERROR', 'A reason is required. It is kept in the audit log.']);
    unchanged(['u-second', 'case_manager']);
  });

  it('refuses a reason over 500 characters', async () => {
    const error = await failure(revokeCaseManager(MANAGER, 'u-second', 'x'.repeat(501)));
    expect(described(error)).toEqual([400, 'VALIDATION_ERROR', 'The reason must be 500 characters or less.']);
    unchanged(['u-second', 'case_manager']);
  });

  it('does not let anyone remove their own access', async () => {
    const error = await failure(revokeCaseManager(MANAGER, 'u-manager', 'Stepping back'));
    expect(described(error)).toEqual([403, 'FORBIDDEN', 'You cannot remove your own access.']);
    unchanged(['u-manager', 'case_manager']);
  });

  it('answers 404 for an account that does not exist', async () => {
    const error = await failure(revokeCaseManager(MANAGER, 'u-nobody', 'No longer on the team'));
    expect(error?.statusCode).toBe(404);
    unchanged();
  });

  it('answers 409 for someone who is not a case manager', async () => {
    const error = await failure(revokeCaseManager(MANAGER, 'u-jordan', 'No longer on the team'));
    expect(described(error)).toEqual([409, 'CONFLICT', 'jordan@example.com is not a case manager.']);
    unchanged(['u-jordan', 'citizen']);
  });

  it('leaves admins alone: 403', async () => {
    const error = await failure(revokeCaseManager(MANAGER, 'u-admin', 'No longer on the team'));
    expect(described(error)).toEqual([403, 'FORBIDDEN', 'Administrator access cannot be changed here.']);
    unchanged(['u-admin', 'admin']);
  });

  it('removes access, records who did it and why, and tells the person', async () => {
    const removed = await revokeCaseManager(MANAGER, 'u-second', '  No longer on the review team  ');
    expect(removed).toEqual({ id: 'u-second', email: 'second@example.com', fullName: 'Name of u-second', role: 'citizen' });
    expect(roleOf('u-second')).toBe('citizen');
    expect(audit.mock.calls).toEqual([
      [
        AuditAction.PERMISSION_REVOKE,
        'users',
        'success',
        {
          actor: 'u-manager',
          actorEmail: 'manager@example.com',
          resourceId: 'u-second',
          details: { email: 'second@example.com', role: 'citizen', reason: 'No longer on the review team', via: 'Staff Access' },
        },
      ],
    ]);
    expect(notified.mock.calls).toEqual([[client, 'u-second', null, 'Your case-manager access was removed by manager@example.com.']]);
    expect(statements).toContain('COMMIT');
  });

  it('cannot remove the last staff member, even when the person asking was removed a moment ago', async () => {
    users = [user('u-only', 'only@example.com', 'case_manager'), user('u-jordan', 'jordan@example.com')];
    const gone = { actorId: 'u-gone', actorEmail: 'gone@example.com' };
    const error = await failure(revokeCaseManager(gone, 'u-only', 'Cleaning up'));
    expect(described(error)).toEqual([409, 'CONFLICT', 'At least one case manager must keep access.']);
    expect(statements).toContain('ROLLBACK');
    unchanged(['u-only', 'case_manager']);
  });

  it('keeps one case manager when two try to remove each other', async () => {
    users = [user('u-a', 'a@example.com', 'case_manager'), user('u-b', 'b@example.com', 'case_manager')];
    const a = { actorId: 'u-a', actorEmail: 'a@example.com' };
    const b = { actorId: 'u-b', actorEmail: 'b@example.com' };
    const results = [await failure(revokeCaseManager(a, 'u-b', 'Left the team')), await failure(revokeCaseManager(b, 'u-a', 'Left the team'))];
    expect(results.map(described)).toEqual([null, [409, 'CONFLICT', 'At least one case manager must keep access.']]);
    expect(users.filter((u) => isStaff(u.role)).map((u) => u.id)).toEqual(['u-a']);
  });

  it('takes the staff lock before it checks and changes anything, so concurrent removals run one at a time', async () => {
    await revokeCaseManager(MANAGER, 'u-second', 'No longer on the review team');
    const position = (pattern: RegExp) => statements.findIndex((s) => pattern.test(s));
    expect(position(/^BEGIN$/)).toBeLessThan(position(/pg_advisory_xact_lock/));
    expect(position(/pg_advisory_xact_lock/)).toBeLessThan(position(/^SELECT id, email, full_name, role FROM users WHERE id/));
    expect(position(/pg_advisory_xact_lock/)).toBeLessThan(position(/^UPDATE users SET role = 'citizen'/));
    expect(statements.find((s) => s.startsWith(`UPDATE users SET role = 'citizen'`))).toMatch(/\(SELECT COUNT\(\*\) FROM users WHERE role IN \('case_manager', 'admin'\)\) > 1/);
  });
});
