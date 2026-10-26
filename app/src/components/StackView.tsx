import { cleanText, HIDDEN_STACK_TEXT } from '../logic/cleanText';
import type { GameState } from '../net/protocol';
import { Card } from './Card';

export interface StackViewProps {
  game: GameState;
  selectable: (id: string) => boolean;
  chosen: (id: string) => boolean;
  onClick: (id: string) => void;
}

/** The stack, top first (as the engine lists it). */
export function StackView({ game, selectable, chosen, onClick }: StackViewProps) {
  if (game.stack.length === 0) return null;
  return (
    <section className="stack-view" aria-label="Stack">
      <h3 className="col-title">Stack</h3>
      <ol className="stack-list">
        {game.stack.map((item, i) => {
          const source = item.sourceCardId ? game.cards[item.sourceCardId] : undefined;
          const activator = game.players.find((p) => p.id === item.activatorId);
          const classes = ['stack-item', selectable(item.id) && 'selectable', chosen(item.id) && 'chosen'].filter(Boolean).join(' ');
          return (
            <li key={item.id}>
              <button type="button" className={classes} data-stack-id={item.id} onClick={() => onClick(item.id)}>
                {source && <Card card={source} size="field" glow={false} selectable={false} chosen={false} />}
                <span className="stack-text">
                  {i === 0 && <span className="stack-top">Top · </span>}
                  {activator && <span className="stack-who">{activator.name}: </span>}
                  {item.text ? cleanText(item.text) : HIDDEN_STACK_TEXT}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
