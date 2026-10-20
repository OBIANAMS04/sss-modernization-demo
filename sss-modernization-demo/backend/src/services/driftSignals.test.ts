// STORY-021: the daily signals and what counts as drift. Pure, so fixtures stand in for the database.
import { MIN_ANSWERS, SIGNALS, SignalCounts, evaluateDrift, isDrift, signalValues } from './driftSignals';

/** 100 answers with a healthy profile; a test changes only what it is about. */
const counts = (change: Partial<SignalCounts> = {}): SignalCounts => ({
  answers: 100, checked: 100, grounded: 100, withheld: 5, level1: 20, noAnswer: 5,
  withText: 90, citations: 180, characters: 27000, negative: 4, reported: 1, p95LatencyMs: 4000, ...change,
});
const by = (drift: ReturnType<typeof evaluateDrift>, key: string) => drift.find((d) => d.key === key)!;

describe('signalValues', () => {
  it('turns counts into the nine signals', () => {
    expect(signalValues(counts())).toEqual({
      groundedRate: 100, withheldRate: 5, level1Share: 20, noAnswerRate: 5, citationsPerAnswer: 2, answerLength: 300,
      p95LatencyMs: 4000, negativeFeedbackRate: 4, reportRate: 1,
    });
    expect(SIGNALS).toHaveLength(9);
  });

  it('gives no value, not a zero, where there is nothing to divide by', () => {
    const values = signalValues(counts({ answers: 0, checked: 0, withText: 0, p95LatencyMs: null }));
    expect(Object.values(values).every((v) => v === null)).toBe(true);
  });
});

describe('isDrift: the tolerance and the direction that is worse', () => {
  const def = (key: string) => SIGNALS.find((s) => s.key === key)!;
  it('grounded rate: down more than 2 points, not up, not exactly 2', () => {
    expect(isDrift(def('groundedRate'), 97.9, 100)).toBe(true);
    expect(isDrift(def('groundedRate'), 98, 100)).toBe(false);
    expect(isDrift(def('groundedRate'), 100, 90)).toBe(false);
  });
  it('p95 latency: up more than 50%, not down', () => {
    expect(isDrift(def('p95LatencyMs'), 6100, 4000)).toBe(true);
    expect(isDrift(def('p95LatencyMs'), 6000, 4000)).toBe(false);
    expect(isDrift(def('p95LatencyMs'), 1000, 4000)).toBe(false);
  });
  it('answer length: a large move either way', () => {
    expect(isDrift(def('answerLength'), 420, 300)).toBe(true);
    expect(isDrift(def('answerLength'), 200, 300)).toBe(true);
    expect(isDrift(def('answerLength'), 330, 300)).toBe(false);
  });
  it('a signal that was zero and is not drifts only in its worse direction', () => {
    expect(isDrift(def('p95LatencyMs'), 10, 0)).toBe(true);
    expect(isDrift(def('p95LatencyMs'), 0, 0)).toBe(false);
  });
});

describe('evaluateDrift: last 7 days against the 28 before', () => {
  it('is all ok when nothing moved', () => {
    expect(evaluateDrift(counts(), counts()).map((d) => d.state)).toEqual(Array(9).fill('ok'));
  });

  it('names the signal that drifted, with before and after', () => {
    const drift = evaluateDrift(counts({ grounded: 95 }), counts());
    expect(by(drift, 'groundedRate')).toMatchObject({ state: 'drift', recent: 95, baseline: 100, change: -5 });
    expect(by(drift, 'groundedRate').message).toBe('Grounded rate moved from 100% to 95% (down more than 2 points is drift).');
    expect(drift.filter((d) => d.state === 'drift')).toHaveLength(1);
  });

  it('catches a latency rise and a fall in citations', () => {
    const drift = evaluateDrift(counts({ p95LatencyMs: 7000, citations: 90 }), counts());
    expect(drift.filter((d) => d.state === 'drift').map((d) => d.key)).toEqual(['citationsPerAnswer', 'p95LatencyMs']);
  });

  it(`says "not enough data" below ${MIN_ANSWERS} answers in either window, for every signal`, () => {
    for (const drift of [evaluateDrift(counts({ answers: MIN_ANSWERS - 1 }), counts()), evaluateDrift(counts(), counts({ answers: 5 }))]) {
      expect(drift.every((d) => d.state === 'not-enough-data' && d.change === null && d.message === null)).toBe(true);
    }
    expect(evaluateDrift(counts({ answers: MIN_ANSWERS, grounded: 0 }), counts({ answers: MIN_ANSWERS })).some((d) => d.state === 'drift')).toBe(true);
  });

  it('is not enough data for a signal with no value in a window', () => {
    const drift = evaluateDrift(counts({ p95LatencyMs: null }), counts());
    expect(by(drift, 'p95LatencyMs').state).toBe('not-enough-data');
  });
});
