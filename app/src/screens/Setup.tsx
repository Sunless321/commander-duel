import { useEffect, useMemo, useState } from 'react';
import { buildStartGame, defaultBot, type BotChoice } from '../logic/setupPayload';
import { client } from '../net/engineClient';
import type { BotDeck, Difficulty, PreconSummary } from '../net/protocol';
import { useStore } from '../state/store';

const panel = { background: '#121c31', border: '1px solid #24324f', borderRadius: 8, padding: 16, display: 'grid', gap: 12 } as const;
const field = {
  minHeight: 44, boxSizing: 'border-box', background: '#0b1322', color: '#e8ecf4',
  border: '1px solid #24324f', borderRadius: 6, padding: '0 10px', font: 'inherit',
} as const;
const primary = {
  minHeight: 44, background: '#d4a64a', color: '#0b1322', border: 'none', borderRadius: 6,
  padding: '0 18px', cursor: 'pointer', fontWeight: 600, font: 'inherit',
} as const;
const secondary = { ...primary, background: 'transparent', color: '#e8ecf4', border: '1px solid #24324f' } as const;

const DIFFICULTIES: { value: Difficulty; label: string }[] = [
  { value: 'EASY', label: 'Easy' },
  { value: 'NORMAL', label: 'Normal' },
  { value: 'HARD', label: 'Hard' },
];

function encode(d: BotDeck): string {
  return d.kind === 'randomPrecon' ? 'random' : `${d.kind}:${d.id}`;
}
function decode(v: string): BotDeck {
  if (v === 'random') return { kind: 'randomPrecon' };
  const i = v.indexOf(':');
  const kind = v.slice(0, i);
  const id = v.slice(i + 1);
  return kind === 'precon' ? { kind: 'precon', id } : { kind: 'imported', id };
}

/** Case-insensitive match on precon name or commander name. */
export function filterPrecons(precons: PreconSummary[], query: string): PreconSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return precons;
  return precons.filter((p) => p.name.toLowerCase().includes(q) || p.commander.toLowerCase().includes(q));
}

function BotRow(props: {
  index: number;
  bot: BotChoice;
  precons: PreconSummary[];
  decks: { id: string; name: string }[];
  onChange: (b: BotChoice) => void;
}) {
  const { index, bot, precons, decks, onChange } = props;
  const n = index + 1;
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const list = filterPrecons(precons, query);
    // Keep the current pick listed even when the filter hides it.
    if (bot.deck.kind === 'precon') {
      const id = bot.deck.id;
      if (!list.some((p) => p.id === id)) {
        const cur = precons.find((p) => p.id === id);
        if (cur) return [cur, ...list];
      }
    }
    return list;
  }, [precons, query, bot.deck]);

  return (
    <fieldset style={{ ...panel, margin: 0 }}>
      <legend style={{ color: '#d4a64a', padding: '0 6px' }}>Bot {n}</legend>
      <label style={{ display: 'grid', gap: 4 }}>
        Search precons for bot {n}
        <input
          type="search"
          style={field}
          placeholder="Name or commander"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <label style={{ display: 'grid', gap: 4 }}>
        Bot {n} deck
        <select
          style={field}
          value={encode(bot.deck)}
          onChange={(e) => onChange({ ...bot, deck: decode(e.target.value) })}
        >
          <option value="random">Random precon</option>
          <optgroup label="Precons">
            {shown.map((p) => <option key={p.id} value={`precon:${p.id}`}>{p.name} ({p.commander})</option>)}
          </optgroup>
          {decks.length > 0 && (
            <optgroup label="My decks">
              {decks.map((d) => <option key={d.id} value={`imported:${d.id}`}>{d.name}</option>)}
            </optgroup>
          )}
        </select>
      </label>
      <div role="group" aria-label={`Bot ${n} difficulty`} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {DIFFICULTIES.map((d) => (
          <button
            key={d.value}
            type="button"
            aria-pressed={bot.difficulty === d.value}
            onClick={() => onChange({ ...bot, difficulty: d.value })}
            style={{ ...(bot.difficulty === d.value ? primary : secondary), minWidth: 88 }}
          >
            {d.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function Setup() {
  const precons = useStore((s) => s.lobby?.precons ?? []);
  const decks = useStore((s) => s.lobby?.decks ?? []);
  const selected = useStore((s) => s.selectedDeck);
  const lastError = useStore((s) => s.lastError);
  const requestCount = useStore((s) => s.requests.length);
  const prompt = useStore((s) => s.prompt);

  const [deckId, setDeckId] = useState(selected?.id ?? decks[0]?.id ?? '');
  const [bots, setBots] = useState<BotChoice[]>([defaultBot()]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Forge asks a few questions before the first state; the first request/prompt means the game began.
  useEffect(() => {
    if (starting && (requestCount > 0 || prompt)) useStore.getState().setScreen('board');
  }, [starting, requestCount, prompt]);

  // An engine error while starting keeps us here.
  useEffect(() => {
    if (starting && lastError) {
      setError(lastError);
      setStarting(false);
    }
  }, [starting, lastError]);

  const setPod = (size: number) =>
    setBots((cur) => Array.from({ length: size }, (_, i) => cur[i] ?? defaultBot()));

  const start = () => {
    if (starting) return;
    let msg;
    try {
      msg = buildStartGame(deckId, bots);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    setError(null);
    useStore.getState().resetGame();
    useStore.setState({ lastError: null });
    setStarting(true);
    client.send(msg);
  };

  return (
    <div style={{ padding: 32, maxWidth: 820, margin: '0 auto', display: 'grid', gap: 16 }}>
      <h1 style={{ color: '#d4a64a', margin: 0 }}>Game setup</h1>
      <div style={panel}>
        <label style={{ display: 'grid', gap: 4 }}>
          Your deck
          <select style={field} value={deckId} onChange={(e) => setDeckId(e.target.value)}>
            {decks.length > 0 && (
              <optgroup label="My decks">
                {decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </optgroup>
            )}
            <optgroup label="Precons">
              {precons.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.commander})</option>)}
            </optgroup>
          </select>
        </label>
        <div role="group" aria-label="Pod size" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>Pod size</span>
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={bots.length === n}
              onClick={() => setPod(n)}
              style={{ ...(bots.length === n ? primary : secondary), minWidth: 88 }}
            >
              {n} {n === 1 ? 'bot' : 'bots'}
            </button>
          ))}
        </div>
      </div>
      {bots.map((b, i) => (
        <BotRow
          key={i}
          index={i}
          bot={b}
          precons={precons}
          decks={decks}
          onChange={(nb) => setBots((cur) => cur.map((x, j) => (j === i ? nb : x)))}
        />
      ))}
      {error && <p role="alert" style={{ color: '#e5736a', margin: 0 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" style={secondary} disabled={starting} onClick={() => useStore.getState().setScreen('decks')}>Back</button>
        <button type="button" style={primary} disabled={starting || !deckId} onClick={start}>
          {starting ? 'Starting game…' : 'Start game'}
        </button>
      </div>
    </div>
  );
}
