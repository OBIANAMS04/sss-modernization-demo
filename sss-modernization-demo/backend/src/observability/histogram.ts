// STORY-027: durations are kept as counts in fixed buckets, so the figures of any number of minutes can be added together and a percentile
// of the whole window read from the sum (the percentile of a window cannot be got from the percentiles of its minutes). The bounds
// include 2000 ms, the p95 target, so "at or under the target" is exact.

/** Upper bounds in milliseconds; the last bucket is everything above the final bound. */
export const BOUNDS_MS = [5, 10, 25, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000];
export const BUCKETS = BOUNDS_MS.length + 1;

export const emptyHist = (): number[] => new Array(BUCKETS).fill(0);

export function bucketIndex(ms: number): number {
  for (let i = 0; i < BOUNDS_MS.length; i++) if (ms <= BOUNDS_MS[i]) return i;
  return BOUNDS_MS.length;
}

export function addToHist(hist: number[], ms: number): void {
  hist[bucketIndex(ms)] += 1;
}

export function mergeHist(into: number[], other: ArrayLike<number> | null | undefined): number[] {
  if (other) for (let i = 0; i < BUCKETS && i < other.length; i++) into[i] += Number(other[i]) || 0;
  return into;
}

/** The q-th quantile (0 to 1) of a histogram, interpolated inside the bucket it falls in; null when the histogram is empty. */
export function quantileFromHist(hist: ArrayLike<number>, q: number): number | null {
  let total = 0;
  for (let i = 0; i < hist.length; i++) total += hist[i];
  if (total === 0) return null;
  const target = q * total;
  let seen = 0;
  for (let i = 0; i < hist.length; i++) {
    const n = hist[i];
    if (n > 0 && seen + n >= target) {
      const lower = i === 0 ? 0 : BOUNDS_MS[i - 1];
      // Above the last bound nothing says how far above: the bound itself is the honest floor
      if (i >= BOUNDS_MS.length) return lower;
      return lower + ((BOUNDS_MS[i] - lower) * (target - seen)) / n;
    }
    seen += n;
  }
  return BOUNDS_MS[BOUNDS_MS.length - 1];
}

/** The q-th quantile of a sorted list, nearest rank; null when empty. */
export function quantileFromSorted(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
}
