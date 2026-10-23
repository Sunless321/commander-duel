import { describe, expect, test, vi } from 'vitest';
import { cacheFileFor, FetchQueue, isAllowedImageUrl } from './cardImages';

describe('FetchQueue', () => {
  test('queue spaces requests >=100ms', async () => {
    const times: number[] = [];
    const q = new FetchQueue(100, async () => {
      times.push(Date.now());
      return Buffer.from('x');
    });
    await Promise.all(['a', 'b', 'c'].map((u) => q.get(u)));
    expect(times).toHaveLength(3);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(99);
    expect(times[2] - times[1]).toBeGreaterThanOrEqual(99);
  });

  test('queue dedupes same url', async () => {
    const fetchFn = vi.fn(async () => Buffer.from('x'));
    const q = new FetchQueue(0, fetchFn);
    const [a, b] = await Promise.all([q.get('u'), q.get('u')]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  test('a failed fetch rejects and does not block later requests', async () => {
    let n = 0;
    const q = new FetchQueue(0, async () => {
      if (n++ === 0) throw new Error('boom');
      return Buffer.from('ok');
    });
    await expect(q.get('a')).rejects.toThrow('boom');
    await expect(q.get('a')).resolves.toEqual(Buffer.from('ok'));
  });
});

test('rejects non-scryfall urls', () => {
  expect(isAllowedImageUrl('https://api.scryfall.com/cards/named?exact=Sol+Ring&format=image')).toBe(true);
  expect(isAllowedImageUrl('http://api.scryfall.com/cards/x')).toBe(false);
  expect(isAllowedImageUrl('https://evil.com/cards/x')).toBe(false);
  expect(isAllowedImageUrl('https://api.scryfall.com.evil.com/cards/x')).toBe(false);
  expect(isAllowedImageUrl('https://api.scryfall.com/other')).toBe(false);
  expect(isAllowedImageUrl('not a url')).toBe(false);
});

test('cacheFileFor is sha1 + .jpg inside dir', () => {
  const f = cacheFileFor('abc', 'D');
  expect(f).toMatch(/a9993e364706816aba3e25717850c26c9cd0d89d\.jpg$/);
});
