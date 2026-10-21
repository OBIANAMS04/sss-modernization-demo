import { coalesce } from './coalesce';

describe('coalesce', () => {
  it('runs one computation for callers that overlap and gives each the same answer', async () => {
    let runs = 0;
    let release!: (v: number) => void;
    const compute = () => {
      runs++;
      return new Promise<number>((resolve) => (release = resolve));
    };
    const calls = [coalesce('k', compute), coalesce('k', compute), coalesce('k', compute)];
    release(42);
    expect(await Promise.all(calls)).toEqual([42, 42, 42]);
    expect(runs).toBe(1);
  });

  it('keeps nothing once it finishes, so a later caller sees later data', async () => {
    let value = 1;
    expect(await coalesce('later', async () => value)).toBe(1);
    value = 2;
    expect(await coalesce('later', async () => value)).toBe(2);
  });

  it('keeps different keys apart and lets a failure reach every waiting caller without caching it', async () => {
    const fail = () => Promise.reject(new Error('boom'));
    const waiting = [coalesce('f', fail), coalesce('f', fail)];
    await expect(waiting[0]).rejects.toThrow('boom');
    await expect(waiting[1]).rejects.toThrow('boom');
    expect(await coalesce('f', async () => 'recovered')).toBe('recovered');
    expect(await coalesce('other', async () => 'a')).toBe('a');
  });
});
