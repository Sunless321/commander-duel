import { client } from '../net/engineClient';
import { useStore } from '../state/store';
import '../styles/board.css';

export function GameOver() {
  const over = useStore((s) => s.gameOver);
  const lastStart = useStore((s) => s.lastStart);
  const names = over?.winnerNames ?? [];
  const headline = over?.youWon ? 'You won' : names.length > 0 ? `${names.join(', ')} won` : 'Game over';

  const playAgain = () => {
    if (!lastStart) return;
    const store = useStore.getState();
    store.resetGame();
    store.setScreen('board');
    client.send(lastStart);
  };
  const backToDecks = () => {
    const store = useStore.getState();
    store.resetGame();
    store.setScreen('decks');
  };

  return (
    <div className="game-over">
      <h1 className={over?.youWon ? 'won' : 'lost'}>{headline}</h1>
      <div className="game-over-actions">
        <button type="button" className="btn primary" disabled={!lastStart} onClick={playAgain}>Play again</button>
        <button type="button" className="btn" onClick={backToDecks}>Back to decks</button>
      </div>
    </div>
  );
}
