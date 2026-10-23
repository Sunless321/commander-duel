import type { CardDto, GameState } from '../net/protocol';
import { Card } from './Card';

/** How each card is lit and what a click on it does; the board derives these from engine messages only. */
export interface CardFlags {
  glow: (id: string) => boolean;
  selectable: (id: string) => boolean;
  chosen: (id: string) => boolean;
  onCard: (id: string) => void;
  onHover: (id: string | null) => void;
}

const isLand = (c: CardDto | undefined) => !!c?.typeLine && /\bLand\b/.test(c.typeLine);

/** One card on the table, with its tapped slot, combat role, and live P/T, damage and counters. */
export function FieldCard({ id, game, flags }: { id: string; game: GameState; flags: CardFlags }) {
  const card = game.cards[id];
  const attacking = game.combat.some((a) => a.attackerId === id);
  const blocking = game.combat.some((a) => a.blockerIds.includes(id));
  const classes = ['slot', card?.tapped && 'tapped', attacking && 'attacking', blocking && 'blocking'].filter(Boolean).join(' ');
  const counters = card ? Object.entries(card.counters).filter(([, n]) => n > 0) : [];
  return (
    <div className={classes} data-card-id={id} onMouseEnter={() => flags.onHover(id)} onMouseLeave={() => flags.onHover(null)}>
      <Card
        card={card}
        size="field"
        glow={flags.glow(id)}
        selectable={flags.selectable(id)}
        chosen={flags.chosen(id)}
        onClick={() => flags.onCard(id)}
      />
      {card && !card.hidden && (
        <div className="badges">
          {card.power != null && card.toughness != null && <span className="badge pt">{card.power}/{card.toughness}</span>}
          {card.damage > 0 && <span className="badge dmg">−{card.damage}</span>}
          {counters.map(([k, n]) => <span key={k} className="badge ctr" title={k}>{n} {k}</span>)}
          {attacking && <span className="badge atk">Attacking</span>}
          {blocking && <span className="badge blk">Blocking</span>}
        </div>
      )}
    </div>
  );
}

/** A player's permanents: lands in their own row, everything else in front. */
export function Battlefield({ ids, game, flags, label }: { ids: string[]; game: GameState; flags: CardFlags; label: string }) {
  const lands = ids.filter((id) => isLand(game.cards[id]));
  const others = ids.filter((id) => !isLand(game.cards[id]));
  return (
    <section className="battlefield" aria-label={label}>
      <div className="field-row">{others.map((id) => <FieldCard key={id} id={id} game={game} flags={flags} />)}</div>
      <div className="field-row lands">{lands.map((id) => <FieldCard key={id} id={id} game={game} flags={flags} />)}</div>
    </section>
  );
}
