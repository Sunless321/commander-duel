import type { GameState, PlayerDto } from '../net/protocol';
import { Card } from './Card';

export interface PlayerPanelProps {
  player: PlayerDto;
  game: GameState;
  selectable: boolean;
  chosen: boolean;
  onClick: () => void;
}

/** Commander damage `to` has taken from `from`'s commanders. */
function commanderDamageFrom(game: GameState, to: PlayerDto, from: PlayerDto): number {
  let sum = 0;
  for (const [cid, dmg] of Object.entries(to.commanderDamage)) {
    if (game.cards[cid]?.ownerId === from.id) sum += dmg;
  }
  return sum;
}

export function PlayerPanel({ player, game, selectable, chosen, onClick }: PlayerPanelProps) {
  const you = game.players.find((p) => p.you);
  const active = game.activePlayerId === player.id;
  const classes = ['player-panel', active && 'active', selectable && 'selectable', chosen && 'chosen'].filter(Boolean).join(' ');
  const cmdr = !player.you && you ? commanderDamageFrom(game, you, player) : 0;
  return (
    <div
      className={classes}
      role="button"
      tabIndex={0}
      aria-label={`${player.name}, life ${player.life}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="panel-head">
        <div className={`avatar${player.you ? ' you' : ''}`}>{player.you ? 'YOU' : 'BOT'}</div>
        <div className="panel-name">
          <span className="name">{player.name}</span>
          <span className="sub">{player.you ? 'You' : 'Opponent'}{game.priorityPlayerId === player.id ? ' · has priority' : ''}</span>
        </div>
      </div>
      <div className="life">{player.life}</div>
      <div className="sub">
        Hand {player.handCount} · Library {player.libraryCount}
        {player.graveyard.length > 0 && ` · Graveyard ${player.graveyard.length}`}
        {player.exile.length > 0 && ` · Exile ${player.exile.length}`}
      </div>
      {player.poison > 0 && <div className="sub poison">Poison {player.poison}</div>}
      {!player.you && <div className="sub">Commander dmg to you {cmdr}</div>}
      {!player.you && player.handCount > 0 && (
        <div className="opp-hand" aria-label={`${player.handCount} cards in hand`}>
          {Array.from({ length: player.handCount }, (_, i) => (
            <Card key={i} card={undefined} size="field" glow={false} selectable={false} chosen={false} />
          ))}
        </div>
      )}
    </div>
  );
}
