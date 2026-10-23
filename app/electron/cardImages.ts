import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { protocol } from 'electron';

const ALLOWED_PREFIX = 'https://api.scryfall.com/cards/';
const ALLOWED_FINAL_HOSTS = new Set(['api.scryfall.com', 'cards.scryfall.io']);
const HEADERS = { 'User-Agent': 'CommanderDuel/0.1', Accept: '*/*' };

export function cacheFileFor(url: string, dir: string): string {
  return join(dir, createHash('sha1').update(url).digest('hex') + '.jpg');
}

export function isAllowedImageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'api.scryfall.com' && url.startsWith(ALLOWED_PREFIX);
  } catch {
    return false;
  }
}

/** Thrown by a fetchFn on HTTP 429 so the queue can back off before the next request. */
export class RateLimitedError extends Error {
  constructor(readonly retryAfterMs: number) {
    super('rate limited');
  }
}

const NEGATIVE_TTL_MS = 5 * 60_000;

/**
 * Serializes fetches at least minGapMs apart (Scryfall etiquette), shares in-flight work per url,
 * abandons a fetch after timeoutMs so one stall cannot wedge the queue, and remembers failures for
 * five minutes so remounting cards do not retry-storm.
 */
export class FetchQueue {
  private readonly inflight = new Map<string, Promise<Buffer>>();
  private readonly failedAt = new Map<string, number>();
  private tail: Promise<unknown> = Promise.resolve();
  private nextStart = 0;

  constructor(
    private readonly minGapMs: number,
    private readonly fetchFn: (url: string) => Promise<Buffer>,
    private readonly timeoutMs = 10_000,
  ) {}

  get(url: string): Promise<Buffer> {
    const existing = this.inflight.get(url);
    if (existing) return existing;
    const failed = this.failedAt.get(url);
    if (failed !== undefined) {
      if (Date.now() - failed < NEGATIVE_TTL_MS) return Promise.reject(new Error('recently failed'));
      this.failedAt.delete(url);
    }
    const run = this.tail.then(async () => {
      const wait = this.nextStart - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.nextStart = Date.now() + this.minGapMs;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error('fetch timeout')), this.timeoutMs);
      });
      try {
        return await Promise.race([this.fetchFn(url), timeout]);
      } catch (e) {
        if (e instanceof RateLimitedError) this.nextStart = Math.max(this.nextStart, Date.now() + e.retryAfterMs);
        throw e;
      } finally {
        clearTimeout(timer);
      }
    });
    this.tail = run.catch(() => undefined);
    const p = run.then(
      (data) => {
        this.inflight.delete(url);
        return data;
      },
      (e) => {
        this.inflight.delete(url);
        this.failedAt.set(url, Date.now());
        throw e;
      },
    );
    this.inflight.set(url, p);
    return p;
  }
}

const MAX_HOPS = 3;

/** Real network fetch: follows redirects by hand (max 3), vetting each hop's host before requesting it. */
export async function scryfallFetch(url: string, fetchImpl: typeof fetch = fetch): Promise<Buffer> {
  const signal = AbortSignal.timeout(10_000); // covers headers and the body read
  let current = url;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const u = new URL(current);
    if (u.protocol !== 'https:' || !ALLOWED_FINAL_HOSTS.has(u.hostname)) throw new Error(`blocked host ${u.hostname}`);
    const res = await fetchImpl(current, { headers: HEADERS, redirect: 'manual', signal });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error('redirect without location');
      current = new URL(loc, current).toString();
      continue;
    }
    if (res.status === 429) {
      const secs = Number(res.headers.get('retry-after'));
      throw new RateLimitedError((Number.isFinite(secs) && secs > 0 ? secs : 2) * 1000);
    }
    if (!res.ok) throw new Error(`scryfall ${res.status}`);
    if (!(res.headers.get('content-type') ?? '').startsWith('image/')) throw new Error('not an image');
    return Buffer.from(await res.arrayBuffer());
  }
  throw new Error('too many redirects');
}

/** Resolve an image from the disk cache or the network; failures are never cached on disk. */
export async function loadImage(url: string, dir: string, queue: FetchQueue): Promise<Buffer> {
  const file = cacheFileFor(url, dir);
  try {
    return await readFile(file);
  } catch {
    /* cache miss */
  }
  const data = await queue.get(url);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    await writeFile(tmp, data);
    await rename(tmp, file);
  } catch {
    /* cache write is best effort */
  }
  return data;
}

/** Must run before app 'ready'. */
export function registerCardScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'card', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

/** Call after app 'ready'. Serves card://img?u=<encoded scryfall url>. */
export function registerCardProtocol(dir: string): void {
  mkdirSync(dir, { recursive: true });
  const queue = new FetchQueue(100, scryfallFetch);
  protocol.handle('card', async (request) => {
    const u = new URL(request.url).searchParams.get('u');
    if (!u || !isAllowedImageUrl(u)) return new Response('bad request', { status: 400 });
    try {
      const data = await loadImage(u, dir, queue);
      return new Response(data, {
        status: 200,
        headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' },
      });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
}
