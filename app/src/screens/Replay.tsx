import { useEffect, useMemo, useState } from 'react';
import type { CardFlags } from '../components/Battlefield';
import { Card } from '../components/Card';
import { OpponentBoard } from '../components/OpponentBoard';
import type { ViewZone } from '../components/PlayerPanel';
import { ZoneViewer } from '../components/ZoneViewer';
import { logLineClass } from '../components/PlayLog';
import { cleanText } from '../logic/cleanText';
import { logByTurn } from '../logic/recording';
import type { GameState } from '../net/protocol';
import { useStore } from '../state/store';
import { Table } from './Board';
import '../styles/board.css';

interface Step { label: string; turn: number; state: GameState }

/** A saved match, turn by turn: the board as each turn began (then the final board) beside that turn's moves. */
export function Replay() {
  const replay = useStore((s) => s.replay);
  const steps = useMemo<Step[]>(() => {
    if (!replay) return [];
    const out: Step[] = replay.turns.map((t) => ({ label: `Turn ${t.turn}`, turn: t.turn, state: t.state }));
    if (replay.final) out.push({ label: 'End of game', turn: replay.final.turn, state: replay.final });
    return out;
  }, [replay]);
  const byTurn = useMemo(() => logByTurn(replay?.log ?? []), [replay]);
  const [i, setI] = useState(0);
  const [hovered, setHovered] = useState<string | null>(null);
  const [zone, setZone] = useState<{ playerId: string; zone: ViewZone } | null>(null);
  const [board, setBoard] = useState<string | null>(null);

  const go = (n: number) => setI(Math.max(0, Math.min(steps.length - 1, n)));
  const step1 = (d: number) => setI((cur) => Math.max(0, Math.min(steps.length - 1, cur + d)));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') step1(1);
      if (e.key === 'ArrowLeft') step1(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [steps.length]);

  const back = () => {
    useStore.setState({ replay: null });
    useStore.getState().setScreen('matches');
  };

  if (!replay || steps.length === 0) {
    return (
      <div className="matches">
        <p className="modal-hint">This recording has no turns to show.</p>
        <button type="button" className="btn" onClick={back}>Back to saved matches</button>
      </div>
    );
  }

  const step = steps[i];
  const game = step.state;
  // A replay is look-only: cards light up for nothing and clicks only show things.
  const flags: CardFlags = {
    glow: () => false,
    selectable: () => false,
    chosen: () => false,
    onCard: () => {},
    onHover: setHovered,
  };
  const isEnd = replay.final != null && i === steps.length - 1;
  const lines = isEnd ? [] : byTurn.get(step.turn) ?? [];

  return (
    <div className="board replay">
      <div className="board-main">
        <Table game={game} flags={flags} onZone={(playerId, z) => setZone({ playerId, zone: z })} onBoard={setBoard} readOnly />
      </div>
      <aside className="board-side">
        <section className="replay-head">
          <span className="popup-kicker">Replay</span>
          <span className="replay-title">{replay.title}</span>
          <span className="modal-hint">{replay.youWon ? 'You won' : `${replay.winners.join(', ') || 'Nobody'} won`}</span>
        </section>
        {hovered && game.cards[hovered] && !game.cards[hovered].hidden && (
          <div className="preview"><Card card={game.cards[hovered]} size="hand" glow={false} selectable={false} chosen={false} upright /></div>
        )}
        <section className="replay-controls" aria-label="Replay controls">
          <div className="replay-step">
            <button type="button" className="btn" aria-label="Previous turn" disabled={i === 0} onClick={() => step1(-1)}>◀</button>
            <span className="replay-label">{step.label}</span>
            <button type="button" className="btn" aria-label="Next turn" disabled={i === steps.length - 1} onClick={() => step1(1)}>▶</button>
          </div>
          <input
            type="range"
            aria-label="Turn"
            min={0}
            max={steps.length - 1}
            value={i}
            onChange={(e) => go(Number(e.target.value))}
          />
        </section>
        <section className="play-log open" aria-label="This turn's moves">
          <span className="col-title">{isEnd ? 'Final board' : `Moves in ${step.label.toLowerCase()}`}</span>
          <ol className="play-log-list">
            {isEnd && <li className="log-line log-empty">How the table looked when the game ended.</li>}
            {!isEnd && lines.length === 0 && <li className="log-line log-empty">No moves logged this turn.</li>}
            {lines.map((e, n) => <li key={n} className={logLineClass(e)}>{cleanText(e.text)}</li>)}
          </ol>
        </section>
        <button type="button" className="btn" onClick={back}>Back to saved matches</button>
      </aside>
      {zone && <ZoneViewer game={game} playerId={zone.playerId} zone={zone.zone} flags={flags} onClose={() => setZone(null)} />}
      {board && <OpponentBoard game={game} playerId={board} flags={flags} onClose={() => setBoard(null)} />}
    </div>
  );
}
