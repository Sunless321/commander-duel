import { useState } from 'react';
import type { CardDto, GameState } from '../net/protocol';
import { FieldCard, type CardFlags } from './Battlefield';
import { Card } from './Card';

type Group = { title: string; test: (c: CardDto | undefined) => boolean };

const has = (c: CardDto | undefined, type: string) => !!c?.typeLine && new RegExp(`\\b${type}\\b`).test(c.typeLine);

// First match wins, so an artifact creature is listed with the creatures and a land creature too.
const GROUPS: Group[] = [
  { title: 'Creatures', test: (c) => has(c, 'Creature') },
  { title: 'Planeswalkers & battles', test: (c) => has(c, 'Planeswalker') || has(c, 'Battle') },
  { title: 'Lands', test: (c) => has(c, 'Land') },
  { title: 'Artifacts, enchantments & other', test: () => true },
];

/** Splits a battlefield into GROUPS, keeping the engine's order inside each group. */
export function groupPermanents(ids: string[], game: GameState): { title: string; ids: string[] }[] {
  const out = GROUPS.map((g) => ({ title: g.title, ids: [] as string[] }));
  for (const id of ids) {
    const i = GROUPS.findIndex((g) => g.test(game.cards[id]));
    out[i].ids.push(id);
  }
  return out.filter((g) => g.ids.length > 0);
}

/**
 * One opponent's whole board at a readable size, nothing scrolled out of sight: command zone and every
 * permanent, grouped by type, drawn upright with a "Tapped" badge. Clicks behave as on the table.
 */
export function OpponentBoard(props: { game: GameState; playerId: string; flags: CardFlags; onClose: () => void }) {
  const { game, playerId, flags, onClose } = props;
  const [zoom, setZoom] = useState<string | null>(null);
  const player = game.players.find((p) => p.id === playerId);
  if (!player) return null;
  // Hovering here shows the card in this dialog (the side preview sits under the backdrop); the last one stays up.
  const local: CardFlags = { ...flags, onHover: (id) => { if (id) setZoom(id); flags.onHover(id); } };
  const zoomed = zoom ? game.cards[zoom] : undefined;
  const titleId = `board-${playerId}`;
  const groups = groupPermanents(player.battlefield, game);
  const tapped = player.battlefield.filter((id) => game.cards[id]?.tapped).length;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal opp-board" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
        <header className="opp-board-head">
          <h2 id={titleId} className="modal-title">{player.name}&apos;s board</h2>
          <span className="opp-board-stats">
            Life <b>{player.life}</b> · Hand <b>{player.handCount}</b> · Library <b>{player.libraryCount}</b> ·
            Graveyard <b>{player.graveyard.length}</b> · Exile <b>{player.exile.length}</b>
            {player.poison > 0 && <> · Poison <b>{player.poison}</b></>}
          </span>
        </header>
        <div className="opp-board-body">
          <div className="opp-board-groups">
            {player.command.length > 0 && (
              <section className="opp-board-group" aria-label="Command zone">
                <h3 className="opp-board-group-title">Command zone</h3>
                <div className="opp-board-cards">
                  {player.command.map((id) => <FieldCard key={id} id={id} game={game} flags={local} upright />)}
                </div>
              </section>
            )}
            {groups.length === 0 && <p className="modal-hint">No permanents on the battlefield.</p>}
            {groups.map((g) => (
              <section key={g.title} className="opp-board-group" aria-label={g.title}>
                <h3 className="opp-board-group-title">{g.title} ({g.ids.length})</h3>
                <div className="opp-board-cards">
                  {g.ids.map((id) => <FieldCard key={id} id={id} game={game} flags={local} upright />)}
                </div>
              </section>
            ))}
          </div>
          <aside className="opp-board-zoom" aria-hidden="true">
            {zoomed && !zoomed.hidden ? (
              <Card card={zoomed} size="hand" glow={false} selectable={false} chosen={false} upright />
            ) : (
              <p className="modal-hint">Point at a card to read it.</p>
            )}
          </aside>
        </div>
        <div className="modal-actions">
          <span className="modal-hint opp-board-foot">{player.battlefield.length} permanents · {tapped} tapped</span>
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
