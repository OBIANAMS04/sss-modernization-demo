// STORY-003: authenticator-app codes. Runs without a database: the mock below keeps the users, devices and attempt
// counts in memory and answers the statements the service sends, so a statement it does not know fails the test
// instead of passing silently. Codes are computed here with node:crypto (RFC 4226/6238), not with the library the
// service uses, so the two are checked against each other and against the RFC's own values.
jest.mock('../database/connection', () => ({ __esModule: true, default: { query: jest.fn(), connect: jest.fn() } }));

import { createHmac } from 'node:crypto';
import pool from '../database/connection';
import { UnauthorizedError } from '../utils/errors';
import {
  CodeRefusedError,
  disableMFA,
  generateMFASecret,
  isMFAEnabled,
  matchTotp,
  MAX_CODE_ATTEMPTS,
  newSecret,
  normalizeRecoveryCode,
  otpauthUrl,
  RECOVERY_CODE_COUNT,
  recoveryCodesLeft,
  regenerateRecoveryCodes,
  toBase32,
  verifyAndEnableMFA,
  verifyMFACode,
  verifySignInCode,
  verifySignInRecoveryCode,
} from './mfaService';
import { createHash } from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function fromBase32(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of text) {
    value = (value << 5) | B32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** The six-digit code for the 30-second step that contains `seconds`: HMAC-SHA1, dynamic truncation, as RFC 4226/6238 say. */
function codeAt(secret: string, seconds: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(seconds / 30)));
  const mac = createHmac('sha1', fromBase32(secret)).update(counter).digest();
  const offset = mac[19] & 0x0f;
  const binary = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(binary % 1_000_000).padStart(6, '0');
}

// RFC 6238 appendix B, key "12345678901234567890" (SHA-1): the last six digits of its eight-digit values
const RFC_SECRET = toBase32(Buffer.from('12345678901234567890'));
const RFC_VALUES: [number, string][] = [
  [59, '287082'],
  [1111111109, '081804'],
  [1111111111, '050471'],
  [1234567890, '005924'],
  [2000000000, '279037'],
  [20000000000, '353130'],
];

const NOW = 1_760_000_010; // seconds; 10 s into a 30 s step
const STEP = Math.floor(NOW / 30);
const at = (seconds: number) => jest.spyOn(Date, 'now').mockReturnValue(seconds * 1000);
/** The code that is valid `steps` steps from now. */
const code = (secret: string, steps = 0) => codeAt(secret, NOW + steps * 30);
/** A well-formed code that is not valid in any step of the window. */
const wrong = (secret: string) => {
  const valid = [-1, 0, 1].map((n) => code(secret, n));
  return ['000000', '111111', '222222'].find((c) => !valid.includes(c))!;
};

interface Device {
  id: string;
  user_id: string;
  secret_key: string;
  verified: boolean;
  last_used_step: number | null;
}

const USER = { id: 'user-1', email: 'person@example.com', full_name: 'Person One', role: 'citizen', created_at: new Date('2026-10-01T09:00:00Z'), mfa_enabled: false };
let users: (typeof USER)[] = [];
let devices: Device[] = [];
let attempts: Record<string, number> = {};
let finished: Set<string> = new Set();
let statements: string[] = [];
let recovery: { user_id: string; code_hash: string; used: boolean }[] = [];

const rows = (...r: unknown[]) => ({ rows: r });

/** The statements mfaService sends, answered over the in-memory tables. */
async function run(sql: string, params: any[] = []) {
  const text = sql.replace(/\s+/g, ' ').trim();
  statements.push(text);

  if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(text)) return rows();
  if (text === 'SELECT mfa_enabled FROM users WHERE id = $1') {
    const user = users.find((u) => u.id === params[0]);
    return user ? rows({ mfa_enabled: user.mfa_enabled }) : rows();
  }
  if (text.startsWith('SELECT id, email, full_name, role, created_at FROM users WHERE id = $1')) {
    const user = users.find((u) => u.id === params[0]);
    return user ? rows({ ...user }) : rows();
  }
  if (text === 'DELETE FROM mfa_devices WHERE user_id = $1 AND verified = FALSE') {
    devices = devices.filter((d) => d.user_id !== params[0] || d.verified);
    return rows();
  }
  if (text === 'DELETE FROM mfa_devices WHERE user_id = $1') {
    devices = devices.filter((d) => d.user_id !== params[0]);
    return rows();
  }
  if (text.startsWith(`INSERT INTO mfa_devices (user_id, device_name, secret_key, verified) VALUES ($1, 'Authenticator app', $2, FALSE)`)) {
    devices.push({ id: `device-${devices.length + 1}`, user_id: params[0], secret_key: params[1], verified: false, last_used_step: null });
    return rows();
  }
  if (text.startsWith('INSERT INTO mfa_code_attempts')) {
    attempts[params[0]] = (attempts[params[0]] ?? 0) + 1;
    return rows({ attempts: attempts[params[0]], completed_at: finished.has(params[0]) ? new Date() : null });
  }
  // As with the device update, the guard is what makes a pending sign-in give one session, so it must be there
  if (text.startsWith('UPDATE mfa_code_attempts SET completed_at = NOW() WHERE budget = $1') && text.includes('AND completed_at IS NULL')) {
    if (finished.has(params[0])) return rows();
    finished.add(params[0]);
    return rows({ budget: params[0] });
  }
  if (text.startsWith(`DELETE FROM mfa_code_attempts WHERE created_at < NOW() - INTERVAL '1 day'`)) return rows();
  if (text.startsWith('SELECT id, secret_key FROM mfa_devices WHERE user_id = $1 AND verified = FALSE')) {
    const device = [...devices].reverse().find((d) => d.user_id === params[0] && !d.verified);
    return device ? rows({ id: device.id, secret_key: device.secret_key }) : rows();
  }
  if (text.startsWith('SELECT id, secret_key, last_used_step FROM mfa_devices WHERE user_id = $1 AND verified = TRUE')) {
    const device = devices.find((d) => d.user_id === params[0] && d.verified);
    return device ? rows({ id: device.id, secret_key: device.secret_key, last_used_step: device.last_used_step }) : rows();
  }
  if (text.startsWith('UPDATE mfa_devices SET verified = TRUE, last_used_step = $2')) {
    const device = devices.find((d) => d.id === params[0])!;
    Object.assign(device, { verified: true, last_used_step: params[1] });
    return rows();
  }
  // The guard is the point of this statement: it is what makes a code usable once, so the statement is not recognised without it
  if (text.startsWith('UPDATE mfa_devices SET last_used_step = $2') && text.includes('(last_used_step IS NULL OR last_used_step < $2)')) {
    const device = devices.find((d) => d.id === params[0])!;
    if (device.last_used_step !== null && device.last_used_step >= params[1]) return rows();
    device.last_used_step = params[1];
    return rows({ id: device.id });
  }
  if (text.startsWith('UPDATE users SET mfa_enabled = TRUE')) {
    users.find((u) => u.id === params[0])!.mfa_enabled = true;
    return rows();
  }
  if (text.startsWith('UPDATE users SET mfa_enabled = false')) {
    users.find((u) => u.id === params[0])!.mfa_enabled = false;
    return rows();
  }
  // STORY-041: recovery codes
  if (text === 'DELETE FROM mfa_recovery_codes WHERE user_id = $1') {
    recovery = recovery.filter((c) => c.user_id !== params[0]);
    return rows();
  }
  if (text === 'INSERT INTO mfa_recovery_codes (user_id, code_hash) SELECT $1, unnest($2::text[])') {
    for (const hash of params[1]) recovery.push({ user_id: params[0], code_hash: hash, used: false });
    return rows();
  }
  if (text === 'SELECT COUNT(*)::int AS left FROM mfa_recovery_codes WHERE user_id = $1 AND used_at IS NULL') {
    return rows({ left: recovery.filter((c) => c.user_id === params[0] && !c.used).length });
  }
  // The guard makes a recovery code usable once, so the statement is not recognised without it
  if (text.startsWith('UPDATE mfa_recovery_codes SET used_at = NOW() WHERE user_id = $1 AND code_hash = $2') && text.includes('AND used_at IS NULL')) {
    const found = recovery.find((c) => c.user_id === params[0] && c.code_hash === params[1] && !c.used);
    if (!found) return rows();
    found.used = true;
    return rows({ id: 'rc' });
  }
  throw new Error(`Unexpected statement: ${text}`);
}

const query = pool.query as unknown as jest.Mock;
const connect = (pool as any).connect as jest.Mock;

beforeEach(() => {
  users = [{ ...USER }];
  devices = [];
  attempts = {};
  finished = new Set();
  statements = [];
  recovery = [];
  query.mockReset().mockImplementation(run);
  connect.mockReset().mockImplementation(async () => ({ query: jest.fn(run), release: jest.fn() }));
  at(NOW);
});

afterEach(() => jest.restoreAllMocks());

/** A person with two-step verification on: returns the key their authenticator holds. */
async function enrolled(): Promise<string> {
  const { secret } = await generateMFASecret(USER.id, USER.email);
  await verifyAndEnableMFA(USER.id, code(secret, -1), 'session:setup'); // the previous step's code, so this step's is still unspent
  return secret;
}

const refusedWith = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => null,
    (e) => e
  );
  expect(error).toBeInstanceOf(CodeRefusedError);
  return error as CodeRefusedError;
};

describe('matchTotp (RFC 6238, with a one-step window)', () => {
  it.each(RFC_VALUES)('agrees with the RFC test value at %i s', (seconds, expected) => {
    expect(matchTotp(RFC_SECRET, expected, seconds * 1000)).toBe(Math.floor(seconds / 30));
    expect(codeAt(RFC_SECRET, seconds)).toBe(expected);
  });

  it('accepts the code of the current step and of the step either side of it', () => {
    for (const steps of [-1, 0, 1]) {
      expect(matchTotp(RFC_SECRET, code(RFC_SECRET, steps))).toBe(STEP + steps);
    }
  });

  it('refuses the code of two steps away, on either side', () => {
    for (const steps of [-2, 2, -10, 10]) {
      expect(matchTotp(RFC_SECRET, code(RFC_SECRET, steps))).toBeNull();
    }
  });

  it('follows the clock: a code valid a minute ago is refused now', () => {
    const minuteAgo = codeAt(RFC_SECRET, NOW - 60);
    expect(matchTotp(RFC_SECRET, minuteAgo, (NOW - 60) * 1000)).toBe(STEP - 2);
    expect(matchTotp(RFC_SECRET, minuteAgo, NOW * 1000)).toBeNull();
  });

  it('refuses a wrong code, and anything that is not six digits, without throwing', () => {
    for (const bad of [wrong(RFC_SECRET), '12345', '1234567', 'abcdef', '', ' 12345', '12 456']) {
      expect(matchTotp(RFC_SECRET, bad)).toBeNull();
    }
  });

  it('does not let a malformed code pass for a code that starts with a zero (the library compares them as numbers)', () => {
    const at081804 = 1111111109 * 1000; // the code here is 081804
    expect(matchTotp(RFC_SECRET, '081804', at081804)).toBe(Math.floor(1111111109 / 30));
    for (const bad of [' 81804', '81804 ', '81804x', '+81804', '81804', '8.1804']) {
      expect(matchTotp(RFC_SECRET, bad, at081804)).toBeNull();
    }
  });
});

describe('secrets and the QR address', () => {
  it('encodes base32 as RFC 4648 does', () => {
    const vectors: [string, string][] = [['', ''], ['f', 'MY'], ['fo', 'MZXQ'], ['foo', 'MZXW6'], ['foob', 'MZXW6YQ'], ['fooba', 'MZXW6YTB'], ['foobar', 'MZXW6YTBOI']];
    for (const [plain, encoded] of vectors) expect(toBase32(Buffer.from(plain))).toBe(encoded);
  });

  it('makes a 160-bit key of 32 base32 characters, new every time, that the verifier reads the way an app does', () => {
    const first = newSecret();
    expect(first).toMatch(/^[A-Z2-7]{32}$/);
    expect(newSecret()).not.toBe(first);
    expect(matchTotp(first, codeAt(first, NOW))).toBe(STEP);
  });

  it('builds an otpauth address an authenticator app can add, with the account and issuer encoded', () => {
    const url = new URL(otpauthUrl('JBSWY3DPEHPK3PXP', 'person+test@example.com'));
    expect([url.protocol, url.hostname]).toEqual(['otpauth:', 'totp']);
    expect(decodeURIComponent(url.pathname)).toBe('/SSS Modernization Demo:person+test@example.com');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      secret: 'JBSWY3DPEHPK3PXP',
      issuer: 'SSS Modernization Demo',
      algorithm: 'SHA1',
      digits: '6',
      period: '30',
    });
  });
});

describe('setup and turning two-step verification on', () => {
  it('stores an unverified device, and returns the key, its address and a QR code image', async () => {
    const setup = await generateMFASecret(USER.id, USER.email);

    expect(setup.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.otpauthUrl).toContain(`secret=${setup.secret}`);
    expect(setup.qrCode).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/);
    expect(devices).toEqual([expect.objectContaining({ user_id: USER.id, secret_key: setup.secret, verified: false, last_used_step: null })]);
    expect(users[0].mfa_enabled).toBe(false);
  });

  it('keeps only the latest setup, so the QR code on screen is the key that can be confirmed', async () => {
    const first = await generateMFASecret(USER.id, USER.email);
    const second = await generateMFASecret(USER.id, USER.email);

    expect(devices.map((d) => d.secret_key)).toEqual([second.secret]);
    await refusedWith(verifyAndEnableMFA(USER.id, code(first.secret), 'session:a')); // the first QR code no longer works
    await verifyAndEnableMFA(USER.id, code(second.secret), 'session:a');
    expect(users[0].mfa_enabled).toBe(true);
  });

  it('refuses a wrong code and leaves two-step verification off', async () => {
    const { secret } = await generateMFASecret(USER.id, USER.email);

    const error = await refusedWith(verifyAndEnableMFA(USER.id, wrong(secret), 'session:a'));

    expect([error.statusCode, error.code]).toEqual([400, 'INVALID_CODE']);
    expect([users[0].mfa_enabled, devices[0].verified]).toEqual([false, false]);
    expect(await isMFAEnabled(USER.id)).toBe(false);
  });

  it('accepts the right code: the device is verified, the account is flagged, and the code is spent', async () => {
    const { secret } = await generateMFASecret(USER.id, USER.email);

    await verifyAndEnableMFA(USER.id, code(secret), 'session:a');

    expect(devices[0]).toMatchObject({ verified: true, last_used_step: STEP });
    expect(await isMFAEnabled(USER.id)).toBe(true);
  });

  it('says to start setup first when no setup was started', async () => {
    await expect(verifyAndEnableMFA(USER.id, '123456', 'session:a')).rejects.toMatchObject({ statusCode: 400, code: 'SETUP_NOT_STARTED' });
  });

  it('will not set up again, or confirm again, while two-step verification is on', async () => {
    await enrolled();

    await expect(generateMFASecret(USER.id, USER.email)).rejects.toMatchObject({ statusCode: 409 });
    await expect(verifyAndEnableMFA(USER.id, '123456', 'session:a')).rejects.toMatchObject({ statusCode: 409 });
  });

  it('counts setup tries against the same limit as everything else', async () => {
    const { secret } = await generateMFASecret(USER.id, USER.email);
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) await refusedWith(verifyAndEnableMFA(USER.id, wrong(secret), 'session:a'));

    const error = await refusedWith(verifyAndEnableMFA(USER.id, code(secret), 'session:a'));

    expect([error.statusCode, error.code]).toEqual([429, 'TOO_MANY_ATTEMPTS']);
    expect(users[0].mfa_enabled).toBe(false);
  });

  it('removes the device and the flag when it is turned off', async () => {
    await enrolled();

    await disableMFA(USER.id);

    expect([devices.length, users[0].mfa_enabled]).toEqual([0, false]);
  });
});

describe('the sign-in code and its attempt limit', () => {
  const pending = (jti: string) => ({ sub: USER.id, email: USER.email, jti });

  it('gives the person back when the code is right, shaped like a password login', async () => {
    const secret = await enrolled();

    expect(await verifySignInCode(pending('a'), code(secret))).toEqual({
      id: USER.id,
      email: USER.email,
      fullName: 'Person One',
      createdAt: USER.created_at,
      role: 'citizen',
    });
  });

  it('allows five tries: four wrong codes say how many are left, and the fifth wrong code ends the sign-in', async () => {
    const secret = await enrolled();
    const messages: string[] = [];
    for (let i = 0; i < MAX_CODE_ATTEMPTS - 1; i++) {
      const error = await refusedWith(verifySignInCode(pending('a'), wrong(secret)));
      expect([error.statusCode, error.code, error.attempt]).toEqual([400, 'INVALID_CODE', i + 1]);
      messages.push(error.message);
    }
    expect(messages).toEqual([
      'That code is not correct. 4 tries left.',
      'That code is not correct. 3 tries left.',
      'That code is not correct. 2 tries left.',
      'That code is not correct. 1 try left.',
    ]);

    const last = await refusedWith(verifySignInCode(pending('a'), wrong(secret)));

    expect([last.statusCode, last.code, last.attempt, last.message]).toEqual([429, 'TOO_MANY_ATTEMPTS', 5, 'Too many incorrect codes. Please sign in again.']);
  });

  it('refuses the right code once five have been tried, and keeps refusing', async () => {
    const secret = await enrolled();
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) await refusedWith(verifySignInCode(pending('a'), wrong(secret)));

    for (let i = 0; i < 3; i++) {
      const error = await refusedWith(verifySignInCode(pending('a'), code(secret)));
      expect([error.statusCode, error.code]).toEqual([429, 'TOO_MANY_ATTEMPTS']);
    }
    expect(devices[0].last_used_step).toBe(STEP - 1); // the refused attempts spent nothing
  });

  it('still accepts the right code on the fifth try', async () => {
    const secret = await enrolled();
    for (let i = 0; i < MAX_CODE_ATTEMPTS - 1; i++) await refusedWith(verifySignInCode(pending('a'), wrong(secret)));

    await expect(verifySignInCode(pending('a'), code(secret))).resolves.toMatchObject({ id: USER.id });
  });

  it('gives one session per pending sign-in: after the right code, the same pending token is refused, even with a later code', async () => {
    const secret = await enrolled();
    await verifySignInCode(pending('a'), code(secret));

    const error = await verifySignInCode(pending('a'), code(secret, 1)).then(() => null, (e) => e);

    expect(error).toBeInstanceOf(UnauthorizedError);
    expect([error.statusCode, error.message]).toEqual([401, 'This sign-in is already finished. Please sign in again.']);
    expect(devices[0].last_used_step).toBe(STEP); // refused before the code was looked at, so the next step's code is unspent
    await expect(verifySignInCode(pending('b'), code(secret, 1))).resolves.toMatchObject({ id: USER.id });
  });

  it('lets only one of two requests racing on the same pending token finish the sign-in', async () => {
    const secret = await enrolled();
    // Hold the first request just before it finishes the sign-in, so the second gets past the device check too (with the
    // next step's code): only the guard on the completion is left to stop a second session.
    let reached!: () => void;
    let release!: () => void;
    const atCompletion = new Promise<void>((resolve) => (reached = resolve));
    const held = new Promise<void>((resolve) => (release = resolve));
    let completions = 0;
    query.mockImplementation(async (sql: string, params: any[]) => {
      if (sql.replace(/\s+/g, ' ').trim().startsWith('UPDATE mfa_code_attempts SET completed_at') && ++completions === 1) {
        reached();
        await held;
      }
      return run(sql, params);
    });

    const first = verifySignInCode(pending('a'), code(secret)).then(() => 'session', (e) => e);
    await atCompletion;
    const second = await verifySignInCode(pending('a'), code(secret, 1)).then(() => 'session', (e) => e);
    release();

    expect(second).toBe('session');
    const error = await first;
    expect(error).toBeInstanceOf(UnauthorizedError);
    expect(error.message).toBe('This sign-in is already finished. Please sign in again.');
    expect(devices[0].last_used_step).toBe(STEP + 1); // both codes were accepted by the device check
  });

  it('counts per pending sign-in: signing in again starts a new count with the same unspent code', async () => {
    const secret = await enrolled();
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) await refusedWith(verifySignInCode(pending('a'), wrong(secret)));
    await refusedWith(verifySignInCode(pending('a'), code(secret)));

    await expect(verifySignInCode(pending('b'), code(secret))).resolves.toMatchObject({ id: USER.id });
  });

  it('counts a try before it checks the code, whatever the outcome', async () => {
    const secret = await enrolled();
    statements = [];

    await verifySignInCode(pending('a'), code(secret));

    expect(attempts['sign-in:a']).toBe(1);
    const counted = statements.findIndex((s) => s.startsWith('INSERT INTO mfa_code_attempts'));
    const checked = statements.findIndex((s, i) => i > counted && s.startsWith('SELECT id, secret_key, last_used_step'));
    expect(counted).toBeGreaterThan(-1);
    expect(checked).toBeGreaterThan(counted);
  });

  it('never accepts the same code twice, for the same person, even for another sign-in', async () => {
    const secret = await enrolled();
    await verifySignInCode(pending('a'), code(secret));

    const again = await refusedWith(verifySignInCode(pending('b'), code(secret)));

    expect([again.statusCode, again.code]).toEqual([400, 'CODE_ALREADY_USED']);
    expect(again.message).toBe('That code was already used. Wait for the next code in your app. 4 tries left.');
  });

  it('refuses an earlier step once a later one was used, but accepts a later one', async () => {
    const secret = await enrolled(); // the setup spent the previous step
    await verifySignInCode(pending('a'), code(secret, 0));

    expect((await refusedWith(verifySignInCode(pending('b'), code(secret, -1)))).code).toBe('CODE_ALREADY_USED');
    expect((await refusedWith(verifySignInCode(pending('b'), code(secret, 0)))).code).toBe('CODE_ALREADY_USED');
    await expect(verifySignInCode(pending('b'), code(secret, 1))).resolves.toMatchObject({ id: USER.id });
  });

  it('refuses the code that turned two-step verification on, until the next one', async () => {
    const { secret } = await generateMFASecret(USER.id, USER.email);
    await verifyAndEnableMFA(USER.id, code(secret, 0), 'session:setup');

    expect((await refusedWith(verifySignInCode(pending('a'), code(secret, 0)))).code).toBe('CODE_ALREADY_USED');
    await expect(verifySignInCode(pending('a'), code(secret, 1))).resolves.toMatchObject({ id: USER.id });
  });

  it('refuses a code from outside the window', async () => {
    const secret = await enrolled();

    for (const steps of [-2, 2]) {
      expect((await refusedWith(verifySignInCode(pending(`w${steps}`), code(secret, steps)))).code).toBe('INVALID_CODE');
    }
  });

  it('answers 401 when two-step verification was turned off meanwhile, or the person is gone, without spending anything', async () => {
    const secret = await enrolled();
    await disableMFA(USER.id);
    await expect(verifySignInCode(pending('a'), code(secret))).rejects.toMatchObject({ statusCode: 401 });

    users = [];
    await expect(verifySignInCode(pending('b'), code(secret))).rejects.toMatchObject({ statusCode: 401 });
    expect(attempts['sign-in:b']).toBeUndefined();
  });
});

describe('a code checked for a signed-in session (turning two-step verification off)', () => {
  it('accepts a right code once and counts every try against the session', async () => {
    const secret = await enrolled();
    await refusedWith(verifyMFACode(USER.id, wrong(secret), 'session:user-1:100'));

    await expect(verifyMFACode(USER.id, code(secret), 'session:user-1:100')).resolves.toBeUndefined();

    expect(attempts['session:user-1:100']).toBe(2);
    expect((await refusedWith(verifyMFACode(USER.id, code(secret), 'session:user-1:100'))).code).toBe('CODE_ALREADY_USED');
  });

  it('ends after five tries; a new sign-in (a new session) starts again', async () => {
    const secret = await enrolled();
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) await refusedWith(verifyMFACode(USER.id, wrong(secret), 'session:user-1:100'));

    expect((await refusedWith(verifyMFACode(USER.id, code(secret), 'session:user-1:100'))).code).toBe('TOO_MANY_ATTEMPTS');
    await expect(verifyMFACode(USER.id, code(secret), 'session:user-1:200')).resolves.toBeUndefined();
  });
});

describe('what is kept and what is said', () => {
  it('never writes the key or a code to the log', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { secret } = await generateMFASecret(USER.id, USER.email);
    await refusedWith(verifyAndEnableMFA(USER.id, wrong(secret), 'session:a'));
    await verifyAndEnableMFA(USER.id, code(secret), 'session:a');

    expect([spy.mock.calls.length, errors.mock.calls.length]).toEqual([0, 0]);
  });

  it('sends the key and codes only as statement parameters, never inside the statement text', async () => {
    const { secret } = await generateMFASecret(USER.id, USER.email);
    await verifyAndEnableMFA(USER.id, code(secret), 'session:a');

    expect(statements.some((s) => s.includes(secret) || s.includes(code(secret)))).toBe(false);
  });
});

describe('recovery codes (STORY-041)', () => {
  const pending = (jti: string) => ({ sub: USER.id, email: USER.email, jti });
  async function enrolledWithCodes(): Promise<{ secret: string; codes: string[] }> {
    const { secret } = await generateMFASecret(USER.id, USER.email);
    const codes = await verifyAndEnableMFA(USER.id, code(secret, -1), 'session:setup');
    return { secret, codes };
  }

  it('makes ten codes of 80 random bits when two-step verification is turned on, and keeps only their hashes', async () => {
    const { codes } = await enrolledWithCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    for (const c of codes) expect(c).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/);
    expect(recovery.map((r) => r.code_hash)).toEqual(codes.map((c) => createHash('sha256').update(c.replace(/-/g, '')).digest('hex')));
    // No statement carries a code in its text, and no parameter carries a code in the clear
    const sent = query.mock.calls.concat(...connect.mock.results.map((r: any) => [])).flat(2).map(String).join(' ');
    for (const c of codes) expect(statements.join(' ') + sent).not.toContain(c.replace(/-/g, ''));
    expect(await recoveryCodesLeft(USER.id)).toBe(10);
  });

  it('signs in with a recovery code once; the same code is refused after, and counts as a try', async () => {
    const { codes } = await enrolledWithCodes();
    const result = await verifySignInRecoveryCode(pending('p1'), codes[3].toLowerCase().replace(/-/g, ' '));
    expect(result.user.id).toBe(USER.id);
    expect(result.left).toBe(9);
    const again = await refusedWith(verifySignInRecoveryCode(pending('p2'), codes[3]));
    expect([again.statusCode, again.code, again.attempt]).toEqual([400, 'INVALID_RECOVERY_CODE', 1]);
  });

  it('shares the five tries with the 6-digit code, and a finished sign-in cannot be reused with a recovery code', async () => {
    const { secret, codes } = await enrolledWithCodes();
    for (let i = 1; i <= 4; i++) await refusedWith(verifySignInRecoveryCode(pending('p3'), 'AAAA-AAAA-AAAA-AAAA'));
    const fifth = await refusedWith(verifySignInCode(pending('p3'), wrong(secret)));
    expect([fifth.statusCode, fifth.code]).toEqual([429, 'TOO_MANY_ATTEMPTS']);
    await refusedWith(verifySignInRecoveryCode(pending('p3'), codes[0]));
    await verifySignInRecoveryCode(pending('p4'), codes[0]);
    await expect(verifySignInRecoveryCode(pending('p4'), codes[1])).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('refuses something that cannot be a recovery code without looking it up', async () => {
    await enrolledWithCodes();
    for (const bad of ['', '123456', 'AAAA-AAAA-AAAA', 'AAAA-AAAA-AAAA-AAA1', 42, null]) expect(normalizeRecoveryCode(bad)).toBeNull();
    await refusedWith(verifySignInRecoveryCode(pending('p5'), '123456'));
    expect(statements.some((s) => s.startsWith('UPDATE mfa_recovery_codes'))).toBe(false);
  });

  it('makes new codes only after a current 6-digit code; the old ones stop working', async () => {
    const { secret, codes } = await enrolledWithCodes();
    await refusedWith(regenerateRecoveryCodes(USER.id, wrong(secret), 'session:x'));
    const fresh = await regenerateRecoveryCodes(USER.id, code(secret, 0), 'session:x');
    expect(fresh).toHaveLength(10);
    await refusedWith(verifySignInRecoveryCode(pending('p6'), codes[0]));
    expect((await verifySignInRecoveryCode(pending('p7'), fresh[0])).left).toBe(9);
  });

  it('removes the codes when two-step verification is turned off', async () => {
    await enrolledWithCodes();
    await disableMFA(USER.id);
    expect(recovery).toHaveLength(0);
  });
});
