import { completeStartup, isDatabaseUnavailable, markDatabaseDown, markDatabaseUp } from './availability';

/**
 * STORY-034: the work the server needs the database for before it can serve (migrations, staff roles, access policy, configuration
 * audit, document corpus, start audit) runs here, after the server is already listening, in a loop that waits for the database.
 *
 *   - A step that fails because the database cannot be reached is tried again after a backoff (1 s, doubling to 30 s, with jitter), and
 *     the steps that already finished are not run again. When the last step is done the data routes open, with no restart.
 *   - A step that fails because the database answered and the work is wrong (a migration whose SQL fails, a policy that cannot load, a
 *     document that cannot be read) is a fault in this release: onFatal is called and the process exits, exactly as before, so a Render
 *     deploy fails and the previous version keeps serving.
 *   - Once started, a probe every few seconds notices a database that goes away later and one that comes back.
 */

export interface StartupStep {
  name: string;
  run: () => Promise<void>;
}

export interface SupervisorOptions {
  steps: StartupStep[];
  /** A cheap round trip to the database; rejects when it cannot be reached. */
  probe: () => Promise<void>;
  /** Called for a step that failed for a reason other than the database being unreachable. Production exits the process. */
  onFatal: (error: unknown, step: string) => void;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  probeIntervalMs?: number;
  log?: Pick<Console, 'log' | 'warn' | 'error'>;
}

export interface Supervisor {
  /** Resolves when every step has run (or a step was fatal). */
  startupDone: Promise<boolean>;
  stop: () => void;
}

export const INITIAL_BACKOFF_MS = 1_000;
export const MAX_BACKOFF_MS = 30_000;
export const PROBE_INTERVAL_MS = 5_000;

/** The wait before attempt n (1-based): doubling from the initial value to the cap, then spread by up to 20% so instances do not retry in step. */
export function backoffDelay(attempt: number, initialMs = INITIAL_BACKOFF_MS, maxMs = MAX_BACKOFF_MS, random: () => number = Math.random): number {
  const base = Math.min(maxMs, initialMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.8 + 0.4 * random()));
}

export function startSupervisor(options: SupervisorOptions): Supervisor {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const log = options.log ?? console;
  const random = options.random ?? Math.random;
  let stopped = false;

  async function runSteps(): Promise<boolean> {
    let attempt = 0;
    for (let i = 0; i < options.steps.length && !stopped; ) {
      const step = options.steps[i];
      try {
        await step.run();
        i++;
        attempt = 0;
      } catch (error) {
        if (!isDatabaseUnavailable(error)) {
          log.error(`Startup step "${step.name}" failed; stopping this release:`, (error as Error).message ?? error);
          options.onFatal(error, step.name);
          return false;
        }
        attempt++;
        markDatabaseDown(error);
        const wait = backoffDelay(attempt, options.initialBackoffMs, options.maxBackoffMs, random);
        log.warn(`Startup step "${step.name}" is waiting for the database (attempt ${attempt}); trying again in ${wait} ms`);
        await sleep(wait);
      }
    }
    if (stopped) return false;
    markDatabaseUp();
    completeStartup();
    log.log('Startup finished; the API is serving');
    return true;
  }

  async function monitor(): Promise<void> {
    while (!stopped) {
      await sleep(options.probeIntervalMs ?? PROBE_INTERVAL_MS);
      if (stopped) return;
      try {
        await options.probe();
        markDatabaseUp();
      } catch (error) {
        if (isDatabaseUnavailable(error)) markDatabaseDown(error);
        else log.error('Database probe failed', (error as Error).message ?? error);
      }
    }
  }

  const startupDone = runSteps();
  void startupDone.then((ok) => (ok ? monitor() : undefined));
  return { startupDone, stop: () => void (stopped = true) };
}
