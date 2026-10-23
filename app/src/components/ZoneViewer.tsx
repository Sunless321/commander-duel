import type { GameState } from '../net/protocol';
import type { CardFlags } from './Battlefield';
import { Card } from './Card';
import type { ViewZone } from './PlayerPanel';

const TITLE: Record<ViewZone, string> = { graveyard: 'graveyard', exile: 'exile' };

/** A player's graveyard or exile, with the same highlights and clicks as the table. */
export function ZoneViewer(props: { game: GameState; playerId: string; zone: ViewZone; flags: CardFlags; onClose: () => void }) {
  const { game, playerId, zone, flags, onClose } = props;
  const player = game.players.find((p) => p.id === playerId);
  if (!player) return null;
  const ids = player[zone];
  const owner = player.you ? 'Your' : `${player.name}'s`;
  const titleId = `zone-${playerId}-${zone}`;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal zone-viewer" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
        <h2 id={titleId} className="modal-title">{owner} {TITLE[zone]} ({ids.length})</h2>
        <div className="zone-grid">
          {ids.length === 0 && <p className="modal-hint">Empty</p>}
          {ids.map((id) => (
            <div key={id} className="slot" data-card-id={id} onMouseEnter={() => flags.onHover(id)} onMouseLeave={() => flags.onHover(null)}>
              <Card
                card={game.cards[id]}
                size="field"
                glow={flags.glow(id)}
                selectable={flags.selectable(id)}
                chosen={flags.chosen(id)}
                onClick={() => flags.onCard(id)}
              />
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
