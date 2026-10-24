import { useState } from 'react';
import type { GameState } from '../net/protocol';
import type { CardFlags } from './Battlefield';
import { Card } from './Card';
import { unrenderedOffers } from './ElsewhereStrip';

export interface ChoiceGroup { title: string; ids: string[] }

/**
 * Groups the selectable cards no board zone draws (a searched library, a revealed opponent's hand, ...) by where
 * they are. Only cards present in the state count: the engine lists them while Forge lets you look at them.
 */
export function offBoardChoices(game: GameState, selectable: Iterable<string>): ChoiceGroup[] {
  const ids = unrenderedOffers(game, selectable);
  const groups: ChoiceGroup[] = [];
  const take = (title: string, from: string[]) => {
    const here = ids.filter((id) => from.includes(id));
    if (here.length > 0) groups.push({ title, ids: here });
  };
  for (const p of game.players) {
    const owner = p.you ? 'Your' : `${p.name}'s`;
    take(`${owner} library`, p.visibleLibrary);
    take(`${owner} hand`, p.visibleHand);
  }
  const grouped = new Set(groups.flatMap((g) => g.ids));
  take('Elsewhere', ids.filter((id) => !grouped.has(id)));
  return groups;
}

/**
 * Opens by itself while the engine's selection offers cards the board does not show. It overlays the table only,
 * so the prompt bar's OK/Cancel stay usable: you click cards here and confirm with the engine's OK.
 */
export function ChooseFrom({ groups, game, flags }: { groups: ChoiceGroup[]; game: GameState; flags: CardFlags }) {
  const [hidden, setHidden] = useState(false);
  if (groups.length === 0) return null;
  if (hidden) {
    return (
      <button type="button" className="btn choose-from-show" onClick={() => setHidden(false)}>
        Show choices
      </button>
    );
  }
  return (
    <section className="choose-from" aria-label="Choose from">
      <div className="choose-from-head">
        <h2 className="modal-title">Choose from</h2>
        <button type="button" className="btn small" onClick={() => setHidden(true)}>Hide</button>
      </div>
      {groups.map((g) => (
        <div key={g.title} className="choose-from-group">
          <h3 className="col-title">{g.title}</h3>
          <div className="zone-grid">
            {g.ids.map((id) => (
              <div key={id} className="slot" data-card-id={id} onMouseEnter={() => flags.onHover(id)} onMouseLeave={() => flags.onHover(null)}>
                <Card
                  card={game.cards[id]}
                  size="field"
                  glow={false}
                  selectable={flags.selectable(id)}
                  chosen={flags.chosen(id)}
                  onClick={() => flags.onCard(id)}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
      <p className="modal-hint">Pick here, then confirm with the prompt's button.</p>
    </section>
  );
}
