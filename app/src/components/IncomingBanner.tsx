import { cleanText } from '../logic/cleanText';
import { incoming } from '../logic/incoming';
import type { GameState } from '../net/protocol';

/**
 * A red heads-up over your side of the table while something is about to hit you: creatures attacking you
 * (with the damage the unblocked ones would deal) and opponents' spells or abilities targeting you or your
 * permanents. Pointing at a name shows that card in the side preview.
 */
export function IncomingBanner({ game, onHover }: { game: GameState; onHover: (id: string | null) => void }) {
  const { attackers, unblockedDamage, threats } = incoming(game);
  if (attackers.length === 0 && threats.length === 0) return null;
  const me = game.players.find((p) => p.id === game.youId);
  const hover = (id: string | null) => ({ onMouseEnter: () => onHover(id), onMouseLeave: () => onHover(null) });
  const atYou = attackers.filter((a) => a.atPermanentId == null);
  const lethal = me != null && unblockedDamage >= me.life;

  return (
    <section className={`incoming${lethal ? ' lethal' : ''}`} role="alert" aria-label="Incoming damage">
      {attackers.length > 0 && (
        <div className="incoming-line">
          <span className="incoming-head">
            {atYou.length > 0 ? `Incoming attack: ${unblockedDamage} damage to you` : 'Your planeswalkers are under attack'}
            {lethal && ' (lethal!)'}
          </span>
          <span className="incoming-chips">
            {attackers.map((a) => (
              <span key={a.id} className={`incoming-chip${a.blocked ? ' blocked' : ''}`} {...hover(a.id)}>
                {a.name}
                {a.power != null && <b> {a.power}</b>}
                {a.commander && <em> commander</em>}
                {a.blocked && <em> blocked</em>}
                {a.atPermanentId && <em> → {game.cards[a.atPermanentId]?.name ?? 'your permanent'}</em>}
              </span>
            ))}
          </span>
        </div>
      )}
      {threats.map((t) => (
        <div key={t.id} className="incoming-line" {...hover(stackSource(game, t.id))}>
          <span className="incoming-head">
            {t.who}&apos;s {t.name} targets {t.targetsYou ? 'you' : ''}
            {t.targetsYou && t.targetCardIds.length > 0 ? ' and ' : ''}
            {t.targetCardIds.map((id) => game.cards[id]?.name ?? 'your permanent').join(', ')}
          </span>
          {t.text && <span className="incoming-text">{cleanText(t.text)}</span>}
        </div>
      ))}
    </section>
  );
}

function stackSource(game: GameState, stackId: string): string | null {
  return game.stack.find((s) => s.id === stackId)?.sourceCardId ?? null;
}
