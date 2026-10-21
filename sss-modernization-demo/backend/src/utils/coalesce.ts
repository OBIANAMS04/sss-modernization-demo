const inFlight = new Map<string, Promise<unknown>>();

/**
 * STORY-033: callers that ask for the same thing while it is already being computed share that one computation. Nothing is kept once
 * it finishes, so a caller that starts after a write always sees the write; only callers whose requests overlap share an answer
 * (which is at most as old as the computation, a few hundred milliseconds). It is for reads that are the same for every caller
 * (the admin and leadership dashboards, the freshness dashboard, the case statistics), which each run a handful of aggregate queries.
 * Without it N staff opening a dashboard together run N times that many queries and take the connection pool away from everyone else.
 */
export function coalesce<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const running = inFlight.get(key);
  if (running) return running as Promise<T>;
  const started = compute().finally(() => {
    if (inFlight.get(key) === started) inFlight.delete(key);
  });
  inFlight.set(key, started);
  return started;
}
