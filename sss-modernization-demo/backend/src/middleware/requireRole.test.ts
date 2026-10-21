jest.mock('../services/roleService', () => ({ getUserRole: jest.fn() }));

import { AppError } from '../utils/errors';
import { getUserRole } from '../services/roleService';
import { requireRole } from './requireRole';

const roleInDatabase = getUserRole as jest.Mock;

/** Runs the middleware as Express would and returns what it passed to next(). */
async function run(middleware: ReturnType<typeof requireRole>, user: any) {
  const req: any = { user };
  const next = jest.fn();
  await middleware(req, {} as any, next);
  expect(next).toHaveBeenCalledTimes(1);
  return { req, error: next.mock.calls[0][0] as AppError | undefined };
}

beforeEach(() => roleInDatabase.mockReset());

describe('requireRole', () => {
  it('lets a listed role through and puts the role it read on req.user', async () => {
    roleInDatabase.mockResolvedValue('admin');
    const { req, error } = await run(requireRole('admin'), { sub: 'u-1', email: 'a@example.com' });
    expect(error).toBeUndefined();
    expect(req.user.role).toBe('admin');
    expect(roleInDatabase).toHaveBeenCalledWith('u-1', undefined);
  });

  it.each([
    [['admin'], 'citizen', 'Access requires the administrator role'],
    [['admin'], 'case_manager', 'Access requires the administrator role'],
    [['admin'], 'leadership', 'Access requires the administrator role'],
    [['leadership', 'admin'], 'citizen', 'Access requires the leadership or administrator role'],
    [['leadership', 'admin'], 'case_manager', 'Access requires the leadership or administrator role'],
  ] as const)('refuses a role that is not listed (%j, %s) with a 403', async (roles, role, message) => {
    roleInDatabase.mockResolvedValue(role);
    const { req, error } = await run(requireRole(...roles), { sub: 'u-1' });
    expect([error?.statusCode, error?.code, error?.message]).toEqual([403, 'FORBIDDEN', message]);
    expect(req.user.role).toBeUndefined();
  });

  it('lets every listed role through', async () => {
    for (const role of ['leadership', 'admin']) {
      roleInDatabase.mockResolvedValue(role);
      expect((await run(requireRole('leadership', 'admin'), { sub: 'u-1' })).error).toBeUndefined();
    }
  });

  it('refuses an account that no longer exists, and a request with no user', async () => {
    roleInDatabase.mockResolvedValue(null);
    expect((await run(requireRole('admin'), { sub: 'u-gone' })).error?.statusCode).toBe(403);
    expect((await run(requireRole('admin'), undefined)).error?.statusCode).toBe(403);
    expect(roleInDatabase).toHaveBeenCalledTimes(1); // nothing to look up without a user
  });

  it('reads the role from the database on every request, so a change in Staff Access applies at once', async () => {
    const middleware = requireRole('admin');
    roleInDatabase.mockResolvedValueOnce('admin').mockResolvedValueOnce('citizen');
    expect((await run(middleware, { sub: 'u-1', role: 'admin' })).error).toBeUndefined();
    expect((await run(middleware, { sub: 'u-1', role: 'admin' })).error?.statusCode).toBe(403); // the token still says admin
  });

  it('passes a database failure on as an error rather than letting the request through', async () => {
    roleInDatabase.mockRejectedValue(new Error('database unavailable'));
    const { error } = await run(requireRole('admin'), { sub: 'u-1' });
    expect(error?.message).toBe('database unavailable');
  });
});
