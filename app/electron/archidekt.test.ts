import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { fetchArchidekt, parseArchidekt, parseDeckId, parseTextList } from './archidekt';

const fixture = () => JSON.parse(readFileSync(join(__dirname, '__fixtures__/archidekt-deck.json'), 'utf8'));

afterEach(() => vi.unstubAllGlobals());

test('parseDeckId variants', () => {
  expect(parseDeckId('https://archidekt.com/decks/123456/slug')).toBe('123456');
  expect(parseDeckId('archidekt.com/decks/123456')).toBe('123456');
  expect(parseDeckId('123456')).toBe('123456');
  expect(parseDeckId('https://example.com')).toBeNull();
  expect(parseDeckId('1 Sol Ring')).toBeNull();
});

test('fixture yields commander and 99ish', () => {
  const r = parseArchidekt(fixture());
  if (!r.ok) throw new Error(r.error);
  expect(r.name).toBe('Buffs by Hans');
  expect(r.commanders).toEqual(['Xyris, the Writhing Storm']);
  const total = r.main.reduce((n, c) => n + c.count, 0) + r.commanders.length;
  expect(total).toBe(100);
  expect(r.main.some((c) => c.name === 'Xyris, the Writhing Storm')).toBe(false);
});

test('maybeboard excluded', () => {
  const d = fixture();
  d.categories.push({ id: 1, name: 'Maybeboard', includedInDeck: false, includedInPrice: false });
  const card = JSON.parse(JSON.stringify(d.cards[0]));
  card.categories = ['Maybeboard'];
  card.card.oracleCard.name = 'Zzz Maybe Card';
  d.cards.push(card);
  const r = parseArchidekt(d);
  if (!r.ok) throw new Error(r.error);
  expect(r.main.some((c) => c.name === 'Zzz Maybe Card')).toBe(false);
});

test('private deck gives readable error', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
  const r = await fetchArchidekt('1');
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toContain('Public or Unlisted');
});

test('network failure gives readable error', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
  const r = await fetchArchidekt('1');
  expect(r).toEqual({ ok: false, error: "Couldn't reach Archidekt — check your internet connection." });
});

test('fetchArchidekt sends UA and parses', async () => {
  const f = vi.fn(async () => new Response(JSON.stringify(fixture()), { status: 200 }));
  vi.stubGlobal('fetch', f);
  const r = await fetchArchidekt('7031486');
  expect(r.ok).toBe(true);
  const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('https://archidekt.com/api/decks/7031486/');
  expect((init.headers as Record<string, string>)['User-Agent']).toBe('CommanderDuel/0.1');
});

test('parseTextList handles *CMDR*', () => {
  const r = parseTextList('1 Atraxa, Praetors\' Voice *CMDR*\n1 Sol Ring\n4x Island\n\n// comment');
  expect(r).toEqual({
    ok: true,
    name: 'Pasted deck',
    commanders: ["Atraxa, Praetors' Voice"],
    main: [{ count: 1, name: 'Sol Ring' }, { count: 4, name: 'Island' }],
    skippedLines: [],
  });
});

test('parseTextList handles Commander header', () => {
  const r = parseTextList('Commander\n1 Krenko, Mob Boss\n\nDeck\n1 Sol Ring (c21) 263');
  if (!r.ok) throw new Error(r.error);
  expect(r.commanders).toEqual(['Krenko, Mob Boss']);
  expect(r.main).toEqual([{ count: 1, name: 'Sol Ring' }]);
});

test('parseTextList rejects empty', () => {
  expect(parseTextList('  \n// nothing\nSideboard\n1 A').ok).toBe(false);
});

const ok = (text: string) => {
  const r = parseTextList(text);
  if (!r.ok) throw new Error(r.error);
  return r;
};

test('parseTextList skips Sideboard, Maybeboard, Considering, Companion sections', () => {
  const r = ok('Deck\n1 Sol Ring\n\nSideboard\n1 A\n\n// Maybeboard\n1 B\nConsidering:\n1 C\nCompanion\n1 D\nMainboard\n1 Island');
  expect(r.main.map((c) => c.name)).toEqual(['Sol Ring', 'Island']);
});

test('parseTextList strips export suffixes and reads commander tags', () => {
  const r = ok(
    '1x Sol Ring (cmm) 123 [Ramp]\n1 Arcane Signet (c21) 5 *F* ^Tag,#fff^ [Ramp,Artifact]\n1 Foil (m21) 1 *E*\n1 Krenko, Mob Boss (m20) 1 [Commander{top}]',
  );
  expect(r.main.map((c) => c.name)).toEqual(['Sol Ring', 'Arcane Signet', 'Foil']);
  expect(r.commanders).toEqual(['Krenko, Mob Boss']);
});

test('parseTextList: no count means 1, SB: skipped, junk reported', () => {
  const r = ok('Sol Ring\nSB: 1 Foo\n42\n2 Island');
  expect(r.main).toEqual([{ count: 1, name: 'Sol Ring' }, { count: 2, name: 'Island' }]);
  expect(r.skippedLines).toEqual(['42']);
});

test('parseTextList: blank line ends Commander section', () => {
  const r = ok('Commander\n1 X\n\n1 Sol Ring');
  expect(r.commanders).toEqual(['X']);
  expect(r.main).toEqual([{ count: 1, name: 'Sol Ring' }]);
});

test('non-JSON 200 gives readable error', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 200 })));
  expect(await fetchArchidekt('1')).toEqual({ ok: false, error: 'Unexpected response from Archidekt.' });
});
