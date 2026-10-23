import type { GameState, PlayerDto } from '../net/protocol';
import type { CardFlags } from './Battlefield';
import { Card } from './Card';

export type ViewZone = 'graveyard' | 'exile';

export interface PlayerPanelProps {
  player: PlayerDto;
  game: GameState;
  flags: CardFlags;
  onClick: () => void;
  onZone: (zone: ViewZone) => void;
}

/** Commander damage `to` has taken from `from`'s commanders. */
function commanderDamageFrom(game: GameState, to: PlayerDto, from: PlayerDto): number {
  let sum = 0;
  for (const [cid, dmg] of Object.entries(to.commanderDamage)) {
    if (game.cards[cid]?.ownerId === from.id) sum += dmg;
  }
  return sum;
}

const ZONE_LABEL: Record<ViewZone, string> = { graveyard: 'Graveyard', exile: 'Exile' };

export function PlayerPanel({ player, game, flags, onClick, onZone }: PlayerPanelProps) {
  const you = game.players.find((p) => p.you);
  const active = game.activePlayerId === player.id;
  const classes = [
    'player-panel',
    active && 'active',
    flags.selectable(player.id) && 'selectable',
    flags.chosen(player.id) && 'chosen',
  ].filter(Boolean).join(' ');
  const cmdr = !player.you && you ? commanderDamageFrom(game, you, player) : 0;

  const zoneButton = (zone: ViewZone) => {
    const ids = player[zone];
    // Lit when the engine offers something in there, so the player knows to look.
    const lit = ids.some((id) => flags.glow(id) || flags.selectable(id));
    return (
      <button
        type="button"
        className={`zone-btn${lit ? ' lit' : ''}`}
        disabled={ids.length === 0}
        aria-label={`${ZONE_LABEL[zone]} (${ids.length})${lit ? ', has playable or selectable cards' : ''}`}
        onClick={() => onZone(zone)}
      >
        {ZONE_LABEL[zone]} {ids.length}
        {lit && <span className="zone-dot" aria-hidden="true" />}
      </button>
    );
  };

  return (
    <div className={classes} data-panel-for={player.id}>
      <button type="button" className="panel-hit" aria-label={`${player.name}, life ${player.life}`} onClick={onClick}>
        <span className="panel-head">
          <span className={`avatar${player.you ? ' you' : ''}`}>{player.you ? 'YOU' : 'BOT'}</span>
          <span className="panel-name">
            <span className="name">{player.name}</span>
            <span className="sub">{player.you ? 'You' : 'Opponent'}{game.priorityPlayerId === player.id ? ' · has priority' : ''}</span>
          </span>
        </span>
        <span className="life">{player.life}</span>
        <span className="sub">Hand {player.handCount} · Library {player.libraryCount}</span>
        {player.poison > 0 && <span className="sub poison">Poison {player.poison}</span>}
        {!player.you && <span className="sub">Commander dmg to you {cmdr}</span>}
        {!player.you && player.handCount > 0 && (
          <span className="opp-hand" aria-label={`${player.handCount} cards in hand`}>
            {Array.from({ length: player.handCount }, (_, i) => (
              <Card key={i} card={undefined} size="field" glow={false} selectable={false} chosen={false} />
            ))}
          </span>
        )}
      </button>
      <div className="zone-row">
        {zoneButton('graveyard')}
        {zoneButton('exile')}
      </div>
    </div>
  );
}
