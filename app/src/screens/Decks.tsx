import { useEffect, useRef, useState } from 'react';
import { client } from '../net/engineClient';
import { useStore } from '../state/store';

const panel = { background: '#121c31', border: '1px solid #24324f', borderRadius: 8, padding: 16 } as const;
const button = {
  background: '#d4a64a', color: '#0b1322', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontWeight: 600,
} as const;

export function Decks() {
  const decks = useStore((s) => s.lobby?.decks ?? []);
  const lastImport = useStore((s) => s.lastImport);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  // The engine's reply ends the "Importing…" state.
  useEffect(() => {
    if (lastImport) {
      clearTimer();
      setBusy(false);
    }
  }, [lastImport]);

  // Leaving the Decks screen clears stale import feedback.
  useEffect(
    () => () => {
      clearTimer();
      useStore.setState({ lastImport: null });
    },
    [],
  );

  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    setSkipped([]);
    useStore.setState({ lastImport: null });
    try {
      const r = await window.duel.importArchidekt(text);
      if (!r.ok) {
        setError(r.error);
        setBusy(false);
        return;
      }
      setSkipped(r.skippedLines ?? []);
      client.send({ type: 'importDeck', name: r.name, commanders: r.commanders, main: r.main });
      timer.current = setTimeout(() => {
        setBusy(false);
        setError("The engine didn't respond — try again");
      }, 30_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const play = (id: string) => {
    const deck = decks.find((d) => d.id === id);
    if (!deck) return;
    useStore.getState().selectDeck(deck);
    useStore.getState().setScreen('setup');
  };

  return (
    <div style={{ padding: 32, maxWidth: 820, margin: '0 auto', display: 'grid', gap: 16 }}>
      <h1 style={{ color: '#d4a64a', margin: 0 }}>Your decks</h1>
      <div style={panel}>
        <textarea
          aria-label="Deck import"
          placeholder="Paste an Archidekt link or a decklist"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          style={{ width: '100%', boxSizing: 'border-box', background: '#0b1322', color: '#e8ecf4', border: '1px solid #24324f', borderRadius: 6, padding: 8 }}
        />
        <div style={{ marginTop: 8 }}>
          <button style={button} disabled={busy || !text.trim()} onClick={() => void submit()}>
            {busy ? 'Importing…' : 'Import'}
          </button>
        </div>
        {error && <p role="alert" style={{ color: '#e5736a' }}>{error}</p>}
        {lastImport && lastImport.ok && lastImport.deck && (
          <p style={{ color: '#6fcf97' }}>Imported {lastImport.deck.name}</p>
        )}
        {lastImport && !lastImport.ok && <p role="alert" style={{ color: '#e5736a' }}>Import failed.</p>}
        {lastImport && lastImport.unknownCards.length > 0 && (
          <div>
            <p style={{ color: '#e5736a', marginBottom: 4 }}>Unknown cards:</p>
            <ul style={{ marginTop: 0 }}>
              {lastImport.unknownCards.map((n) => <li key={n}>{n}</li>)}
            </ul>
          </div>
        )}
        {skipped.length > 0 && (
          <div style={{ color: '#d4a64a' }}>
            <p style={{ marginBottom: 4 }}>Warning: these lines were skipped:</p>
            <ul style={{ marginTop: 0 }}>{skipped.map((l, i) => <li key={i}>{l}</li>)}</ul>
          </div>
        )}
        {lastImport && lastImport.problems.length > 0 && (
          <ul style={{ color: '#d4a64a' }}>
            {lastImport.problems.map((p) => <li key={p}>Warning: {p}</li>)}
          </ul>
        )}
      </div>
      <div style={panel}>
        {decks.length === 0 && <p style={{ margin: 0, opacity: 0.7 }}>No decks yet. Import one above.</p>}
        {decks.map((d) => (
          <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #24324f' }}>
            <div>
              <div style={{ fontWeight: 600 }}>{d.name}</div>
              <div style={{ opacity: 0.7, fontSize: 13 }}>{d.commanders.join(' / ')}</div>
            </div>
            <button style={button} onClick={() => play(d.id)}>Play</button>
          </div>
        ))}
      </div>
    </div>
  );
}
