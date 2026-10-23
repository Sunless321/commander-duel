import { useEffect, useState } from 'react';
import { client } from '../net/engineClient';
import { useStore } from '../state/store';
import '../styles/board.css';

export const START_TIMEOUT_MS = 60_000;

export function GameOver() {
  const current = useStore((s) => s.gameOver);
  // Kept locally: starting a new game clears the store's result while this screen still shows it.
  const [over] = useState(current);
  const lastStart = useStore((s) => s.lastStart);
  const requestCount = useStore((s) => s.requests.length);
  const prompt = useStore((s) => s.prompt);
  const game = useStore((s) => s.game);
  const lastError = useStore((s) => s.lastError);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const result = over ?? current;
  const names = result?.winnerNames ?? [];
  const headline = result?.youWon ? 'You won' : names.length > 0 ? `${names.join(', ')} won` : 'Game over';

  // As in Setup: the first request, prompt or state means the new game began.
  useEffect(() => {
    if (starting && (requestCount > 0 || prompt || game)) useStore.getState().setScreen('board');
  }, [starting, requestCount, prompt, game]);

  useEffect(() => {
    if (!starting) return;
    const t = setTimeout(() => {
      setError("The engine didn't start the game — try again");
      setStarting(false);
    }, START_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [starting]);

  useEffect(() => {
    if (starting && lastError) {
      setError(lastError);
      setStarting(false);
    }
  }, [starting, lastError]);

  const playAgain = () => {
    if (!lastStart || starting) return;
    useStore.getState().resetGame();
    useStore.setState({ lastError: null });
    setError(null);
    setStarting(true);
    client.send(lastStart);
  };
  const backToDecks = () => {
    const store = useStore.getState();
    store.resetGame();
    store.setScreen('decks');
  };

  return (
    <div className="game-over">
      <h1 className={result?.youWon ? 'won' : 'lost'}>{headline}</h1>
      {error && <p role="alert" className="game-over-error">{error}</p>}
      <div className="game-over-actions">
        <button type="button" className="btn primary" disabled={!lastStart || starting} onClick={playAgain}>
          {starting ? 'Starting game…' : 'Play again'}
        </button>
        <button type="button" className="btn" disabled={starting} onClick={backToDecks}>Back to decks</button>
      </div>
    </div>
  );
}
