import { afterEach, describe, expect, test, vi } from 'vitest';
import { cacheFileFor, FetchQueue, isAllowedImageUrl, RateLimitedError, scryfallFetch } from './cardImages';

afterEach(() => vi.useRealTimers());

describe('FetchQueue', () => {
  test('queue spaces requests >=100ms', async () => {
    vi.useFakeTimers();
    const times: number[] = [];
    const q = new FetchQueue(100, async () => {
      times.push(Date.now());
      return Buffer.from('x');
    });
    const all = Promise.all(['a', 'b', 'c'].map((u) => q.get(u)));
    await vi.advanceTimersByTimeAsync(500);
    await all;
    expect(times).toHaveLength(3);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(100);
    expect(times[2] - times[1]).toBeGreaterThanOrEqual(100);
  });

  test('a slow fetch does not hold up the next one beyond the start gap', async () => {
    vi.useFakeTimers();
    const started: Record<string, number> = {};
    const q = new FetchQueue(100, (u) => {
      started[u] = Date.now();
      return u === 'slow'
        ? new Promise<Buffer>((r) => setTimeout(() => r(Buffer.from('s')), 5000))
        : Promise.resolve(Buffer.from('f'));
    });
    const slow = q.get('slow');
    const fast = q.get('fast');
    await vi.advanceTimersByTimeAsync(150);
    expect(await fast).toEqual(Buffer.from('f'));
    expect(started.fast - started.slow).toBeGreaterThanOrEqual(100);
    expect(started.fast - started.slow).toBeLessThan(1000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await slow).toEqual(Buffer.from('s'));
  });

  test('a rate-limited url is retried after 15 s, not 5 minutes', async () => {
    vi.useFakeTimers();
    let n = 0;
    const q = new FetchQueue(0, async () => {
      if (n++ === 0) throw new RateLimitedError(0);
      return Buffer.from('ok');
    });
    await expect(q.get('u')).rejects.toThrow('rate limited');
    await expect(q.get('u')).rejects.toThrow('recently failed');
    await vi.advanceTimersByTimeAsync(16_000);
    await expect(q.get('u')).resolves.toEqual(Buffer.from('ok'));
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
    await expect(q.get('b')).resolves.toEqual(Buffer.from('ok'));
  });

  test('a stalled fetch times out and the next url still gets fetched', async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn((u: string) =>
      u === 'stall' ? new Promise<Buffer>(() => {}) : Promise.resolve(Buffer.from('ok')),
    );
    const q = new FetchQueue(100, fetchFn, 10_000);
    const stalled = q.get('stall').catch((e: Error) => e.message);
    const next = q.get('next');
    await vi.advanceTimersByTimeAsync(10_200);
    expect(await stalled).toBe('fetch timeout');
    expect(await next).toEqual(Buffer.from('ok'));
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  test('failed url is not re-fetched within 5 minutes, but is after', async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn(async () => {
      throw new Error('nope');
    });
    const q = new FetchQueue(0, fetchFn);
    await expect(q.get('u')).rejects.toThrow('nope');
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    await expect(q.get('u')).rejects.toThrow('recently failed');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(61_000);
    await expect(q.get('u')).rejects.toThrow('nope');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  test('429 delays the next request by Retry-After', async () => {
    vi.useFakeTimers();
    const times: number[] = [];
    const q = new FetchQueue(100, async (u) => {
      times.push(Date.now());
      if (u === 'a') throw new RateLimitedError(3000);
      return Buffer.from('ok');
    });
    const a = q.get('a').catch(() => undefined);
    const b = q.get('b');
    await vi.advanceTimersByTimeAsync(5000);
    await a;
    await b;
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(3000);
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

describe('scryfallFetch redirects', () => {
  const img = () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
  const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } });

  test('follows a redirect to cards.scryfall.io', async () => {
    const seen: string[] = [];
    const f = (async (u: string) => {
      seen.push(u);
      return u.startsWith('https://api.') ? redirect('https://cards.scryfall.io/normal/x.jpg') : img();
    }) as unknown as typeof fetch;
    expect((await scryfallFetch('https://api.scryfall.com/cards/named?exact=x', f)).length).toBe(3);
    expect(seen).toHaveLength(2);
  });

  test('redirect to a foreign host fails without requesting it', async () => {
    const seen: string[] = [];
    const f = (async (u: string) => {
      seen.push(u);
      return redirect('https://evil.example/x.jpg');
    }) as unknown as typeof fetch;
    await expect(scryfallFetch('https://api.scryfall.com/cards/x', f)).rejects.toThrow('blocked host');
    expect(seen).toEqual(['https://api.scryfall.com/cards/x']);
  });

  test('gives up after 3 hops', async () => {
    const f = (async () => redirect('https://cards.scryfall.io/loop')) as unknown as typeof fetch;
    await expect(scryfallFetch('https://api.scryfall.com/cards/x', f)).rejects.toThrow('too many redirects');
  });

  test('429 surfaces Retry-After', async () => {
    const f = (async () =>
      new Response('', { status: 429, headers: { 'retry-after': '7' } })) as unknown as typeof fetch;
    await expect(scryfallFetch('https://api.scryfall.com/cards/x', f)).rejects.toMatchObject({ retryAfterMs: 7000 });
  });
});
