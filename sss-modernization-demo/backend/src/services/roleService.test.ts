// Staff Access: who gets which role and every way it is granted or removed. Runs without a database:
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
  ADMIN_BOOTSTRAP_VIA,
  BOOTSTRAP_VIA,
  Role,
  bootstrapStaffRoles,
  grantStaffRole,
  isAdmin,
  isLeadership,
  isStaff,
  listStaff,
  revokeStaffRole,
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
const adminCount = () => users.filter((u) => u.role === 'admin').length;
const roleOf = (id: string) => users.find((u) => u.id === id)?.role;
const copy = (rows: Row[]) => ({ rows: rows.map((r) => ({ ...r })) });

const STAFF_GUARD = `(SELECT COUNT(*) FROM users WHERE role IN ('case_manager', 'admin')) > 1`;
const ADMIN_GUARD = `(SELECT COUNT(*) FROM users WHERE role = 'admin') > 1`;

/** The statements roleService and registerUser send, answered over the in-memory table. */
async function run(sql: string, params: any[] = []) {
  const text = sql.replace(/\s+/g, ' ').trim();
  statements.push(text);

  if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(text) || text.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [] };
  if (text.startsWith(`SELECT 1 FROM users WHERE role IN ('case_manager', 'admin')`)) {
    return { rows: staffCount() > 0 ? [{ '?column?': 1 }] : [] };
  }
  if (text.startsWith(`SELECT 1 FROM users WHERE role = 'admin'`)) {
    return { rows: adminCount() > 0 ? [{ '?column?': 1 }] : [] };
  }
  if (text.startsWith(`SELECT id, email, full_name, role, created_at FROM users WHERE role IN ('case_manager', 'leadership', 'admin')`)) {
    return copy(users.filter((u) => u.role !== 'citizen').sort((a, b) => a.email.localeCompare(b.email)));
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
  if (text.startsWith(`UPDATE users SET role = 'admin' WHERE role = 'case_manager' AND lower(email) = ANY($1)`)) {
    const promoted = users.filter((u) => u.role === 'case_manager' && params[0].includes(u.email.toLowerCase()));
    promoted.forEach((u) => (u.role = 'admin'));
    return copy(promoted);
  }
  // A grant sets the role the person is known to hold (compare and set), so a change made meanwhile is not overwritten
  if (text.startsWith('UPDATE users SET role = $2 WHERE id = $1 AND role = $3')) {
    const changed = users.filter((u) => u.id === params[0] && u.role === params[2]);
    changed.forEach((u) => (u.role = params[1]));
    return copy(changed);
  }
  if (text.startsWith(`UPDATE users SET role = 'admin' WHERE id = $1 AND role = 'case_manager' AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin')`)) {
    const promoted = adminCount() === 0 ? users.filter((u) => u.id === params[0] && u.role === 'case_manager') : [];
    promoted.forEach((u) => (u.role = 'admin'));
    return copy(promoted);
  }
  if (text.startsWith(`UPDATE users SET role = 'citizen' WHERE id = $1 AND role = $2`)) {
    const allowed = (!text.includes(STAFF_GUARD) || staffCount() > 1) && (!text.includes(ADMIN_GUARD) || adminCount() > 1);
    const removed = allowed ? users.filter((u) => u.id === params[0] && u.role === params[1]) : [];
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

const savedLists = { CASE_MANAGER_EMAILS: process.env.CASE_MANAGER_EMAILS, ADMIN_EMAILS: process.env.ADMIN_EMAILS };

beforeEach(() => {
  users = [];
  statements = [];
  process.env.CASE_MANAGER_EMAILS = 'first-manager@example.com,second-manager@example.com';
  delete process.env.ADMIN_EMAILS;
  client = { query: jest.fn(run), release: jest.fn() };
  query.mockReset().mockImplementation(run);
  connect.mockReset().mockResolvedValue(client);
  audit.mockReset();
  notified.mockReset();
});

afterAll(() => {
  for (const [name, value] of Object.entries(savedLists)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

/** The error a call ends in, or null if it succeeds. */
const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error) => error as AppError
  );
const described = (error: AppError | null) => error && [error.statusCode, error.code, error.message];

const MANAGER = { actorId: 'u-manager', actorEmail: 'manager@example.com', actorRole: 'case_manager' as Role };
const ADMIN = { actorId: 'u-admin', actorEmail: 'admin@example.com', actorRole: 'admin' as Role };

describe('role helpers', () => {
  it.each([
    ['citizen', false, false, false],
    ['case_manager', true, false, false],
    ['leadership', false, false, true],
    ['admin', true, true, true],
    [null, false, false, false],
    [undefined, false, false, false],
  ])('%s: staff %s, admin %s, leadership dashboard %s', (role, staff, admin, leadership) => {
    expect([isStaff(role), isAdmin(role), isLeadership(role)]).toEqual([staff, admin, leadership]);
  });
});

describe('roleForNewUser: the lists only bootstrap, and only registering a case-manager address grants anything', () => {
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

  it('never makes anyone an admin by registering, even an address in ADMIN_EMAILS (or in both lists)', async () => {
    process.env.ADMIN_EMAILS = 'admin-listed@example.com,first-manager@example.com';
    expect(await roleForNewUser('admin-listed@example.com')).toBe('citizen');
    expect(await roleForNewUser('first-manager@example.com')).toBe('case_manager');
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

  it('registers an ADMIN_EMAILS address as a citizen', async () => {
    process.env.ADMIN_EMAILS = 'admin-listed@example.com';
    const { user: registered } = await registerUser(input('admin-listed@example.com'));
    expect(registered.role).toBe('citizen');
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

  describe('ADMIN_EMAILS (STORY-014)', () => {
    beforeEach(() => {
      process.env.ADMIN_EMAILS = 'Morgan@example.com, nobody-here@example.com';
    });

    it('makes a listed case manager an admin while no admin exists, and audits it with how it happened', async () => {
      users = [user('u-morgan', 'morgan@example.com', 'case_manager'), user('u-dana', 'dana@example.com', 'case_manager')];
      await bootstrapStaffRoles();
      expect(users.map((u) => u.role)).toEqual(['admin', 'case_manager']);
      expect(audit.mock.calls).toEqual([
        [AuditAction.PERMISSION_GRANT, 'users', 'success', { resourceId: 'u-morgan', details: { email: 'morgan@example.com', role: 'admin', via: ADMIN_BOOTSTRAP_VIA } }],
      ]);
      expect(ADMIN_BOOTSTRAP_VIA).toBe('ADMIN_EMAILS bootstrap (no admin yet; case managers only)');
    });

    it('promotes only case managers: a listed citizen or leadership user is left alone', async () => {
      users = [user('u-morgan', 'morgan@example.com'), user('u-lead', 'nobody-here@example.com', 'leadership'), user('u-dana', 'dana@example.com', 'case_manager')];
      await bootstrapStaffRoles();
      expect(users.map((u) => u.role)).toEqual(['citizen', 'leadership', 'case_manager']);
      expect(audit).not.toHaveBeenCalled();
    });

    it('does nothing once an admin exists', async () => {
      users = [user('u-morgan', 'morgan@example.com', 'case_manager'), user('u-admin', 'admin@example.com', 'admin')];
      await bootstrapStaffRoles();
      expect(roleOf('u-morgan')).toBe('case_manager');
      expect(statements.some((s) => s.startsWith('UPDATE'))).toBe(false);
      expect(audit).not.toHaveBeenCalled();
    });

    it('never revokes: an admin the list does not name keeps access, whatever the list says', async () => {
      users = [user('u-other', 'other@example.com', 'admin'), user('u-morgan', 'morgan@example.com', 'case_manager')];
      await bootstrapStaffRoles();
      expect(users.map((u) => u.role)).toEqual(['admin', 'case_manager']);
      expect(statements.some((s) => /SET role = 'citizen'/.test(s))).toBe(false);
    });

    it('does nothing when the list is empty or unset', async () => {
      users = [user('u-morgan', 'morgan@example.com', 'case_manager')];
      for (const list of ['', undefined]) {
        if (list === undefined) delete process.env.ADMIN_EMAILS;
        else process.env.ADMIN_EMAILS = list;
        await bootstrapStaffRoles();
      }
      expect(roleOf('u-morgan')).toBe('case_manager');
      expect(statements.some((s) => s.startsWith('UPDATE'))).toBe(false);
    });

    it('an account in both lists becomes a case manager and then, in the same start, an admin', async () => {
      process.env.CASE_MANAGER_EMAILS = 'morgan@example.com';
      users = [user('u-morgan', 'morgan@example.com')];
      await bootstrapStaffRoles();
      expect(roleOf('u-morgan')).toBe('admin');
      expect(audit.mock.calls.map((c) => c[3].details.via)).toEqual([BOOTSTRAP_VIA, ADMIN_BOOTSTRAP_VIA]);
    });
  });
});

describe('listStaff', () => {
  it('lists case managers, leadership and admins ordered by email, and nobody else', async () => {
    users = [
      user('u-z', 'zed@example.com', 'case_manager'),
      user('u-citizen', 'citizen@example.com'),
      user('u-a', 'amy@example.com', 'admin'),
      user('u-l', 'lee@example.com', 'leadership'),
    ];
    expect(await listStaff()).toEqual([
      { id: 'u-a', email: 'amy@example.com', fullName: 'Name of u-a', role: 'admin', createdAt: new Date('2026-10-01T09:00:00Z') },
      { id: 'u-l', email: 'lee@example.com', fullName: 'Name of u-l', role: 'leadership', createdAt: new Date('2026-10-01T09:00:00Z') },
      { id: 'u-z', email: 'zed@example.com', fullName: 'Name of u-z', role: 'case_manager', createdAt: new Date('2026-10-01T09:00:00Z') },
    ]);
    expect(statements[0]).toMatch(/ORDER BY email$/);
  });
});

describe('grantStaffRole', () => {
  beforeEach(() => {
    users = [user('u-manager', 'manager@example.com', 'case_manager'), user('u-jordan', 'jordan@example.com'), user('u-admin', 'admin@example.com', 'admin')];
  });

  const untouched = () => {
    expect(roleOf('u-jordan')).toBe('citizen');
    expect(audit).not.toHaveBeenCalled();
    expect(notified).not.toHaveBeenCalled();
  };

  it.each([[undefined], [''], ['   '], [42]])('needs a reason (%p)', async (reason) => {
    const error = await failure(grantStaffRole(MANAGER, 'jordan@example.com', undefined, reason as any));
    expect(described(error)).toEqual([400, 'VALIDATION_ERROR', 'A reason is required. It is kept in the audit log.']);
    untouched();
  });

  it('accepts a reason of 500 characters and refuses 501', async () => {
    expect(described(await failure(grantStaffRole(MANAGER, 'jordan@example.com', undefined, 'x'.repeat(501))))).toEqual([
      400,
      'VALIDATION_ERROR',
      'The reason must be 500 characters or less.',
    ]);
    untouched();
    await grantStaffRole(MANAGER, 'jordan@example.com', undefined, 'x'.repeat(500));
    expect(roleOf('u-jordan')).toBe('case_manager');
  });

  it('needs an email address', async () => {
    for (const email of [undefined, '', '   ']) {
      expect(described(await failure(grantStaffRole(MANAGER, email as any, undefined, 'Joins the review team')))).toEqual([400, 'VALIDATION_ERROR', 'An email address is required.']);
    }
    untouched();
  });

  it.each([['citizen'], ['superuser'], [7], [{}]])('refuses a role that Staff Access does not give (%p)', async (role) => {
    const error = await failure(grantStaffRole(ADMIN, 'jordan@example.com', role, 'Joins the review team'));
    expect(described(error)).toEqual([400, 'VALIDATION_ERROR', 'The role must be case_manager, leadership or admin.']);
    untouched();
  });

  it('answers 404 for an address nobody registered, and says they need to register first', async () => {
    const error = await failure(grantStaffRole(MANAGER, 'nobody@example.com', undefined, 'Joins the review team'));
    expect(described(error)).toEqual([404, 'NOT_FOUND', 'No account uses that email. They need to register first.']);
    untouched();
  });

  it('answers 409 for someone who already has that role, or a higher one', async () => {
    for (const [email, has] of [['manager@example.com', 'case-manager'], ['admin@example.com', 'administrator']]) {
      const error = await failure(grantStaffRole(MANAGER, email, undefined, 'Joins the review team'));
      expect(described(error)).toEqual([409, 'CONFLICT', `${email} already has ${has} access.`]);
    }
    expect(described(await failure(grantStaffRole(ADMIN, 'admin@example.com', 'admin', 'Again')))).toEqual([409, 'CONFLICT', 'admin@example.com already has administrator access.']);
    expect(roleOf('u-admin')).toBe('admin');
    expect(audit).not.toHaveBeenCalled();
    expect(notified).not.toHaveBeenCalled();
  });

  it('gives case-manager access by default, records who did it and why, and tells the person', async () => {
    const granted = await grantStaffRole(MANAGER, 'jordan@example.com', undefined, '  Joins the review team  ');
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
    const granted = await grantStaffRole(MANAGER, 'JORDAN@Example.com', 'case_manager', 'Joins the review team');
    expect(granted.id).toBe('u-jordan');
    expect(audit.mock.calls[0][3].details.email).toBe('jordan@example.com');
  });

  it('writes the audit entry in the same transaction, so a failed entry leaves the role as it was', async () => {
    audit.mockRejectedValueOnce(new Error('audit database unavailable'));
    const error = await failure(grantStaffRole(MANAGER, 'jordan@example.com', undefined, 'Joins the review team'));
    expect(error?.message).toBe('audit database unavailable');
    expect(statements).toContain('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
  });

  it('takes the staff lock before it changes anything', async () => {
    await grantStaffRole(MANAGER, 'jordan@example.com', undefined, 'Joins the review team');
    const position = (pattern: RegExp) => statements.findIndex((s) => pattern.test(s));
    expect(position(/^BEGIN$/)).toBeLessThan(position(/pg_advisory_xact_lock/));
    expect(position(/pg_advisory_xact_lock/)).toBeLessThan(position(/^UPDATE users SET role = \$2/));
  });

  describe('leadership and administrator access', () => {
    it.each([['leadership'], ['admin']])('a case manager is refused %s access with a 403, and nothing changes', async (role) => {
      const error = await failure(grantStaffRole(MANAGER, 'jordan@example.com', role, 'Joins the review team'));
      expect(described(error)).toEqual([403, 'FORBIDDEN', `Only an administrator can give ${role === 'admin' ? 'administrator' : role} access.`]);
      untouched();
      expect(statements).toEqual([]);
    });

    it('an admin gives leadership access: the audit entry and the person both name the role', async () => {
      const granted = await grantStaffRole(ADMIN, 'jordan@example.com', 'leadership', 'Director of operations');
      expect(granted).toEqual({ id: 'u-jordan', email: 'jordan@example.com', fullName: 'Name of u-jordan', role: 'leadership' });
      expect(roleOf('u-jordan')).toBe('leadership');
      expect(audit.mock.calls).toEqual([
        [
          AuditAction.PERMISSION_GRANT,
          'users',
          'success',
          {
            actor: 'u-admin',
            actorEmail: 'admin@example.com',
            resourceId: 'u-jordan',
            details: { email: 'jordan@example.com', role: 'leadership', reason: 'Director of operations', via: 'Staff Access' },
          },
        ],
      ]);
      expect(notified.mock.calls).toEqual([[client, 'u-jordan', null, 'You now have leadership access, granted by admin@example.com. Sign in again to see the leadership dashboard.']]);
    });

    it('an admin gives administrator access to a citizen', async () => {
      await grantStaffRole(ADMIN, 'jordan@example.com', 'admin', 'Second administrator');
      expect(roleOf('u-jordan')).toBe('admin');
      expect(audit.mock.calls[0][3].details).toEqual({ email: 'jordan@example.com', role: 'admin', reason: 'Second administrator', via: 'Staff Access' });
      expect(notified.mock.calls[0][3]).toBe('You now have administrator access, granted by admin@example.com. Sign in again to see the admin pages.');
    });

    it.each([['case_manager'], ['leadership']])('an admin upgrades a %s to administrator, and the entry says what they were', async (previous) => {
      users.push(user('u-upgrade', 'upgrade@example.com', previous as Role));
      await grantStaffRole(ADMIN, 'upgrade@example.com', 'admin', 'Takes over administration');
      expect(roleOf('u-upgrade')).toBe('admin');
      expect(audit.mock.calls[0][3].details).toEqual({ email: 'upgrade@example.com', role: 'admin', previousRole: previous, reason: 'Takes over administration', via: 'Staff Access' });
    });

    it('does not turn one staff role into another: remove it first', async () => {
      users.push(user('u-lead', 'lead@example.com', 'leadership'), user('u-cm', 'cm@example.com', 'case_manager'));
      expect(described(await failure(grantStaffRole(ADMIN, 'lead@example.com', 'case_manager', 'Moves to case work')))).toEqual([409, 'CONFLICT', 'lead@example.com already has leadership access.']);
      expect(described(await failure(grantStaffRole(ADMIN, 'cm@example.com', 'leadership', 'Moves to leadership')))).toEqual([409, 'CONFLICT', 'cm@example.com already has case-manager access.']);
      expect(users.filter((u) => ['u-lead', 'u-cm'].includes(u.id)).map((u) => u.role)).toEqual(['leadership', 'case_manager']);
    });

    it('a case manager cannot change the role of a leadership person either', async () => {
      users.push(user('u-lead', 'lead@example.com', 'leadership'));
      expect(described(await failure(grantStaffRole(MANAGER, 'lead@example.com', undefined, 'Moves to case work')))).toEqual([409, 'CONFLICT', 'lead@example.com already has leadership access.']);
      expect(roleOf('u-lead')).toBe('leadership');
    });

    it('does not overwrite a role that changed since it was read', async () => {
      query.mockImplementationOnce(async (sql: string, params: any[]) => {
        const found = await run(sql, params);
        users.find((u) => u.id === 'u-jordan')!.role = 'leadership'; // changed by someone else just after the lookup
        return found;
      });
      const error = await failure(grantStaffRole(MANAGER, 'jordan@example.com', undefined, 'Joins the review team'));
      expect(described(error)).toEqual([409, 'CONFLICT', "jordan@example.com's access changed just now. Check the list and try again."]);
      expect(roleOf('u-jordan')).toBe('leadership');
      expect(audit).not.toHaveBeenCalled();
    });
  });

  describe('ADMIN_EMAILS (STORY-014): right after someone becomes a case manager', () => {
    beforeEach(() => {
      process.env.ADMIN_EMAILS = 'jordan@example.com';
      users = [user('u-manager', 'manager@example.com', 'case_manager'), user('u-jordan', 'jordan@example.com')];
    });

    it('a listed address becomes an admin while no admin exists; both steps are audited and the person is told', async () => {
      const result = await grantStaffRole(MANAGER, 'jordan@example.com', undefined, 'Joins the review team');
      expect(result.role).toBe('admin');
      expect(roleOf('u-jordan')).toBe('admin');
      expect(audit.mock.calls.map((c) => [c[0], c[3].details.role, c[3].details.via])).toEqual([
        [AuditAction.PERMISSION_GRANT, 'case_manager', 'Staff Access'],
        [AuditAction.PERMISSION_GRANT, 'admin', ADMIN_BOOTSTRAP_VIA],
      ]);
      expect(audit.mock.calls[1][3]).toEqual({ resourceId: 'u-jordan', details: { email: 'jordan@example.com', role: 'admin', via: ADMIN_BOOTSTRAP_VIA } });
      expect(notified.mock.calls.map((c) => c[3])).toEqual([
        'You now have case-manager access, granted by manager@example.com. Sign in again to see the staff pages.',
        'You now have administrator access: your address is listed for it and there was no administrator yet. Sign in again to see the admin pages.',
      ]);
      expect(statements).toContain('COMMIT');
    });

    it('matches the list ignoring case', async () => {
      process.env.ADMIN_EMAILS = ' JORDAN@Example.com ';
      expect((await grantStaffRole(MANAGER, 'jordan@example.com', undefined, 'Joins the review team')).role).toBe('admin');
    });

    it('does not promote once an admin exists', async () => {
      users.push(user('u-admin', 'admin@example.com', 'admin'));
      expect((await grantStaffRole(MANAGER, 'jordan@example.com', undefined, 'Joins the review team')).role).toBe('case_manager');
      expect(audit).toHaveBeenCalledTimes(1);
    });

    it('does not promote an address that is not listed', async () => {
      process.env.ADMIN_EMAILS = 'someone-else@example.com';
      expect((await grantStaffRole(MANAGER, 'jordan@example.com', undefined, 'Joins the review team')).role).toBe('case_manager');
      expect(statements.some((s) => s.startsWith(`UPDATE users SET role = 'admin'`))).toBe(false);
    });

    it('does not promote a listed address that is given leadership access: only case managers are promoted', async () => {
      const result = await grantStaffRole({ ...MANAGER, actorRole: 'admin' }, 'jordan@example.com', 'leadership', 'Director');
      expect(result.role).toBe('leadership');
      expect(statements.some((s) => s.startsWith(`UPDATE users SET role = 'admin'`))).toBe(false);
    });

    it('a failed audit entry for the promotion undoes the whole grant', async () => {
      audit.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('audit database unavailable'));
      const error = await failure(grantStaffRole(MANAGER, 'jordan@example.com', undefined, 'Joins the review team'));
      expect(error?.message).toBe('audit database unavailable');
      expect(statements).toContain('ROLLBACK');
      expect(statements).not.toContain('COMMIT');
    });
  });
});

describe('revokeStaffRole', () => {
  beforeEach(() => {
    users = [
      user('u-manager', 'manager@example.com', 'case_manager'),
      user('u-second', 'second@example.com', 'case_manager'),
      user('u-jordan', 'jordan@example.com'),
      user('u-admin', 'admin@example.com', 'admin'),
      user('u-lead', 'lead@example.com', 'leadership'),
    ];
  });

  const unchanged = (...expected: [string, Role][]) => {
    expect(expected.map(([id]) => roleOf(id))).toEqual(expected.map(([, role]) => role));
    expect(audit).not.toHaveBeenCalled();
    expect(notified).not.toHaveBeenCalled();
    expect(statements).not.toContain('COMMIT');
  };

  it.each([[undefined], [''], ['  '], [7]])('needs a reason (%p)', async (reason) => {
    const error = await failure(revokeStaffRole(MANAGER, 'u-second', reason as any));
    expect(described(error)).toEqual([400, 'VALIDATION_ERROR', 'A reason is required. It is kept in the audit log.']);
    unchanged(['u-second', 'case_manager']);
  });

  it('refuses a reason over 500 characters', async () => {
    const error = await failure(revokeStaffRole(MANAGER, 'u-second', 'x'.repeat(501)));
    expect(described(error)).toEqual([400, 'VALIDATION_ERROR', 'The reason must be 500 characters or less.']);
    unchanged(['u-second', 'case_manager']);
  });

  it('does not let anyone remove their own access, an admin included', async () => {
    expect(described(await failure(revokeStaffRole(MANAGER, 'u-manager', 'Stepping back')))).toEqual([403, 'FORBIDDEN', 'You cannot remove your own access.']);
    expect(described(await failure(revokeStaffRole(ADMIN, 'u-admin', 'Stepping back')))).toEqual([403, 'FORBIDDEN', 'You cannot remove your own access.']);
    unchanged(['u-manager', 'case_manager'], ['u-admin', 'admin']);
  });

  it('answers 404 for an account that does not exist', async () => {
    const error = await failure(revokeStaffRole(MANAGER, 'u-nobody', 'No longer on the team'));
    expect(error?.statusCode).toBe(404);
    unchanged();
  });

  it('answers 409 for someone who has no staff access to remove', async () => {
    const error = await failure(revokeStaffRole(MANAGER, 'u-jordan', 'No longer on the team'));
    expect(described(error)).toEqual([409, 'CONFLICT', 'jordan@example.com has no staff access to remove.']);
    unchanged(['u-jordan', 'citizen']);
  });

  it.each([['u-admin', 'Administrator'], ['u-lead', 'Leadership']])('leaves %s alone when a case manager asks: 403', async (id, name) => {
    const error = await failure(revokeStaffRole(MANAGER, id, 'No longer on the team'));
    expect(described(error)).toEqual([403, 'FORBIDDEN', `${name} access can only be changed by an administrator.`]);
    unchanged([id, id === 'u-admin' ? 'admin' : 'leadership']);
  });

  it('removes access, records who did it, what they had and why, and tells the person', async () => {
    const removed = await revokeStaffRole(MANAGER, 'u-second', '  No longer on the review team  ');
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
          details: { email: 'second@example.com', role: 'citizen', previousRole: 'case_manager', reason: 'No longer on the review team', via: 'Staff Access' },
        },
      ],
    ]);
    expect(notified.mock.calls).toEqual([[client, 'u-second', null, 'Your case-manager access was removed by manager@example.com.']]);
    expect(statements).toContain('COMMIT');
  });

  it('an admin removes leadership access and administrator access (while another admin remains)', async () => {
    users.push(user('u-admin-2', 'admin2@example.com', 'admin'));
    await revokeStaffRole(ADMIN, 'u-lead', 'Left the program office');
    await revokeStaffRole(ADMIN, 'u-admin-2', 'Handed over administration');
    expect([roleOf('u-lead'), roleOf('u-admin-2')]).toEqual(['citizen', 'citizen']);
    expect(audit.mock.calls.map((c) => [c[3].details.previousRole, c[3].details.role])).toEqual([['leadership', 'citizen'], ['admin', 'citizen']]);
    expect(notified.mock.calls.map((c) => c[3])).toEqual([
      'Your leadership access was removed by admin@example.com.',
      'Your administrator access was removed by admin@example.com.',
    ]);
  });

  it('removing leadership is not held back by the number of case managers: it is not case-work access', async () => {
    users = [user('u-only', 'only@example.com', 'case_manager'), user('u-lead', 'lead@example.com', 'leadership')];
    await revokeStaffRole({ actorId: 'u-gone', actorEmail: 'gone@example.com', actorRole: 'admin' }, 'u-lead', 'Left the program office');
    expect(roleOf('u-lead')).toBe('citizen');
  });

  it('cannot remove the last staff member, even when the person asking was removed a moment ago', async () => {
    users = [user('u-only', 'only@example.com', 'case_manager'), user('u-jordan', 'jordan@example.com')];
    const gone = { actorId: 'u-gone', actorEmail: 'gone@example.com', actorRole: 'case_manager' as Role };
    const error = await failure(revokeStaffRole(gone, 'u-only', 'Cleaning up'));
    expect(described(error)).toEqual([409, 'CONFLICT', 'At least one case manager must keep access.']);
    expect(statements).toContain('ROLLBACK');
    unchanged(['u-only', 'case_manager']);
  });

  it('keeps one case manager when two try to remove each other', async () => {
    users = [user('u-a', 'a@example.com', 'case_manager'), user('u-b', 'b@example.com', 'case_manager')];
    const a = { actorId: 'u-a', actorEmail: 'a@example.com', actorRole: 'case_manager' as Role };
    const b = { actorId: 'u-b', actorEmail: 'b@example.com', actorRole: 'case_manager' as Role };
    const results = [await failure(revokeStaffRole(a, 'u-b', 'Left the team')), await failure(revokeStaffRole(b, 'u-a', 'Left the team'))];
    expect(results.map(described)).toEqual([null, [409, 'CONFLICT', 'At least one case manager must keep access.']]);
    expect(users.filter((u) => isStaff(u.role)).map((u) => u.id)).toEqual(['u-a']);
  });

  it('cannot remove the last admin, even when the person asking was removed a moment ago', async () => {
    users = [user('u-only', 'only@example.com', 'admin'), user('u-cm', 'cm@example.com', 'case_manager')];
    const gone = { actorId: 'u-gone', actorEmail: 'gone@example.com', actorRole: 'admin' as Role };
    const error = await failure(revokeStaffRole(gone, 'u-only', 'Cleaning up'));
    expect(described(error)).toEqual([409, 'CONFLICT', 'At least one administrator must keep access.']);
    expect(statements).toContain('ROLLBACK');
    unchanged(['u-only', 'admin']);
  });

  it('keeps one admin when two try to remove each other', async () => {
    users = [user('u-a', 'a@example.com', 'admin'), user('u-b', 'b@example.com', 'admin'), user('u-cm', 'cm@example.com', 'case_manager')];
    const a = { actorId: 'u-a', actorEmail: 'a@example.com', actorRole: 'admin' as Role };
    const b = { actorId: 'u-b', actorEmail: 'b@example.com', actorRole: 'admin' as Role };
    const results = [await failure(revokeStaffRole(a, 'u-b', 'Left the team')), await failure(revokeStaffRole(b, 'u-a', 'Left the team'))];
    expect(results.map(described)).toEqual([null, [409, 'CONFLICT', 'At least one administrator must keep access.']]);
    expect(users.filter((u) => u.role === 'admin').map((u) => u.id)).toEqual(['u-a']);
  });

  it('takes the staff lock before it checks and changes anything, so concurrent removals run one at a time', async () => {
    await revokeStaffRole(MANAGER, 'u-second', 'No longer on the review team');
    const position = (pattern: RegExp) => statements.findIndex((s) => pattern.test(s));
    expect(position(/^BEGIN$/)).toBeLessThan(position(/pg_advisory_xact_lock/));
    expect(position(/pg_advisory_xact_lock/)).toBeLessThan(position(/^SELECT id, email, full_name, role FROM users WHERE id/));
    expect(position(/pg_advisory_xact_lock/)).toBeLessThan(position(/^UPDATE users SET role = 'citizen'/));
    expect(statements.find((s) => s.startsWith(`UPDATE users SET role = 'citizen'`))).toContain(STAFF_GUARD);
  });

  it('puts the last-admin check in the removal statement itself', async () => {
    users.push(user('u-admin-2', 'admin2@example.com', 'admin'));
    await revokeStaffRole(ADMIN, 'u-admin-2', 'Handed over administration');
    expect(statements.find((s) => s.startsWith(`UPDATE users SET role = 'citizen'`))).toContain(ADMIN_GUARD);
  });
});
