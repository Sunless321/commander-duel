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
    return { ok: false, error: 'Unexpected response from Archidekt.' };
  }
}

type Section = 'main' | 'commander' | 'skip';
const HEADER = /^(?:\/\/\s*)?(commanders?|deck|main(?:board)?|sideboard|maybeboard|considering|companion)\s*:?$/i;
const TAGS = [/\s*\[([^\]]*)\]\s*$/, /\s*\^[^^]*\^\s*$/, /\s*\*[A-Za-z]+\*\s*$/];

/** Strips Archidekt/Moxfield export suffixes. Returns the bare name and whether a commander tag was present. */
function cleanName(raw: string): { name: string; cmdr: boolean } {
  let line = raw.trim();
  let cmdr = false;
  const stripTags = () => {
    for (let changed = true; changed; ) {
      changed = false;
      for (const re of TAGS) {
        const m = re.exec(line);
        if (!m) continue;
        if (/^commander/i.test(m[1] ?? '') || /^\s*\*cmdr\*\s*$/i.test(m[0])) cmdr = true;
        line = line.slice(0, m.index);
        changed = true;
      }
    }
  };
  stripTags();
  line = line.replace(/\s*\([A-Za-z0-9]+\)\s*\S*$/, '');
  stripTags();
  return { name: line.trim(), cmdr };
}

/**
 * Parses "1 Sol Ring" style lists. A "Commander" header (ended by a blank line) or a
 * "*CMDR*" / "[Commander{...}]" tag marks commanders. Sideboard/Maybeboard/Considering/Companion
 * sections and "SB:" lines are skipped. Lines without a count count as 1; unusable lines are
 * reported in skippedLines.
 */
export function parseTextList(text: string): ArchidektResult {
  const commanders: string[] = [];
  const counts = new Map<string, number>();
  const skippedLines: string[] = [];
  let section: Section = 'main';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      if (section === 'commander') section = 'main';
      continue;
    }
    const header = HEADER.exec(line);
    if (header) {
      const h = header[1].toLowerCase();
      section = h.startsWith('commander') ? 'commander' : h === 'deck' || h.startsWith('main') ? 'main' : 'skip';
      continue;
    }
    if (line.startsWith('//') || line.startsWith('#')) continue;
    if (section === 'skip' || /^sb:/i.test(line)) continue;
    const m = /^(\d+)\s*x?\s+(.+)$/i.exec(line);
    const count = m ? Number(m[1]) : 1;
    const { name, cmdr } = cleanName(m ? m[2] : line);
    if (!name || /^\d+$/.test(name)) {
      skippedLines.push(line);
      continue;
    }
    if (cmdr || section === 'commander') {
      if (!commanders.includes(name)) commanders.push(name);
    } else {
      counts.set(name, (counts.get(name) ?? 0) + count);
    }
  }
  if (commanders.length === 0 && counts.size === 0) {
    return { ok: false, error: 'No cards found. Paste an Archidekt link or lines like "1 Sol Ring".' };
  }
  return { ok: true, name: 'Pasted deck', commanders, main: [...counts].map(([name, count]) => ({ count, name })), skippedLines };
}
