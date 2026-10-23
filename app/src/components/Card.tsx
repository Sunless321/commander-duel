import { useEffect, useState } from 'react';
import type { CardDto } from '../net/protocol';
import '../styles/card.css';

export interface CardProps {
  card: CardDto | undefined;
  size: 'hand' | 'field' | 'stack';
  glow: boolean;
  selectable: boolean;
  chosen: boolean;
  onClick?: () => void;
}

export function Card({ card, size, glow, selectable, chosen, onClick }: CardProps) {
  const [broken, setBroken] = useState(false);
  const url = card?.imageUrl ?? null;
  useEffect(() => setBroken(false), [url]);

  const showBack = !card || card.hidden;
  const classes = [
    'card',
    size,
    glow && 'glow',
    selectable && 'selectable',
    chosen && 'chosen',
    card?.tapped && 'tapped',
    showBack && 'card-back',
  ]
    .filter(Boolean)
    .join(' ');

  if (showBack || !card) return <div className={classes} onClick={onClick} />;

  const pt = card.power != null && card.toughness != null ? `${card.power}/${card.toughness}` : null;
  return (
    <div className={classes} onClick={onClick} title={card.name ?? undefined}>
      {url && !broken ? (
        <img
          src={'card://img?u=' + encodeURIComponent(url)}
          alt={card.name ?? ''}
          draggable={false}
          onError={() => setBroken(true)}
        />
      ) : (
        <div className="card-text">
          <div className="card-text-head">
            <span className="card-name">{card.name}</span>
            {card.manaCost && <span className="card-cost">{card.manaCost}</span>}
          </div>
          <div className="card-type">{card.typeLine}</div>
          {pt && <div className="card-pt">{pt}</div>}
        </div>
      )}
    </div>
  );
}
