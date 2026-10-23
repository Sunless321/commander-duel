import type { GameState } from '../net/protocol';
import type { CardFlags } from './Battlefield';
import { Card } from './Card';

export function Hand({ ids, game, flags }: { ids: string[]; game: GameState; flags: CardFlags }) {
  return (
    <section className="hand-row" aria-label="Your hand">
      {ids.map((id) => (
        <div key={id} className="slot" data-card-id={id} onMouseEnter={() => flags.onHover(id)} onMouseLeave={() => flags.onHover(null)}>
          <Card
            card={game.cards[id]}
            size="hand"
            glow={flags.glow(id)}
            selectable={flags.selectable(id)}
            chosen={flags.chosen(id)}
            onClick={() => flags.onCard(id)}
          />
        </div>
      ))}
    </section>
  );
}
