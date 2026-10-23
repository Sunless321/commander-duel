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

/** Serializes fetches at least minGapMs apart (Scryfall etiquette) and shares in-flight work per url. */
export class FetchQueue {
  private readonly inflight = new Map<string, Promise<Buffer>>();
  private tail: Promise<unknown> = Promise.resolve();
  private lastStart = 0;

  constructor(
    private readonly minGapMs: number,
    private readonly fetchFn: (url: string) => Promise<Buffer>,
  ) {}

  get(url: string): Promise<Buffer> {
    const existing = this.inflight.get(url);
    if (existing) return existing;
    const run = this.tail.then(async () => {
      const wait = this.lastStart + this.minGapMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastStart = Date.now();
      return this.fetchFn(url);
    });
    this.tail = run.catch(() => undefined);
    const p = run.finally(() => this.inflight.delete(url));
    this.inflight.set(url, p);
    return p;
  }
}

/** Real network fetch: follows Scryfall's redirect to cards.scryfall.io, only accepting those hosts. */
export async function scryfallFetch(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: HEADERS, redirect: 'follow' });
  if (!res.ok) throw new Error(`scryfall ${res.status}`);
  if (!ALLOWED_FINAL_HOSTS.has(new URL(res.url).hostname)) throw new Error(`unexpected host ${res.url}`);
  if (!(res.headers.get('content-type') ?? '').startsWith('image/')) throw new Error('not an image');
  return Buffer.from(await res.arrayBuffer());
}

/** Resolve an image from the disk cache or the network; failures are never cached. */
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
