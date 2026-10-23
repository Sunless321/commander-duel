import type { GameState } from '../net/protocol';

export const PHASES = ['Untap', 'Upkeep', 'Draw', 'Main 1', 'Combat', 'Main 2', 'End'] as const;

/** Maps a Forge PhaseType name to its pill: combat steps light "Combat", END_OF_TURN/CLEANUP light "End". */
export function phaseLabel(phase: string | null): (typeof PHASES)[number] | null {
  if (!phase) return null;
  if (phase.startsWith('COMBAT_')) return 'Combat';
  switch (phase) {
    case 'UNTAP': return 'Untap';
    case 'UPKEEP': return 'Upkeep';
    case 'DRAW': return 'Draw';
    case 'MAIN1': return 'Main 1';
    case 'MAIN2': return 'Main 2';
    case 'END_OF_TURN':
    case 'CLEANUP': return 'End';
    default: return null;
  }
}

export function PhaseBar({ game }: { game: GameState }) {
  const current = phaseLabel(game.phase);
  const active = game.players.find((p) => p.id === game.activePlayerId);
  const turn = active?.you ? `Your turn · Turn ${game.turn}` : active ? `${active.name}'s turn` : `Turn ${game.turn}`;
  return (
    <div className="phase-bar">
      {PHASES.map((p) => (
        <div key={p} className={`phase${p === current ? ' current' : ''}`} aria-current={p === current ? 'step' : undefined}>{p}</div>
      ))}
      <div className="grow" />
      <span className="turn-label">{turn}</span>
    </div>
  );
}
