import { useEffect, useState } from 'react';
import type { RecordingSummary } from '../logic/recording';
import { useStore } from '../state/store';
import '../styles/board.css';

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

/** Saved match recordings: watch one turn by turn, or delete it (after a confirmation). */
export function Matches() {
  const [list, setList] = useState<RecordingSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  const refresh = () =>
    window.duel.listRecordings().then(setList, () => {
      setList([]);
      setError("Couldn't read the saved matches.");
    });
  useEffect(() => {
    void refresh();
  }, []);

  const watch = async (id: string) => {
    setOpening(id);
    setError(null);
    try {
      useStore.getState().openReplay(await window.duel.loadRecording(id));
    } catch {
      setError("Couldn't open that recording. The file may be damaged.");
      setOpening(null);
    }
  };

  const remove = async (id: string) => {
    setConfirm(null);
    try {
      await window.duel.deleteRecording(id);
    } catch {
      setError("Couldn't delete that recording.");
    }
    void refresh();
  };

  return (
    <div className="matches">
      <header className="matches-head">
        <h1 className="modal-title">Saved matches</h1>
        <button type="button" className="btn" onClick={() => useStore.getState().setScreen('decks')}>Back to decks</button>
      </header>
      {error && <p role="alert" className="modal-error">{error}</p>}
      {list === null && <p className="modal-hint">Loading…</p>}
      {list?.length === 0 && (
        <p className="modal-hint">No saved matches yet. Press “Save recording” when a game ends to keep it here.</p>
      )}
      <ul className="matches-list">
        {list?.map((m) => (
          <li key={m.id} className="matches-row">
            <div className="matches-info">
              <span className="matches-title">{m.title}</span>
              <span className="modal-hint">
                {when(m.savedAt)} · {m.youWon ? 'You won' : 'You lost'} · {m.turns} turns
              </span>
            </div>
            {confirm === m.id ? (
              <span className="matches-actions">
                <span className="modal-hint">Delete this recording?</span>
                <button type="button" className="btn danger" onClick={() => void remove(m.id)}>Delete</button>
                <button type="button" className="btn" onClick={() => setConfirm(null)}>Keep</button>
              </span>
            ) : (
              <span className="matches-actions">
                <button type="button" className="btn" aria-label={`Delete ${m.title}`} onClick={() => setConfirm(m.id)}>Delete</button>
                <button type="button" className="btn primary" disabled={opening !== null} onClick={() => void watch(m.id)}>
                  {opening === m.id ? 'Opening…' : 'Watch'}
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
