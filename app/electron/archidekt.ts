import type { ArchidektResult } from '../src/net/protocol';

export type { ArchidektResult };

const PRIVATE_MSG = "That deck is private or doesn't exist. In Archidekt, set it to Public or Unlisted.";
const NETWORK_MSG = "Couldn't reach Archidekt — check your internet connection.";

/** Accepts a deck URL (with or without scheme) or a bare numeric id. */
export function parseDeckId(urlOrId: string): string | null {
  const s = urlOrId.trim();
  if (/^\d+$/.test(s)) return s;
  const m = /^(?:https?:\/\/)?(?:www\.)?archidekt\.com\/decks\/(\d+)(?:[/?#]|$)/i.exec(s);
  return m ? m[1] : null;
}

interface RawCard {
  quantity?: number;
  categories?: string[];
  card?: { oracleCard?: { name?: string } };
}
interface RawDeck {
  name?: string;
  categories?: { name: string; includedInDeck?: boolean }[];
  cards?: RawCard[];
}

export function parseArchidekt(json: unknown): ArchidektResult {
  const deck = json as RawDeck;
  if (!deck || !Array.isArray(deck.cards)) return { ok: false, error: 'Unexpected response from Archidekt.' };
  const excluded = new Set((deck.categories ?? []).filter((c) => c.includedInDeck === false).map((c) => c.name));
  const commanders: string[] = [];
  const counts = new Map<string, number>();
  for (const c of deck.cards) {
    const name = c.card?.oracleCard?.name;
    const cats = c.categories ?? [];
    if (!name) continue;
    if (cats.length > 0 && cats.every((k) => excluded.has(k))) continue;
    if (cats.includes('Commander')) {
      if (!commanders.includes(name)) commanders.push(name);
      continue;
    }
    counts.set(name, (counts.get(name) ?? 0) + (c.quantity ?? 1));
  }
  const main = [...counts].map(([name, count]) => ({ count, name }));
  return { ok: true, name: deck.name?.trim() || 'Archidekt deck', commanders, main };
}

export async function fetchArchidekt(id: string): Promise<ArchidektResult> {
  let res: Response;
  try {
    res = await fetch(`https://archidekt.com/api/decks/${id}/`, {
      headers: { 'User-Agent': 'CommanderDuel/0.1', Accept: 'application/json' },
    });
  } catch {
    return { ok: false, error: NETWORK_MSG };
  }
  if (res.status === 404 || res.status === 403) return { ok: false, error: PRIVATE_MSG };
  if (!res.ok) return { ok: false, error: `Archidekt returned an error (HTTP ${res.status}).` };
  try {
    return parseArchidekt(await res.json());
  } catch {
    return { ok: false, error: NETWORK_MSG };
  }
}

/** Parses "1 Sol Ring" style lists. A "Commander" header or a "*CMDR*" suffix marks commanders. */
export function parseTextList(text: string): ArchidektResult {
  const commanders: string[] = [];
  const counts = new Map<string, number>();
  let inCommander = false;
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('#')) continue;
    const header = /^(commanders?|deck|main(?:board)?|sideboard|maybeboard|companion)\s*:?$/i.exec(line);
    if (header) {
      inCommander = /^commander/i.test(header[1]);
      continue;
    }
    const m = /^(\d+)\s*x?\s+(.+)$/i.exec(line);
    if (!m) continue;
    line = m[2];
    let isCmdr = inCommander;
    if (/\*cmdr\*/i.test(line)) {
      isCmdr = true;
      line = line.replace(/\*cmdr\*/gi, '');
    }
    // Drop "(SET) 123" printing info and trailing foil markers.
    const name = line.replace(/\s*\([A-Za-z0-9]+\)\s*\S*\s*(\*[A-Za-z]\*)?\s*$/, '').trim();
    if (!name) continue;
    if (isCmdr) {
      if (!commanders.includes(name)) commanders.push(name);
    } else {
      counts.set(name, (counts.get(name) ?? 0) + Number(m[1]));
    }
  }
  if (commanders.length === 0 && counts.size === 0) {
    return { ok: false, error: 'No cards found. Paste an Archidekt link or lines like "1 Sol Ring".' };
  }
  return { ok: true, name: 'Pasted deck', commanders, main: [...counts].map(([name, count]) => ({ count, name })) };
}
