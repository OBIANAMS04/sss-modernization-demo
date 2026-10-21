import { getQualityView } from '../services/aiQualityService';
import { checkSlos } from './sloService';
import { cleanupMetrics, flushMetrics } from './metricsStore';

// STORY-029: the in-process timer. Once a minute it writes the metrics of the minute that closed and evaluates every objective (opening
// and closing alerts); every few minutes it also runs the AI-quality drift check of STORY-021, which until now ran only when someone opened
// the page; once an hour it removes metrics older than 30 days. The timer is unref'd so it never keeps the process alive, and it does not
// run under jest. A failing check is logged and tried again next minute.

export const TICK_MS = Math.max(1000, Number.parseInt(process.env.OBSERVABILITY_INTERVAL_MS ?? '', 10) || 60_000);
/** The AI-quality check runs on every 5th tick (every 5 minutes at the default interval). */
export const QUALITY_EVERY_TICKS = 5;
export const CLEANUP_EVERY_TICKS = 60;

export async function runTick(tick: number): Promise<void> {
  try {
    await flushMetrics(false);
    await checkSlos();
  } catch (error) {
    console.error('Objective check failed', { message: (error as Error).message });
  }
  if (tick % QUALITY_EVERY_TICKS === 0) {
    try {
      await getQualityView(); // keeps change markers up to date and opens or closes the drift and fairness alerts
    } catch (error) {
      console.error('AI quality alert check failed', { message: (error as Error).message });
    }
  }
  if (tick % CLEANUP_EVERY_TICKS === 0) {
    try {
      const removed = await cleanupMetrics();
      if (removed > 0) console.log('Old metrics removed', { rows: removed });
    } catch (error) {
      console.error('Metrics cleanup failed', { message: (error as Error).message });
    }
  }
}

let timer: NodeJS.Timeout | undefined;

export function startObservabilityTimer(): void {
  if (timer || process.env.JEST_WORKER_ID || process.env.NODE_ENV === 'test') return;
  let tick = 0;
  let busy = false;
  timer = setInterval(() => {
    if (busy) return;
    busy = true;
    runTick(tick++).finally(() => {
      busy = false;
    });
  }, TICK_MS);
  timer.unref();
  // The first AI-quality check and cleanup shortly after the start, not after the first interval
  setTimeout(() => void runTick(0), 15_000).unref();
}
