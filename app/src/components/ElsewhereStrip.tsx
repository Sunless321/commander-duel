import type { GameState } from '../net/protocol';
import type { CardFlags } from './Battlefield';
import { Card } from './Card';

/** Card ids the engine offers (playable or selectable) that no zone on the board shows. */
export function unrenderedOffers(game: GameState, offered: Iterable<string>): string[] {
  const shown = new Set<string>();
  for (const p of game.players) {
    for (const id of [...p.hand, ...p.battlefield, ...p.command, ...p.graveyard, ...p.exile]) shown.add(id);
  }
  const out: string[] = [];
  for (const id of offered) {
    if (!shown.has(id) && game.cards[id] && !out.includes(id)) out.push(id);
  }
  return out;
}

/** Safety net: whatever the engine offers stays reachable even when it sits in a zone the board doesn't draw. */
export function ElsewhereStrip({ ids, game, flags }: { ids: string[]; game: GameState; flags: CardFlags }) {
  if (ids.length === 0) return null;
  return (
    <section className="elsewhere" aria-label="Playable elsewhere">
      <h3 className="col-title">Playable elsewhere</h3>
      <div className="field-row">
        {ids.map((id) => (
          <div key={id} className="slot" data-card-id={id} onMouseEnter={() => flags.onHover(id)} onMouseLeave={() => flags.onHover(null)}>
            <Card card={game.cards[id]} size="field" glow={flags.glow(id)} selectable={flags.selectable(id)} chosen={flags.chosen(id)} onClick={() => flags.onCard(id)} />
          </div>
        ))}
      </div>
    </section>
  );
}
