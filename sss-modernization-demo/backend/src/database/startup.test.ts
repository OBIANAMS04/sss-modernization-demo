import { availability, beginStartup, isDatabaseUnavailable, resetAvailability } from './availability';
import { backoffDelay, startSupervisor } from './startup';

const refused = () => Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
const silent = { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as any;
const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  resetAvailability();
  beginStartup();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => resetAvailability());

describe('backoffDelay', () => {
  it('doubles from 1 s to a 30 s cap, spread by up to 20%', () => {
    const mid = () => 0.5; // factor 1.0
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((n) => backoffDelay(n, 1000, 30000, mid))).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    expect(backoffDelay(1, 1000, 30000, () => 0)).toBe(800);
    expect(backoffDelay(1, 1000, 30000, () => 1)).toBe(1200);
  });
});

describe('startSupervisor', () => {
  const sleeps: number[] = [];
  const sleep = async (ms: number) => void sleeps.push(ms);
  beforeEach(() => (sleeps.length = 0));

  it('waits for an unreachable database, keeps finished steps finished, and opens the API by itself when the last step is done', async () => {
    let dbUp = false;
    const ran: string[] = [];
    const step = (name: string) => ({
      name,
      run: async () => {
        if (!dbUp) throw refused();
        ran.push(name);
      },
    });
    const supervisor = startSupervisor({
      steps: [step('migrations'), step('roles')],
      probe: async () => {},
      onFatal: jest.fn(),
      sleep: async (ms) => {
        sleeps.push(ms);
        if (sleeps.length === 3) dbUp = true;
      },
      random: () => 0.5,
      probeIntervalMs: 1,
      log: silent,
    });
    expect(await supervisor.startupDone).toBe(true);
    expect(sleeps.slice(0, 3)).toEqual([1000, 2000, 4000]);
    expect(ran).toEqual(['migrations', 'roles']);
    expect(availability()).toMatchObject({ database: 'ok', startup: 'complete' });
    supervisor.stop();
  });

  it('shows the database as down while waiting, so data routes answer 503', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    const supervisor = startSupervisor({
      steps: [
        {
          name: 'migrations',
          run: async () => {
            if (calls++ === 0) throw refused();
          },
        },
      ],
      probe: async () => {},
      onFatal: jest.fn(),
      sleep: async () => {
        await gate;
      },
      log: silent,
    });
    await flush();
    expect(availability()).toMatchObject({ database: 'down', startup: 'pending' });
    release();
    expect(await supervisor.startupDone).toBe(true);
    expect(availability()).toMatchObject({ database: 'ok', startup: 'complete' });
    supervisor.stop();
  });

  it('does not run a step again once it has finished', async () => {
    let migrationRuns = 0;
    let rolesFail = 2;
    const supervisor = startSupervisor({
      steps: [
        { name: 'migrations', run: async () => void migrationRuns++ },
        {
          name: 'roles',
          run: async () => {
            if (rolesFail-- > 0) throw refused();
          },
        },
      ],
      probe: async () => {},
      onFatal: jest.fn(),
      sleep,
      probeIntervalMs: 1,
      log: silent,
    });
    expect(await supervisor.startupDone).toBe(true);
    expect(migrationRuns).toBe(1);
    supervisor.stop();
  });

  it('calls onFatal, and does not retry or open the API, when a step fails for a reason other than the database being unreachable (a failed migration)', async () => {
    const onFatal = jest.fn();
    const failed = new Error('Migration 026_x.sql failed: syntax error');
    expect(isDatabaseUnavailable(failed)).toBe(false);
    const roles = jest.fn();
    const supervisor = startSupervisor({
      steps: [
        {
          name: 'migrations',
          run: async () => {
            throw failed;
          },
        },
        { name: 'roles', run: roles },
      ],
      probe: async () => {},
      onFatal,
      sleep,
      log: silent,
    });
    expect(await supervisor.startupDone).toBe(false);
    expect(onFatal).toHaveBeenCalledWith(failed, 'migrations');
    expect(roles).not.toHaveBeenCalled();
    expect(sleeps).toEqual([]);
    expect(availability().startup).toBe('pending');
    supervisor.stop();
  });

  it('notices a database that goes away after the start and one that comes back', async () => {
    let up = true;
    const states: string[] = [];
    let ticks = 0;
    const supervisor = startSupervisor({
      steps: [],
      onFatal: jest.fn(),
      log: silent,
      probe: async () => {
        if (!up) throw refused();
      },
      sleep: async () => {
        ticks++;
        states.push(availability().database);
        if (ticks === 2) up = false;
        if (ticks === 4) up = true;
        if (ticks === 7) supervisor.stop();
        await flush();
      },
    });
    await supervisor.startupDone;
    await new Promise((r) => setTimeout(r, 100));
    expect(states.slice(0, 7)).toEqual(['ok', 'ok', 'down', 'down', 'ok', 'ok', 'ok']);
  });
});
